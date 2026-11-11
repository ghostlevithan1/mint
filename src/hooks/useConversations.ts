import { useEffect, useRef, useState } from 'react'
import { MODELS, modelCapabilities, type Model, type Redaction } from '../lib/data'
import { buildDemoAnswer, tokenize } from '../lib/demo-engine'
import { detectRedactionsAsync, redactText, rehydrateText } from '../lib/privacy'
import { fetchWebContext, extractUrls } from '../lib/web'
import {
  ChatApiError,
  streamNvidiaChat,
  type StreamContentPart,
  type StreamMessage,
} from '../lib/nvidia'
import type { ProviderMode } from '../lib/provider'
import {
  buildChatTitle,
  modelById,
  uid,
  type ChatMessage,
  type Conversation,
} from '../lib/chat'
import {
  COMPACT_AT,
  attachmentTokens,
  buildContextMessages,
  compactedHistory,
  compactMessages,
  contextMaxTokens,
  conversationTokens,
  estimateTextTokens,
  growContextWindow,
  initialContextWindow,
  outputBudgetTokens,
  localSummary,
  messageContextText,
} from '../lib/context'
import type { Attachment } from '../lib/files'

type SendInput = {
  text: string
  attachments: Attachment[]
  shieldOn: boolean
  model: Model
  provider: ProviderMode
}

type RunInput = {
  chatId: string
  assistantId: string
  text: string
  attachments: Attachment[]
  shieldOn: boolean
  model: Model
  redactions: Redaction[]
  provider: ProviderMode
  history: ChatMessage[]
  contextWindow: number
}

function createBlankChat(): Conversation {
  const now = Date.now()
  return { id: uid(), title: 'New chat', messages: [], createdAt: now, updatedAt: now }
}

const STORAGE_KEY = 'mint.chats.v1'

// Persist chats to this device only. Image data URLs are dropped to stay within
// localStorage limits; the rest of the conversation is kept.
function serializeChats(chats: Conversation[], activeId: string): string {
  const trimmed = chats.map((chat) => ({
    ...chat,
    title: chat.title,
    messages: chat.messages.map((message) =>
      message.attachments?.length
        ? {
            ...message,
            attachments: message.attachments.map(({ dataUrl: _dataUrl, ...rest }) => rest),
          }
        : message,
    ),
  }))
  return JSON.stringify({ chats: trimmed, activeId })
}

function loadStoredChats(): { chats: Conversation[]; activeId: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { chats?: Conversation[]; activeId?: string }
    const chats = Array.isArray(parsed.chats) ? parsed.chats : []
    if (!chats.length) return null
    const activeId = chats.some((chat) => chat.id === parsed.activeId)
      ? (parsed.activeId as string)
      : chats[0].id
    return { chats, activeId }
  } catch {
    return null
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

function approximateTokens(text: string) {
  if (!text) return 0
  return Math.max(1, Math.round(text.length / 4))
}

function buildLivePrompt(prompt: string, context: string, files: string[], web = '') {
  const parts = [prompt]
  if (files.length) parts.push(`Attached files: ${files.join(', ')}`)
  if (context) parts.push(`Attached file context:\n\n${context}`)
  if (web) parts.push(`Web page context (read just now):\n\n${web}`)
  return parts.join('\n\n---\n\n')
}

function buildLiveContent(
  prompt: string,
  context: string,
  files: string[],
  images: string[],
  web = '',
): string | StreamContentPart[] {
  const text = buildLivePrompt(prompt, context, files, web)
  if (!images.length) return text
  return [
    { type: 'text', text },
    ...images.map<StreamContentPart>((url) => ({ type: 'image_url', image_url: { url } })),
  ]
}

function transcriptOf(messages: ChatMessage[]): string {
  return messages
    .filter((message) => message.role !== 'system' || message.content.trim())
    .map((message) => {
      const role = message.role === 'assistant' ? 'Assistant' : message.role === 'system' ? 'Context' : 'User'
      return `${role}: ${messageContextText(message)}`
    })
    .join('\n\n')
    .slice(0, 30_000)
}

/** Uses the outgoing model to compress a long thread, with a local fallback. */
async function compressWithModel(
  messages: ChatMessage[],
  model: Model,
  provider: ProviderMode,
): Promise<string> {
  if (provider === 'nvidia' && messages.length) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20_000)
    let summary = ''
    try {
      await streamNvidiaChat(
        {
          model: model.id,
          messages: [
            {
              role: 'system',
              content:
                'Compress the conversation into a dense context brief. Keep decisions, facts, names, numbers, open questions, and the user intent. Use short bullets. Do not add commentary.',
            },
            { role: 'user', content: transcriptOf(messages) },
          ],
          temperature: 0.2,
          max_tokens: 2048,
        },
        {
          signal: controller.signal,
          onDelta: (delta) => {
            summary += delta
          },
        },
      )
    } catch {
      summary = ''
    } finally {
      window.clearTimeout(timeout)
    }
    if (summary.trim()) return summary.trim()
  }
  return localSummary(messages)
}

export function useConversations() {
  const [initial] = useState<{ chats: Conversation[]; activeId: string }>(() => {
    const stored = loadStoredChats()
    if (stored) return stored
    const blank = createBlankChat()
    return { chats: [blank], activeId: blank.id }
  })
  const [chats, setChats] = useState<Conversation[]>(initial.chats)
  const [activeId, setActiveId] = useState(initial.activeId)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatingChatId, setGeneratingChatId] = useState<string | null>(null)

  const runIdRef = useRef(0)
  const streamRef = useRef<number | null>(null)
  const timerRef = useRef<number[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const runRef = useRef<{ chatId: string; messageId: string } | null>(null)

  const clearTimers = () => {
    if (streamRef.current !== null) {
      window.clearInterval(streamRef.current)
      streamRef.current = null
    }
    for (const timer of timerRef.current) window.clearTimeout(timer)
    timerRef.current = []
  }

  const cleanupRun = () => {
    runIdRef.current += 1
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    clearTimers()
  }

  useEffect(() => {
    return () => {
      cleanupRun()
    }
  }, [])

  // Debounced save so streaming updates don't write on every tick. A
  // longer interval during generation keeps serialization off the hot path.
  const savedRef = useRef('')
  useEffect(() => {
    const interval = isGenerating ? 2000 : 800
    const handle = window.setTimeout(() => {
      const serialized = serializeChats(chats, activeId)
      if (serialized === savedRef.current) return
      try {
        localStorage.setItem(STORAGE_KEY, serialized)
        savedRef.current = serialized
      } catch {
        // ignore quota errors — chats stay in memory for this session
      }
    }, interval)
    return () => window.clearTimeout(handle)
  }, [chats, activeId, isGenerating])

  const patchMessage = (chatId: string, messageId: string, patch: Partial<ChatMessage>) => {
    setChats((current) =>
      current.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              updatedAt: Date.now(),
              messages: chat.messages.map((message) =>
                message.id === messageId ? { ...message, ...patch } : message,
              ),
            }
          : chat,
      ),
    )
  }

  const finishRun = (runId: number) => {
    if (runIdRef.current !== runId) return
    runRef.current = null
    abortRef.current = null
    setIsGenerating(false)
    setGeneratingChatId(null)
  }

  const runDemo = (runId: number, input: RunInput, activeRedactions: Redaction[]) => {
    if (runIdRef.current !== runId) return

    const promptForModel = input.shieldOn ? redactText(input.text, input.redactions) : input.text
    const fileText = input.attachments.map((file) => file.text).join('\n\n').slice(0, 20_000)
    const context = input.shieldOn ? redactText(fileText, input.redactions) : fileText
    const answer = buildDemoAnswer({
      prompt: promptForModel,
      files: input.attachments.map((file) => file.name),
      images: input.attachments
        .filter((file) => file.kind === 'image')
        .map((file) => file.name),
      redactions: activeRedactions,
      model: input.model,
      context,
    })
    const tokens = tokenize(answer)
    const ttft = Math.round(285 + Math.random() * 240)
    const targetTps = input.model.tps * (0.92 + Math.random() * 0.18)
    const batchSize = Math.max(1, Math.round(targetTps / 16.5))

    patchMessage(input.chatId, input.assistantId, {
      phase: 'shielding',
      provider: 'demo',
      redactions: activeRedactions,
      shieldOn: input.shieldOn,
      modelId: input.model.id,
      content: '',
      stats: undefined,
      stopped: false,
      error: undefined,
    })

    timerRef.current.push(
      window.setTimeout(() => {
        if (runIdRef.current !== runId) return
        patchMessage(input.chatId, input.assistantId, { phase: 'routing' })
      }, 240),
    )

    timerRef.current.push(
      window.setTimeout(() => {
        if (runIdRef.current !== runId) return
        const genStart = performance.now()
        let cursor = 0
        patchMessage(input.chatId, input.assistantId, {
          phase: 'generating',
          provider: 'demo',
          stats: { tps: 0, ttft, tokens: 0, elapsed: 0 },
        })

        if (streamRef.current !== null) window.clearInterval(streamRef.current)
        streamRef.current = window.setInterval(() => {
          if (runIdRef.current !== runId) return
          cursor = Math.min(tokens.length, cursor + batchSize)
          const elapsed = Math.max(0.08, (performance.now() - genStart) / 1000)
          const liveTps = (cursor / elapsed) * (0.96 + Math.random() * 0.08)
          const complete = cursor >= tokens.length

          patchMessage(input.chatId, input.assistantId, {
            content: rehydrateText(tokens.slice(0, cursor).join(''), activeRedactions),
            stats: {
              tps: complete ? tokens.length / elapsed : liveTps,
              ttft,
              tokens: cursor,
              elapsed,
            },
            phase: complete ? 'done' : 'generating',
            provider: 'demo',
          })

          if (complete) {
            if (streamRef.current !== null) {
              window.clearInterval(streamRef.current)
              streamRef.current = null
            }
            finishRun(runId)
          }
        }, 60)
      }, 760),
    )
  }

  const runAnswer = async (input: RunInput) => {
    cleanupRun()
    const runId = runIdRef.current
    runRef.current = { chatId: input.chatId, messageId: input.assistantId }

    const activeRedactions = input.shieldOn ? input.redactions : []
    const promptForModel = input.shieldOn ? redactText(input.text, input.redactions) : input.text
    const maxTokens = contextMaxTokens(input.model)
    const windowTokens = Math.max(
      initialContextWindow(maxTokens),
      Math.min(input.contextWindow, maxTokens),
    )
    // Reasoning + answer share one output budget; scale it with the model's
    // context window so scratchpad-heavy turns still leave room for an answer.
    const outputTokens = outputBudgetTokens(windowTokens)
    const reserve = Math.min(outputTokens, Math.max(1800, Math.floor(windowTokens * 0.25)))
    const fileBudget = Math.max(2000, Math.floor((windowTokens - reserve) * 0.6 * 4))
    const fileText = input.attachments
      .map((file) => file.text)
      .join('\n\n')
      .slice(0, fileBudget)
    const context = input.shieldOn ? redactText(fileText, input.redactions) : fileText
    const files = input.attachments.map((file) => file.name)

    patchMessage(input.chatId, input.assistantId, {
      phase: 'shielding',
      provider: input.provider,
      redactions: activeRedactions,
      shieldOn: input.shieldOn,
      modelId: input.model.id,
      content: '',
      stats: undefined,
      stopped: false,
      error: undefined,
    })

    await wait(180)
    if (runIdRef.current !== runId) return

    let webContext = ''
    const links = modelCapabilities(input.model).includes('web')
      ? extractUrls(input.text)
      : []
    if (links.length) {
      patchMessage(input.chatId, input.assistantId, { phase: 'routing' })
      const webController = new AbortController()
      abortRef.current = webController
      const webBudget = Math.min(
        18_000,
        Math.max(1800, Math.floor(windowTokens * 0.5 * 4)),
      )
      const web = await fetchWebContext(links, webController.signal, webBudget)
      if (runIdRef.current !== runId) return
      abortRef.current = null
      webContext = web.context
      if (web.sources.length) {
        patchMessage(input.chatId, input.assistantId, { webSources: web.sources })
      }
    }

    if (input.provider === 'demo') {
      runDemo(runId, input, activeRedactions)
      return
    }

    patchMessage(input.chatId, input.assistantId, { phase: 'routing' })

    const requestStart = performance.now()
    const controller = new AbortController()
    abortRef.current = controller
    const supportsImages = modelCapabilities(input.model).includes('image')
    const images = supportsImages
      ? input.attachments
          .filter((file) => file.kind === 'image' && Boolean(file.dataUrl))
          .map((file) => file.dataUrl as string)
      : []
    const userContent = buildLiveContent(promptForModel, context, files, images, webContext)
    const userText = buildLivePrompt(promptForModel, context, files, webContext)
    // Images are sent as separate parts, so reserve their vision cost too.
    const imageTokens = input.attachments
      .filter((file) => file.kind === 'image' && file.dataUrl)
      .reduce((sum, file) => sum + attachmentTokens(file), 0)
    const historyBudget = Math.max(
      128,
      windowTokens - reserve - estimateTextTokens(userText) - imageTokens,
    )
    const currentImageChars = images.reduce((sum, url) => sum + url.length, 0)
    const requestMessages: StreamMessage[] = [
      ...buildContextMessages(input.history, historyBudget, {
        enabled: supportsImages,
        used: images.length,
        chars: currentImageChars,
      }),
      { role: 'user', content: userContent },
    ]
    let raw = ''
    let reasoningRaw = ''
    let finishReason = ''
    let firstTokenAt: number | null = null
    let usageTokens = 0
    let lastFlush = 0

    const markFirstToken = () => {
      if (firstTokenAt !== null) return
      firstTokenAt = performance.now()
      patchMessage(input.chatId, input.assistantId, {
        phase: 'generating',
        provider: 'nvidia',
      })
    }

    const currentStats = () => {
      if (firstTokenAt === null) return undefined
      const elapsed = Math.max(0.05, (performance.now() - firstTokenAt) / 1000)
      const tokens = usageTokens || approximateTokens(raw + reasoningRaw)
      return {
        tps: tokens / elapsed,
        ttft: firstTokenAt - requestStart,
        tokens,
        elapsed,
      }
    }

    const flush = (force = false) => {
      if (runIdRef.current !== runId) return
      const now = performance.now()
      if (!force && now - lastFlush < 55) return
      lastFlush = now
      patchMessage(input.chatId, input.assistantId, {
        content: rehydrateText(raw, activeRedactions),
        reasoning: reasoningRaw
          ? rehydrateText(reasoningRaw, activeRedactions)
          : undefined,
        phase: 'generating',
        stats: currentStats(),
      })
    }

    try {
      await streamNvidiaChat(
        {
          model: input.model.id,
          messages: requestMessages,
          max_tokens: outputTokens,
        },
        {
          signal: controller.signal,
          onDelta: (delta) => {
            if (runIdRef.current !== runId) return
            markFirstToken()
            raw += delta
            flush()
          },
          onReasoning: (delta) => {
            if (runIdRef.current !== runId) return
            markFirstToken()
            reasoningRaw += delta
            flush()
          },
          onFinish: (reason) => {
            finishReason = reason
          },
          onUsage: (usage) => {
            if (typeof usage.completion_tokens === 'number') {
              usageTokens = usage.completion_tokens
            }
          },
        },
      )

      if (runIdRef.current !== runId) return
      flush(true)
      const reasoning = reasoningRaw
        ? rehydrateText(reasoningRaw, activeRedactions)
        : undefined
      let emptyError: string | undefined
      if (!raw) {
        emptyError = reasoningRaw
          ? finishReason === 'length'
            ? 'The model ran out of output tokens while reasoning and never wrote an answer. Try again or pick a different model.'
            : 'The model streamed its reasoning but never wrote a final answer. Try again or pick a different model.'
          : 'The model returned an empty response. Try again or pick a different model.'
      }
      patchMessage(input.chatId, input.assistantId, {
        content: rehydrateText(raw, activeRedactions),
        reasoning,
        phase: 'done',
        provider: 'nvidia',
        stats: currentStats(),
        error: emptyError,
      })
      finishRun(runId)
    } catch (error) {
      if (runIdRef.current !== runId) return
      if (controller.signal.aborted) return

      if (error instanceof ChatApiError && error.code === 'NO_KEY') {
        runDemo(runId, input, activeRedactions)
        return
      }

      if (error instanceof ChatApiError) {
        patchMessage(input.chatId, input.assistantId, {
          content: rehydrateText(raw, activeRedactions),
          reasoning: reasoningRaw
            ? rehydrateText(reasoningRaw, activeRedactions)
            : undefined,
          phase: 'done',
          provider: 'nvidia',
          stats: currentStats(),
          error: error.message,
        })
        finishRun(runId)
        return
      }

      // A static preview has no proxy, and a live network can drop. Keep the
      // workspace usable by falling back to the local demo engine.
      runDemo(runId, input, activeRedactions)
    }
  }

  const sendMessage = async ({
    text,
    attachments,
    shieldOn,
    model,
    provider,
  }: SendInput) => {
    if (isGenerating) return
    const content = text.trim()
    if (!content && !attachments.length) return

    const chat = chats.find((item) => item.id === activeId)
    if (!chat) return

    const now = Date.now()
    const combined = `${content}\n\n${attachments.map((file) => file.text).join('\n\n')}`.slice(
      0,
      160_000,
    )
    const detected = await detectRedactionsAsync(combined)
    const userMessage: ChatMessage = {
      id: uid(),
      role: 'user',
      content,
      createdAt: now,
      attachments,
      shieldOn,
      redactionCount: shieldOn ? detected.length : 0,
    }
    const assistantId = uid()
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: now + 1,
      phase: 'shielding',
      modelId: model.id,
      shieldOn,
      redactions: shieldOn ? detected : [],
      provider,
    }

    const maxTokens = contextMaxTokens(model)
    const lastUsedId = chat.previousModelId ?? chat.modelId
    const previousModel = modelById(MODELS, lastUsedId)
    const switched = Boolean(lastUsedId) && lastUsedId !== model.id
    const storedWindow = chat.contextWindow ?? initialContextWindow(maxTokens)
    let window = Math.max(initialContextWindow(maxTokens), Math.min(storedWindow, maxTokens))
    let history = chat.messages

    // A switch to a smaller model compresses the old thread with the old model
    // before anything is sent to the new one.
    const mustCompress = switched && storedWindow > maxTokens
    if (mustCompress) {
      setIsGenerating(true)
      setGeneratingChatId(chat.id)
      const guard = runIdRef.current
      const summary = await compressWithModel(chat.messages, previousModel, provider)
      if (runIdRef.current !== guard) return
      history = compactedHistory(chat.messages, summary, 4)
      window = maxTokens
    }

    const promptTokens =
      estimateTextTokens(content) +
      attachments.reduce((sum, file) => sum + attachmentTokens(file), 0) +
      10
    const projected = () => conversationTokens(history) + promptTokens

    // Grow 2048 → 4096 → 8192 … until the model maximum.
    while (projected() >= window * COMPACT_AT && window < maxTokens) {
      const grown = growContextWindow(window, maxTokens)
      if (grown <= window) break
      window = grown
    }
    // At the model maximum, compact instead of overflowing.
    if (projected() >= window * COMPACT_AT) {
      history = compactMessages(history, 4)
    }

    setChats((current) =>
      current.map((item) =>
        item.id === chat.id
          ? {
              ...item,
              title:
                chat.messages.length === 0 ? buildChatTitle(content, attachments) : item.title,
              updatedAt: now,
              modelId: model.id,
              previousModelId: undefined,
              contextWindow: window,
              messages: [...history, userMessage, assistantMessage],
            }
          : item,
      ),
    )
    setIsGenerating(true)
    setGeneratingChatId(chat.id)
    void runAnswer({
      chatId: chat.id,
      assistantId,
      text: content,
      attachments,
      shieldOn,
      model,
      redactions: detected,
      provider,
      history,
      contextWindow: window,
    })
  }

  const stopGenerating = () => {
    cleanupRun()
    const run = runRef.current
    if (run) {
      setChats((current) =>
        current.map((chat) =>
          chat.id === run.chatId
            ? {
                ...chat,
                messages: chat.messages.map((message) =>
                  message.id === run.messageId
                    ? {
                        ...message,
                        content:
                          message.content ||
                          'Response stopped before any tokens were generated.',
                        phase: 'done',
                        stopped: true,
                      }
                    : message,
                ),
              }
            : chat,
        ),
      )
    }
    runRef.current = null
    setIsGenerating(false)
    setGeneratingChatId(null)
  }

  const regenerate = (assistantId: string, provider: ProviderMode) => {
    if (isGenerating) return
    const chat = chats.find((item) => item.messages.some((message) => message.id === assistantId))
    if (!chat) return
    const index = chat.messages.findIndex((message) => message.id === assistantId)
    if (index < 0) return

    let userIndex = index - 1
    while (userIndex >= 0 && chat.messages[userIndex].role !== 'user') userIndex -= 1
    if (userIndex < 0) return

    const assistant = chat.messages[index]
    const userMessage = chat.messages[userIndex]
    const model = modelById(MODELS, assistant.modelId)
    const maxTokens = contextMaxTokens(model)
    const contextWindow = Math.max(
      initialContextWindow(maxTokens),
      Math.min(chat.contextWindow ?? initialContextWindow(maxTokens), maxTokens),
    )
    const newAssistantId = uid()
    const placeholder: ChatMessage = {
      id: newAssistantId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      phase: 'shielding',
      modelId: assistant.modelId,
      shieldOn: assistant.shieldOn ?? true,
      redactions: assistant.redactions ?? [],
      provider,
    }

    setChats((current) =>
      current.map((item) =>
        item.id === chat.id
          ? {
              ...item,
              updatedAt: Date.now(),
              contextWindow,
              messages: [...item.messages.slice(0, userIndex + 1), placeholder],
            }
          : item,
      ),
    )
    setIsGenerating(true)
    setGeneratingChatId(chat.id)
    void runAnswer({
      chatId: chat.id,
      assistantId: newAssistantId,
      text: userMessage.content,
      attachments: userMessage.attachments ?? [],
      shieldOn: assistant.shieldOn ?? true,
      model,
      redactions: assistant.redactions ?? [],
      provider,
      history: chat.messages.slice(0, userIndex),
      contextWindow,
    })
  }

  const newChat = () => {
    const current = chats.find((item) => item.id === activeId)
    if (current && current.messages.length === 0) return activeId
    const chat = createBlankChat()
    setChats((currentChats) => [chat, ...currentChats])
    setActiveId(chat.id)
    return chat.id
  }

  const selectChat = (id: string) => setActiveId(id)

  const deleteChat = (id: string) => {
    if (generatingChatId === id) stopGenerating()
    const remaining = chats.filter((item) => item.id !== id)
    if (!remaining.length) {
      const blank = createBlankChat()
      setChats([blank])
      setActiveId(blank.id)
      return
    }
    setChats(remaining)
    if (activeId === id) setActiveId(remaining[0].id)
  }

  const clearChats = () => {
    cleanupRun()
    runRef.current = null
    const blank = createBlankChat()
    setChats([blank])
    setActiveId(blank.id)
    setIsGenerating(false)
    setGeneratingChatId(null)
  }

  const compactChat = () => {
    const chat = chats.find((item) => item.id === activeId)
    if (!chat || chat.messages.length < 3) return
    const compacted = compactMessages(chat.messages, 4)
    if (compacted === chat.messages) return
    setChats((current) =>
      current.map((item) =>
        item.id === chat.id
          ? { ...item, messages: compacted, updatedAt: Date.now() }
          : item,
      ),
    )
  }

  const growContext = (model: Model) => {
    const chat = chats.find((item) => item.id === activeId)
    if (!chat) return
    const maxTokens = contextMaxTokens(model)
    const base = initialContextWindow(maxTokens)
    const current = Math.max(
      base,
      Math.min(chat.contextWindow ?? base, maxTokens),
    )
    const next = growContextWindow(current, maxTokens)
    if (next === current) return
    setChats((items) =>
      items.map((item) =>
        item.id === chat.id ? { ...item, contextWindow: next } : item,
      ),
    )
  }

  const setChatModel = (chatId: string, id: string) => {
    setChats((current) =>
      current.map((item) => {
        if (item.id !== chatId || item.modelId === id) return item
        return {
          ...item,
          modelId: id,
          previousModelId: item.previousModelId ?? item.modelId,
        }
      }),
    )
  }

  const activeChat = chats.find((item) => item.id === activeId) ?? chats[0]

  return {
    chats,
    activeChat,
    activeId,
    isGenerating,
    generatingChatId,
    sendMessage,
    stopGenerating,
    regenerate,
    newChat,
    selectChat,
    deleteChat,
    clearChats,
    compactChat,
    growContext,
    setChatModel,
  }
}

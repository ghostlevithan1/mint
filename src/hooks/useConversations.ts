import { useEffect, useRef, useState } from 'react'
import { MODELS, modelCapabilities, type Model, type Redaction } from '../lib/data'
import { buildDemoAnswer, tokenize } from '../lib/demo-engine'
import { detectRedactionsAsync, redactText, rehydrateText } from '../lib/privacy'
import { fetchWebContext, extractUrls, fetchWebSearchContext } from '../lib/web'
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
  type WebSource,
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
import { loadConversations, persistConversations, purgeLegacyChatStorageOnce, wipePersistedStore } from '../lib/storage'

type SendInput = {
  text: string
  attachments: Attachment[]
  shieldOn: boolean
  model: Model
  provider: ProviderMode
  /** Web search toggle from the composer. */
  webSearch?: boolean
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
  /** When on, the turn starts with a real web search of the prompt. */
  webSearch?: boolean
}

function createBlankChat(): Conversation {
  const now = Date.now()
  return { id: uid(), title: 'New chat', messages: [], createdAt: now, updatedAt: now }
}

// Chats persist in IndexedDB on the user's device only. Every conversation
// is gzip-compressed on write and inflated on read; active streaming writes
// skip unchanged conversations via a per-chat hash.
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
  if (web) parts.push(`Web context (searched or read just now):\n\n${web}`)
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
  onDelta?: (delta: string, running: string) => void,
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
            onDelta?.(delta, summary)
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
  // The IDB store is the source of truth; the first paint is a blank chat,
  // replaced by persisted conversations as soon as the async read completes.
  const [chats, setChats] = useState<Conversation[]>(() => [createBlankChat()])
  const [activeId, setActiveId] = useState(() => chats[0]?.id ?? '')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatingChatId, setGeneratingChatId] = useState<string | null>(null)
  /** Chat id whose manual /compact is currently running a model summary. */
  const [compactingChatId, setCompactingChatId] = useState<string | null>(null)
  /** Non-empty when IndexedDB writes are failing for this browser. */
  const [storageError, setStorageError] = useState('')
  const compactingRef = useRef(false)
  const loadedRef = useRef(false)

  const runIdRef = useRef(0)
  const streamRef = useRef<number | null>(null)
  const timerRef = useRef<number[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const runRef = useRef<{ chatId: string; messageId: string } | null>(null)
  const chatsRef = useRef(chats)
  const activeIdRef = useRef(activeId)
  useEffect(() => {
    chatsRef.current = chats
    activeIdRef.current = activeId
  }, [chats, activeId])

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

  // Load persisted conversations once at startup. Before the read completes,
  // the persist effect stays inert so the blank first paint can't clobber
  // what's on disk.
  useEffect(() => {
    let cancelled = false
    purgeLegacyChatStorageOnce()
    void loadConversations().then((stored) => {
      if (cancelled) return
      if (stored) {
        setChats(stored.conversations)
        setActiveId(stored.activeId ?? stored.conversations[0].id)
      }
      loadedRef.current = true
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Debounced save so streaming updates don't write on every tick. A
  // longer interval during generation keeps serialization off the hot path.
  useEffect(() => {
    if (!loadedRef.current) return
    const interval = isGenerating ? 2000 : 800
    const handle = window.setTimeout(() => {
      void persistConversations(chats, activeId).then((error) => {
        setStorageError(error ?? '')
      })
    }, interval)
    return () => window.clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats, activeId, isGenerating])

  // Best-effort flush on page unload; IDB transactions usually survive it.
  // Sessions holding only empty auto-created blanks skip the write so the
  // unload can't clobber the active-chat pointer written by earlier saves.
  useEffect(() => {
    const flush = () => {
      if (!loadedRef.current) return
      if (chatsRef.current.some((chat) => chat.messages.length > 0)) {
        void persistConversations(chatsRef.current, activeIdRef.current)
      }
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

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
      webSearch: Boolean(input.webSearch),
      fallbackFrom: undefined,
    })

    await wait(180)
    if (runIdRef.current !== runId) return

    let webContext = ''
    const links = modelCapabilities(input.model).includes('web')
      ? extractUrls(input.text)
      : []
    if (input.webSearch || links.length) {
      patchMessage(input.chatId, input.assistantId, { phase: 'routing' })
      const webController = new AbortController()
      abortRef.current = webController
      // Web pages may use up to half the model's context window in chars
      // (~4 chars/token). The server starts its per-page cap at 48k and
      // doubles toward 192k when a page nearly fills it, bounded by this.
      const webBudget = Math.min(
        576_000,
        Math.max(1800, Math.floor(maxTokens * 2)),
      )
      try {
        let searchSources: WebSource[] = []
        if (input.webSearch) {
          // Web search runs first: results + top pages become the brief.
          const search = await fetchWebSearchContext(input.text, webController.signal, webBudget)
          if (runIdRef.current !== runId) return
          webContext = search.context
          searchSources = search.sources
          patchMessage(input.chatId, input.assistantId, {
            webQuery: search.query,
            webSources: search.sources,
            webError: search.error,
          })
        }
        if (links.length) {
          const web = await fetchWebContext(links, webController.signal, webBudget)
          if (runIdRef.current !== runId) return
          webContext = [webContext, web.context].filter(Boolean).join('\n\n---\n\n')
          if (web.sources.length) {
            const seen = new Set(searchSources.map((source) => source.url))
            const merged = [...searchSources, ...web.sources.filter((source) => !seen.has(source.url))]
            patchMessage(input.chatId, input.assistantId, { webSources: merged })
          }
        }
      } finally {
        abortRef.current = null
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
      // If the model fills its output budget mid-answer (finish_reason
      // 'length') with a non-empty reply, it hit the cap we gave it, not a
      // provider fault. Give it up to two continuation chunks instead of
      // leaving a truncated document behind; tokens are spent only when the
      // cap is genuinely reached.
      const MAX_CONTINUATIONS = 2
      let continuation = 0
      while (true) {
        const messagesForChunk: StreamMessage[] =
          continuation === 0
            ? requestMessages
            : [
                ...requestMessages,
                { role: 'assistant', content: raw },
                {
                  role: 'user',
                  content:
                    'Continue exactly from where you stopped. Do not repeat earlier text; finish any open code block.',
                },
              ]
        finishReason = ''
        await streamNvidiaChat(
          {
            model: input.model.id,
            messages: messagesForChunk,
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
                usageTokens += usage.completion_tokens
              }
            },
            onModel: (info) => {
              if (runIdRef.current !== runId) return
              if (info.fallbackFrom) {
                patchMessage(input.chatId, input.assistantId, {
                  fallbackFrom: info.fallbackFrom,
                })
              }
            },
          },
        )
        continuation += 1
        if (runIdRef.current !== runId) return
        if (finishReason !== 'length' || !raw || continuation > MAX_CONTINUATIONS) {
          break
        }
      }

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
      } else if (finishReason === 'length') {
        emptyError =
          'The answer hit the output limit and may be truncated. Ask me to continue where I stopped.'
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
    webSearch,
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
      webSearch,
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
    const index = chats.findIndex((item) => item.id === id)
    if (index < 0) return null
    const removed = chats[index]
    const remaining = chats.filter((item) => item.id !== id)
    if (!remaining.length) {
      const blank = createBlankChat()
      setChats([blank])
      setActiveId(blank.id)
      return { chat: removed, index }
    }
    setChats(remaining)
    if (activeId === id) {
      const next = remaining[Math.min(index, remaining.length - 1)]
      setActiveId(next.id)
    }
    return { chat: removed, index }
  }

  /** Puts a deleted chat back where it was; used by the undo toast. */
  const restoreChat = (chat: Conversation, index: number) => {
    setChats((current) => {
      if (current.some((item) => item.id === chat.id)) return current
      const rest = current.filter(
        (item) => item.messages.length > 0 || item.id === chat.id,
      )
      const at = Math.max(0, Math.min(index, rest.length))
      return [...rest.slice(0, at), chat, ...rest.slice(at)]
    })
    setActiveId(chat.id)
  }

  const renameChat = (id: string, title: string) => {
    const next = title.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (!next) return
    setChats((current) =>
      current.map((item) =>
        item.id === id && item.title !== next
          ? { ...item, title: next, updatedAt: Date.now() }
          : item,
      ),
    )
  }

  const clearChats = () => {
    cleanupRun()
    runRef.current = null
    void wipePersistedStore().then((ok) => {
      if (!ok) setStorageError('This browser could not clear saved chats.')
    })
    const blank = createBlankChat()
    setChats([blank])
    setActiveId(blank.id)
    setIsGenerating(false)
    setGeneratingChatId(null)
  }

  /**
   * Manual /compact with visible progress: the model streams the summary live
   * into the thread, then older turns are replaced by that brief. Falls back
   * to the instant local summary when the model call fails or times out.
   */
  const compactChat = async (provider: ProviderMode) => {
    const chat = chatsRef.current.find((item) => item.id === activeIdRef.current)
    if (!chat || chat.messages.length < 3) return
    if (compactingRef.current || isGenerating) return

    compactingRef.current = true
    const guard = runIdRef.current
    const model = modelById(MODELS, chat.modelId)
    const compactMessageId = uid()
    const now = Date.now()

    setIsGenerating(true)
    setGeneratingChatId(chat.id)
    setCompactingChatId(chat.id)

    // Visible progress marker lives in the thread while the summary streams.
    setChats((current) =>
      current.map((item) =>
        item.id === chat.id
          ? {
              ...item,
              updatedAt: now,
              messages: [
                ...item.messages,
                {
                  id: compactMessageId,
                  role: 'system' as const,
                  content: '',
                  createdAt: now,
                  phase: 'generating' as const,
                },
              ],
            }
          : item,
      ),
    )

    let summary = ''
    if (provider === 'nvidia') {
      const controller = new AbortController()
      abortRef.current = controller
      try {
        await compressWithModel(chat.messages, model, provider, (_delta, running) => {
          if (runIdRef.current !== guard) return
          summary = running
          setChats((current) =>
            current.map((item) =>
              item.id === chat.id
                ? {
                    ...item,
                    messages: item.messages.map((message) =>
                      message.id === compactMessageId
                        ? { ...message, content: running }
                        : message,
                    ),
                  }
                : item,
            ),
          )
        })
      } finally {
        abortRef.current = null
      }
    }

    if (runIdRef.current !== guard) {
      // The run was taken over (stop/new send); that run owns the UI now.
      // isGenerating is managed by stopGenerating/sendMessage already.
      compactingRef.current = false
      setCompactingChatId(null)
      return
    }

    if (!summary.trim()) summary = localSummary(chat.messages)
    const compacted = compactedHistory(chat.messages, summary.trim(), 4)
    setChats((current) =>
      current.map((item) =>
        item.id === chat.id
          ? { ...item, messages: compacted, updatedAt: Date.now() }
          : item,
      ),
    )
    setCompactingChatId(null)
    setIsGenerating(false)
    setGeneratingChatId(null)
    compactingRef.current = false
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
    compactingChatId,
    storageError,
    sendMessage,
    stopGenerating,
    regenerate,
    newChat,
    selectChat,
    deleteChat,
    restoreChat,
    renameChat,
    clearChats,
    compactChat,
    growContext,
    setChatModel,
  }
}

import { useEffect, useRef, useState } from 'react'
import { MODELS, modelCapabilities, type Model, type Redaction } from '../lib/data'
import { buildDemoAnswer, tokenize } from '../lib/demo-engine'
import { detectRedactions, redactText, rehydrateText } from '../lib/privacy'
import { ChatApiError, streamNvidiaChat, type StreamContentPart } from '../lib/nvidia'
import type { ProviderMode } from '../lib/provider'
import {
  buildChatTitle,
  modelById,
  uid,
  type ChatMessage,
  type Conversation,
} from '../lib/chat'
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
}

function createBlankChat(): Conversation {
  const now = Date.now()
  return { id: uid(), title: 'New chat', messages: [], createdAt: now, updatedAt: now }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

function approximateTokens(text: string) {
  if (!text) return 0
  return Math.max(1, Math.round(text.length / 4))
}

function buildLivePrompt(prompt: string, context: string, files: string[]) {
  const parts = [prompt]
  if (files.length) parts.push(`Attached files: ${files.join(', ')}`)
  if (context) parts.push(`Attached file context:\n\n${context}`)
  return parts.join('\n\n---\n\n')
}

function buildLiveContent(
  prompt: string,
  context: string,
  files: string[],
  images: string[],
): string | StreamContentPart[] {
  const text = buildLivePrompt(prompt, context, files)
  if (!images.length) return text
  return [
    { type: 'text', text },
    ...images.map<StreamContentPart>((url) => ({ type: 'image_url', image_url: { url } })),
  ]
}

export function useConversations() {
  const [initialChat] = useState<Conversation>(() => createBlankChat())
  const [chats, setChats] = useState<Conversation[]>([initialChat])
  const [activeId, setActiveId] = useState(initialChat.id)
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
    const fileText = input.attachments.map((file) => file.text).join('\n\n').slice(0, 30_000)
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
    const userContent = buildLiveContent(promptForModel, context, files, images)
    let raw = ''
    let firstTokenAt: number | null = null
    let usageTokens = 0
    let lastFlush = 0

    const currentStats = () => {
      if (firstTokenAt === null) return undefined
      const elapsed = Math.max(0.05, (performance.now() - firstTokenAt) / 1000)
      const tokens = usageTokens || approximateTokens(raw)
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
        phase: 'generating',
        stats: currentStats(),
      })
    }

    try {
      await streamNvidiaChat(
        {
          model: input.model.id,
          messages: [{ role: 'user', content: userContent }],
        },
        {
          signal: controller.signal,
          onDelta: (delta) => {
            if (runIdRef.current !== runId) return
            if (firstTokenAt === null) {
              firstTokenAt = performance.now()
              patchMessage(input.chatId, input.assistantId, {
                phase: 'generating',
                provider: 'nvidia',
              })
            }
            raw += delta
            flush()
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
      patchMessage(input.chatId, input.assistantId, {
        content: rehydrateText(raw, activeRedactions),
        phase: 'done',
        provider: 'nvidia',
        stats: currentStats(),
        error: raw ? undefined : 'The model returned an empty response. Try again.',
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

  const sendMessage = ({ text, attachments, shieldOn, model, provider }: SendInput) => {
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
    const detected = detectRedactions(combined)
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

    setChats((current) =>
      current.map((item) =>
        item.id === chat.id
          ? {
              ...item,
              title:
                item.messages.length === 0 ? buildChatTitle(content, attachments) : item.title,
              updatedAt: now,
              messages: [...item.messages, userMessage, assistantMessage],
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
      model: modelById(MODELS, assistant.modelId),
      redactions: assistant.redactions ?? [],
      provider,
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
  }
}

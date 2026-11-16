import { useEffect, useRef, useState } from 'react'
import { MODELS, modelCapabilities, type Model, type Redaction } from '../lib/data'
import { detectRedactionsAsync, redactText, rehydrateText } from '../lib/privacy'
import { fetchWebContext, extractUrls, fetchWebSearchContext } from '../lib/web'
import { MAX_TOOL_STEPS, parseToolCall, runCalculator, stripToolCalls, toolStatus } from '../lib/agent'
import {
  ChatApiError,
  streamNvidiaChat,
  type StreamContentPart,
  type StreamMessage,
} from '../lib/nvidia'
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
  contextLimitTokens,
  conversationRedactions,
  conversationTokens,
  estimateTextTokens,
  OUTPUT_TOKENS,
  redactContextMessages,
  retryOutputBudget,
  spentReasoningOnly,
  localSummary,
  messageContextText,
} from '../lib/context'
import type { Attachment } from '../lib/files'
import { blockKindFor, getBlock, startBlock } from '../lib/blocks'
import { getStoredProfile, getStoredShield } from '../lib/preferences'
import { loadConversations, persistConversations, purgeLegacyChatStorageOnce, wipePersistedStore } from '../lib/storage'

type SendInput = {
  text: string
  attachments: Attachment[]
  shieldOn: boolean
  model: Model
}

type RunInput = {
  chatId: string
  assistantId: string
  text: string
  attachments: Attachment[]
  shieldOn: boolean
  model: Model
  redactions: Redaction[]
  history: ChatMessage[]
}

/** The proxy truncates one message at 60K characters; files and pages share that. */
const FILE_CONTEXT_CHARS = 40_000
const LINK_CONTEXT_CHARS = 16_000
const TOOL_RESULT_CHARS = 24_000

function createBlankChat(): Conversation {
  const now = Date.now()
  return { id: uid(), title: 'New chat', messages: [], createdAt: now, updatedAt: now }
}

// Chats persist in IndexedDB on the user's device only. Every conversation
// is gzip-compressed on write and inflated on read; active streaming writes
// skip unchanged conversations via a per-chat hash.
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

/** Uses the chat's model to compress a long thread, with a local fallback. */
async function compressWithModel(
  messages: ChatMessage[],
  model: Model,
  signal: AbortSignal,
  onProgress?: (running: string) => void,
  redactions: Redaction[] = [],
): Promise<string> {
  if (messages.length) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    const timeout = window.setTimeout(abort, 20_000)
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
            { role: 'user', content: redactText(transcriptOf(messages), redactions) },
          ],
          temperature: 0.2,
          max_tokens: 2048,
        },
        {
          signal: controller.signal,
          onDelta: (delta) => {
            summary += delta
            onProgress?.(rehydrateText(summary, redactions))
          },
        },
      )
    } catch {
      summary = ''
    } finally {
      window.clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
    if (summary.trim()) return rehydrateText(summary, redactions).trim()
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
        // A chat the student started while this read was running must survive it.
        const ids = new Set(stored.conversations.map((chat) => chat.id))
        const started = chatsRef.current.filter((chat) => chat.messages.length > 0 && !ids.has(chat.id))
        const keepActive = started.some((chat) => chat.id === activeIdRef.current)
        setChats(started.length ? [...started, ...stored.conversations] : stored.conversations)
        if (!keepActive) setActiveId(stored.activeId ?? stored.conversations[0].id)
      }
      loadedRef.current = true
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Throttled save so streaming updates don't write on every tick. A change
  // schedules one save if none is pending, and that save writes whatever the
  // state is when it fires. (A debounce would restart on every streamed token
  // and write nothing until the answer ended.) A longer interval during
  // generation keeps serialization off the hot path.
  const saveTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (!loadedRef.current || saveTimerRef.current !== null) return
    const interval = isGenerating ? 2000 : 800
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void persistConversations(chatsRef.current, activeIdRef.current).then((error) => {
        setStorageError(error ?? '')
      })
    }, interval)
  }, [chats, activeId, isGenerating])

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    },
    [],
  )

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

  const runAnswer = async (input: RunInput) => {
    cleanupRun()
    const runId = runIdRef.current
    runRef.current = { chatId: input.chatId, messageId: input.assistantId }

    // Read at request time so send and regenerate both use the latest profile.
    const profile = getStoredProfile().trim()
    // One list shields everything that leaves the browser in this request:
    // the new prompt, earlier turns, the profile, file names and fetched pages.
    const activeRedactions = input.shieldOn
      ? conversationRedactions(input.history, profile, input.redactions)
      : []
    const promptForModel = redactText(input.text, activeRedactions)
    const limitTokens = contextLimitTokens(input.model)
    const outputTokens = OUTPUT_TOKENS
    const fileText = input.attachments
      .map((file) => file.text)
      .join('\n\n')
      .slice(0, FILE_CONTEXT_CHARS)
    const context = redactText(fileText, activeRedactions)
    const files = input.attachments.map((file) => redactText(file.name, activeRedactions))

    patchMessage(input.chatId, input.assistantId, {
      phase: 'shielding',
      redactions: activeRedactions,
      shieldOn: input.shieldOn,
      modelId: input.model.id,
      content: '',
      stats: undefined,
      stopped: false,
      error: undefined,
      fallbackFrom: undefined,
    })

    if (runIdRef.current !== runId) return

    let webContext = ''
    const links = extractUrls(input.text)
    if (links.length) {
      patchMessage(input.chatId, input.assistantId, { phase: 'routing' })
      const webController = new AbortController()
      abortRef.current = webController
      try {
        const web = await fetchWebContext(links, webController.signal, LINK_CONTEXT_CHARS)
        if (runIdRef.current !== runId) return
        webContext = redactText(web.context, activeRedactions)
        if (web.sources.length) patchMessage(input.chatId, input.assistantId, { webSources: web.sources })
      } catch {
        if (runIdRef.current !== runId) return
      } finally {
        abortRef.current = null
      }
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
    const profileMessage: StreamMessage[] = profile
      ? [{ role: 'system', content: `About this student, in their own words:\n${profile}` }]
      : []
    const historyBudget = Math.max(
      512,
      limitTokens - estimateTextTokens(userText) - imageTokens - estimateTextTokens(profile),
    )
    const currentImageChars = images.reduce((sum, url) => sum + url.length, 0)
    // The new turn is already shielded above; profile and earlier turns are not.
    const requestMessages: StreamMessage[] = [
      ...redactContextMessages(
        [
          ...profileMessage,
          ...buildContextMessages(input.history, historyBudget, {
            enabled: supportsImages,
            used: images.length,
            chars: currentImageChars,
          }),
        ],
        activeRedactions,
      ),
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
      patchMessage(input.chatId, input.assistantId, { phase: 'generating' })
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
        content: rehydrateText(stripToolCalls(raw), activeRedactions),
        reasoning: reasoningRaw
          ? rehydrateText(reasoningRaw, activeRedactions)
          : undefined,
        phase: 'generating',
        activity: undefined,
        stats: currentStats(),
      })
    }

    try {
      // A reasoner can spend the entire output budget on its scratchpad and
      // never stream an answer. Retry once with a larger cap and a direct
      // instruction instead of failing the turn.
      const MAX_ANSWER_RETRIES = 1
      // If the model fills its output budget mid-answer (finish_reason
      // 'length') with a non-empty reply, it hit the cap we gave it, not a
      // provider fault. Give it up to two continuation chunks instead of
      // leaving a truncated document behind; tokens are spent only when the
      // cap is genuinely reached.
      const MAX_CONTINUATIONS = 2
      let toolSources: WebSource[] | undefined
      for (let step = 0; ; step += 1) {
        let answerRetry = 0
        let continuation = 0
        while (true) {
          const retryingAnswer = answerRetry > 0 && continuation === 0
          const messagesForChunk: StreamMessage[] =
            continuation > 0
              ? [
                  ...requestMessages,
                  { role: 'assistant', content: raw },
                  {
                    role: 'user',
                    content:
                      'Continue exactly from where you stopped. Do not repeat earlier text; finish any open code block.',
                  },
                ]
              : retryingAnswer
                ? [
                    ...requestMessages,
                    {
                      role: 'user',
                      content:
                        'Your private reasoning used the whole reply budget before any answer was written. Write the final answer now in this response. Keep it brief and do not restart your reasoning.',
                    },
                  ]
                : requestMessages
          finishReason = ''
          await streamNvidiaChat(
            {
              model: input.model.id,
              messages: messagesForChunk,
              max_tokens: answerRetry > 0 ? retryOutputBudget(outputTokens) : outputTokens,
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
          if (runIdRef.current !== runId) return
          if (finishReason !== 'length') break
          if (
            spentReasoningOnly(finishReason, raw, reasoningRaw) &&
            answerRetry < MAX_ANSWER_RETRIES
          ) {
            answerRetry += 1
            continue
          }
          if (!raw || continuation >= MAX_CONTINUATIONS) break
          continuation += 1
        }
        // Agent step: if the reply ends in a tool call, run it, hand the
        // result back and let the model carry on, up to MAX_TOOL_STEPS times.
        const call = step < MAX_TOOL_STEPS ? parseToolCall(raw) : null
        if (!call || runIdRef.current !== runId) break
        patchMessage(input.chatId, input.assistantId, {
          phase: 'routing',
          activity: toolStatus(call),
          content: rehydrateText(stripToolCalls(raw), activeRedactions),
        })
        let result = ''
        if (call.name === 'calculate') {
          result = runCalculator(call.expression)
        } else {
          const found: { context: string; sources: WebSource[]; error?: string } =
            call.name === 'search'
              ? await fetchWebSearchContext(call.query, controller.signal, TOOL_RESULT_CHARS)
              : await fetchWebContext([call.url], controller.signal, TOOL_RESULT_CHARS)
          if (runIdRef.current !== runId) return
          result = found.context || found.error || 'No results.'
          const sources = [...(toolSources ?? []), ...found.sources]
          toolSources = sources.filter((source, i) => sources.findIndex((s) => s.url === source.url) === i)
          patchMessage(input.chatId, input.assistantId, {
            webQuery: call.name === 'search' ? call.query : undefined,
            webSources: toolSources,
          })
        }
        const last = step + 1 >= MAX_TOOL_STEPS
        requestMessages.push(
          { role: 'assistant', content: raw },
          {
            role: 'user',
            content: `Tool result:\n${result}\n\n${
              last
                ? 'No more tool calls. Answer the student now with what you have.'
                : 'Continue answering the student. Call another tool only if you still need it.'
            }`,
          },
        )
        raw = ''
      }

      if (runIdRef.current !== runId) return
      flush(true)
      // The final reply can still end in a tool call once the steps run out.
      raw = stripToolCalls(raw)
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
        stats: currentStats(),
        error: emptyError,
      })
      finishRun(runId)
    } catch (error) {
      if (runIdRef.current !== runId) return
      if (controller.signal.aborted) return

      const message =
        error instanceof ChatApiError
          ? error.message
          : 'Could not reach Mint. Check your connection and try again.'

      // A limit, spam lock or ban pauses sending with a live countdown, on the
      // composer and on this failed message.
      const pause = error instanceof ChatApiError ? blockKindFor(error.code) : null
      let retryAt: number | undefined
      if (error instanceof ChatApiError && pause) {
        const fallback = pause === 'spam' ? 10 : pause === 'ban' ? 24 * 60 * 60 : 60
        startBlock(pause, error.retryAfter ?? fallback)
        retryAt = getBlock()?.until
      }

      patchMessage(input.chatId, input.assistantId, {
        content: rehydrateText(stripToolCalls(raw), activeRedactions),
        reasoning: reasoningRaw
          ? rehydrateText(reasoningRaw, activeRedactions)
          : undefined,
        phase: 'done',
        activity: undefined,
        stats: currentStats(),
        error: message,
        errorCode: pause && error instanceof ChatApiError ? error.code : undefined,
        retryAt,
      })
      finishRun(runId)
    }
  }

  /**
   * Starts a run. runAnswer reports its own request errors; this catches
   * anything thrown before that, which would otherwise leave the chat stuck
   * on "generating" with the send button disabled.
   */
  const startRun = (input: RunInput) => {
    void runAnswer(input).catch(() => {
      if (runRef.current?.messageId !== input.assistantId) return
      patchMessage(input.chatId, input.assistantId, {
        phase: 'done',
        activity: undefined,
        error: 'Something went wrong before the request was sent. Try again.',
      })
      runRef.current = null
      abortRef.current = null
      setIsGenerating(false)
      setGeneratingChatId(null)
    })
  }

  // Held from the first await in sendMessage until the run starts, so a second
  // Enter in that gap cannot start a second run on the same stale history.
  const sendingRef = useRef(false)
  const sendMessage = async (input: SendInput) => {
    if (sendingRef.current || isGenerating) return
    sendingRef.current = true
    try {
      await sendMessageNow(input)
    } finally {
      sendingRef.current = false
    }
  }

  const sendMessageNow = async ({
    text,
    attachments,
    shieldOn,
    model,
  }: SendInput) => {
    // While a limit, lock or ban is running the server would refuse anyway.
    if (getBlock()) return
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
    }

    let history = chat.messages
    const promptTokens =
      estimateTextTokens(content) +
      attachments.reduce((sum, file) => sum + attachmentTokens(file), 0) +
      10
    // Near the model's limit, summarise older turns instead of overflowing.
    if (conversationTokens(history) + promptTokens >= contextLimitTokens(model) * COMPACT_AT) {
      history = compactMessages(
        history,
        4,
        shieldOn ? conversationRedactions(history, getStoredProfile().trim()) : [],
      )
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
              messages: [...history, userMessage, assistantMessage],
            }
          : item,
      ),
    )
    setIsGenerating(true)
    setGeneratingChatId(chat.id)
    startRun({
      chatId: chat.id,
      assistantId,
      text: content,
      attachments,
      shieldOn,
      model,
      redactions: detected,
      history,
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

  const regenerate = (assistantId: string) => {
    if (isGenerating || getBlock()) return
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
    const newAssistantId = uid()
    const placeholder: ChatMessage = {
      id: newAssistantId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      phase: 'shielding',
      // The model that will answer, which differs from the old one if that was retired.
      modelId: model.id,
      shieldOn: assistant.shieldOn ?? true,
      redactions: assistant.redactions ?? [],
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
    startRun({
      chatId: chat.id,
      assistantId: newAssistantId,
      text: userMessage.content,
      attachments: userMessage.attachments ?? [],
      shieldOn: assistant.shieldOn ?? true,
      model,
      redactions: assistant.redactions ?? [],
      history: chat.messages.slice(0, userIndex),
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
  const compactChat = async () => {
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

    const controller = new AbortController()
    abortRef.current = controller
    let summary = ''
    // The shield setting is read here, as the profile is, so /compact follows it too.
    const redactions = getStoredShield()
      ? conversationRedactions(chat.messages, getStoredProfile().trim())
      : []
    try {
      summary = await compressWithModel(
        chat.messages,
        model,
        controller.signal,
        (running) => {
          if (runIdRef.current !== guard) return
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
        },
        redactions,
      )
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }

    if (runIdRef.current !== guard) {
      // Stopped or taken over: drop the progress note and keep the thread as it was.
      compactingRef.current = false
      setCompactingChatId(null)
      setChats((current) =>
        current.map((item) =>
          item.id === chat.id
            ? { ...item, messages: item.messages.filter((message) => message.id !== compactMessageId) }
            : item,
        ),
      )
      return
    }

    if (!summary.trim()) summary = localSummary(chat.messages)
    const compacted = compactedHistory(chat.messages, summary.trim(), 4, redactions)
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

  const setChatModel = (chatId: string, id: string) => {
    setChats((current) =>
      current.map((item) =>
        item.id === chatId && item.modelId !== id ? { ...item, modelId: id } : item,
      ),
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
    setChatModel,
  }
}

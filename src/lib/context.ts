import type { Model, Redaction } from './data'
import { uid, type ChatMessage } from './chat'
import type { Attachment } from './files'
import { detectRedactions, mergeRedactions, redactText } from './privacy'

/** Compact once this share of the context limit is in use. */
export const COMPACT_AT = 0.95
/**
 * Most conversation one request may carry. The proxy rejects bodies above
 * 400K characters (~100K tokens), so stay below that even on larger models.
 */
const REQUEST_TOKEN_CAP = 96_000
/** History turns per request; the proxy keeps at most 40 messages, tool steps included. */
const MAX_HISTORY_MESSAGES = 28

export type ContextContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type ContextMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | ContextContentPart[]
}

export type ContextImageBudget = {
  /** Set false when the outgoing model cannot read images. */
  enabled?: boolean
  /** Images already attached to the current turn. */
  used?: number
  /** Data-URL characters already used by the current turn. */
  chars?: number
}

/** Keeps history requests below the proxy's per-request image limits. */
const MAX_CONTEXT_IMAGES = 8
const MAX_CONTEXT_IMAGE_CHARS = 8_000_000

/** The model's advertised context window in tokens, e.g. "128K" → 131072. */
export function contextMaxTokens(model: Model): number {
  const match = /^\s*([\d.]+)\s*([KkMm])?\s*$/.exec(model.context)
  if (!match) return REQUEST_TOKEN_CAP
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return REQUEST_TOKEN_CAP
  const suffix = match[2]?.toLowerCase()
  const multiplier = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1024 : 1
  return Math.round(value * multiplier)
}

/** Tokens of conversation a request to this model may carry. */
export function contextLimitTokens(model: Model): number {
  return Math.min(contextMaxTokens(model), REQUEST_TOKEN_CAP)
}

/**
 * Answer budget (reasoning + answer combined) sent to the model. The floor is
 * high enough that a long private chain still leaves room for the answer.
 */
export const OUTPUT_TOKENS = 8192
export const MAX_OUTPUT_TOKENS = 16384

/**
 * Budget for one more attempt when a reasoner spent the whole cap on its
 * scratchpad. It grows the ceiling without exceeding what the proxy allows.
 */
export function retryOutputBudget(outputTokens: number): number {
  const raised = Math.max(outputTokens + 4096, Math.round(outputTokens * 1.5))
  return Math.min(MAX_OUTPUT_TOKENS, Math.max(OUTPUT_TOKENS, raised))
}

/**
 * A reasoning model that exhausts the output budget without streaming any
 * answer, so a retry with a direct-answer nudge is worth one attempt.
 */
export function spentReasoningOnly(
  finishReason: string,
  answer: string,
  reasoning: string,
): boolean {
  return finishReason === 'length' && !answer.trim() && Boolean(reasoning.trim())
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * Text files cost their contents. Images cost roughly one token per 750
 * pixels. An image whose data URL is gone (e.g. stripped for storage) can't
 * be sent, so it only costs its name marker.
 */
export function attachmentTokens(file: Attachment): number {
  if (file.kind === 'image') {
    if (!file.dataUrl) return estimateTextTokens(file.name ?? 'image') + 2
    if (file.width && file.height) {
      return Math.max(256, Math.min(4096, Math.ceil((file.width * file.height) / 750)))
    }
    return 1600
  }
  if (file.text) return estimateTextTokens(file.text)
  return file.name ? estimateTextTokens(file.name) : 0
}

const tokenCache = new WeakMap<ChatMessage, number>()

export function messageTokens(message: ChatMessage): number {
  // Message objects are replaced only when their content changes, so cached
  // counts stay valid and streaming updates avoid re-counting the whole thread.
  const cached = tokenCache.get(message)
  if (cached !== undefined) return cached
  const files =
    message.attachments?.reduce((sum, file) => sum + attachmentTokens(file), 0) ?? 0
  const total = estimateTextTokens(message.content) + files + 6
  tokenCache.set(message, total)
  return total
}

/**
 * Cost used to fit context into the text budget. Images are accounted for by
 * the separate image allowance, which resends history pictures as image
 * parts, so they shouldn't eat the text budget and crowd out the conversation.
 */
function pickCost(message: ChatMessage): number {
  const usableImageCost = (message.attachments ?? []).reduce(
    (sum, file) => (file.kind === 'image' && file.dataUrl ? sum + attachmentTokens(file) : sum),
    0,
  )
  return Math.max(1, messageTokens(message) - usableImageCost)
}

/** Full text of a turn, including contents of files sent with it. */
export function messageContextText(message: ChatMessage): string {
  const files = message.attachments ?? []
  if (!files.length) return message.content

  const parts: string[] = []
  if (message.content) parts.push(message.content)
  for (const file of files) {
    if (file.text) {
      parts.push(`Attached file "${file.name}":\n${file.text}`)
    } else if (file.kind === 'image') {
      parts.push(
        file.dataUrl
          ? `[Image attached: ${file.name}]`
          : `[Image attached: ${file.name} (image unavailable)]`,
      )
    } else {
      parts.push(`[File attached: ${file.name}]`)
    }
  }
  return parts.join('\n\n')
}

export function conversationTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + messageTokens(message), 0)
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}K`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return String(Math.max(0, Math.round(tokens)))
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Deterministic fallback summary used when no live model is available. */
export function localSummary(messages: ChatMessage[]): string {
  const lines: string[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      lines.push(`Context: ${oneLine(message.content).slice(0, 300)}`)
      continue
    }
    const label = message.role === 'user' ? 'User' : 'Assistant'
    const text = oneLine(message.content)
    const attachmentText = oneLine(
      message.attachments?.map((file) => file.text).filter(Boolean).join(' ') ?? '',
    )
    const combined = [text, attachmentText].filter(Boolean).join(' ')
    if (!combined) {
      const files = message.attachments?.map((file) => file.name).join(', ')
      if (files) lines.push(`${label} shared: ${files}`)
      continue
    }
    lines.push(`${label}: ${combined.slice(0, 240)}${combined.length > 240 ? '…' : ''}`)
  }
  return lines.join('\n').slice(0, 2400)
}

/**
 * Every identifier to shield in a request that carries `messages`: the ones
 * found for this turn (`primary`, whose placeholders stay as they are), those
 * saved on earlier turns and summaries, and a fresh scan of what the student
 * typed before (and their profile) in case a turn ran with the shield off.
 * Assistant text is not scanned: prose is full of capitalised pairs that are
 * not people.
 */
export function conversationRedactions(
  messages: ChatMessage[],
  profile = '',
  primary: Redaction[] = [],
): Redaction[] {
  const typed = [profile, ...messages.filter((m) => m.role === 'user').map(messageContextText)]
    .join('\n\n')
    .slice(0, 160_000)
  return mergeRedactions(primary, messages.flatMap((m) => m.redactions ?? []), detectRedactions(typed))
}

/** Shields every text part of an outgoing message list; images pass through. */
export function redactContextMessages(
  messages: ContextMessage[],
  redactions: Redaction[],
): ContextMessage[] {
  if (!redactions.length) return messages
  return messages.map((message) => ({
    ...message,
    content:
      typeof message.content === 'string'
        ? redactText(message.content, redactions)
        : message.content.map((part) =>
            part.type === 'text' ? { ...part, text: redactText(part.text, redactions) } : part,
          ),
  }))
}

/**
 * Replaces older turns with one summary note. The note keeps every redaction
 * the dropped turns carried (plus `redactions`, found while summarising), so
 * the names the summary mentions are still shielded on later requests.
 */
export function compactedHistory(
  messages: ChatMessage[],
  summary: string,
  keep = 4,
  redactions: Redaction[] = [],
): ChatMessage[] {
  const existing = messages.find((message) => message.role === 'system')
  const normal = messages.filter((message) => message.role !== 'system')
  const tail = normal.slice(-keep)
  const carried = mergeRedactions(redactions, messages.flatMap((message) => message.redactions ?? []))
  const notice: ChatMessage = {
    id: uid(),
    role: 'system',
    content: `Earlier conversation compressed to save context:\n\n${summary}`.trim(),
    createdAt: Date.now(),
    ...(carried.length ? { redactions: carried } : {}),
  }
  const combined = existing
    ? `${existing.content}\n\n${summary}`.slice(0, 3200)
    : notice.content
  return [
    { ...notice, content: combined },
    ...tail,
  ]
}

/** Replaces old turns with a compact summary so a request fits the window. */
export function compactMessages(
  messages: ChatMessage[],
  keep = 4,
  redactions: Redaction[] = [],
): ChatMessage[] {
  if (messages.length <= keep + 1) return messages
  const older = messages.slice(0, messages.length - keep)
  const summary = localSummary(older)
  if (!summary.trim()) return messages.slice(-keep)
  return compactedHistory(messages, summary, keep, redactions)
}

/**
 * Picks the newest turns that fit inside `budget`. A system summary (if the
 * chat has one) is always kept at the front. Recent images from those turns
 * are resent as image parts so follow-ups can still see them.
 */
export function buildContextMessages(
  messages: ChatMessage[],
  budget: number,
  imageBudget: ContextImageBudget = {},
): ContextMessage[] {
  const summary = messages.filter((message) => message.role === 'system')
  const normal = messages.filter((message) => message.role !== 'system')
  const picked: ChatMessage[] = []
  const total = Math.max(64, budget)
  let left = total

  // The summary is paid for first, so the turns picked below fit what is left.
  const summaryText = summary
    .map((message) => message.content)
    .join('\n\n')
    .slice(0, Math.max(400, Math.round(total)))
  if (summaryText) left = Math.max(64, left - estimateTextTokens(summaryText))

  for (let index = normal.length - 1; index >= 0; index -= 1) {
    const message = normal[index]
    const cost = pickCost(message)
    if (picked.length >= MAX_HISTORY_MESSAGES) break
    if (cost > left && picked.length > 0) break
    picked.unshift(message)
    left -= cost
  }

  // Spend the remaining image allowance on the most recent pictures first.
  const historyImages = new Map<string, string[]>()
  let imageCount = imageBudget.used ?? 0
  let imageChars = imageBudget.chars ?? 0
  const imagesAllowed = imageBudget.enabled !== false
  for (let index = picked.length - 1; imagesAllowed && index >= 0; index -= 1) {
    const message = picked[index]
    const urls = (message.attachments ?? [])
      .filter((file) => file.kind === 'image' && Boolean(file.dataUrl))
      .map((file) => file.dataUrl as string)
    if (!urls.length) continue

    const included: string[] = []
    for (const url of urls) {
      if (imageCount >= MAX_CONTEXT_IMAGES) break
      if (imageChars + url.length > MAX_CONTEXT_IMAGE_CHARS) break
      included.push(url)
      imageCount += 1
      imageChars += url.length
    }
    if (included.length) historyImages.set(message.id, included)
  }

  const selected: ContextMessage[] = []
  if (summaryText) selected.push({ role: 'system', content: summaryText })

  // Every picked turn already fits the budget, so only a single oversized
  // newest turn is ever cut here.
  const maxChars = Math.max(200, total * 4)
  for (const message of picked) {
    const content = messageContextText(message).slice(0, maxChars)
    const images = historyImages.get(message.id)
    if (images?.length) {
      selected.push({
        role: message.role,
        content: [
          { type: 'text', text: content },
          ...images.map<ContextContentPart>((url) => ({
            type: 'image_url',
            image_url: { url },
          })),
        ],
      })
    } else {
      selected.push({ role: message.role, content })
    }
  }

  return selected
}

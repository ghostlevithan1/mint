import type { Model } from './data'
import { uid, type ChatMessage } from './chat'
import type { Attachment } from './files'

/** Every chat starts with a small window and doubles until the model limit. */
export const CONTEXT_START = 2048
/** Compact once this share of the current window is in use. */
export const COMPACT_AT = 0.95

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

export function contextMaxTokens(model: Model): number {
  const match = /^\s*([\d.]+)\s*([KkMm])?\s*$/.exec(model.context)
  if (!match) return CONTEXT_START
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return CONTEXT_START
  const suffix = match[2]?.toLowerCase()
  const multiplier = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1024 : 1
  return Math.max(CONTEXT_START, Math.round(value * multiplier))
}

export function initialContextWindow(maxTokens: number): number {
  return Math.min(CONTEXT_START, maxTokens)
}

/** Next power of two at or above `current`, capped by the model maximum. */
export function growContextWindow(current: number, maxTokens: number): number {
  if (current >= maxTokens) return maxTokens
  let power = CONTEXT_START
  while (power <= current) power *= 2
  return Math.min(power, maxTokens)
}

export function clampContextWindow(window: number | undefined, model: Model): number {
  const max = contextMaxTokens(model)
  const current = Math.round(window ?? initialContextWindow(max))
  return Math.max(initialContextWindow(max), Math.min(current, max))
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * Text files cost their contents. Images cost roughly one token per 750
 * pixels, falling back to a fixed estimate when dimensions are unavailable.
 */
export function attachmentTokens(file: Attachment): number {
  if (file.kind === 'image') {
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
      parts.push(`[Image attached: ${file.name}]`)
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

export function compactedHistory(
  messages: ChatMessage[],
  summary: string,
  keep = 4,
): ChatMessage[] {
  const existing = messages.find((message) => message.role === 'system')
  const normal = messages.filter((message) => message.role !== 'system')
  const tail = normal.slice(-keep)
  const notice: ChatMessage = {
    id: uid(),
    role: 'system',
    content: `Earlier conversation compressed to save context:\n\n${summary}`.trim(),
    createdAt: Date.now(),
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
export function compactMessages(messages: ChatMessage[], keep = 4): ChatMessage[] {
  if (messages.length <= keep + 1) return messages
  const older = messages.slice(0, messages.length - keep)
  const summary = localSummary(older)
  if (!summary.trim()) return messages.slice(-keep)
  return compactedHistory(messages, summary, keep)
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
  let left = Math.max(64, budget)

  for (let index = normal.length - 1; index >= 0; index -= 1) {
    const message = normal[index]
    const cost = messageTokens(message)
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
  if (summary.length) {
    const text = summary
      .map((message) => message.content)
      .join('\n\n')
      .slice(0, Math.max(400, Math.round(left * 4)))
    selected.push({ role: 'system', content: text })
    left -= estimateTextTokens(text)
  }

  for (const message of picked) {
    const maxChars = Math.max(200, left * 4)
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
    left -= estimateTextTokens(content)
    if (left <= 0) break
  }

  return selected
}

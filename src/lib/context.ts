import type { Model } from './data'
import { uid, type ChatMessage } from './chat'

/** Every chat starts with a small window and doubles until the model limit. */
export const CONTEXT_START = 2048
/** Compact once this share of the current window is in use. */
export const COMPACT_AT = 0.95

export type ContextMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

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

export function messageTokens(message: ChatMessage): number {
  const files = message.attachments?.reduce((sum, file) => sum + file.name.length, 0) ?? 0
  return estimateTextTokens(message.content) + Math.ceil(files / 4) + 6
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
    if (!text) {
      const files = message.attachments?.map((file) => file.name).join(', ')
      if (files) lines.push(`${label} shared: ${files}`)
      continue
    }
    lines.push(`${label}: ${text.slice(0, 240)}${text.length > 240 ? '…' : ''}`)
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
 * chat has one) is always kept at the front.
 */
export function buildContextMessages(
  messages: ChatMessage[],
  budget: number,
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

  const selected: ContextMessage[] = []
  if (summary.length) {
    const text = summary.map((message) => message.content).join('\n\n')
    selected.push({
      role: 'system',
      content: text.slice(0, Math.max(400, Math.round(left * 4))),
    })
    left -= estimateTextTokens(selected[0].content)
  }

  for (const message of picked) {
    const maxChars = Math.max(200, left * 4)
    const content = message.content.slice(0, maxChars)
    selected.push({ role: message.role, content })
    left -= estimateTextTokens(content)
    if (left <= 0) break
  }

  return selected
}

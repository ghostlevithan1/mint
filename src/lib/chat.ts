import type { Model, Redaction } from './data'
import type { Attachment } from './files'

export type Phase = 'shielding' | 'routing' | 'generating' | 'done'

export type GenerationStats = {
  tps: number
  ttft: number
  tokens: number
  elapsed: number
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  attachments?: Attachment[]
  modelId?: string
  redactions?: Redaction[]
  shieldOn?: boolean
  stats?: GenerationStats
  phase?: Phase
  /** What a running tool is doing, shown while the agent works. */
  activity?: string
  stopped?: boolean
  redactionCount?: number
  /** Reasoning models may stream a scratchpad before the answer. */
  reasoning?: string
  error?: string
  /** The server's error code, when it matters to the page (a limit, a lock, a ban). */
  errorCode?: string
  /** Epoch ms when a limit, lock or ban on this failure ends, for its live countdown. */
  retryAt?: number
  webSources?: WebSource[]
  /** Query used when this turn ran a web search, empty if it only read links. */
  webQuery?: string
  /** Requested model that answered from the default model instead. */
  fallbackFrom?: string
}

export type WebSource = {
  url: string
  title: string
}

export type Conversation = {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  /** Last model used to send in this chat. */
  modelId?: string
}

export function uid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function buildChatTitle(text: string, attachments: Attachment[]) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean) return clean.length > 48 ? `${clean.slice(0, 48).trimEnd()}…` : clean
  if (attachments.length === 1) return `Review ${attachments[0].name}`
  if (attachments.length > 1) return `Review ${attachments.length} files`
  return 'New chat'
}

export function modelById(models: Model[], id?: string) {
  return models.find((model) => model.id === id) ?? models[0]
}

import type { Model, Redaction } from './data'
import type { Attachment } from './files'
import type { ProviderMode } from './provider'

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
  stopped?: boolean
  redactionCount?: number
  provider?: ProviderMode
  /** Reasoning models may stream a scratchpad before the answer. */
  reasoning?: string
  error?: string
  webSources?: WebSource[]
  /** Query used when this turn ran a web search, empty if it only read links. */
  webQuery?: string
  /** Web-search failure note; the answer still streams from model knowledge. */
  webError?: string
  /** True when this turn ran with the composer's web search toggle on. */
  webSearch?: boolean
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
  /** Model used for the most recent send, kept until the next send after a switch. */
  previousModelId?: string
  /** Tokens this chat may send per request, grown by powers of two. */
  contextWindow?: number
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

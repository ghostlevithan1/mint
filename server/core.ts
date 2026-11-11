import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
export const MAX_BODY_BYTES = 8_000_000
const MAX_MESSAGE_CHARS = 60_000
const MAX_TOTAL_CHARS = 400_000
const MAX_MESSAGES = 40
const MAX_IMAGES = 5
const MAX_IMAGE_CHARS = 1_600_000
const MAX_IMAGE_TOTAL_CHARS = 7_000_000
const MAX_PARTS_PER_MESSAGE = 8
const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i

type Role = 'user' | 'assistant' | 'system'
type UpstreamContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
type UpstreamMessage = { role: Role | 'system'; content: string | UpstreamContentPart[] }
export type JsonRecord = Record<string, unknown>

export const DEFAULT_APP_MODEL = 'minimax-flash'

// App model IDs grouped by intelligence tier: Quick, Normal, Intelligent.
const DEFAULT_MODEL_IDS: Record<string, string> = {
  'nemotron-lightning': 'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nemotron-nano-omni': 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'laguna-xs': 'poolside/laguna-xs-2.1',
  'minimax-flash': 'minimaxai/minimax-m3.1-flash',
  'muse-glimmer': 'meta/muse-glimmer-30b',
  'mistral-large-4': 'mistralai/mistral-large-4-1t-a52b',
  'nemotron-super-vl': 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  'nemotron-ultra': 'nvidia/nemotron-3-ultra-550b-a55b',
  'deepseek-flash': 'deepseek-ai/deepseek-v4.1-flash',
}

// Only these app models accept inline images. Keep in sync with src/lib/data.ts.
const VISION_MODEL_IDS = new Set(['nemotron-nano-omni', 'nemotron-super-vl'])

export type StatusPayload = {
  provider: 'nvidia' | 'demo'
  configured: boolean
  endpoint: string
  models: Record<string, string>
}

function overrideEnvName(id: string) {
  return `NVIDIA_MODEL_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
}

const SYSTEM_PROMPT = `You are Mint, a private AI assistant in a security-focused workspace.
Answer the user's latest message directly and helpfully.
Use GitHub-flavored Markdown when it improves clarity.
If attached file context is included, ground the answer in it and say when the context is incomplete.
Do not invent sources, statistics, or file contents.
Never claim to have executed code, accessed the internet, or read files that are not included in the message.`

export class HttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

function readEnvFile(path: string): Record<string, string> {
  const values: Record<string, string> = {}
  let raw = ''
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return values
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_ .-]*?)\s*[:=]\s*(.*)$/)
    if (!match) continue
    const name = match[1].trim()
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/, '').trim()
    }
    values[name] = value
  }

  return values
}

function cleanKey(value: string): string {
  const key = value.trim().replace(/^["']|["']$/g, '').trim()
  if (!key || /\s/.test(key) || key.length < 16) return ''
  if (/^(?:key_place_holder|your[_-]?key|replace[_-]?me|changeme|placeholder|example)$/i.test(key)) {
    return ''
  }
  return key
}

function extractKey(raw: string): string {
  const patterns = [
    /API\s*KEY\s*[:=]\s*["']?([^"'\r\n]+)["']?/i,
    /NVIDIA_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/i,
    /\b(nvapi-[A-Za-z0-9_-]{16,})\b/,
  ]

  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (!match?.[1]) continue
    const key = cleanKey(match[1])
    if (key) return key
  }

  return cleanKey(raw)
}

export function loadServerKey(root = process.cwd()): string {
  const fromProcess = cleanKey(process.env.NVIDIA_API_KEY ?? '')
  if (fromProcess) return fromProcess

  for (const file of ['.env.local', '.env']) {
    const values = readEnvFile(resolve(root, file))
    const fromEnv = cleanKey(values.NVIDIA_API_KEY ?? values['API KEY'] ?? '')
    if (fromEnv) return fromEnv
  }

  try {
    return extractKey(readFileSync(resolve(root, 'key'), 'utf8'))
  } catch {
    return ''
  }
}

function cleanModelId(value: string): string {
  const id = value.trim()
  if (!id || id.length > 160 || /[\s"'\\]/.test(id)) return ''
  return id
}

export function getModelIds(root = process.cwd()): Record<string, string> {
  const env: Record<string, string> = {
    ...readEnvFile(resolve(root, '.env')),
    ...readEnvFile(resolve(root, '.env.local')),
  }
  const ids: Record<string, string> = {}

  for (const [id, fallback] of Object.entries(DEFAULT_MODEL_IDS)) {
    const name = overrideEnvName(id)
    ids[id] = cleanModelId(process.env[name] ?? env[name] ?? '') || fallback
  }

  return ids
}

export function getStatusPayload(root = process.cwd()): StatusPayload {
  const configured = Boolean(loadServerKey(root))
  return {
    provider: configured ? 'nvidia' : 'demo',
    configured,
    endpoint: 'integrate.api.nvidia.com',
    models: getModelIds(root),
  }
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function validImageUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const url = value.trim()
  if (url.length < 32 || url.length > MAX_IMAGE_CHARS) return ''
  if (!IMAGE_DATA_URL.test(url) || /\s/.test(url)) return ''
  return url
}

function normalizeMessages(value: unknown): UpstreamMessage[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'BAD_REQUEST', 'messages must be an array.')
  }

  const messages: UpstreamMessage[] = []
  let totalText = 0
  let totalImageChars = 0
  let imageCount = 0

  for (const item of value.slice(-MAX_MESSAGES)) {
    if (!item || typeof item !== 'object') continue
    const record = item as JsonRecord
    const role = record.role
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue

    if (typeof record.content === 'string') {
      const text = record.content.trim().slice(0, MAX_MESSAGE_CHARS)
      if (!text) continue
      totalText += text.length
      messages.push({ role, content: text })
      continue
    }

    if (!Array.isArray(record.content)) continue

    const parts: UpstreamContentPart[] = []
    for (const rawPart of record.content.slice(0, MAX_PARTS_PER_MESSAGE)) {
      if (!rawPart || typeof rawPart !== 'object') continue
      const part = rawPart as JsonRecord

      if (part.type === 'text') {
        if (typeof part.text !== 'string') continue
        const text = part.text.trim().slice(0, MAX_MESSAGE_CHARS)
        if (!text) continue
        totalText += text.length
        parts.push({ type: 'text', text })
        continue
      }

      if (part.type !== 'image_url' || imageCount >= MAX_IMAGES) continue
      const image = part.image_url
      const url =
        image && typeof image === 'object'
          ? validImageUrl((image as JsonRecord).url)
          : ''
      if (!url || totalImageChars + url.length > MAX_IMAGE_TOTAL_CHARS) continue
      imageCount += 1
      totalImageChars += url.length
      parts.push({ type: 'image_url', image_url: { url } })
    }

    if (parts.length) messages.push({ role, content: parts })
  }

  if (!messages.length) {
    throw new HttpError(400, 'BAD_REQUEST', 'At least one user message is required.')
  }

  if (totalText > MAX_TOTAL_CHARS) {
    throw new HttpError(413, 'CONTEXT_TOO_LARGE', 'Message context is too large.')
  }

  return messages
}

function numberIn(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function sanitizeError(text: string, key: string) {
  let clean = text
  if (key) clean = clean.split(key).join('[redacted]')
  return clean
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280)
}

export async function createChatResponse(
  body: unknown,
  options: { root?: string; signal?: AbortSignal } = {},
): Promise<Response> {
  const root = options.root ?? process.cwd()
  const key = loadServerKey(root)

  if (!key) {
    return jsonResponse(503, {
      error: {
        code: 'NO_KEY',
        message: 'Live inference is not configured on the server.',
      },
    })
  }

  try {
    const record = body && typeof body === 'object' ? (body as JsonRecord) : {}
    const messages = normalizeMessages(record.messages)
    const ids = getModelIds(root)
    const requested = typeof record.model === 'string' ? record.model : ''
    const model = ids[requested] ?? ids[DEFAULT_APP_MODEL]
    const hasImages = messages.some(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === 'image_url'),
    )

    if (hasImages && !VISION_MODEL_IDS.has(requested)) {
      throw new HttpError(
        400,
        'MODEL_NO_VISION',
        'That model cannot read images. Choose a vision model in Quick or Intelligent.',
      )
    }

    const payload = {
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      temperature: numberIn(record.temperature, 0, 1.5, 0.6),
      top_p: 0.95,
      max_tokens: Math.round(numberIn(record.max_tokens, 128, 4096, 1600)),
      stream: true,
    }

    const upstream = await fetch(NVIDIA_URL, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
      signal: options.signal,
    })

    if (!upstream.ok) {
      const detail = sanitizeError(await upstream.text(), key)
      if (upstream.status === 401 || upstream.status === 403) {
        throw new HttpError(
          401,
          'INVALID_KEY',
          'NVIDIA rejected the server API key. Replace the key and reload.',
        )
      }
      if (upstream.status === 429) {
        throw new HttpError(
          429,
          'RATE_LIMITED',
          'NVIDIA is rate limiting this key. Wait a moment and try again.',
        )
      }
      throw new HttpError(
        502,
        'UPSTREAM_ERROR',
        `NVIDIA returned ${upstream.status}${detail ? `: ${detail}` : '.'}`,
      )
    }

    const contentType = upstream.headers.get('content-type') ?? ''
    if (!upstream.body || (contentType && !contentType.includes('text/event-stream'))) {
      const detail = sanitizeError(await upstream.text(), key)
      throw new HttpError(
        502,
        'UPSTREAM_FORMAT',
        `NVIDIA returned an unexpected response${detail ? `: ${detail}` : '.'}`,
      )
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Mint-Provider': 'nvidia',
        'X-Mint-Model': model,
      },
    })
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse(error.status, {
        error: { code: error.code, message: error.message },
      })
    }

    if (error instanceof Error && error.name === 'AbortError') {
      return new Response(null, { status: 499 })
    }

    const detail = sanitizeError(error instanceof Error ? error.message : '', key)
    return jsonResponse(502, {
      error: {
        code: 'UPSTREAM_UNREACHABLE',
        message: `Could not reach NVIDIA${detail ? `: ${detail}` : '.'}`,
      },
    })
  }
}

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
export const MAX_BODY_BYTES = 16_000_000
const MAX_MESSAGE_CHARS = 60_000
const MAX_TOTAL_CHARS = 400_000
const MAX_MESSAGES = 40
const MAX_IMAGES = 10
const MAX_IMAGE_CHARS = 1_600_000
const MAX_IMAGE_TOTAL_CHARS = 12_500_000
const MAX_PARTS_PER_MESSAGE = MAX_IMAGES + 2
const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp);base64,/i

// Output budget bounds; keep in sync with src/lib/context.ts.
const MIN_OUTPUT_TOKENS = 8192
const MAX_OUTPUT_TOKENS = 16384

type Role = 'user' | 'assistant' | 'system'
type UpstreamContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
type UpstreamMessage = { role: Role | 'system'; content: string | UpstreamContentPart[] }
export type JsonRecord = Record<string, unknown>

export const DEFAULT_APP_MODEL = 'nemotron-nano-omni'

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
  webReaders?: string[]
}

function overrideEnvName(id: string) {
  return `NVIDIA_MODEL_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
}

export const SYSTEM_PROMPT = `You are Mint, a patient tutor for school students. Your job is to help them understand, not just to hand over answers.

How to teach
- Lead with the key idea in one or two plain sentences, then build on it. Short paragraphs, one idea at a time.
- Use everyday words. When a technical term matters, use it and define it the first time.
- Match the student's level. If they told you about themselves, pitch the explanation to that. If you cannot tell, aim for a 14-year-old and adjust when they reply.
- Show the method, not just the result. For maths and science, work through a real example step by step and say why each step happens.
- For homework or exam questions, guide first: give a hint or the next step and let them try. Give the full worked solution when they ask for it, are stuck after trying, or want their answer checked. Never write a whole essay or assignment for them to hand in; help them plan, outline and improve their own draft instead.
- When checking their working, point to the first step that goes wrong and explain the mistake.
- After explaining a new concept, end with one short question that checks understanding. Skip it for quick factual answers.
- To quiz them, ask one question at a time, wait for the answer, say whether it is right and why, then move on.
- Reply in the language the student writes in. Keep the tone warm and direct, never condescending, no filler.
- Your reply has a limited budget, shared by your private reasoning and the answer. Spend at most about a third of it on private reasoning, then start writing: put the key idea first and finish cleanly instead of starting sections you cannot complete.

Teach visually
Reach for a picture whenever it explains faster than words: a graph for any function or data, a diagram for any process, cycle or structure, a table for comparisons.

Graphs: emit a fenced code block with the language "plot" containing one valid JSON object and nothing else (no comments, trailing commas, or prose inside the fence).

Equation curve:
\`\`\`plot
{"chart":"line","title":"y = x² − 2x − 3","xRange":[-3,5],"equations":[{"expr":"x^2 - 2*x - 3","label":"y = x² − 2x − 3"}],"points":[{"x":-1,"y":0,"label":"root x = −1"},{"x":3,"y":0,"label":"root x = 3"},{"x":1,"y":-4,"label":"vertex (1, −4)"}]}
\`\`\`
Data points:
\`\`\`plot
{"chart":"scatter","title":"Height vs age","xLabel":"Age (years)","yLabel":"Height (cm)","series":[{"label":"Students","x":[12,13,14,15],"y":[148,156,161,168]}]}
\`\`\`
Bar chart:
\`\`\`plot
{"chart":"bar","title":"Quarterly revenue","yLabel":"USD (thousands)","series":[{"label":"Revenue","x":["Q1","Q2","Q3","Q4"],"y":[12,19,15,24]}]}
\`\`\`
Histogram:
\`\`\`plot
{"chart":"histogram","title":"Test scores","xLabel":"Score","data":[55,62,62,70,71,75,81,88,91,95],"bins":5}
\`\`\`
- "chart": "line" (default), "scatter", "bar" or "histogram". Line and scatter need at least one of "equations", "series" or "points"; "bar" needs one "series"; "histogram" needs "data".
- "equations": [{"expr":"...","label":"..."}] draws y = f(x). Put "y =" in "label", never in "expr". "expr" uses x only: write x^2 rather than x², and 2*x rather than 2x. Allowed names: x, pi, π, e, tau, τ, sin, cos, tan, asin, acos, atan, sinh, cosh, tanh, exp, log (natural), ln, log2, log10, sqrt, abs, floor, ceil, min, max, pow. Operators: + - * / ^ (and **) with parentheses; implicit multiplication such as 2x, 3sin(x) or 2π also works. Angles are in radians.
- "series": [{"label":"Day","x":[1,2,3],"y":[4,5,6]}] draws data. "x" and "y" must be equal-length number arrays (at most 500 each). For "bar", "x" holds up to 24 short category labels instead.
- "xRange": [min, max] (min < max) sets the visible x window for equation curves; leave a margin because readers can zoom and pan inside it. A chart made only of "series" fits the data automatically. "yRange": [min, max] is optional, mainly for tan or 1/x. Both ranges must be two numbers with min < max.
- "points": up to 12 {"x":number,"y":number,"label":"short"} markers for roots, intercepts, vertices or intersections. Use data coordinates, never pixel positions, and compute the values correctly.
- "histogram" takes "data" (a flat number array, at most 2000 values) and optional "bins" (4-100).
- "title", "xLabel" and "yLabel" are short strings, and every other label should be short too. At most 6 equations, 8 series, 12 points and 24 bar categories.
- If a detailed graph risks an error, draw a simpler valid one instead of an invalid detailed one.

Diagrams: emit a fenced code block with the language "diagram" containing one JSON object.
\`\`\`diagram
{"type":"cycle","title":"The water cycle","nodes":[{"label":"Evaporation","detail":"The sun heats water and it rises as vapour"},{"label":"Condensation","detail":"Vapour cools into droplets that form clouds"},{"label":"Precipitation","detail":"Droplets join and fall as rain or snow"},{"label":"Collection","detail":"Water gathers in rivers, lakes and seas"}]}
\`\`\`
- "type" is "steps" (a process in order, 2-9 nodes), "cycle" (something that repeats, 3-9 nodes) or "hub" (a central idea first, then 2-8 parts or examples).
- Labels are 1-3 words. Put the explanation in "detail", one sentence each.

Maths notation: write inline maths as $...$ and display equations as $$...$$ on their own lines.

Do not write plotting code, SVG, HTML or image markup for a visual; use the plot and diagram blocks. Never make up image URLs; only show an image link that appears in provided web results or files.

Facts and sources
- If attached files or web results are included, ground the answer in them and say when they do not cover the question.
- If you are not sure, say so. Do not invent facts, quotes, dates, statistics or sources.
- Never claim to have run code, browsed the web or read files that are not in the conversation.

Wellbeing
If a student seems upset, unsafe or mentions self-harm, respond kindly, take it seriously, and encourage them to talk to a trusted adult, a teacher or a local helpline. Keep content suitable for school students.`

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

      if (part.type !== 'image_url') continue
      if (imageCount >= MAX_IMAGES) {
        throw new HttpError(
          413,
          'IMAGE_LIMIT',
          `You can send up to ${MAX_IMAGES} images per message.`,
        )
      }
      const image = part.image_url
      const url =
        image && typeof image === 'object'
          ? validImageUrl((image as JsonRecord).url)
          : ''
      if (!url) {
        throw new HttpError(
          400,
          'IMAGE_INVALID',
          'An attached image could not be read. Remove it and attach a JPEG, PNG, or WebP copy.',
        )
      }
      if (totalImageChars + url.length > MAX_IMAGE_TOTAL_CHARS) {
        throw new HttpError(
          413,
          'IMAGE_TOO_LARGE',
          'The attached images are too large to send together. Remove one and try again.',
        )
      }
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

/**
 * Folds client system messages (the student's profile, a compacted summary)
 * into the one leading system prompt; several upstream models reject a second
 * system message or one after the first user turn.
 */
export function withSystemPrompt(
  messages: UpstreamMessage[],
  outputBudget?: number,
): UpstreamMessage[] {
  const extra = messages
    .filter((message) => message.role === 'system' && typeof message.content === 'string')
    .map((message) => message.content as string)
  const rest = messages.filter((message) => message.role !== 'system')
  const budget =
    typeof outputBudget === 'number' && Number.isFinite(outputBudget) && outputBudget > 0
      ? `Reply budget: your private reasoning and the answer together must fit in about ${Math.round(outputBudget)} tokens. Reserve roughly the last third for the answer: stop reasoning and start writing before you run out, and finish cleanly before the cap.`
      : ''
  return [
    { role: 'system', content: [SYSTEM_PROMPT, budget, ...extra].filter(Boolean).join('\n\n') },
    ...rest,
  ]
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

    const outputBudget = Math.round(
      numberIn(record.max_tokens, 128, MAX_OUTPUT_TOKENS, MIN_OUTPUT_TOKENS),
    )
    const payload = {
      model,
      messages: withSystemPrompt(messages, outputBudget),
      temperature: numberIn(record.temperature, 0, 1.5, 0.6),
      top_p: 0.95,
      max_tokens: outputBudget,
      stream: true,
    }

    const controller = new AbortController()
    const abortUpstream = () => controller.abort()
    options.signal?.addEventListener('abort', abortUpstream, { once: true })
    if (options.signal?.aborted) controller.abort()
    // Only the wait for response headers is bounded; a long stream may run on.
    const headerTimer = setTimeout(() => controller.abort(), 60_000)

    const requestUpstream = (modelId: string) =>
      fetch(NVIDIA_URL, {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ ...payload, model: modelId }),
        signal: controller.signal,
      })

    let upstream: Response
    let usedModel = model
    try {
      upstream = await requestUpstream(model)
      // A retired or renamed upstream model answers 404/410. Retry once on the
      // default model so a stale catalog entry never breaks a conversation.
      if (
        (upstream.status === 404 || upstream.status === 410) &&
        model !== ids[DEFAULT_APP_MODEL]
      ) {
        await upstream.body?.cancel().catch(() => undefined)
        usedModel = ids[DEFAULT_APP_MODEL]
        upstream = await requestUpstream(usedModel)
      }
    } catch (error) {
      if (controller.signal.aborted && !options.signal?.aborted) {
        throw new HttpError(
          504,
          'MODEL_TIMEOUT',
          'The selected model did not start responding within 60 seconds. Try again or switch models.',
        )
      }
      throw error
    } finally {
      clearTimeout(headerTimer)
      options.signal?.removeEventListener('abort', abortUpstream)
    }

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
          'The free NVIDIA tier allows about 40 requests per minute, shared across everyone on this site. Wait ~60 seconds and try again, or switch to a lighter model (Quick or Normal).',
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
        'X-Mint-Model': usedModel,
        ...(usedModel === model ? {} : { 'X-Mint-Fallback': model }),
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

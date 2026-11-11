import type { WebSource } from './chat'

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/
const MAX_LINKS = 3
const READ_TIMEOUT_MS = 12_000

export type WebPage = {
  url: string
  title: string
  text: string
  truncated: boolean
}

export type WebContext = {
  sources: WebSource[]
  context: string
}

/** Pulls distinct http(s) links out of a prompt, ignoring trailing punctuation. */
export function extractUrls(text: string): string[] {
  const found = text.match(URL_PATTERN) ?? []
  const cleaned: string[] = []
  for (const raw of found) {
    const candidate = raw.replace(TRAILING_PUNCTUATION, '')
    try {
      const url = new URL(candidate)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      if (!url.hostname) continue
      const normalized = url.toString()
      if (!cleaned.includes(normalized)) cleaned.push(normalized)
    } catch {
      // Ignore text that only looks like a link.
    }
  }
  return cleaned.slice(0, MAX_LINKS)
}

export async function readWebPage(url: string, signal?: AbortSignal): Promise<WebPage> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), READ_TIMEOUT_MS)
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort)
  try {
    const response = await fetch('/api/web', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as {
        error?: { message?: string }
      } | null
      throw new Error(detail?.error?.message ?? `That link could not be read (${response.status}).`)
    }
    return (await response.json()) as WebPage
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

/** Reads every link in parallel and folds the pages into a prompt-ready brief. */
export async function fetchWebContext(
  urls: string[],
  signal?: AbortSignal,
  maxChars = 18_000,
): Promise<WebContext> {
  if (!urls.length) return { sources: [], context: '' }

  const results = await Promise.allSettled(
    urls.map((url) => readWebPage(url, signal)),
  )
  if (signal?.aborted) return { sources: [], context: '' }

  const sources: WebSource[] = []
  const blocks: string[] = []
  const perPage = Math.max(600, Math.floor(maxChars / urls.length))

  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    const page = result.value
    const text = page.text.slice(0, perPage).trim()
    if (!text) continue
    sources.push({ url: page.url, title: page.title || page.url })
    blocks.push(`Web page: ${page.title || page.url}\nURL: ${page.url}\n\n${text}`)
  }

  return {
    sources,
    context: blocks.join('\n\n---\n\n').slice(0, maxChars),
  }
}

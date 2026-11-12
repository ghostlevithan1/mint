import { lookup } from 'node:dns/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { HttpError } from './core'
import { readJsonBody, sendJson } from './node-http'

const MAX_URL_CHARS = 2048
const MAX_BYTES = 1_500_000
const MAX_TEXT_CHARS = 14_000
const FETCH_TIMEOUT_MS = 8_000
const MAX_REDIRECTS = 3

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
])

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.localdomain']

type Page = { url: string; title: string; text: string; truncated: boolean }

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true
  }
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isBlockedIp(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isBlockedIpv4(ip)
  if (version !== 6) return true

  const value = ip.toLowerCase().split('%')[0]
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice('::ffff:'.length)
    if (isIP(mapped) === 4) return isBlockedIpv4(mapped)
  }
  return (
    value === '::' ||
    value === '::1' ||
    value === '0:0:0:0:0:0:0:0' ||
    value === '0:0:0:0:0:0:0:1' ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    value.startsWith('fe8') ||
    value.startsWith('fe9') ||
    value.startsWith('fea') ||
    value.startsWith('feb') ||
    value.startsWith('ff')
  )
}

/** Rejects local, private, and metadata addresses before any fetch happens. */
async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new HttpError(400, 'BAD_URL', 'That link is not a valid URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'BAD_PROTOCOL', 'Only http and https links can be opened.')
  }
  if (url.username || url.password) {
    throw new HttpError(400, 'BAD_URL', 'Links with embedded credentials are not allowed.')
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!host) throw new HttpError(400, 'BAD_URL', 'That link has no host name.')
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new HttpError(403, 'BLOCKED_HOST', 'That host is not available to the web reader.')
  }

  if (isIP(host)) {
    if (isBlockedIp(host)) {
      throw new HttpError(403, 'BLOCKED_HOST', 'That host is not available to the web reader.')
    }
    return url
  }

  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new HttpError(502, 'DNS_FAILED', 'That link could not be resolved.')
  }
  if (!addresses.length) {
    throw new HttpError(502, 'DNS_FAILED', 'That link could not be resolved.')
  }
  if (addresses.some((entry) => isBlockedIp(entry.address))) {
    throw new HttpError(403, 'BLOCKED_HOST', 'That host is not available to the web reader.')
  }
  return url
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith('#')) {
      const hex = code[1]?.toLowerCase() === 'x'
      const value = Number.parseInt(hex ? code.slice(2) : code.slice(1), hex ? 16 : 10)
      if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff) return match
      return String.fromCodePoint(value)
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match
  })
}

function htmlToText(html: string): string {
  const withoutHead = html.replace(/<head[\s\S]*?<\/head>/gi, ' ')
  const cleaned = withoutHead
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|template|canvas)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/section|\/article|\/li|\/tr|\/h[1-6]|\/blockquote)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ')
  const decoded = decodeEntities(cleaned)

  const lines: string[] = []
  for (const rawLine of decoded.split('\n')) {
    const line = rawLine.replace(/[ \t\f\v]+/g, ' ').trim()
    if (!line) {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('')
      continue
    }
    lines.push(line)
  }
  return lines.join('\n').trim()
}

function pageTitle(html: string, fallback: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  const raw = match?.[1] ?? heading?.[1] ?? ''
  const title = decodeEntities(raw.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
  return (title || fallback).slice(0, 200)
}

function isTextual(contentType: string): boolean {
  return /^(text\/|application\/(?:json|xml|xhtml\+xml|ld\+json|rss\+xml|atom\+xml))/i.test(
    contentType,
  )
}

async function readLimited(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new HttpError(413, 'PAGE_TOO_LARGE', 'That page is too large to read.')
      }
      chunks.push(value)
    }
  } finally {
    if (reader) await reader.cancel().catch(() => undefined)
  }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8').decode(merged)
}

async function readBuiltinPage(rawUrl: string): Promise<Page> {
  let url = await assertSafeUrl(rawUrl)
  const original = url.toString()

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.8,*/*;q=0.1',
          'user-agent': 'MintWebReader/1.0',
        },
      })
    } catch {
      throw new HttpError(502, 'FETCH_FAILED', 'That page could not be reached.')
    } finally {
      clearTimeout(timer)
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => undefined)
      if (!location) throw new HttpError(502, 'BAD_REDIRECT', 'That page redirected nowhere.')
      url = await assertSafeUrl(new URL(location, url).toString())
      continue
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new HttpError(502, 'FETCH_FAILED', `That page returned ${response.status}.`)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType && !isTextual(contentType)) {
      await response.body?.cancel().catch(() => undefined)
      throw new HttpError(415, 'UNSUPPORTED_TYPE', 'That link is not a text or HTML page.')
    }

    const body = await readLimited(response)
    const fallbackTitle = url.hostname.replace(/^www\./, '')
    const title = contentType.includes('html') || /<html|<body|<p[\s>]/i.test(body)
      ? pageTitle(body, fallbackTitle)
      : fallbackTitle
    const text =
      contentType.includes('html') || /<html|<body|<p[\s>]/i.test(body)
        ? htmlToText(body)
        : body.replace(/\r\n?/g, '\n').trim()

    return {
      url: url.toString(),
      title,
      text: text.slice(0, MAX_TEXT_CHARS),
      truncated: text.length > MAX_TEXT_CHARS || original !== url.toString(),
    }
  }

  throw new HttpError(502, 'TOO_MANY_REDIRECTS', 'That link redirected too many times.')
}

// ---- Reader cascade ----
// Page reads try the configured crawl4ai backends first and always fall back
// to the built-in reader. A backend that reports quota/auth limits is benched
// for a while instead of failing every request.
const CLOUD_BASE = 'https://api.crawl4ai.com'
const CRAWL_TIMEOUT_MS = 25_000
const BENCH_QUOTA_MS = 60 * 60 * 1000
const BENCH_RATE_MS = 30 * 1000

/** Raised when a reader is unusable for this page and the chain should continue. */
class ReaderSkip extends Error {}

type ReaderId = 'crawl4ai-cloud' | 'crawl4ai-selfhosted'
type Bench = { until: number; reason: string }
const benched = new Map<ReaderId, Bench>()

function benchReader(id: ReaderId, ms: number, reason: string): void {
  benched.set(id, { until: Date.now() + ms, reason })
}

function readerAvailable(id: ReaderId): boolean {
  const entry = benched.get(id)
  return !entry || entry.until < Date.now()
}

/** Which page readers are configured right now, for /api/status. */
export function webReaderStatus(): string[] {
  const readers: string[] = []
  if ((process.env.CRAWL4AI_KEY ?? '').trim()) {
    const bench = benched.get('crawl4ai-cloud')
    readers.push(
      readerAvailable('crawl4ai-cloud')
        ? 'crawl4ai-cloud'
        : `crawl4ai-cloud (benched: ${bench?.reason ?? 'unavailable'})`,
    )
  }
  if ((process.env.CRAWL4AI_URL ?? '').trim()) {
    const bench = benched.get('crawl4ai-selfhosted')
    readers.push(
      readerAvailable('crawl4ai-selfhosted')
        ? 'crawl4ai-selfhosted'
        : `crawl4ai-selfhosted (benched: ${bench?.reason ?? 'unavailable'})`,
    )
  }
  readers.push('builtin')
  return readers
}

/** Classifies an HTTP failure from a crawl4ai backend: bench or just skip. */
function classifyBackendFailure(status: number): { benchMs: number; message: string } {
  if (status === 401 || status === 402 || status === 403) {
    // 402 = no credits / plan cap; 401/403 = bad or unauthorized key.
    return { benchMs: BENCH_QUOTA_MS, message: `limit hit (${status})` }
  }
  if (status === 429) {
    return { benchMs: BENCH_RATE_MS, message: 'rate limited (429)' }
  }
  return { benchMs: 0, message: `unavailable (${status})` }
}

function pageFromMarkdown(url: URL, markdown: string): Page {
  const heading = /^#{1,2}\s+(.{1,200})$/m.exec(markdown)?.[1] ?? ''
  const title = (heading || url.hostname.replace(/^www\./, '')).trim()
  return {
    url: url.toString(),
    title,
    text: markdown.slice(0, MAX_TEXT_CHARS),
    truncated: markdown.length > MAX_TEXT_CHARS,
  }
}

async function readCrawl4aiCloudPage(url: URL): Promise<Page> {
  const key = (process.env.CRAWL4AI_KEY ?? '').trim()
  if (!key) throw new ReaderSkip('no CRAWL4AI_KEY configured')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CRAWL_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${CLOUD_BASE}/scrape`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: url.toString(), format: 'md' }),
    })
  } catch {
    throw new ReaderSkip('cloud unreachable or timed out')
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    const { benchMs, message } = classifyBackendFailure(response.status)
    if (benchMs) benchReader('crawl4ai-cloud', benchMs, message)
    throw new ReaderSkip(`cloud ${message}`)
  }

  const payload = (await response.json().catch(() => null)) as { ok?: boolean; markdown?: string } | null
  const markdown = typeof payload?.markdown === 'string' ? payload.markdown : ''
  if (!payload?.ok || !markdown.trim()) throw new ReaderSkip('cloud returned no markdown')
  return pageFromMarkdown(url, markdown)
}

async function readCrawl4aiSelfHostedPage(url: URL): Promise<Page> {
  const base = (process.env.CRAWL4AI_URL ?? '').trim().replace(/\/+$/, '')
  if (!base) throw new ReaderSkip('no CRAWL4AI_URL configured')
  const token = (process.env.CRAWL4AI_TOKEN ?? '').trim()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CRAWL_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${base}/md`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ url: url.toString() }),
    })
  } catch {
    throw new ReaderSkip('self-hosted server unreachable or timed out')
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    const { benchMs, message } = classifyBackendFailure(response.status)
    if (benchMs) benchReader('crawl4ai-selfhosted', benchMs, message)
    throw new ReaderSkip(`self-hosted ${message}`)
  }

  const payload = (await response.json().catch(() => null)) as { markdown?: string } | null
  const markdown = typeof payload?.markdown === 'string' ? payload.markdown : ''
  if (!markdown.trim()) throw new ReaderSkip('self-hosted returned no markdown')
  return pageFromMarkdown(url, markdown)
}

/**
 * Reads a page through the configured chain: crawl4ai Cloud, then a
 * self-hosted crawl4ai server, then the built-in reader. The first backend
 * that returns usable text wins; the built-in reader is never benched.
 */
async function fetchPage(raw: string): Promise<Page> {
  const url = await assertSafeUrl(raw)
  const chain: Array<{ id: string; read: (url: URL) => Promise<Page> }> = [
    { id: 'crawl4ai-cloud', read: readCrawl4aiCloudPage },
    { id: 'crawl4ai-selfhosted', read: readCrawl4aiSelfHostedPage },
    { id: 'builtin', read: (safe) => readBuiltinPage(safe.toString()) },
  ]
  const failures: string[] = []
  for (const reader of chain) {
    if (reader.id !== 'builtin') {
      const typed = reader.id as ReaderId
      if (!readerAvailable(typed)) continue
    }
    try {
      const page = await reader.read(url)
      if (page.text.trim()) return page
      failures.push(`${reader.id}: no readable text`)
    } catch (error) {
      failures.push(`${reader.id}: ${error instanceof ReaderSkip ? error.message : String(error)}`)
    }
  }
  throw new HttpError(502, 'FETCH_FAILED', `That page could not be read (${failures.join('; ')}).`)
}

/** Cloud /search backend for handleSearchHttp; benches like the page readers. */
async function cloudSearch(query: string): Promise<SearchResult[]> {
  const key = (process.env.CRAWL4AI_KEY ?? '').trim()
  if (!key) throw new ReaderSkip('no CRAWL4AI_KEY configured')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${CLOUD_BASE}/search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    })
  } catch {
    throw new ReaderSkip('cloud unreachable or timed out')
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    const { benchMs, message } = classifyBackendFailure(response.status)
    if (benchMs) benchReader('crawl4ai-cloud', benchMs, message)
    throw new ReaderSkip(`cloud ${message}`)
  }

  const payload = (await response.json().catch(() => null)) as
    | { results?: unknown }
    | unknown[]
    | null
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { results?: unknown })?.results)
      ? ((payload as { results: unknown[] }).results)
      : []
  const results: SearchResult[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const entry = row as { url?: unknown; title?: unknown; snippet?: unknown }
    if (typeof entry.url !== 'string' || !/^https?:\/\//i.test(entry.url)) continue
    const key2 = entry.url.replace(/\/+$/, '')
    if (seen.has(key2)) continue
    seen.add(key2)
    results.push({
      url: entry.url,
      title: typeof entry.title === 'string' && entry.title.trim() ? entry.title : entry.url,
      snippet: typeof entry.snippet === 'string' ? entry.snippet.slice(0, 400) : '',
    })
    if (results.length >= MAX_SEARCH_RESULTS) break
  }
  if (!results.length) throw new ReaderSkip('cloud search returned nothing usable')
  return results
}

async function runSearch(query: string): Promise<SearchResult[]> {
  // Crawl4AI cloud search first when a key is configured; DDG is the fallback.
  if (readerAvailable('crawl4ai-cloud')) {
    try {
      const results = await cloudSearch(query)
      if (results.length) return results
    } catch {
      // Any cloud search problem falls through to the built-in engine.
    }
  }
  // html endpoint prefers POST; lite endpoint is the lighter fallback.
  const primary = await requestSearchEngine('https://html.duckduckgo.com/html/', {
    method: 'POST',
    body: new URLSearchParams({ q: query }).toString(),
  })
  let results = parseHtmlResults(primary)
  if (results.length) return results

  const lite = await requestSearchEngine(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    method: 'GET',
  })
  results = parseLiteResults(lite)
  if (results.length) return results

  throw new HttpError(502, 'NO_RESULTS', 'The search engine returned nothing readable.')
}

const MAX_QUERY_CHARS = 300
const MAX_SEARCH_RESULTS = 8
const SEARCH_TIMEOUT_MS = 9_000
const SEARCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

export type SearchResult = { url: string; title: string; snippet: string }

/** DuckDuckGo wraps outbound links as //duckduckgo.com/l/?uddg=<encoded>; unwrap them. */
function decodeSearchHref(raw: string): string {
  let href = raw
  if (href.startsWith('//')) href = `https:${href}`
  try {
    const url = new URL(href, 'https://duckduckgo.com')
    const target = url.searchParams.get('uddg')
    return target ? decodeURIComponent(target) : url.toString()
  } catch {
    return ''
  }
}

/** Strips tags/entities from an HTML fragment into plain one-line text. */
function plainFragment(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** Parses the html.duckduckgo.com results page (class result__a / result__snippet). */
function parseHtmlResults(html: string): SearchResult[] {
  const results: SearchResult[] = []
  const seen = new Set<string>()
  const chunks = html.split(/<a[^>]*class="[^"]*result__a[^"]*"/i).slice(1)
  for (const chunk of chunks) {
    const hrefMatch = /href="([^"]+)"/.exec(chunk)
    if (!hrefMatch) continue
    const url = decodeSearchHref(hrefMatch[1])
    if (!/^https?:\/\//i.test(url)) continue
    let host = ''
    try {
      host = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      continue
    }
    if (!host || host.endsWith('duckduckgo.com')) continue
    // Title text starts after the opening <a> tag closes.
    const openEnd = chunk.indexOf('>', hrefMatch.index)
    const titleEnd = openEnd >= 0 ? chunk.indexOf('</a>', openEnd) : -1
    const title = openEnd >= 0 && titleEnd > openEnd ? plainFragment(chunk.slice(openEnd + 1, titleEnd)) : ''
    const snippetRaw = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]{0,2000}?)<\/a>/i.exec(chunk)?.[1] ?? ''
    const snippet = plainFragment(snippetRaw)
    const key = url.replace(/\/+$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    results.push({ url, title: title || host, snippet: snippet.slice(0, 400) })
    if (results.length >= MAX_SEARCH_RESULTS) break
  }
  return results
}

/** Fallback parser for lite.duckduckgo.com (result-link / result-snippet classes). */
function parseLiteResults(html: string): SearchResult[] {
  const results: SearchResult[] = []
  const seen = new Set<string>()
  const chunks = html.split(/<a[^>]*class="[^"]*result-link[^"]*"/i).slice(1)
  for (const chunk of chunks) {
    const hrefMatch = /href="([^"]+)"/.exec(chunk)
    if (!hrefMatch) continue
    const url = decodeSearchHref(hrefMatch[1])
    if (!/^https?:\/\//i.test(url)) continue
    let host = ''
    try {
      host = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      continue
    }
    if (!host || host.endsWith('duckduckgo.com')) continue
    const openEnd = chunk.indexOf('>', hrefMatch.index)
    const titleEnd = openEnd >= 0 ? chunk.indexOf('</a>', openEnd) : -1
    const title = openEnd >= 0 && titleEnd > openEnd ? plainFragment(chunk.slice(openEnd + 1, titleEnd)) : ''
    const snippetRaw = /class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]{0,2000}?)<\/td>/i.exec(chunk)?.[1] ?? ''
    const snippet = plainFragment(snippetRaw)
    const key = url.replace(/\/+$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    results.push({ url, title: title || host, snippet: snippet.slice(0, 400) })
    if (results.length >= MAX_SEARCH_RESULTS) break
  }
  return results
}

async function requestSearchEngine(
  url: string,
  init: { method: 'GET' | 'POST'; body?: string },
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: init.method,
      body: init.body,
      signal: controller.signal,
      headers: {
        accept: 'text/html',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': SEARCH_UA,
        ...(init.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new HttpError(502, 'SEARCH_FAILED', `The search engine returned ${response.status}.`)
    }
    return await readLimited(response)
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(502, 'SEARCH_FAILED', 'The search engine could not be reached.')
  } finally {
    clearTimeout(timer)
  }
}

export async function handleSearchHttp(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, {
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for this endpoint.' },
    })
    return
  }

  try {
    const body = await readJsonBody(req)
    const query = typeof body.query === 'string' ? body.query.replace(/\s+/g, ' ').trim() : ''
    if (!query || query.length > MAX_QUERY_CHARS) {
      throw new HttpError(400, 'BAD_QUERY', 'Send a search query of 1-300 characters.')
    }
    const results = await runSearch(query)
    sendJson(res, 200, { query, results })
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, {
        error: { code: error.code, message: error.message },
      })
      return
    }
    sendJson(res, 500, {
      error: { code: 'SEARCH_ERROR', message: 'Web search failed unexpectedly.' },
    })
  }
}

export async function handleWebHttp(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, {
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for this endpoint.' },
    })
    return
  }

  try {
    const body = await readJsonBody(req)
    const raw = typeof body.url === 'string' ? body.url.trim() : ''
    if (!raw || raw.length > MAX_URL_CHARS) {
      throw new HttpError(400, 'BAD_URL', 'Send one http or https link to read.')
    }
    const page = await fetchPage(raw)
    if (!page.text.trim()) {
      throw new HttpError(422, 'EMPTY_PAGE', 'That page had no readable text.')
    }
    sendJson(res, 200, page)
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, {
        error: { code: error.code, message: error.message },
      })
      return
    }
    sendJson(res, 500, {
      error: { code: 'WEB_ERROR', message: 'Could not read that page.' },
    })
  }
}

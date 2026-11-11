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

async function fetchPage(raw: string): Promise<Page> {
  let url = await assertSafeUrl(raw)
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

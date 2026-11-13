import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'

/**
 * Per-client rate limiting for the public deployment.
 *
 * The workspace is open to anyone with the link, so the only spending control
 * is this in-memory budget: 15 model calls, 60 web requests, and 30 plots per
 * minute per client IP. Limits reset on restart, which is fine — they exist
 * to stop a single visitor (or script) from draining the NVIDIA key, not to
 * meter usage over time.
 */

export const CHAT_RATE_LIMIT = 15
export const WEB_RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000

export type ApiKind = 'chat' | 'web'

const hits = new Map<string, number[]>()

// The key loader in core.ts reads .env files at request time; the limiter uses
// the same convention so `MINT_RATE_LIMIT` in .env works for `npm start` too.
let fileEnv: Record<string, string> | null = null

function envFileValues(): Record<string, string> {
  if (fileEnv) return fileEnv
  const values: Record<string, string> = {}
  for (const file of ['.env', '.env.local']) {
    let raw = ''
    try {
      raw = readFileSync(resolve(process.cwd(), file), 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*)$/)
      if (!match) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      } else {
        value = value.replace(/\s+#.*$/, '').trim()
      }
      values[match[1]] = value
    }
  }
  fileEnv = values
  return values
}

function envValue(name: string): string {
  const fromProcess = (process.env[name] ?? '').trim()
  if (fromProcess) return fromProcess
  return (envFileValues()[name] ?? '').trim()
}

/** Optional override for local testing: MINT_RATE_LIMIT=0 disables limiting. */
function chatLimit(): number {
  const raw = envValue('MINT_RATE_LIMIT')
  if (!raw) return CHAT_RATE_LIMIT
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value >= 0 ? value : CHAT_RATE_LIMIT
}

function clientAddress(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded
  const first = (raw ?? '').split(',')[0]?.trim()
  if (first) return first
  return req.socket?.remoteAddress ?? 'unknown'
}

function writeJson(res: ServerResponse, status: number, body: unknown) {
  if (res.writableEnded) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(body))
}

type RateResult = { ok: true; remaining: number } | { ok: false; retryAfter: number }

function rateLimit(key: string, limit: number): RateResult {
  if (limit <= 0) return { ok: true, remaining: Number.MAX_SAFE_INTEGER }
  const now = Date.now()
  const windowStart = now - RATE_WINDOW_MS
  const entry = hits.get(key)?.filter((stamp) => stamp > windowStart) ?? []

  if (entry.length >= limit) {
    hits.set(key, entry)
    const oldest = entry[0] ?? now
    const retryAfter = Math.max(1, Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000))
    return { ok: false, retryAfter }
  }

  entry.push(now)
  hits.set(key, entry)
  if (hits.size > 5000) {
    for (const [index, stamps] of hits) {
      if (!stamps.length || stamps[stamps.length - 1] <= windowStart) hits.delete(index)
    }
  }
  return { ok: true, remaining: Math.max(0, limit - entry.length) }
}

/**
 * Enforces the per-client request budget. Returns true when the caller may
 * continue; otherwise the response is already written.
 */
export function guardApi(req: IncomingMessage, res: ServerResponse, kind: ApiKind): boolean {
  const limit =
    kind === 'chat' ? chatLimit() : WEB_RATE_LIMIT
  const result = rateLimit(`${kind}:ip:${clientAddress(req)}`, limit)

  res.setHeader('X-RateLimit-Limit', String(limit))
  if (!result.ok) {
    res.setHeader('Retry-After', String(result.retryAfter))
    res.setHeader('X-RateLimit-Remaining', '0')
    const noun = kind === 'chat' ? 'messages' : 'web requests'
    writeJson(res, 429, {
      error: {
        code: 'CLIENT_RATE_LIMIT',
        message: `Limit reached: ${limit} ${noun} per minute per person. Try again in ${result.retryAfter} second${result.retryAfter === 1 ? '' : 's'}.`,
      },
    })
    return false
  }

  res.setHeader('X-RateLimit-Remaining', String(result.remaining))
  return true
}

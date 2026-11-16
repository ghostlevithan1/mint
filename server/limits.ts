import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { resolve } from 'node:path'
import { banStore, BAN_MS } from './bans'
import { clock } from './clock'
import { fingerprint, identifyDevice, setDeviceBan, type Device } from './device'

/**
 * Per-device usage limits for the public deployment.
 *
 * The workspace is open to anyone with the link, so these in-memory budgets are
 * the spending control. They are counted per device (the signed cookie in
 * device.ts), not per network, so a school behind one address does not share a
 * budget. Three layers sit on top of each other:
 *
 * 1. a device budget: 15 messages a minute (60 web requests);
 * 2. a network ceiling, a few times higher, so clearing cookies does not hand
 *    out unlimited use. A request with no valid cookie has no device to count,
 *    so it is counted against its network with the device budget;
 * 3. a spam lock: 1.5 messages a second sustained for 5 seconds blocks sending
 *    until the device has stopped for 10 seconds. Attempts made while locked
 *    keep it locked.
 *
 * Banned devices are turned away here first (see tamper.ts for how a ban starts).
 * Everything resets on restart, which is fine: it exists to stop one visitor
 * draining the provider keys, not to meter usage over time.
 */

export const CHAT_RATE_LIMIT = 15
export const WEB_RATE_LIMIT = 60
const REPORT_RATE_LIMIT = 30
const RATE_WINDOW_MS = 60_000
/** The network ceiling is this many times the device budget unless MINT_IP_RATE_LIMIT says otherwise. */
const NETWORK_MULTIPLE = 4

export const SPAM_RATE_PER_SECOND = 1.5
export const SPAM_WINDOW_MS = 5_000
export const SPAM_QUIET_MS = 10_000
/** Attempts inside the window that amount to 1.5 a second for 5 seconds. */
export const SPAM_THRESHOLD = Math.ceil(SPAM_RATE_PER_SECOND * (SPAM_WINDOW_MS / 1000))

export type ApiKind = 'chat' | 'web' | 'report'

const hits = new Map<string, number[]>()
const spam = new Map<string, { stamps: number[]; lockedUntil: number }>()

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

function wholeNumber(name: string): number | null {
  const raw = envValue(name)
  if (!raw) return null
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/** Optional override for local testing: MINT_RATE_LIMIT=0 disables chat limiting. */
function chatLimit(): number {
  return wholeNumber('MINT_RATE_LIMIT') ?? CHAT_RATE_LIMIT
}

function deviceLimit(kind: ApiKind): number {
  if (kind === 'chat') return chatLimit()
  return kind === 'web' ? WEB_RATE_LIMIT : REPORT_RATE_LIMIT
}

function networkLimit(kind: ApiKind): number {
  if (kind === 'report') return 0
  if (kind === 'chat') {
    const configured = wholeNumber('MINT_IP_RATE_LIMIT')
    if (configured !== null) return configured
  }
  const base = deviceLimit(kind)
  return base > 0 ? base * NETWORK_MULTIPLE : 0
}

function trustsEdgeHeaders(): boolean {
  return envValue('RENDER') === 'true' || envValue('MINT_TRUST_PROXY_HEADERS') === '1'
}

function headerAddress(req: IncomingMessage, name: string): string {
  const raw = req.headers[name]
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? ''
  return isIP(value) ? value : ''
}

/**
 * Who the request is from, for the network ceiling. A client can put anything
 * in X-Forwarded-For, so its leftmost entry is never used. On Render the edge
 * sets True-Client-IP / CF-Connecting-IP to the real visitor and overwrites any
 * client-sent copy, so those are trusted there (or when
 * MINT_TRUST_PROXY_HEADERS=1). Behind another proxy, MINT_PROXY_HOPS=n picks
 * the n-th entry from the right of X-Forwarded-For. Otherwise the socket
 * address is used.
 */
export function clientAddress(req: IncomingMessage): string {
  if (trustsEdgeHeaders()) {
    const edge = headerAddress(req, 'true-client-ip') || headerAddress(req, 'cf-connecting-ip')
    if (edge) return edge
  }

  const hops = Number.parseInt(envValue('MINT_PROXY_HOPS'), 10)
  if (Number.isInteger(hops) && hops > 0) {
    const forwarded = req.headers['x-forwarded-for']
    const entries = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? ''))
      .split(',')
      .map((entry) => entry.trim())
    const entry = entries[entries.length - hops]
    if (entry && isIP(entry)) return entry
  }

  return req.socket?.remoteAddress ?? 'unknown'
}

/** A keyed hash of the requester's network, for saved ban records. */
export function networkFingerprint(req: IncomingMessage): string {
  return fingerprint(clientAddress(req))
}

function writeJson(res: ServerResponse, status: number, body: unknown) {
  if (res.writableEnded) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(body))
}

/** "45 seconds", "2 minutes 5 seconds", "23 hours 59 minutes" */
export function describeWait(milliseconds: number): string {
  const total = Math.max(1, Math.ceil(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
  if (hours) return minutes ? `${unit(hours, 'hour')} ${unit(minutes, 'minute')}` : unit(hours, 'hour')
  if (minutes) return seconds ? `${unit(minutes, 'minute')} ${unit(seconds, 'second')}` : unit(minutes, 'minute')
  return unit(seconds, 'second')
}

/**
 * A refusal the page can act on: `retryAfter` (seconds) and `retryAt` (epoch ms)
 * let it count down live instead of showing a frozen number.
 */
function refuse(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  waitMs: number,
  extra: Record<string, unknown> = {},
): false {
  const seconds = Math.max(1, Math.ceil(waitMs / 1000))
  res.setHeader('Retry-After', String(seconds))
  writeJson(res, status, {
    error: { code, message, retryAfter: seconds, retryAt: clock.now() + waitMs, ...extra },
  })
  return false
}

function bucket(key: string, now: number): number[] {
  const stamps = (hits.get(key) ?? []).filter((stamp) => stamp > now - RATE_WINDOW_MS)
  hits.set(key, stamps)
  return stamps
}

function waitFor(stamps: number[], now: number): number {
  return Math.max(1_000, (stamps[0] ?? now) + RATE_WINDOW_MS - now)
}

/**
 * Counts an attempt and says whether the device is spamming. Past the
 * threshold the lock holds, and every attempt made while it holds extends it:
 * it ends only after SPAM_QUIET_MS of silence.
 */
function spamWait(key: string, now: number): number {
  const state = spam.get(key) ?? { stamps: [], lockedUntil: 0 }
  state.stamps = state.stamps.filter((stamp) => stamp > now - SPAM_WINDOW_MS)
  state.stamps.push(now)
  spam.set(key, state)

  if (state.lockedUntil > now) {
    state.lockedUntil = now + SPAM_QUIET_MS
    return SPAM_QUIET_MS
  }
  if (state.stamps.length >= SPAM_THRESHOLD) {
    state.stamps = []
    state.lockedUntil = now + SPAM_QUIET_MS
    return SPAM_QUIET_MS
  }
  return 0
}

function prune(now: number): void {
  if (hits.size > 5_000) {
    for (const [key, stamps] of hits) {
      if (!stamps.length || stamps[stamps.length - 1] <= now - RATE_WINDOW_MS) hits.delete(key)
    }
  }
  if (spam.size > 5_000) {
    for (const [key, state] of spam) {
      if (state.lockedUntil <= now && (state.stamps.at(-1) ?? 0) <= now - SPAM_WINDOW_MS) spam.delete(key)
    }
  }
}

/**
 * When this device's ban ends (epoch ms), or 0. The cookie and the saved record
 * are both consulted and each is brought up to date from the other, so a ban
 * survives losing the file (the cookie restores it) or the cookie being sent
 * from a fresh session that the file still knows.
 */
export function activeBanUntil(req: IncomingMessage, res: ServerResponse, device: Device): number {
  const now = clock.now()
  const stored = device.known ? banStore().find(device.id) : null
  const record = stored && !stored.liftedAt && stored.expiresAt > now ? stored : null

  // An operator's pardon beats a ban still sitting in the cookie, if it came
  // after that ban began. The cookie is then cleaned so it stops carrying it.
  const pardoned = Boolean(stored?.liftedAt && stored.liftedAt > device.banUntil - BAN_MS)
  if (pardoned && device.banUntil) setDeviceBan(req, res, device, 0)

  const until = Math.max(pardoned ? 0 : device.banUntil, record?.expiresAt ?? 0)
  if (until <= now) return 0

  if (device.banUntil < until) setDeviceBan(req, res, device, until)
  if (!stored && device.known) {
    banStore().add({
      id: device.id,
      bannedAt: Math.max(0, until - BAN_MS),
      expiresAt: until,
      signals: ['restored_from_cookie'],
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 160),
      network: networkFingerprint(req),
    })
  }
  return until
}

export function sendBanned(res: ServerResponse, until: number): false {
  const wait = Math.max(1_000, until - clock.now())
  return refuse(
    res,
    403,
    'DEVICE_BANNED',
    `This device is blocked for ${describeWait(wait)} because requests it sent had been altered.`,
    wait,
    { bannedUntil: until },
  )
}

/**
 * Enforces the budgets. Returns true when the caller may continue; otherwise
 * the response is already written.
 */
export function guardApi(req: IncomingMessage, res: ServerResponse, kind: ApiKind): boolean {
  const now = clock.now()
  const device = identifyDevice(req, res)

  const bannedUntil = activeBanUntil(req, res, device)
  if (bannedUntil) return sendBanned(res, bannedUntil)

  const limit = deviceLimit(kind)
  res.setHeader('X-RateLimit-Limit', String(limit))
  if (limit <= 0) {
    // MINT_RATE_LIMIT=0 / local testing: nothing to count.
    res.setHeader('X-RateLimit-Remaining', String(Number.MAX_SAFE_INTEGER))
    return true
  }

  const address = clientAddress(req)
  const deviceKey = device.known ? `${kind}:dev:${device.id}` : `${kind}:anon:${address}`

  if (kind === 'chat') {
    const quiet = spamWait(deviceKey, now)
    if (quiet) {
      return refuse(
        res,
        429,
        'SPAM_BLOCK',
        `You are sending messages too fast. Stop for ${describeWait(quiet)} and sending will unlock.`,
        quiet,
      )
    }
  }

  const deviceStamps = bucket(deviceKey, now)
  if (deviceStamps.length >= limit) {
    res.setHeader('X-RateLimit-Remaining', '0')
    const wait = waitFor(deviceStamps, now)
    return refuse(
      res,
      429,
      'CLIENT_RATE_LIMIT',
      `Limit reached: ${limit} ${kind === 'chat' ? 'messages' : 'requests'} per minute on this device. You can send again in ${describeWait(wait)}.`,
      wait,
    )
  }

  const ceiling = device.known ? networkLimit(kind) : 0
  const networkKey = `${kind}:net:${address}`
  if (ceiling > 0) {
    const networkStamps = bucket(networkKey, now)
    if (networkStamps.length >= ceiling) {
      const wait = waitFor(networkStamps, now)
      return refuse(
        res,
        429,
        'NETWORK_RATE_LIMIT',
        `Too many requests are coming from this network right now. Try again in ${describeWait(wait)}.`,
        wait,
      )
    }
    networkStamps.push(now)
  }

  deviceStamps.push(now)
  prune(now)
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - deviceStamps.length)))
  return true
}

/** For tests. */
export function resetLimits(): void {
  hits.clear()
  spam.clear()
  fileEnv = null
}

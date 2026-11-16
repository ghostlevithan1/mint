import type { IncomingMessage, ServerResponse } from 'node:http'
import { BAN_MS, banStore, type BanRecord } from './bans'
import { clock } from './clock'
import { identifyDevice, setDeviceBan, type Device } from './device'
import { networkFingerprint } from './limits'

/**
 * Spotting requests that were altered by hand (Inspect Element's "Edit and
 * resend", a console fetch, a script) as opposed to sent by Mint's own page.
 *
 * It looks only at the *shape* of a request: fields, types and values that the
 * real client can never produce. What a student types is never inspected, so
 * pasting code, SQL or HTML into a question cannot get anyone banned.
 *
 * Signals carry a weight. A clear forgery weighs a full ban; ambiguous ones
 * (a stale tab sending a retired model id) weigh 1, and only repeated ones
 * within ten minutes add up to a ban.
 */

export const BAN_THRESHOLD = 3
const CLEAR = 3
const STRIKE = 1
const STRIKE_WINDOW_MS = 10 * 60 * 1000
const CSP_DEBOUNCE_MS = 60 * 1000

export type TamperResult = { weight: number; signals: string[] }

const NONE: TamperResult = { weight: 0, signals: [] }

class Findings {
  weight = 0
  readonly signals: string[] = []
  add(name: string, weight: number): void {
    if (this.signals.includes(name)) return
    this.signals.push(name)
    this.weight += weight
  }
  result(): TamperResult {
    return this.weight ? { weight: this.weight, signals: this.signals } : NONE
  }
}

const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const TOP_LEVEL_KEYS = new Set(['model', 'messages', 'temperature', 'max_tokens'])
const ROLES = new Set(['user', 'assistant', 'system'])
const MAX_MESSAGES_SCANNED = 100
const MAX_PARTS_SCANNED = 50

/** An own key like "__proto__" (JSON.parse creates one) anywhere in the body. */
function hasForbiddenKey(value: unknown, depth = 0, budget = { left: 20_000 }): boolean {
  if (!value || typeof value !== 'object' || depth > 8 || budget.left-- <= 0) return false
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKey(item, depth + 1, budget))
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return true
    if (hasForbiddenKey((value as Record<string, unknown>)[key], depth + 1, budget)) return true
  }
  return false
}

/**
 * Checks a /api/chat body against what the page sends: model, messages,
 * temperature and max_tokens, where each message is {role, content} and each
 * content part is text or a data-URL image.
 */
export function inspectChatBody(body: unknown, knownModels: ReadonlySet<string>): TamperResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NONE
  const record = body as Record<string, unknown>
  const found = new Findings()

  if (hasForbiddenKey(record)) found.add('prototype_pollution', CLEAR)

  if (Object.keys(record).some((key) => !TOP_LEVEL_KEYS.has(key))) found.add('extra_fields', STRIKE)

  if ('model' in record) {
    const model = record.model
    if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) found.add('model_injection', CLEAR)
    else if (!knownModels.has(model)) found.add('unknown_model', STRIKE)
  }

  const temperature = record.temperature
  if (temperature !== undefined && (typeof temperature !== 'number' || !(temperature >= 0 && temperature <= 1.5))) {
    found.add('bad_params', STRIKE)
  }
  const maxTokens = record.max_tokens
  if (
    maxTokens !== undefined &&
    (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens < 128 || maxTokens > 16_384)
  ) {
    found.add('bad_params', STRIKE)
  }

  if ('messages' in record) {
    const messages = record.messages
    if (!Array.isArray(messages)) {
      found.add('bad_messages_type', CLEAR)
    } else {
      for (const message of messages.slice(0, MAX_MESSAGES_SCANNED)) {
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
          found.add('bad_role', CLEAR)
          continue
        }
        const item = message as Record<string, unknown>
        if (typeof item.role !== 'string' || !ROLES.has(item.role)) found.add('bad_role', CLEAR)
        if (Object.keys(item).some((key) => key !== 'role' && key !== 'content')) {
          found.add('extra_message_fields', STRIKE)
        }
        if (!Array.isArray(item.content)) continue
        for (const part of item.content.slice(0, MAX_PARTS_SCANNED)) {
          const entry = part && typeof part === 'object' ? (part as Record<string, unknown>) : null
          if (!entry || (entry.type !== 'text' && entry.type !== 'image_url')) {
            found.add('bad_part_type', CLEAR)
          } else if (entry.type === 'image_url') {
            const image = entry.image_url as { url?: unknown } | null
            const url = image && typeof image === 'object' ? image.url : undefined
            // The page only ever sends images as data: URLs; a web address here
            // would make the provider fetch it, which is how requests get redirected.
            if (typeof url !== 'string' || !/^data:/i.test(url)) found.add('external_image_url', CLEAR)
          }
        }
      }
    }
  }

  return found.result()
}

/** A path no browser sends: browsers resolve ".." before they ever request it. */
const TRAVERSAL = /(?:^|[\\/])\.\.(?:[\\/]|$)|%2e%2e|%252e|%00|\u0000|%5c/i

export function inspectPath(rawUrl: string): TamperResult {
  const path = rawUrl.split('?')[0] ?? ''
  return TRAVERSAL.test(path) ? { weight: STRIKE, signals: ['path_traversal'] } : NONE
}

/**
 * Reads a browser's CSP report. A blocked inline or eval script, or a script
 * from another site, is what an injected <script> looks like. Extensions and
 * the browser itself also cause reports, so only a repeat adds up to a ban.
 */
export function inspectCspReport(body: unknown): TamperResult {
  const report = (body as { 'csp-report'?: Record<string, unknown> } | null)?.['csp-report']
  if (!report || typeof report !== 'object') return NONE
  const directive = String(report['effective-directive'] ?? report['violated-directive'] ?? '')
  const blocked = String(report['blocked-uri'] ?? report['blockedURL'] ?? '')
  if (!directive.startsWith('script-src')) return NONE
  if (!blocked || /^(?:chrome|moz|safari|safari-web|edge|webkit-masked-url)/i.test(blocked)) return NONE
  return { weight: STRIKE, signals: ['csp_script_injection'] }
}

const strikes = new Map<string, Array<{ at: number; weight: number; signals: string[] }>>()
const lastCsp = new Map<string, number>()

function trim(map: Map<string, unknown>): void {
  if (map.size <= 5_000) return
  for (const key of map.keys()) {
    map.delete(key)
    if (map.size <= 4_000) break
  }
}

/** Bans the device for 24 hours: saved to the store and written into its cookie. */
export function banDevice(
  req: IncomingMessage,
  res: ServerResponse,
  device: Device,
  signals: string[],
): BanRecord {
  const now = clock.now()
  const record: BanRecord = {
    id: device.id,
    bannedAt: now,
    expiresAt: now + BAN_MS,
    signals,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 160),
    network: networkFingerprint(req),
  }
  banStore().add(record)
  setDeviceBan(req, res, device, record.expiresAt)
  strikes.delete(device.id)
  console.warn(`[mint] device ${device.id.slice(0, 6)}… banned for 24h: ${signals.join(', ')}`)
  return record
}

/**
 * Adds a request's findings to its device's recent strikes and bans the device
 * once they reach the threshold. A request with no valid cookie has no stable
 * identity to attach a ban to, so it is turned away without one.
 */
export function recordTamper(
  req: IncomingMessage,
  res: ServerResponse,
  result: TamperResult,
): BanRecord | null {
  if (!result.weight) return null
  const device = identifyDevice(req, res)
  if (!device.known) return null

  const now = clock.now()
  const recent = (strikes.get(device.id) ?? []).filter((item) => now - item.at < STRIKE_WINDOW_MS)
  recent.push({ at: now, weight: result.weight, signals: result.signals })
  strikes.set(device.id, recent)
  trim(strikes)

  const total = recent.reduce((sum, item) => sum + item.weight, 0)
  if (total < BAN_THRESHOLD) return null
  return banDevice(req, res, device, [...new Set(recent.flatMap((item) => item.signals))])
}

/** Path probing from a real browser (one with a device cookie). */
export function trackPathTamper(req: IncomingMessage, res: ServerResponse): void {
  const result = inspectPath(req.url ?? '/')
  if (result.weight) recordTamper(req, res, result)
}

/** A CSP report counts at most once a minute per device, so one noisy page cannot ban anyone. */
export function recordCspReport(req: IncomingMessage, res: ServerResponse, body: unknown): BanRecord | null {
  const result = inspectCspReport(body)
  if (!result.weight) return null
  const device = identifyDevice(req, res)
  const now = clock.now()
  if (now - (lastCsp.get(device.id) ?? 0) < CSP_DEBOUNCE_MS) return null
  lastCsp.set(device.id, now)
  trim(lastCsp)
  return recordTamper(req, res, result)
}

/** For tests. */
export function resetTamperState(): void {
  strikes.clear()
  lastCsp.clear()
}

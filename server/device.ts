import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'

/**
 * Telling devices apart without accounts.
 *
 * Each browser gets a random id in a signed cookie. The server can't see a
 * "device" any other way, so this is the unit that limits, spam locks and bans
 * attach to. Clearing cookies gives a fresh id, which is why the limiter also
 * keeps a looser per-network ceiling (limits.ts).
 *
 * A ban is written into the cookie itself (its expiry is covered by the
 * signature), so it holds even if the server restarts and forgets its own
 * records. That needs a secret that survives restarts: set MINT_DEVICE_SECRET.
 */

export const DEVICE_COOKIE = 'mint_device'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365
const VERSION = 'v1'

export function dataDir(): string {
  const configured = (process.env.MINT_DATA_DIR ?? '').trim()
  return configured ? resolve(configured) : resolve(process.cwd(), 'data')
}

let secret: Buffer | null = null

function deviceSecret(): Buffer {
  if (secret) return secret
  const configured = (process.env.MINT_DEVICE_SECRET ?? '').trim()
  if (configured.length >= 16) {
    secret = Buffer.from(configured)
    return secret
  }
  // No configured secret: keep one on disk so cookies survive a restart where
  // the disk does. Where it does not (a free Render instance), cookies simply
  // start over, which is harmless.
  const file = resolve(dataDir(), 'device-secret')
  try {
    const stored = readFileSync(file, 'utf8').trim()
    if (stored.length >= 32) {
      secret = Buffer.from(stored)
      return secret
    }
  } catch {
    // Not created yet.
  }
  const fresh = randomBytes(32).toString('hex')
  try {
    mkdirSync(dataDir(), { recursive: true })
    writeFileSync(file, fresh, { mode: 0o600 })
  } catch {
    // Read-only disk: the secret lives for this process only.
  }
  secret = Buffer.from(fresh)
  return secret
}

/** For tests, so a changed environment is picked up. */
export function resetDeviceSecret(): void {
  secret = null
}

function sign(payload: string): string {
  return createHmac('sha256', deviceSecret()).update(payload).digest('base64url').slice(0, 32)
}

/** A short, non-reversible tag for a value (an address) that must not be stored raw. */
export function fingerprint(value: string): string {
  return createHmac('sha256', deviceSecret()).update(`fp:${value}`).digest('hex').slice(0, 12)
}

export type Device = {
  id: string
  /** Epoch ms until which the cookie says this device is banned; 0 if it does not. */
  banUntil: number
  /** True when the request carried a valid cookie, so the id is a real, repeat device. */
  known: boolean
}

function encode(id: string, banUntilSeconds: number): string {
  const ban = String(banUntilSeconds)
  return `${VERSION}.${id}.${ban}.${sign(`${VERSION}.${id}.${ban}`)}`
}

function decode(value: string): { id: string; banUntil: number } | null {
  const parts = value.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) return null
  const [, id, ban, signature] = parts
  if (!/^[A-Za-z0-9_-]{22}$/.test(id) || !/^\d{1,12}$/.test(ban)) return null
  const expected = Buffer.from(sign(`${VERSION}.${id}.${ban}`))
  const given = Buffer.from(signature)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  return { id, banUntil: Number(ban) * 1000 }
}

function cookieValue(header: string | undefined): string {
  if (!header) return ''
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index > 0 && part.slice(0, index).trim() === DEVICE_COOKIE) return part.slice(index + 1).trim()
  }
  return ''
}

function isSecure(req: IncomingMessage): boolean {
  const forwarded = req.headers['x-forwarded-proto']
  const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
  return proto === 'https' || Boolean((req.socket as { encrypted?: boolean } | undefined)?.encrypted)
}

function writeCookie(req: IncomingMessage, res: ServerResponse, device: Device): void {
  const parts = [
    `${DEVICE_COOKIE}=${encode(device.id, Math.ceil(device.banUntil / 1000))}`,
    'Path=/',
    `Max-Age=${MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (isSecure(req)) parts.push('Secure')
  const existing = res.getHeader('Set-Cookie')
  const others = (Array.isArray(existing) ? existing : existing ? [String(existing)] : []).filter(
    (item) => !item.startsWith(`${DEVICE_COOKIE}=`),
  )
  res.setHeader('Set-Cookie', [...others, parts.join('; ')])
}

const seen = new WeakMap<IncomingMessage, { device: Device; issued: boolean }>()

/**
 * The device behind a request. A missing or unreadable cookie (never signed by
 * this server, or signed with an older secret) means a new device: a fresh id
 * is issued, not a penalty, because a redeploy would otherwise punish everyone.
 */
export function identifyDevice(req: IncomingMessage, res?: ServerResponse): Device {
  let entry = seen.get(req)
  if (!entry) {
    const parsed = decode(cookieValue(req.headers.cookie))
    entry = parsed
      ? { device: { id: parsed.id, banUntil: parsed.banUntil, known: true }, issued: true }
      : {
          device: { id: randomBytes(16).toString('base64url'), banUntil: 0, known: false },
          issued: false,
        }
    seen.set(req, entry)
  }
  if (res && !entry.issued && !res.headersSent) {
    writeCookie(req, res, entry.device)
    entry.issued = true
  }
  return entry.device
}

/** Records a ban in the device's own cookie, so it outlives the server's memory. */
export function setDeviceBan(req: IncomingMessage, res: ServerResponse, device: Device, untilMs: number): void {
  device.banUntil = untilMs
  if (!res.headersSent) writeCookie(req, res, device)
  const entry = seen.get(req)
  if (entry) entry.issued = true
}

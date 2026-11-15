import { lookup as dnsLookup } from 'node:dns'
import type { LookupAddress } from 'node:dns'
import { request as httpRequest } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { Readable, pipeline } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'

/**
 * Fetching pages for the web reader, where the address is the student's (or a
 * model's) choice. Checking a host name and then calling fetch() leaves a gap:
 * fetch resolves the name again, and a hostile DNS server can answer with a
 * public address the first time and an internal one the second. So the check
 * lives in the socket's own lookup, on the address that is actually used.
 */

export class BlockedAddressError extends Error {
  constructor(host: string) {
    super(`${host} resolves to an address the web reader may not use.`)
    this.name = 'BlockedAddressError'
  }
}

export function isBlockedIpv4(ip: string): boolean {
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

/** The eight 16-bit groups of an IPv6 address, or null if it cannot be read. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0]
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (dotted) {
    const parts = dotted[1].split('.').map(Number)
    if (parts.length !== 4 || parts.some((part) => !(part >= 0 && part <= 255))) return null
    const tail = `${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`
    text = text.slice(0, -dotted[1].length) + tail
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 2 ? missing < 0 : missing !== 0) return null
  const groups = [...head, ...new Array<string>(Math.max(0, missing)).fill('0'), ...rest].map((group) =>
    Number.parseInt(group, 16),
  )
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) {
    return null
  }
  return groups
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isBlockedIpv4(ip)
  if (version !== 6) return true

  const groups = ipv6Groups(ip)
  if (!groups) return true
  const [first, second] = groups
  const leadingZeros = groups.slice(0, 5).every((group) => group === 0)

  // ::ffff:a.b.c.d (written dotted or as two hex groups) is an IPv4 address.
  if (leadingZeros && groups[5] === 0xffff) {
    return isBlockedIpv4(`${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`)
  }
  // :: , ::1 and the deprecated IPv4-compatible ::a.b.c.d form.
  if (leadingZeros && groups[5] === 0) return true
  return (
    (first & 0xfe00) === 0xfc00 || // unique local, fc00::/7
    (first & 0xffc0) === 0xfe80 || // link local, fe80::/10
    (first & 0xffc0) === 0xfec0 || // site local (deprecated)
    (first & 0xff00) === 0xff00 || // multicast
    (first === 0x64 && second === 0xff9b) || // NAT64 reaches IPv4 hosts
    first === 0x2002 || // 6to4 embeds an IPv4 address
    (first === 0x2001 && second === 0) || // Teredo
    (first === 0x2001 && second === 0xdb8) // documentation
  )
}

export type Resolver = (hostname: string) => Promise<LookupAddress[]>

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) reject(error)
      else resolve(addresses)
    })
  })

export type GuardOptions = {
  /** Replaced in tests; the real resolver is the system's. */
  resolver?: Resolver
  isBlocked?: (ip: string) => boolean
}

type LookupCallback = (
  error: Error | null,
  address?: string | LookupAddress[],
  family?: number,
) => void

/**
 * A `lookup` for http(s).request that refuses any host with a blocked
 * address. One blocked answer among several rejects them all, so a mixed
 * record cannot slip an internal address in beside a public one.
 */
export function createGuardedLookup({ resolver = systemResolver, isBlocked = isBlockedIp }: GuardOptions = {}) {
  return (hostname: string, options: { all?: boolean; family?: number | string }, callback: LookupCallback) => {
    resolver(hostname).then(
      (addresses) => {
        const wanted = Number(options?.family) || 0
        if (addresses.some((entry) => isBlocked(entry.address))) {
          callback(new BlockedAddressError(hostname))
          return
        }
        const usable = wanted ? addresses.filter((entry) => entry.family === wanted) : addresses
        if (!usable.length) {
          callback(Object.assign(new Error(`No address found for ${hostname}`), { code: 'ENOTFOUND' }))
          return
        }
        if (options?.all) callback(null, usable)
        else callback(null, usable[0].address, usable[0].family)
      },
      (error: Error) => callback(error),
    )
  }
}

export type GuardedInit = {
  headers?: Record<string, string>
  signal?: AbortSignal
}

/** An idle connection (no bytes for this long) is dropped, including mid-body. */
const IDLE_TIMEOUT_MS = 15_000

function toHeaders(res: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else headers.set(name, value)
  }
  return headers
}

/**
 * GET a URL without following redirects (the caller re-checks each hop), with
 * every connection's address validated at connect time. Resolves with a
 * standard Response so callers read it like fetch().
 */
export function fetchGuarded(url: URL, init: GuardedInit = {}, guard: GuardOptions = {}): Promise<Response> {
  const isBlocked = guard.isBlocked ?? isBlockedIp
  return new Promise<Response>((resolve, reject) => {
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    // An address typed straight into the URL skips the lookup, so check it here.
    if (isIP(hostname) && isBlocked(hostname)) {
      reject(new BlockedAddressError(hostname))
      return
    }

    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = send(
      {
        protocol: url.protocol,
        hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { 'accept-encoding': 'gzip, deflate, br', ...init.headers },
        lookup: createGuardedLookup(guard) as never,
        signal: init.signal,
        timeout: IDLE_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status < 200 || status > 599) {
          res.resume()
          reject(new Error(`Unexpected status ${status}`))
          return
        }

        const headers = toHeaders(res)
        if (status === 204 || status === 205 || status === 304) {
          res.resume()
          resolve(new Response(null, { status, headers }))
          return
        }

        const encoding = String(res.headers['content-encoding'] ?? '').trim().toLowerCase()
        const decoder =
          encoding === 'gzip' || encoding === 'x-gzip'
            ? createGunzip()
            : encoding === 'br'
              ? createBrotliDecompress()
              : encoding === 'deflate'
                ? createInflate()
                : null
        let body: Readable = res
        if (decoder) {
          headers.delete('content-encoding')
          headers.delete('content-length')
          // pipeline tears the connection down if the reader gives up early.
          body = pipeline(res, decoder, () => undefined)
        }
        resolve(new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, { status, headers }))
      },
    )
    request.on('timeout', () => request.destroy(new Error('The page stopped responding.')))
    request.on('error', reject)
    request.end()
  })
}

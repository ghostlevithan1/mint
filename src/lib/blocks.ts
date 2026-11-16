/**
 * Why sending is paused, and until when. The server decides; this only mirrors
 * its answer so the page can disable Send and count down live. It is kept in
 * this browser's storage so a reload shows the same countdown, but it can
 * never grant anything: the server refuses a blocked device regardless.
 */

export type BlockKind = 'rate' | 'spam' | 'ban'

export type Block = {
  kind: BlockKind
  /** Epoch ms when sending is allowed again. */
  until: number
  /** Epoch ms when the pause began, for a progress bar. */
  startedAt: number
}

/** The server's error codes that mean "wait", and which kind of wait each is. */
export function blockKindFor(code: string | undefined): BlockKind | null {
  if (code === 'CLIENT_RATE_LIMIT' || code === 'NETWORK_RATE_LIMIT') return 'rate'
  if (code === 'SPAM_BLOCK') return 'spam'
  if (code === 'DEVICE_BANNED') return 'ban'
  return null
}

/** 42 seconds as "0:42", 2 minutes 5 seconds as "2:05", a day's ban as "23:59:41". */
export function formatCountdown(milliseconds: number): string {
  const total = Math.max(0, Math.ceil(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

/** "45 seconds", "2 minutes 5 seconds", "23 hours 59 minutes", for text a screen reader reads once. */
export function describeDuration(milliseconds: number): string {
  const total = Math.max(1, Math.ceil(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
  if (hours) return minutes ? `${unit(hours, 'hour')} ${unit(minutes, 'minute')}` : unit(hours, 'hour')
  if (minutes) return seconds ? `${unit(minutes, 'minute')} ${unit(seconds, 'second')}` : unit(minutes, 'minute')
  return unit(seconds, 'second')
}

const KEY = 'mint.block'
const KINDS: BlockKind[] = ['rate', 'spam', 'ban']

let current: Block | null | undefined
const listeners = new Set<() => void>()

function isBlock(value: unknown): value is Block {
  const item = value as Block | null
  return (
    !!item &&
    KINDS.includes(item.kind) &&
    Number.isFinite(item.until) &&
    Number.isFinite(item.startedAt)
  )
}

function load(): Block | null {
  if (current !== undefined) return current
  let stored: Block | null = null
  try {
    const parsed: unknown = JSON.parse((typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)) ?? 'null')
    if (isBlock(parsed) && parsed.until > Date.now()) stored = parsed
  } catch {
    // Unreadable or missing: nothing is paused.
  }
  current = stored
  return current
}

function commit(next: Block | null): void {
  current = next
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch {
    // The pause still shows for this session.
  }
  for (const listener of listeners) listener()
}

/** The pause in force right now, or null. */
export function getBlock(now = Date.now()): Block | null {
  const block = load()
  return block && block.until > now ? block : null
}

/** The stored value as it is, for useSyncExternalStore (expiry is checked by the reader). */
export function getBlockSnapshot(): Block | null {
  return load()
}

/** Starts a pause. A ban is never replaced by a shorter kind of wait. */
export function startBlock(kind: BlockKind, waitSeconds: number, now = Date.now()): void {
  const existing = getBlock(now)
  if (existing?.kind === 'ban' && kind !== 'ban') return
  const wait = Math.max(1, Math.round(waitSeconds)) * 1000
  // Re-reporting the same ban (a status re-check) must not restart its progress bar.
  const startedAt = kind === 'ban' && existing?.kind === 'ban' ? existing.startedAt : now
  commit({ kind, until: now + wait, startedAt })
}

export function clearBlock(kind?: BlockKind): void {
  const existing = load()
  if (!existing || (kind && existing.kind !== kind)) return
  commit(null)
}

export function subscribeBlock(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** For tests: forget everything, including what was read from storage. */
export function resetBlocks(): void {
  current = undefined
  listeners.clear()
}

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { clock } from './clock'
import { dataDir } from './device'

export const BAN_MS = 24 * 60 * 60 * 1000
/** Finished bans stay on file this long, as a record of who was banned. */
const KEEP_FINISHED_MS = 7 * 24 * 60 * 60 * 1000

export type BanRecord = {
  /** The device cookie's random id. */
  id: string
  bannedAt: number
  expiresAt: number
  /** What the server saw, as short codes (never request contents). */
  signals: string[]
  userAgent: string
  /** A keyed hash of the address, enough to match records without storing it. */
  network: string
}

function isRecord(value: unknown): value is BanRecord {
  const item = value as BanRecord | null
  return (
    !!item &&
    typeof item.id === 'string' &&
    typeof item.bannedAt === 'number' &&
    typeof item.expiresAt === 'number' &&
    Array.isArray(item.signals)
  )
}

/**
 * Banned devices, kept in a JSON file next to the server. Reads are served from
 * memory; the file is re-read when it changes on disk (an operator running
 * `npm run bans`), checked at most every few seconds.
 */
export class BanStore {
  private bans = new Map<string, BanRecord>()
  private stamp = ''
  private checkedAt = 0

  constructor(readonly file: string) {
    this.load()
  }

  private fileStamp(): string {
    try {
      const info = statSync(this.file)
      return `${info.mtimeMs}:${info.size}`
    } catch {
      return ''
    }
  }

  private load(): void {
    this.bans.clear()
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as { bans?: unknown }
      if (Array.isArray(data.bans)) for (const item of data.bans) if (isRecord(item)) this.bans.set(item.id, item)
    } catch {
      // No file yet, or an unreadable one: start empty rather than refuse to run.
    }
    this.stamp = this.fileStamp()
  }

  private refresh(): void {
    const now = clock.now()
    if (now - this.checkedAt < 5_000) return
    this.checkedAt = now
    if (this.fileStamp() !== this.stamp) this.load()
  }

  private save(): void {
    const cutoff = clock.now() - KEEP_FINISHED_MS
    for (const [id, record] of this.bans) if (record.expiresAt < cutoff) this.bans.delete(id)
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.tmp`
      writeFileSync(temporary, JSON.stringify({ version: 1, bans: [...this.bans.values()] }, null, 2))
      renameSync(temporary, this.file)
    } catch {
      // A read-only disk must not stop enforcement; the ban still lives in memory and the cookie.
    }
    this.stamp = this.fileStamp()
  }

  /** The device's ban if it is still running. */
  get(id: string): BanRecord | null {
    this.refresh()
    const record = this.bans.get(id)
    return record && record.expiresAt > clock.now() ? record : null
  }

  add(record: BanRecord): void {
    this.bans.set(record.id, record)
    this.save()
  }

  remove(id: string): boolean {
    this.refresh()
    const removed = this.bans.delete(id)
    if (removed) this.save()
    return removed
  }

  /** Every saved ban, newest first; `activeOnly` leaves out finished ones. */
  list(activeOnly = false): BanRecord[] {
    this.refresh()
    const now = clock.now()
    return [...this.bans.values()]
      .filter((record) => !activeOnly || record.expiresAt > now)
      .sort((a, b) => b.bannedAt - a.bannedAt)
  }
}

let store: BanStore | null = null

export function banStore(): BanStore {
  store ??= new BanStore(resolve(dataDir(), 'device-bans.json'))
  return store
}

/** For tests: swap the store, or pass null to rebuild from the environment. */
export function setBanStore(next: BanStore | null): void {
  store = next
}

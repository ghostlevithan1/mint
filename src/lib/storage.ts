import type { Conversation } from './chat'

const DB_NAME = 'mint-store'
const DB_VERSION = 1
const CONV_STORE = 'conversations'
const META_STORE = 'meta'
/** localStorage keys from the pre-IndexedDB era, wiped once for good. */
const LEGACY_CHATS_KEY = 'mint.chats.v1'
const PURGE_FLAG = 'mint.chats.idb-purge.v1'

type StoredRow = {
  /** Conversation id. */
  id: string
  updatedAt: number
  /** gzip(JSON) of the full conversation including inline images. */
  bytes: Uint8Array
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'))
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(CONV_STORE)) {
        db.createObjectStore(CONV_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onblocked = () => reject(new Error('indexedDB blocked'))
  })
  return dbPromise
}

function tx(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  run: (objectStore: IDBObjectStore) => IDBRequest | IDBRequest[],
): Promise<any[]> {
  return new Promise<any[]>((resolve, reject) => {
    const transaction = db.transaction(store, mode)
    const objectStore = transaction.objectStore(store)
    const requests = run(objectStore)
    const list = Array.isArray(requests) ? requests : [requests]
    const results: any[] = []
    let pending = list.length
    if (pending === 0) {
      resolve(results)
      return
    }
    for (const request of list) {
      request.onsuccess = () => {
        if (request.result !== undefined) {
          // request.result may itself be an array (getAll) — flatten one level later.
          results.push(request.result)
        }
        pending -= 1
        if (pending === 0) resolve(results.flat())
      }
      request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'))
    }
    transaction.onerror = () => reject(transaction.error ?? new Error('indexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('indexedDB transaction aborted'))
  })
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

// Hash of what we last persisted per chat, so a debounce tick only writes
// conversations that actually changed (and drops ones that disappeared).
const persistedHash = new Map<string, string>()

export async function loadConversations(): Promise<{
  conversations: Conversation[]
  activeId: string | null
} | null> {
  try {
    const db = await openDb()
    const rows = (await tx(db, CONV_STORE, 'readonly', (store) => store.getAll())) as StoredRow[]
    const conversations: Conversation[] = []
    for (const row of rows) {
      try {
        const parsed = JSON.parse(await gunzip(row.bytes)) as Conversation
        if (typeof parsed?.id === 'string' && Array.isArray(parsed.messages)) {
          conversations.push(parsed)
          persistedHash.set(parsed.id, JSON.stringify(parsed))
        }
      } catch {
        // A single corrupt row is dropped instead of breaking the whole load.
      }
    }
    if (!conversations.length) return null

    conversations.sort((a, b) => b.updatedAt - a.updatedAt)
    const metaRows = (await tx(db, META_STORE, 'readonly', (store) => store.get('activeId'))) as string[]
    const storedActiveId = metaRows[0]
    const activeId =
      typeof storedActiveId === 'string' &&
      conversations.some((chat) => chat.id === storedActiveId)
        ? storedActiveId
        : conversations[0].id
    return { conversations, activeId }
  } catch {
    return null
  }
}

/**
 * Upserts changed conversations, deletes removed ones, remembers activeId.
 * Returns null on success, or a short human-readable reason on failure so the
 * UI can warn that this browser is not saving chats.
 */
export async function persistConversations(
  conversations: Conversation[],
  activeId: string,
): Promise<string | null> {
  try {
    const current = new Set(conversations.map((conversation) => conversation.id))
    const writes: { row: StoredRow; hash: string }[] = []
    for (const conversation of conversations) {
      const serialized = JSON.stringify(conversation)
      if (persistedHash.get(conversation.id) === serialized) continue
      writes.push({
        row: {
          id: conversation.id,
          updatedAt: conversation.updatedAt,
          bytes: await gzip(serialized),
        },
        hash: serialized,
      })
    }

    const deletions = [...persistedHash.keys()].filter((id) => !current.has(id))
    for (const id of deletions) persistedHash.delete(id)

    const db = await openDb()
    const transaction = db.transaction([CONV_STORE, META_STORE], 'readwrite')
    const convStore = transaction.objectStore(CONV_STORE)
    const metaStore = transaction.objectStore(META_STORE)
    for (const id of deletions) convStore.delete(id)
    for (const { row } of writes) convStore.put(row)
    metaStore.put(activeId, 'activeId')

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('indexedDB transaction failed'))
      transaction.onabort = () => reject(transaction.error ?? new Error('indexedDB transaction aborted'))
    })

    for (const { row, hash } of writes) persistedHash.set(row.id, hash)
    return null
  } catch (error) {
    // Storage failures are non-fatal; chats stay in memory, but the user is
    // told so they don't assume this browser has a copy.
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      return 'This browser is out of storage space for chats.'
    }
    return 'This browser could not save chats to local storage.'
  }
}

export async function wipePersistedStore(): Promise<boolean> {
  persistedHash.clear()
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([CONV_STORE, META_STORE], 'readwrite')
      transaction.objectStore(CONV_STORE).clear()
      transaction.objectStore(META_STORE).clear()
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('indexedDB clear failed'))
    })
    return true
  } catch {
    // Best effort; never block the app on storage housekeeping.
    return false
  }
}

/** Local storage footprint, used by Settings to show what this device holds. */
export async function storageUsage(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  } catch {
    return null
  }
}

/** One-time cleanup of the old localStorage chat store. */
export function purgeLegacyChatStorageOnce(): void {
  try {
    if (localStorage.getItem(PURGE_FLAG)) return
    localStorage.removeItem(LEGACY_CHATS_KEY)
    localStorage.setItem(PURGE_FLAG, new Date().toISOString())
  } catch {
    // Whatever the storage situation is, never block the app on cleanup.
  }
}

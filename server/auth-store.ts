import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

export type Provider = 'email' | 'google' | 'both'

export type User = {
  id: string
  accountId?: string
  email: string
  displayName: string
  pictureUrl?: string
  passwordHash?: string
  googleSub?: string
  provider: Provider
  emailVerified: boolean
  createdAt: number
  lastLogin: number
}

type VerificationRecord = { userId: string; token: string; expiresAt: number; used: boolean }

const DATA_FILE = resolve(process.cwd(), 'data', 'auth-store.json')

type StoreData = {
  users: User[]
  tokens: VerificationRecord[]
  resetTokens: VerificationRecord[]
  blacklist: Array<[string, number]>
  recent?: Record<string, string[]>
}

const users = new Map<string, User>()
const usersByEmail = new Map<string, string>() // email -> userId
const usersByAccount = new Map<string, string>() // accountId -> userId
const usersByGoogle = new Map<string, string>() // googleSub -> userId
const tokens = new Map<string, VerificationRecord>()
const resetTokens = new Map<string, VerificationRecord>()
const codeBlacklist = new Map<string, number>()
const recentAccounts = new Map<string, string[]>() // deviceId -> userId[]

let loaded = false

async function load(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const raw = await readFile(DATA_FILE, 'utf8')
    const data = JSON.parse(raw) as StoreData
    for (const u of data.users ?? []) {
      users.set(u.id, u)
      usersByEmail.set(u.email.toLowerCase(), u.id)
      if (u.accountId) usersByAccount.set(u.accountId, u.id)
      if (u.googleSub) usersByGoogle.set(u.googleSub, u.id)
    }
    for (const r of data.tokens ?? []) tokens.set(r.token, r)
    for (const r of data.resetTokens ?? []) resetTokens.set(r.token, r)
    const now = Date.now()
    for (const [code, exp] of data.blacklist ?? []) {
      if (exp > now) codeBlacklist.set(code, exp)
    }
    if (data.recent) {
      for (const [k, v] of Object.entries(data.recent)) recentAccounts.set(k, v)
    }
  } catch {
    // no file or corrupt; start fresh
  }
  // ensure accountIds
  for (const u of users.values()) {
    if (!u.accountId) {
      u.accountId = generateAccountId()
      usersByAccount.set(u.accountId, u.id)
    }
  }
}

async function persist(): Promise<void> {
  try {
    await mkdir(dirname(DATA_FILE), { recursive: true })
    const data: StoreData = {
      users: Array.from(users.values()),
      tokens: Array.from(tokens.values()),
      resetTokens: Array.from(resetTokens.values()),
      blacklist: Array.from(codeBlacklist.entries()),
      recent: Object.fromEntries(recentAccounts),
    }
    await writeFile(DATA_FILE, JSON.stringify(data), 'utf8')
  } catch {
    // best effort
  }
}

function uid(): string {
  return randomUUID()
}

const ACCESS_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+=/?'

function generateAccountId(): string {
  const existing = new Set(Array.from(users.values()).map((u) => u.accountId).filter(Boolean) as string[])
  let id = ''
  do {
    id = ''
    for (let i = 0; i < 20; i++) {
      id += ACCESS_CHARS[Math.floor(Math.random() * ACCESS_CHARS.length)]
    }
  } while (existing.has(id))
  return id
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function cleanBlacklist(): void {
  const now = Date.now()
  for (const [code, expiry] of codeBlacklist) {
    if (expiry <= now) codeBlacklist.delete(code)
  }
}

function generateCode(): string {
  cleanBlacklist()
  let code = ''
  do {
    code = ''
    for (let i = 0; i < 8; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    }
  } while (codeBlacklist.has(code) || tokens.has(code) || resetTokens.has(code))
  return code
}

function hashPassword(password: string): string {
  const salt = Math.random().toString(36).slice(2, 10)
  const hash = createHash('sha256').update(`${salt}:${password}`).digest('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = createHash('sha256').update(`${salt}:${password}`).digest('hex')
  return candidate === hash
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function validatePasswordStrength(password: string): { valid: boolean; message?: string } {
  if (password.length < 8) return { valid: false, message: 'Password must be at least 8 characters' }
  return { valid: true }
}

function userDisplayName(user: User): string {
  return user.displayName || user.email.split('@')[0] || 'Member'
}

function userInitials(user: User): string {
  return userDisplayName(user).split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()
}

// Ensure loaded before any operation
export async function ensureLoaded(): Promise<void> {
  await load()
}

export async function createEmailUser(email: string, password: string, displayName?: string): Promise<User> {
  await load()
  if (!validateEmail(email)) throw new Error('Invalid email format')
  const strength = validatePasswordStrength(password)
  if (!strength.valid) throw new Error(strength.message)
  if (usersByEmail.has(email.toLowerCase())) throw new Error('Email already registered')

  const now = Date.now()
  const name = (displayName ?? '').trim() || email.split('@')[0] || 'Member'
  const user: User = {
    id: uid(),
    accountId: generateAccountId(),
    email,
    displayName: name,
    pictureUrl: undefined,
    passwordHash: hashPassword(password),
    provider: 'email',
    emailVerified: false,
    createdAt: now,
    lastLogin: now,
  }
  users.set(user.id, user)
  usersByEmail.set(email.toLowerCase(), user.id)
  usersByAccount.set(user.accountId!, user.id)
  await persist()
  return user
}

export function verifyEmail(token: string): boolean {
  // sync-ish but needs loaded; caller must ensureLoaded first
  const record = tokens.get(token)
  if (!record || record.used) return false
  if (Date.now() > record.expiresAt) {
    tokens.delete(token)
    void persist()
    return false
  }
  const user = users.get(record.userId)
  if (!user) {
    tokens.delete(token)
    void persist()
    return false
  }
  user.emailVerified = true
  users.set(record.userId, user)
  record.used = true
  void persist()
  return true
}

export function createEmailVerificationToken(userId: string): string {
  const token = generateCode()
  tokens.set(token, { userId, token, expiresAt: Date.now() + 24 * 60 * 60 * 1000, used: false })
  codeBlacklist.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000)
  void persist()
  return token
}

export async function authenticateUser(email: string, password: string): Promise<User> {
  await load()
  const id = usersByEmail.get(email.toLowerCase())
  const found = id ? users.get(id) : undefined
  if (!found) throw new Error('Invalid email or password')
  if (!found.passwordHash) throw new Error('This account uses Google sign-in. Use Google or link an email password first.')
  if (!verifyPassword(password, found.passwordHash)) throw new Error('Invalid email or password')
  if (found.provider === 'email' && !found.emailVerified) throw new Error('Please verify your email address first')
  found.lastLogin = Date.now()
  users.set(found.id, found)
  await persist()
  return found
}

export async function linkEmailToGoogle(userId: string, password: string): Promise<User> {
  await load()
  const strength = (password.length >= 8) ? { valid: true } : { valid: false, message: 'Password must be at least 8 characters' }
  if (!strength.valid) throw new Error(strength.message)
  const found = users.get(userId) || (userId && usersByGoogle.get(userId) ? users.get(usersByGoogle.get(userId)!) : undefined)
  if (!found) throw new Error('Account not found')
  if (found.provider !== 'google' && found.provider !== 'both') throw new Error('Account is not a Google account')
  found.passwordHash = hashPassword(password)
  found.provider = 'both'
  found.emailVerified = true
  found.lastLogin = Date.now()
  users.set(found.id, found)
  await persist()
  return found
}

export function signInWithGoogle(info: { id: string; email: string; displayName?: string; pictureUrl?: string }): User {
  // sync entry; ensure loaded lazily not possible here, but load() should have been called. We'll fire-and-forget load.
  const email = info.email.trim().toLowerCase()
  // try find by googleSub
  let foundId = usersByGoogle.get(info.id)
  if (foundId) {
    const u = users.get(foundId)!
    u.lastLogin = Date.now()
    if (info.pictureUrl) u.pictureUrl = info.pictureUrl
    if (info.displayName) u.displayName = info.displayName
    users.set(u.id, u)
    void persist()
    return u
  }
  // find by email
  const byEmail = usersByEmail.get(email)
  if (byEmail) {
    const u = users.get(byEmail)!
    u.googleSub = info.id
    if (u.provider === 'email') u.provider = 'both'
    u.emailVerified = true
    u.lastLogin = Date.now()
    if (info.pictureUrl) u.pictureUrl = info.pictureUrl
    if (info.displayName) u.displayName = info.displayName
    users.set(u.id, u)
    usersByGoogle.set(info.id, u.id)
    void persist()
    return u
  }
  const now = Date.now()
  const name = info.displayName || info.email.split('@')[0] || 'Member'
  const user: User = {
    id: uid(),
    accountId: generateAccountId(),
    email: info.email,
    displayName: name,
    pictureUrl: info.pictureUrl,
    passwordHash: undefined,
    googleSub: info.id,
    provider: 'google',
    emailVerified: true,
    createdAt: now,
    lastLogin: now,
  }
  users.set(user.id, user)
  usersByEmail.set(email, user.id)
  usersByGoogle.set(info.id, user.id)
  usersByAccount.set(user.accountId!, user.id)
  void persist()
  return user
}

export function getUserById(userId: string): User | undefined {
  return users.get(userId)
}

export function getAllUsers(): User[] {
  return Array.from(users.values())
}

export function clearAllUsers(): void {
  users.clear()
  usersByEmail.clear()
  usersByAccount.clear()
  usersByGoogle.clear()
  tokens.clear()
  resetTokens.clear()
  codeBlacklist.clear()
  recentAccounts.clear()
  void persist()
}

export function createPasswordResetToken(userId: string): string {
  const token = generateCode()
  resetTokens.set(token, { userId, token, expiresAt: Date.now() + 20 * 60 * 1000, used: false })
  codeBlacklist.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000)
  void persist()
  return token
}

export function verifyPasswordResetToken(token: string): User | null {
  const record = resetTokens.get(token)
  if (!record || record.used) return null
  if (Date.now() > record.expiresAt) {
    resetTokens.delete(token)
    void persist()
    return null
  }
  const user = users.get(record.userId)
  if (!user) {
    resetTokens.delete(token)
    void persist()
    return null
  }
  record.used = true
  resetTokens.set(token, record)
  codeBlacklist.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000)
  user.lastLogin = Date.now()
  users.set(user.id, user)
  void persist()
  return user
}

export function getUserByEmail(email: string): User | undefined {
  const id = usersByEmail.get(email.toLowerCase())
  return id ? users.get(id) : undefined
}

export function getAccountByAccessId(accountId: string): User | undefined {
  const id = usersByAccount.get(accountId)
  return id ? users.get(id) : undefined
}

export function authenticateByAccessId(accountId: string): User {
  const found = getAccountByAccessId(accountId)
  if (!found) throw new Error('login failed')
  found.lastLogin = Date.now()
  users.set(found.id, found)
  void persist()
  return found
}

export function getRecentAccounts(deviceId: string): User[] {
  const ids = recentAccounts.get(deviceId) ?? []
  const result: User[] = []
  for (const id of ids) {
    const u = users.get(id)
    if (u) result.push(u)
  }
  return result
}

export function addRecentAccount(deviceId: string, userId: string): void {
  const ids = recentAccounts.get(deviceId) ?? []
  const next = [userId, ...ids.filter((id) => id !== userId)].slice(0, 5)
  recentAccounts.set(deviceId, next)
  void persist()
}

export function saveSession(_deviceId: string, _userId: string): void {
  // session stored client-side; server just acknowledges. No-op here but kept for API symmetry.
}

export function loadSession(_deviceId: string): User | null {
  // client-side; server doesn't track sessions. Return null.
  return null
}

export function clearSession(_deviceId: string): void {
  // no-op server side
}

function userPicture(u: User): string | undefined {
  return u.pictureUrl
}

export { userDisplayName, userInitials, userPicture }


export type Provider = 'email' | 'google' | 'both'

export type User = {
  id: string
  email: string
  displayName: string
  pictureUrl?: string
  passwordHash?: string
  googleSub?: string
  provider: Provider
  emailVerified: boolean
  createdAt: Date
  lastLogin: Date
}

type VerificationRecord = {
  userId: string
  token: string
  expiresAt: number
  used: boolean
}

const USERS_KEY = 'mint.users.v1'
const TOKENS_KEY = 'mint.verifyTokens.v1'
const RESET_KEY = 'mint.resetTokens.v1'
const BLACKLIST_KEY = 'mint.codeBlacklist.v1'

const users = new Map<string, User>()
const tokens = new Map<string, VerificationRecord>()
const resetTokens = new Map<string, VerificationRecord>()
const codeBlacklist = new Map<string, number>() // code -> expiry ms

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function loadUsers(): void {
  if (!hasStorage()) return
  try {
    const raw = localStorage.getItem(USERS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>
    for (const item of parsed) {
      const user: User = {
        id: String(item.id),
        email: String(item.email),
        displayName: String(item.displayName ?? item.email),
        pictureUrl: item.pictureUrl ? String(item.pictureUrl) : undefined,
        passwordHash: item.passwordHash ? String(item.passwordHash) : undefined,
        googleSub: item.googleSub ? String(item.googleSub) : undefined,
        provider: (item.provider as Provider) ?? 'email',
        emailVerified: item.emailVerified === true,
        createdAt: new Date(Number(item.createdAt ?? Date.now())),
        lastLogin: new Date(Number(item.lastLogin ?? Date.now())),
      }
      users.set(user.id, user)
    }
  } catch {
    // ignore corrupt storage
  }
}

function saveUsers(): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(Array.from(users.values())))
  } catch {
    // ignore
  }
}

function loadTokens(): void {
  if (!hasStorage()) return
  try {
    const raw = localStorage.getItem(TOKENS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as VerificationRecord[]
    for (const record of parsed) tokens.set(record.token, record)
  } catch {
    // ignore
  }
}

function saveTokens(): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(Array.from(tokens.values())))
  } catch {
    // ignore
  }
}

function loadResetTokens(): void {
  if (!hasStorage()) return
  try {
    const raw = localStorage.getItem(RESET_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as VerificationRecord[]
    for (const record of parsed) resetTokens.set(record.token, record)
  } catch {
    // ignore
  }
}

function saveResetTokens(): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(RESET_KEY, JSON.stringify(Array.from(resetTokens.values())))
  } catch {
    // ignore
  }
}

function loadBlacklist(): void {
  if (!hasStorage()) return
  try {
    const raw = localStorage.getItem(BLACKLIST_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Array<[string, number]>
    const now = Date.now()
    for (const [code, expiry] of parsed) {
      if (expiry > now) codeBlacklist.set(code, expiry)
    }
  } catch {
    // ignore
  }
}

function saveBlacklist(): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(BLACKLIST_KEY, JSON.stringify(Array.from(codeBlacklist.entries())))
  } catch {
    // ignore
  }
}

function cleanBlacklist(): void {
  const now = Date.now()
  for (const [code, expiry] of codeBlacklist) {
    if (expiry <= now) codeBlacklist.delete(code)
  }
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateCode(): string {
  cleanBlacklist()
  let code = ''
  do {
    code = ''
    for (let i = 0; i < 8; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    }
  } while (
    codeBlacklist.has(code) ||
    tokens.has(code) ||
    resetTokens.has(code)
  )
  return code
}

loadUsers()
loadTokens()
loadResetTokens()
loadBlacklist()

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function hashPassword(password: string): Promise<string> {
  const salt = Math.random().toString(36).slice(2, 10)
  const hash = await sha256(`${salt}:${password}`)
  return `${salt}:${hash}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = await sha256(`${salt}:${password}`)
  return candidate === hash
}

export const validateEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

export const validatePasswordStrength = (password: string): { valid: boolean; message?: string } => {
  if (password.length < 8) return { valid: false, message: 'Password must be at least 8 characters' }
  return { valid: true }
}

export const userDisplayName = (user: User): string =>
  user.displayName || user.email.split('@')[0] || 'Member'

export const userInitials = (user: User): string =>
  userDisplayName(user)
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

export const userPicture = (user: User): string | undefined => user.pictureUrl

export async function createEmailUser(email: string, password: string, displayName?: string): Promise<User> {
  if (!validateEmail(email)) throw new Error('Invalid email format')
  const strength = validatePasswordStrength(password)
  if (!strength.valid) throw new Error(strength.message)

  for (const user of users.values()) {
    if (user.email.toLowerCase() === email.toLowerCase()) throw new Error('Email already registered')
  }

  const now = new Date()
  const name = (displayName ?? '').trim() || email.split('@')[0] || 'Member'
  const user: User = {
    id: uid(),
    email,
    displayName: name,
    pictureUrl: undefined,
    passwordHash: await hashPassword(password),
    provider: 'email',
    emailVerified: false,
    createdAt: now,
    lastLogin: now,
  }
  users.set(user.id, user)
  saveUsers()
  return user
}

export function verifyEmail(token: string): boolean {
  const record = tokens.get(token)
  if (!record || record.used) return false
  if (Date.now() > record.expiresAt) {
    tokens.delete(token)
    saveTokens()
    return false
  }
  const user = users.get(record.userId)
  if (!user) {
    tokens.delete(token)
    saveTokens()
    return false
  }
  user.emailVerified = true
  users.set(record.userId, user)
  record.used = true
  saveUsers()
  saveTokens()
  return true
}

export function createEmailVerificationToken(userId: string): string {
  const token = generateCode()
  tokens.set(token, {
    userId,
    token,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    used: false,
  })
  // blacklist for a week so it can't be regenerated/reused
  codeBlacklist.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000)
  saveTokens()
  saveBlacklist()
  return token
}

export async function authenticateUser(email: string, password: string): Promise<User> {
  let found: User | undefined
  for (const user of users.values()) {
    if (user.email.toLowerCase() === email.toLowerCase()) {
      found = user
      break
    }
  }
  if (!found) throw new Error('Invalid email or password')
  if (!found.passwordHash) throw new Error('This account uses Google sign-in. Use Google or link an email password first.')
  if (!(await verifyPassword(password, found.passwordHash))) throw new Error('Invalid email or password')
  if (found.provider === 'email' && !found.emailVerified) throw new Error('Please verify your email address first')
  found.lastLogin = new Date()
  users.set(found.id, found)
  saveUsers()
  return found
}

export async function linkEmailToGoogle(userId: string, password: string): Promise<User> {
  const strength = validatePasswordStrength(password)
  if (!strength.valid) throw new Error(strength.message)

  let found: User | undefined
  for (const user of users.values()) {
    if (user.id === userId || user.googleSub === userId) {
      found = user
      break
    }
  }
  if (!found) throw new Error('Account not found')
  if (found.provider !== 'google' && found.provider !== 'both') throw new Error('Account is not a Google account')
  found.passwordHash = await hashPassword(password)
  found.provider = 'both'
  found.emailVerified = true
  found.lastLogin = new Date()
  users.set(found.id, found)
  saveUsers()
  return found
}

export function signInWithGoogle(info: { id: string; email: string; displayName?: string; pictureUrl?: string }): User {
  const email = info.email.trim().toLowerCase()

  for (const user of users.values()) {
    if (user.googleSub === info.id) {
      user.lastLogin = new Date()
      if (info.pictureUrl) user.pictureUrl = info.pictureUrl
      if (info.displayName) user.displayName = info.displayName
      users.set(user.id, user)
      saveUsers()
      return user
    }
  }

  for (const user of users.values()) {
    if (user.email.toLowerCase() === email) {
      user.googleSub = info.id
      if (user.provider === 'email') user.provider = 'both'
      user.emailVerified = true
      user.lastLogin = new Date()
      if (info.pictureUrl) user.pictureUrl = info.pictureUrl
      if (info.displayName) user.displayName = info.displayName
      users.set(user.id, user)
      saveUsers()
      return user
    }
  }

  const now = new Date()
  const name = info.displayName || info.email.split('@')[0] || 'Member'
  const user: User = {
    id: uid(),
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
  saveUsers()
  return user
}

export const getUserById = (userId: string): User | undefined => users.get(userId)

export const getAllUsers = (): User[] => Array.from(users.values())

export function clearAllUsers(): void {
  users.clear()
  tokens.clear()
  resetTokens.clear()
  codeBlacklist.clear()
  if (hasStorage()) {
    try {
      localStorage.removeItem(USERS_KEY)
      localStorage.removeItem(TOKENS_KEY)
      localStorage.removeItem(RESET_KEY)
      localStorage.removeItem(BLACKLIST_KEY)
      localStorage.removeItem('mint.session.v1')
      localStorage.removeItem('mint.recentAccounts.v1')
    } catch {
      // ignore
    }
  }
}

export function createPasswordResetToken(userId: string): string {
  const token = generateCode()
  resetTokens.set(token, {
    userId,
    token,
    expiresAt: Date.now() + 20 * 60 * 1000,
    used: false,
  })
  codeBlacklist.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000)
  saveResetTokens()
  saveBlacklist()
  return token
}

export function verifyPasswordResetToken(token: string): User | null {
  const record = resetTokens.get(token)
  if (!record || record.used) return null
  if (Date.now() > record.expiresAt) {
    resetTokens.delete(token)
    saveResetTokens()
    return null
  }
  const user = users.get(record.userId)
  if (!user) {
    resetTokens.delete(token)
    saveResetTokens()
    return null
  }
  record.used = true
  resetTokens.set(token, record)
  saveResetTokens()
  // blacklist for a week so it can't be reused
  codeBlacklist.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000)
  saveBlacklist()
  user.lastLogin = new Date()
  users.set(user.id, user)
  saveUsers()
  return user
}

export function getUserByEmail(email: string): User | undefined {
  for (const user of users.values()) {
    if (user.email.toLowerCase() === email.toLowerCase()) return user
  }
  return undefined
}

const SESSION_KEY = 'mint.session.v1'
const RECENT_KEY = 'mint.recentAccounts.v1'
const MAX_RECENT = 5

export function saveSession(userId: string): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, savedAt: Date.now() }))
  } catch {
    // ignore
  }
}

export function loadSession(): User | null {
  if (!hasStorage()) return null
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { userId?: string }
    if (!parsed.userId) return null
    const user = users.get(parsed.userId)
    if (!user) {
      clearSession()
      return null
    }
    return user
  } catch {
    return null
  }
}

export function clearSession(): void {
  if (!hasStorage()) return
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}

export function getRecentAccounts(): User[] {
  if (!hasStorage()) return []
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const ids = JSON.parse(raw) as string[]
    const result: User[] = []
    for (const id of ids) {
      const user = users.get(id)
      if (user) result.push(user)
    }
    return result
  } catch {
    return []
  }
}

export function addRecentAccount(userId: string): void {
  if (!hasStorage()) return
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    let ids: string[] = raw ? (JSON.parse(raw) as string[]) : []
    ids = [userId, ...ids.filter((id) => id !== userId)].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids))
  } catch {
    // ignore
  }
}

export function removeRecentAccount(userId: string): void {
  if (!hasStorage()) return
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return
    const ids = (JSON.parse(raw) as string[]).filter((id) => id !== userId)
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids))
  } catch {
    // ignore
  }
}

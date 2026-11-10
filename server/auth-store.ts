import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'

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

const DATABASE_URL = process.env.DATABASE_URL

let pool: Pool | null = null
let initialized = false

function getPool(): Pool {
  if (!pool) {
    if (!DATABASE_URL) throw new Error('DATABASE_URL not set')
    pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  }
  return pool
}

const ACCESS_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+=/?'
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function uid(): string {
  return randomUUID()
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  return bcrypt.compare(password, stored)
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

function generateAccountId(existing: Set<string>): string {
  let id = ''
  do {
    id = ''
    for (let i = 0; i < 20; i++) id += ACCESS_CHARS[Math.floor(Math.random() * ACCESS_CHARS.length)]
  } while (existing.has(id))
  return id
}

function generateCode(existing: Set<string>): string {
  let code = ''
  do {
    code = ''
    for (let i = 0; i < 8; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  } while (existing.has(code))
  return code
}

export async function ensureLoaded(): Promise<void> {
  if (initialized) return
  initialized = true
  const p = getPool()
  // create tables
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      account_id TEXT UNIQUE,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      picture_url TEXT,
      password_hash TEXT,
      google_sub TEXT UNIQUE,
      provider TEXT NOT NULL,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL,
      last_login BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS verify_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS reset_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS code_blacklist (
      code TEXT PRIMARY KEY,
      expires_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recent_accounts (
      device_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      position INT NOT NULL,
      PRIMARY KEY (device_id, user_id)
    );
  `)
  // ensure account_ids for users missing
  const { rows } = await p.query('SELECT id, account_id FROM users WHERE account_id IS NULL')
  const existingIds = new Set((await p.query('SELECT account_id FROM users WHERE account_id IS NOT NULL')).rows.map((r: any) => r.account_id))
  for (const r of rows) {
    const newId = generateAccountId(existingIds)
    existingIds.add(newId)
    await p.query('UPDATE users SET account_id = $1 WHERE id = $2', [newId, r.id])
  }
}

// ---------- helpers to map rows ----------

function rowToUser(r: any): User {
  return {
    id: r.id,
    accountId: r.account_id ?? undefined,
    email: r.email,
    displayName: r.display_name,
    pictureUrl: r.picture_url ?? undefined,
    passwordHash: r.password_hash ?? undefined,
    googleSub: r.google_sub ?? undefined,
    provider: r.provider,
    emailVerified: r.email_verified,
    createdAt: Number(r.created_at),
    lastLogin: Number(r.last_login),
  }
}

// ---------- public API ----------

export async function createEmailUser(email: string, password: string, displayName?: string): Promise<User> {
  await ensureLoaded()
  if (!validateEmail(email)) throw new Error('Invalid email format')
  const strength = validatePasswordStrength(password)
  if (!strength.valid) throw new Error(strength.message)
  const existing = await getPool().query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email])
  if (existing.rows.length) throw new Error('Email already registered')

  const now = Date.now()
  const name = (displayName ?? '').trim() || email.split('@')[0] || 'Member'
  const id = uid()
  const accountId = generateAccountId(new Set((await getPool().query('SELECT account_id FROM users')).rows.map((r: any) => r.account_id).filter(Boolean)))
  await getPool().query(
    `INSERT INTO users (id, account_id, email, display_name, password_hash, provider, email_verified, created_at, last_login)
     VALUES ($1,$2,$3,$4,$5,'email',FALSE,$6,$7)`,
    [id, accountId, email, name, await hashPassword(password), now, now]
  )
  return { id, accountId, email, displayName: name, passwordHash: undefined, provider: 'email', emailVerified: false, createdAt: now, lastLogin: now }
}

export async function verifyEmail(token: string): Promise<boolean> {
  await ensureLoaded()
  const { rows } = await getPool().query('SELECT user_id, expires_at, used FROM verify_tokens WHERE token = $1', [token])
  if (!rows.length) return false
  const r = rows[0]
  if (r.used) return false
  if (Date.now() > Number(r.expires_at)) {
    await getPool().query('DELETE FROM verify_tokens WHERE token = $1', [token])
    return false
  }
  await getPool().query('UPDATE users SET email_verified = TRUE WHERE id = $1', [r.user_id])
  await getPool().query('UPDATE verify_tokens SET used = TRUE WHERE token = $1', [token])
  return true
}

export async function createEmailVerificationToken(userId: string): Promise<string> {
  await ensureLoaded()
  // clean blacklist
  await getPool().query('DELETE FROM code_blacklist WHERE expires_at <= $1', [Date.now()])
  const existingCodes = new Set<string>()
  const bl = await getPool().query('SELECT code FROM code_blacklist')
  bl.rows.forEach((r: any) => existingCodes.add(r.code))
  const vt = await getPool().query('SELECT token FROM verify_tokens')
  vt.rows.forEach((r: any) => existingCodes.add(r.token))
  const rt = await getPool().query('SELECT token FROM reset_tokens')
  rt.rows.forEach((r: any) => existingCodes.add(r.token))

  const token = generateCode(existingCodes)
  await getPool().query('INSERT INTO verify_tokens (token, user_id, expires_at, used) VALUES ($1,$2,$3,FALSE)', [token, userId, Date.now() + 24 * 60 * 60 * 1000])
  await getPool().query('INSERT INTO code_blacklist (code, expires_at) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING', [token, Date.now() + 7 * 24 * 60 * 60 * 1000])
  return token
}

const failedAttempts = new Map<string, { count: number; lockedUntil: number }>()

export async function authenticateUser(email: string, password: string): Promise<User> {
  await ensureLoaded()
  const lock = failedAttempts.get(email.toLowerCase())
  if (lock && lock.lockedUntil > Date.now()) {
    throw new Error('Account temporarily locked. Try again later.')
  }
  const { rows } = await getPool().query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email])
  if (!rows.length) {
    recordFailure(email)
    throw new Error('Invalid email or password')
  }
  const u = rowToUser(rows[0])
  if (!u.passwordHash) {
    recordFailure(email)
    throw new Error('This account uses Google sign-in. Use Google or link an email password first.')
  }
  if (!(await verifyPassword(password, u.passwordHash))) {
    recordFailure(email)
    throw new Error('Invalid email or password')
  }
  if (u.provider === 'email' && !u.emailVerified) {
    throw new Error('Please verify your email address first')
  }
  failedAttempts.delete(email.toLowerCase())
  await getPool().query('UPDATE users SET last_login = $1 WHERE id = $2', [Date.now(), u.id])
  u.lastLogin = Date.now()
  return u
}

function recordFailure(email: string): void {
  const key = email.toLowerCase()
  const entry = failedAttempts.get(key) ?? { count: 0, lockedUntil: 0 }
  entry.count++
  if (entry.count >= 5) {
    entry.lockedUntil = Date.now() + 15 * 60 * 1000
    entry.count = 0
  }
  failedAttempts.set(key, entry)
}

export async function linkEmailToGoogle(userId: string, password: string): Promise<User> {
  await ensureLoaded()
  if (password.length < 8) throw new Error('Password must be at least 8 characters')
  const { rows } = await getPool().query('SELECT * FROM users WHERE id = $1', [userId])
  let u: User | undefined = rows.length ? rowToUser(rows[0]) : undefined
  if (!u) {
    const r2 = await getPool().query('SELECT * FROM users WHERE google_sub = $1', [userId])
    if (r2.rows.length) u = rowToUser(r2.rows[0])
  }
  if (!u) throw new Error('Account not found')
  if (u.provider !== 'google' && u.provider !== 'both') throw new Error('Account is not a Google account')
  const newHash = await hashPassword(password)
  await getPool().query('UPDATE users SET password_hash = $1, provider = $2, email_verified = TRUE, last_login = $3 WHERE id = $4', [newHash, 'both', Date.now(), u.id])
  u.passwordHash = newHash
  u.provider = 'both'
  u.emailVerified = true
  u.lastLogin = Date.now()
  return u
}

export function signInWithGoogle(_info: { id: string; email: string; displayName?: string; pictureUrl?: string }): User {
  // sync signature kept for compat; we do async work fire-and-forget? Better make callers await. But signature is sync.
  // We'll throw to force async usage; AuthModal uses async now. But other callers? Let's make async-internal and return a promise-cast.
  // Actually change: make this function async is not possible (returns User). We'll keep a sync cache? No.
  // Instead, convert to async function returning Promise<User> and update signature. Callers already await in AuthModal.
  // But type says User. Let's change return type to Promise<User> and update AuthModal (already awaits).
  throw new Error('use signInWithGoogleAsync')
}

export async function signInWithGoogleAsync(info: { id: string; email: string; displayName?: string; pictureUrl?: string }): Promise<User> {
  await ensureLoaded()
  const email = info.email.trim().toLowerCase()
  // find by googleSub
  const r1 = await getPool().query('SELECT * FROM users WHERE google_sub = $1', [info.id])
  if (r1.rows.length) {
    const u = rowToUser(r1.rows[0])
    await getPool().query('UPDATE users SET last_login = $1, picture_url = COALESCE($2, picture_url), display_name = COALESCE($3, display_name) WHERE id = $4', [Date.now(), info.pictureUrl ?? null, info.displayName ?? null, u.id])
    u.lastLogin = Date.now()
    if (info.pictureUrl) u.pictureUrl = info.pictureUrl
    if (info.displayName) u.displayName = info.displayName
    return u
  }
  // find by email
  const r2 = await getPool().query('SELECT * FROM users WHERE LOWER(email) = $1', [email])
  if (r2.rows.length) {
    const u = rowToUser(r2.rows[0])
    await getPool().query('UPDATE users SET google_sub = $1, provider = $2, email_verified = TRUE, last_login = $3, picture_url = COALESCE($4, picture_url), display_name = COALESCE($5, display_name) WHERE id = $6',
      [info.id, u.provider === 'email' ? 'both' : u.provider, Date.now(), info.pictureUrl ?? null, info.displayName ?? null, u.id])
    u.googleSub = info.id
    if (u.provider === 'email') u.provider = 'both'
    u.emailVerified = true
    u.lastLogin = Date.now()
    if (info.pictureUrl) u.pictureUrl = info.pictureUrl
    if (info.displayName) u.displayName = info.displayName
    return u
  }
  const now = Date.now()
  const name = info.displayName || info.email.split('@')[0] || 'Member'
  const id = uid()
  const accountId = generateAccountId(new Set((await getPool().query('SELECT account_id FROM users')).rows.map((r: any) => r.account_id).filter(Boolean)))
  await getPool().query(
    `INSERT INTO users (id, account_id, email, display_name, picture_url, google_sub, provider, email_verified, created_at, last_login)
     VALUES ($1,$2,$3,$4,$5,$6,'google',TRUE,$7,$8)`,
    [id, accountId, info.email, name, info.pictureUrl ?? null, info.id, now, now]
  )
  return { id, accountId, email: info.email, displayName: name, pictureUrl: info.pictureUrl, googleSub: info.id, provider: 'google', emailVerified: true, createdAt: now, lastLogin: now }
}

export async function getUserById(userId: string): Promise<User | undefined> {
  await ensureLoaded()
  const { rows } = await getPool().query('SELECT * FROM users WHERE id = $1', [userId])
  return rows.length ? rowToUser(rows[0]) : undefined
}

export async function getAllUsers(): Promise<User[]> {
  await ensureLoaded()
  const { rows } = await getPool().query('SELECT * FROM users')
  return rows.map(rowToUser)
}

export async function clearAllUsers(): Promise<void> {
  await ensureLoaded()
  await getPool().query('DELETE FROM users')
  await getPool().query('DELETE FROM verify_tokens')
  await getPool().query('DELETE FROM reset_tokens')
  await getPool().query('DELETE FROM code_blacklist')
  await getPool().query('DELETE FROM recent_accounts')
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  await ensureLoaded()
  await getPool().query('DELETE FROM code_blacklist WHERE expires_at <= $1', [Date.now()])
  const existingCodes = new Set<string>()
  const bl = await getPool().query('SELECT code FROM code_blacklist')
  bl.rows.forEach((r: any) => existingCodes.add(r.code))
  const vt = await getPool().query('SELECT token FROM verify_tokens')
  vt.rows.forEach((r: any) => existingCodes.add(r.token))
  const rt = await getPool().query('SELECT token FROM reset_tokens')
  rt.rows.forEach((r: any) => existingCodes.add(r.token))

  const token = generateCode(existingCodes)
  await getPool().query('INSERT INTO reset_tokens (token, user_id, expires_at, used) VALUES ($1,$2,$3,FALSE)', [token, userId, Date.now() + 20 * 60 * 1000])
  await getPool().query('INSERT INTO code_blacklist (code, expires_at) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING', [token, Date.now() + 7 * 24 * 60 * 60 * 1000])
  return token
}

export async function verifyPasswordResetToken(token: string): Promise<User | null> {
  await ensureLoaded()
  const { rows } = await getPool().query('SELECT user_id, expires_at, used FROM reset_tokens WHERE token = $1', [token])
  if (!rows.length) return null
  const r = rows[0]
  if (r.used) return null
  if (Date.now() > Number(r.expires_at)) {
    await getPool().query('DELETE FROM reset_tokens WHERE token = $1', [token])
    return null
  }
  const { rows: urows } = await getPool().query('SELECT * FROM users WHERE id = $1', [r.user_id])
  if (!urows.length) {
    await getPool().query('DELETE FROM reset_tokens WHERE token = $1', [token])
    return null
  }
  const u = rowToUser(urows[0])
  await getPool().query('UPDATE reset_tokens SET used = TRUE WHERE token = $1', [token])
  await getPool().query('INSERT INTO code_blacklist (code, expires_at) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING', [token, Date.now() + 7 * 24 * 60 * 60 * 1000])
  await getPool().query('UPDATE users SET last_login = $1 WHERE id = $2', [Date.now(), u.id])
  u.lastLogin = Date.now()
  return u
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  await ensureLoaded()
  const { rows } = await getPool().query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email])
  return rows.length ? rowToUser(rows[0]) : undefined
}

export async function getAccountByAccessId(accountId: string): Promise<User | undefined> {
  await ensureLoaded()
  const { rows } = await getPool().query('SELECT * FROM users WHERE account_id = $1', [accountId])
  return rows.length ? rowToUser(rows[0]) : undefined
}

export async function authenticateByAccessId(accountId: string): Promise<User> {
  await ensureLoaded()
  const u = await getAccountByAccessId(accountId)
  if (!u) throw new Error('login failed')
  await getPool().query('UPDATE users SET last_login = $1 WHERE id = $2', [Date.now(), u.id])
  u.lastLogin = Date.now()
  return u
}

export async function getRecentAccounts(deviceId: string): Promise<User[]> {
  await ensureLoaded()
  const { rows } = await getPool().query('SELECT user_id FROM recent_accounts WHERE device_id = $1 ORDER BY position', [deviceId])
  const result: User[] = []
  for (const r of rows) {
    const u = await getUserById(r.user_id)
    if (u) result.push(u)
  }
  return result
}

export async function addRecentAccount(deviceId: string, userId: string): Promise<void> {
  await ensureLoaded()
  // remove existing
  await getPool().query('DELETE FROM recent_accounts WHERE device_id = $1 AND user_id = $2', [deviceId, userId])
  // shift positions
  await getPool().query('UPDATE recent_accounts SET position = position + 1 WHERE device_id = $1', [deviceId])
  await getPool().query('INSERT INTO recent_accounts (device_id, user_id, position) VALUES ($1,$2,0)', [deviceId, userId])
  // keep max 5
  await getPool().query(`DELETE FROM recent_accounts WHERE device_id = $1 AND user_id NOT IN (SELECT user_id FROM recent_accounts WHERE device_id = $1 ORDER BY position LIMIT 5)`, [deviceId])
}

// client-side session helpers (no server needed)
const SESSION_KEY = 'mint.session.v1'
const RECENT_KEY = 'mint.recentAccounts.v1'
const MAX_RECENT = 5

export function saveSession(userId: string): void {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, savedAt: Date.now() })) } catch { /* ignore */ }
}

export function loadSession(): User | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { userId?: string; user?: User }
    if (parsed.user) return parsed.user
    return null
  } catch {
    return null
  }
}

export function cacheSessionUser(user: User): void {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...parsed, userId: user.id, user }))
  } catch { /* ignore */ }
}

export function clearSession(): void {
  try { localStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
}

export function getRecentAccountsLocal(): User[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    return JSON.parse(raw) as User[]
  } catch {
    return []
  }
}

export function addRecentAccountLocal(user: User): void {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    let list: User[] = raw ? JSON.parse(raw) : []
    list = [user, ...list.filter((u) => u.id !== user.id)].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch { /* ignore */ }
}

export function removeRecentAccountLocal(userId: string): void {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return
    const list: User[] = JSON.parse(raw)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.filter((u) => u.id !== userId)))
  } catch { /* ignore */ }
}

export { userDisplayName, userInitials }

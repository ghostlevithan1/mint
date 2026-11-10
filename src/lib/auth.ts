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
  createdAt: number | Date
  lastLogin: number | Date
}

// ---------- local helpers (no server) ----------

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

// ---------- HTTP helpers ----------

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`/api/auth/${path}`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (data?.error?.message as string) || `Request failed (${res.status})`
    throw new Error(msg)
  }
  return data
}

// ---------- user store (server-backed) ----------

export async function createEmailUser(email: string, password: string, displayName?: string): Promise<User> {
  const data = await api('signup', { method: 'POST', body: JSON.stringify({ email, password, displayName }) })
  return data.user as User
}

export function verifyEmail(_token: string): boolean {
  // sync wrapper not possible; return a promise-cast? Keep async via separate. We'll make async.
  return false
}

// async version used by components
export async function verifyEmailAsync(token: string): Promise<boolean> {
  const data = await api('verify-email', { method: 'POST', body: JSON.stringify({ token }) })
  return data.ok === true
}

export function createEmailVerificationToken(_userId: string): string {
  // server generates; sync not possible. Components should use async version.
  return ''
}

export async function createEmailVerificationTokenAsync(userId: string): Promise<string> {
  const data = await api('create-verify-token', { method: 'POST', body: JSON.stringify({ userId }) })
  return data.token as string
}

export async function authenticateUser(email: string, password: string): Promise<User> {
  const data = await api('login', { method: 'POST', body: JSON.stringify({ email, password }) })
  return data.user as User
}

export async function linkEmailToGoogle(userId: string, password: string): Promise<User> {
  const data = await api('link', { method: 'POST', body: JSON.stringify({ userId, password }) })
  return data.user as User
}

export function signInWithGoogle(_info: { id: string; email: string; displayName?: string; pictureUrl?: string }): User {
  // async not possible in sync signature; return a promise-cast placeholder? 
  // We'll make it async-compatible by returning a thenable. But components call onSignIn(u) synchronously in some paths.
  // Better: make async and update callers. AuthModal handleGoogle is async, so await is fine.
  throw new Error('use signInWithGoogleAsync')
}

export async function signInWithGoogleAsync(info: { id: string; email: string; displayName?: string; pictureUrl?: string }): Promise<User> {
  const data = await api('google', { method: 'POST', body: JSON.stringify(info) })
  return data.user as User
}

export async function getUserById(userId: string): Promise<User | undefined> {
  try {
    const data = await api(`me?userId=${encodeURIComponent(userId)}`, { method: 'GET' })
    return data.user as User
  } catch {
    return undefined
  }
}

export async function getAllUsers(): Promise<User[]> {
  return []
}

export function clearAllUsers(): void {
  // no-op client side
}

export async function createPasswordResetToken(_userId: string): Promise<string> {
  // server creates on forgot; this is a no-op fallback
  return ''
}

export async function forgotPassword(email: string): Promise<string> {
  const data = await api('forgot', { method: 'POST', body: JSON.stringify({ email }) })
  return data.token as string
}

export async function verifyPasswordResetToken(token: string): Promise<User | null> {
  try {
    const data = await api('reset', { method: 'POST', body: JSON.stringify({ token }) })
    return data.user as User
  } catch {
    return null
  }
}

export async function getUserByEmail(_email: string): Promise<User | undefined> {
  // no direct endpoint; try login? We'll leave undefined; server handles in forgot
  return undefined
}

export async function authenticateByAccessId(accountId: string): Promise<User> {
  const data = await api('access-id', { method: 'POST', body: JSON.stringify({ accountId }) })
  return data.user as User
}

export function getAccountByAccessId(_accountId: string): User | undefined {
  return undefined
}

// ---------- session / recent (client-side) ----------

const SESSION_KEY = 'mint.session.v1'
const RECENT_KEY = 'mint.recentAccounts.v1'
const MAX_RECENT = 5

export function saveSession(userId: string): void {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, savedAt: Date.now() })) } catch { /* ignore */ }
}

export function loadSession(): User | null {
  // session user cached locally
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

export function getRecentAccounts(): User[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    return JSON.parse(raw) as User[]
  } catch {
    return []
  }
}

export function addRecentAccount(user: User): void {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    let list: User[] = raw ? JSON.parse(raw) : []
    list = [user, ...list.filter((u) => u.id !== user.id)].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch { /* ignore */ }
}

export function removeRecentAccount(userId: string): void {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return
    const list: User[] = JSON.parse(raw)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.filter((u) => u.id !== userId)))
  } catch { /* ignore */ }
}

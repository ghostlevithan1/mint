const store = new Map()
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
}

const auth = await import('../src/lib/auth.ts')

// sign in flow: create user, save session
const u = await auth.createEmailUser('sess@test.com', 'password123')
const token = auth.createEmailVerificationToken(u.id)
auth.verifyEmail(token)
auth.saveSession(u.id)
auth.addRecentAccount(u.id)

// simulate reload: new module import reads localStorage
// (module already loaded; loadSession uses in-memory users map which persists)
const restored = auth.loadSession()
console.log('restored:', restored?.email)
if (!restored || restored.email !== 'sess@test.com') throw new Error('session restore failed')

const recents = auth.getRecentAccounts()
console.log('recents:', recents.length)
if (recents.length !== 1) throw new Error('recent accounts failed')

// sign out
auth.clearSession()
const after = auth.loadSession()
console.log('after signout:', after)
if (after !== null) throw new Error('session not cleared')

// recent accounts still present after signout
const recents2 = auth.getRecentAccounts()
console.log('recents after signout:', recents2.length)
if (recents2.length !== 1) throw new Error('recent accounts lost on signout')

console.log('PASS session/recent')

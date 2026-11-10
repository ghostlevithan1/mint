const store = new Map()
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
}

const auth = await import('../src/lib/auth.ts')

auth.clearAllUsers()
const g = auth.signInWithGoogle({ id: 'g1', email: 'guser@test.com', displayName: 'GUser' })
console.log('google user:', g.id, g.provider, g.emailVerified)

const found = auth.getUserByEmail('guser@test.com')
console.log('found by email:', !!found, found?.id === g.id)
if (!found) throw new Error('getUserByEmail failed for google account')

const token = auth.createPasswordResetToken(found.id)
console.log('reset token:', token)

const ok = auth.verifyPasswordResetToken(token)
console.log('verify:', ok?.email, ok?.provider)
if (!ok || ok.id !== g.id) throw new Error('google account code flow failed')

console.log('PASS google code flow')

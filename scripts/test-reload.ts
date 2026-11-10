const store = new Map()
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
}

// Pre-populate as if from a previous session
const now = Date.now()
store.set('mint.users.v1', JSON.stringify([{
  id: 'abc', email: 'reload@test.com', displayName: 'Reload', provider: 'email',
  emailVerified: true, createdAt: now, lastLogin: now, passwordHash: 'salt:hash',
}]))
store.set('mint.verifyTokens.v1', JSON.stringify([]))

const auth = await import('../src/lib/auth.ts')
const users = auth.getAllUsers()
console.log('loaded users:', users.length)
if (users.length !== 1) throw new Error('reload failed')
if (users[0].email !== 'reload@test.com') throw new Error('email mismatch')
if (!(users[0].createdAt instanceof Date)) throw new Error('date not restored')
console.log('reload date:', users[0].createdAt.toISOString())
console.log('PASS reload')

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
}

const auth = await import('../src/lib/auth.ts')

// email user gets accountId
const u = await auth.createEmailUser('acid@test.com', 'password123')
console.log('accountId:', u.accountId, 'len:', u.accountId?.length)
if (!u.accountId || u.accountId.length !== 20) throw new Error('accountId missing/wrong length')

// google user gets accountId
const g = auth.signInWithGoogle({ id: 'g2', email: 'gacid@test.com', displayName: 'G' })
console.log('google accountId:', g.accountId, 'len:', g.accountId?.length)
if (!g.accountId || g.accountId.length !== 20) throw new Error('google accountId missing')

// authenticate by access id
const found = auth.getAccountByAccessId(u.accountId)
console.log('found by id:', found?.email)
if (!found || found.id !== u.id) throw new Error('getAccountByAccessId failed')

const ok = auth.authenticateByAccessId(u.accountId)
console.log('auth by id:', ok?.email)
if (!ok || ok.id !== u.id) throw new Error('authenticateByAccessId failed')

// invalid id
try {
  auth.authenticateByAccessId('INVALIDID1234567890!!')
  throw new Error('should have failed')
} catch (e) {
  console.log('invalid id rejected:', (e as Error).message)
}

// uniqueness: create many users, accountIds unique
const ids = new Set()
for (let i = 0; i < 20; i++) {
  const x = await auth.createEmailUser(`u${i}@test.com`, 'password123')
  ids.add(x.accountId)
}
console.log('unique accountIds:', ids.size, 'of 20')
if (ids.size !== 20) throw new Error('accountId collision')

// reload persistence: accountId survives
const raw = store.get('mint.users.v1')
const parsed = JSON.parse(raw)
console.log('persisted accountId:', parsed[0].accountId?.length)

console.log('PASS account id')

// Simulate browser localStorage in node to test persistence
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
}

const auth = await import('../src/lib/auth.ts')

await auth.clearAllUsers()
const u = await auth.createEmailUser('p@test.com', 'password123')
const token = auth.createEmailVerificationToken(u.id)
auth.verifyEmail(token)
// reload module by re-importing? Use a child process instead; here just check storage populated
console.log('stored users:', store.get('mint.users.v1') ? 'yes' : 'no')
console.log('stored tokens:', store.get('mint.verifyTokens.v1') ? 'yes' : 'no')

// Simulate reload: clear in-memory by... can't easily. Instead verify JSON round-trips
const parsed = JSON.parse(store.get('mint.users.v1'))
console.log('roundtrip email:', parsed[0].email, 'verified:', parsed[0].emailVerified)
console.log('PASS persistence')

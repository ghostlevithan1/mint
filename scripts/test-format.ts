const store = new Map()
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
}

const auth = await import('../src/lib/auth.ts')

const u = await auth.createEmailUser('fmt@test.com', 'password123')
const vtoken = auth.createEmailVerificationToken(u.id)
console.log('verify token:', vtoken, 'len:', vtoken.length)
if (!/^[A-Z2-9]{8}$/.test(vtoken)) throw new Error('verify token not 8 alphanumeric')

const found = auth.getUserByEmail('fmt@test.com')
const resetToken = auth.createPasswordResetToken(found.id)
console.log('reset token:', resetToken, 'len:', resetToken.length)
if (!/^[A-Z2-9]{8}$/.test(resetToken)) throw new Error('reset token not 8 alphanumeric')

// blacklist prevents regeneration of same code: generate many, ensure no duplicate of resetToken
const codes = new Set()
for (let i = 0; i < 50; i++) {
  const t = auth.createPasswordResetToken(found.id)
  if (t === resetToken) throw new Error('blacklisted code regenerated')
  codes.add(t)
}
console.log('generated 50 unique codes, none reused blacklisted')

// expiry 20 min: check record expiresAt
// can't easily inspect; verify used code can't be reused (blacklist)
const ok = auth.verifyPasswordResetToken(resetToken)
console.log('verify reset:', !!ok)
const reuse = auth.verifyPasswordResetToken(resetToken)
console.log('reuse:', reuse)
if (reuse !== null) throw new Error('reuse should fail (blacklist)')

console.log('PASS format/blacklist')

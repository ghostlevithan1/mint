const store = new Map()
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
}

const auth = await import('../src/lib/auth.ts')

const u = await auth.createEmailUser('forgot@test.com', 'password123')
const vtoken = auth.createEmailVerificationToken(u.id)
auth.verifyEmail(vtoken)

// forgot flow: get user by email, create reset token
const found = auth.getUserByEmail('forgot@test.com')
console.log('found user:', !!found)
const resetToken = auth.createPasswordResetToken(found.id)
console.log('reset token:', resetToken)

// wrong code
const wrong = auth.verifyPasswordResetToken('000000')
console.log('wrong code result:', wrong)
if (wrong !== null) throw new Error('wrong code should fail')

// correct code
const ok = auth.verifyPasswordResetToken(resetToken)
console.log('correct code result:', ok?.email)
if (!ok || ok.id !== u.id) throw new Error('correct code should log in')

// reuse should fail
const reuse = auth.verifyPasswordResetToken(resetToken)
console.log('reuse result:', reuse)
if (reuse !== null) throw new Error('reuse should fail')

console.log('PASS forgot-password flow')

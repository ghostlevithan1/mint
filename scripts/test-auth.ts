import { clearAllUsers, createEmailUser, verifyEmail, createEmailVerificationToken, authenticateUser, signInWithGoogle, linkEmailToGoogle, getAllUsers } from '../src/lib/auth'

async function main() {
  clearAllUsers()
  // 1. signup
  const u = await createEmailUser('alice@example.com', 'password123', 'Alice')
  console.log('signup:', u.id, u.email, u.emailVerified, u.provider)
  if (u.emailVerified) throw new Error('should not be verified yet')

  // 2. verify
  const token = createEmailVerificationToken(u.id)
  console.log('token:', token)
  const ok = verifyEmail(token)
  console.log('verify:', ok)
  if (!ok) throw new Error('verify failed')

  // 3. login
  const logged = await authenticateUser('alice@example.com', 'password123')
  console.log('login:', logged.id, logged.emailVerified)
  if (logged.id !== u.id) throw new Error('login returned different user')

  // 4. wrong password
  try {
    await authenticateUser('alice@example.com', 'wrong')
    throw new Error('should have thrown')
  } catch (e) {
    console.log('wrong password rejected:', (e as Error).message)
  }

  // 5. google sign in new
  const g = signInWithGoogle({ id: 'g-1', email: 'bob@example.com', displayName: 'Bob' })
  console.log('google new:', g.id, g.provider, g.emailVerified)
  if (g.provider !== 'google') throw new Error('expected google')

  // 6. google sign in same email unifies
  const g2 = signInWithGoogle({ id: 'g-2', email: 'alice@example.com', displayName: 'Alice G' })
  console.log('google unify:', g2.id, g2.provider, g2.googleSub)
  if (g2.id !== u.id) throw new Error('should unify with existing email user')
  if (g2.provider !== 'both') throw new Error('should become both')

  // 7. link email password to google account
  const linked = await linkEmailToGoogle(g.id, 'newpass1234')
  console.log('linked:', linked.id, linked.provider, !!linked.passwordHash)
  if (linked.provider !== 'both') throw new Error('not both')

  // 8. login with linked password
  const l = await authenticateUser('bob@example.com', 'newpass1234')
  console.log('linked login:', l.id)
  if (l.id !== g.id) throw new Error('linked login mismatch')

  console.log('ALL USERS:', getAllUsers().length)
  console.log('PASS')
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })

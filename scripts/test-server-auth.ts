const BASE = 'http://localhost:3000'

async function post(path, body) {
  const res = await fetch(`${BASE}/api/auth/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || res.status)
  return data
}

// signup
const su = await post('signup', { email: 'srv@test.com', password: 'password123', displayName: 'Srv' })
console.log('signup:', su.user.id, su.user.accountId, su.token)
const token = su.token

// verify email
const ve = await post('verify-email', { token })
console.log('verify-email:', ve.ok)
if (!ve.ok) throw new Error('verify failed')

// login
const li = await post('login', { email: 'srv@test.com', password: 'password123' })
console.log('login:', li.user.id === su.user.id)

// google
const gu = await post('google', { id: 'g-srv', email: 'srv@test.com', displayName: 'Srv G' })
console.log('google unify:', gu.user.id === su.user.id, gu.user.provider)

// forgot + reset
const f = await post('forgot', { email: 'srv@test.com' })
console.log('forgot token:', f.token)
const ru = await post('reset', { token: f.token })
console.log('reset login:', ru.user.id === su.user.id)

// access-id
const au = await post('access-id', { accountId: su.user.accountId })
console.log('access-id login:', au.user.id === su.user.id)

// link
const lu = await post('link', { userId: gu.user.id, password: 'newpass1234' })
console.log('link:', lu.user.provider)

console.log('ALL PASS')

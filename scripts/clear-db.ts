import { Pool } from 'pg'
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await p.query('DELETE FROM users')
await p.query('DELETE FROM verify_tokens')
await p.query('DELETE FROM reset_tokens')
await p.query('DELETE FROM code_blacklist')
await p.query('DELETE FROM recent_accounts')
console.log('cleared')
await p.end()

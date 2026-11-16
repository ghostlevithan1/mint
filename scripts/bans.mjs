#!/usr/bin/env node
/**
 * See and manage the devices Mint has banned.
 *
 *   npm run bans                 active bans
 *   npm run bans -- --all        also finished and lifted ones (kept for 7 days)
 *   npm run bans -- remove <id>  lift one ban (the id, or its first 6+ characters)
 *   npm run bans -- clear        lift every active ban
 *
 * It edits data/device-bans.json (or $MINT_DATA_DIR/device-bans.json); a running
 * server notices within a few seconds. A lifted ban stays on file, marked as
 * lifted: a ban is also written into the banned browser's own cookie, and the
 * mark is what tells the server to ignore that cookie from now on.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const dir = process.env.MINT_DATA_DIR ? resolve(process.env.MINT_DATA_DIR) : resolve(process.cwd(), 'data')
const file = resolve(dir, 'device-bans.json')

function load() {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    return Array.isArray(data.bans) ? data.bans : []
  } catch {
    return []
  }
}

function save(bans) {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  writeFileSync(temporary, JSON.stringify({ version: 1, bans }, null, 2))
  renameSync(temporary, file)
}

function left(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const [command, argument] = process.argv.slice(2)
const now = Date.now()
const bans = load()
const isActive = (ban) => ban.expiresAt > now && !ban.liftedAt
const lift = (ban) => ({ ...ban, liftedAt: now, expiresAt: Math.min(ban.expiresAt, now) })

if (command === 'remove') {
  if (!argument || argument.length < 6) {
    console.error('Give the device id, or at least its first 6 characters: npm run bans -- remove <id>')
    process.exit(1)
  }
  const matches = bans.filter((ban) => ban.id.startsWith(argument) && isActive(ban))
  if (matches.length !== 1) {
    console.error(
      matches.length
        ? `"${argument}" matches ${matches.length} banned devices; use more characters.`
        : `No active ban starts with "${argument}".`,
    )
    process.exit(1)
  }
  save(bans.map((ban) => (ban.id === matches[0].id ? lift(ban) : ban)))
  console.log(`Lifted the ban on ${matches[0].id}.`)
} else if (command === 'clear') {
  const active = bans.filter(isActive).length
  save(bans.map((ban) => (isActive(ban) ? lift(ban) : ban)))
  console.log(`Lifted ${active} ban${active === 1 ? '' : 's'}.`)
} else if (command === undefined || command === '--all' || command === 'list') {
  const shown = bans
    .filter((ban) => command === '--all' || isActive(ban))
    .sort((a, b) => b.bannedAt - a.bannedAt)
  if (!shown.length) {
    console.log(command === '--all' ? 'No bans on file.' : 'No active bans.')
  } else {
    for (const ban of shown) {
      const state = ban.liftedAt ? 'lifted' : isActive(ban) ? `ACTIVE ${left(ban.expiresAt - now)} left` : 'finished'
      console.log(
        [
          ban.id,
          state,
          `banned ${new Date(ban.bannedAt).toISOString()}`,
          `signals: ${ban.signals.join(', ')}`,
          `network ${ban.network || '-'}`,
          ban.userAgent ? `"${ban.userAgent}"` : '',
        ]
          .filter(Boolean)
          .join('  '),
      )
    }
  }
} else {
  console.error('Usage: npm run bans [-- --all | remove <id> | clear]')
  process.exit(1)
}

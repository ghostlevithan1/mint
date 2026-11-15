import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import {
  BlockedAddressError,
  createGuardedLookup,
  fetchGuarded,
  isBlockedIp,
} from '../server/safe-fetch'

test('local, private and embedded-IPv4 addresses are blocked', () => {
  const blocked = [
    '127.0.0.1',
    '10.24.148.160',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::',
    '::1',
    'fe80::1',
    'fd12:3456::1',
    'ff02::1',
    // IPv4 loopback and private ranges written as IPv6.
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a00:1',
    '::127.0.0.1',
    // Tunnels that reach IPv4 hosts.
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    '2001:db8::1',
    'not an address',
  ]
  for (const ip of blocked) assert.equal(isBlockedIp(ip), true, `${ip} should be blocked`)
})

test('public addresses are allowed', () => {
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '::ffff:5db8:d822']) {
    assert.equal(isBlockedIp(ip), false, `${ip} should be allowed`)
  }
})

function resolveVia(lookup: ReturnType<typeof createGuardedLookup>, host: string, options = {}) {
  return new Promise<{ error: Error | null; address?: unknown; family?: number }>((resolve) => {
    lookup(host, options, (error, address, family) => resolve({ error, address, family }))
  })
}

test('the lookup refuses a host if any of its addresses is internal', async () => {
  const answers: Record<string, Array<{ address: string; family: number }>> = {
    'public.test': [{ address: '93.184.216.34', family: 4 }],
    'private.test': [{ address: '10.0.0.5', family: 4 }],
    // A record set that hides an internal address beside a public one.
    'mixed.test': [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ],
    'v6.test': [{ address: '2606:4700:4700::1111', family: 6 }],
  }
  const lookup = createGuardedLookup({ resolver: async (host) => answers[host] ?? [] })

  const ok = await resolveVia(lookup, 'public.test')
  assert.equal(ok.error, null)
  assert.equal(ok.address, '93.184.216.34')
  assert.equal(ok.family, 4)

  const all = await resolveVia(lookup, 'public.test', { all: true })
  assert.deepEqual(all.address, answers['public.test'])

  assert.ok((await resolveVia(lookup, 'private.test')).error instanceof BlockedAddressError)
  assert.ok((await resolveVia(lookup, 'mixed.test')).error instanceof BlockedAddressError)
  assert.ok((await resolveVia(lookup, 'mixed.test', { all: true })).error instanceof BlockedAddressError)

  // A family the host does not have is a normal lookup miss, not a block.
  const wrongFamily = await resolveVia(lookup, 'v6.test', { family: 4 })
  assert.equal((wrongFamily.error as NodeJS.ErrnoException).code, 'ENOTFOUND')
  assert.equal((await resolveVia(lookup, 'v6.test', { family: 6 })).error, null)
  assert.equal((await resolveVia(lookup, 'unknown.test')).error?.name, 'Error')
})

test('a name that resolves to an internal address is never connected to', async () => {
  let hits = 0
  const server = createServer((req, res) => {
    hits += 1
    if (req.url === '/gz') {
      res.setHeader('content-encoding', 'gzip')
      res.end(gzipSync('compressed hello'))
      return
    }
    res.end('plain hello')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  // Every name points at the loopback server, as a rebinding attacker's would.
  const resolver = async () => [{ address: '127.0.0.1', family: 4 }]

  try {
    await assert.rejects(
      fetchGuarded(new URL(`http://rebind.example:${port}/`), {}, { resolver }),
      BlockedAddressError,
    )
    // An address typed into the URL skips DNS, so it is checked directly.
    await assert.rejects(fetchGuarded(new URL(`http://127.0.0.1:${port}/`)), BlockedAddressError)
    await assert.rejects(fetchGuarded(new URL(`http://[::1]:${port}/`)), BlockedAddressError)
    assert.equal(hits, 0, 'the server must never have been reached')

    // With the guard relaxed the same request works, so the block above is the guard's doing.
    const allowAll = { resolver, isBlocked: () => false }
    const plain = await fetchGuarded(new URL(`http://ok.example:${port}/`), {}, allowAll)
    assert.equal(plain.status, 200)
    assert.equal(await plain.text(), 'plain hello')

    const zipped = await fetchGuarded(new URL(`http://zip.example:${port}/gz`), {}, allowAll)
    assert.equal(await zipped.text(), 'compressed hello')
    assert.equal(zipped.headers.get('content-encoding'), null)
    assert.equal(hits, 2)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

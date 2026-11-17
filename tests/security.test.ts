import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { deflateRawSync } from 'node:zlib'

const dataDir = mkdtempSync(join(tmpdir(), 'mint-security-'))
process.env.MINT_DEVICE_SECRET = 'security-test-secret-0123456789abcdef'
process.env.MINT_DATA_DIR = dataDir
delete process.env.MINT_RATE_LIMIT
delete process.env.RENDER

const { BanStore, MAX_RECORDS } = await import('../server/bans')
const { crossSiteRefusal, guardApi, networkOf } = await import('../server/limits')
const { resetTamperState, trackPathTamper } = await import('../server/tamper')
const { stripHtml } = await import('../server/web')
const { readJsonBody } = await import('../server/node-http')
const { documentToMarkdown } = await import('../src/lib/documents')
const { sheetLines } = await import('../src/lib/files')
const { buildPdf } = await import('../src/lib/pdfWriter')
const { parseXml, textOf } = await import('../src/lib/xmlScan')

function request(headers: Record<string, string>, extra: Record<string, unknown> = {}) {
  return { headers, socket: { remoteAddress: '203.0.113.9' }, url: '/api/chat', ...extra } as unknown as IncomingMessage
}

function response() {
  const raw = {
    statusCode: 0,
    writableEnded: false,
    body: '',
    headers: new Map<string, unknown>(),
    setHeader(name: string, value: unknown) {
      this.headers.set(name.toLowerCase(), value)
    },
    getHeader(name: string) {
      return this.headers.get(name.toLowerCase())
    },
    end(chunk?: string) {
      this.writableEnded = true
      this.body = chunk ?? ''
    },
  }
  return { raw, res: raw as unknown as ServerResponse }
}

/** Fails if `fn` takes longer than `ms`. The inputs are sized so quadratic code takes many seconds. */
function within(ms: number, fn: () => unknown) {
  const started = performance.now()
  fn()
  const took = performance.now() - started
  assert.ok(took < ms, `took ${Math.round(took)} ms, expected under ${ms} ms`)
}

async function withinAsync(ms: number, fn: () => Promise<unknown>) {
  const started = performance.now()
  await fn()
  const took = performance.now() - started
  assert.ok(took < ms, `took ${Math.round(took)} ms, expected under ${ms} ms`)
}

function zip(name: string, text: string): Uint8Array {
  const n = Buffer.from(name)
  const raw = Buffer.from(text)
  const data = deflateRawSync(raw)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(n.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(raw.length, 24)
  central.writeUInt16LE(n.length, 28)
  const directory = Buffer.concat([central, n])
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(30 + n.length + data.length, 16)
  return new Uint8Array(Buffer.concat([local, n, data, directory, end]))
}

/* ---------------------------------------------- server: page reader */

test('the page reader strips hostile HTML in linear time', () => {
  within(1500, () => stripHtml('<'.repeat(1_500_000)))
  within(1500, () => stripHtml('<script>'.repeat(200_000)))
  within(1500, () => stripHtml('<!--'.repeat(300_000)))
  within(1500, () => stripHtml('<title>'.repeat(200_000)))
})

test('the page reader keeps its text output', () => {
  const html =
    '<html><head><title>T</title><style>p{}</style></head><body><h1>Head</h1><p>One &amp; two</p>' +
    '<ul><li>a</li><li>b</li></ul><script>x<y</script>a < b<br>end</body></html>'
  const text = stripHtml(html)
  assert.ok(!text.includes('p{}') && !text.includes('x<y') && !text.includes('T '))
  assert.match(text, /Head\s*\n/)
  assert.match(text, /\n• a/)
  assert.match(text, /a < b\nend/)
  // HTML lets </head> be left out: the body must still be read.
  assert.match(stripHtml('<head><title>x</title><body><p>visible</p>'), /visible/)
  // <header> is page content, not the <head>.
  assert.match(stripHtml('<header>Site name</header><p>hi</p>'), /Site name/)
})

/* -------------------------------------------- server: request rules */

test('cross-site and non-JSON API posts are refused, the app itself is not', () => {
  const host = 'mint.example'
  const own = { host, 'content-type': 'application/json', origin: 'https://mint.example', 'sec-fetch-site': 'same-origin' }
  assert.equal(crossSiteRefusal(request(own, { method: 'POST' })), null)
  assert.equal(crossSiteRefusal(request({ host, 'content-type': 'application/json' }, { method: 'POST' })), null)
  assert.equal(crossSiteRefusal(request({ ...own, 'content-type': 'text/plain' }, { method: 'POST' }))?.status, 415)
  assert.equal(crossSiteRefusal(request({ ...own, 'sec-fetch-site': 'cross-site' }, { method: 'POST' }))?.status, 403)
  assert.equal(crossSiteRefusal(request({ ...own, origin: 'https://evil.example' }, { method: 'POST' }))?.status, 403)
  assert.equal(crossSiteRefusal(request({ ...own, origin: 'null' }, { method: 'POST' }))?.status, 403)
  assert.equal(crossSiteRefusal(request({ host }, { method: 'GET' })), null)

  const { raw, res } = response()
  assert.equal(guardApi(request({ ...own, 'content-type': 'text/plain' }, { method: 'POST' }), res, 'chat'), false)
  assert.equal(raw.statusCode, 415)
})

test('IPv6 visitors are counted per /64, IPv4 per address', () => {
  assert.equal(networkOf('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64')
  assert.equal(networkOf('2001:db8:1:2:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64')
  assert.equal(networkOf('2001:0db8::1'), '2001:db8:0:0::/64')
  assert.equal(networkOf('::ffff:203.0.113.5'), '203.0.113.5')
  assert.equal(networkOf('203.0.113.5'), '203.0.113.5')
  assert.equal(networkOf('unknown'), 'unknown')
})

test('a link from another site cannot earn the visitor a path strike', () => {
  resetTamperState()
  const { raw, res } = response()
  for (let index = 0; index < 5; index += 1) {
    trackPathTamper(request({ 'sec-fetch-site': 'cross-site' }, { url: '/x%00' }), res)
  }
  assert.equal(raw.statusCode, 0)
  assert.equal(raw.headers.has('set-cookie'), false)
})

test('the ban file is capped and keeps active bans first', () => {
  const file = join(dataDir, 'cap-bans.json')
  const cap = 200
  assert.ok(MAX_RECORDS >= cap)
  const store = new BanStore(file, cap)
  const now = Date.now()
  for (let index = 0; index < cap + 50; index += 1) {
    store.add({ id: `d${index}`, bannedAt: now - index, expiresAt: index < 10 ? now - 1 : now + 60_000, signals: ['x'], userAgent: '', network: '' })
  }
  const saved = JSON.parse(readFileSync(file, 'utf8')).bans as { id: string }[]
  assert.equal(saved.length, cap)
  assert.ok(!saved.some((record) => ['d0', 'd5', 'd9'].includes(record.id)), 'finished bans are dropped first')
})

test('an oversized body is refused from Content-Length without reading it', async () => {
  const listeners = new Map<string, unknown>()
  const req = {
    headers: { 'content-length': '999999999' },
    on: (event: string, fn: unknown) => listeners.set(event, fn),
    removeAllListeners: () => undefined,
    pause: () => undefined,
  } as unknown as IncomingMessage
  await assert.rejects(readJsonBody(req, undefined, 1024), /too large/)
})

/* ------------------------------------------ browser: file converters */

test('crafted documents convert in linear time', async () => {
  await withinAsync(3000, () => documentToMarkdown(zip('word/document.xml', '<w:p>x'.repeat(400_000)), 'docx'))
  await withinAsync(3000, () => documentToMarkdown(zip('word/document.xml', '<w:p><w:t>'.repeat(200_000)), 'docx'))
  await withinAsync(3000, () => documentToMarkdown(zip('a.xhtml', '<script>'.repeat(300_000)), 'epub'))
  await withinAsync(3000, () => documentToMarkdown(zip('content.xml', '<text:p>'.repeat(300_000)), 'odt'))
  within(3000, () => sheetLines('<row><c>'.repeat(300_000), []))
  within(1500, () => parseXml('<'.repeat(2_000_000) + '>'))
  within(1500, () => parseXml(`<a b="${'x'.repeat(2_000_000)}`))
})

test('deep nesting is capped instead of overflowing the stack', () => {
  const deep = parseXml('<a>'.repeat(200_000) + 'hi')
  assert.equal(textOf(deep, () => undefined, true), 'hi')
})

test('the PDF writer wraps a huge unbroken word quickly', () => {
  within(1500, () => buildPdf({ title: '', filename: 'a.pdf', blocks: [{ type: 'text', text: 'W'.repeat(8000) }] }))
})

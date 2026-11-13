import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatTitle, type Conversation } from '../src/lib/chat'
import { extractUrls } from '../src/lib/web'
import {
  detectRedactions,
  redactText,
  rehydrateText,
  formatBytes,
} from '../src/lib/privacy'
import { compactedHistory } from '../src/lib/context'
import {
  contextMaxTokens,
  formatTokens,
  growContextWindow,
  initialContextWindow,
} from '../src/lib/context'
import { extractImageLinks, isImageLine, isImageUrl } from '../src/lib/imageLinks'
import { describeFence } from '../src/lib/generatedFiles'
import { CHAT_RATE_LIMIT, WEB_RATE_LIMIT, guardApi } from '../server/limits'

test('PII shield round-trips an email, phone, and name', () => {
  const original =
    'Jane Doe sent this to alice.johnson@example.com or called +1 415 555 0132 today.'
  const redactions = detectRedactions(original)
  const kinds = new Set(redactions.map((item) => item.kind))
  assert.ok(kinds.has('email'), 'email is detected')
  assert.ok(kinds.has('phone'), 'phone is detected')
  assert.ok(kinds.has('name'), 'name is detected')

  const redacted = redactText(original, redactions)
  assert.ok(!redacted.includes('alice.johnson@example.com'))
  assert.ok(!redacted.includes('Jane Doe'))
  assert.equal(rehydrateText(redacted, redactions), original)
})

test('greetings and the product name are not treated as people', () => {
  assert.equal(detectRedactions('Hello Mint, say hi in one short sentence.').length, 0)
  assert.equal(detectRedactions('Hi there, summarize this file.').length, 0)
  assert.equal(detectRedactions('Thanks, that worked.').length, 0)
})

test('extractUrls dedupes, strips trailing punctuation, and caps at three', () => {
  const urls = extractUrls(
    'See https://example.com/a, https://example.com/a and (https://example.org/b). ' +
      'Also https://example.net/c and https://example.net/d.',
  )
  assert.deepEqual(urls, [
    'https://example.com/a',
    'https://example.org/b',
    'https://example.net/c',
  ])
})

test('chat titles collapse whitespace and truncate long prompts', () => {
  assert.equal(buildChatTitle('  Hello   world  ', []), 'Hello world')
  const long = 'a'.repeat(80)
  const title = buildChatTitle(long, [])
  assert.equal(title.length, 49)
  assert.ok(title.endsWith('…'))
  assert.equal(buildChatTitle('', [{ name: 'notes.md' } as never]), 'Review notes.md')
  assert.equal(buildChatTitle('', []), 'New chat')
})

test('compacted history keeps the summary and the newest turns', () => {
  const conversation: Conversation = {
    id: 'c1',
    title: 'Test',
    createdAt: 0,
    updatedAt: 0,
    messages: [
      { id: '1', role: 'user', content: 'old question', createdAt: 1 },
      { id: '2', role: 'assistant', content: 'old answer', createdAt: 2 },
      { id: '3', role: 'user', content: 'middle question', createdAt: 3 },
      { id: '4', role: 'assistant', content: 'middle answer', createdAt: 4 },
      { id: '5', role: 'user', content: 'newest question', createdAt: 5 },
      { id: '6', role: 'assistant', content: 'newest answer', createdAt: 6 },
    ],
  }
  const compacted = compactedHistory(conversation.messages, 'Summary of earlier turns.', 2)
  assert.equal(compacted[0].role, 'system')
  assert.match(compacted[0].content, /Summary of earlier turns\./)
  assert.equal(compacted.length, 3)
  assert.equal(compacted[1].content, 'newest question')
  assert.equal(compacted[2].content, 'newest answer')
})

test('the chat rate limit answers 429 after the budget', () => {
  const previous = process.env.MINT_RATE_LIMIT
  const headers = new Map<string, string>()
  const res = {
    statusCode: 0,
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value)
    },
    end(chunk?: string) {
      this.writableEnded = true
      this.body = chunk ?? ''
    },
  }
  // One hit per unique IP keeps this test independent of the other cases.
  const req = {
    headers: { 'x-forwarded-for': '198.51.100.77' },
    socket: {},
  }
  try {
    assert.equal(CHAT_RATE_LIMIT, 15)
    assert.equal(WEB_RATE_LIMIT, 60)
    process.env.MINT_RATE_LIMIT = '1'
    assert.equal(guardApi(req as never, res as never, 'chat'), true)
    assert.equal(guardApi(req as never, res as never, 'chat'), false)
    assert.equal(res.statusCode, 429)
    assert.ok(headers.get('retry-after'))
    assert.match(res.body, /Limit reached/)
  } finally {
    if (previous === undefined) delete process.env.MINT_RATE_LIMIT
    else process.env.MINT_RATE_LIMIT = previous
  }
})

test('byte formatting stays readable across units', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')
})

test('context windows grow by powers of two up to the model maximum', () => {
  const model = { context: '128K' } as never
  const max = contextMaxTokens(model)
  assert.equal(max, 131_072)
  assert.equal(initialContextWindow(max), 2048)
  assert.equal(growContextWindow(2048, max), 4096)
  assert.equal(growContextWindow(3000, max), 4096)
  assert.equal(growContextWindow(16_384, 16_384), 16_384)
  assert.equal(growContextWindow(2048, 3000), 3000)
})

test('token counts format compactly', () => {
  assert.equal(formatTokens(950), '950')
  assert.equal(formatTokens(1500), '1.5K')
  assert.equal(formatTokens(2048), '2K')
  assert.equal(formatTokens(12_000), '12K')
  assert.equal(formatTokens(1_000_000), '1M')
  assert.equal(formatTokens(2_500_000), '2.5M')
})

test('image links require https and keep their alt text', () => {
  assert.equal(isImageUrl('https://example.com/plot.png'), true)
  assert.equal(isImageUrl('http://example.com/plot.png'), false)
  assert.equal(isImageUrl('https://example.com/plot'), false)
  assert.deepEqual(isImageLine('![A chart](https://example.com/chart.webp)'), {
    url: 'https://example.com/chart.webp',
    alt: 'A chart',
  })
  assert.deepEqual(isImageLine('https://example.com/photo.jpg'), {
    url: 'https://example.com/photo.jpg',
    alt: 'photo.jpg',
  })
  assert.equal(isImageLine('Look at https://example.com/photo.jpg'), null)
  assert.deepEqual(
    extractImageLinks('https://example.com/a.png and https://example.com/a.png'),
    [{ url: 'https://example.com/a.png', alt: 'a.png' }],
  )
})

test('fenced code info strings produce a safe download name', () => {
  assert.deepEqual(describeFence('ts title="app.ts"', 0), {
    language: 'ts',
    filename: 'app.ts',
    extension: 'ts',
  })
  assert.deepEqual(describeFence('python', 2), {
    language: 'python',
    filename: 'mint-snippet-3.py',
    extension: 'py',
  })
  assert.deepEqual(describeFence('', 0), {
    language: 'txt',
    filename: 'mint-snippet-1.txt',
    extension: 'txt',
  })
})

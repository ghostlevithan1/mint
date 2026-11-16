import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatTitle, type Conversation } from '../src/lib/chat'
import { extractUrls } from '../src/lib/web'
import {
  detectRedactions,
  mergeRedactions,
  redactText,
  rehydrateText,
  formatBytes,
} from '../src/lib/privacy'
import {
  buildContextMessages,
  compactedHistory,
  contextLimitTokens,
  conversationRedactions,
  redactContextMessages,
  contextMaxTokens,
  formatTokens,
  retryOutputBudget,
  spentReasoningOnly,
} from '../src/lib/context'
import { extractImageLinks, imageHost, isImageLine, isImageUrl } from '../src/lib/imageLinks'
import { allowImageHost, isImageHostAllowed } from '../src/lib/imageHosts'
import { describeFence } from '../src/lib/generatedFiles'
import { sheetLines, unescapeXml } from '../src/lib/files'
import { CHAT_RATE_LIMIT, WEB_RATE_LIMIT, clientAddress, guardApi } from '../server/limits'
import { cleanTitle } from '../server/web'

// The limiter now issues a signed device cookie; give it a fixed secret so the
// tests never write a secret file into the project.
process.env.MINT_DEVICE_SECRET ??= 'unit-test-secret-0123456789abcdef'

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

test('earlier turns, the profile and summaries stay shielded on later requests', () => {
  const first = detectRedactions('My name is Jane Doe, email jane.doe@example.com.')
  const history = [
    {
      id: '1',
      role: 'user' as const,
      content: 'My name is Jane Doe, email jane.doe@example.com.',
      createdAt: 1,
    },
    {
      id: '2',
      role: 'assistant' as const,
      // Answers are restored locally, so the stored reply holds the real name.
      content: 'Nice to meet you, Jane Doe. I will write to jane.doe@example.com.',
      createdAt: 2,
      redactions: first,
    },
  ]
  // The new turn numbers its own people from 01 as well.
  const current = detectRedactions('Please ask Omar Haddad about the lab.')
  const all = conversationRedactions(history, 'I live near Priya Nair.', current)

  // Placeholders never repeat for different people, and the new turn keeps its own.
  const placeholders = all.map((item) => item.placeholder)
  assert.equal(new Set(placeholders).size, placeholders.length)
  assert.equal(all.find((item) => item.original === 'Omar Haddad')?.placeholder, current[0].placeholder)

  const sent = redactContextMessages(buildContextMessages(history, 90_000), all)
  const wire = JSON.stringify(sent)
  assert.ok(!wire.includes('Jane Doe'), 'earlier name leaked')
  assert.ok(!wire.includes('jane.doe@example.com'), 'earlier email leaked')
  assert.ok(!redactText('I live near Priya Nair.', all).includes('Priya'), 'profile leaked')

  // The placeholders in the answer come back as the real text on this device.
  assert.equal(
    rehydrateText(redactText(history[1].content, all), all),
    history[1].content,
  )

  // Compaction drops the turns that carried the list, so the summary keeps it.
  const compacted = compactedHistory(history as never, 'Jane Doe emailed.', 1, all)
  assert.equal(compacted[0].role, 'system')
  const sentAfter = JSON.stringify(
    redactContextMessages(buildContextMessages(compacted, 90_000), compacted[0].redactions ?? []),
  )
  assert.ok(!sentAfter.includes('Jane Doe') && !sentAfter.includes('jane.doe@example.com'))
})

test('merged redactions keep one placeholder per person', () => {
  const merged = mergeRedactions(
    [{ original: 'Ana Silva', placeholder: '[PERSON_01]', kind: 'name' }],
    [
      { original: 'ana silva', placeholder: '[PERSON_01]', kind: 'name' },
      { original: 'Bo Chen', placeholder: '[PERSON_01]', kind: 'name' },
      { original: 'bo@example.com', placeholder: '[EMAIL_01]', kind: 'email' },
    ],
  )
  assert.deepEqual(
    merged.map((item) => [item.original, item.placeholder]),
    [
      ['Ana Silva', '[PERSON_01]'],
      ['Bo Chen', '[PERSON_02]'],
      ['bo@example.com', '[EMAIL_01]'],
    ],
  )
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

test('extractUrls keeps balanced brackets inside a link', () => {
  assert.deepEqual(
    extractUrls('Read https://en.wikipedia.org/wiki/Mercury_(planet), then (https://example.org/b).'),
    ['https://en.wikipedia.org/wiki/Mercury_(planet)', 'https://example.org/b'],
  )
  assert.deepEqual(extractUrls('see [this](https://example.com/page) now'), ['https://example.com/page'])
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
    getHeader(name: string) {
      return headers.get(name.toLowerCase())
    },
    end(chunk?: string) {
      this.writableEnded = true
      this.body = chunk ?? ''
    },
  }
  // One hit per unique IP keeps this test independent of the other cases.
  const req = {
    headers: {},
    socket: { remoteAddress: '198.51.100.77' },
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

test('a client cannot pick its own rate-limit bucket with X-Forwarded-For', () => {
  const saved = {
    render: process.env.RENDER,
    trust: process.env.MINT_TRUST_PROXY_HEADERS,
    hops: process.env.MINT_PROXY_HOPS,
  }
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  const request = (headers: Record<string, string>) =>
    ({ headers, socket: { remoteAddress: '10.0.0.9' } }) as never
  try {
    delete process.env.RENDER
    delete process.env.MINT_TRUST_PROXY_HEADERS
    delete process.env.MINT_PROXY_HOPS

    // Untrusted setup: forwarded headers are ignored, the socket decides.
    assert.equal(
      clientAddress(request({ 'x-forwarded-for': '203.0.113.5', 'cf-connecting-ip': '203.0.113.6' })),
      '10.0.0.9',
    )

    // On Render the edge-set headers identify the visitor, not the spoofed XFF.
    process.env.RENDER = 'true'
    assert.equal(
      clientAddress(
        request({
          'x-forwarded-for': '198.51.100.77,188.70.47.204, 162.158.42.184, 10.24.148.160',
          'true-client-ip': '188.70.47.204',
        }),
      ),
      '188.70.47.204',
    )
    assert.equal(clientAddress(request({ 'cf-connecting-ip': '188.70.47.204' })), '188.70.47.204')
    // A malformed header value is not used as a bucket key.
    assert.equal(clientAddress(request({ 'true-client-ip': 'not an ip' })), '10.0.0.9')
    delete process.env.RENDER

    // Other proxies: count entries from the right, where the proxy appended.
    process.env.MINT_PROXY_HOPS = '2'
    assert.equal(
      clientAddress(request({ 'x-forwarded-for': 'spoofed, 188.70.47.204, 162.158.42.184' })),
      '188.70.47.204',
    )
  } finally {
    restore('RENDER', saved.render)
    restore('MINT_TRUST_PROXY_HEADERS', saved.trust)
    restore('MINT_PROXY_HOPS', saved.hops)
  }
})

test('byte formatting stays readable across units', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')
})

test('the context limit is the model window, capped below the proxy body limit', () => {
  assert.equal(contextMaxTokens({ context: '128K' } as never), 131_072)
  assert.equal(contextLimitTokens({ context: '128K' } as never), 96_000)
  assert.equal(contextLimitTokens({ context: '32K' } as never), 32_768)
})

test('follow-up questions carry the earlier turns in full', () => {
  const answer = 'The roots are x = -1 and x = 3. '.repeat(60)
  const history = [
    { id: '1', role: 'user' as const, content: 'Plot y = x^2 - 2x - 3', createdAt: 1 },
    { id: '2', role: 'assistant' as const, content: answer, createdAt: 2 },
  ]
  const sent = buildContextMessages(history, 90_000)
  assert.equal(sent.length, 2)
  assert.equal(sent[0].content, 'Plot y = x^2 - 2x - 3')
  assert.equal(sent[1].content, answer)
})

test('a long thread keeps its newest turns instead of dropping them', () => {
  // Six turns of roughly 10K tokens each fit a 90K budget, so none may be cut.
  const history = Array.from({ length: 6 }, (_, index) => ({
    id: String(index),
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `turn ${index} `.padEnd(40_000, 'x'),
    createdAt: index,
  }))
  const sent = buildContextMessages(history, 90_000)
  assert.equal(sent.length, 6)
  assert.equal(sent[5].content, history[5].content)

  // Over budget: the oldest turns go, the newest stay whole.
  const trimmed = buildContextMessages(history, 35_000)
  assert.equal(trimmed.at(-1)?.content, history[5].content)
  assert.ok(trimmed.length >= 2 && trimmed.length < 6)

  // A summary is paid for out of the same budget and still comes first.
  const withSummary = buildContextMessages(
    [{ id: 's', role: 'system' as const, content: 'Earlier: the student studies maths.', createdAt: 0 }, ...history],
    90_000,
  )
  assert.equal(withSummary[0].role, 'system')
  assert.equal(withSummary.at(-1)?.content, history[5].content)
})

test('a retry gets more output room without exceeding the proxy ceiling', () => {
  assert.equal(retryOutputBudget(8192), 12_288)
  assert.equal(retryOutputBudget(12_288), 16_384)
  assert.equal(retryOutputBudget(16_384), 16_384)
})

test('a reasoning-only failure is retried once', () => {
  assert.equal(spentReasoningOnly('length', '', 'thinking'), true)
  assert.equal(spentReasoningOnly('length', '   ', 'thinking'), true)
  assert.equal(spentReasoningOnly('length', 'answer', 'thinking'), false)
  assert.equal(spentReasoningOnly('stop', '', 'thinking'), false)
  assert.equal(spentReasoningOnly('length', '', ''), false)
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

test('images in answers are held back until their site is allowed', () => {
  assert.equal(imageHost('https://www.Example.com/a/b.png?x=1'), 'example.com')
  assert.equal(imageHost('not a url'), '')

  assert.equal(isImageHostAllowed('cdn.test-images.example'), false)
  allowImageHost('CDN.Test-Images.example')
  assert.equal(isImageHostAllowed('cdn.test-images.example'), true)
  assert.equal(isImageHostAllowed('www.cdn.test-images.example'), true)
  // Allowing one site never allows another, even one that merely contains it.
  assert.equal(isImageHostAllowed('evil-cdn.test-images.example'), false)
  assert.equal(isImageHostAllowed('test-images.example'), false)
  allowImageHost('')
  assert.equal(isImageHostAllowed(''), false)

  // The list is capped, dropping the oldest entries first.
  for (let index = 0; index < 60; index += 1) allowImageHost(`host-${index}.example`)
  assert.equal(isImageHostAllowed('host-59.example'), true)
  assert.equal(isImageHostAllowed('host-0.example'), false)
})

test('spreadsheet rows keep their columns around empty styled cells', () => {
  const shared = ['Name', 'Score', 'Ana']
  const xml =
    '<sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
    // An empty, self-closed cell must not swallow the cell after it.
    '<row r="2"><c r="A2" s="1"/><c r="B2" t="s"><v>2</v></c><c r="C2"><v>9.5</v></c></row>' +
    '<row r="3"><c r="A3" t="inlineStr"><is><t>a &amp; b</t></is></c></row>' +
    '<row r="4"><c r="A4" s="1"/></row>' +
    '</sheetData>'
  assert.deepEqual(sheetLines(xml, shared), ['Name\tScore', '\tAna\t9.5', 'a & b'])
  // An invalid character reference is dropped instead of aborting the file.
  assert.equal(unescapeXml('ok &#x110000; &#0; done'), 'ok   done')
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

test('search result titles lose markdown wrappers but keep real hashes', () => {
  // Crawl4AI returns the page's markdown heading as the title.
  assert.equal(cleanTitle('[Node.js Releases](#nodejs-releases)'), 'Node.js Releases')
  assert.equal(cleanTitle('## Getting started'), 'Getting started')
  assert.equal(cleanTitle('**Bold** and _quiet_ text'), 'Bold and quiet text')
  assert.equal(cleanTitle('`npm install` works'), 'npm install works')
  // A hash inside a title is meaningful, so only a leading one is dropped.
  assert.equal(cleanTitle('C# Guide'), 'C# Guide')
  assert.equal(cleanTitle('  spaced   out  '), 'spaced out')
  assert.equal(cleanTitle('&amp; Symbols'), '& Symbols')
  // Empty markup falls back to the URL host.
  assert.equal(cleanTitle('[ ]()', 'nodejs.org'), 'nodejs.org')
  assert.equal(cleanTitle('', 'example.com'), 'example.com')
})

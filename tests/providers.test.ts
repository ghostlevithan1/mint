import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { acceptedModelIds, createChatResponse, getStatusPayload } from '../server/core'
import { inspectChatBody } from '../server/tamper'
import { answerModel, MODELS } from '../src/lib/data'

// An empty directory, so no local .env or key file leaks into the test.
const root = mkdtempSync(join(tmpdir(), 'mint-providers-'))
const body = (model: string) => ({ model, messages: [{ role: 'user', content: 'Hi' }] })

function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const names = ['NVIDIA_API_KEY', 'OPEN_CODE_KEY', 'OPENROUTER_API_KEY', ...Object.keys(values)]
  const saved = new Map(names.map((name) => [name, process.env[name]]))
  for (const name of names) delete process.env[name]
  for (const [name, value] of Object.entries(values)) if (value !== undefined) process.env[name] = value
  return run().finally(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
}

test('OpenRouter models ask for OPEN_CODE_KEY when it is missing', () =>
  withEnv({ NVIDIA_API_KEY: 'nvapi-test-key-1234567890' }, async () => {
    const response = await createChatResponse(body('gemma-4-31b'), { root })
    assert.equal(response.status, 503)
    const data = (await response.json()) as { error: { message: string } }
    assert.match(data.error.message, /OPEN_CODE_KEY/)
    const status = getStatusPayload(root)
    assert.deepEqual(status.providers, { nvidia: true, openrouter: false })
    assert.equal(status.models['minimax-m3-flash'], 'minimax/minimax-m3.1-flash')
    assert.equal(status.models['inkling-2-small'], undefined)
    assert.equal(status.models['minimax-flash'], undefined)
    assert.equal(status.models['mistral-large-4'], undefined)
  }))

test('OpenRouter models go to OpenRouter with the OPEN_CODE_KEY', () =>
  withEnv({ OPEN_CODE_KEY: 'sk-or-test-key-1234567890' }, async () => {
    const realFetch = globalThis.fetch
    let seen: { url: string; auth: string; body: Record<string, unknown> } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = {
        url,
        auth: (init.headers as Record<string, string>).Authorization,
        body: JSON.parse(init.body as string),
      }
      return new Response('data: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch
    try {
      const response = await createChatResponse(body('minimax-m3-flash'), { root })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('x-mint-provider'), 'openrouter')
      assert.ok(seen)
      const request = seen as { url: string; auth: string; body: Record<string, unknown> }
      assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions')
      assert.equal(request.auth, 'Bearer sk-or-test-key-1234567890')
      assert.equal(request.body.model, 'minimax/minimax-m3.1-flash')
      assert.equal(request.body.reasoning, undefined)
    } finally {
      globalThis.fetch = realFetch
    }
  }))

test('a retired model id from an old tab is answered by the default model, not counted as tampering', () =>
  withEnv({ NVIDIA_API_KEY: 'nvapi-test-key-1234567890' }, async () => {
    assert.ok(acceptedModelIds(root).has('inkling-2-small'))
    assert.ok(!acceptedModelIds(root).has('made-up-model'))
    assert.deepEqual(inspectChatBody(body('inkling-2-small'), acceptedModelIds(root)).signals, [])

    const realFetch = globalThis.fetch
    let upstream = ''
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      upstream = `${url} ${JSON.parse(init.body as string).model}`
      return new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    }) as typeof fetch
    try {
      const response = await createChatResponse(body('inkling-2-small'), { root })
      assert.equal(response.status, 200)
      assert.match(upstream, /integrate\.api\.nvidia\.com.* nvidia\/nemotron-3-nano-omni/)
    } finally {
      globalThis.fetch = realFetch
    }
  }))

test('the picker no longer offers Inkling 2 Small, but old answers keep its name', () => {
  assert.ok(!MODELS.some((model) => model.id === 'inkling-2-small'))
  assert.equal(answerModel('inkling-2-small')?.name, 'Inkling 2 Small')
  assert.equal(answerModel('gemma-4-31b')?.name, 'Gemma 4 31B')
  assert.equal(answerModel('nope'), undefined)
})

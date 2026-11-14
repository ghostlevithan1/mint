import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createChatResponse, getStatusPayload } from '../server/core'

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
    assert.equal(status.models['inkling-2-small'], 'thinkingmachines/inkling-2-small')
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
      const response = await createChatResponse(body('inkling-2-small'), { root })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('x-mint-provider'), 'openrouter')
      assert.ok(seen)
      const request = seen as { url: string; auth: string; body: Record<string, unknown> }
      assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions')
      assert.equal(request.auth, 'Bearer sk-or-test-key-1234567890')
      assert.equal(request.body.model, 'thinkingmachines/inkling-2-small')
      assert.deepEqual(request.body.reasoning, { effort: 'medium' })
    } finally {
      globalThis.fetch = realFetch
    }
  }))

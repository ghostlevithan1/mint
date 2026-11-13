import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEM_PROMPT, withSystemPrompt } from '../server/core.ts'

test('the system prompt tells the model the reply budget is finite', () => {
  assert.match(SYSTEM_PROMPT, /limited budget, shared by your private reasoning and the answer/i)
})

test('each request states its actual output budget', () => {
  const out = withSystemPrompt([{ role: 'user', content: 'Explain vectors.' }], 8192)
  assert.equal(out.length, 2)
  assert.equal(out[0].role, 'system')
  assert.match(out[0].content as string, /about 8192 tokens/)
})

test('the budget note is left out when no budget is supplied', () => {
  const out = withSystemPrompt([{ role: 'user', content: 'Explain vectors.' }])
  assert.doesNotMatch(out[0].content as string, /Reply budget/)
})

test('the prompt and note reserve part of the budget for the answer', () => {
  assert.match(SYSTEM_PROMPT, /at most about a third of it on private reasoning/i)
  const out = withSystemPrompt([{ role: 'user', content: 'Explain vectors.' }], 8192)
  assert.match(out[0].content as string, /reserve roughly the last third for the answer/i)
  assert.match(out[0].content as string, /stop reasoning and start writing/i)
})

test('a client system message stays after the prompt and budget note', () => {
  const out = withSystemPrompt(
    [
      { role: 'system', content: 'About this student: Year 9' },
      { role: 'user', content: 'What is a vector?' },
    ],
    4096,
  )
  const system = out[0].content as string
  assert.match(system, /about 4096 tokens/)
  assert.ok(system.endsWith('About this student: Year 9'))
})

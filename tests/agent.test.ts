import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseToolCall, runCalculator, stripToolCalls, toolStatus } from '../src/lib/agent.ts'

test('a tool block at the end of a reply becomes a tool call', () => {
  const reply = 'Let me check that.\n\n```tool\n{"name":"search","query":"boiling point of ethanol"}\n```'
  assert.deepEqual(parseToolCall(reply), { name: 'search', query: 'boiling point of ethanol' })
  assert.deepEqual(parseToolCall('```tool\n{"name":"calculate","expression":"2^10"}\n```'), {
    name: 'calculate',
    expression: '2^10',
  })
  assert.deepEqual(parseToolCall('```tool\n{"name":"read","url":"https://en.wikipedia.org/wiki/Ethanol"}\n```'), {
    name: 'read',
    url: 'https://en.wikipedia.org/wiki/Ethanol',
  })
})

test('anything that is not a valid tool call is ignored', () => {
  assert.equal(parseToolCall('Plain answer with no tools.'), null)
  assert.equal(parseToolCall('```tool\nnot json\n```'), null)
  assert.equal(parseToolCall('```tool\n{"name":"delete_everything"}\n```'), null)
  assert.equal(parseToolCall('```tool\n{"name":"read","url":"javascript:alert(1)"}\n```'), null)
  assert.equal(parseToolCall('```tool\n{"name":"search","query":"   "}\n```'), null)
  // still streaming, not closed yet
  assert.equal(parseToolCall('```tool\n{"name":"search","query":"x"}'), null)
})

test('tool blocks are hidden from the answer, even while streaming', () => {
  assert.equal(stripToolCalls('Checking.\n```tool\n{"name":"search","query":"x"}\n```'), 'Checking.')
  assert.equal(stripToolCalls('Checking.\n```tool\n{"name":"sea'), 'Checking.')
  assert.equal(stripToolCalls('```python\nprint(1)\n```'), '```python\nprint(1)\n```')
})

test('the calculator is exact and refuses code', () => {
  assert.equal(runCalculator('(3.2*10^5) / 4.8'), '(3.2*10^5) / 4.8 = 66666.6666667')
  assert.equal(runCalculator('12 × 3 ÷ 4'), '12 × 3 ÷ 4 = 9')
  assert.match(runCalculator('process.exit()'), /^Could not calculate/)
  assert.match(runCalculator('1/0'), /no finite value/)
})

test('tool status lines read naturally', () => {
  assert.equal(toolStatus({ name: 'search', query: 'photosynthesis' }), 'Searching the web for "photosynthesis"')
  assert.equal(toolStatus({ name: 'read', url: 'https://www.bbc.co.uk/bitesize' }), 'Reading bbc.co.uk/bitesize')
})

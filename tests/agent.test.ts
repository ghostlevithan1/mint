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

test('native tool-call markup a model prints beside the tool block is hidden too', () => {
  const minimax = 'I’ll add the totals first.]<]minimax[>[<tool_call>\n```tool\n{"name":"calculate","expression":"1+2"}\n```'
  assert.equal(stripToolCalls(minimax), 'I’ll add the totals first.')
  assert.equal(stripToolCalls('Checking.<tool_call>\n```tool\n{"name":"search","query":"x"}\n```</tool_call>'), 'Checking.')
  // Ordinary maths and code that merely look similar are left alone.
  assert.equal(stripToolCalls('Is [1, 2] < 3? Use a[i] > b[j].'), 'Is [1, 2] < 3? Use a[i] > b[j].')
})

test('the calculator is exact and refuses code', () => {
  assert.equal(runCalculator('(3.2*10^5) / 4.8'), '(3.2*10^5) / 4.8 = 66666.6666667')
  assert.equal(runCalculator('12 × 3 ÷ 4'), '12 × 3 ÷ 4 = 9')
  assert.equal(runCalculator('sum(n^2, 1, 10)'), 'sum(n^2, 1, 10) = 385')
  assert.equal(runCalculator('factorial(5) + 3'), 'factorial(5) + 3 = 123')
  assert.equal(runCalculator('derivative(x^3, 2)'), 'derivative(x^3, 2) = 12')
  assert.match(runCalculator('integral(sin(x), 0, pi)'), /^integral\(sin\(x\), 0, pi\) = /)
  const integral = Number(runCalculator('integral(sin(x), 0, pi)').split(' = ')[1])
  assert.ok(Math.abs(integral - 2) < 1e-8, `integral gave ${integral}`)
  assert.match(runCalculator('process.exit()'), /^Could not calculate/)
  assert.match(runCalculator('1/0'), /no finite value/)
})

test('tool status lines read naturally', () => {
  assert.equal(toolStatus({ name: 'search', query: 'photosynthesis' }), 'Searching the web for "photosynthesis"')
  assert.equal(toolStatus({ name: 'read', url: 'https://www.bbc.co.uk/bitesize' }), 'Reading bbc.co.uk/bitesize')
})

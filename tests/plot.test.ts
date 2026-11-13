import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileExpression, niceTicks, parsePlotSpec, PlotError } from '../src/lib/plotSpec.ts'
import { parseDiagramSpec, wrapLabel } from '../src/lib/diagramSpec.ts'
import { withSystemPrompt } from '../server/core.ts'

const at = (expr: string, x: number) => compileExpression(expr)(x)

test('equations follow normal maths precedence', () => {
  assert.equal(at('x^2 - 2*x - 3', 3), 0)
  assert.equal(at('-x^2', 2), -4)
  assert.equal(at('2^3^2', 0), 512)
  assert.equal(at('x**2', 3), 9)
  assert.equal(at('2x + 1', 4), 9)
  assert.equal(at('3sin(0) + cos(0)', 0), 1)
  assert.equal(at('max(x, 2) * pi / pi', 1), 2)
  assert.equal(at('2^-1', 0), 0.5)
})

test('anything outside the whitelist is rejected, never run', () => {
  for (const bad of ['alert(1)', 'constructor', 'x;1', '(x', 'x)', '', 'process.exit()', 'y + 1']) {
    assert.throws(() => compileExpression(bad), PlotError, bad)
  }
})

test('a line spec samples each equation over its x range and keeps marked points', () => {
  const data = parsePlotSpec(
    JSON.stringify({
      xRange: [-2, 4],
      samples: 61,
      equations: [{ expr: 'x^2 - 2x - 3', label: 'y' }],
      points: [{ x: -1, y: 0, label: 'root' }, { x: 1, y: -4 }],
    }),
  )
  assert.equal(data.lines[0].points.length, 61)
  assert.deepEqual(data.lines[0].points[0], [-2, 5])
  assert.equal(data.markers.length, 2)
  assert.ok(data.yRange[0] < -4 && data.yRange[1] > 5)
})

test('asymptotes do not flatten the y range', () => {
  const data = parsePlotSpec(JSON.stringify({ xRange: [-3, 3], equations: [{ expr: 'tan(x)' }] }))
  assert.ok(data.yRange[1] < 100, `y range ${data.yRange}`)
})

test('bar and histogram specs become bars', () => {
  const bar = parsePlotSpec(JSON.stringify({ chart: 'bar', series: [{ x: ['A', 'B'], y: [3, 5] }] }))
  assert.deepEqual(bar.bars.map((b) => b.value), [3, 5])
  assert.equal(bar.yRange[0], 0)
  const hist = parsePlotSpec(JSON.stringify({ chart: 'histogram', data: [1, 2, 2, 3, 3, 3], bins: 4 }))
  assert.equal(hist.bars.reduce((sum, b) => sum + b.value, 0), 6)
})

test('broken specs explain what is wrong', () => {
  assert.throws(() => parsePlotSpec('{"xRange":[0,1]'), /valid JSON/)
  assert.throws(() => parsePlotSpec('{"chart":"pie"}'), /chart/)
  assert.throws(() => parsePlotSpec('{}'), /Nothing to plot/)
})

test('ticks land on round numbers', () => {
  assert.deepEqual(niceTicks(-5.3, 5.3, 5), [-4, -2, 0, 2, 4])
  assert.deepEqual(niceTicks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1])
})

test('diagram specs validate their type and node count', () => {
  const cycle = parseDiagramSpec(
    JSON.stringify({ type: 'cycle', nodes: [{ label: 'A' }, { label: 'B' }, { label: 'C', detail: 'third' }] }),
  )
  assert.equal(cycle.nodes.length, 3)
  assert.equal(cycle.nodes[2].detail, 'third')
  assert.throws(() => parseDiagramSpec('{"type":"cycle","nodes":[{"label":"A"},{"label":"B"}]}'), /at least 3/)
  assert.throws(() => parseDiagramSpec('{"type":"venn","nodes":[]}'), /steps, cycle or hub/)
  assert.equal(parseDiagramSpec('{"nodes":[{"label":"A"},{"label":"B"}]}').type, 'steps')
})

test('diagram labels wrap to at most two lines', () => {
  assert.deepEqual(wrapLabel('Carbon dioxide intake'), ['Carbon dioxide', 'intake'])
  assert.equal(wrapLabel('one two three four five six seven').length, 2)
})

test('client system messages fold into the one leading system prompt', () => {
  const out = withSystemPrompt([
    { role: 'system', content: 'About this student: Year 9' },
    { role: 'user', content: 'What is a vector?' },
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].role, 'system')
  assert.ok((out[0].content as string).endsWith('About this student: Year 9'))
  assert.equal(out.filter((m) => m.role === 'system').length, 1)
})

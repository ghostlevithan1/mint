import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampPlotDetail,
  compactNumber,
  compileExpression,
  describePlot,
  formatTick,
  isCategoryLine,
  niceTicks,
  percent,
  parsePlotSpec,
  PLOT_DETAIL_DEFAULT,
  PLOT_DETAIL_MAX,
  PLOT_DETAIL_MIN,
  plotDetailFromPosition,
  plotDetailPosition,
  PlotError,
  sharedTicks,
  ticksBetween,
} from '../src/lib/plotSpec.ts'
import { compileReal, parseMath } from '../src/lib/mathExpr.ts'
import { parseDiagramSpec, wrapLabel } from '../src/lib/diagramSpec.ts'
import { SYSTEM_PROMPT, withSystemPrompt } from '../server/core.ts'

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
  assert.equal(data.lines[0].expr, 'x^2 - 2x - 3')
  assert.equal(data.markers.length, 2)
  assert.ok(data.yRange[0] < -4 && data.yRange[1] > 5)
})

test('asymptotes do not flatten the y range', () => {
  const data = parsePlotSpec(JSON.stringify({ xRange: [-3, 3], equations: [{ expr: 'tan(x)' }] }))
  assert.ok(data.yRange[1] < 100, `y range ${data.yRange}`)
})

test('bar and histogram specs become bars', () => {
  const bar = parsePlotSpec(JSON.stringify({ chart: 'bar', series: [{ x: ['A', 'B'], y: [3, 5] }] }))
  assert.deepEqual(bar.groups[0].values, [3, 5])
  assert.equal(bar.yRange[0], 0)
  const hist = parsePlotSpec(JSON.stringify({ chart: 'histogram', data: [1, 2, 2, 3, 3, 3], bins: 4 }))
  assert.equal(hist.bars.reduce((sum, b) => sum + b.value, 0), 6)
})

test('broken specs explain what is wrong', () => {
  assert.throws(() => parsePlotSpec('plot: [0,1'), /valid JSON/)
  assert.throws(() => parsePlotSpec('{"chart":"radar"}'), /"chart" must be/)
  assert.throws(() => parsePlotSpec('{"chart":"pie"}'), /needs "series"/)
  assert.throws(() => parsePlotSpec('{}'), /Nothing to plot/)
})

test('every plot example in the system prompt is valid', () => {
  const examples = [...SYSTEM_PROMPT.matchAll(/```plot\n([\s\S]*?)```/g)].map(
    (match) => match[1],
  )
  assert.equal(examples.length, 12, 'the prompt carries one example per chart shape')
  assert.deepEqual(
    examples.map((code) => parsePlotSpec(code).chart),
    ['line', 'scatter', 'bar', 'bar', 'line', 'pie', 'histogram', 'line', 'cobweb', 'sequence', 'complex', 'fractal'],
  )
  // The new examples draw what they say: a circle, a staircase, a sequence, a picture.
  assert.equal(parsePlotSpec(examples[7]).implicit.length, 1)
  assert.equal(parsePlotSpec(examples[8]).lines.length, 3)
  assert.ok(parsePlotSpec(examples[9]).lines[0].points.length > 5)
  assert.equal(parsePlotSpec(examples[10]).field?.spec.kind, 'domain')
  assert.equal(parsePlotSpec(examples[11]).field?.spec.kind, 'julia')

  const line = parsePlotSpec(examples[0])
  assert.equal(line.markers.length, 3)
  assert.ok(line.xRange[0] < -1 && line.xRange[1] > 3)
  assert.equal(parsePlotSpec(examples[2]).categories.length, 4)
  assert.equal(parsePlotSpec(examples[3]).groups.length, 2)
  assert.ok(isCategoryLine(parsePlotSpec(examples[4])))
  assert.equal(parsePlotSpec(examples[5]).slices.length, 4)
  assert.equal(parsePlotSpec(examples[6]).bars.length, 5)

  for (const code of examples) {
    const spec = JSON.parse(code) as { equations?: Array<{ expr: string }> }
    for (const equation of spec.equations ?? []) {
      assert.match(equation.expr, /^[\x20-\x7e]+$/, 'equation expressions stay ASCII')
    }
  }
  // A chart on the plane writes the relation itself; a plain line chart keeps "y =" in the label.
  for (const code of examples.slice(0, 7)) {
    const spec = JSON.parse(code) as { equations?: Array<{ expr: string }> }
    for (const equation of spec.equations ?? []) {
      assert.doesNotMatch(equation.expr, /\by\s*=/, 'labels hold "y =", not expr')
    }
  }
})

test('every equation name the prompt allows is supported by the parser', () => {
  const listed = SYSTEM_PROMPT.match(/Allowed names: ([^.]+)\./)?.[1]
  assert.ok(listed, 'the prompt lists the equation names')
  // Names that take more than one value, so the check calls them correctly.
  const arity: Record<string, number> = {
    min: 2,
    max: 2,
    pow: 2,
    atan2: 2,
    mod: 2,
    sum: 3,
    summation: 3,
    integral: 3,
    integrate: 3,
    derivative: 2,
    deriv: 2,
    difference: 2,
    fdiff: 2,
  }
  // Inputs are checked where they are meaningful: y only exists on the plane, z in a complex graph.
  const varsFor: Record<string, string[]> = { y: ['x', 'y'], z: ['z', 'x', 'y'], n: ['n', 'x'], i: ['i', 'z'] }
  const constants = new Set(['x', 'pi', 'π', 'e', 'tau', 'τ'])
  for (const item of listed.split(',')) {
    const name = item.replace(/\s*\(.*\)$/, '').trim()
    const vars = varsFor[name] ?? ['x']
    const args = Array.from({ length: arity[name] ?? 1 }, () => 'x').join(', ')
    // A bare input (x, y, z, n, i) is used as it is; a function is called.
    const expr = constants.has(name) || varsFor[name] ? name : `${name}(${args})`
    assert.doesNotThrow(
      () => compileReal(parseMath(expr, vars), vars),
      `${name} is documented but not supported`,
    )
  }
  // The prompt's own list of inputs is exactly what the parser accepts.
  for (const name of ['x', 'y', 'z', 'n', 'i']) {
    assert.match(listed, new RegExp(`(^|, )${name}(,| \\(|$)`), `${name} is used by the prompt but missing from its list`)
  }
})

test('unicode constants and operators are accepted in equations', () => {
  assert.equal(at('π', 0), Math.PI)
  assert.equal(at('2π', 0), 2 * Math.PI)
  assert.equal(at('πx', 2), 2 * Math.PI)
  assert.equal(at('sin(π/2)', 0), 1)
  assert.equal(at('τ', 0), 2 * Math.PI)
  assert.equal(at('e', 0), Math.E)
  assert.equal(at('2e', 0), 2 * Math.E)
  assert.equal(at('2×3 + 4÷2 − 1', 0), 7)
  assert.equal(at('x^2 − 4', 3), 5)
})

test('the bar, histogram and scatter shapes the prompt describes parse', () => {
  const bar = parsePlotSpec(JSON.stringify({ chart: 'bar', series: [{ x: ['A', 'B'], y: [3, 5] }] }))
  assert.deepEqual(bar.categories, ['A', 'B'])
  const hist = parsePlotSpec(JSON.stringify({ chart: 'histogram', data: [1, 2, 2, 3, 3, 3], bins: 4 }))
  assert.equal(hist.bars.length, 4)
  const scatter = parsePlotSpec(JSON.stringify({ chart: 'scatter', series: [{ x: [1, 2], y: [3, 4] }] }))
  assert.equal(scatter.lines[0].mode, 'scatter')
})

test('ticks land on round numbers', () => {
  assert.deepEqual(niceTicks(-5.3, 5.3, 5), [-4, -2, 0, 2, 4])
  assert.deepEqual(niceTicks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1])
})

test('both axes use one tick step so every grid cell is square', () => {
  const ticks = sharedTicks(-10, 10, -5, 5)
  assert.equal(ticks.step, 2)
  assert.deepEqual(ticks.x, [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10])
  assert.deepEqual(ticks.y, [-4, -2, 0, 2, 4])
})

test('the shared tick step stays readable for very different spans', () => {
  const tall = sharedTicks(-3, 5, -6, 106)
  for (let i = 1; i < tall.x.length; i += 1) assert.equal(tall.x[i] - tall.x[i - 1], tall.step)
  for (let i = 1; i < tall.y.length; i += 1) assert.equal(tall.y[i] - tall.y[i - 1], tall.step)
  assert.ok(tall.step > 0)
})

test('tick labels shorten to fit the y-axis margin instead of escaping it', () => {
  // The y-axis budget is M.left - 10 = 46 viewBox units.
  assert.equal(formatTick(0, 46), '0')
  assert.equal(formatTick(100, 46), '100')
  assert.equal(formatTick(10000, 46), '10000')
  assert.equal(formatTick(-10000, 46), '-10000')
  assert.equal(formatTick(100000, 46), '1.0e+5')
  assert.equal(formatTick(-100000, 46), '-1e+5')
  assert.equal(formatTick(150000, 46), '1.5e+5')
  assert.equal(formatTick(-1234000, 46), '-1e+6')
  assert.equal(formatTick(1e10, 46), '1e+10')
  assert.equal(formatTick(-0.00001, 46), '-1e-5')
  // Labels that already fit are never reformatted.
  assert.equal(formatTick(2.5, 46), '2.5')
})

test('plot specs with common model JSON slips are repaired', () => {
  // The exact message a model sent: the label string never closes, so the
  // object's own closing braces end up inside it.
  const swallowed = '{"chart":"line","title":"y = x^2","xRange":[-1000,1000],"equations":[{"expr":"x^2","label":"y = x^2"}],"points":[{"x":0,"y":0,"label":"vertex (0,0)}]}'
  const fixed = parsePlotSpec(swallowed)
  assert.equal(fixed.chart, 'line')
  assert.equal(fixed.markers.length, 1)
  assert.equal(fixed.markers[0].label, 'vertex (0,0)')
  assert.deepEqual(fixed.xRange, [-1000, 1000])

  // A trailing comma before a closing brace.
  const trailing = parsePlotSpec('{"chart":"line","xRange":[-10,10],"equations":[{"expr":"x"}],}')
  assert.equal(trailing.lines.length, 1)

  // Prose after the object inside the fence.
  const prose = parsePlotSpec('{"chart":"line","xRange":[-10,10],"equations":[{"expr":"x"}]} Here is the graph.')
  assert.equal(prose.lines.length, 1)

  // A stream that stopped before the last braces closed.
  const cut = parsePlotSpec('{"chart":"line","xRange":[-10,10],"equations":[{"expr":"x"}')
  assert.equal(cut.lines.length, 1)

  // Empty or hopeless input still reports a clear error.
  assert.throws(() => parsePlotSpec(''), PlotError)
  assert.throws(() => parsePlotSpec('not json at all'), PlotError)
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

test('hostile coordinates cannot stall or overflow the axis maths', () => {
  // Each of these once spun forever: the step was below the float spacing.
  assert.deepEqual(niceTicks(-1e308, 1e308), [])
  assert.ok(niceTicks(1e17, 1e17 + 32).length <= 200)
  assert.deepEqual(ticksBetween(0, 1e9, 1), [])
  assert.deepEqual(ticksBetween(Number.NEGATIVE_INFINITY, 5, 1), [])
  assert.ok(sharedTicks(-1e308, 1e308, -1e308, 1e308).x.length <= 200)

  // A curve that overflows draws on a sane window instead of an infinite one.
  const huge = parsePlotSpec(
    JSON.stringify({ chart: 'line', xRange: [-1, 1], equations: [{ expr: '1e308*x' }] }),
  )
  assert.ok(Number.isFinite(huge.yRange[0]) && Number.isFinite(huge.yRange[1]))

  // Out-of-range coordinates are rejected rather than plotted.
  assert.throws(
    () => parsePlotSpec(JSON.stringify({ chart: 'scatter', series: [{ x: [0, 1e308], y: [0, 1] }] })),
    PlotError,
  )
  const clamped = parsePlotSpec(
    JSON.stringify({ chart: 'line', xRange: [-1, 1], yRange: [-1e308, 1e308], equations: [{ expr: 'x' }] }),
  )
  assert.ok(Number.isFinite(clamped.yRange[0]) && Number.isFinite(clamped.yRange[1]))
})

test('graph detail sets how many points are joined along an equation curve', () => {
  const spec = JSON.stringify({ chart: 'line', xRange: [-3, 3], equations: [{ expr: 'x^2' }] })
  assert.equal(parsePlotSpec(spec, { samples: 20 }).lines[0].points.length, 20)
  assert.equal(parsePlotSpec(spec, { samples: 1500 }).lines[0].points.length, 1500)
  // The student's setting wins over a "samples" value inside the spec.
  const asked = JSON.stringify({ chart: 'line', samples: 64, xRange: [-3, 3], equations: [{ expr: 'x' }] })
  assert.equal(parsePlotSpec(asked, { samples: 300 }).lines[0].points.length, 300)
  // With no setting passed, the spec (or the default) still decides.
  assert.equal(parsePlotSpec(asked).lines[0].points.length, 64)
  // The curve still spans the whole window at the lowest detail.
  const coarse = parsePlotSpec(spec, { samples: PLOT_DETAIL_MIN }).lines[0].points
  assert.equal(coarse[0][0], -3)
  assert.equal(coarse.at(-1)?.[0], 3)
})

test('a graph can be read out as plain sentences', () => {
  const curve = describePlot(
    parsePlotSpec(
      JSON.stringify({
        chart: 'line',
        title: 'Quadratic',
        xRange: [-3, 3],
        equations: [{ expr: 'x^2', label: 'y = x^2' }],
        points: [{ x: 0, y: 0, label: 'vertex' }],
      }),
      { samples: 61 },
    ),
  )
  assert.match(curve[0], /^Line graph\. x runs from -3 to 3; y from /)
  // Seven readings along the curve, from the left edge to the right edge.
  assert.match(curve[1], /^y = x\^2: x = -3, y = 9; /)
  assert.match(curve[1], /x = 0, y = 0; /)
  assert.match(curve[1], /x = 3, y = 9$/)
  assert.equal(curve.at(-1), 'Marked point vertex at (0, 0)')

  // A curve that is undefined somewhere says so instead of printing NaN.
  const rooted = describePlot(
    parsePlotSpec(JSON.stringify({ xRange: [-4, 4], equations: [{ expr: 'sqrt(x)', label: 'root' }] }), {
      samples: 61,
    }),
  )
  assert.match(rooted[1], /x = -4, y = undefined/)
  assert.ok(!rooted[1].includes('NaN'))

  const data = describePlot(
    parsePlotSpec(JSON.stringify({ chart: 'scatter', series: [{ label: 'Heights', x: [1, 2, 3], y: [4, 5, 6] }] })),
  )
  assert.equal(data[1], 'Heights: (1, 4) (2, 5) (3, 6)')

  const bars = describePlot(
    parsePlotSpec(JSON.stringify({ chart: 'bar', series: [{ x: ['Q1', 'Q2'], y: [12, 19] }] })),
  )
  assert.deepEqual(bars, ['Bar chart with 2 bars.', 'Q1: 12', 'Q2: 19'])
})

test('graph detail stays inside its limits and maps cleanly onto the slider', () => {
  assert.equal(clampPlotDetail(5), PLOT_DETAIL_MIN)
  assert.equal(clampPlotDetail(99_999), PLOT_DETAIL_MAX)
  assert.equal(clampPlotDetail(333.6), 334)
  assert.equal(clampPlotDetail('250'), 250)
  assert.equal(clampPlotDetail('junk'), PLOT_DETAIL_DEFAULT)
  assert.equal(clampPlotDetail(Number.NaN), PLOT_DETAIL_DEFAULT)

  assert.equal(plotDetailFromPosition(0), PLOT_DETAIL_MIN)
  assert.equal(plotDetailFromPosition(100), PLOT_DETAIL_MAX)
  assert.equal(plotDetailFromPosition(-50), PLOT_DETAIL_MIN)
  assert.equal(plotDetailFromPosition(500), PLOT_DETAIL_MAX)

  // Moving the slider never lowers the value, and every preset is reachable.
  let previous = 0
  for (let position = 0; position <= 100; position += 1) {
    const value = plotDetailFromPosition(position)
    assert.ok(value >= previous, `slider went backwards at ${position}`)
    previous = value
  }
  for (const preset of [100, PLOT_DETAIL_DEFAULT, PLOT_DETAIL_MAX]) {
    assert.equal(plotDetailFromPosition(plotDetailPosition(preset)), preset)
  }
})

test('bar charts take several series, grouped or stacked', () => {
  const grouped = parsePlotSpec(
    JSON.stringify({
      chart: 'bar',
      series: [
        { label: '2025', x: ['N', 'S'], y: [3, 5] },
        { label: '2026', x: ['N', 'S'], y: [4, 2] },
      ],
    }),
  )
  assert.deepEqual(grouped.categories, ['N', 'S'])
  assert.deepEqual(grouped.groups.map((g) => g.label), ['2025', '2026'])
  assert.equal(grouped.stacked, false)
  assert.ok(grouped.yRange[1] >= 5 && grouped.yRange[1] < 8)

  const stacked = parsePlotSpec(
    JSON.stringify({ chart: 'bar', stacked: true, horizontal: true, categories: ['N', 'S'], series: [{ y: [3, 5] }, { y: [4, 2] }] }),
  )
  assert.equal(stacked.stacked, true)
  assert.equal(stacked.horizontal, true)
  // The axis reaches the tallest stack (5 + 2 and 3 + 4 = 7), not the tallest single bar.
  assert.ok(stacked.yRange[1] >= 7)
  assert.equal(stacked.yRange[0], 0)

  // Negative values keep the zero line inside the window.
  const loss = parsePlotSpec(JSON.stringify({ chart: 'bar', series: [{ x: ['A', 'B'], y: [-4, 6] }] }))
  assert.ok(loss.yRange[0] < -4 && loss.yRange[1] > 6)

  assert.throws(
    () => parsePlotSpec(JSON.stringify({ chart: 'bar', series: [{ x: ['A', 'B'], y: [1, 2] }, { y: [1] }] })),
    /one "y" value per "x" label/,
  )
  assert.throws(() => parsePlotSpec(JSON.stringify({ chart: 'bar', series: [{ x: [{}], y: [1] }] })), /labels/)
})

test('pie charts keep positive shares and merge a long tail into Other', () => {
  const pie = parsePlotSpec(JSON.stringify({ chart: 'pie', series: [{ x: ['Rent', 'Food', 'Gifts'], y: [900, 400, 0] }] }))
  assert.deepEqual(pie.slices, [
    { label: 'Rent', value: 900 },
    { label: 'Food', value: 400 },
  ])
  assert.equal(pie.donut, false)
  assert.equal(parsePlotSpec(JSON.stringify({ chart: 'donut', series: [{ labels: ['A'], values: [1] }] })).donut, true)

  const many = parsePlotSpec(
    JSON.stringify({ chart: 'pie', series: [{ x: Array.from({ length: 20 }, (_, i) => `S${i}`), y: Array.from({ length: 20 }, (_, i) => i + 1) }] }),
  )
  assert.equal(many.slices.length, 12)
  assert.equal(many.slices.at(-1)?.label, 'Other')
  assert.equal(many.slices.reduce((sum, s) => sum + s.value, 0), 210)

  assert.throws(() => parsePlotSpec(JSON.stringify({ chart: 'pie', series: [{ x: ['A', 'B'], y: [-1, 2] }] })), /negative/)
  assert.throws(() => parsePlotSpec(JSON.stringify({ chart: 'pie', series: [{ x: ['A'], y: [0] }] })), /above 0/)
})

test('a line chart over text labels runs on categories, numeric x still draws a graph', () => {
  const months = parsePlotSpec(
    JSON.stringify({ chart: 'line', series: [{ label: 'Visits', x: ['Jan', 'Feb', 'Mar'], y: [3, 4, 2] }] }),
  )
  assert.ok(isCategoryLine(months))
  assert.deepEqual(months.categories, ['Jan', 'Feb', 'Mar'])
  const numeric = parsePlotSpec(JSON.stringify({ chart: 'line', series: [{ x: [1, 2, 3], y: [3, 4, 2] }] }))
  assert.equal(isCategoryLine(numeric), false)
  assert.equal(numeric.lines.length, 1)
})

test('data charts read out as sentences with values and shares', () => {
  const grouped = describePlot(
    parsePlotSpec(
      JSON.stringify({ chart: 'bar', stacked: true, series: [{ label: 'A', x: ['Q1'], y: [2] }, { label: 'B', x: ['Q1'], y: [3] }] }),
    ),
  )
  assert.deepEqual(grouped, ['Stacked bar chart with 1 categories and 2 series.', 'Q1: A 2, B 3'])
  const pie = describePlot(parsePlotSpec(JSON.stringify({ chart: 'pie', series: [{ x: ['Yes', 'No'], y: [3, 1] }] })))
  assert.deepEqual(pie, ['Pie chart with 2 slices, totalling 4.', 'Yes: 3 (75%)', 'No: 1 (25%)'])
})

test('data values are written short', () => {
  assert.equal(compactNumber(0), '0')
  assert.equal(compactNumber(1250), '1250')
  assert.equal(compactNumber(150000), '150K')
  assert.equal(compactNumber(-2_400_000), '-2.4M')
  assert.equal(compactNumber(3.2e9), '3.2B')
  assert.equal(compactNumber(0.125), '0.125')
  assert.equal(percent(1, 3), '33.3%')
  assert.equal(percent(1, 0), '0%')
})
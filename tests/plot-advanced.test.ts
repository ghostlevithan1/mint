import assert from 'node:assert/strict'
import test from 'node:test'
import { compileComplex, compileReal, isComplexTree, parseMath } from '../src/lib/mathExpr.ts'
import { createFieldPainter, type FieldSpec } from '../src/lib/complexField.ts'
import { traceImplicit } from '../src/lib/implicit.ts'
import { describePlot, parsePlotSpec, PlotError, sampleCurve } from '../src/lib/plotSpec.ts'

const close = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} ≈ ${b}`)
const real = (expr: string, values: number[], vars = ['x']) => {
  const fn = compileReal(parseMath(expr, vars), vars)
  return fn(values)
}
const complex = (expr: string, re: number, im: number, vars = ['z']) => {
  const fn = compileComplex(parseMath(expr, vars), vars)
  const out = fn([{ re, im }])
  return { re: out.re, im: out.im }
}

/* ------------------------------------------------------------- maths */

test('the parser takes every variable a graph may use', () => {
  const fn = compileReal(parseMath('x + 2y - z', ['x', 'y', 'z']), ['x', 'y', 'z'])
  assert.equal(fn([1, 2, 3]), 2)
  // Juxtaposed variables and constants multiply, as in 2xy or pix.
  const xy = compileReal(parseMath('2xy', ['x', 'y']), ['x', 'y'])
  assert.equal(xy([3, 4]), 24)
  assert.equal(real('2pi x', [1]), 2 * Math.PI)
  assert.equal(real('2e', []), 2 * Math.E)
})

test('new functions and named parameters work', () => {
  assert.equal(real('cbrt(27)', []), 3)
  close(real('round(2.6) + sign(-3) + fract(1.25)', []), 2.25)
  assert.equal(real('mod(-7, 3)', []), 2)
  close(real('atan2(1, 1)', []), Math.PI / 4)
  const withParams = compileReal(parseMath('a x^2 + b', ['x'], { a: 2, b: -3 }), ['x'])
  assert.equal(withParams([2]), 5)
})

test('unknown names, symbols and wrong argument counts are refused', () => {
  for (const bad of ['w + 1', 'eval(1)', 'sin()', 'pow(x)', 'x;y', 'constructor', 'x @ 2']) {
    assert.throws(() => parseMath(bad, ['x']), PlotError, bad)
  }
  // A spec cannot name a parameter after a function or an input.
  assert.throws(
    () => parsePlotSpec(JSON.stringify({ chart: 'line', params: { sin: 2 }, equations: [{ expr: 'x' }] })),
    /cannot be used as a parameter/,
  )
})

test('sums, integrals, derivatives, differences and factorials calculate', () => {
  // Summation binds its own n, and can still use the graph's x.
  assert.equal(real('sum(n, 1, 10)', []), 55)
  assert.equal(real('sum(n^2, 1, 10)', []), 385)
  assert.equal(real('sum(x*n, 1, 5)', [2]), 30)
  assert.equal(real('summation(n, 1, 4)', []), 10)
  // Bounds are inclusive whole numbers, even when written with fractions.
  assert.equal(real('sum(n, 1.5, 3.2)', []), 5)
  assert.equal(real('sum(n, 5, 1)', []), 0)

  // Simpson's rule handles polynomials and trigonometry.
  close(real('integral(x^2, 0, 3)', []), 9, 1e-9)
  close(real('integrate(sin(x), 0, pi)', []), 2, 1e-9)
  close(real('integral(2x + 1, 0, 4)', []), 20, 1e-9)

  // A central difference is exact for a cubic.
  close(real('derivative(x^3, 2)', []), 12, 1e-3)
  close(real('deriv(sin(x), 0)', []), 1, 1e-4)

  // The forward difference is f(x + h) - f(x), h defaulting to 1.
  assert.equal(real('difference(x^2, 3)', []), 7)
  assert.equal(real('fdiff(x^2, 3, 0.5)', []), 3.25)

  // Factorial and gamma, including the postfix form.
  assert.equal(real('factorial(5)', []), 120)
  assert.equal(real('5!', []), 120)
  assert.equal(real('factorial(0)', []), 1)
  close(real('factorial(0.5)', []), Math.sqrt(Math.PI) / 2, 1e-9)
  assert.equal(real('gamma(5)', []), 24)
  close(real('gamma(0.5)', []), Math.sqrt(Math.PI), 1e-9)
  close(real('lgamma(10)', []), Math.log(362880), 1e-6)
  assert.ok(Number.isNaN(real('gamma(-1)', [])))
  // These are real-number tools; a complex graph refuses them clearly.
  assert.throws(() => compileComplex(parseMath('sum(n, 1, 3)', ['z']), ['z']), /only works on real numbers/)
})

test('complex arithmetic matches known values', () => {
  // i^2 = -1, and a whole-number power stays exact.
  const square = complex('z^2', 0, 1)
  close(square.re, -1)
  close(square.im, 0)
  const cube = complex('z^3', 1, 1)
  close(cube.re, -2)
  close(cube.im, 2)
  // (1+i)/(1-i) = i, and the real and imaginary parts can be read separately.
  const quotient = complex('z/(1 - i)', 1, 1)
  close(quotient.re, 0)
  close(quotient.im, 1)
  assert.equal(complex('re(z)', 2, 5).re, 2)
  assert.equal(complex('im(z)', 2, 5).re, 5)
  assert.equal(complex('conj(z)', 2, 5).im, -5)
  assert.equal(complex('abs(3 + 4i)', 0, 0).re, 5)
  // exp(pi i) = -1: Euler's identity.
  const euler = complex('exp(pi*i)', 0, 0)
  close(euler.re, -1, 1e-12)
  close(euler.im, 0, 1e-12)
  // sqrt(-1) = i, and log(-1) = pi i.
  const root = complex('sqrt(z)', -1, 0)
  close(root.im, 1, 1e-12)
  close(complex('log(z)', -1, 0).im, Math.PI, 1e-12)
  close(complex('sin(z)', Math.PI / 2, 0).re, 1, 1e-12)
  close(complex('cosh(0)', 0, 0).re, 1, 1e-12)
})

test('a complex graph is spotted, and real-only functions are refused there', () => {
  assert.equal(isComplexTree(parseMath('z^2 + 1', ['z'])), false)
  assert.equal(isComplexTree(parseMath('z^2 + i', ['z'])), true)
  assert.equal(isComplexTree(parseMath('re(z) + x', ['z', 'x'])), true)
  assert.throws(() => compileComplex(parseMath('floor(z)', ['z']), ['z']), /only works on real numbers/)
})

/* -------------------------------------------- curves in x and y */

test('a circle traces to a curve of radius one', () => {
  const traced = traceImplicit(
    (x, y) => x * x + y * y - 1,
    { x0: -2, x1: 2, y0: -2, y1: 2 },
    '=',
    200,
    112,
  )
  assert.ok(traced.segments.length > 100, 'the circle has many pieces')
  for (let index = 0; index < traced.segments.length; index += 2) {
    const x = traced.segments[index]
    const y = traced.segments[index + 1]
    close(Math.hypot(x, y), 1, 0.02)
  }
  assert.equal(traced.runs.length, 0, 'an equation shades nothing')
})

test('an inequality shades where it holds', () => {
  const above = traceImplicit((x, y) => y - x * x, { x0: -2, x1: 2, y0: -2, y1: 4 }, '>', 40, 40)
  assert.ok(above.runs.length > 0)
  // Every shaded row sits above its parabola.
  for (let index = 0; index < above.runs.length; index += 3) {
    const y = -2 + (above.runs[index] + 0.5) * (6 / 40)
    const x = -2 + ((above.runs[index + 1] + above.runs[index + 2]) / 2) * (4 / 40)
    assert.ok(y > x * x - 0.4, `row ${above.runs[index]} at x ${x} is above the parabola`)
  }
})

test('a pole is not drawn as a line', () => {
  // tan(x*y) has poles inside this window; the tracer must not join across them.
  const traced = traceImplicit((x, y) => Math.tan(x * y), { x0: -2, x1: 2, y0: -2, y1: 2 }, '=', 120, 80)
  let longest = 0
  for (let index = 0; index + 5 < traced.segments.length; index += 4) {
    const length = Math.hypot(traced.segments[index + 2] - traced.segments[index], traced.segments[index + 3] - traced.segments[index + 1])
    longest = Math.max(longest, length)
  }
  assert.ok(longest < 0.5, `a piece spans ${longest}, which is a pole, not a crossing`)
})

test('implicit equations and inequalities parse from a spec', () => {
  const circle = parsePlotSpec(
    JSON.stringify({ chart: 'line', xRange: [-2, 2], yRange: [-2, 2], equations: [{ expr: 'x^2 + y^2 = 1', label: 'circle' }] }),
  )
  assert.equal(circle.implicit.length, 1)
  assert.equal(circle.implicit[0].relation, '=')
  assert.deepEqual(circle.xRange, [-2, 2])
  assert.deepEqual(circle.yRange, [-2, 2])

  // A backwards inequality is flipped so positive means inside.
  const shaded = parsePlotSpec(JSON.stringify({ chart: 'line', equations: [{ expr: 'y < x^2' }] }))
  assert.equal(shaded.implicit[0].relation, '>=')

  // "y = f(x)" is still an ordinary line, and "f(x) = g(x)" is the difference.
  const plain = parsePlotSpec(JSON.stringify({ chart: 'line', equations: [{ expr: 'y = x/2' }] }))
  assert.equal(plain.implicit.length, 0)
  assert.equal(plain.lines.length, 1)
  const difference = parsePlotSpec(JSON.stringify({ chart: 'line', xRange: [-3, 3], equations: [{ expr: 'x^2 = 4' }] }))
  assert.equal(difference.lines[0].points[0][1], 5)
})

test('named constants flow into a curve', () => {
  const data = parsePlotSpec(
    JSON.stringify({ chart: 'line', xRange: [0, 1], params: { a: 2, b: -3 }, equations: [{ expr: 'a x^2 + b' }] }),
  )
  // The curve runs from x = 0 to x = 1, so its last sample is at x = 1.
  assert.equal(data.lines[0].points.at(-1)?.[1], -1)
  assert.deepEqual(data.lines[0].params, { a: 2, b: -3 })
  assert.throws(() => parsePlotSpec(JSON.stringify({ chart: 'line', params: { sin: 1 }, equations: [{ expr: 'x' }] })), /cannot be used as a parameter/)
  assert.throws(() => parsePlotSpec(JSON.stringify({ chart: 'line', params: { a: 'two' }, equations: [{ expr: 'x' }] })), /must be a number/)
})

/* ------------------------------------------------ iteration */

test('a cobweb draws the staircase and the two guide lines', () => {
  const data = parsePlotSpec(
    JSON.stringify({ chart: 'cobweb', expr: 'r*x*(1 - x)', params: { r: 2.5 }, x0: 0.2, steps: 12, xRange: [0, 1], yRange: [0, 1] }),
  )
  assert.equal(data.lines.length, 3)
  assert.deepEqual(data.lines[0].points[0][0], 0)
  assert.equal(data.lines[0].points.at(-1)?.[0], 1)
  // The staircase starts at (x0, 0) and ends on y = x.
  const stair = data.lines[2].points
  assert.deepEqual(stair[0], [0.2, 0])
  const [lastX, lastY] = stair.at(-1)!
  close(lastX, lastY)
  assert.equal(data.markers[0].label, 'x0 = 0.2')
  // r = 2.5 converges towards 0.6.
  close(lastX, 0.6, 0.01)
})

test('a sequence charts a recurrence, an indexed rule, and a two-term rule', () => {
  const recurrence = parsePlotSpec(JSON.stringify({ chart: 'sequence', expr: '0.5x + 1', x0: 1, terms: 6 }))
  assert.deepEqual(recurrence.lines[0].points, [[0, 1], [1, 1.5], [2, 1.75], [3, 1.875], [4, 1.9375], [5, 1.96875]])
  assert.equal(recurrence.lines[0].mode, 'scatter')

  const indexed = parsePlotSpec(JSON.stringify({ chart: 'sequence', expr: 'n^2', terms: 4, join: true }))
  assert.deepEqual(indexed.lines[0].points, [[0, 0], [1, 1], [2, 4], [3, 9]])
  assert.equal(indexed.lines[0].mode, 'line')

  const fibonacci = parsePlotSpec(JSON.stringify({ chart: 'sequence', expr: 'x + x1', x0: 0, x1: 1, terms: 8 }))
  assert.deepEqual(fibonacci.lines[0].points.map(([, y]) => y), [0, 1, 1, 2, 3, 5, 8, 13])
  assert.throws(() => parsePlotSpec(JSON.stringify({ chart: 'sequence', expr: 'x + x1', terms: 5 })), /second start value/)
  assert.throws(() => parsePlotSpec(JSON.stringify({ chart: 'sequence' })), /needs "expr"/)
})

/* ------------------------------------------ complex graphs and fractals */

test('the domain colouring has a value everywhere, and reads out z and f(z)', () => {
  const painter = createFieldPainter({ kind: 'domain', expr: 'z^2 + 1' })
  const lines = painter.at(0, 0)
  assert.deepEqual(lines.slice(0, 2), ['z = 0 + 0i', 'f(z) = 1 + 0i'])
  assert.match(lines[2], /\|f\| = 1/)

  const rgba = new Uint8ClampedArray(4 * 8 * 4)
  painter.paint({ x0: -2, x1: 2, y0: -2, y1: 2 }, 8, 4, 0, 4, rgba)
  for (let index = 0; index < rgba.length; index += 4) assert.equal(rgba[index + 3], 255)
  // The colour varies across the plane, so not every pixel is the same.
  const distinct = new Set<string>()
  for (let index = 0; index < rgba.length; index += 4) distinct.add(`${rgba[index]},${rgba[index + 1]}`)
  assert.ok(distinct.size > 3)
})

test('paintRect fills only the newly exposed pixels', () => {
  const painter = createFieldPainter({ kind: 'mandelbrot', expr: 'z^2 + c', c: [0, 0], maxIter: 30 })
  const rgba = new Uint8ClampedArray(4 * 8 * 4)
  painter.paintRect({ x0: -2, x1: 1, y0: -1.5, y1: 1.5 }, 8, 4, 0, 0, 3, 2, rgba)
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const alpha = rgba[(row * 8 + col) * 4 + 3]
      assert.equal(alpha, row < 2 && col < 3 ? 255 : 0, `pixel ${col},${row}`)
    }
  }
})

test('a complex chart parses and draws two curves for a complex f(x)', () => {
  const domain = parsePlotSpec(JSON.stringify({ chart: 'complex', expr: 'z^2 + 1', xRange: [-2, 2], yRange: [-2, 2] }))
  assert.equal(domain.field?.spec.kind, 'domain')
  assert.throws(() => parsePlotSpec(JSON.stringify({ chart: 'complex' })), /needs "expr"/)

  const parts = parsePlotSpec(
    JSON.stringify({ chart: 'line', xRange: [0, 1], equations: [{ expr: 'sqrt(x) + i' }] }),
    { samples: 3 },
  )
  assert.deepEqual(parts.lines.map((line) => line.label), ['Re sqrt(x) + i', 'Im sqrt(x) + i'])
  // Graph detail has a floor of 20 samples, so take the sample nearest x = 0.5.
  const nearest = (line: typeof parts.lines[0]) =>
    line.points.reduce((best, point) => (Math.abs(point[0] - 0.5) < Math.abs(best[0] - 0.5) ? point : best))
  close(nearest(parts.lines[0])[1], Math.SQRT1_2, 0.03)
  close(nearest(parts.lines[1])[1], 1)
})

test('fractal modes choose their own windows and rules', () => {
  const mandelbrot = parsePlotSpec(JSON.stringify({ chart: 'fractal', mode: 'mandelbrot', maxIterations: 40 }))
  assert.equal(mandelbrot.field?.spec.kind, 'mandelbrot')
  assert.deepEqual(mandelbrot.xRange, [-2.2, 1])
  assert.deepEqual(mandelbrot.yRange, [-1.4, 1.4])

  const julia = parsePlotSpec(JSON.stringify({ chart: 'julia', c: [-0.8, 0.156] }))
  assert.equal(julia.field?.spec.kind, 'julia')
  assert.deepEqual(julia.yRange, julia.xRange)

  const newton = parsePlotSpec(JSON.stringify({ chart: 'newton', expr: 'z^3 - 1' }))
  assert.equal(newton.field?.spec.kind, 'newton')

  assert.throws(() => parsePlotSpec(JSON.stringify({ chart: 'fractal', mode: 'julia', expr: 'z^2' })), /needs c/)
  assert.throws(() => parsePlotSpec(JSON.stringify({ chart: 'fractal', mode: 'sierpinski' })), /must be mandelbrot, julia or newton/)
  assert.throws(() => parsePlotSpec(JSON.stringify({ chart: 'fractal', maxIterations: 5000 })), /between 8 and 500/)
})

test('fractal pictures: the inside stays bounded, the edges escape', () => {
  const painter = createFieldPainter({ kind: 'mandelbrot', expr: 'z^2 + c', c: [0, 0], maxIter: 50 })
  // The Mandelbrot set contains 0 and not 2.
  assert.match(painter.at(0, 0)[1], /stays bounded/)
  assert.match(painter.at(2, 0)[1], /escapes after/)
  // A Julia set with c = 0 is the unit disc.
  const julia = createFieldPainter({ kind: 'julia', expr: 'z^2 + c', c: [0, 0], maxIter: 60 })
  assert.match(julia.at(0.5, 0)[1], /stays bounded/)
  assert.match(julia.at(1.5, 0)[1], /escapes/)
  // Newton on z^3 - 1 finds one of the three cube roots of 1.
  const newton = createFieldPainter({ kind: 'newton', expr: 'z^3 - 1', c: [0, 0], maxIter: 60 })
  const root = newton.at(1.2, 0.1).find((line) => line.startsWith('root'))
  assert.ok(root, 'a root is reported')
  const [re, im] = root!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!.map(Number)
  // z^3 = 1: re^3 - 3 re im^2 = 1 and 3 re^2 im - im^3 = 0.
  close(re ** 3 - 3 * re * im * im, 1, 1e-3)
  close(3 * re * re * im - im ** 3, 0, 1e-3)
})

test('a deep zoom still paints quickly', () => {
  const painter = createFieldPainter({ kind: 'mandelbrot', expr: 'z^2 + c', c: [0, 0], maxIter: 100 })
  const rgba = new Uint8ClampedArray(4 * 120 * 80)
  const started = performance.now()
  painter.paint({ x0: -0.7436, x1: -0.7436 + 1e-4, y0: 0.1318, y1: 0.1318 + 6.6e-5 }, 120, 80, 0, 80, rgba)
  assert.ok(performance.now() - started < 2000, 'a small picture paints in well under a second')
})

/* ------------------------------------------------ safety and readouts */

test('hostile equations are rejected, not run', () => {
  for (const expr of ['process.exit()', 'x'.repeat(400), '((((', 'z*'.repeat(200), '2xy^']) {
    assert.throws(() => parseMath(expr, ['x', 'z']), PlotError, expr.slice(0, 20))
  }
  // A bare equation that uses y becomes a plane curve, never a code path.
  const plane = parsePlotSpec(JSON.stringify({ chart: 'line', equations: [{ expr: 'y^2 + 7' }] }))
  assert.equal(plane.implicit.length, 1)
  // A y that only appears as output (y = 3) is still a plain line.
  assert.equal(parsePlotSpec(JSON.stringify({ chart: 'line', equations: [{ expr: 'y = 3' }] })).lines.length, 1)
})

test('the new charts read out as sentences', () => {
  const circle = parsePlotSpec(
    JSON.stringify({ chart: 'line', xRange: [-2, 2], yRange: [-2, 2], equations: [{ expr: 'x^2 + y^2 = 1', label: 'circle' }] }),
  )
  const spoken = describePlot(circle)
  assert.ok(spoken.some((line) => line.startsWith('circle: (x^2 + y^2)-(1) = 0')))

  const fractal = parsePlotSpec(JSON.stringify({ chart: 'fractal', mode: 'mandelbrot' }))
  const words = describePlot(fractal)
  assert.match(words[0], /^Mandelbrot fractal/)
  assert.ok(words.length >= 2)

  const domain = parsePlotSpec(JSON.stringify({ chart: 'complex', expr: 'z^2' }))
  assert.match(describePlot(domain)[0], /^Domain colouring/)
})

test('sampleCurve still samples a plain equation', () => {
  const points = sampleCurve('x^2', {}, 5, -1, 1)
  assert.deepEqual(points, [[-1, 1], [-0.5, 0.25], [0, 0], [0.5, 0.25], [1, 1]])
})

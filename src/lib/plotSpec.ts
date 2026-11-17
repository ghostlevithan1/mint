/**
 * Parses the ```plot spec the model emits and turns it into drawable data.
 * Runs in the browser, so graphs need no server or Python. Equations go
 * through a small whitelist parser: nothing model-written is ever eval'd.
 */

import { estimateTextWidth } from './plotGeometry'
import {
  compileComplex,
  compileReal,
  isComplexTree,
  parseMath,
  RESERVED_NAMES,
  usesVar,
} from './mathExpr'
import { createFieldPainter, DEFAULT_ITERATIONS, MAX_ITERATIONS, MIN_ITERATIONS, type FieldSpec } from './complexField'
import { traceImplicit, type Relation } from './implicit'
import { PlotError } from './plotError'

export { PlotError }

const DEFAULT_SAMPLES = 400
const MAX_SAMPLES = 2000

/**
 * Graph detail: how many points are calculated along an equation curve before
 * they are joined with straight lines. It is the student's setting; a graph
 * drawn at 20 shows its corners, one at 2000 looks smooth.
 */
export const PLOT_DETAIL_MIN = 20
export const PLOT_DETAIL_MAX = MAX_SAMPLES
export const PLOT_DETAIL_DEFAULT = 600

export function clampPlotDetail(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return PLOT_DETAIL_DEFAULT
  return Math.round(Math.min(PLOT_DETAIL_MAX, Math.max(PLOT_DETAIL_MIN, number)))
}

const DETAIL_SPAN = Math.log(PLOT_DETAIL_MAX / PLOT_DETAIL_MIN)

/**
 * A slider position (0-100) as a detail value. The scale is logarithmic, since
 * going from 20 to 40 points matters far more than 1900 to 1920, and values
 * keep two significant figures so the readout stays tidy.
 */
export function plotDetailFromPosition(position: number): number {
  const fraction = Math.min(1, Math.max(0, position / 100))
  return clampPlotDetail(Number((PLOT_DETAIL_MIN * Math.exp(DETAIL_SPAN * fraction)).toPrecision(2)))
}

export function plotDetailPosition(detail: number): number {
  return Math.round((100 * Math.log(clampPlotDetail(detail) / PLOT_DETAIL_MIN)) / DETAIL_SPAN)
}
const MAX_EQUATIONS = 6
const MAX_SERIES = 8
const MAX_SERIES_POINTS = 500
const MAX_DATA_POINTS = 2000
const MAX_CATEGORIES = 24
const MAX_POINTS = 12
const MAX_TEXT = 120

export type Line = {
  label: string
  points: [number, number][]
  mode: 'line' | 'scatter'
  /** Set for equation curves so they can be resampled for a wider view. */
  expr?: string
  /** Which part of a complex-valued f(x) this curve draws. */
  part?: 're' | 'im'
  /** Named constants from the spec, needed to resample the curve. */
  params?: Record<string, number>
  /** A helper line, such as y = x in a cobweb: kept out of the legend and the readout. */
  quiet?: boolean
  /** Dash pattern, so a cobweb's staircase stays readable against the curve. */
  style?: 'dashed' | 'soft'
}

/** An equation that is drawn by tracing f(x, y) = 0, or shading where it holds. */
export type ImplicitEquation = {
  label: string
  expr: string
  relation: Relation
  params: Record<string, number>
}

/** A complex or fractal picture: its spec, and the window it starts from. */
export type FieldDrawing = { spec: FieldSpec; params: Record<string, number> }
export type Marker = { x: number; y: number; label: string }
export type Bar = { label: string; value: number }
/** One data series over the shared category labels of a bar or category line chart. */
export type Group = { label: string; values: number[] }
export type Slice = { label: string; value: number }

export type PlotData = {
  chart: 'line' | 'scatter' | 'bar' | 'histogram' | 'pie' | 'cobweb' | 'sequence' | 'complex' | 'fractal'
  title: string
  xLabel: string
  yLabel: string
  grid: boolean
  lines: Line[]
  markers: Marker[]
  /** Histogram bins. */
  bars: Bar[]
  /**
   * Text labels along the category axis. Set for bar charts, and for line
   * charts whose x values are labels (months, names) rather than numbers.
   */
  categories: string[]
  groups: Group[]
  stacked: boolean
  horizontal: boolean
  slices: Slice[]
  donut: boolean
  xRange: [number, number]
  yRange: [number, number]
  /** Equations in x and y, traced over whatever window is on screen. */
  implicit: ImplicitEquation[]
  /** The domain colouring or fractal to draw, if any. */
  field?: FieldDrawing
}

const MAX_SLICES = 12

/** Series and slice colours for every chart. Twelve, so no two pie slices repeat. */
export const PLOT_COLORS = [
  '#86d95f', '#8fb4d9', '#e0b26a', '#d6a28c', '#5fc8b0', '#e5484d',
  '#c9c9cd', '#a1c96a', '#b48ead', '#f0c674', '#7fa7a0', '#d08770',
]

/** True for a line chart drawn over text labels instead of a numeric x axis. */
export function isCategoryLine(data: PlotData): boolean {
  return data.chart === 'line' && data.categories.length > 0
}

// ---------- expressions ----------

/** The original entry point: an equation in x only, for the calculator and older callers. */
export function compileExpression(expr: string): (x: number) => number {
  const fn = compileReal(parseMath(expr, ['x']), ['x'])
  return (x) => fn([x])
}

// ---------- equations in more than one variable ----------

export type EquationClass =
  /** y = f(x), or a bare f(x). */
  | { kind: 'explicit'; expr: string }
  /** f(x, y) = 0, drawn as a curve. */
  | { kind: 'implicit'; expr: string; relation: Relation }
  /** A complex-valued f(x): curves for its real and imaginary parts. */
  | { kind: 'complex'; expr: string }
  /** A recurrence x(n+1) = f(x): the value at each step. */
  | { kind: 'sequence'; expr: string; recurrence: boolean; secondOrder: boolean }

/** Splits "a = b" or "y > x^2" at its top-level relation sign, ignoring anything in brackets. */
function splitRelation(raw: string): { left: string; right: string; relation: Relation } | null {
  let depth = 0
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (char === '(') depth += 1
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0) {
      if (char === '=') return { left: raw.slice(0, index), right: raw.slice(index + 1), relation: '=' }
      if (char === '<' || char === '>') {
        const relation = (raw[index + 1] === '=' ? `${char}=` : char) as Relation
        return { left: raw.slice(0, index), right: raw.slice(index + relation.length), relation }
      }
    }
  }
  return null
}

function classifyEquation(expr: string, params: Record<string, number> = {}): EquationClass {
  const parts = splitRelation(expr)
  const plane = ['x', 'y']
  if (parts) {
    const left = parts.left.trim()
    const right = parts.right.trim()
    const backwards = parts.relation === '<' || parts.relation === '<='
    if (parts.relation !== '=') return { kind: 'implicit', expr: `(${left})-(${right})`, relation: backwards ? '>=' : '<=' }
    // One parse of both sides, so a side that is just "y" still counts as using y.
    const usesY = usesVar(parseMath(`(${left})+(${right})`, plane, params), 'y')
    if (!left) return { kind: 'explicit', expr: right }
    if (!right) return { kind: 'explicit', expr: left }
    // "y = f(x)" (or "f(x) = y") is a plain y coordinate; a y inside f(x) needs the plane.
    if (left === 'y' && !usesVar(parseMath(right, ['x'], params), 'y')) return { kind: 'explicit', expr: right }
    if (right === 'y' && !usesVar(parseMath(left, ['x'], params), 'y')) return { kind: 'explicit', expr: left }
    if (usesY) return { kind: 'implicit', expr: `(${left})-(${right})`, relation: '=' }
    // f(x) = g(x): a y coordinate, not a curve in two variables.
    return { kind: 'explicit', expr: `(${left})-(${right})` }
  }
  if (usesVar(parseMath(expr, plane, params), 'y')) return { kind: 'implicit', expr, relation: '=' }
  return { kind: 'explicit', expr }
}

function samplePart(expr: string, params: Record<string, number>, part: 're' | 'im', x: number): number {
  const fn = compileComplex(parseMath(expr, ['x'], params), ['x'])
  const out = fn([{ re: x, im: 0 }])
  return part === 're' ? out.re : out.im
}

/** y values of an explicit equation, sampled over [lo, hi], or of one part when it is complex. */
export function sampleCurve(
  expr: string,
  params: Record<string, number>,
  samples: number,
  lo: number,
  hi: number,
  part?: 're' | 'im',
): [number, number][] {
  const points: [number, number][] = []
  if (part) {
    for (let index = 0; index < samples; index += 1) {
      const x = lo + ((hi - lo) * index) / (samples - 1)
      points.push([x, samplePart(expr, params, part, x)])
    }
    return points
  }
  const fn = compileReal(parseMath(expr, ['x'], params), ['x'])
  for (let index = 0; index < samples; index += 1) {
    const x = lo + ((hi - lo) * index) / (samples - 1)
    points.push([x, fn([x])])
  }
  return points
}

// ---------- spec validation ----------

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : ''
}

/**
 * Plot coordinates beyond this make the axis maths overflow or stall (a step
 * below the float spacing never advances), so such specs are rejected.
 */
const MAX_COORD = 1e12
const MAX_TICKS = 200

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORD
}

function numbers(value: unknown, field: string, max: number): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max || !value.every(finite)) {
    throw new PlotError(`"${field}" must be a list of 1-${max} numbers.`)
  }
  return value
}

function range(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(finite) || !(value[0] < value[1])) {
    return null
  }
  return [value[0], value[1]]
}

function extent(values: number[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (!Number.isFinite(v) || Math.abs(v) > MAX_COORD) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (lo === Infinity) return [-1, 1]
  if (lo === hi) return [lo - 1, hi + 1]
  const pad = (hi - lo) * 0.06
  return [lo - pad, hi + pad]
}

/** Robust y extent: ignores the spikes near asymptotes (tan, 1/x) that would flatten the curve. */
function curveExtent(values: number[]): [number, number] {
  const sorted = values
    .filter((v) => Number.isFinite(v) && Math.abs(v) <= MAX_COORD)
    .sort((a, b) => a - b)
  if (sorted.length < 20) return extent(sorted)
  const lo = sorted[Math.floor(sorted.length * 0.02)]
  const hi = sorted[Math.ceil(sorted.length * 0.98) - 1]
  const full = sorted[sorted.length - 1] - sorted[0]
  return full > (hi - lo) * 4 ? extent([lo, hi]) : extent(sorted)
}

function labelList(value: unknown, field: string, max: number): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > max ||
    !value.every((item) => typeof item === 'string' || finite(item))
  ) {
    throw new PlotError(`"${field}" must be a list of 1-${max} labels.`)
  }
  return value.map((item) => String(item).trim().slice(0, 40))
}

/**
 * The series of a bar, pie or category line chart: shared category labels
 * (from "categories" or the first series' "x") and one value per label in
 * every series. "labels"/"values" are accepted as aliases for "x"/"y".
 */
function categorySeries(s: Record<string, unknown>, chart: string): { categories: string[]; groups: Group[] } {
  const list = Array.isArray(s.series) ? s.series : []
  if (!list.length) throw new PlotError(`A ${chart} chart needs "series" with "x" labels and "y" values.`)
  if (list.length > MAX_SERIES) throw new PlotError(`At most ${MAX_SERIES} series can be plotted.`)
  let categories = s.categories === undefined ? null : labelList(s.categories, 'categories', MAX_CATEGORIES)
  const groups = list.map((item, index) => {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const values = numbers(record.y ?? record.values, `series[${index}].y`, MAX_CATEGORIES)
    if (!categories) categories = labelList(record.x ?? record.labels, `series[${index}].x`, MAX_CATEGORIES)
    if (values.length !== categories.length) {
      throw new PlotError('Every series needs exactly one "y" value per "x" label.')
    }
    return { label: text(record.label) || (list.length > 1 ? `Series ${index + 1}` : ''), values }
  })
  return { categories: categories ?? [], groups }
}

/** Short value labels for data charts: 1,250 → 1250, 150000 → 150K, 2.4e9 → 2.4B. */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const abs = Math.abs(value)
  for (const [size, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e5, 'K']] as const) {
    if (abs >= size) {
      const scale = suffix === 'K' ? 1e3 : size
      return `${Number((value / scale).toPrecision(3))}${suffix}`
    }
  }
  if (abs !== 0 && abs < 1e-3) return value.toExponential(1)
  return String(Number(value.toPrecision(4)))
}

/**
 * Best-effort repair of the JSON slips models make in plot specs: a string
 * left open (with the object's closing braces swallowed into it), missing
 * closing braces, trailing commas, or prose after the object. Returns the
 * repaired text, or null when the input cannot be salvaged.
 */
export function repairPlotJson(raw: string): string | null {
  const start = raw.indexOf('{')
  if (start < 0) return null
  const stack: string[] = []
  let out = ''
  let inString = false
  let escaped = false

  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i]
    if (inString) {
      if (escaped) {
        out += char
        escaped = false
      } else if (char === '\\') {
        out += char
        escaped = true
      } else if (char === '"') {
        inString = false
        out += char
      } else if (char === '\n' || char === '\r') {
        out += '\\n'
      } else if (char === '\t') {
        out += '\\t'
      } else {
        out += char
      }
      continue
    }
    if (char === '"') {
      inString = true
      out += char
    } else if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']')
      out += char
    } else if (char === '}' || char === ']') {
      if (stack[stack.length - 1] !== char) return null
      stack.pop()
      out += char
      // The object is complete; anything after it is commentary.
      if (!stack.length) return out
    } else if (char === ',') {
      let next = i + 1
      while (next < raw.length && /\s/.test(raw[next])) next += 1
      if (raw[next] !== '}' && raw[next] !== ']') out += char
    } else {
      out += char
    }
  }

  if (inString) {
    // The model often forgets the closing quote and the object's own braces
    // end up inside the string, e.g. "vertex (0,0)}]. Pull them back out.
    const tail = /[}\]]*$/.exec(out)?.[0] ?? ''
    if (tail) out = out.slice(0, out.length - tail.length)
    out += '"'
    for (const char of tail) {
      if (stack[stack.length - 1] !== char) return null
      stack.pop()
      out += char
      if (!stack.length) return out
    }
  }
  while (stack.length) out += stack.pop() ?? ''
  return out
}

export type PlotOptions = {
  /** Points per equation curve; wins over any "samples" the spec asks for. */
  samples?: number
}

export function parsePlotSpec(raw: string, options: PlotOptions = {}): PlotData {
  let spec: unknown
  try {
    spec = JSON.parse(raw)
  } catch {
    // Models occasionally slip: an unfinished string, a trailing comma, the
    // tail of the object inside a string, or prose after the JSON. Repair what
    // can be repaired instead of dropping the whole graph.
    const repaired = repairPlotJson(raw)
    if (repaired === null) throw new PlotError('The plot spec must be valid JSON.')
    try {
      spec = JSON.parse(repaired)
    } catch {
      throw new PlotError('The plot spec must be valid JSON.')
    }
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new PlotError('The plot spec must be a JSON object.')
  }
  const s = spec as Record<string, unknown>
  let chart = (text(s.chart) || 'line').toLowerCase()
  // Common names for the same charts, so a near-miss still draws.
  if (chart === 'donut' || chart === 'doughnut') chart = 'pie'
  if (chart === 'column') chart = 'bar'
  if (chart === 'iterative' || chart === 'iteration' || chart === 'cobweb') chart = 'cobweb'
  if (chart === 'recurrence' || chart === 'iterates' || chart === 'orbit') chart = 'sequence'
  if (chart === 'domain' || chart === 'domain-coloring' || chart === 'complex-plane') chart = 'complex'
  if (chart === 'mandelbrot' || chart === 'julia' || chart === 'newton') {
    s.mode = chart
    chart = 'fractal'
  }
  const charts = ['line', 'scatter', 'bar', 'histogram', 'pie', 'cobweb', 'sequence', 'complex', 'fractal']
  if (!charts.includes(chart)) {
    throw new PlotError('"chart" must be line, scatter, bar, histogram, pie, cobweb, sequence, complex or fractal.')
  }

  const data: PlotData = {
    chart: chart as PlotData['chart'],
    title: text(s.title),
    xLabel: text(s.xLabel),
    yLabel: text(s.yLabel),
    grid: s.grid !== false,
    lines: [],
    markers: [],
    bars: [],
    categories: [],
    groups: [],
    stacked: s.stacked === true,
    horizontal: s.horizontal === true,
    slices: [],
    donut: s.donut === true || /^(donut|doughnut)$/i.test(text(s.chart)),
    xRange: [0, 1],
    yRange: [0, 1],
    implicit: [],
  }
  const params = specParams(s.params)
  if (chart === 'complex') return parseComplex(s, data, params)
  if (chart === 'fractal') return parseFractal(s, data, params)
  if (chart === 'cobweb') return parseCobweb(s, data, params, options)
  if (chart === 'sequence') return parseSequence(s, data, params)

  if (chart === 'pie') {
    const { categories, groups } = categorySeries(s, 'pie')
    const values = groups[0].values
    if (values.some((value) => value < 0)) throw new PlotError('Pie chart values cannot be negative.')
    if (!values.some((value) => value > 0)) throw new PlotError('A pie chart needs at least one value above 0.')
    let slices = categories.map((label, i) => ({ label, value: values[i] })).filter((slice) => slice.value > 0)
    if (slices.length > MAX_SLICES) {
      // Too many slices to read: keep the largest and merge the rest.
      const keep = new Set([...slices].sort((a, b) => b.value - a.value).slice(0, MAX_SLICES - 1))
      const other = slices.filter((slice) => !keep.has(slice)).reduce((sum, slice) => sum + slice.value, 0)
      slices = [...slices.filter((slice) => keep.has(slice)), { label: 'Other', value: other }]
    }
    data.slices = slices
    return data
  }

  if (chart === 'bar') {
    const { categories, groups } = categorySeries(s, 'bar')
    data.categories = categories
    data.groups = groups
    if (groups.length < 2) data.stacked = false
    const values = data.stacked
      ? categories.flatMap((_, i) => {
          let up = 0
          let down = 0
          for (const group of groups) {
            if (group.values[i] >= 0) up += group.values[i]
            else down += group.values[i]
          }
          return [up, down]
        })
      : groups.flatMap((group) => group.values)
    data.yRange = extent([0, ...values])
    if (Math.min(...values) >= 0) data.yRange[0] = 0
    if (Math.max(...values) <= 0) data.yRange[1] = 0
    return data
  }

  // A line chart whose "x" values are text (months, names) runs over categories.
  const firstSeries = Array.isArray(s.series) ? (s.series[0] as Record<string, unknown> | undefined) : undefined
  const textX =
    Array.isArray(s.categories) ||
    (Array.isArray(firstSeries?.x) && firstSeries.x.some((item) => typeof item === 'string'))
  if (chart === 'line' && textX && !(Array.isArray(s.equations) && s.equations.length)) {
    const { categories, groups } = categorySeries(s, 'line')
    data.categories = categories
    data.groups = groups
    data.yRange = range(s.yRange) ?? extent(groups.flatMap((group) => group.values))
    return data
  }

  if (chart === 'histogram') {
    const values = numbers(s.data, 'data', MAX_DATA_POINTS)
    const binCount = Math.round(Math.min(100, Math.max(4, finite(s.bins) ? s.bins : 20)))
    const [lo, hi] = extent(values)
    const width = (hi - lo) / binCount
    const counts = new Array<number>(binCount).fill(0)
    for (const v of values) counts[Math.min(binCount - 1, Math.floor((v - lo) / width))] += 1
    data.bars = counts.map((value, i) => ({ label: (lo + width * (i + 0.5)).toPrecision(3), value }))
    data.xRange = [lo, hi]
    data.yRange = [0, Math.max(...counts) * 1.08]
    return data
  }

  // line and scatter
  const xRange = range(s.xRange) ?? [-10, 10]
  const samples =
    options.samples !== undefined
      ? clampPlotDetail(options.samples)
      : Math.round(Math.min(MAX_SAMPLES, Math.max(32, finite(s.samples) ? s.samples : DEFAULT_SAMPLES)))
  const mode = chart === 'scatter' ? 'scatter' : 'line'
  const ys: number[] = []

  const equations = Array.isArray(s.equations) ? s.equations : []
  if (equations.length > MAX_EQUATIONS) throw new PlotError(`At most ${MAX_EQUATIONS} equations can be plotted.`)
  for (const item of equations) {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const expr = typeof record.expr === 'string' ? record.expr.trim() : ''
    if (!expr) throw new PlotError('Each equation needs an "expr" string.')
    const label = text(record.label) || expr
    const equation = classifyEquation(expr, params)
    if (equation.kind === 'implicit') {
      data.implicit.push({ label, expr: equation.expr, relation: equation.relation, params })
      continue
    }
    // `sqrt(x) + i` is explicit in shape but complex in value, so it is split too.
    if (equation.kind === 'explicit' && isComplexTree(parseMath(equation.expr, ['x'], params))) {
      for (const part of ['re', 'im'] as const) {
        const points = sampleCurve(equation.expr, params, samples, xRange[0], xRange[1], part)
        ys.push(...points.map(([, y]) => y))
        data.lines.push({
          label: part === 'im' ? `Im ${label}` : `Re ${label}`,
          points,
          mode,
          expr: equation.expr,
          part,
          params,
        })
      }
      continue
    }
    if (equation.kind === 'complex') {
      for (const part of ['re', 'im'] as const) {
        const points = sampleCurve(equation.expr, params, samples, xRange[0], xRange[1], part)
        ys.push(...points.map(([, y]) => y))
        data.lines.push({
          label: part === 'im' ? `Im ${label}` : `Re ${label}`,
          points,
          mode,
          expr: equation.expr,
          part,
          params,
        })
      }
      continue
    }
    if (equation.kind === 'sequence') throw new PlotError('Use the "sequence" chart for a recurrence in n.')
    const points = sampleCurve(equation.expr, params, samples, xRange[0], xRange[1])
    ys.push(...points.map(([, y]) => y))
    data.lines.push({ label, points, mode, expr: equation.expr, params })
  }

  const series = Array.isArray(s.series) ? s.series : []
  if (series.length > MAX_SERIES) throw new PlotError(`At most ${MAX_SERIES} series can be plotted.`)
  let seriesX: number[] = []
  series.forEach((item, index) => {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const xs = numbers(record.x, `series[${index}].x`, MAX_SERIES_POINTS)
    const yv = numbers(record.y, `series[${index}].y`, MAX_SERIES_POINTS)
    if (xs.length !== yv.length) throw new PlotError('Series "x" and "y" must have the same length.')
    data.lines.push({
      label: text(record.label) || `Series ${data.lines.length + 1}`,
      points: xs.map((x, i) => [x, yv[i]]),
      mode,
    })
    seriesX = seriesX.concat(xs)
    ys.push(...yv)
  })

  const points = Array.isArray(s.points) ? s.points.slice(0, MAX_POINTS) : []
  for (const item of points) {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    if (!finite(record.x) || !finite(record.y)) continue
    data.markers.push({ x: record.x, y: record.y, label: text(record.label).slice(0, 40) })
    ys.push(record.y)
  }

  if (!data.lines.length && !data.markers.length && !data.implicit.length) {
    throw new PlotError('Nothing to plot: add "equations", "series" or "points".')
  }

  // A circle or an ellipse spans the same distance on both axes.
  const implicitOnly = !data.lines.length && !data.markers.length
  const implicitX = range(s.xRange) ?? [-5, 5]
  data.xRange = data.lines.length || data.markers.length ? (equations.length || !seriesX.length ? xRange : extent(seriesX)) : implicitX
  data.yRange =
    range(s.yRange) ??
    (data.lines.length || data.markers.length
      ? equations.length
        ? curveExtent(ys)
        : extent(ys)
      : implicitOnly
        ? implicitX
        : xRange)
  return data
}

// ---------- the new chart types ----------

function specParams(value: unknown): Record<string, number> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new PlotError('"params" must be an object of numbers.')
  const params: Record<string, number> = {}
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    const key = name.trim().toLowerCase()
    if (!/^[a-z][a-z0-9]{0,15}$/.test(key) || RESERVED_NAMES.has(key)) {
      throw new PlotError(`"${name}" cannot be used as a parameter name.`)
    }
    if (!finite(raw)) throw new PlotError(`Parameter "${name}" must be a number.`)
    params[key] = raw
  }
  return params
}

function equationText(s: Record<string, unknown>): string {
  if (typeof s.expr === 'string' && s.expr.trim()) return s.expr.trim()
  const first = Array.isArray(s.equations) ? (s.equations[0] as Record<string, unknown> | undefined) : undefined
  return typeof first?.expr === 'string' ? first.expr.trim() : ''
}

function count(value: unknown, field: string, lo: number, hi: number, fallback: number): number {
  if (value === undefined || value === null) return fallback
  if (!finite(value) || value < lo || value > hi) {
    throw new PlotError(`"${field}" must be between ${lo} and ${hi}.`)
  }
  return Math.round(value)
}

/** A start value for an iteration: x0, or the first of "start". */
function startValue(s: Record<string, unknown>): number {
  if (Array.isArray(s.start) && finite(s.start[0])) return s.start[0]
  return finite(s.x0) ? s.x0 : 0.5
}

/** The window an iteration starts in, kept square by default so the cobweb reads correctly. */
function iterationWindow(data: PlotData, s: Record<string, unknown>) {
  const x = range(s.xRange) ?? [-1, 3.2]
  data.xRange = x
  data.yRange = range(s.yRange) ?? x
}

/** x(n+1) = f(x): the curve, the line y = x, and the staircase from x0. */
function parseCobweb(s: Record<string, unknown>, data: PlotData, params: Record<string, number>, options: PlotOptions): PlotData {
  const expr = equationText(s)
  if (!expr) throw new PlotError('A cobweb needs "expr": the rule x(n+1) = f(x).')
  const steps = count(s.steps, 'steps', 1, 200, 20)
  const start = startValue(s)
  const tree = parseMath(expr, ['x'], params)
  if (!usesVar(tree, 'x')) throw new PlotError('A cobweb rule has to use x, such as x^2 - 1.')
  const fn = compileReal(tree, ['x'])
  const samples =
    options.samples !== undefined
      ? clampPlotDetail(options.samples)
      : Math.round(Math.min(MAX_SAMPLES, Math.max(32, finite(s.samples) ? s.samples : DEFAULT_SAMPLES)))

  iterationWindow(data, s)
  const curve = sampleCurve(expr, params, samples, data.xRange[0], data.xRange[1])
  data.lines.push({ label: `y = ${expr}`, points: curve, mode: 'line', expr, params })
  data.lines.push({
    label: 'y = x',
    points: [[data.xRange[0], data.xRange[0]], [data.xRange[1], data.xRange[1]]],
    mode: 'line',
    quiet: true,
    style: 'soft',
  })

  // The staircase: up to the curve, across to y = x, and repeat.
  const path: [number, number][] = [[start, 0], [start, start]]
  let x = start
  for (let step = 0; step < steps; step += 1) {
    const next = fn([x])
    if (!Number.isFinite(next) || Math.abs(next) > MAX_COORD) break
    path.push([x, next], [next, next])
    x = next
  }
  data.lines.push({ label: `from x0 = ${spoken(start)}`, points: path, mode: 'line', quiet: true, style: 'dashed' })
  data.markers.push({ x: start, y: 0, label: `x0 = ${spoken(start)}` })
  return data
}

/** x(n+1) = f(x), or x(n) = f(n) when the rule uses n: the values at each step. */
function parseSequence(s: Record<string, unknown>, data: PlotData, params: Record<string, number>): PlotData {
  const expr = equationText(s)
  if (!expr) throw new PlotError('A sequence needs "expr": a rule in n or x.')
  const terms = count(s.terms, 'terms', 1, 400, 20)
  const tree = parseMath(expr, ['n', 'x', 'x1'], params)
  const indexed = usesVar(tree, 'n') && !usesVar(tree, 'x')
  const values: number[] = []

  if (indexed) {
    const fn = compileReal(tree, ['n'])
    for (let n = 0; n < terms; n += 1) values.push(fn([n]))
  } else if (usesVar(tree, 'x1')) {
    // A two-term rule such as x(n+1) = x(n) + x(n-1) (Fibonacci) needs both starts.
    const second = compileReal(tree, ['x', 'x1'])
    if (!finite(s.x1)) throw new PlotError('A two-term recurrence needs "x1" as its second start value.')
    let a = startValue(s)
    let b = s.x1
    values.push(a, b)
    for (let step = 2; step < terms; step += 1) {
      const next = second([b, a])
      if (!Number.isFinite(next)) break
      values.push(next)
      a = b
      b = next
    }
  } else {
    const firstOrder = compileReal(tree, ['x'])
    let x = startValue(s)
    values.push(x)
    for (let step = 1; step < terms; step += 1) {
      x = firstOrder([x])
      if (!Number.isFinite(x)) break
      values.push(x)
    }
  }

  const points = values.map((y, n): [number, number] => [n, y])
  data.lines.push({
    label: expr,
    points,
    mode: s.join === true ? 'line' : 'scatter',
    params,
  })
  data.xRange = range(s.xRange) ?? [0, Math.max(1, points.length - 1)]
  data.yRange = range(s.yRange) ?? extent(values)
  data.xLabel = data.xLabel || 'n'
  return data
}

function fieldWindow(data: PlotData, s: Record<string, unknown>, fallback: [number, number], squareFallback = true) {
  const x = range(s.xRange) ?? fallback
  data.xRange = x
  const y = range(s.yRange) ?? (squareFallback ? x : fallback)
  data.yRange = y
}

/** Domain colouring of f(z). */
function parseComplex(s: Record<string, unknown>, data: PlotData, params: Record<string, number>): PlotData {
  const expr = equationText(s)
  if (!expr) throw new PlotError('A complex graph needs "expr": a function of z.')
  const tree = parseMath(expr, ['z', 'x', 'y'], params)
  if (!isComplexTree(tree) && !usesVar(tree, 'z')) {
    throw new PlotError('A complex graph needs a function of z, such as z^2 + 1.')
  }
  const spec: FieldSpec = { kind: 'domain', expr }
  createFieldPainter(spec, params)
  data.field = { spec, params }
  fieldWindow(data, s, [-2.2, 2.2])
  data.xLabel = data.xLabel || 'Re z'
  data.yLabel = data.yLabel || 'Im z'
  return data
}

const FRACTAL_WINDOWS: Record<string, [number, number]> = {
  mandelbrot: [-2.2, 1],
  julia: [-1.8, 1.8],
  newton: [-1.8, 1.8],
}

function parseFractal(s: Record<string, unknown>, data: PlotData, params: Record<string, number>): PlotData {
  const mode = text(s.mode).toLowerCase() || 'mandelbrot'
  if (mode !== 'mandelbrot' && mode !== 'julia' && mode !== 'newton') {
    throw new PlotError('A fractal "mode" must be mandelbrot, julia or newton.')
  }
  // The usual rule for each picture; "expr" may replace it.
  const fallback = mode === 'mandelbrot' ? 'z^2 + c' : mode === 'julia' ? 'z^2 + c' : 'z^3 - 1'
  const expr = equationText(s) || fallback
  const maxIter = count(s.maxIterations ?? s.iterations, 'iterations', MIN_ITERATIONS, MAX_ITERATIONS, DEFAULT_ITERATIONS)
  const usesC = usesVar(parseMath(expr, ['z', 'c'], params), 'c')
  if (mode === 'julia' && !usesC) throw new PlotError('A Julia set needs c in its rule, such as z^2 + c.')
  if (mode === 'newton' && !usesVar(parseMath(expr, ['z'], params), 'z')) {
    throw new PlotError('A Newton fractal needs a polynomial in z, such as z^3 - 1.')
  }

  const rawC = s.c
  let c: [number, number]
  if (Array.isArray(rawC) && finite(rawC[0]) && finite(rawC[1])) c = [rawC[0], rawC[1]]
  else if (rawC && typeof rawC === 'object') {
    const record = rawC as Record<string, unknown>
    c = [finite(record.re) ? record.re : finite(record.real) ? (record.real as number) : -0.8, finite(record.im) ? record.im : finite(record.imaginary) ? (record.imaginary as number) : 0.156]
  } else c = [-0.8, 0.156]

  const spec: FieldSpec = { kind: mode, expr, c, maxIter }
  createFieldPainter(spec, params)
  data.field = { spec, params }
  // Each picture has its own classic window; a Julia or Newton picture is square.
  data.xRange = range(s.xRange) ?? (mode === 'mandelbrot' ? [-2.2, 1] : FRACTAL_WINDOWS[mode])
  data.yRange = range(s.yRange) ?? (mode === 'mandelbrot' ? [-1.4, 1.4] : data.xRange)
  data.xLabel = data.xLabel || 'Re'
  data.yLabel = data.yLabel || 'Im'
  return data
}

function spoken(value: number): string {
  return String(Number(value.toPrecision(4)))
}

/** A share of a total as a percentage with at most one decimal place. */
export function percent(value: number, total: number): string {
  if (!(total > 0)) return '0%'
  return `${Number(((value / total) * 100).toFixed(1))}%`
}

/**
 * The graph as plain sentences, for readers who cannot see it: the window,
 * then values along each curve (or its data points), then the marked points.
 * The drawing's own click-for-values needs a pointer; this does not.
 */
const RELATION_WORDS: Record<Relation, string> = { '=': '= 0', '<': '< 0', '<=': '≤ 0', '>': '> 0', '>=': '≥ 0' }

export function describePlot(data: PlotData): string[] {
  const out: string[] = []
  if (data.field) {
    const { spec } = data.field
    if (spec.kind === 'domain') {
      out.push(`Domain colouring of f(z) = ${spec.expr}, from x ${spoken(data.xRange[0])} to ${spoken(data.xRange[1])} and y ${spoken(data.yRange[0])} to ${spoken(data.yRange[1])}.`)
      out.push('The angle of f(z) sets the colour; zeros are dark and poles bright.')
    } else {
      const name = spec.kind === 'mandelbrot' ? 'Mandelbrot' : spec.kind === 'julia' ? 'Julia' : 'Newton'
      out.push(`${name} fractal of ${spec.expr} in the window x ${spoken(data.xRange[0])} to ${spoken(data.xRange[1])}, y ${spoken(data.yRange[0])} to ${spoken(data.yRange[1])}.`)
      out.push(spec.kind === 'newton' ? 'Each colour is a root the iteration settles on; darker points take longer.' : `Points escape, or stay bounded after ${spec.maxIter} steps (dark).`)
    }
    return out
  }
  if (data.chart === 'histogram') {
    out.push(`Histogram with ${data.bars.length} bars.`)
    for (const bar of data.bars.slice(0, 40)) out.push(`${bar.label}: ${spoken(bar.value)}`)
    return out
  }
  if (data.chart === 'pie') {
    const total = data.slices.reduce((sum, slice) => sum + slice.value, 0)
    out.push(`${data.donut ? 'Donut' : 'Pie'} chart with ${data.slices.length} slices, totalling ${spoken(total)}.`)
    for (const slice of data.slices) {
      out.push(`${slice.label}: ${spoken(slice.value)} (${percent(slice.value, total)})`)
    }
    return out
  }
  if (data.chart === 'bar' || isCategoryLine(data)) {
    const single = data.groups.length === 1
    if (data.chart === 'bar') {
      const kind = `${data.horizontal ? 'Horizontal ' : ''}${single ? 'bar' : data.stacked ? 'stacked bar' : 'grouped bar'} chart`
      const head = kind[0].toUpperCase() + kind.slice(1)
      out.push(
        single
          ? `${head} with ${data.categories.length} bars.`
          : `${head} with ${data.categories.length} categories and ${data.groups.length} series.`,
      )
    } else {
      out.push(`Line graph over ${data.categories.length} labels${single ? '' : `, ${data.groups.length} series`}.`)
    }
    data.categories.forEach((category, i) => {
      out.push(
        single
          ? `${category}: ${spoken(data.groups[0].values[i])}`
          : `${category}: ${data.groups.map((group) => `${group.label} ${spoken(group.values[i])}`).join(', ')}`,
      )
    })
    return out
  }

  const kind = data.chart === 'scatter' ? 'Scatter plot' : 'Line graph'
  const axis = (label: string, fallback: string) => (label ? `${label} (${fallback})` : fallback)
  out.push(
    `${kind}. ${axis(data.xLabel, 'x')} runs from ${spoken(data.xRange[0])} to ${spoken(data.xRange[1])}; ` +
      `${axis(data.yLabel, 'y')} from ${spoken(data.yRange[0])} to ${spoken(data.yRange[1])}.`,
  )
  for (const line of data.lines) {
    const points = line.points
    if (line.expr && points.length > 1) {
      // Seven evenly spaced readings give the shape without listing every point.
      const readings = Array.from({ length: 7 }, (_, step) => {
        const [x, y] = points[Math.round((step * (points.length - 1)) / 6)]
        return `x = ${spoken(x)}, y = ${Number.isFinite(y) ? spoken(y) : 'undefined'}`
      })
      out.push(`${line.label}: ${readings.join('; ')}`)
    } else {
      const shown = points.slice(0, 12).map(([x, y]) => `(${spoken(x)}, ${spoken(y)})`)
      const more = points.length > 12 ? `, and ${points.length - 12} more` : ''
      out.push(`${line.label}: ${shown.join(' ')}${more}`)
    }
  }
  for (const curve of data.implicit) {
    // A few points on the curve, found where the traced pieces cross the view.
    const points = sampledCurvePoints(curve, data)
    out.push(`${curve.label}: ${curve.expr} ${RELATION_WORDS[curve.relation]}${points.length ? `, through ${points.join(', ')}` : ''}`)
  }
  for (const marker of data.markers) {
    out.push(`Marked point${marker.label ? ` ${marker.label}` : ''} at (${spoken(marker.x)}, ${spoken(marker.y)})`)
  }
  return out
}

/** Points on an implicit curve, for the spoken description: its leftmost, middle and rightmost. */
function sampledCurvePoints(curve: ImplicitEquation, data: PlotData): string[] {
  try {
    const traced = traceImplicit(implicitFunction(curve), { x0: data.xRange[0], x1: data.xRange[1], y0: data.yRange[0], y1: data.yRange[1] }, curve.relation)
    const count = traced.segments.length / 4
    if (!count) return []
    const picks = [0, Math.floor(count / 2), count - 1]
    return picks.map((index) => `(${spoken(traced.segments[index * 4])}, ${spoken(traced.segments[index * 4 + 1])})`)
  } catch {
    return []
  }
}

/** f(x, y) for an implicit equation, compiled once per call. */
export function implicitFunction(curve: ImplicitEquation): (x: number, y: number) => number {
  const fn = compileReal(parseMath(curve.expr, ['x', 'y'], curve.params), ['x', 'y'])
  return (x, y) => fn([x, y])
}

/** The "nice" step (1, 2, 5 × 10^n) closest to a requested spacing. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  // The candidate nearest to the raw step, so the count stays close to the target.
  return [1, 2, 5, 10]
    .map((m) => m * magnitude)
    .reduce((best, m) => (Math.abs(Math.log(m / raw)) < Math.abs(Math.log(best / raw)) ? m : best))
}

/** Tick values at an exact step covering [lo, hi]. */
export function ticksBetween(lo: number, hi: number, step: number): number[] {
  if (!(step > 0) || !Number.isFinite(step)) return []
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !((hi - lo) / step <= MAX_TICKS)) return []
  const ticks: number[] = []
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; ) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)))
    const next = v + step
    // A step smaller than the float spacing at v would never advance.
    if (!(next > v) || ticks.length >= MAX_TICKS) break
    v = next
  }
  return ticks
}

/** Evenly spaced "nice" tick values (1, 2, 5 × 10^n) covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, target = 6): number[] {
  return ticksBetween(lo, hi, niceStep((hi - lo) / target))
}

/**
 * One step shared by both axes, with a target per axis so neither gets too
 * crowded. Equal data units plus equal steps make every grid cell square.
 */
export function sharedTicks(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  xTarget = 7,
  yTarget = 5,
): { x: number[]; y: number[]; step: number } {
  const step = Math.max(niceStep((x1 - x0) / xTarget), niceStep((y1 - y0) / yTarget))
  return { x: ticksBetween(x0, x1, step), y: ticksBetween(y0, y1, step), step }
}

// ---------- tick formatting ----------

/** The default tick label: precise enough to read, short enough to scan. */
function plainTick(value: number): string {
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e5 || abs < 1e-3) return value.toExponential(1)
  return String(Number(value.toPrecision(4)))
}

/**
 * Formats a tick value, falling back to shorter scientific forms when the
 * label would be wider than `maxWidth` (viewBox units). Long y-axis labels
 * would otherwise run off the left edge of the canvas, because that axis has
 * the least room.
 */
export function formatTick(value: number, maxWidth = Infinity): string {
  const base = plainTick(value)
  if (estimateTextWidth(base) <= maxWidth || value === 0 || !Number.isFinite(value)) return base
  for (const digits of [1, 0]) {
    const label = value.toExponential(digits)
    if (estimateTextWidth(label) <= maxWidth) return label
  }
  return value.toExponential(0)
}

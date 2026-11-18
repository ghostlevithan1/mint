/**
 * The maths behind every graph: a whitelist parser that turns an equation into
 * a small tree, and two evaluators for it, one for real numbers and one for
 * complex numbers. Nothing a model writes is ever run as code; an unknown name,
 * symbol or function is rejected before anything is calculated.
 */

import { PlotError } from './plotError'

export const MAX_EXPR_CHARS = 300

export type MathNode =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'neg'; a: MathNode }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: MathNode; b: MathNode }
  | { t: 'call'; name: string; args: MathNode[] }

type FnSpec = { fn?: (...args: number[]) => number; min: number; max: number }

const one = (fn: (value: number) => number): FnSpec => ({ fn, min: 1, max: 1 })
const two = (fn: (a: number, b: number) => number): FnSpec => ({ fn, min: 2, max: 2 })

/**
 * The Lanczos coefficients (g = 7, n = 9). With them, gammaValue matches the
 * true gamma function to about 15 significant digits for ordinary inputs, which
 * is enough for graphs and for the calculator.
 */
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
]

/** The gamma function Γ(x) for real x. Poles at 0, -1, -2 ... are NaN. */
export function gammaValue(x: number): number {
  if (!Number.isFinite(x)) return x
  if (Number.isInteger(x)) return x > 0 ? factorialValue(x - 1) : Number.NaN
  // Reflection keeps the series below in its accurate range for negative x.
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaValue(1 - x))
  const z = x - 1
  let series = LANCZOS[0]
  for (let index = 1; index < LANCZOS.length; index += 1) series += LANCZOS[index] / (z + index)
  const t = z + 7.5
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * series
}

/** n! for whole n, and Γ(n + 1) for other values, as on a scientific calculator. */
export function factorialValue(n: number): number {
  if (!Number.isFinite(n)) return Number.NaN
  if (Number.isInteger(n)) {
    if (n < 0) return Number.NaN
    if (n > 170) return Number.POSITIVE_INFINITY
    let product = 1
    for (let step = 2; step <= n; step += 1) product *= step
    return product
  }
  return gammaValue(n + 1)
}

/** ln|Γ(x)|, for values whose factorial overflows a double. */
export function lgammaValue(x: number): number {
  const gamma = gammaValue(x)
  return Number.isFinite(gamma) ? Math.log(Math.abs(gamma)) : gamma
}

/** Every function the parser knows, with how many values each takes. */
const FUNCTIONS: Record<string, FnSpec> = {
  sin: one(Math.sin), cos: one(Math.cos), tan: one(Math.tan),
  asin: one(Math.asin), acos: one(Math.acos), atan: one(Math.atan),
  sinh: one(Math.sinh), cosh: one(Math.cosh), tanh: one(Math.tanh),
  exp: one(Math.exp), log: one(Math.log), ln: one(Math.log), log2: one(Math.log2), log10: one(Math.log10),
  sqrt: one(Math.sqrt), cbrt: one(Math.cbrt), abs: one(Math.abs),
  floor: one(Math.floor), ceil: one(Math.ceil), round: one(Math.round), sign: one(Math.sign),
  fract: one((value) => value - Math.floor(value)),
  min: { fn: Math.min, min: 1, max: 8 },
  max: { fn: Math.max, min: 1, max: 8 },
  pow: two(Math.pow),
  atan2: two(Math.atan2),
  mod: two((a, b) => ((a % b) + b) % b),
  // Calculus and sequences. The first argument is the expression; see compileSpecial.
  sum: { min: 3, max: 3 },
  summation: { min: 3, max: 3 },
  integral: { min: 3, max: 3 },
  integrate: { min: 3, max: 3 },
  derivative: { min: 2, max: 2 },
  deriv: { min: 2, max: 2 },
  difference: { min: 2, max: 3 },
  fdiff: { min: 2, max: 3 },
  factorial: one(factorialValue),
  gamma: one(gammaValue),
  lgamma: one(lgammaValue),
  // Real-valued stand-ins, so an equation written for complex numbers also runs on reals.
  re: one((value) => value),
  im: one(() => 0),
  conj: one((value) => value),
  arg: one((value) => (value >= 0 ? 0 : Math.PI)),
}

export const FUNCTION_NAMES = new Set(Object.keys(FUNCTIONS))
export const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI }

/** Functions with a complex-number meaning. The rest (floor, min, mod ...) only make sense for reals. */
const COMPLEX_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
  'exp', 'log', 'ln', 'log2', 'log10', 'sqrt', 'abs', 'pow', 're', 'im', 'conj', 'arg',
])
/** Functions that only a complex calculation gives a different answer for. */
const COMPLEX_MARKERS = new Set(['re', 'im', 'conj', 'arg'])

/** Names a spec may not reuse for its own parameters. */
export const RESERVED_NAMES = new Set([
  ...FUNCTION_NAMES, ...Object.keys(CONSTANTS), 'x', 'y', 'z', 'n', 't', 'i', 'p', 'c',
])

/** Calls that bind an index of their own, valid only inside their expression. */
const BINDER_NAMES: Record<string, string> = { sum: 'n', summation: 'n' }

const SYMBOLS: Record<string, string> = {
  'π': ' pi ', 'τ': ' tau ', '−': ' - ', '–': ' - ', '—': ' - ',
  '×': ' * ', '·': ' * ', '⋅': ' * ', '÷': ' / ',
}

function normalize(expr: string): string {
  return expr.replace(/[πτ−–—×·⋅÷]/g, (symbol) => SYMBOLS[symbol] ?? symbol)
}

function tokenize(expr: string): string[] {
  return normalize(expr).trim().replace(/\*\*/g, '^').match(/\d*\.?\d+(?:e[+-]?\d+)?|[a-z_][a-z0-9_]*|[-+*/^(),!]|\S/gi) ?? []
}

/**
 * Splits a run of letters such as "xy" or "xsin" into the names it is made of
 * (x*y, x*sin), so implicit multiplication works between variables too.
 */
function splitName(name: string, known: string[], allowFunction: boolean): string[] | null {
  let budget = 2000
  const walk = (rest: string): string[] | null => {
    if (!rest) return []
    if (budget-- <= 0) return null
    for (const candidate of known) {
      if (rest.startsWith(candidate)) {
        const tail = walk(rest.slice(candidate.length))
        if (tail) return [candidate, ...tail]
      }
    }
    return allowFunction && FUNCTION_NAMES.has(rest) ? [rest] : null
  }
  return walk(name)
}

/** Parses an equation. `vars` are the names that stand for inputs; `params` are named constants. */
export function parseMath(expr: string, vars: readonly string[], params: Record<string, number> = {}): MathNode {
  if (expr.length > MAX_EXPR_CHARS) throw new PlotError(`Equations must be 1-${MAX_EXPR_CHARS} characters.`)
  const raw = tokenize(expr.trim())
  if (!raw.length) throw new PlotError(`Equations must be 1-${MAX_EXPR_CHARS} characters.`)

  // i is always the imaginary unit, even where it is not an input (as in 3 + 4i).
  const names = new Set<string>([...vars, ...Object.keys(params), ...Object.keys(CONSTANTS), 'i'])
  const known = [...new Set([...names, 'i'])].sort((a, b) => b.length - a.length)
  const tokens: string[] = []
  raw.forEach((token, index) => {
    if (!/^[a-z_]/i.test(token)) {
      tokens.push(token)
      return
    }
    const name = token.toLowerCase()
    const callsNext = raw[index + 1] === '('
    if (names.has(name) || (callsNext && FUNCTION_NAMES.has(name))) {
      tokens.push(name)
      return
    }
    const pieces = splitName(name, known, callsNext)
    tokens.push(...(pieces ?? [name]))
  })

  let pos = 0
  // Names bound by a surrounding call, such as the n in sum(n^2, 1, 10).
  let bound = new Set<string>()
  const peek = () => tokens[pos]
  const take = () => tokens[pos++]
  const expect = (token: string) => {
    if (take() !== token) throw new PlotError('The equation is not valid math syntax.')
  }
  const startsPrimary = (token: string | undefined) =>
    token !== undefined && (token === '(' || /^[\d.a-z_]/i.test(token))

  const expression = (): MathNode => {
    let left = term()
    while (peek() === '+' || peek() === '-') {
      const op = take() as '+' | '-'
      left = { t: 'bin', op, a: left, b: term() }
    }
    return left
  }

  const term = (): MathNode => {
    let left = unary()
    for (;;) {
      const token = peek()
      if (token === '*' || token === '/') {
        take()
        left = { t: 'bin', op: token, a: left, b: unary() }
      } else if (startsPrimary(token)) {
        // Implicit multiplication, as in 2x, xy or 3sin(x).
        left = { t: 'bin', op: '*', a: left, b: power() }
      } else {
        return left
      }
    }
  }

  const unary = (): MathNode => {
    if (peek() === '-') {
      take()
      return { t: 'neg', a: unary() }
    }
    if (peek() === '+') {
      take()
      return unary()
    }
    return power()
  }

  const power = (): MathNode => {
    let base = primary()
    // Postfix factorial, as in 5! or x!: it binds tighter than a power.
    while (peek() === '!') {
      take()
      base = { t: 'call', name: 'factorial', args: [base] }
    }
    if (peek() !== '^') return base
    take()
    return { t: 'bin', op: '^', a: base, b: unary() }
  }

  const primary = (): MathNode => {
    const token = take()
    if (token === undefined) throw new PlotError('The equation ends too early.')
    if (token === '(') {
      const inner = expression()
      expect(')')
      return inner
    }
    if (/^\d|^\./.test(token)) {
      const value = Number(token)
      if (!Number.isFinite(value)) throw new PlotError('Numbers in equations must be finite.')
      return { t: 'num', v: value }
    }
    const name = token.toLowerCase()
    if (vars.includes(name) || bound.has(name) || name === 'i') return { t: 'var', name }
    if (Object.hasOwn(params, name)) return { t: 'num', v: params[name] }
    if (Object.hasOwn(CONSTANTS, name)) return { t: 'num', v: CONSTANTS[name] }
    if (Object.hasOwn(FUNCTIONS, name) && peek() === '(') {
      take()
      // A summation names its own index, so n is valid inside its expression.
      const binder = BINDER_NAMES[name]
      const outer = bound
      if (binder) bound = new Set([...bound, binder])
      const args: MathNode[] = [expression()]
      bound = outer
      while (peek() === ',') {
        take()
        args.push(expression())
      }
      expect(')')
      const spec = FUNCTIONS[name]
      if (args.length < spec.min || args.length > spec.max) {
        throw new PlotError(
          spec.min === spec.max
            ? `${name} takes ${spec.min === 1 ? 'one value' : `${spec.min} values`}.`
            : `${name} takes ${spec.min} to ${spec.max} values.`,
        )
      }
      return { t: 'call', name, args }
    }
    throw new PlotError(`Unknown name "${token}" in the equation.`)
  }

  const tree = expression()
  if (pos < tokens.length) throw new PlotError('The equation is not valid math syntax.')
  return tree
}

/** True when the tree mentions the variable. */
export function usesVar(node: MathNode, name: string): boolean {
  switch (node.t) {
    case 'num':
      return false
    case 'var':
      return node.name === name
    case 'neg':
      return usesVar(node.a, name)
    case 'bin':
      return usesVar(node.a, name) || usesVar(node.b, name)
    case 'call':
      return node.args.some((arg) => usesVar(arg, name))
  }
}

/** True for an equation that needs complex arithmetic: it uses i, or re/im/arg/conj. */
export function isComplexTree(node: MathNode): boolean {
  switch (node.t) {
    case 'num':
      return false
    case 'var':
      return node.name === 'i'
    case 'neg':
      return isComplexTree(node.a)
    case 'bin':
      return isComplexTree(node.a) || isComplexTree(node.b)
    case 'call':
      return COMPLEX_MARKERS.has(node.name) || node.args.some(isComplexTree)
  }
}

// ---------- real numbers ----------

export type RealFn = (values: ArrayLike<number>) => number

/** Compiles to a function of the input values, given in the order of `vars`. */
export function compileReal(node: MathNode, vars: readonly string[]): RealFn {
  switch (node.t) {
    case 'num': {
      const value = node.v
      return () => value
    }
    case 'var': {
      const index = vars.indexOf(node.name)
      if (index < 0) throw new PlotError(`Unknown name "${node.name}" in the equation.`)
      return (values) => values[index]
    }
    case 'neg': {
      const a = compileReal(node.a, vars)
      return (values) => -a(values)
    }
    case 'bin': {
      const a = compileReal(node.a, vars)
      const b = compileReal(node.b, vars)
      switch (node.op) {
        case '+': return (values) => a(values) + b(values)
        case '-': return (values) => a(values) - b(values)
        case '*': return (values) => a(values) * b(values)
        case '/': return (values) => a(values) / b(values)
        case '^': return (values) => Math.pow(a(values), b(values))
      }
      break
    }
    case 'call': {
      const special = compileSpecial(node, vars)
      if (special) return special
      const { fn } = FUNCTIONS[node.name]
      if (!fn) throw new PlotError(`${node.name} is not supported here.`)
      const args = node.args.map((arg) => compileReal(arg, vars))
      if (args.length === 1) {
        const [a] = args
        return (values) => fn(a(values))
      }
      if (args.length === 2) {
        const [a, b] = args
        return (values) => fn(a(values), b(values))
      }
      return (values) => fn(...args.map((arg) => arg(values)))
    }
  }
  throw new PlotError('The equation is not valid math syntax.')
}

// ---------- sums, integrals, derivatives and forward differences ----------

/** The most terms one summation evaluates, so a graph can never lock the page. */
const MAX_SUM_TERMS = 20_000
/** Simpson's rule with 256 panels, enough for the curves a school graph shows. */
const INTEGRAL_STEPS = 256

function copyValues(values: ArrayLike<number>, into: number[]): number[] {
  for (let index = 0; index < into.length; index += 1) into[index] = values[index]
  return into
}

/**
 * Compiles the calls that evaluate another expression repeatedly. Each one
 * keeps its own scratch inputs, so three nested calls can share a compiled
 * equation without overwriting each other's x.
 */
function compileSpecial(node: Extract<MathNode, { t: 'call' }>, vars: readonly string[]): RealFn | null {
  switch (node.name) {
    case 'sum':
    case 'summation':
      return compileSum(node, vars)
    case 'integral':
    case 'integrate':
      return compileIntegral(node, vars)
    case 'derivative':
    case 'deriv':
      return compileDerivative(node, vars)
    case 'difference':
    case 'fdiff':
      return compileDifference(node, vars)
    default:
      return null
  }
}

/** sum(expr, from, to): expr is evaluated for every whole n from `from` to `to`. */
function compileSum(node: Extract<MathNode, { t: 'call' }>, vars: readonly string[]): RealFn {
  const existing = vars.indexOf('n')
  const innerVars = existing >= 0 ? vars : [...vars, 'n']
  const slot = existing >= 0 ? existing : innerVars.length - 1
  const term = compileReal(node.args[0], innerVars)
  const from = compileReal(node.args[1], vars)
  const to = compileReal(node.args[2], vars)
  const scratch = new Array<number>(innerVars.length).fill(0)
  return (values) => {
    const first = Math.ceil(from(values))
    const last = Math.floor(to(values))
    if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return 0
    // An unbounded sum is capped instead of stalling; a student never needs more.
    const end = Math.min(last, first + MAX_SUM_TERMS - 1)
    copyValues(values, scratch)
    let total = 0
    for (let n = first; n <= end; n += 1) {
      scratch[slot] = n
      total += term(scratch)
    }
    return total
  }
}

/** integral(expr, a, b): the area under expr, integrated over the first input. */
function compileIntegral(node: Extract<MathNode, { t: 'call' }>, vars: readonly string[]): RealFn {
  if (!vars.length) throw new PlotError('integral needs a variable, such as x.')
  const fn = compileReal(node.args[0], vars)
  const from = compileReal(node.args[1], vars)
  const to = compileReal(node.args[2], vars)
  const scratch = new Array<number>(vars.length).fill(0)
  return (values) => {
    const a = from(values)
    const b = to(values)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN
    const step = (b - a) / INTEGRAL_STEPS
    if (step === 0) return 0
    copyValues(values, scratch)
    const at = (x: number) => {
      scratch[0] = x
      return fn(scratch)
    }
    // Simpson's rule: 1, 4, 2, 4 ... 4, 1.
    let total = at(a) + at(b)
    for (let index = 1; index < INTEGRAL_STEPS; index += 1) {
      total += at(a + index * step) * (index % 2 ? 4 : 2)
    }
    return (total * step) / 3
  }
}

/** derivative(expr, at): the slope of expr at that point, by a central difference. */
function compileDerivative(node: Extract<MathNode, { t: 'call' }>, vars: readonly string[]): RealFn {
  if (!vars.length) throw new PlotError('derivative needs a variable, such as x.')
  const fn = compileReal(node.args[0], vars)
  const where = compileReal(node.args[1], vars)
  const scratch = new Array<number>(vars.length).fill(0)
  return (values) => {
    const x = where(values)
    if (!Number.isFinite(x)) return Number.NaN
    copyValues(values, scratch)
    // A step that shrinks with x keeps the difference accurate far from zero.
    const step = 1e-4 * Math.max(1, Math.abs(x))
    const slope = (h: number) => {
      scratch[0] = x + h
      const ahead = fn(scratch)
      scratch[0] = x - h
      const behind = fn(scratch)
      return (ahead - behind) / (2 * h)
    }
    // Richardson extrapolation removes the h² error term, so a cubic is exact.
    return (4 * slope(step / 2) - slope(step)) / 3
  }
}

/** difference(expr, at, h = 1): the forward difference f(x + h) - f(x). */
function compileDifference(node: Extract<MathNode, { t: 'call' }>, vars: readonly string[]): RealFn {
  if (!vars.length) throw new PlotError('difference needs a variable, such as x.')
  const fn = compileReal(node.args[0], vars)
  const where = compileReal(node.args[1], vars)
  const span = node.args[2] ? compileReal(node.args[2], vars) : null
  const scratch = new Array<number>(vars.length).fill(0)
  return (values) => {
    const x = where(values)
    const step = span ? span(values) : 1
    if (!Number.isFinite(x) || !Number.isFinite(step) || step === 0) return Number.NaN
    copyValues(values, scratch)
    scratch[0] = x
    const here = fn(scratch)
    scratch[0] = x + step
    const ahead = fn(scratch)
    return ahead - here
  }
}

// ---------- complex numbers ----------

export type Complex = { re: number; im: number }
/** Inputs are complex too; a real input has im = 0. */
export type ComplexFn = (values: readonly Complex[]) => Complex

const LN2 = Math.LN2

/**
 * Every node owns the one object it writes its answer into, and a parent reads
 * it straight away. Nothing is allocated while evaluating, which keeps pixel by
 * pixel colouring and fractal iteration fast. The result is only valid until
 * the next call.
 */
export function compileComplex(node: MathNode, vars: readonly string[]): ComplexFn {
  switch (node.t) {
    case 'num': {
      const out = { re: node.v, im: 0 }
      return () => out
    }
    case 'var': {
      if (node.name === 'i') {
        const out = { re: 0, im: 1 }
        return () => out
      }
      const index = vars.indexOf(node.name)
      if (index < 0) throw new PlotError(`Unknown name "${node.name}" in the equation.`)
      return (values) => values[index]
    }
    case 'neg': {
      const a = compileComplex(node.a, vars)
      const out = { re: 0, im: 0 }
      return (values) => {
        const x = a(values)
        out.re = -x.re
        out.im = -x.im
        return out
      }
    }
    case 'bin':
      return compileComplexBinary(node, vars)
    case 'call':
      return compileComplexCall(node, vars)
  }
}

function compileComplexBinary(node: Extract<MathNode, { t: 'bin' }>, vars: readonly string[]): ComplexFn {
  const a = compileComplex(node.a, vars)
  const b = compileComplex(node.b, vars)
  const out = { re: 0, im: 0 }
  switch (node.op) {
    case '+':
      return (values) => {
        const x = a(values)
        const y = b(values)
        out.re = x.re + y.re
        out.im = x.im + y.im
        return out
      }
    case '-':
      return (values) => {
        const x = a(values)
        const y = b(values)
        out.re = x.re - y.re
        out.im = x.im - y.im
        return out
      }
    case '*':
      return (values) => {
        const x = a(values)
        const y = b(values)
        const re = x.re * y.re - x.im * y.im
        out.im = x.re * y.im + x.im * y.re
        out.re = re
        return out
      }
    case '/':
      return (values) => {
        const x = a(values)
        const y = b(values)
        const d = y.re * y.re + y.im * y.im
        const re = (x.re * y.re + x.im * y.im) / d
        out.im = (x.im * y.re - x.re * y.im) / d
        out.re = re
        return out
      }
    case '^': {
      const exponent = constantValue(node.b)
      if (exponent !== null && Number.isInteger(exponent) && Math.abs(exponent) <= 64) {
        // A whole-number power is repeated multiplication: exact, and no branch cuts.
        const k = Math.abs(exponent)
        return (values) => {
          const x = a(values)
          let rr = 1
          let ri = 0
          let br = x.re
          let bi = x.im
          for (let bit = k; bit > 0; bit >>= 1) {
            if (bit & 1) {
              const t = rr * br - ri * bi
              ri = rr * bi + ri * br
              rr = t
            }
            const t = br * br - bi * bi
            bi = 2 * br * bi
            br = t
          }
          if (exponent < 0) {
            const d = rr * rr + ri * ri
            out.re = rr / d
            out.im = -ri / d
          } else {
            out.re = rr
            out.im = ri
          }
          return out
        }
      }
      return (values) => {
        const x = a(values)
        const y = b(values)
        if (x.re === 0 && x.im === 0) {
          out.re = y.re === 0 && y.im === 0 ? 1 : 0
          out.im = 0
          return out
        }
        // x^y = exp(y * log x)
        const lr = Math.log(Math.hypot(x.re, x.im))
        const li = Math.atan2(x.im, x.re)
        const er = y.re * lr - y.im * li
        const ei = y.re * li + y.im * lr
        const m = Math.exp(er)
        out.re = m * Math.cos(ei)
        out.im = m * Math.sin(ei)
        return out
      }
    }
  }
}

/** The value of a constant subtree such as 2 or -3, or null when it depends on an input. */
function constantValue(node: MathNode): number | null {
  if (node.t === 'num') return node.v
  if (node.t === 'neg') {
    const inner = constantValue(node.a)
    return inner === null ? null : -inner
  }
  return null
}

function compileComplexCall(node: Extract<MathNode, { t: 'call' }>, vars: readonly string[]): ComplexFn {
  if (!COMPLEX_FUNCTIONS.has(node.name)) {
    throw new PlotError(`${node.name} only works on real numbers, not in a complex graph.`)
  }
  const args = node.args.map((arg) => compileComplex(arg, vars))
  const out = { re: 0, im: 0 }
  const [a, b] = args

  const unary = (apply: (re: number, im: number, into: Complex) => void): ComplexFn => (values) => {
    const x = a(values)
    apply(x.re, x.im, out)
    return out
  }

  switch (node.name) {
    case 'abs':
      return unary((re, im, into) => { into.re = Math.hypot(re, im); into.im = 0 })
    case 're':
      return unary((re, _im, into) => { into.re = re; into.im = 0 })
    case 'im':
      return unary((_re, im, into) => { into.re = im; into.im = 0 })
    case 'conj':
      return unary((re, im, into) => { into.re = re; into.im = -im })
    case 'arg':
      return unary((re, im, into) => { into.re = Math.atan2(im, re); into.im = 0 })
    case 'exp':
      return unary((re, im, into) => {
        const m = Math.exp(re)
        into.re = m * Math.cos(im)
        into.im = m * Math.sin(im)
      })
    case 'log':
    case 'ln':
      return unary((re, im, into) => { into.re = Math.log(Math.hypot(re, im)); into.im = Math.atan2(im, re) })
    case 'log2':
      return unary((re, im, into) => { into.re = Math.log(Math.hypot(re, im)) / LN2; into.im = Math.atan2(im, re) / LN2 })
    case 'log10':
      return unary((re, im, into) => {
        into.re = Math.log(Math.hypot(re, im)) / Math.LN10
        into.im = Math.atan2(im, re) / Math.LN10
      })
    case 'sqrt':
      return unary((re, im, into) => {
        const r = Math.hypot(re, im)
        const sr = Math.sqrt((r + re) / 2)
        const si = Math.sqrt((r - re) / 2)
        into.re = sr
        into.im = im < 0 ? -si : si
      })
    case 'sin':
      return unary((re, im, into) => { into.re = Math.sin(re) * Math.cosh(im); into.im = Math.cos(re) * Math.sinh(im) })
    case 'cos':
      return unary((re, im, into) => { into.re = Math.cos(re) * Math.cosh(im); into.im = -Math.sin(re) * Math.sinh(im) })
    case 'sinh':
      return unary((re, im, into) => { into.re = Math.sinh(re) * Math.cos(im); into.im = Math.cosh(re) * Math.sin(im) })
    case 'cosh':
      return unary((re, im, into) => { into.re = Math.cosh(re) * Math.cos(im); into.im = Math.sinh(re) * Math.sin(im) })
    case 'tan':
      return unary((re, im, into) => {
        // tan z = sin z / cos z
        const sr = Math.sin(re) * Math.cosh(im)
        const si = Math.cos(re) * Math.sinh(im)
        const cr = Math.cos(re) * Math.cosh(im)
        const ci = -Math.sin(re) * Math.sinh(im)
        const d = cr * cr + ci * ci
        into.re = (sr * cr + si * ci) / d
        into.im = (si * cr - sr * ci) / d
      })
    case 'tanh':
      return unary((re, im, into) => {
        const sr = Math.sinh(re) * Math.cos(im)
        const si = Math.cosh(re) * Math.sin(im)
        const cr = Math.cosh(re) * Math.cos(im)
        const ci = Math.sinh(re) * Math.sin(im)
        const d = cr * cr + ci * ci
        into.re = (sr * cr + si * ci) / d
        into.im = (si * cr - sr * ci) / d
      })
    case 'asin':
      return unary((re, im, into) => {
        // asin z = -i ln(iz + sqrt(1 - z^2))
        const wr = 1 - (re * re - im * im)
        const wi = -2 * re * im
        const r = Math.hypot(wr, wi)
        const sr = Math.sqrt((r + wr) / 2)
        const si = wi < 0 ? -Math.sqrt((r - wr) / 2) : Math.sqrt((r - wr) / 2)
        const ur = -im + sr
        const ui = re + si
        into.re = Math.atan2(ui, ur)
        into.im = -Math.log(Math.hypot(ur, ui))
      })
    case 'acos':
      return unary((re, im, into) => {
        const wr = 1 - (re * re - im * im)
        const wi = -2 * re * im
        const r = Math.hypot(wr, wi)
        const sr = Math.sqrt((r + wr) / 2)
        const si = wi < 0 ? -Math.sqrt((r - wr) / 2) : Math.sqrt((r - wr) / 2)
        const ur = -im + sr
        const ui = re + si
        into.re = Math.PI / 2 - Math.atan2(ui, ur)
        into.im = Math.log(Math.hypot(ur, ui))
      })
    case 'atan':
      return unary((re, im, into) => {
        // atan z = (i/2) (ln(1 - iz) - ln(1 + iz))
        const ar = 1 + im
        const ai = -re
        const br = 1 - im
        const bi = re
        const lr = Math.log(Math.hypot(ar, ai)) - Math.log(Math.hypot(br, bi))
        const li = Math.atan2(ai, ar) - Math.atan2(bi, br)
        into.re = -li / 2
        into.im = lr / 2
      })
    case 'pow':
      return (values) => {
        const x = a(values)
        const y = b(values)
        if (x.re === 0 && x.im === 0) {
          out.re = y.re === 0 && y.im === 0 ? 1 : 0
          out.im = 0
          return out
        }
        const lr = Math.log(Math.hypot(x.re, x.im))
        const li = Math.atan2(x.im, x.re)
        const er = y.re * lr - y.im * li
        const ei = y.re * li + y.im * lr
        const m = Math.exp(er)
        out.re = m * Math.cos(ei)
        out.im = m * Math.sin(ei)
        return out
      }
  }
  throw new PlotError(`${node.name} only works on real numbers, not in a complex graph.`)
}

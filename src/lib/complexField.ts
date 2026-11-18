/**
 * Colours the complex plane. A "domain colouring" of f(z) shows the angle of
 * f(z) as a hue and its size as brightness, so zeros are black and poles are
 * white. Mandelbrot, Julia and Newton pictures colour each point by how an
 * iteration from it behaves. Everything here is pure maths on pixels, so it
 * runs in a test as well as in the page.
 */

import { compileComplex, parseMath, type Complex } from './mathExpr'
import type { View } from './plotGeometry'

export type FieldSpec =
  | { kind: 'domain'; expr: string }
  | { kind: 'mandelbrot' | 'julia' | 'newton'; expr: string; c: [number, number]; maxIter: number }

export const FIELD_KINDS = ['domain', 'mandelbrot', 'julia', 'newton'] as const
export const MIN_ITERATIONS = 8
export const MAX_ITERATIONS = 500
export const DEFAULT_ITERATIONS = 80

/** Points whose square length passes this have escaped. 256 (radius 16) keeps smooth colouring accurate. */
const ESCAPE = 256
const POLE: [number, number, number] = [240, 240, 240]
const INSIDE: [number, number, number] = [11, 11, 12]

function hslToRgb(h: number, s: number, l: number, out: [number, number, number]) {
  const hue = ((h % 1) + 1) % 1
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + hue * 12) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  out[0] = Math.round(channel(0) * 255)
  out[1] = Math.round(channel(8) * 255)
  out[2] = Math.round(channel(4) * 255)
}

const tidy = (value: number) => String(Number(value.toPrecision(4)))

function complexText(re: number, im: number): string {
  if (!Number.isFinite(re) || !Number.isFinite(im)) return 'undefined'
  const sign = im < 0 || Object.is(im, -0) ? '-' : '+'
  return `${tidy(re)} ${sign} ${tidy(Math.abs(im))}i`
}

export type FieldPainter = {
  /** Paints rows [from, to) of a w x h image of `view` into `rgba`. */
  paint(view: View, w: number, h: number, from: number, to: number, rgba: Uint8ClampedArray): void
  /** Paints one pixel rectangle, so a pan can fill only the newly exposed strip. */
  paintRect(
    view: View,
    w: number,
    h: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
    rgba: Uint8ClampedArray,
  ): void
  /** Plain-text facts about one point, for the click readout. */
  at(re: number, im: number): string[]
}

/** Compiles the spec once. Throws PlotError for an equation that cannot be drawn. */
export function createFieldPainter(spec: FieldSpec, params: Record<string, number> = {}): FieldPainter {
  const z: Complex = { re: 0, im: 0 }
  const c: Complex = { re: 0, im: 0 }
  const xs: Complex = { re: 0, im: 0 }
  const ys: Complex = { re: 0, im: 0 }
  const rgb: [number, number, number] = [0, 0, 0]

  const vars = spec.kind === 'domain' ? ['z', 'x', 'y'] : spec.kind === 'newton' ? ['z'] : ['z', 'c']
  const fn = compileComplex(parseMath(spec.expr, vars, params), vars)
  const env: Complex[] = spec.kind === 'domain' ? [z, xs, ys] : spec.kind === 'newton' ? [z] : [z, c]
  const maxIter =
    spec.kind === 'domain' ? 0 : Math.round(Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, spec.maxIter)))
  const fixedC = spec.kind === 'julia' ? spec.c : [0, 0]

  /** Iterates from a point. Returns the step count at which it escaped or converged, or -1; `result` holds the final value. */
  const result = { n: -1, nu: 0, re: 0, im: 0 }
  const iterate = (re: number, im: number) => {
    result.n = -1
    if (spec.kind === 'mandelbrot') {
      c.re = re
      c.im = im
      z.re = 0
      z.im = 0
    } else if (spec.kind === 'julia') {
      c.re = fixedC[0]
      c.im = fixedC[1]
      z.re = re
      z.im = im
    } else {
      z.re = re
      z.im = im
    }

    if (spec.kind === 'newton') {
      const h = 1e-6
      for (let n = 0; n < maxIter; n += 1) {
        const f = fn(env)
        const fr = f.re
        const fi = f.im
        z.re += h
        const g = fn(env)
        z.re -= h
        const dr = (g.re - fr) / h
        const di = (g.im - fi) / h
        const d = dr * dr + di * di
        if (!(d > 0) || !Number.isFinite(d)) return
        const stepRe = (fr * dr + fi * di) / d
        const stepIm = (fi * dr - fr * di) / d
        z.re -= stepRe
        z.im -= stepIm
        if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) return
        if (stepRe * stepRe + stepIm * stepIm < 1e-18) {
          result.n = n
          result.re = z.re
          result.im = z.im
          return
        }
      }
      return
    }

    for (let n = 0; n < maxIter; n += 1) {
      const w = fn(env)
      z.re = w.re
      z.im = w.im
      const size = z.re * z.re + z.im * z.im
      if (size > ESCAPE || !(size === size)) {
        result.n = n
        // Smooth colouring: a fractional step count, so bands blend instead of stepping.
        result.nu = size > ESCAPE ? n + 1 - Math.log2(0.5 * Math.log(size)) : n
        result.re = z.re
        result.im = z.im
        return
      }
    }
  }

  const colourDomain = (re: number, im: number) => {
    z.re = re
    z.im = im
    xs.re = re
    ys.re = im
    const w = fn(env)
    if (!Number.isFinite(w.re) || !Number.isFinite(w.im)) {
      rgb[0] = POLE[0]; rgb[1] = POLE[1]; rgb[2] = POLE[2]
      return
    }
    const size = Math.hypot(w.re, w.im)
    // Zeros are black and poles white; faint rings mark each doubling of |f|.
    const level = 1 - 1 / (1 + Math.pow(size, 0.4))
    const ring = size > 0 ? 0.88 + 0.12 * (Math.log2(size) - Math.floor(Math.log2(size))) : 1
    hslToRgb(Math.atan2(w.im, w.re) / (2 * Math.PI), 0.85, Math.min(0.97, level * ring), rgb)
  }

  const colourIteration = (re: number, im: number) => {
    iterate(re, im)
    if (result.n < 0) {
      rgb[0] = INSIDE[0]; rgb[1] = INSIDE[1]; rgb[2] = INSIDE[2]
      return
    }
    if (spec.kind === 'newton') {
      // Each root gets its own hue; slower convergence is darker.
      const dim = Math.max(0.18, 0.62 - result.n * 0.035)
      hslToRgb(Math.atan2(result.im, result.re) / (2 * Math.PI), 0.7, dim, rgb)
      return
    }
    const wave = result.nu * 0.18
    hslToRgb(0.32 + 0.3 * (0.5 + 0.5 * Math.sin(wave)), 0.65, 0.2 + 0.42 * (0.5 + 0.5 * Math.sin(wave + 1.2)), rgb)
  }

  const colourAt = spec.kind === 'domain' ? colourDomain : colourIteration

  /** Paints pixels [left, right) x [top, bottom) of the frame into a full-size buffer. */
  const paintPixels = (
    view: View,
    w: number,
    h: number,
    left: number,
    right: number,
    top: number,
    bottom: number,
    rgba: Uint8ClampedArray,
  ) => {
    const stepX = (view.x1 - view.x0) / w
    const stepY = (view.y1 - view.y0) / h
    for (let row = top; row < bottom; row += 1) {
      const im = view.y1 - (row + 0.5) * stepY
      let offset = (row * w + left) * 4
      for (let col = left; col < right; col += 1) {
        colourAt(view.x0 + (col + 0.5) * stepX, im)
        rgba[offset] = rgb[0]
        rgba[offset + 1] = rgb[1]
        rgba[offset + 2] = rgb[2]
        rgba[offset + 3] = 255
        offset += 4
      }
    }
  }

  return {
    paint(view, w, h, from, to, rgba) {
      paintPixels(view, w, h, 0, w, from, to, rgba)
    },

    paintRect(view, w, h, left, top, right, bottom, rgba) {
      const l = Math.max(0, Math.floor(left))
      const r = Math.min(w, Math.ceil(right))
      const t = Math.max(0, Math.floor(top))
      const b = Math.min(h, Math.ceil(bottom))
      if (r <= l || b <= t) return
      paintPixels(view, w, h, l, r, t, b, rgba)
    },

    at(re, im) {
      if (spec.kind === 'domain') {
        z.re = re
        z.im = im
        xs.re = re
        ys.re = im
        const w = fn(env)
        const out = [`z = ${complexText(re, im)}`, `f(z) = ${complexText(w.re, w.im)}`]
        if (Number.isFinite(w.re) && Number.isFinite(w.im)) {
          out.push(`|f| = ${tidy(Math.hypot(w.re, w.im))}`, `arg f = ${tidy(Math.atan2(w.im, w.re))} rad`)
        }
        return out
      }
      iterate(re, im)
      // Copy the result before anything else can iterate with the same object.
      const found = { n: result.n, re: result.re, im: result.im }
      const label = spec.kind === 'mandelbrot' ? `c = ${complexText(re, im)}` : spec.kind === 'julia' ? `z0 = ${complexText(re, im)}` : `start = ${complexText(re, im)}`
      if (spec.kind === 'newton') {
        return [label, found.n < 0 ? 'no root reached' : `root ${complexText(found.re, found.im)} after ${found.n + 1} steps`]
      }
      return [label, found.n < 0 ? `stays bounded (${maxIter} steps)` : `escapes after ${found.n + 1} steps`]
    },
  }
}

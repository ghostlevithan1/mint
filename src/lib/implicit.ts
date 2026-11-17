/**
 * Draws equations in x and y such as x^2 + y^2 = 1 (and inequalities such as
 * y > x^2) by sampling f(x, y) on a grid over the visible window and finding
 * where it changes sign, the "marching squares" method. The grid is redrawn
 * for the window on screen, so zooming in keeps a curve sharp.
 */

import type { View } from './plotGeometry'

export type Relation = '=' | '<' | '<=' | '>' | '>='

export type Traced = {
  /** Curve pieces as x1, y1, x2, y2 in data units. */
  segments: number[]
  /** Shaded cells, as runs: row, first column, last column, repeated. Rows count up from y0. */
  runs: number[]
  nx: number
  ny: number
}

/** Cells across the window. About 3 pixels each at the plot's usual size. */
export const IMPLICIT_CELLS_X = 200
export const IMPLICIT_CELLS_Y = 112

/** A crossing whose ends are this many times larger than the typical value is a pole, not a root. */
const POLE_FACTOR = 200

function median(values: Float64Array): number {
  const sample: number[] = []
  const step = Math.max(1, Math.floor(values.length / 400))
  for (let index = 0; index < values.length; index += step) {
    const value = Math.abs(values[index])
    if (Number.isFinite(value)) sample.push(value)
  }
  if (!sample.length) return 0
  sample.sort((a, b) => a - b)
  return sample[Math.floor(sample.length / 2)]
}

/**
 * Samples f over `view` and returns the curve f = 0 and, for an inequality,
 * the cells where it holds. Cells where f is not a number are skipped, and
 * sign changes across a pole (tan, 1/x) are not joined into a false line.
 */
export function traceImplicit(
  f: (x: number, y: number) => number,
  view: View,
  relation: Relation = '=',
  nx = IMPLICIT_CELLS_X,
  ny = IMPLICIT_CELLS_Y,
): Traced {
  const dx = (view.x1 - view.x0) / nx
  const dy = (view.y1 - view.y0) / ny
  const stride = nx + 1
  const values = new Float64Array(stride * (ny + 1))
  for (let j = 0; j <= ny; j += 1) {
    const y = view.y0 + j * dy
    for (let i = 0; i <= nx; i += 1) values[j * stride + i] = f(view.x0 + i * dx, y)
  }
  const limit = Math.max(median(values), 1e-12) * POLE_FACTOR

  const segments: number[] = []
  const runs: number[] = []
  const wantNegative = relation === '<' || relation === '<='
  const shade = relation !== '='

  const cross = (va: number, vb: number) => va / (va - vb)
  const ok = (va: number, vb: number) => Math.abs(va) <= limit && Math.abs(vb) <= limit

  for (let j = 0; j < ny; j += 1) {
    const y = view.y0 + j * dy
    let runStart = -1
    for (let i = 0; i < nx; i += 1) {
      const bl = values[j * stride + i]
      const br = values[j * stride + i + 1]
      const tl = values[(j + 1) * stride + i]
      const tr = values[(j + 1) * stride + i + 1]
      const finite = Number.isFinite(bl) && Number.isFinite(br) && Number.isFinite(tl) && Number.isFinite(tr)

      if (shade) {
        const centre = (bl + br + tl + tr) / 4
        const holds = finite && (wantNegative ? centre < 0 : centre > 0)
        if (holds && runStart < 0) runStart = i
        if (!holds && runStart >= 0) {
          runs.push(j, runStart, i - 1)
          runStart = -1
        }
      }
      if (!finite) continue

      const index =
        (bl < 0 ? 1 : 0) + (br < 0 ? 2 : 0) + (tr < 0 ? 4 : 0) + (tl < 0 ? 8 : 0)
      if (index === 0 || index === 15) continue
      const x = view.x0 + i * dx

      // The four edges of the cell; each gives the point where f crosses zero.
      const bottom = () => (ok(bl, br) ? [x + cross(bl, br) * dx, y] : null)
      const right = () => (ok(br, tr) ? [x + dx, y + cross(br, tr) * dy] : null)
      const top = () => (ok(tl, tr) ? [x + cross(tl, tr) * dx, y + dy] : null)
      const left = () => (ok(bl, tl) ? [x, y + cross(bl, tl) * dy] : null)
      const join = (a: number[] | null, b: number[] | null) => {
        if (a && b) segments.push(a[0], a[1], b[0], b[1])
      }

      switch (index) {
        case 1: case 14: join(left(), bottom()); break
        case 2: case 13: join(bottom(), right()); break
        case 3: case 12: join(left(), right()); break
        case 4: case 11: join(right(), top()); break
        case 6: case 9: join(bottom(), top()); break
        case 7: case 8: join(left(), top()); break
        case 5: {
          // Opposite corners inside: the centre decides which way the pieces join.
          const centre = (bl + br + tl + tr) / 4
          if (centre < 0) { join(left(), top()); join(bottom(), right()) }
          else { join(left(), bottom()); join(right(), top()) }
          break
        }
        case 10: {
          const centre = (bl + br + tl + tr) / 4
          if (centre < 0) { join(left(), bottom()); join(right(), top()) }
          else { join(left(), top()); join(bottom(), right()) }
          break
        }
      }
    }
    if (runStart >= 0) runs.push(j, runStart, nx - 1)
  }
  return { segments, runs, nx, ny }
}

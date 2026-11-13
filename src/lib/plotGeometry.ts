/**
 * View math and hit testing for the plot renderer. Kept apart from the React
 * component so the interaction can be tested without a DOM.
 */

export type View = { x0: number; x1: number; y0: number; y1: number }
export type Point = { x: number; y: number }

/** Zooming in stops at 64x; zooming out stops at the original frame. */
export const MAX_ZOOM = 64

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/** Zooms one axis around a focus point, keeping the frame inside its bounds. */
function zoomAxis(
  lo: number,
  hi: number,
  focus: number,
  factor: number,
  boundLo: number,
  boundHi: number,
): [number, number] {
  const boundSpan = Math.max(boundHi - boundLo, Number.EPSILON)
  const span = clamp((hi - lo) * factor, boundSpan / MAX_ZOOM, boundSpan)
  const fraction = clamp((focus - lo) / (hi - lo), 0, 1)
  let start = focus - fraction * span
  if (start < boundLo) start = boundLo
  if (start + span > boundHi) start = boundHi - span
  return [start, start + span]
}

/**
 * Zooms around a data-space focus, as when the wheel is used. The point under
 * the cursor stays under the cursor, and the view never leaves `bounds`.
 */
export function zoomView(view: View, focus: Point, factor: number, bounds: View): View {
  const [x0, x1] = zoomAxis(view.x0, view.x1, focus.x, factor, bounds.x0, bounds.x1)
  const [y0, y1] = zoomAxis(view.y0, view.y1, focus.y, factor, bounds.y0, bounds.y1)
  return { x0, x1, y0, y1 }
}

/**
 * Expands one axis so a single data unit takes the same pixel length on both
 * axes, the way a Desmos window is made of squares. `aspect` is the plot
 * area's width divided by its height. The smaller axis grows around the
 * existing midpoint and the requested content is never shrunk or clipped.
 */
export function squareView(view: View, aspect: number): View {
  const spanX = view.x1 - view.x0
  const spanY = view.y1 - view.y0
  if (!(spanX > 0) || !(spanY > 0) || !(aspect > 0)) return view
  if (!Number.isFinite(spanX) || !Number.isFinite(spanY) || !Number.isFinite(aspect)) return view

  if (spanX < spanY * aspect) {
    const center = (view.x0 + view.x1) / 2
    const half = (spanY * aspect) / 2
    return { x0: center - half, x1: center + half, y0: view.y0, y1: view.y1 }
  }
  if (spanX > spanY * aspect) {
    const center = (view.y0 + view.y1) / 2
    const half = spanX / aspect / 2
    return { x0: view.x0, x1: view.x1, y0: center - half, y1: center + half }
  }
  return view
}

/** Pans by a data-space delta, stopping at the edges of `bounds`. */
export function panView(view: View, dx: number, dy: number, bounds: View): View {
  const spanX = view.x1 - view.x0
  const spanY = view.y1 - view.y0
  const x0 = clamp(view.x0 + dx, bounds.x0, bounds.x1 - spanX)
  const y0 = clamp(view.y0 + dy, bounds.y0, bounds.y1 - spanY)
  return { x0, x1: x0 + spanX, y0, y1: y0 + spanY }
}

export type PointHit = Point & { distance: number; t: number }

/** Closest point on segment AB to `target`, in whatever space the inputs use. */
export function nearestOnSegment(target: Point, a: Point, b: Point): PointHit {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t =
    lengthSq === 0
      ? 0
      : clamp(((target.x - a.x) * dx + (target.y - a.y) * dy) / lengthSq, 0, 1)
  const x = a.x + dx * t
  const y = a.y + dy * t
  return { x, y, distance: Math.hypot(target.x - x, target.y - y), t }
}

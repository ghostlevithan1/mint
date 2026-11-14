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

export type ReadoutPlacement = { x: number; y: number; anchor: 'start' | 'end' }

/** True when a point sits inside `area`, optionally with `inset` clearance. */
export function insideArea(
  point: Point,
  area: { left: number; right: number; top: number; bottom: number },
  inset = 0,
): boolean {
  return (
    point.x >= area.left + inset &&
    point.x <= area.right - inset &&
    point.y >= area.top + inset &&
    point.y <= area.bottom - inset
  )
}

/** Keeps a centered label inside [left, right] while its tick stays put. */
export function clampLabel(x: number, width: number, left: number, right: number): number {
  const half = Math.max(0, width) / 2
  if (right - left <= half * 2) return (left + right) / 2
  return clamp(x, left + half, right - half)
}

/**
 * Estimated width of a 12px monospace string, in viewBox units. Wide CJK and
 * emoji glyphs count double. Estimates, not measures, so layout code can use
 * them without touching the DOM.
 */
export function estimateTextWidth(text: string): number {
  let width = 0
  for (const char of text) width += (char.codePointAt(0) ?? 0) > 0x2e80 ? 12 : 7.4
  return width
}

/**
 * Places a multi-line readout beside a selected point. It prefers the space
 * above and to the right of the point, flips when that would leave `area`, and
 * clamps as a last resort so the whole block stays inside the plot.
 */
export function placeReadout(
  point: Point,
  lineCount: number,
  textWidth: number,
  area: { left: number; right: number; top: number; bottom: number },
  gap = 12,
  lineHeight = 15,
  ascent = 13,
  descent = 5,
  inset = 4,
): ReadoutPlacement {
  const count = Math.max(1, lineCount)
  const width = Math.max(0, textWidth)
  const left = area.left + inset
  const right = area.right - inset
  const top = area.top + inset
  const bottom = area.bottom - inset

  let anchor: 'start' | 'end'
  let x: number
  if (point.x + gap + width <= right) {
    anchor = 'start'
    x = point.x + gap
  } else if (point.x - gap - width >= left) {
    anchor = 'end'
    x = point.x - gap
  } else if (right - point.x >= point.x - left) {
    // Neither side fits a wide block, so sit as close to the point as it allows.
    anchor = 'start'
    x = clamp(point.x + gap, left, Math.max(left, right - width))
  } else {
    anchor = 'end'
    x = clamp(point.x - gap, Math.min(right, left + width), right)
  }

  const blockBottom = (count - 1) * lineHeight + descent
  const above = point.y - gap - (count - 1) * lineHeight
  const below = point.y + gap + ascent
  let y = above - ascent < top ? below : above
  if (y + blockBottom > bottom) y = bottom - blockBottom
  y = clamp(y, top + ascent, bottom - blockBottom)
  return { x, y, anchor }
}

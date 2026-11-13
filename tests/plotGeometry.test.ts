import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_ZOOM,
  nearestOnSegment,
  panView,
  squareView,
  zoomView,
  type View,
} from '../src/lib/plotGeometry'

const bounds: View = { x0: -10, x1: 10, y0: -5, y1: 5 }

const close = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  )

test('zooming keeps the point under the cursor fixed', () => {
  const view = zoomView(bounds, { x: 4, y: 0 }, 0.5, bounds)
  close(view.x1 - view.x0, 10)
  close(view.y1 - view.y0, 5)
  close((4 - view.x0) / (view.x1 - view.x0), 0.7)
})

test('zooming in stops at 64x and never leaves the frame', () => {
  let view = bounds
  for (let i = 0; i < 20; i += 1) view = zoomView(view, { x: 0, y: 0 }, 0.5, bounds)
  close(view.x1 - view.x0, 20 / MAX_ZOOM)
  close(view.y1 - view.y0, 10 / MAX_ZOOM)
  close((view.x0 + view.x1) / 2, 0)
  close((view.y0 + view.y1) / 2, 0)

  const wide = zoomView(bounds, { x: 3, y: 1 }, 4, bounds)
  close(wide.x0, bounds.x0)
  close(wide.x1, bounds.x1)
  close(wide.y0, bounds.y0)
  close(wide.y1, bounds.y1)
})

test('zooming at an edge keeps the window inside its bounds', () => {
  const view = zoomView(bounds, { x: bounds.x1, y: bounds.y1 }, 0.5, bounds)
  close(view.x1, bounds.x1)
  close(view.y1, bounds.y1)
  assert.ok(view.x0 >= bounds.x0)
  assert.ok(view.y0 >= bounds.y0)
})

test('panning stops at the edges of the frame', () => {
  const view = zoomView(bounds, { x: 0, y: 0 }, 0.5, bounds)
  const right = panView(view, 1000, 1000, bounds)
  close(right.x1, bounds.x1)
  close(right.y1, bounds.y1)
  close(right.x1 - right.x0, view.x1 - view.x0)

  const left = panView(view, -1000, -1000, bounds)
  close(left.x0, bounds.x0)
  close(left.y0, bounds.y0)
})

test('panning at full zoom cannot move the frame', () => {
  const view = panView(bounds, 25, -25, bounds)
  close(view.x0, bounds.x0)
  close(view.x1, bounds.x1)
  close(view.y0, bounds.y0)
  close(view.y1, bounds.y1)
})

test('segment hit testing projects onto the nearest point', () => {
  const hit = nearestOnSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })
  assert.equal(hit.x, 3)
  assert.equal(hit.y, 0)
  assert.equal(hit.distance, 4)
  close(hit.t, 0.3)

  const end = nearestOnSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })
  assert.equal(end.x, 0)
  assert.equal(end.t, 0)

  const point = nearestOnSegment({ x: 2, y: 2 }, { x: 1, y: 1 }, { x: 1, y: 1 })
  assert.deepEqual(point, { x: 1, y: 1, distance: Math.SQRT2, t: 0 })
})

const closeRatio = (view: View, aspect: number) =>
  close((view.x1 - view.x0) / (view.y1 - view.y0), aspect, 1e-9)

test('square units widen a tall view without shrinking it', () => {
  const view = { x0: -3, x1: 5, y0: -6, y1: 12 }
  const square = squareView(view, 1.868)
  closeRatio(square, 1.868)
  close((square.x0 + square.x1) / 2, 1)
  close(square.y0, -6)
  close(square.y1, 12)
  assert.ok(square.x0 < view.x0 && square.x1 > view.x1)
})

test('square units grow a wide view vertically around its midpoint', () => {
  const view = { x0: -10, x1: 10, y0: -1, y1: 1 }
  const square = squareView(view, 2)
  closeRatio(square, 2)
  close((square.y0 + square.y1) / 2, 0)
  close(square.x0, -10)
  close(square.x1, 10)
  assert.ok(square.y0 < view.y0 && square.y1 > view.y1)
})

test('a view that is already square is left alone', () => {
  const view = { x0: -4, x1: 4, y0: -2, y1: 2 }
  assert.deepEqual(squareView(view, 2), view)
})

test('square units do not touch a degenerate view', () => {
  const flat = { x0: 1, x1: 1, y0: -1, y1: 1 }
  assert.deepEqual(squareView(flat, 2), flat)
  assert.deepEqual(squareView(bounds, 0), bounds)
})

test('zooming and panning keep the units square', () => {
  const square = squareView({ x0: -3, x1: 5, y0: -6, y1: 12 }, 1.868)
  const zoomed = zoomView(square, { x: 1, y: 1 }, 0.6, square)
  closeRatio(zoomed, 1.868)
  const panned = panView(zoomed, 3, -4, square)
  closeRatio(panned, 1.868)
})

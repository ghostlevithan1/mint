import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampLabel,
  estimateTextWidth,
  insideArea,
  MAX_ZOOM,
  nearestOnSegment,
  panView,
  placeMarkerLabels,
  placeReadout,
  projectViewRect,
  sameSpan,
  squareView,
  uncoveredRegions,
  viewTransform,
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

test('a panned cached frame projects into place and leaves only strips to paint', () => {
  const cached: View = { x0: 0, x1: 10, y0: 0, y1: 10 }
  // Panned 5 units right: the old picture starts half a frame to the left.
  const shifted = projectViewRect(cached, { x0: 5, x1: 15, y0: 0, y1: 10 }, 100, 100)
  close(shifted.left, -50)
  close(shifted.right, 50)
  close(shifted.top, 0)
  close(shifted.bottom, 100)
  assert.deepEqual(uncoveredRegions(shifted, 100, 100), [{ left: 50, top: 0, right: 100, bottom: 100 }])

  // Panned 2 units down: the old picture sits lower, exposing a top strip.
  const down = projectViewRect(cached, { x0: 0, x1: 10, y0: 2, y1: 12 }, 100, 100)
  close(down.top, 20)
  close(down.bottom, 120)
  assert.deepEqual(uncoveredRegions(down, 100, 100), [{ left: 0, top: 0, right: 100, bottom: 20 }])

  // A frame that is entirely new exposes the whole canvas.
  assert.deepEqual(uncoveredRegions({ left: 200, top: 200, right: 300, bottom: 300 }, 100, 100), [
    { left: 0, top: 0, right: 100, bottom: 100 },
  ])
})

test('equal spans are reused; a zoom is a new picture', () => {
  const a: View = { x0: 0, x1: 10, y0: 0, y1: 10 }
  assert.equal(sameSpan(a, { x0: 3, x1: 13, y0: -2, y1: 8 }), true)
  assert.equal(sameSpan(a, { x0: 0, x1: 5, y0: 0, y1: 10 }), false)
})

test('a settled frame moves as a sprite during a pan and a zoom', () => {
  const drawn: View = { x0: 0, x1: 10, y0: 0, y1: 10 }
  const identity = viewTransform(drawn, drawn, 50, 20, 200, 100)
  assert.deepEqual(identity, { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 })

  // Panned 2 units right: everything shifts left by a fifth of the width.
  const pan = viewTransform(drawn, { x0: 2, x1: 12, y0: 0, y1: 10 }, 50, 20, 200, 100)
  close(pan.scaleX, 1)
  close(pan.translateX, -40)
  close(pan.translateY, 0)

  // Zoomed 2x around the centre: the picture doubles about the plot's centre.
  const zoom = viewTransform(drawn, { x0: 2.5, x1: 7.5, y0: 2.5, y1: 7.5 }, 50, 20, 200, 100)
  close(zoom.scaleX, 2)
  close(zoom.scaleY, 2)
  close(zoom.translateX, 50 * (1 - 2) + ((-2.5) / 5) * 200)
  // The drawn pixels for the new window's edges land on the plot's edges.
  close(zoom.translateX + zoom.scaleX * 100, 50)
  close(zoom.translateY + zoom.scaleY * 45, 20)

  // Every data point lands on the pixel the current window gives it.
  const point = { x: 3, y: 7 }
  const drawnX = 50 + ((point.x - drawn.x0) / 10) * 200
  const drawnY = 20 + (1 - (point.y - drawn.y0) / 10) * 100
  const liveX = 50 + ((point.x - 2) / 10) * 200
  close(pan.translateX + pan.scaleX * drawnX, liveX)
  close(pan.translateY + pan.scaleY * drawnY, drawnY)
})

test('a degenerate sprite transform changes nothing', () => {
  const view: View = { x0: 0, x1: 10, y0: 0, y1: 10 }
  assert.deepEqual(viewTransform(view, { x0: 1, x1: 1, y0: 0, y1: 10 }, 0, 0, 100, 100), {
    scaleX: 1,
    scaleY: 1,
    translateX: 0,
    translateY: 0,
  })
})

const area = { left: 52, right: 620, top: 16, bottom: 320 }

test('the readout sits above and right of the point when there is room', () => {
  const place = placeReadout({ x: 100, y: 150 }, 2, 120, area)
  assert.equal(place.anchor, 'start')
  close(place.x, 112)
  close(place.y, 123)
})

test('the readout flips to the left near the right edge', () => {
  const place = placeReadout({ x: 580, y: 150 }, 2, 120, area)
  assert.equal(place.anchor, 'end')
  close(place.x, 568)
  assert.ok(place.x - 120 >= area.left)
})

test('a wide readout is pushed inside the plot frame', () => {
  const place = placeReadout({ x: 300, y: 150 }, 3, 500, area)
  assert.equal(place.anchor, 'start')
  assert.ok(place.x >= area.left)
  assert.ok(place.x + 500 <= area.right)
})

test('the readout drops below a point near the top and stays inside the bottom', () => {
  const nearTop = placeReadout({ x: 300, y: 20 }, 3, 80, area)
  assert.ok(nearTop.y - 13 >= area.top)
  assert.ok(nearTop.y + 30 + 5 <= area.bottom)

  const nearBottom = placeReadout({ x: 300, y: 318 }, 3, 80, area)
  assert.ok(nearBottom.y - 13 >= area.top)
  assert.ok(nearBottom.y + 30 + 5 <= area.bottom)
})

test('a point outside the plot area is hidden, with clearance for its dot', () => {
  assert.equal(insideArea({ x: 300, y: 150 }, area), true)
  assert.equal(insideArea({ x: 40, y: 150 }, area), false)
  assert.equal(insideArea({ x: 300, y: 330 }, area), false)
  assert.equal(insideArea({ x: 52, y: 150 }, area), true)
  assert.equal(insideArea({ x: 52, y: 150 }, area, 5), false)
  assert.equal(insideArea({ x: 620, y: 320 }, area, 5), false)
})

test('tick labels stay inside the plot frame', () => {
  close(clampLabel(300, 20, area.left, area.right), 300)
  close(clampLabel(area.left, 20, area.left, area.right), area.left + 10)
  close(clampLabel(area.right, 20, area.left, area.right), area.right - 10)
  close(clampLabel(area.left - 50, 20, area.left, area.right), area.left + 10)
})

test('text width matches the 12px monospace font, with wide glyphs doubled', () => {
  close(estimateTextWidth('-100'), 4 * 7.4)
  close(estimateTextWidth('1.0e+5'), 6 * 7.4)
  assert.ok(estimateTextWidth('坐标') > estimateTextWidth('ab'))
  close(estimateTextWidth(''), 0)
})

test('marker labels near each other do not overlap', () => {
  const area = { left: 0, right: 600, top: 0, bottom: 400 }
  const width = estimateTextWidth('root x = -1')
  const [a, b] = placeMarkerLabels(
    [
      { x: 300, y: 200 },
      { x: 330, y: 200 },
    ],
    [width, width],
    area,
  )
  const span = (p: { x: number; anchor: 'start' | 'end' }) =>
    p.anchor === 'start' ? [p.x, p.x + width] : [p.x - width, p.x]
  const [al, ar] = span(a)
  const [bl, br] = span(b)
  const sameRow = a.y === b.y
  assert.ok(!sameRow || ar <= bl || br <= al, 'labels on one row must not cover each other')
})

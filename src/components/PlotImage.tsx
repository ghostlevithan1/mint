import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import { usePlotDetail } from '../hooks/usePlotDetail'
import { createFieldPainter, type FieldPainter } from '../lib/complexField'
import { traceImplicit, type Traced } from '../lib/implicit'
import { sampleCurve, describePlot, formatTick, implicitFunction, isCategoryLine, niceTicks, parsePlotSpec, PlotError, PLOT_COLORS as SERIES, sharedTicks, type ImplicitEquation, type PlotData } from '../lib/plotSpec'
import { clampLabel, estimateTextWidth, insideArea, nearestOnSegment, panView, placeMarkerLabels, placeReadout, squareView, zoomView, type View } from '../lib/plotGeometry'
import { DataChart } from './DataChart'

const W = 640
const H = 360
// The left margin is wide enough for a 6-character tick label (e.g. -1.0e+5)
// to end at x = 48 and still start inside the canvas.
const M = { top: 16, right: 20, bottom: 40, left: 56 }
const IW = W - M.left - M.right
const IH = H - M.top - M.bottom
/** How close a click must land, in viewBox units, to count as hitting a curve. */
const HIT_RADIUS = 18
const ZOOM_SPEED = 0.0015
/** Pointer movement below this many units is a click, not a drag. */
const DRAG_THRESHOLD = 3
/** Radius of the dot shown on a clicked point. */
const DOT_RADIUS = 4.5

type Selection = { x: number; y: number; label: string; color: string; lines?: string[] }
type Drag = { id: number; px: number; py: number; view: View; moved: boolean }

const isFieldChart = (data: PlotData) => data.chart === 'complex' || data.chart === 'fractal'
/** Charts whose single click reads a bar: drawn by the non-interactive path. */
const isBarsOnly = (data: PlotData) => data.chart === 'bar' || data.chart === 'histogram' || data.chart === 'pie'

/** The shaded part of an inequality: each row of cells as one rectangle. */
function shadePath(
  piece: Traced,
  view: View,
  sx: (x: number) => number,
  sy: (y: number) => number,
): string {
  const dx = (view.x1 - view.x0) / piece.nx
  const dy = (view.y1 - view.y0) / piece.ny
  let d = ''
  for (let index = 0; index + 2 < piece.runs.length; index += 3) {
    const row = piece.runs[index]
    const left = sx(view.x0 + piece.runs[index + 1] * dx)
    const right = sx(view.x0 + (piece.runs[index + 2] + 1) * dx)
    const top = sy(view.y0 + (row + 1) * dy)
    const bottom = sy(view.y0 + row * dy)
    d += `M${left.toFixed(1)} ${top.toFixed(1)}h${Math.max(0, right - left).toFixed(1)}v${Math.max(0, bottom - top).toFixed(1)}h-${Math.max(0, right - left).toFixed(1)}Z`
  }
  return d
}

/**
 * The picture behind a complex graph or fractal. It is painted in row chunks,
 * yielding between them, so a deep zoom never freezes the page; panning paints
 * fewer rows and the still frame fills in the rest.
 */
function FieldCanvas({ painter, view, quick }: { painter: FieldPainter; view: View; quick: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const measure = () => {
      const rect = wrap.getBoundingClientRect()
      setSize({ w: Math.round(rect.width), h: Math.round(rect.height) })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w < 2 || size.h < 2) return
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const width = Math.round(size.w * ratio)
    const height = Math.round(size.h * ratio)
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return
    const image = context.createImageData(width, height)
    let cancelled = false
    let timer = 0
    let painted = 0
    // Rows are painted in slices, yielding between them, so the page stays responsive.
    // While panning the slices are bigger, so a rough frame lands almost at once.
    const chunk = Math.max(1, Math.ceil(height / (quick ? 3 : 20)))
    const paintNext = () => {
      if (cancelled) return
      const to = Math.min(height, painted + chunk)
      painter.paint(view, width, height, painted, to, image.data)
      painted = to
      context.putImageData(image, 0, 0, 0, 0, width, painted)
      if (painted < height) timer = window.setTimeout(paintNext, 0)
    }
    paintNext()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [painter, view, size, quick])

  return (
    <div className="plot-field" ref={wrapRef}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  )
}

function coordinate(value: number): string {
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e6 || abs < 1e-4) return value.toExponential(2)
  return String(Number(value.toPrecision(5)))
}

function Chart({ data, detail }: { data: PlotData; detail: number }) {
  // Every graph needs its own clip id, or one graph's clip is used by the rest.
  const clipId = `plot-area-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  // Every graph is a plot to explore; only the data charts (bars, pies) are not.
  const interactive = !isBarsOnly(data)
  const isBars = !interactive
  const initial = useMemo<View>(() => {
    const base = { x0: data.xRange[0], x1: data.xRange[1], y0: data.yRange[0], y1: data.yRange[1] }
    // Line, scatter, cobweb and complex graphs use square units, like a Desmos
    // window, so shapes are never stretched. A sequence plots n against a value,
    // so its axes keep their own scales. The extra room goes to the smaller axis.
    return interactive && data.chart !== 'sequence' ? squareView(base, IW / IH) : base
  }, [data, interactive])
  // Equation curves are sampled over the starting window, which square units
  // may widen, so the drawn curve reaches the edges of the plot.
  const lines = useMemo(() => {
    if (!interactive) return data.lines
    const samples = Math.max(2, detail)
    return data.lines.map((line) => {
      if (!line.expr || line.points.length < 2) return line
      try {
        return { ...line, points: sampleCurve(line.expr, line.params ?? {}, samples, initial.x0, initial.x1, line.part) }
      } catch {
        return line
      }
    })
  }, [data.lines, detail, initial, interactive])
  // Implicit curves and the picture are rebuilt for the window on screen, so
  // zooming keeps a circle a circle instead of revealing the sample grid.
  const [traced, setTraced] = useState<{ eq: ImplicitEquation; traced: Traced; key: string }[]>([])
  const painter = useMemo<FieldPainter | null>(() => {
    if (!data.field) return null
    try {
      return createFieldPainter(data.field.spec, data.field.params)
    } catch {
      return null
    }
  }, [data.field])
  const [view, setView] = useState<View>(initial)
  // The window moves while dragging; tracing pauses until the drag settles.
  const [settledView, setSettledView] = useState<View>(initial)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [barPick, setBarPick] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const viewRef = useRef(view)
  const dragRef = useRef<Drag | null>(null)

  const { x0, x1, y0, y1 } = view
  const sx = (x: number) => M.left + ((x - x0) / (x1 - x0)) * IW
  const sy = (y: number) => M.top + (1 - (y - y0) / (y1 - y0)) * IH

  // A new spec (a different graph) starts from its own default window.
  useEffect(() => {
    setView(initial)
    setSelection(null)
    setBarPick(null)
  }, [initial])

  useEffect(() => {
    viewRef.current = view
    const timer = window.setTimeout(() => setSettledView(view), 160)
    return () => window.clearTimeout(timer)
  }, [view])

  useEffect(() => {
    setSettledView(initial)
  }, [initial])

  const implicitEquations = data.implicit
  useEffect(() => {
    if (!implicitEquations.length) {
      setTraced([])
      return
    }
    const key = `${settledView.x0},${settledView.y0},${settledView.x1},${settledView.y1}`
    const next = implicitEquations.flatMap((eq) => {
      try {
        return [{ eq, key, traced: traceImplicit(implicitFunction(eq), settledView, eq.relation) }]
      } catch {
        return []
      }
    })
    setTraced(next)
  }, [implicitEquations, settledView])

  /** Cursor position in viewBox units plus the data value under it. */
  const pointAt = useCallback((current: View, clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const px = ((clientX - rect.left) / rect.width) * W
    const py = ((clientY - rect.top) / rect.height) * H
    if (px < M.left || px > W - M.right || py < M.top || py > H - M.bottom) return null
    return {
      px,
      py,
      x: current.x0 + ((px - M.left) / IW) * (current.x1 - current.x0),
      y: current.y0 + (1 - (py - M.top) / IH) * (current.y1 - current.y0),
    }
  }, [])

  // Wheel is registered by hand because React's synthetic wheel listener is
  // passive, so preventDefault() there would not stop the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !interactive) return
    const onWheel = (event: WheelEvent) => {
      const point = pointAt(viewRef.current, event.clientX, event.clientY)
      if (!point) return
      event.preventDefault()
      const factor = Math.exp(event.deltaY * ZOOM_SPEED)
      setView((current) => zoomView(current, point, factor, initial))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [interactive, initial, pointAt])

  const reset = () => {
    setView(initial)
    setSelection(null)
    setBarPick(null)
  }

  const onPointerDown = (event: ReactPointerEvent<SVGRectElement>) => {
    if (event.button !== 0) return
    const point = pointAt(view, event.clientX, event.clientY)
    if (!point) return
    // Capture keeps the drag alive when the pointer leaves the chart, but it is
    // not available for every pointer (or synthetic event), so it is optional.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // keep dragging without capture
    }
    dragRef.current = { id: event.pointerId, px: point.px, py: point.py, view, moved: false }
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<SVGRectElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const px = ((event.clientX - rect.left) / rect.width) * W
    const py = ((event.clientY - rect.top) / rect.height) * H
    const dxPx = px - drag.px
    const dyPx = py - drag.py
    if (!drag.moved && Math.hypot(dxPx, dyPx) <= DRAG_THRESHOLD) return
    drag.moved = true
    const dx = -(dxPx / IW) * (drag.view.x1 - drag.view.x0)
    const dy = (dyPx / IH) * (drag.view.y1 - drag.view.y0)
    setView(panView(drag.view, dx, dy, initial))
  }

  const onPointerUp = (event: ReactPointerEvent<SVGRectElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!drag.moved) setSelection(findSelection(event.clientX, event.clientY))
  }

  const onPointerCancel = (event: ReactPointerEvent<SVGRectElement>) => {
    if (dragRef.current?.id !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
  }

  /** Nearest point on any curve, within the click radius, in data space. */
  const findSelection = (clientX: number, clientY: number): Selection | null => {
    const point = pointAt(viewRef.current, clientX, clientY)
    if (!point) return null
    const current = viewRef.current
    let best: (Selection & { distance: number }) | null = null

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const color = SERIES[index % SERIES.length]
      if (line.mode === 'scatter') {
        for (const [x, y] of line.points) {
          if (!Number.isFinite(y)) continue
          const distance = Math.hypot(sx(x) - point.px, sy(y) - point.py)
          if (distance <= HIT_RADIUS && (!best || distance < best.distance)) {
            best = { x, y, label: line.label, color, distance }
          }
        }
        continue
      }
      if (line.points.length === 1) {
        // A single point, such as x0 of a cobweb, can still be picked.
        const [x, y] = line.points[0]
        if (Number.isFinite(y) && Math.hypot(sx(x) - point.px, sy(y) - point.py) <= HIT_RADIUS) {
          best = { x, y, label: line.label, color, distance: Math.hypot(sx(x) - point.px, sy(y) - point.py) }
        }
        continue
      }
      let previous: { x: number; y: number } | null = null
      for (const [x, y] of line.points) {
        if (!Number.isFinite(y) || y < current.y0 - (current.y1 - current.y0) || y > current.y1 + (current.y1 - current.y0)) {
          previous = null
          continue
        }
        const next = { x: sx(x), y: sy(y) }
        if (previous) {
          const hit = nearestOnSegment({ x: point.px, y: point.py }, previous, next)
          if (hit.distance <= HIT_RADIUS && (!best || hit.distance < best.distance)) {
            best = {
              x: current.x0 + ((hit.x - M.left) / IW) * (current.x1 - current.x0),
              y: current.y0 + (1 - (hit.y - M.top) / IH) * (current.y1 - current.y0),
              label: line.label,
              color,
              distance: hit.distance,
            }
          }
        }
        previous = next
      }
    }

    // An implicit curve is traced in data units, so its nearest piece is found directly.
    if (!best) {
      for (let index = 0; index < traced.length; index += 1) {
        const { segments } = traced[index].traced
        for (let piece = 0; piece + 3 < segments.length; piece += 4) {
          const hit = nearestOnSegment(
            { x: point.px, y: point.py },
            { x: sx(segments[piece]), y: sy(segments[piece + 1]) },
            { x: sx(segments[piece + 2]), y: sy(segments[piece + 3]) },
          )
          if (hit.distance <= HIT_RADIUS && (!best || hit.distance < best.distance)) {
            best = {
              x: current.x0 + ((hit.x - M.left) / IW) * (current.x1 - current.x0),
              y: current.y0 + (1 - (hit.y - M.top) / IH) * (current.y1 - current.y0),
              label: traced[index].eq.label,
              color: SERIES[(lines.length + index) % SERIES.length],
              distance: hit.distance,
            }
          }
        }
      }
    }
    // A colouring has a value at every point, so a click anywhere reads one out.
    if (!best && painter) {
      const x = current.x0 + ((point.px - M.left) / IW) * (current.x1 - current.x0)
      const y = current.y0 + (1 - (point.py - M.top) / IH) * (current.y1 - current.y0)
      const lines = painter.at(x, y)
      if (lines.length) best = { x, y, label: '', color: SERIES[0], distance: 0, lines }
    }
    return best
  }

  const tickStep = interactive && !isFieldChart(data) ? sharedTicks(x0, x1, y0, y1) : interactive ? { x: niceTicks(x0, x1, 7), y: niceTicks(y0, y1, 5), step: 0 } : null
  const yTicks = tickStep ? tickStep.y : niceTicks(y0, y1, 5)
  const xTicks = tickStep ? tickStep.x : []
  const inside = (y: number) => y >= y0 - (y1 - y0) && y <= y1 + (y1 - y0)

  // Breaks the path at gaps, so asymptotes and undefined regions are not joined.
  const path = (points: [number, number][], breakAtZero = false) => {
    let d = ''
    let pen = false
    let previous: number | null = null
    for (const [x, y] of points) {
      // A cobweb's staircase must not be joined across y = x, only back to it.
      if (breakAtZero && previous !== null && Math.abs(y) < 1e-12 && previous !== 0) {
        d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`
        pen = true
      }
      previous = y
      if (!Number.isFinite(y) || !inside(y)) {
        pen = false
        continue
      }
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`
      pen = true
    }
    return d
  }

  const band = isBars ? IW / Math.max(1, data.bars.length) : 0
  const showEveryLabel = data.bars.length <= 12
  const pickedBar = barPick !== null ? data.bars[barPick] : null
  const zoomed =
    x1 - x0 < initial.x1 - initial.x0 - 1e-9 || y1 - y0 < initial.y1 - initial.y0 - 1e-9

  const dotX = selection ? sx(selection.x) : 0
  const dotY = selection ? sy(selection.y) : 0
  const showSeries = lines.length > 1
  const readoutLabel =
    selection && selection.label.length > 26 ? `${selection.label.slice(0, 25)}…` : (selection?.label ?? '')
  const readoutLines = selection
    ? selection.lines ?? [
        ...(showSeries ? [readoutLabel] : []),
        `x = ${coordinate(selection.x)}`,
        `y = ${coordinate(selection.y)}`,
      ]
    : []
  // Rough width of the 12px monospace readout, in viewBox units, so it can be
  // kept inside the plot frame instead of spilling over the axes.
  const readoutWidth = Math.max(0, ...readoutLines.map(estimateTextWidth)) + 4
  const readout = selection
    ? placeReadout({ x: dotX, y: dotY }, readoutLines.length, readoutWidth, {
        left: M.left,
        right: W - M.right,
        top: M.top,
        bottom: H - M.bottom,
      })
    : null
  const markerLabels = placeMarkerLabels(
    data.markers.map((point) => ({ x: sx(point.x), y: sy(point.y) })),
    data.markers.map((point) => estimateTextWidth(point.label ?? '')),
    { left: M.left, right: W - M.right, top: M.top, bottom: H - M.bottom },
  )
  // Panning or zooming can carry a selected point out of the frame. The dot and
  // guide lines must not be drawn outside the graph, so hide them there.
  const pointInside =
    selection !== null &&
    insideArea(
      { x: dotX, y: dotY },
      { left: M.left, right: W - M.right, top: M.top, bottom: H - M.bottom },
      DOT_RADIUS,
    )

  return (
    <div className="plot-canvas">
      {painter && (
        <div
          className="plot-field-hit"
          style={{
            left: `${(M.left / W) * 100}%`,
            top: `${(M.top / H) * 100}%`,
            width: `${(IW / W) * 100}%`,
            height: `${(IH / H) * 100}%`,
          }}
        >
          <FieldCanvas painter={painter} view={settledView} quick={dragging} />
        </div>
      )}
      <svg
        ref={svgRef}
        className="plot-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={data.title || 'Graph'}
        onClick={interactive ? undefined : () => setBarPick(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={M.left} y={M.top} width={IW} height={IH} />
          </clipPath>
        </defs>

        {yTicks.map((t) => (
          <g key={`y${t}`}>
            {data.grid && <line className="plot-grid" x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} />}
            <text className="plot-tick" x={M.left - 8} y={sy(t)} textAnchor="end" dominantBaseline="middle">
              {formatTick(t, M.left - 10)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => {
          const label = formatTick(t, W)
          // The first and last ticks sit on the frame, so nudge their labels in
          // rather than letting them hang outside the graph.
          const labelX = clampLabel(sx(t), estimateTextWidth(label), M.left, W - M.right)
          return (
            <g key={`x${t}`}>
              {data.grid && <line className="plot-grid" y1={M.top} y2={H - M.bottom} x1={sx(t)} x2={sx(t)} />}
              <text className="plot-tick" x={labelX} y={H - M.bottom + 18} textAnchor="middle">
                {label}
              </text>
            </g>
          )
        })}

        {/* The x = 0 and y = 0 axes, when they are in view, so graphs read like a maths book. */}
        {y0 < 0 && y1 > 0 && <line className="plot-axis" x1={M.left} x2={W - M.right} y1={sy(0)} y2={sy(0)} />}
        {!isBars && x0 < 0 && x1 > 0 && (
          <line className="plot-axis" y1={M.top} y2={H - M.bottom} x1={sx(0)} x2={sx(0)} />
        )}
        <line className="plot-frame" x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} />

        <g clipPath={`url(#${clipId})`}>
          {/* Inequalities shade the cells where they hold. */}
          {traced.map(({ eq, traced: piece }, index) =>
            eq.relation === '=' ? null : (
              <path
                key={`shade${index}`}
                className="plot-shade"
                d={piece.runs.length ? shadePath(piece, view, sx, sy) : undefined}
                fill={SERIES[(lines.length + index) % SERIES.length]}
              />
            ),
          )}
          {traced.map(({ traced: piece }, index) => {
            let d = ''
            for (let at = 0; at + 3 < piece.segments.length; at += 4) {
              d += `M${sx(piece.segments[at]).toFixed(1)} ${sy(piece.segments[at + 1]).toFixed(1)}L${sx(piece.segments[at + 2]).toFixed(1)} ${sy(piece.segments[at + 3]).toFixed(1)}`
            }
            return (
              <path
                key={`implicit${index}`}
                className="plot-line"
                d={d}
                stroke={SERIES[(lines.length + index) % SERIES.length]}
              />
            )
          })}

          {isBars &&
            data.bars.map((bar, i) => {
              const top = sy(Math.max(0, bar.value))
              const base = sy(Math.max(y0, Math.min(0, bar.value)))
              const gap = data.chart === 'histogram' ? 1 : band * 0.18
              return (
                <rect
                  key={i}
                  className="plot-bar"
                  x={M.left + band * i + gap}
                  y={Math.min(top, base)}
                  width={Math.max(1, band - gap * 2)}
                  height={Math.abs(base - top)}
                  rx={data.chart === 'histogram' ? 0 : 3}
                  fill={SERIES[0]}
                  onClick={(event) => {
                    event.stopPropagation()
                    setBarPick(i)
                  }}
                />
              )
            })}

          {lines.map((line, i) =>
            line.mode === 'scatter' ? (
              <g key={i} fill={SERIES[i % SERIES.length]}>
                {line.points
                  .filter(([, y]) => Number.isFinite(y))
                  .map(([x, y], j) => (
                    <circle key={j} cx={sx(x)} cy={sy(y)} r={3} />
                  ))}
              </g>
            ) : (
              <path
                key={i}
                className={`plot-line${line.style ? ` is-${line.style}` : ''}`}
                d={path(line.points)}
                stroke={SERIES[i % SERIES.length]}
              />
            ),
          )}

          {data.markers.map((point, i) => (
            <g key={`m${i}`} className="plot-marker">
              <circle cx={sx(point.x)} cy={sy(point.y)} r={5} />
              {point.label && (
                <text x={markerLabels[i].x} y={markerLabels[i].y} textAnchor={markerLabels[i].anchor}>
                  {point.label}
                </text>
              )}
            </g>
          ))}
        </g>

        {isBars &&
          data.bars.map((bar, i) => {
            if (!(showEveryLabel || i % Math.ceil(data.bars.length / 8) === 0)) return null
            const label = bar.label.length > 10 ? `${bar.label.slice(0, 9)}…` : bar.label
            // Labels are centered on their band, so the outermost ones need a
            // nudge inside rather than hanging over the frame.
            const labelX = clampLabel(M.left + band * (i + 0.5), estimateTextWidth(label), M.left, W - M.right)
            return (
              <text key={`b${i}`} className="plot-tick" x={labelX} y={H - M.bottom + 18} textAnchor="middle">
                {label}
              </text>
            )
          })}

        {pickedBar && barPick !== null && (() => {
          const label = `${pickedBar.label.length > 16 ? `${pickedBar.label.slice(0, 15)}…` : pickedBar.label}: ${coordinate(pickedBar.value)}`
          // A bar can rise above the window, so hold the guide inside the frame.
          const top = Math.max(
            M.top,
            Math.min(sy(Math.max(0, pickedBar.value)), sy(Math.max(y0, Math.min(0, pickedBar.value)))),
          )
          return (
            <g pointerEvents="none">
              <line
                className="plot-readout-guide"
                x1={M.left + band * (barPick + 0.5)}
                x2={M.left + band * (barPick + 0.5)}
                y1={top}
                y2={H - M.bottom}
              />
              <text
                className="plot-readout-text"
                x={clampLabel(M.left + band * (barPick + 0.5), estimateTextWidth(label), M.left, W - M.right)}
                y={Math.max(M.top + 14, top - 10)}
                textAnchor="middle"
              >
                {label}
              </text>
            </g>
          )
        })()}

        {selection && readout && (
          <g pointerEvents="none">
            {pointInside && (
              <>
                <line className="plot-readout-guide" x1={dotX} x2={dotX} y1={M.top} y2={H - M.bottom} />
                <line className="plot-readout-guide" x1={M.left} x2={W - M.right} y1={dotY} y2={dotY} />
                <circle className="plot-readout-dot" cx={dotX} cy={dotY} r={DOT_RADIUS} fill={selection.color} />
              </>
            )}
            <text className="plot-readout-text" x={readout.x} y={readout.y} textAnchor={readout.anchor}>
              {readoutLines.map((line, index) => (
                <tspan key={index} x={readout.x} y={readout.y + index * 15}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        )}

        {data.xLabel && (
          <text className="plot-label" x={M.left + IW / 2} y={H - 4} textAnchor="middle">
            {data.xLabel}
          </text>
        )}
        {data.yLabel && (
          <text className="plot-label" transform={`translate(12 ${M.top + IH / 2}) rotate(-90)`} textAnchor="middle">
            {data.yLabel}
          </text>
        )}

        {/* The interaction layer sits on top so drags and clicks work anywhere
            in the plot, not only where a curve happens to pass. */}
        {interactive && (
          <rect
            className={`plot-hit${dragging ? ' is-dragging' : ''}`}
            x={M.left}
            y={M.top}
            width={IW}
            height={IH}
            aria-hidden="true"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onDoubleClick={reset}
          />
        )}
      </svg>

      {(zoomed || selection || barPick !== null) && interactive && (
        <button type="button" className="plot-reset" onClick={reset}>
          Reset view
        </button>
      )}
    </div>
  )
}

/**
 * Draws the fenced ```plot spec the model emits, in the browser. While the
 * fence is still streaming the JSON is incomplete, so it shows a quiet
 * pending state instead of an error.
 */
export const PlotImage = memo(function PlotImage({ spec, streaming = false }: { spec: string; streaming?: boolean }) {
  const [detail] = usePlotDetail()
  const result = useMemo(() => {
    try {
      return { data: parsePlotSpec(spec, { samples: detail }) }
    } catch (error) {
      return { error: error instanceof PlotError ? error.message : 'The graph could not be drawn.' }
    }
  }, [spec, detail])

  if ('error' in result) {
    if (streaming) {
      return (
        <div className="plot-pending" role="status">
          <Loader2 size={16} className="spin" aria-hidden="true" />
          <span>Drawing the graph</span>
        </div>
      )
    }
    return (
      <div className="plot-error" role="status">
        <TriangleAlert size={14} aria-hidden="true" />
        <span>{result.error}</span>
      </div>
    )
  }

  const { data } = result
  const categoryLine = isCategoryLine(data)
  const dataChart = data.chart === 'bar' || data.chart === 'pie' || categoryLine
  const interactive = !dataChart
  // Pies carry their own key beside the chart; bars and lines list their series below.
  const legend = dataChart
    ? data.chart !== 'pie' && data.groups.length > 1
      ? data.groups.map((group) => group.label)
      : []
    : interactive && data.lines.filter((line) => !line.quiet).length + data.implicit.length > 1
      ? [...data.lines.filter((line) => !line.quiet).map((line) => line.label), ...data.implicit.map((curve) => curve.label)]
      : []
  const hint = isFieldChart(data)
    ? 'Scroll to zoom · drag to pan · click anywhere to read values · double-click to reset'
    : interactive
      ? 'Scroll to zoom · drag to pan · click a curve or point for exact values · double-click to reset'
      : data.chart === 'pie'
      ? 'Click a slice to highlight it'
      : categoryLine
        ? 'Click a point for its exact value'
        : 'Click a bar for its exact value'
  return (
    <figure className="plot-figure">
      {data.title && <figcaption className="plot-title">{data.title}</figcaption>}
      {dataChart ? <DataChart data={data} /> : <Chart data={data} detail={detail} />}
      <ul className="sr-only" aria-label="Graph values">
        {describePlot(data).map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {legend.length > 0 && (
        <ul className={`plot-legend${data.chart === 'bar' ? ' is-blocks' : ''}`}>
          {legend.map((label, i) => (
            <li key={i}>
              <span style={{ background: SERIES[i % SERIES.length] }} />
              {label}
            </li>
          ))}
        </ul>
      )}
      <p className="plot-hint">{hint}</p>
    </figure>
  )
})

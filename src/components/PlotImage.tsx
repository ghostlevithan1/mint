import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import { niceTicks, parsePlotSpec, PlotError, type PlotData } from '../lib/plotSpec'
import { nearestOnSegment, panView, zoomView, type View } from '../lib/plotGeometry'

const W = 640
const H = 360
const M = { top: 16, right: 20, bottom: 40, left: 52 }
const IW = W - M.left - M.right
const IH = H - M.top - M.bottom
const SERIES = ['#86d95f', '#8fb4d9', '#e0b26a', '#d6a28c', '#5fc8b0', '#e5484d', '#c9c9cd', '#a1c96a']
/** How close a click must land, in viewBox units, to count as hitting a curve. */
const HIT_RADIUS = 18
const ZOOM_SPEED = 0.0015
/** Pointer movement below this many units is a click, not a drag. */
const DRAG_THRESHOLD = 3

type Selection = { x: number; y: number; label: string; color: string }
type Drag = { id: number; px: number; py: number; view: View; moved: boolean }

function fmt(value: number): string {
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e5 || abs < 1e-3) return value.toExponential(1)
  return String(Number(value.toPrecision(4)))
}

/** Precise enough for a readout, short enough to stay readable. */
function coordinate(value: number): string {
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e6 || abs < 1e-4) return value.toExponential(2)
  return String(Number(value.toPrecision(5)))
}

function Chart({ data }: { data: PlotData }) {
  const initial = useMemo<View>(
    () => ({ x0: data.xRange[0], x1: data.xRange[1], y0: data.yRange[0], y1: data.yRange[1] }),
    [data],
  )
  const [view, setView] = useState<View>(initial)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [barPick, setBarPick] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const viewRef = useRef(view)
  const dragRef = useRef<Drag | null>(null)
  const interactive = data.chart === 'line' || data.chart === 'scatter'
  const isBars = !interactive

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
  }, [view])

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

    for (let index = 0; index < data.lines.length; index += 1) {
      const line = data.lines[index]
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
    return best
  }

  const yTicks = niceTicks(y0, y1, 5)
  const xTicks = isBars ? [] : niceTicks(x0, x1, 7)
  const inside = (y: number) => y >= y0 - (y1 - y0) && y <= y1 + (y1 - y0)

  // Breaks the path at gaps, so asymptotes and undefined regions are not joined.
  const path = (points: [number, number][]) => {
    let d = ''
    let pen = false
    for (const [x, y] of points) {
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
  const flipX = dotX > M.left + IW * 0.6
  const flipY = dotY < M.top + 58
  const labelX = flipX ? dotX - 12 : dotX + 12
  const baseY = flipY ? dotY + 24 : dotY - 22
  const showSeries = data.lines.length > 1

  return (
    <div className="plot-canvas">
      <svg
        ref={svgRef}
        className="plot-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={data.title || 'Graph'}
        onClick={interactive ? undefined : () => setBarPick(null)}
      >
        <defs>
          <clipPath id="plot-area">
            <rect x={M.left} y={M.top} width={IW} height={IH} />
          </clipPath>
        </defs>

        {yTicks.map((t) => (
          <g key={`y${t}`}>
            {data.grid && <line className="plot-grid" x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} />}
            <text className="plot-tick" x={M.left - 8} y={sy(t)} textAnchor="end" dominantBaseline="middle">
              {fmt(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            {data.grid && <line className="plot-grid" y1={M.top} y2={H - M.bottom} x1={sx(t)} x2={sx(t)} />}
            <text className="plot-tick" x={sx(t)} y={H - M.bottom + 18} textAnchor="middle">
              {fmt(t)}
            </text>
          </g>
        ))}

        {/* The x = 0 and y = 0 axes, when they are in view, so graphs read like a maths book. */}
        {y0 < 0 && y1 > 0 && <line className="plot-axis" x1={M.left} x2={W - M.right} y1={sy(0)} y2={sy(0)} />}
        {!isBars && x0 < 0 && x1 > 0 && (
          <line className="plot-axis" y1={M.top} y2={H - M.bottom} x1={sx(0)} x2={sx(0)} />
        )}
        <line className="plot-frame" x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} />

        <g clipPath="url(#plot-area)">
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

          {data.lines.map((line, i) =>
            line.mode === 'scatter' ? (
              <g key={i} fill={SERIES[i % SERIES.length]}>
                {line.points
                  .filter(([, y]) => Number.isFinite(y))
                  .map(([x, y], j) => (
                    <circle key={j} cx={sx(x)} cy={sy(y)} r={3} />
                  ))}
              </g>
            ) : (
              <path key={i} className="plot-line" d={path(line.points)} stroke={SERIES[i % SERIES.length]} />
            ),
          )}

          {data.markers.map((point, i) => (
            <g key={`m${i}`} className="plot-marker">
              <circle cx={sx(point.x)} cy={sy(point.y)} r={5} />
              {point.label && (
                <text x={sx(point.x) + 9} y={sy(point.y) - 9}>
                  {point.label}
                </text>
              )}
            </g>
          ))}
        </g>

        {isBars &&
          data.bars.map((bar, i) =>
            showEveryLabel || i % Math.ceil(data.bars.length / 8) === 0 ? (
              <text key={`b${i}`} className="plot-tick" x={M.left + band * (i + 0.5)} y={H - M.bottom + 18} textAnchor="middle">
                {bar.label.length > 10 ? `${bar.label.slice(0, 9)}…` : bar.label}
              </text>
            ) : null,
          )}

        {pickedBar && barPick !== null && (
          <g pointerEvents="none">
            <line
              className="plot-readout-guide"
              x1={M.left + band * (barPick + 0.5)}
              x2={M.left + band * (barPick + 0.5)}
              y1={Math.min(sy(Math.max(0, pickedBar.value)), sy(Math.max(y0, Math.min(0, pickedBar.value))))}
              y2={H - M.bottom}
            />
            <text
              className="plot-readout-text"
              x={M.left + band * (barPick + 0.5)}
              y={Math.max(
                M.top + 14,
                Math.min(sy(Math.max(0, pickedBar.value)), sy(Math.max(y0, Math.min(0, pickedBar.value)))) - 10,
              )}
              textAnchor="middle"
            >
              {`${pickedBar.label.length > 16 ? `${pickedBar.label.slice(0, 15)}…` : pickedBar.label}: ${coordinate(pickedBar.value)}`}
            </text>
          </g>
        )}

        {selection && (
          <g pointerEvents="none">
            <line className="plot-readout-guide" x1={dotX} x2={dotX} y1={M.top} y2={H - M.bottom} />
            <line className="plot-readout-guide" x1={M.left} x2={W - M.right} y1={dotY} y2={dotY} />
            <circle className="plot-readout-dot" cx={dotX} cy={dotY} r={4.5} fill={selection.color} />
            <text className="plot-readout-text" x={labelX} y={baseY} textAnchor={flipX ? 'end' : 'start'}>
              {showSeries && (
                <tspan x={labelX} y={baseY}>
                  {selection.label.length > 26 ? `${selection.label.slice(0, 25)}…` : selection.label}
                </tspan>
              )}
              <tspan x={labelX} y={showSeries ? baseY + 15 : baseY}>{`x = ${coordinate(selection.x)}`}</tspan>
              <tspan x={labelX} y={(showSeries ? baseY + 15 : baseY) + 15}>{`y = ${coordinate(selection.y)}`}</tspan>
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
  const result = useMemo(() => {
    try {
      return { data: parsePlotSpec(spec) }
    } catch (error) {
      return { error: error instanceof PlotError ? error.message : 'The graph could not be drawn.' }
    }
  }, [spec])

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
  const legend = data.lines.length > 1
  const interactive = data.chart === 'line' || data.chart === 'scatter'
  return (
    <figure className="plot-figure">
      {data.title && <figcaption className="plot-title">{data.title}</figcaption>}
      <Chart data={data} />
      {legend && data.chart !== 'bar' && data.chart !== 'histogram' && (
        <ul className="plot-legend">
          {data.lines.map((line, i) => (
            <li key={i}>
              <span style={{ background: SERIES[i % SERIES.length] }} />
              {line.label}
            </li>
          ))}
        </ul>
      )}
      {interactive ? (
        <p className="plot-hint">
          Scroll to zoom · drag to pan · click a curve for exact values · double-click to reset
        </p>
      ) : (
        <p className="plot-hint">Click a bar for its exact value</p>
      )}
    </figure>
  )
})

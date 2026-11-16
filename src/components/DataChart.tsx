import { useEffect, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { compactNumber, isCategoryLine, niceTicks, percent, PLOT_COLORS as SERIES, type PlotData } from '../lib/plotSpec'
import { clampLabel, estimateTextWidth } from '../lib/plotGeometry'

const W = 640
const H = 360
const CHAR = 7.4
/** Value labels are drawn on bars only while there are few enough to read. */
const MAX_LABELLED_BARS = 16

type Pick = { category: number; group: number } | null

function truncate(label: string, maxChars: number): string {
  const limit = Math.max(2, Math.floor(maxChars))
  return label.length > limit ? `${label.slice(0, limit - 1)}…` : label
}

function readoutText(data: PlotData, pick: NonNullable<Pick>): string {
  const group = data.groups[pick.group]
  const name = data.groups.length > 1 ? `${data.categories[pick.category]} · ${group.label}` : data.categories[pick.category]
  return `${truncate(name, 40)}: ${compactNumber(group.values[pick.category])}`
}

/** Bar charts (vertical or horizontal, one series, grouped or stacked) and line charts over text labels. */
function CategoryChart({ data }: { data: PlotData }) {
  const [pick, setPick] = useState<Pick>(null)
  useEffect(() => setPick(null), [data])

  const line = isCategoryLine(data)
  const horizontal = data.chart === 'bar' && data.horizontal
  const n = data.categories.length
  const groupCount = data.groups.length
  const stacked = data.stacked && !line
  const drawnBars = stacked ? n : n * groupCount
  const longest = Math.max(...data.categories.map(estimateTextWidth))

  const M = horizontal
    ? { top: 26, right: 20, bottom: data.yLabel ? 44 : 30, left: Math.min(170, Math.max(64, longest + 16)) }
    : { top: 26, right: 20, bottom: 40, left: 56 }
  const IW = W - M.left - M.right
  const IH = H - M.top - M.bottom
  const band = (horizontal ? IH : IW) / Math.max(1, n)
  const inner = line ? 0 : band * 0.72
  const thickness = stacked || line ? inner : inner / groupCount
  const labelled = !line && drawnBars <= MAX_LABELLED_BARS && thickness >= 14

  // Value labels sit past the bar end, so the value axis gets room for them.
  let [v0, v1] = data.yRange
  if (labelled) {
    const span = v1 - v0
    const room = horizontal ? 0.12 : 0.05
    if (v1 > 0) v1 += span * room
    if (v0 < 0) v0 -= span * room
  }
  const ticks = niceTicks(v0, v1, horizontal ? 6 : 5)
  /** Position of a value along the value axis, in viewBox units. */
  const at = (value: number) =>
    horizontal ? M.left + ((value - v0) / (v1 - v0)) * IW : M.top + (1 - (value - v0) / (v1 - v0)) * IH
  const zero = at(Math.min(v1, Math.max(v0, 0)))
  const bandStart = (i: number) => (horizontal ? M.top : M.left) + band * i

  type Rect = { category: number; group: number; from: number; to: number; offset: number; value: number }
  const rects: Rect[] = []
  const totals: { category: number; value: number; end: number }[] = []
  if (!line) {
    data.categories.forEach((_, i) => {
      let up = 0
      let down = 0
      data.groups.forEach((group, g) => {
        const value = group.values[i]
        if (stacked) {
          const base = value >= 0 ? up : down
          const top = base + value
          if (value >= 0) up = top
          else down = top
          rects.push({ category: i, group: g, from: at(base), to: at(top), offset: (band - inner) / 2, value })
        } else {
          rects.push({
            category: i,
            group: g,
            from: zero,
            to: at(value),
            offset: (band - inner) / 2 + thickness * g,
            value,
          })
        }
      })
      if (stacked) totals.push({ category: i, value: up + down, end: at(up > 0 || down === 0 ? up : down) })
    })
  }

  // Category labels along the axis: every one when they fit, otherwise every k-th, shortened to the room they get.
  // Up to about ten characters a label is worth skipping neighbours for; longer ones are shortened instead.
  const wanted = Math.min(longest, 10 * CHAR) + 10
  const step = horizontal ? Math.max(1, Math.ceil(16 / band)) : Math.max(1, Math.ceil(wanted / band))
  const labelChars = horizontal ? (M.left - 14) / CHAR : (band * step - 6) / CHAR

  const picked = pick && data.groups[pick.group] ? pick : null
  const readout = picked ? readoutText(data, picked) : ''

  return (
    <svg
      className="plot-svg"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={data.title || (line ? 'Line graph' : 'Bar chart')}
      onClick={() => setPick(null)}
    >
      {ticks.map((t) => {
        const p = at(t)
        const label = compactNumber(t)
        return (
          <g key={`t${t}`}>
            {data.grid &&
              (horizontal ? (
                <line className="plot-grid" x1={p} x2={p} y1={M.top} y2={H - M.bottom} />
              ) : (
                <line className="plot-grid" x1={M.left} x2={W - M.right} y1={p} y2={p} />
              ))}
            {horizontal ? (
              <text
                className="plot-tick"
                x={clampLabel(p, estimateTextWidth(label), M.left, W - M.right)}
                y={H - M.bottom + 18}
                textAnchor="middle"
              >
                {label}
              </text>
            ) : (
              <text className="plot-tick" x={M.left - 8} y={p} textAnchor="end" dominantBaseline="middle">
                {label}
              </text>
            )}
          </g>
        )
      })}

      {/* The zero line, or the frame the bars stand on. */}
      {horizontal ? (
        <line className={v0 < 0 ? 'plot-axis' : 'plot-frame'} x1={zero} x2={zero} y1={M.top} y2={H - M.bottom} />
      ) : (
        <>
          <line className="plot-frame" x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} />
          {v0 < 0 && v1 > 0 && <line className="plot-axis" x1={M.left} x2={W - M.right} y1={zero} y2={zero} />}
        </>
      )}

      {rects.map((r) => {
        const lo = Math.min(r.from, r.to)
        const size = Math.max(r.value === 0 ? 0 : 1, Math.abs(r.to - r.from))
        const start = bandStart(r.category) + r.offset
        const dim = picked && (picked.category !== r.category || picked.group !== r.group)
        const select = (event: ReactMouseEvent) => {
          event.stopPropagation()
          setPick({ category: r.category, group: r.group })
        }
        const width = Math.max(1, (stacked ? inner : thickness) - (groupCount > 1 && !stacked ? 2 : 0))
        return horizontal ? (
          <rect
            key={`${r.category}-${r.group}`}
            className={`plot-bar${dim ? ' is-dim' : ''}`}
            x={lo}
            y={start}
            width={size}
            height={width}
            rx={stacked ? 0 : 2}
            fill={SERIES[r.group % SERIES.length]}
            onClick={select}
          />
        ) : (
          <rect
            key={`${r.category}-${r.group}`}
            className={`plot-bar${dim ? ' is-dim' : ''}`}
            x={start}
            y={lo}
            width={width}
            height={size}
            rx={stacked ? 0 : 2}
            fill={SERIES[r.group % SERIES.length]}
            onClick={select}
          />
        )
      })}

      {labelled &&
        (stacked
          ? totals.map((t) => ({ key: `s${t.category}`, center: bandStart(t.category) + band / 2, end: t.end, value: t.value }))
          : rects.map((r) => ({
              key: `v${r.category}-${r.group}`,
              center: bandStart(r.category) + r.offset + thickness / 2,
              end: r.to,
              value: r.value,
            }))
        ).map((v) =>
          horizontal ? (
            <text
              key={v.key}
              className="plot-value"
              x={v.value < 0 ? v.end - 5 : v.end + 5}
              y={v.center}
              textAnchor={v.value < 0 ? 'end' : 'start'}
              dominantBaseline="middle"
            >
              {compactNumber(v.value)}
            </text>
          ) : (
            <text
              key={v.key}
              className="plot-value"
              x={v.center}
              y={v.value < 0 ? v.end + 14 : v.end - 5}
              textAnchor="middle"
            >
              {compactNumber(v.value)}
            </text>
          ),
        )}

      {line &&
        data.groups.map((group, g) => {
          const color = SERIES[g % SERIES.length]
          const points = group.values.map((value, i) => [bandStart(i) + band / 2, at(value)] as const)
          return (
            <g key={`l${g}`}>
              <path
                className="plot-line"
                d={points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')}
                stroke={color}
              />
              {points.map(([x, y], i) => (
                <g key={i}>
                  <circle cx={x} cy={y} r={picked?.category === i && picked.group === g ? 5 : 3.5} fill={color} />
                  <circle
                    className="plot-point-hit"
                    cx={x}
                    cy={y}
                    r={11}
                    onClick={(event) => {
                      event.stopPropagation()
                      setPick({ category: i, group: g })
                    }}
                  />
                </g>
              ))}
            </g>
          )
        })}

      {data.categories.map((category, i) => {
        if (i % step !== 0) return null
        const label = truncate(category, labelChars)
        return horizontal ? (
          <text
            key={`c${i}`}
            className="plot-tick"
            x={M.left - 8}
            y={bandStart(i) + band / 2}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {label}
          </text>
        ) : (
          <text
            key={`c${i}`}
            className="plot-tick"
            x={clampLabel(bandStart(i) + band / 2, estimateTextWidth(label), M.left, W - M.right)}
            y={H - M.bottom + 18}
            textAnchor="middle"
          >
            {label}
          </text>
        )
      })}

      {horizontal
        ? data.yLabel && (
            <text className="plot-label" x={M.left + IW / 2} y={H - 6} textAnchor="middle">
              {data.yLabel}
            </text>
          )
        : (
          <>
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
          </>
        )}

      {readout && (
        <text className="plot-readout-text" x={W - M.right} y={16} textAnchor="end">
          {readout}
        </text>
      )}
    </svg>
  )
}

const PIE = { cx: 168, cy: 150, r: 124 }

/** A slice from angle a0 to a1 (radians, clockwise from 12 o'clock), as a ring segment when inner > 0. */
function slicePath(a0: number, a1: number, inner: number, shift = 0): string {
  const mid = (a0 + a1) / 2
  const cx = PIE.cx + Math.sin(mid) * shift
  const cy = PIE.cy - Math.cos(mid) * shift
  const point = (radius: number, angle: number) =>
    `${(cx + radius * Math.sin(angle)).toFixed(2)} ${(cy - radius * Math.cos(angle)).toFixed(2)}`
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    // A single full slice: two half arcs, with the hole cut out by the even-odd rule.
    const ring = (radius: number) =>
      `M${point(radius, 0)}A${radius} ${radius} 0 1 1 ${point(radius, Math.PI)}A${radius} ${radius} 0 1 1 ${point(radius, 0)}Z`
    return ring(PIE.r) + (inner > 0 ? ring(inner) : '')
  }
  const large = a1 - a0 > Math.PI ? 1 : 0
  const outer = `M${point(PIE.r, a0)}A${PIE.r} ${PIE.r} 0 ${large} 1 ${point(PIE.r, a1)}`
  return inner > 0
    ? `${outer}L${point(inner, a1)}A${inner} ${inner} 0 ${large} 0 ${point(inner, a0)}Z`
    : `${outer}L${cx.toFixed(2)} ${cy.toFixed(2)}Z`
}

function PieChart({ data }: { data: PlotData }) {
  const [picked, setPicked] = useState<number | null>(null)
  useEffect(() => setPicked(null), [data])

  const PH = 300
  const total = data.slices.reduce((sum, slice) => sum + slice.value, 0)
  const inner = data.donut ? PIE.r * 0.58 : 0
  let angle = 0
  const arcs = data.slices.map((slice) => {
    const a0 = angle
    angle += (slice.value / total) * Math.PI * 2
    return { ...slice, a0, a1: angle }
  })

  const legendX = 336
  const row = Math.min(24, (PH - 24) / Math.max(1, arcs.length))
  const legendTop = PH / 2 - (row * arcs.length) / 2 + row / 2
  const focus = picked !== null ? arcs[picked] : null

  return (
    <svg
      className="plot-svg"
      viewBox={`0 0 ${W} ${PH}`}
      role="img"
      aria-label={data.title || (data.donut ? 'Donut chart' : 'Pie chart')}
      onClick={() => setPicked(null)}
    >
      {arcs.map((arc, i) => {
        const select = (event: ReactMouseEvent) => {
          event.stopPropagation()
          setPicked(i)
        }
        const share = arc.value / total
        const mid = (arc.a0 + arc.a1) / 2
        const labelRadius = data.donut ? (PIE.r + inner) / 2 : PIE.r * 0.64
        const shift = picked === i && arcs.length > 1 ? 8 : 0
        return (
          <g key={i} className={`plot-slice-group${picked !== null && picked !== i ? ' is-dim' : ''}`}>
            <path
              className="plot-slice"
              d={slicePath(arc.a0, arc.a1, inner, shift)}
              fill={SERIES[i % SERIES.length]}
              fillRule="evenodd"
              onClick={select}
            />
            {share >= 0.06 && (
              <text
                className="plot-slice-label"
                x={PIE.cx + Math.sin(mid) * (labelRadius + shift)}
                y={PIE.cy - Math.cos(mid) * (labelRadius + shift)}
                textAnchor="middle"
                dominantBaseline="middle"
                pointerEvents="none"
              >
                {percent(arc.value, total)}
              </text>
            )}
          </g>
        )
      })}

      {data.donut && (
        <g pointerEvents="none">
          <text className="plot-donut-value" x={PIE.cx} y={PIE.cy - 2} textAnchor="middle">
            {compactNumber(focus ? focus.value : total)}
          </text>
          <text className="plot-label" x={PIE.cx} y={PIE.cy + 18} textAnchor="middle">
            {focus ? truncate(focus.label, 14) : 'Total'}
          </text>
        </g>
      )}

      {arcs.map((arc, i) => {
        const y = legendTop + row * i
        const value = `${compactNumber(arc.value)} · ${percent(arc.value, total)}`
        const room = (W - 16 - estimateTextWidth(value) - 12 - (legendX + 20)) / CHAR
        return (
          <g
            key={`k${i}`}
            className={`plot-legend-row${picked === i ? ' is-picked' : ''}`}
            onClick={(event) => {
              event.stopPropagation()
              setPicked(i)
            }}
          >
            <rect x={legendX} y={y - 6} width={12} height={12} rx={3} fill={SERIES[i % SERIES.length]} />
            <text className="plot-legend-text" x={legendX + 20} y={y} dominantBaseline="middle">
              {truncate(arc.label, room)}
            </text>
            <text className="plot-tick" x={W - 16} y={y} textAnchor="end" dominantBaseline="middle">
              {value}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Charts of labelled data: bars, pies and lines over text labels. */
export function DataChart({ data }: { data: PlotData }) {
  return <div className="plot-canvas">{data.chart === 'pie' ? <PieChart data={data} /> : <CategoryChart data={data} />}</div>
}

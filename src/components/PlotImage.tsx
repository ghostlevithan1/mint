import { memo, useMemo } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import { niceTicks, parsePlotSpec, PlotError, type PlotData } from '../lib/plotSpec'

const W = 640
const H = 360
const M = { top: 16, right: 20, bottom: 40, left: 52 }
const SERIES = ['#86d95f', '#8fb4d9', '#e0b26a', '#d6a28c', '#5fc8b0', '#e5484d', '#c9c9cd', '#a1c96a']

function fmt(value: number): string {
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e5 || abs < 1e-3) return value.toExponential(1)
  return String(Number(value.toPrecision(4)))
}

function Chart({ data }: { data: PlotData }) {
  const [x0, x1] = data.xRange
  const [y0, y1] = data.yRange
  const iw = W - M.left - M.right
  const ih = H - M.top - M.bottom
  const sx = (x: number) => M.left + ((x - x0) / (x1 - x0)) * iw
  const sy = (y: number) => M.top + (1 - (y - y0) / (y1 - y0)) * ih
  const isBars = data.chart === 'bar' || data.chart === 'histogram'

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

  const band = isBars ? iw / Math.max(1, data.bars.length) : 0
  const showEveryLabel = data.bars.length <= 12

  return (
    <svg className="plot-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={data.title || 'Graph'}>
      <defs>
        <clipPath id="plot-area">
          <rect x={M.left} y={M.top} width={iw} height={ih} />
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

      {data.xLabel && (
        <text className="plot-label" x={M.left + iw / 2} y={H - 4} textAnchor="middle">
          {data.xLabel}
        </text>
      )}
      {data.yLabel && (
        <text className="plot-label" transform={`translate(12 ${M.top + ih / 2}) rotate(-90)`} textAnchor="middle">
          {data.yLabel}
        </text>
      )}
    </svg>
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
    </figure>
  )
})

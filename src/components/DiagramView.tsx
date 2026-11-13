import { memo, useMemo } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import { DiagramError, parseDiagramSpec, wrapLabel, type Diagram } from '../lib/diagramSpec'

const W = 560
const H = 380
const CX = W / 2
const CY = H / 2

const polar = (radius: number, angle: number): [number, number] => [
  CX + radius * Math.cos(angle),
  CY + radius * Math.sin(angle),
]

/** A label placed outside the ring, anchored away from the centre so it never overlaps the drawing. */
function OuterLabel({ angle, radius, label }: { angle: number; radius: number; label: string }) {
  const [x, y] = polar(radius, angle)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle'
  const lines = wrapLabel(label)
  const shift = sin < -0.3 ? -(lines.length - 1) * 16 : sin > 0.3 ? 4 : -((lines.length - 1) * 16) / 2
  return (
    <text className="diagram-label" x={x} y={y + shift} textAnchor={anchor} dominantBaseline="middle">
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : 16}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

function Cycle({ nodes }: Diagram) {
  const n = nodes.length
  const R = 112
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const gap = 0.24
  return (
    <svg className="diagram-svg" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs>
        <marker id="dg-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M1 1 9 5 1 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
      {nodes.map((_, i) => {
        const [x1, y1] = polar(R, angle(i) + gap)
        const [x2, y2] = polar(R, angle(i + 1) - gap)
        return (
          <path
            key={`a${i}`}
            className="diagram-arrow"
            d={`M${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2}`}
            markerEnd="url(#dg-arrow)"
          />
        )
      })}
      {nodes.map((node, i) => {
        const [x, y] = polar(R, angle(i))
        return (
          <g key={i}>
            <circle className="diagram-dot" cx={x} cy={y} r={15} />
            <text className="diagram-num" x={x} y={y} textAnchor="middle" dominantBaseline="central">
              {i + 1}
            </text>
            <OuterLabel angle={angle(i)} radius={R + 30} label={node.label} />
          </g>
        )
      })}
    </svg>
  )
}

function Hub({ nodes }: Diagram) {
  const [centre, ...branches] = nodes
  const n = branches.length
  const R = 120
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const centreLines = wrapLabel(centre.label, 12)
  return (
    <svg className="diagram-svg" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {branches.map((_, i) => {
        const [x1, y1] = polar(52, angle(i))
        const [x2, y2] = polar(R, angle(i))
        return <line key={`l${i}`} className="diagram-branch" x1={x1} y1={y1} x2={x2} y2={y2} />
      })}
      <circle className="diagram-centre" cx={CX} cy={CY} r={52} />
      <text className="diagram-centre-label" x={CX} y={CY - ((centreLines.length - 1) * 16) / 2} textAnchor="middle" dominantBaseline="middle">
        {centreLines.map((line, i) => (
          <tspan key={i} x={CX} dy={i === 0 ? 0 : 16}>
            {line}
          </tspan>
        ))}
      </text>
      {branches.map((node, i) => {
        const [x, y] = polar(R, angle(i))
        return (
          <g key={i}>
            <circle className="diagram-dot is-small" cx={x} cy={y} r={5} />
            <OuterLabel angle={angle(i)} radius={R + 16} label={node.label} />
          </g>
        )
      })}
    </svg>
  )
}

/**
 * Draws the fenced ```diagram spec: a numbered process, a cycle, or a central
 * idea with its parts. Details go in a list under the drawing, so the drawing
 * stays readable and the text stays selectable.
 */
export const DiagramView = memo(function DiagramView({ spec, streaming = false }: { spec: string; streaming?: boolean }) {
  const result = useMemo(() => {
    try {
      return { diagram: parseDiagramSpec(spec) }
    } catch (error) {
      return { error: error instanceof DiagramError ? error.message : 'The diagram could not be drawn.' }
    }
  }, [spec])

  if ('error' in result) {
    return streaming ? (
      <div className="plot-pending" role="status">
        <Loader2 size={16} className="spin" aria-hidden="true" />
        <span>Drawing the diagram</span>
      </div>
    ) : (
      <div className="plot-error" role="status">
        <TriangleAlert size={14} aria-hidden="true" />
        <span>{result.error}</span>
      </div>
    )
  }

  const { diagram } = result
  // Steps are the list itself; cycles and hubs list only when there is detail to add.
  const details =
    diagram.type === 'hub'
      ? diagram.nodes.slice(1).filter((node) => node.detail)
      : diagram.type === 'steps' || diagram.nodes.some((node) => node.detail)
        ? diagram.nodes
        : []

  return (
    <figure className={`diagram diagram-${diagram.type}`}>
      {diagram.title && <figcaption className="plot-title">{diagram.title}</figcaption>}
      {diagram.type === 'cycle' && <Cycle {...diagram} />}
      {diagram.type === 'hub' && <Hub {...diagram} />}
      {details.length > 0 && (
      <ol className="diagram-list">
        {details.map((node, i) => (
          <li key={i}>
            <span className="diagram-step">{diagram.type === 'hub' ? '' : i + 1}</span>
            <div>
              <strong>{node.label}</strong>
              {node.detail && <p>{node.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
      )}
    </figure>
  )
})

import { useEffect, useRef, useState } from 'react'
import { ChevronsUp, Gauge, Minimize2, X } from 'lucide-react'
import { formatTokens } from '../lib/context'

type ContextMeterProps = {
  used: number
  window: number
  max: number
  modelName: string
  compacting?: boolean
  onCompact: () => void
  onGrow: () => void
}

export function ContextMeter({
  used,
  window,
  max,
  modelName,
  compacting,
  onCompact,
  onGrow,
}: ContextMeterProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const percent = window > 0 ? Math.min(100, (used / window) * 100) : 0
  const nearLimit = percent >= 95
  const canGrow = window < max

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="context-meter-wrap" ref={wrapRef}>
      <button
        className={`context-meter ${nearLimit ? 'is-near' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Context window"
      >
        <span className="context-meter-track" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </span>
        <span className="context-meter-label">
          {formatTokens(used)} / {formatTokens(window)}
        </span>
      </button>

      {open && (
        <div className="context-popover" role="dialog" aria-label="Context window">
          <div className="context-popover-head">
            <div>
              <span className="eyebrow">CONTEXT WINDOW</span>
              <strong>{modelName}</strong>
            </div>
            <button
              className="icon-button"
              onClick={() => setOpen(false)}
              aria-label="Close context window"
            >
              <X size={13} />
            </button>
          </div>

          <div className="context-big">
            <strong>{formatTokens(used)}</strong>
            <span>of {formatTokens(window)} tokens</span>
            <em className={nearLimit ? 'is-near' : ''}>{percent.toFixed(0)}%</em>
          </div>

          <div className={`context-bar ${nearLimit ? 'is-near' : ''}`} aria-hidden="true">
            <span style={{ width: `${percent}%` }} />
          </div>

          <p className="context-help">
            Starts at 2K and doubles (4K, 8K, 16K…) up to this model&apos;s{' '}
            {formatTokens(max)} maximum. Compacts automatically at 95%.
          </p>

          <div className="context-stats">
            <span>
              <Gauge size={11} /> {formatTokens(Math.max(0, window - used))} free
            </span>
            <span>
              <Minimize2 size={11} /> /compact
            </span>
          </div>

          <div className="context-actions">
            <button onClick={onGrow} disabled={!canGrow}>
              <ChevronsUp size={13} />
              {canGrow ? `Grow to ${formatTokens(Math.min(window * 2, max))}` : 'At model max'}
            </button>
            <button onClick={onCompact} disabled={used < 64 || compacting}>
              <Minimize2 size={13} />
              {compacting ? 'Compacting…' : 'Compact now'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

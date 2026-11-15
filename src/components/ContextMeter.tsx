import { useEffect, useRef, useState } from 'react'
import { Gauge, Minimize2, X } from 'lucide-react'
import { formatTokens } from '../lib/context'

type ContextMeterProps = {
  used: number
  limit: number
  modelName: string
  compacting?: boolean
  onCompact: () => void
}

export function ContextMeter({
  used,
  limit,
  modelName,
  compacting,
  onCompact,
}: ContextMeterProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const nearLimit = percent >= 95

  /** Closing from the keyboard hands focus back to the button that opened it. */
  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
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
        ref={triggerRef}
        type="button"
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
          {formatTokens(used)} / {formatTokens(limit)}
        </span>
      </button>

      {open && (
        <div className="context-popover" role="dialog" aria-label="Context window">
          <div className="context-popover-head">
            <div>
              <span className="eyebrow">Context window</span>
              <strong>{modelName}</strong>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={close}
              aria-label="Close context window"
            >
              <X size={13} />
            </button>
          </div>

          <div className="context-big">
            <strong>{formatTokens(used)}</strong>
            <span>of {formatTokens(limit)} tokens</span>
            <em className={nearLimit ? 'is-near' : ''}>{percent.toFixed(0)}%</em>
          </div>

          <div className={`context-bar ${nearLimit ? 'is-near' : ''}`} aria-hidden="true">
            <span style={{ width: `${percent}%` }} />
          </div>

          <p className="context-help">
            How much of this conversation Mint can send with each question. Older turns are
            summarised automatically at 95%.
          </p>

          <div className="context-stats">
            <span>
              <Gauge size={11} /> {formatTokens(Math.max(0, limit - used))} free
            </span>
            <span>
              <Minimize2 size={11} /> /compact
            </span>
          </div>

          <div className="context-actions">
            <button
              type="button"
              onClick={onCompact}
              disabled={used < 64 || compacting}
            >
              <Minimize2 size={13} />
              {compacting ? 'Compacting…' : 'Compact now'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

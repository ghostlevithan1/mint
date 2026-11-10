import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Eye } from 'lucide-react'
import { MODEL_TYPES, MODELS, modelsByType, typeInfo } from '../lib/data'
import type { Model } from '../lib/data'

type ModelMenuProps = {
  model: Model
  onSelect: (id: string) => void
}

export function ModelMenu({ model, onSelect }: ModelMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const currentType = typeInfo(model.type)

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
    <div className="model-menu-wrap" ref={wrapRef}>
      <button
        className="model-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="model-glyph" style={{ color: model.color }}>
          {model.glyph}
        </span>
        <span className="model-trigger-name">{model.name}</span>
        <span
          className="model-type-chip"
          style={{
            color: currentType.color,
            borderColor: `${currentType.color}55`,
            background: `${currentType.color}14`,
          }}
        >
          {currentType.label}
        </span>
        <ChevronDown size={13} className={open ? 'is-open' : ''} />
      </button>

      {open && (
        <div className="model-popover" role="listbox" aria-label="Choose a model">
          <div className="model-popover-head">
            <span>MODEL TYPE</span>
            <span>
              {MODELS.length} models · {MODEL_TYPES.length} tiers
            </span>
          </div>

          <div className="model-groups">
            {MODEL_TYPES.map((type) => {
              const items = modelsByType(type.id)
              if (!items.length) return null
              return (
                <section className="model-group" key={type.id}>
                  <div className="model-group-head">
                    <span className="model-group-dot" style={{ background: type.color }} />
                    <strong style={{ color: type.color }}>{type.label}</strong>
                    <em>{type.detail}</em>
                    <span className="model-group-count">{items.length}</span>
                  </div>

                  {items.map((item) => {
                    const selected = item.id === model.id
                    return (
                      <button
                        key={item.id}
                        role="option"
                        aria-selected={selected}
                        className={`model-choice ${selected ? 'is-selected' : ''}`}
                        onClick={() => {
                          onSelect(item.id)
                          setOpen(false)
                        }}
                      >
                        <span className="model-choice-glyph" style={{ color: item.color }}>
                          {item.glyph}
                        </span>
                        <span className="model-choice-copy">
                          <span>
                            <strong>{item.name}</strong>
                            {item.capabilities?.includes('image') && (
                              <span className="model-cap-badge">
                                <Eye size={9} />
                                Vision
                              </span>
                            )}
                            <small>{item.maker}</small>
                          </span>
                          <em>
                            {item.meta} · {item.descriptor} · {item.context} context
                          </em>
                        </span>
                        <span className="model-choice-speed">
                          {item.tps}
                          <small>TPS</small>
                        </span>
                        <span className="model-choice-check">{selected && <Check size={14} />}</span>
                      </button>
                    )
                  })}
                </section>
              )
            })}
          </div>

          <p className="model-popover-note">
            Model type sets the reasoning depth. Applies to your next message — switch any time.
          </p>
        </div>
      )}
    </div>
  )
}

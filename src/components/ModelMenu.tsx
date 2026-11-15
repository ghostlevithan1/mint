import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { MODEL_TYPES, MODELS, modelsByType, typeInfo } from '../lib/data'
import type { Model } from '../lib/data'
import { ModelCapabilityBadges, ModelLogo } from './ModelLogo'

type ModelMenuProps = {
  model: Model
  onSelect: (id: string) => void
}

export function ModelMenu({ model, onSelect }: ModelMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const currentType = typeInfo(model.type)

  const choices = () =>
    [...(popoverRef.current?.querySelectorAll<HTMLButtonElement>('.model-choice') ?? [])]

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Opening moves focus onto the current model, so the keyboard lands in the list.
  useEffect(() => {
    if (!open) return
    const list = choices()
    ;(list.find((item) => item.classList.contains('is-selected')) ?? list[0])?.focus()
  }, [open])

  /** Arrow keys, Home and End walk the models; Tab still leaves the menu. */
  const onListKey = (event: ReactKeyboardEvent) => {
    const list = choices()
    if (!list.length) return
    const index = list.indexOf(document.activeElement as HTMLButtonElement)
    let next = -1
    if (event.key === 'ArrowDown') next = (index + 1) % list.length
    else if (event.key === 'ArrowUp') next = (index - 1 + list.length) % list.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = list.length - 1
    if (next < 0) return
    event.preventDefault()
    list[next].focus()
  }

  return (
    <div className="model-menu-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="model-trigger"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="model-glyph">
          <ModelLogo maker={model.maker} size={15} />
        </span>
        <span className="model-trigger-name">{model.name}</span>
        <span
          className="model-type-chip"
          style={{ color: currentType.color }}
        >
          {currentType.label}
        </span>
        <ChevronDown size={13} className={open ? 'is-open' : ''} />
      </button>

      {open && (
        <div
          className="model-popover"
          role="dialog"
          aria-label="Choose a model"
          ref={popoverRef}
          onKeyDown={onListKey}
        >
          <div className="model-popover-head">
            <span>Model type</span>
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
                        type="button"
                        aria-current={selected ? 'true' : undefined}
                        className={`model-choice ${selected ? 'is-selected' : ''}`}
                        onClick={() => {
                          onSelect(item.id)
                          setOpen(false)
                          triggerRef.current?.focus()
                        }}
                      >
                        <span className="model-choice-glyph">
                          <ModelLogo maker={item.maker} size={17} />
                        </span>
                        <span className="model-choice-copy">
                          <span>
                            <strong>{item.name}</strong>
                            <small>{item.maker}</small>
                          </span>
                          <em className="model-choice-best">{item.bestAt}</em>
                          <span className="model-choice-tags">
                            <ModelCapabilityBadges model={item} />
                            <small>
                              {item.meta} · {item.context} context
                            </small>
                          </span>
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

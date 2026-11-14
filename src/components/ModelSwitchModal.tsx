import { useEffect, useRef } from 'react'
import { ArrowRight, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import { MODEL_TYPES, typeInfo, type Model } from '../lib/data'
import type { AttachmentNeed } from '../lib/modelRouting'
import { ModelCapabilityBadges, ModelLogo } from './ModelLogo'

type ModelSwitchModalProps = {
  open: boolean
  need: AttachmentNeed
  current: Model
  alternatives: Model[]
  fileCount: number
  onClose: () => void
  onChoose: (model: Model) => void
}

export function ModelSwitchModal({
  open,
  need,
  current,
  alternatives,
  fileCount,
  onClose,
  onChoose,
}: ModelSwitchModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('modal-open')
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('modal-open')
    }
  }, [open, onClose])

  if (!open || !alternatives.length) return null

  const groups = MODEL_TYPES.map((type) => ({
    type,
    items: alternatives.filter((model) => model.type === type.id),
  })).filter((group) => group.items.length)

  const fileNoun = need === 'image'
    ? fileCount === 1
      ? 'image'
      : 'images'
    : fileCount === 1
      ? 'file'
      : 'files'

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="model-switch-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-switch-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <button
          type="button"
          className="icon-button modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={15} />
        </button>

        <div className="switch-head">
          <span className="switch-icon" aria-hidden="true">
            <TriangleAlert size={17} />
          </span>
          <div>
            <p className="switch-kicker">Model switch needed</p>
            <h2 id="model-switch-title">
              This {need === 'image' ? 'image' : 'file'} needs a model that can read it
            </h2>
          </div>
        </div>

        <p className="switch-copy">
          <strong>{typeInfo(current.type).label}</strong> has no{' '}
          {need === 'image' ? 'vision' : 'compatible'} model, so it cannot read your{' '}
          {fileNoun}. Switch to one of these — your {fileNoun}{' '}
          {fileCount === 1 ? 'stays' : 'stay'} attached.
        </p>

        <div className="switch-options">
          {groups.map((group) => (
            <section className="switch-group" key={group.type.id}>
              <div className="switch-group-head">
                <span className="model-group-dot" style={{ background: group.type.color }} />
                <strong style={{ color: group.type.color }}>{group.type.label}</strong>
                <em>{group.type.tagline}</em>
              </div>
              {group.items.map((model) => (
                <button
                  type="button"
                  className="switch-option"
                  key={model.id}
                  onClick={() => onChoose(model)}
                >
                  <span className="model-choice-glyph">
                    <ModelLogo maker={model.maker} size={17} />
                  </span>
                  <span className="switch-option-copy">
                    <span>
                      <strong>{model.name}</strong>
                    </span>
                    <em>
                      {model.maker} · {model.bestAt}
                    </em>
                    <ModelCapabilityBadges model={model} />
                  </span>
                  <span className="switch-option-cta">
                    Switch
                    <ArrowRight size={12} />
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>

        <p className="switch-foot">
          <ShieldCheck size={11} />
          Model type is preserved when possible; this switch only changes what can read the{' '}
          {fileNoun}.
        </p>
      </div>
    </div>
  )
}

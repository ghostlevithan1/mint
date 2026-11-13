import { useEffect, useState } from 'react'
import { Check, Copy, LockKeyhole, Mail, Phone, RotateCcw, ShieldCheck, UserRound, X } from 'lucide-react'
import type { Redaction } from '../lib/data'

type PayloadModalProps = {
  open: boolean
  onClose: () => void
  redactedPrompt: string
  redactions: Redaction[]
  fileNames: string[]
  shieldOn: boolean
}

function KindIcon({ kind }: { kind: Redaction['kind'] }) {
  if (kind === 'email') return <Mail size={14} />
  if (kind === 'phone') return <Phone size={14} />
  return <UserRound size={14} />
}

export function PayloadModal({
  open,
  onClose,
  redactedPrompt,
  redactions,
  fileNames,
  shieldOn,
}: PayloadModalProps) {
  const [copied, setCopied] = useState(false)
  const [showOriginals, setShowOriginals] = useState(true)

  useEffect(() => {
    if (!open) {
      setCopied(false)
      setShowOriginals(true)
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('modal-open')
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('modal-open')
    }
  }, [open, onClose])

  if (!open) return null

  const payload = `${redactedPrompt || '[No prompt text]'}${
    fileNames.length
      ? `\n\n--- ATTACHMENTS (processed on device) ---\n${fileNames.map((name) => `• ${name}`).join('\n')}`
      : ''
  }`

  const copyPayload = async () => {
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="payload-modal" role="dialog" aria-modal="true" aria-labelledby="payload-title">
        <div className="payload-header">
          <div>
            <span className="eyebrow">PII shield / audit view</span>
            <h2 id="payload-title">See exactly what leaves.</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close audit view">
            <X size={19} />
          </button>
        </div>

        <div className="payload-status">
          <div className="payload-status-icon">
            <ShieldCheck size={22} />
          </div>
          <div>
            <strong>{shieldOn ? 'Shield is active' : 'Shield is off'}</strong>
            <span>
              {shieldOn
                ? `${redactions.length} identifier${redactions.length === 1 ? '' : 's'} will be replaced before the request leaves this tab.`
                : 'Your prompt will be sent without redaction. Names can identify you.'}
            </span>
          </div>
          <div className="payload-status-code">{shieldOn ? 'On' : 'Off'}</div>
        </div>

        <div className="payload-grid">
          <div className="payload-pane">
            <div className="pane-top">
              <span>Request preview</span>
              <button type="button" className="subtle-button" onClick={copyPayload}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="payload-code">
              <span className="code-label">Prompt</span>
              <pre>{payload}</pre>
            </div>
            <div className="payload-footnote">
              <LockKeyhole size={13} />
              File contents are read on this device. Only the placeholder text above is routed to
              the model.
            </div>
          </div>

          <div className="substitution-pane">
            <div className="pane-top">
              <span>Substitutions</span>
              <button
                type="button"
                className="subtle-button"
                onClick={() => setShowOriginals((value) => !value)}
                aria-pressed={showOriginals}
              >
                <RotateCcw size={13} /> {showOriginals ? 'Hide originals' : 'Show originals'}
              </button>
            </div>
            {redactions.length === 0 ? (
              <div className="empty-shield">
                <ShieldCheck size={24} />
                <strong>Nothing detected</strong>
                <p>No names, emails, or phone numbers were found in the current context.</p>
              </div>
            ) : (
              <div className="substitution-list">
                {redactions.map((item) => (
                  <div className="substitution-row" key={`${item.kind}-${item.original}`}>
                    <span className={`substitution-icon ${item.kind}`}>
                      <KindIcon kind={item.kind} />
                    </span>
                    <span className="substitution-original">
                      {showOriginals ? item.original : '••••••••'}
                      <small>{item.kind}</small>
                    </span>
                    <span className="substitution-arrow">→</span>
                    <code>{item.placeholder}</code>
                  </div>
                ))}
              </div>
            )}
            <div className="substitution-summary">
              <div>
                <span>Names</span>
                <strong>{redactions.filter((item) => item.kind === 'name').length}</strong>
              </div>
              <div>
                <span>Emails</span>
                <strong>{redactions.filter((item) => item.kind === 'email').length}</strong>
              </div>
              <div>
                <span>Phones</span>
                <strong>{redactions.filter((item) => item.kind === 'phone').length}</strong>
              </div>
            </div>
            <p className="rehydrate-note">
              When the answer comes back, placeholders are restored to the original names inside
              this browser. Chat history is saved in this browser only — never on the server.
            </p>
          </div>
        </div>

        <div className="payload-footer">
          <span>
            <span className="status-dot" /> Local scan · 0 names in transit
          </span>
          <button type="button" className="button button-primary compact-button" onClick={onClose}>
            Close audit view
          </button>
        </div>
      </div>
    </div>
  )
}

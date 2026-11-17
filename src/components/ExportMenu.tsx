import { useEffect, useRef, useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { MODELS } from '../lib/data'
import type { Conversation } from '../lib/chat'
import { downloadChatMarkdown, downloadChatPdf, hasUnprintableText } from '../lib/exportChat'

const modelName = (id?: string) => MODELS.find((model) => model.id === id)?.name ?? 'Mint'

/** Top-bar menu that saves the open chat as Markdown or PDF. */
export function ExportMenu({ chat, disabled }: { chat: Conversation; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

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

  const unprintable = chat.messages.some((message) => hasUnprintableText(message.content)) || hasUnprintableText(chat.title)

  const choose = (save: () => void) => {
    save()
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div className="export-menu-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Save this chat"
        title={disabled ? 'Available when the answer is finished' : 'Save this chat'}
      >
        <Download size={17} />
      </button>
      {open && (
        <div className="export-popover" role="menu" aria-label="Save this chat">
          <button type="button" role="menuitem" autoFocus onClick={() => choose(() => downloadChatPdf(chat, modelName))}>
            <FileText size={14} />
            <span>
              <strong>PDF</strong>
              <small>{unprintable ? 'Letters outside Latin print as ?' : 'Ready to print or share'}</small>
            </span>
          </button>
          <button type="button" role="menuitem" onClick={() => choose(() => downloadChatMarkdown(chat, modelName))}>
            <FileText size={14} />
            <span>
              <strong>Markdown</strong>
              <small>Plain text you can edit</small>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef } from 'react'
import type { ChangeEvent, MutableRefObject } from 'react'
import {
  ArrowUp,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  ArrowLeftRight,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react'
import { attachmentTokens, estimateTextTokens } from '../lib/context'
import { formatBytes, type Attachment } from '../lib/files'

type ComposerProps = {
  text: string
  onTextChange: (value: string) => void
  attachments: Attachment[]
  uploadError: string
  reading: boolean
  isGenerating: boolean
  routingWarning: string
  routeNotice: string
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  onFixRouting: () => void
  onDismissRouteNotice: () => void
  onAttachFiles: (files: FileList | File[]) => void
  onRemoveFile: (id: string) => void
  onSend: () => void
  onStop: () => void
}

function FileGlyph({ kind }: { kind: Attachment['kind'] }) {
  if (kind === 'image') return <ImageIcon size={13} />
  if (kind === 'sheet') return <FileSpreadsheet size={13} />
  if (kind === 'code') return <FileCode2 size={13} />
  return <FileText size={13} />
}

export function Composer({
  text,
  onTextChange,
  attachments,
  uploadError,
  reading,
  isGenerating,
  routingWarning,
  routeNotice,
  textareaRef,
  onFixRouting,
  onDismissRouteNotice,
  onAttachFiles,
  onRemoveFile,
  onSend,
  onStop,
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tokens =
    estimateTextTokens(text) +
    attachments.reduce((sum, file) => sum + attachmentTokens(file), 0)
  const unreadableImages = attachments.filter(
    (file) => file.kind === 'image' && !file.dataUrl,
  )
  const imageWarning = unreadableImages.length
    ? unreadableImages
        .map(
          (file) =>
            `${file.name}: ${file.imageError ?? 'This image could not be prepared for sending on this device.'}`,
        )
        .join(' ')
    : ''
  const composerError = [uploadError, imageWarning].filter(Boolean).join(' ')
  const canSend =
    (text.trim().length > 0 || attachments.length > 0) &&
    !reading &&
    !isGenerating &&
    !routingWarning &&
    !unreadableImages.length

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(200, Math.max(28, el.scrollHeight))}px`
  }, [text, textareaRef])

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) onAttachFiles(event.target.files)
    event.target.value = ''
  }

  const submit = () => {
    if (!canSend) return
    onSend()
  }

  return (
    <div className="composer-wrap">
      <div className={`composer ${isGenerating ? 'is-busy' : ''}`}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={handleFileInput}
          disabled={isGenerating}
        />

        {attachments.length > 0 && (
          <div className="composer-files">
            {attachments.map((file) => (
              <span
                className={`composer-file${file.kind === 'image' && !file.dataUrl ? ' is-error' : ''}`}
                key={file.id}
                title={file.imageError}
              >
                <span className={`composer-file-glyph ${file.kind}`}>
                  <FileGlyph kind={file.kind} />
                </span>
                <span className="composer-file-copy">
                  <strong>{file.name}</strong>
                  <small>
                    {formatBytes(file.size)} ·{' '}
                    {file.kind === 'image'
                      ? file.dataUrl
                        ? 'vision ready'
                        : 'not sendable'
                      : file.text
                        ? 'read locally'
                        : 'held locally'}
                  </small>
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveFile(file.id)}
                  aria-label={`Remove ${file.name}`}
                  disabled={isGenerating}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {composerError && (
          <p className="composer-error" role="alert">
            {composerError}
          </p>
        )}

        {routingWarning && (
          <div className="composer-routing" role="alert">
            <TriangleAlert size={13} />
            <span>{routingWarning}</span>
            <button type="button" onClick={onFixRouting}>
              Switch model
            </button>
          </div>
        )}

        {routeNotice && (
          <div className="composer-route-note" role="status">
            <ArrowLeftRight size={12} />
            <span>{routeNotice}</span>
            <button
              type="button"
              onClick={onDismissRouteNotice}
              aria-label="Dismiss model switch notice"
            >
              <X size={11} />
            </button>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          onPaste={(event) => {
            if (isGenerating || reading) return
            const files = Array.from(event.clipboardData?.files ?? [])
            if (!files.length) return
            // Pasted screenshots and copied files attach instead of turning
            // into unusable text.
            event.preventDefault()
            onAttachFiles(files)
          }}
          placeholder="Message Mint…"
          aria-label="Message"
          rows={1}
          maxLength={8000}
          spellCheck
        />

        <div className="composer-toolbar">
          <div className="composer-tools">
            <button
              type="button"
              className="composer-tool"
              onClick={() => fileInputRef.current?.click()}
              disabled={isGenerating || reading}
              aria-label="Attach files, up to 25 megabytes each"
              title="Attach files"
            >
              {reading ? <Loader2 size={15} className="spin" /> : <Paperclip size={15} />}
            </button>
          </div>

          <div className="composer-submit-group">
            {tokens > 0 && (
              <span className="composer-tokens">{tokens.toLocaleString()} tokens</span>
            )}
            {text.length > 7000 && <span className="composer-chars">{text.length}/8,000</span>}
            {isGenerating ? (
              <button type="button" className="send-button stop" onClick={onStop} aria-label="Stop generating">
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className="send-button"
                onClick={submit}
                disabled={!canSend}
                aria-label="Send message"
              >
                <ArrowUp size={17} />
              </button>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}

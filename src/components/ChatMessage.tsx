import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Gauge,
  Image as ImageIcon,
  RefreshCw,
  ShieldCheck,
  Timer,
  Zap,
} from 'lucide-react'
import { typeInfo, type Model } from '../lib/data'
import type { ChatMessage } from '../lib/chat'
import type { Attachment } from '../lib/files'
import { formatBytes } from '../lib/privacy'
import { Markdown } from './Markdown'

type ChatMessageProps = {
  message: ChatMessage
  model?: Model
  showMetrics: boolean
  isGenerating: boolean
  canInspect: boolean
  onRegenerate: (id: string) => void
  onInspect: () => void
}

function AttachmentGlyph({ kind }: { kind: Attachment['kind'] }) {
  if (kind === 'image') return <ImageIcon size={14} />
  if (kind === 'sheet') return <FileSpreadsheet size={14} />
  if (kind === 'code') return <FileCode2 size={14} />
  return <FileText size={14} />
}

function AttachmentChips({ files }: { files: Attachment[] }) {
  return (
    <div className="message-files">
      {files.map((file) => (
        <span className="message-file" key={file.id}>
          <AttachmentGlyph kind={file.kind} />
          <span>{file.name}</span>
          <small>{formatBytes(file.size)}</small>
        </span>
      ))}
    </div>
  )
}

const PHASE_COPY = {
  shielding: {
    title: 'Shielding the request',
    detail: 'Names and contact details are being replaced with local placeholders.',
  },
  routing: {
    title: 'Routing the request',
    detail: 'Opening a private path to the selected model.',
  },
}

export function ChatMessageView({
  message,
  model,
  showMetrics,
  isGenerating,
  canInspect,
  onRegenerate,
  onInspect,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false)

  if (message.role === 'user') {
    const hasText = message.content.trim().length > 0
    return (
      <article className="msg msg-user">
        <div className="user-bubble">
          {message.attachments && message.attachments.length > 0 && (
            <AttachmentChips files={message.attachments} />
          )}
          {hasText ? (
            <p className="user-text">{message.content}</p>
          ) : (
            <p className="user-text user-text-muted">
              Shared {message.attachments?.length ?? 0} file
              {(message.attachments?.length ?? 0) === 1 ? '' : 's'}
            </p>
          )}
        </div>
        {message.shieldOn && (message.redactionCount ?? 0) > 0 && (
          <span className="user-shield-note">
            <ShieldCheck size={12} />
            {message.redactionCount} identifier{message.redactionCount === 1 ? '' : 's'} shielded
            locally
          </span>
        )}
        {!message.shieldOn && (
          <span className="user-shield-note off">
            <ShieldCheck size={12} /> Shield was off for this message
          </span>
        )}
      </article>
    )
  }

  const copyAnswer = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  const exportAnswer = () => {
    const blob = new Blob([message.content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `mint-${model?.id ?? 'answer'}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const redactions = message.redactions ?? []
  const stats = message.stats
  const phaseCopy =
    message.phase === 'routing'
      ? {
          title: PHASE_COPY.routing.title,
          detail:
            message.provider === 'nvidia'
              ? 'Opening a server-side path to NVIDIA NIM. The API key never reaches this tab.'
              : 'Opening a private path to the local demo engine.',
        }
      : PHASE_COPY.shielding
  const waiting = message.phase === 'shielding' || message.phase === 'routing'
  const streaming = message.phase === 'generating'

  return (
    <article className="msg msg-assistant">
      <div className="assistant-rail" aria-hidden="true">
        <span className="assistant-mark">M</span>
      </div>
      <div className="assistant-body">
        <header className="assistant-head">
          <strong>Mint</strong>
          {model && (
            <>
              <span className="assistant-model">
                {model.maker} {model.name}
              </span>
              <span className="assistant-type" style={{ color: typeInfo(model.type).color }}>
                {typeInfo(model.type).label}
              </span>
            </>
          )}
          {message.provider === 'nvidia' && <span className="live-tag">LIVE</span>}
          {message.stopped && <span className="stopped-tag">STOPPED</span>}
        </header>

        {message.error && (
          <div className="message-error" role="alert">
            <AlertTriangle size={15} />
            <div>
              <strong>Request failed</strong>
              <p>{message.error}</p>
            </div>
          </div>
        )}

        {waiting && (
          <div className="thinking" role="status" aria-live="polite">
            <span className="thinking-orb">
              {message.phase === 'routing' ? <Zap size={15} /> : <ShieldCheck size={15} />}
            </span>
            <span className="thinking-copy">
              <strong>{phaseCopy.title}</strong>
              <small>{phaseCopy.detail}</small>
            </span>
            <span className="thinking-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}

        {!waiting && message.content && (
          <div className={`assistant-text ${streaming ? 'is-streaming' : ''}`}>
            <Markdown text={message.content} />
            {streaming && <span className="typing-caret" aria-hidden="true" />}
          </div>
        )}

        {!message.error && !waiting && !message.content && message.phase === 'done' && (
          <p className="assistant-empty">No response captured. Try running this prompt again.</p>
        )}

        {message.phase === 'done' && message.content && (
          <div className="message-meta">
            <span className="rehydrate-note">
              <Fingerprint size={12} />
              {message.shieldOn && redactions.length > 0
                ? `${redactions.length} identifier${redactions.length === 1 ? '' : 's'} restored locally · model saw placeholders`
                : message.shieldOn
                  ? 'No personal identifiers detected in this request'
                  : 'PII shield was off for this request'}
            </span>
            {canInspect && (
              <button className="meta-link" onClick={onInspect}>
                Inspect payload
              </button>
            )}
          </div>
        )}

        {showMetrics && stats && message.phase !== 'shielding' && message.phase !== 'routing' && (
          <div className="msg-metrics" aria-label="Generation metrics">
            <div className="metric-primary">
              <Gauge size={13} />
              <strong>{stats.tps.toFixed(1)}</strong>
              <span>TPS</span>
            </div>
            <div className="metric-cell">
              <span>
                <Timer size={11} /> TTFT
              </span>
              <strong>{Math.round(stats.ttft)}ms</strong>
            </div>
            <div className="metric-cell">
              <span>
                <Zap size={11} /> TOKENS
              </span>
              <strong>{stats.tokens}</strong>
            </div>
            <div className="metric-cell">
              <span>
                <Fingerprint size={11} /> ELAPSED
              </span>
              <strong>{stats.elapsed.toFixed(1)}s</strong>
            </div>
            <span className={`sim-tag ${message.provider === 'nvidia' ? 'is-live' : ''}`}>
              {message.provider === 'nvidia' ? 'NVIDIA NIM' : 'SIMULATED'}
            </span>
          </div>
        )}

        {message.phase === 'done' && message.error && (
          <div className="message-actions">
            <button
              onClick={() => onRegenerate(message.id)}
              disabled={isGenerating}
              aria-label="Retry this request"
            >
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        )}

        {message.phase === 'done' && !message.error && message.content && (
          <div className="message-actions">
            <button onClick={copyAnswer} aria-label="Copy answer">
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button onClick={exportAnswer} aria-label="Export answer as Markdown">
              <Download size={14} /> Export
            </button>
            <button
              onClick={() => onRegenerate(message.id)}
              disabled={isGenerating}
              aria-label="Regenerate answer"
            >
              <RefreshCw size={14} /> Regenerate
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

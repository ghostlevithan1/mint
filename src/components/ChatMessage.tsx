import { memo, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Brain,
  Check,
  Copy,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Gauge,
  Globe2,
  Image as ImageIcon,
  Layers,
  RefreshCw,
  BookOpen,
  Calculator,
  Globe,
  Timer,
  Zap,
} from 'lucide-react'
import { typeInfo, type Model } from '../lib/data'
import type { ChatMessage } from '../lib/chat'
import { formatBytes, type Attachment } from '../lib/files'
import { extractImageLinks } from '../lib/imageLinks'
import { Markdown } from './Markdown'
import { LeafMark } from './Logo'
import { ModelLogo } from './ModelLogo'
import { RemoteImage } from './RemoteImage'

type ChatMessageProps = {
  message: ChatMessage
  model?: Model
  showMetrics: boolean
  isGenerating: boolean
  onRegenerate: (id: string) => void
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
  preparing: {
    title: 'Reading your question',
    detail: 'Getting your question ready.',
  },
  routing: {
    title: 'Thinking',
    detail: 'Working out the answer.',
  },
}

/**
 * Live progress for the wait before the first token. NVIDIA Build models can
 * take tens of seconds to warm up, so the copy changes with the elapsed time
 * and always tells the user that Esc stops the wait.
 */
function WaitingProgress({
  routing,
  startedAt,
  detail,
  activity,
}: {
  routing: boolean
  startedAt: number
  detail: string
  activity?: string
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [])

  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const title = activity
    ? activity
    : routing
    ? seconds >= 20
      ? 'Still thinking'
      : 'Thinking'
    : 'Reading your question'
  const hint = activity
    ? 'Esc stops it.'
    : !routing && seconds < 4
      ? detail
      : seconds >= 30
        ? 'This model is very slow to start. Press Esc to stop, or keep waiting.'
        : seconds >= 10
          ? 'Some models take 20 to 30 seconds to start. Esc stops it.'
          : routing
            ? PHASE_COPY.routing.detail
            : detail

  return (
    <div className="thinking" role="status" aria-live="polite">
      <span className="thinking-orb">
        {activity ? (activity.startsWith('Calculating') ? <Calculator size={15} /> : <Globe size={15} />) : routing ? <Zap size={15} /> : <BookOpen size={15} />}
      </span>
      <span className="thinking-copy">
        <strong>
          {title}
          <span className="thinking-elapsed"> · {seconds}s</span>
        </strong>
        <small>{hint}</small>
      </span>
      <span className="thinking-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}

function ReasoningPanel({ text, live }: { text: string; live: boolean }) {
  if (live) {
    return (
      <div className="reasoning-live" role="status" aria-live="polite">
        <div className="reasoning-head">
          <Brain size={12} />
          <span>Thinking out loud</span>
        </div>
        <div className="reasoning-text">{text}</div>
      </div>
    )
  }

  return (
    <details className="reasoning-block">
      <summary>
        <Brain size={12} />
        <span>Model reasoning</span>
        <small>{text.length.toLocaleString()} chars</small>
      </summary>
      <div className="reasoning-text">{text}</div>
    </details>
  )
}

export const ChatMessageView = memo(
  function ChatMessageView({
  message,
  model,
  showMetrics,
  isGenerating,
  onRegenerate,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false)

  if (message.role === 'system') {
    // While /compact runs, the streamed summary is shown live instead of the
    // usual collapsed note.
    if (message.phase === 'generating') {
      return (
        <article className="msg msg-system is-compacting">
          <div className="compacting-note" role="status" aria-live="polite">
            <span className="compacting-head">
              <Layers size={13} />
              <strong>Compacting this thread…</strong>
              <span className="thinking-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </span>
            {message.content && <pre className="compacting-live">{message.content}</pre>}
          </div>
        </article>
      )
    }
    return (
      <article className="msg msg-system">
        <details className="context-note">
          <summary>
            <Layers size={13} />
            <span>Context compacted</span>
            <small>Earlier turns were summarised to save room.</small>
          </summary>
          <pre>{message.content}</pre>
        </details>
      </article>
    )
  }

  if (message.role === 'user') {
    const hasText = message.content.trim().length > 0
    const imageLinks = extractImageLinks(message.content)
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
          {imageLinks.map((image) => (
            <RemoteImage key={image.url} url={image.url} alt={image.alt} />
          ))}
        </div>
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
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  const stats = message.stats
  const waiting = message.phase === 'preparing' || message.phase === 'routing'
  const streaming = message.phase === 'generating'

  return (
    <article className="msg msg-assistant">
      <div className="assistant-rail" aria-hidden="true">
        <span className="assistant-mark">
          <LeafMark size={16} />
        </span>
      </div>
      <div className="assistant-body">
        <header className="assistant-head">
          <strong>Mint</strong>
          {model && (
            <>
              <span className="assistant-model">
                <ModelLogo maker={model.maker} size={11} />
                {model.name}
              </span>
              <span className="assistant-type" style={{ color: typeInfo(model.type).color }}>
                {typeInfo(model.type).label}
              </span>
            </>
          )}
          {message.provider === 'nvidia' && <span className="live-tag">Live</span>}
          {message.fallbackFrom && (
            <span
              className="fallback-tag"
              title="The selected model was unavailable upstream, so the default model answered."
            >
              Fallback model
            </span>
          )}
          {message.stopped && <span className="stopped-tag">Stopped</span>}
        </header>

        {(message.webQuery !== undefined ||
          (message.webSources && message.webSources.length > 0)) && (
          <div className="web-sources">
            {message.webQuery ? (
              <span className="web-sources-label">
                <Globe2 size={11} />
                Searched the web
                {message.webSources && message.webSources.length > 0
                  ? ` · ${message.webSources.length} source${message.webSources.length === 1 ? '' : 's'}`
                  : ''}
              </span>
            ) : (
              <span className="web-sources-label">
                <Globe2 size={11} />
                Read {message.webSources?.length === 1 ? '1 link' : `${message.webSources?.length ?? 0} links`}
              </span>
            )}
            {message.webSources?.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
                title={source.url}
              >
                {source.title}
              </a>
            ))}
            {message.webError && <small className="web-sources-error">{message.webError}</small>}
          </div>
        )}

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
          <WaitingProgress
            routing={message.phase === 'routing'}
            startedAt={message.createdAt}
            activity={message.activity}
            detail={
              message.phase === 'routing' ? PHASE_COPY.routing.detail : PHASE_COPY.preparing.detail
            }
          />
        )}

        {message.reasoning && (
          <ReasoningPanel text={message.reasoning} live={streaming && !message.content} />
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

        {showMetrics && stats && message.phase !== 'preparing' && message.phase !== 'routing' && (
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
                <Zap size={11} /> Tokens
              </span>
              <strong>{stats.tokens}</strong>
            </div>
            <div className="metric-cell">
              <span>
                <Fingerprint size={11} /> Elapsed
              </span>
              <strong>{stats.elapsed.toFixed(1)}s</strong>
            </div>
            <span className={`sim-tag ${message.provider === 'nvidia' ? 'is-live' : ''}`}>
              {message.provider === 'nvidia' ? 'NVIDIA NIM' : 'Simulated'}
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
}, areMessagePropsEqual)

/**
 * Event handlers are recreated on every parent render but behave identically,
 * so they are excluded from the comparison. During a stream this keeps every
 * finished message from re-rendering on each token flush.
 */
function areMessagePropsEqual(
  previous: ChatMessageProps,
  next: ChatMessageProps,
): boolean {
  return (
    previous.message === next.message &&
    previous.model === next.model &&
    previous.showMetrics === next.showMetrics &&
    previous.isGenerating === next.isGenerating
  )
}

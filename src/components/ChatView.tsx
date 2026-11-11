import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import {
  ChevronDown,
  Code2,
  FileText,
  Mail,
  Minimize2,
  PanelLeft,
  Scale,
  Settings,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react'
import { MODELS, MAX_FILES, SAMPLE_PROMPTS, typeInfo, type Model } from '../lib/data'
import { modelById, type Conversation } from '../lib/chat'
import type { ProviderStatus } from '../lib/provider'
import type { Attachment } from '../lib/files'
import {
  capabilityLabel,
  compatibleModels,
  modelSupportsAttachments,
  needForAttachments,
  routeWithinTier,
  type AttachmentNeed,
} from '../lib/modelRouting'
import { useAttachments } from '../hooks/useAttachments'
import { ChatMessageView } from './ChatMessage'
import { Composer } from './Composer'
import { ContextMeter } from './ContextMeter'
import { ModelMenu } from './ModelMenu'
import { ModelSwitchModal } from './ModelSwitchModal'

type ChatViewProps = {
  chat: Conversation
  model: Model
  provider: ProviderStatus
  shieldOn: boolean
  showMetrics: boolean
  isGenerating: boolean
  contextUsed: number
  contextWindow: number
  contextMax: number
  onCompact: () => void
  onGrowContext: () => void
  onSelectModel: (id: string) => void
  onToggleShield: () => void
  onSend: (text: string, attachments: Attachment[]) => void
  onStop: () => void
  onRegenerate: (assistantId: string) => void
  onInspectMessage: (assistantId: string) => void
  onOpenSettings: (tab: 'general' | 'privacy' | 'about') => void
  onOpenSidebar: () => void
}

const SUGGESTIONS = [
  {
    icon: FileText,
    title: 'Summarize a document',
    copy: 'Decisions, risks, and open questions.',
    prompt: SAMPLE_PROMPTS[0],
  },
  {
    icon: Scale,
    title: 'Review a contract',
    copy: 'Spot unusual terms before signing.',
    prompt: SAMPLE_PROMPTS[1],
  },
  {
    icon: Mail,
    title: 'Draft a reply',
    copy: 'Turn context into a clear email.',
    prompt: SAMPLE_PROMPTS[2],
  },
  {
    icon: Code2,
    title: 'Audit some code',
    copy: 'Surface bugs and cleanup work.',
    prompt: 'Review this TypeScript module for correctness, edge cases, and cleanup opportunities.',
  },
]

export function ChatView({
  chat,
  model,
  provider,
  shieldOn,
  showMetrics,
  isGenerating,
  contextUsed,
  contextWindow,
  contextMax,
  onCompact,
  onGrowContext,
  onSelectModel,
  onToggleShield,
  onSend,
  onStop,
  onRegenerate,
  onInspectMessage,
  onOpenSettings,
  onOpenSidebar,
}: ChatViewProps) {
  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState(false)
  const [switchOpen, setSwitchOpen] = useState(false)
  const [routeNotice, setRouteNotice] = useState<{ model: Model; need: AttachmentNeed } | null>(
    null,
  )
  const dragDepth = useRef(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)
  const { attachments, error, reading, addFiles, removeFile, clear } = useAttachments()

  const attachmentNeed = needForAttachments(attachments)
  const attachmentBlocked =
    attachments.length > 0 && !modelSupportsAttachments(model, attachments)
  const alternatives = attachmentBlocked
    ? compatibleModels(attachments).filter((item) => item.id !== model.id)
    : []

  useEffect(() => {
    setDraft('')
    setSwitchOpen(false)
    setRouteNotice(null)
    clear()
    // Reset the composer when moving to another conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id])

  useEffect(() => {
    if (!attachmentBlocked) setSwitchOpen(false)
  }, [attachmentBlocked])

  const signature = chat.messages
    .map((message) => `${message.id}:${message.content.length}:${message.phase}`)
    .join('|')

  useEffect(() => {
    if (!stickRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [signature])

  const useSuggestion = (prompt: string) => {
    setDraft(prompt)
    textareaRef.current?.focus()
  }

  const submit = () => {
    if (isGenerating || reading) return
    if (draft.trim().toLowerCase() === '/compact') {
      onCompact()
      setDraft('')
      textareaRef.current?.focus()
      return
    }
    if (!draft.trim() && !attachments.length) return
    if (attachments.length && !modelSupportsAttachments(model, attachments)) {
      setSwitchOpen(true)
      return
    }
    stickRef.current = true
    onSend(draft, attachments)
    setDraft('')
    setRouteNotice(null)
    clear()
    textareaRef.current?.focus()
  }

  const handleFiles = async (files: FileList | File[]) => {
    const loaded = await addFiles(files)
    if (!loaded.length) return

    const next = [...attachments, ...loaded].slice(0, MAX_FILES)
    const route = routeWithinTier(model, next)

    if (route.status === 'switched') {
      onSelectModel(route.model.id)
      setRouteNotice({ model: route.model, need: route.need })
      setSwitchOpen(false)
    } else if (route.status === 'blocked') {
      setRouteNotice(null)
      setSwitchOpen(true)
    } else {
      setRouteNotice(null)
    }
  }

  const handleRemoveFile = (id: string) => {
    removeFile(id)
    setRouteNotice(null)
  }

  const chooseSwitch = (next: Model) => {
    onSelectModel(next.id)
    setSwitchOpen(false)
    setRouteNotice({ model: next, need: attachmentNeed })
  }

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (event.dataTransfer.files.length) {
      void handleFiles(event.dataTransfer.files)
      textareaRef.current?.focus()
    }
  }

  const isEmpty = chat.messages.length === 0
  const routeNoticeText = routeNotice
    ? `Switched to ${routeNotice.model.name} (${typeInfo(routeNotice.model.type).label}) so the AI can read your ${capabilityLabel(routeNotice.need)}.`
    : ''
  const routingWarning = attachmentBlocked
    ? `${typeInfo(model.type).label} has no model that can read ${capabilityLabel(attachmentNeed)}. Switch before sending so the AI can read your ${attachments.length === 1 ? 'file' : 'files'}.`
    : ''

  return (
    <main
      className="chat-main"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="chat-topbar">
        <div className="topbar-left">
          <button
            className="icon-button mobile-menu"
            onClick={onOpenSidebar}
            aria-label="Open chat history"
          >
            <PanelLeft size={17} />
          </button>
          <ModelMenu model={model} onSelect={onSelectModel} />
          <span className="topbar-sep" aria-hidden="true" />
          <span className="topbar-title">{isEmpty ? 'New chat' : chat.title}</span>
        </div>
        <div className="topbar-right">
          <ContextMeter
            used={contextUsed}
            window={contextWindow}
            max={contextMax}
            modelName={model.name}
            onCompact={onCompact}
            onGrow={onGrowContext}
          />
          <button
            className={`topbar-shield ${shieldOn ? 'is-on' : 'is-off'}`}
            onClick={() => onOpenSettings('privacy')}
            title="Open privacy settings"
          >
            <span className="status-dot" />
            <span className="topbar-shield-label">Shield {shieldOn ? 'on' : 'off'}</span>
          </button>
          <button
            className="icon-button"
            onClick={() => onOpenSettings('general')}
            aria-label="Open settings"
          >
            <Settings size={17} />
          </button>
        </div>
      </header>

      {isEmpty ? (
        <div className="chat-empty">
          <div className="empty-inner">
            <div className="empty-mark" aria-hidden="true">
              <span>M</span>
            </div>
            <p className="empty-kicker">PRIVATE AI WORKSPACE</p>
            <h1>What can I help you work through?</h1>
            <p className="empty-copy">
              Ask anything, or bring a file for context.{' '}
              {shieldOn
                ? 'Names and contact details are replaced with placeholders on this device before the request is routed.'
                : 'The PII shield is off, so your prompt and files are sent as written.'}
            </p>

            <div className="suggestion-grid">
              {SUGGESTIONS.map((item) => (
                <button
                  className="suggestion"
                  key={item.title}
                  onClick={() => useSuggestion(item.prompt)}
                >
                  <span className="suggestion-icon">
                    <item.icon size={16} />
                  </span>
                  <span className="suggestion-copy">
                    <strong>{item.title}</strong>
                    <small>{item.copy}</small>
                  </span>
                  <span className="suggestion-arrow">
                    <ChevronDown size={13} className="suggestion-arrow-icon" />
                  </span>
                </button>
              ))}
            </div>

            <div className={`empty-privacy ${shieldOn ? '' : 'is-off'}`}>
              <ShieldCheck size={13} />
              <span>Shield {shieldOn ? 'is on' : 'is off'}</span>
              <span className="empty-privacy-sep" />
              <span>25 MB per file</span>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="chat-scroll"
          ref={scrollRef}
          onScroll={() => {
            const el = scrollRef.current
            if (!el) return
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 130
          }}
        >
          <div className="thread">
            {chat.messages.map((message) => {
              const messageModel =
                message.role === 'assistant' ? modelById(MODELS, message.modelId) : undefined
              const canInspect =
                message.role === 'assistant' && (message.redactions?.length ?? 0) > 0
              return (
                <ChatMessageView
                  key={message.id}
                  message={message}
                  model={messageModel}
                  showMetrics={showMetrics}
                  isGenerating={isGenerating}
                  canInspect={canInspect}
                  onRegenerate={onRegenerate}
                  onInspect={() => onInspectMessage(message.id)}
                />
              )
            })}
            <div className="thread-end" aria-hidden="true" />
          </div>
        </div>
      )}

      <div className="composer-dock">
        {/^\/\w*$/.test(draft.trim()) && (
          <div className="slash-hint">
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setDraft('/compact')
                textareaRef.current?.focus()
              }}
            >
              <Minimize2 size={12} />
              <strong>/compact</strong>
              <span>Compress this thread now</span>
            </button>
          </div>
        )}
        <Composer
          text={draft}
          onTextChange={setDraft}
          attachments={attachments}
          uploadError={error}
          reading={reading}
          isGenerating={isGenerating}
          provider={provider}
          shieldOn={shieldOn}
          routingWarning={routingWarning}
          routeNotice={routeNoticeText}
          onFixRouting={() => setSwitchOpen(true)}
          onDismissRouteNotice={() => setRouteNotice(null)}
          textareaRef={textareaRef}
          onToggleShield={onToggleShield}
          onAttachFiles={(files) => void handleFiles(files)}
          onRemoveFile={handleRemoveFile}
          onSend={submit}
          onStop={onStop}
        />
      </div>

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">
            <UploadCloud size={26} />
            <strong>Drop files to attach</strong>
            <span>Up to {MAX_FILES} files · 25 MB each · read on this device</span>
          </div>
        </div>
      )}

      <ModelSwitchModal
        open={switchOpen && attachmentBlocked}
        need={attachmentNeed}
        current={model}
        alternatives={alternatives}
        fileCount={attachments.length}
        onClose={() => setSwitchOpen(false)}
        onChoose={chooseSwitch}
      />
    </main>
  )
}

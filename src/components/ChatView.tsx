import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  LineChart,
  ListChecks,
  Minimize2,
  PanelLeft,
  PenLine,
  Search,
  Settings,
  Shapes,
  UploadCloud,
  X,
} from 'lucide-react'
import { MODELS, MAX_FILES, typeInfo, type Model } from '../lib/data'
import { modelById, type Conversation } from '../lib/chat'
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
  showMetrics: boolean
  convertImagesToJpeg: boolean
  isGenerating: boolean
  contextUsed: number
  contextWindow: number
  contextMax: number
  onCompact: () => void
  onGrowContext: () => void
  isCompacting: boolean
  onSelectModel: (id: string) => void
  onSend: (text: string, attachments: Attachment[]) => void
  onStop: () => void
  onRegenerate: (assistantId: string) => void
  onOpenSettings: (tab: 'general' | 'data' | 'about') => void
  onOpenSidebar: () => void
}

const SUGGESTIONS = [
  {
    icon: Shapes,
    title: 'Explain it with a diagram',
    copy: 'How photosynthesis works',
    prompt: 'Explain how photosynthesis works with a labelled diagram, then check my understanding with two questions.',
  },
  {
    icon: LineChart,
    title: 'Graph a function',
    copy: 'y = x² − 2x − 3 and its roots',
    prompt: 'Plot y = x^2 - 2x - 3, mark where it crosses the x-axis, and explain step by step how to find those roots.',
  },
  {
    icon: ListChecks,
    title: 'Quiz me',
    copy: 'Ten questions on the French Revolution',
    prompt: 'Quiz me with ten questions on the French Revolution, one at a time, and explain each answer after I reply.',
  },
  {
    icon: PenLine,
    title: 'Check my working',
    copy: 'Find the step where it went wrong',
    prompt: 'I will paste my solution. Find the first step where it goes wrong and explain why, without just giving me the final answer.',
  },
]

export function ChatView({
  chat,
  model,
  showMetrics,
  convertImagesToJpeg,
  isGenerating,
  contextUsed,
  contextWindow,
  contextMax,
  onCompact,
  onGrowContext,
  isCompacting,
  onSelectModel,
  onSend,
  onStop,
  onRegenerate,
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
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [hitIndex, setHitIndex] = useState(0)
  const { attachments, error, reading, addFiles, removeFile, clear } =
    useAttachments(convertImagesToJpeg)

  // In-thread search matches whole messages, which keeps it cheap and works
  // with rendered Markdown. Enter / Shift+Enter (or the arrows) jump between
  // hits and the target message is outlined in the thread.
  const hits = useMemo(() => {
    const query = findQuery.trim().toLowerCase()
    if (!query) return []
    const found: number[] = []
    chat.messages.forEach((message, index) => {
      const haystack = [
        message.content,
        message.reasoning ?? '',
        message.attachments?.map((file) => file.name).join(' ') ?? '',
      ]
        .join(' ')
        .toLowerCase()
      if (haystack.includes(query)) found.push(index)
    })
    return found
  }, [chat.messages, findQuery])

  useEffect(() => {
    setHitIndex(0)
  }, [findQuery])

  useEffect(() => {
    if (!findOpen) return
    const nodes = scrollRef.current?.querySelectorAll<HTMLElement>('.thread .msg')
    nodes?.forEach((node) => node.classList.remove('is-search-hit'))
    if (!hits.length) return
    const target = nodes?.[hits[Math.min(hitIndex, hits.length - 1)]]
    if (!target) return
    target.classList.add('is-search-hit')
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [findOpen, hits, hitIndex])

  useEffect(() => {
    if (findOpen) return
    const nodes = scrollRef.current?.querySelectorAll<HTMLElement>('.is-search-hit')
    nodes?.forEach((node) => node.classList.remove('is-search-hit'))
  }, [findOpen])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setFindOpen(true)
        window.setTimeout(() => {
          findInputRef.current?.focus()
          findInputRef.current?.select()
        }, 30)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const stepHit = (direction: 1 | -1) => {
    if (!hits.length) return
    setHitIndex((current) => (current + direction + hits.length) % hits.length)
  }

  const closeFind = () => {
    setFindOpen(false)
    setFindQuery('')
  }

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

  // Only the growing tail matters for stick-to-bottom scrolling; hashing the
  // whole thread on every streaming tick is wasted work.
  const lastMessage = chat.messages[chat.messages.length - 1]
  const signature = `${chat.messages.length}:${lastMessage?.id ?? ''}:${lastMessage?.content.length ?? 0}:${lastMessage?.reasoning?.length ?? 0}:${lastMessage?.phase ?? ''}`

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
      void onCompact()
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
          {!isEmpty && (
            <>
              <span className="topbar-sep" aria-hidden="true" />
              <span className="topbar-title">{chat.title}</span>
            </>
          )}
        </div>
        <div className="topbar-right">
          <ContextMeter
            used={contextUsed}
            window={contextWindow}
            max={contextMax}
            modelName={model.name}
            compacting={isCompacting}
            onCompact={onCompact}
            onGrow={onGrowContext}
          />
          <button
            className="icon-button"
            onClick={() => onOpenSettings('general')}
            aria-label="Open settings"
          >
            <Settings size={17} />
          </button>
        </div>
      </header>

      {findOpen && (
        <div className="find-bar" role="search">
          <Search size={13} aria-hidden="true" />
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(event) => setFindQuery(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') {
                event.preventDefault()
                closeFind()
              } else if (event.key === 'Enter') {
                event.preventDefault()
                stepHit(event.shiftKey ? -1 : 1)
              }
            }}
            placeholder="Find in this chat"
            aria-label="Find in this chat"
            autoFocus
          />
          <span className="find-count" aria-live="polite">
            {hits.length ? `${Math.min(hitIndex + 1, hits.length)}/${hits.length}` : '0/0'}
          </span>
          <button
            type="button"
            onClick={() => stepHit(-1)}
            disabled={!hits.length}
            aria-label="Previous match"
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            onClick={() => stepHit(1)}
            disabled={!hits.length}
            aria-label="Next match"
          >
            <ChevronDown size={14} />
          </button>
          <button type="button" onClick={closeFind} aria-label="Close find bar">
            <X size={14} />
          </button>
        </div>
      )}

      {isEmpty ? (
        <div className="chat-empty">
          <div className="empty-inner">
            <div className="empty-lede">
              <h1>
                Learn anything. <span>Explained the way you understand it.</span>
              </h1>
              <p className="empty-copy">
                Ask a question and Mint teaches it step by step, with diagrams, graphs and pictures
                when words are not enough.
              </p>

              <div className="suggestion-list">
                {SUGGESTIONS.map((item) => (
                  <button
                    className="suggestion"
                    key={item.title}
                    onClick={() => useSuggestion(item.prompt)}
                  >
                    <item.icon size={16} strokeWidth={1.5} className="suggestion-icon" />
                    <span className="suggestion-copy">
                      <strong>{item.title}</strong>
                      <small>{item.copy}</small>
                    </span>
                    <ArrowUpRight size={16} strokeWidth={1.5} className="suggestion-arrow" />
                  </button>
                ))}
              </div>
            </div>

            <figure className="lesson-sheet" aria-hidden="true">
              <div className="paper paper-graph">
                <p className="paper-title">y = x² − 2x − 3</p>
                <svg className="graph" viewBox="0 0 320 200">
                  <line className="graph-axis" x1="0" y1="100" x2="320" y2="100" />
                  <line className="graph-axis" x1="113.3" y1="0" x2="113.3" y2="200" />
                  <path className="graph-curve" d="M20 10 Q160 334 300 10" />
                  <line className="graph-guide" x1="160" y1="100" x2="160" y2="172" />
                  <circle className="graph-root" cx="66.7" cy="100" r="5" />
                  <circle className="graph-root" cx="253.3" cy="100" r="5" />
                  <circle className="graph-vertex" cx="160" cy="172" r="3.5" />
                  <text x="56" y="90" textAnchor="end">−1</text>
                  <text x="264" y="90">3</text>
                  <text x="170" y="188">(1, −4)</text>
                </svg>
                <p className="paper-note">
                  Crosses the x-axis at <mark>x = −1</mark> and <mark>x = 3</mark>
                </p>
              </div>
            </figure>
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
              return (
                <ChatMessageView
                  key={message.id}
                  message={message}
                  model={messageModel}
                  showMetrics={showMetrics}
                  isGenerating={isGenerating}
                  onRegenerate={onRegenerate}
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
          routingWarning={routingWarning}
          routeNotice={routeNoticeText}
          onFixRouting={() => setSwitchOpen(true)}
          onDismissRouteNotice={() => setRouteNotice(null)}
          textareaRef={textareaRef}
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
            <span>Up to {MAX_FILES} files, 25 MB each</span>
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

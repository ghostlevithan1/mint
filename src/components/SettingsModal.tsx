import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Download,
  FileUp,
  Gauge,
  HardDrive,
  Image as ImageIcon,
  Info,
  LockKeyhole,
  RefreshCw,
  ScanSearch,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-react'
import { MOD_KEY } from '../lib/platform'
import { LeafMark } from './Logo'
import { MODEL_TYPES, MODELS, modelsByType, typeInfo } from '../lib/data'
import type { ProviderStatus } from '../lib/provider'
import { formatBytes } from '../lib/files'
import { getStoredProfile, PROFILE_MAX_CHARS, saveProfile } from '../lib/preferences'
import { storageUsage } from '../lib/storage'
import { ModelCapabilityBadges, ModelLogo } from './ModelLogo'

export type SettingsTab = 'general' | 'data' | 'about'

type SettingsModalProps = {
  open: boolean
  initialTab: SettingsTab
  modelId: string
  provider: ProviderStatus
  showMetrics: boolean
  convertImagesToJpeg: boolean
  chatCount: number
  messageCount: number
  onClose: () => void
  onModelChange: (id: string) => void
  onShowMetricsChange: (value: boolean) => void
  onConvertImagesChange: (value: boolean) => void
  onExportChats: () => void
  onClearChats: () => void
  onRefreshProvider: () => void
}

const TABS: Array<{ id: SettingsTab; label: string; icon: typeof Info }> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'data', label: 'Your data', icon: HardDrive },
  { id: 'about', label: 'About', icon: Info },
]

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? 'on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

export function SettingsModal({
  open,
  initialTab,
  modelId,
  provider,
  showMetrics,
  convertImagesToJpeg,
  chatCount,
  messageCount,
  onClose,
  onModelChange,
  onShowMetricsChange,
  onConvertImagesChange,
  onExportChats,
  onClearChats,
  onRefreshProvider,
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [profile, setProfile] = useState(getStoredProfile)
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || tab !== 'data') return
    let cancelled = false
    void storageUsage().then((value) => {
      if (!cancelled) setUsage(value)
    })
    return () => {
      cancelled = true
    }
  }, [open, tab])

  useEffect(() => {
    if (!open) return
    setTab(initialTab)
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
  }, [open, initialTab, onClose])

  const selectedModel = MODELS.find((model) => model.id === modelId) ?? MODELS[0]
  const selectedType = typeInfo(selectedModel.type)
  const buildSha = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev'
  const totalMessages = messageCount.toLocaleString()

  if (!open) return null

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <aside className="settings-nav">
          <div className="settings-nav-head">
            <h2 id="settings-title">Settings</h2>
          </div>
          <div className="settings-tabs" role="tablist" aria-orientation="vertical">
            {TABS.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                className={tab === item.id ? 'is-active' : ''}
                onClick={() => setTab(item.id)}
              >
                <item.icon size={15} />
                {item.label}
              </button>
            ))}
          </div>
          <div className="settings-nav-foot">
            <span>Mint v1.0</span>
            <span>build {buildSha}</span>
          </div>
        </aside>

        <div className="settings-content">
          <button className="icon-button settings-close" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>

          {tab === 'general' && (
            <div className="settings-pane">
              <div className="settings-pane-head">
                <h3>General</h3>
                <p>How Mint answers and what it shows you</p>
              </div>

              <section className="settings-section">
                <h4>
                  <label htmlFor="mint-profile">About you</label>
                </h4>
                <p className="settings-help">
                  Mint uses this to pitch every explanation at your level. Your year, subjects,
                  exams coming up and how you like things explained. No need for your name.
                </p>
                <textarea
                  id="mint-profile"
                  className="profile-input"
                  value={profile}
                  maxLength={PROFILE_MAX_CHARS}
                  rows={4}
                  placeholder="Year 10. Doing GCSE maths, biology and history. I get lost in long paragraphs, so diagrams and worked examples help."
                  onChange={(event) => {
                    setProfile(event.target.value)
                    saveProfile(event.target.value)
                  }}
                />
              </section>

              <section className="settings-section">
                <h4>Model type</h4>
                <p className="settings-help">
                  Quick answers fast, Intelligent thinks harder on tough problems. You can still
                  pick a specific model below.
                </p>
                <div className="model-type-grid" role="radiogroup" aria-label="Model type">
                  {MODEL_TYPES.map((type) => {
                    const selected = selectedType.id === type.id
                    return (
                      <button
                        key={type.id}
                        role="radio"
                        aria-checked={selected}
                        className={`model-type-card ${selected ? 'is-selected' : ''}`}
                        onClick={() => onModelChange(type.defaultModelId)}
                      >
                        <span className="model-type-card-head">
                          <span className="model-group-dot" style={{ background: type.color }} />
                          <strong>{type.label}</strong>
                          <small>{type.tagline}</small>
                        </span>
                        <span>{type.detail}</span>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="settings-section">
                <h4>Default model</h4>
                <p className="settings-help">Applies to your next message. You can switch any time.</p>
                <div className="settings-models" role="radiogroup" aria-label="Default model">
                  {MODEL_TYPES.map((type) => {
                    const items = modelsByType(type.id)
                    if (!items.length) return null
                    return (
                      <div className="settings-model-group" key={type.id}>
                        <div className="settings-model-group-head">
                          <span className="model-group-dot" style={{ background: type.color }} />
                          {type.label}
                          <span>{items.length}</span>
                        </div>
                        {items.map((model) => {
                          const selected = model.id === modelId
                          return (
                            <button
                              key={model.id}
                              role="radio"
                              aria-checked={selected}
                              className={`settings-model ${selected ? 'is-selected' : ''}`}
                              onClick={() => onModelChange(model.id)}
                            >
                              <span className="model-choice-glyph">
                                <ModelLogo maker={model.maker} size={17} />
                              </span>
                              <span className="settings-model-copy">
                                <strong>{model.name}</strong>
                                <small>{model.bestAt}</small>
                                <span className="settings-model-tags">
                                  <ModelCapabilityBadges model={model} />
                                  <small>
                                    {model.maker} · {model.meta} · {model.context} context
                                  </small>
                                </span>
                              </span>
                              <span className="settings-model-speed">{model.tps} TPS</span>
                              <span className="settings-radio">
                                {selected && <Check size={12} />}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="settings-section">
                <h4>Conversation</h4>
                <div className="setting-row">
                  <div>
                    <strong>Show generation metrics</strong>
                    <span>TPS, TTFT, token count, and elapsed time under each answer.</span>
                  </div>
                  <Toggle
                    checked={showMetrics}
                    label="Show generation metrics"
                    onChange={onShowMetricsChange}
                  />
                </div>
              </section>

              <section className="settings-section">
                <h4 className="settings-section-title">
                  <ImageIcon size={13} /> Images
                </h4>
                <p className="settings-help">
                  Raster images are prepared on this device before they reach a vision model.
                  Applies to newly attached files. Static GIFs always become JPEG because NVIDIA
                  rejects GIF uploads, and animated GIFs cannot be sent.
                </p>
                <div className="setting-row">
                  <div>
                    <strong>Convert images to JPEG</strong>
                    <span>
                      Re-encodes PNG, WebP, HEIC, and other raster formats to JPEG before sending.
                    </span>
                  </div>
                  <Toggle
                    checked={convertImagesToJpeg}
                    label="Convert images to JPEG"
                    onChange={onConvertImagesChange}
                  />
                </div>
                <div className="settings-warning" role="note">
                  <TriangleAlert size={15} />
                  <p>
                    {convertImagesToJpeg
                      ? 'Sending images uses mobile data and model context. JPEG output is downscaled on this device to limit both, but large photos can still be expensive.'
                      : 'JPEG conversion is off. Images keep their original format and resolution when possible, which can use more mobile data and model context.'}
                  </p>
                </div>
              </section>

              <div className="settings-callout">
                <LockKeyhole size={15} />
                <p>
                  {chatCount === 1 ? '1 chat' : `${chatCount} chats`} with {totalMessages}{' '}
                  {messageCount === 1 ? 'message' : 'messages'} are saved in this browser using
                  IndexedDB. They never go to the server, and there is no account to sign in to.
                </p>
              </div>
            </div>
          )}

          {tab === 'data' && (
            <div className="settings-pane">
              <div className="settings-pane-head">
                <h3>Your data</h3>
                <p>Chats and files are saved in this browser only</p>
              </div>

              <div className="settings-facts">
                <div>
                  <FileUp size={15} />
                  <span>File limit</span>
                  <strong>25 MB each</strong>
                </div>
                <div>
                  <Gauge size={15} />
                  <span>Files per message</span>
                  <strong>Up to 10</strong>
                </div>
              </div>

              <div className="settings-storage">
                <HardDrive size={15} />
                <div>
                  <strong>Local storage</strong>
                  <span>
                    {usage
                      ? `${formatBytes(usage.usage)} used${usage.quota ? ` of ${formatBytes(usage.quota)} available` : ''}.`
                      : chatCount === 0
                        ? 'No chats stored yet.'
                        : `${chatCount} chat${chatCount === 1 ? '' : 's'} on this device.`}
                  </span>
                </div>
              </div>

              <div className="settings-actions">
                <button
                  className="settings-action"
                  onClick={onExportChats}
                  disabled={chatCount === 0}
                >
                  <Download size={15} /> Export all chats
                </button>
                <button
                  className="settings-action danger"
                  onClick={() => {
                    if (window.confirm('Clear every chat in this browser? This cannot be undone.')) {
                      onClearChats()
                    }
                  }}
                >
                  <Trash2 size={15} /> Clear all chats
                </button>
              </div>
            </div>
          )}

          {tab === 'about' && (
            <div className="settings-pane">
              <div className="settings-pane-head">
                <h3>About Mint</h3>
                <p>A tutor that explains things your way</p>
              </div>

              <div className="about-lockup">
                <span className="about-mark">
                  <LeafMark size={26} />
                </span>
                <div>
                  <strong>Mint</strong>
                  <span>School AI · v1.0</span>
                </div>
              </div>

              <p className="about-copy">
                Your chats and files stay in this browser. When live models are available,
                questions go through the Mint server to NVIDIA NIM and are not stored there.
                Without a key, answers come from the local demo engine.
              </p>

              <div className={`settings-provider ${provider.mode === 'nvidia' ? 'is-live' : ''}`}>
                <span className="provider-dot" aria-hidden="true" />
                <div>
                  <strong>{provider.label}</strong>
                  <span>{provider.detail}</span>
                </div>
                <button
                  className="settings-action"
                  onClick={onRefreshProvider}
                  disabled={!provider.checked}
                >
                  <RefreshCw size={14} /> Recheck
                </button>
              </div>

              <div className="settings-facts">
                <div>
                  <Wrench size={15} />
                  <span>Tools</span>
                  <strong>Search, read, calculate</strong>
                </div>
                <div>
                  <FileUp size={15} />
                  <span>Upload limit</span>
                  <strong>25 MB</strong>
                </div>
                <div>
                  <ScanSearch size={15} />
                  <span>Retention</span>
                  <strong>This browser</strong>
                </div>
                <div>
                  <Gauge size={15} />
                  <span>Inference</span>
                  <strong>{provider.mode === 'nvidia' ? 'NVIDIA NIM' : 'Local demo'}</strong>
                </div>
              </div>

              <section className="settings-section">
                <h4>Keyboard</h4>
                <div className="shortcut-list">
                  <div>
                    <span>Send message</span>
                    <kbd>Enter</kbd>
                  </div>
                  <div>
                    <span>New line</span>
                    <kbd>Shift + Enter</kbd>
                  </div>
                  <div>
                    <span>Search chats</span>
                    <kbd>{MOD_KEY} + K</kbd>
                  </div>
                  <div>
                    <span>Find in this chat</span>
                    <kbd>{MOD_KEY} + F</kbd>
                  </div>
                  <div>
                    <span>Stop generating</span>
                    <kbd>Esc</kbd>
                  </div>
                  <div>
                    <span>Rename a chat</span>
                    <kbd>Double-click</kbd>
                  </div>
                </div>
              </section>

              <p className="settings-fineprint">
                © 2026 Mint Intelligence · build {buildSha} · NVIDIA NIM when live inference is
                available.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

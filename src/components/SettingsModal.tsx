import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Eye,
  FileUp,
  Gauge,
  Info,
  LockKeyhole,
  LogOut,
  Mail,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { MODEL_TYPES, MODELS, modelsByType, typeInfo } from '../lib/data'
import type { ProviderStatus } from '../lib/provider'
import type { User } from '../lib/auth'
import { userDisplayName, userInitials, userPicture } from '../lib/auth'

export type SettingsTab = 'general' | 'privacy' | 'account' | 'about'

type SettingsModalProps = {
  open: boolean
  initialTab: SettingsTab
  user: User | null
  shieldOn: boolean
  modelId: string
  provider: ProviderStatus
  showMetrics: boolean
  hasPayload: boolean
  onClose: () => void
  onShieldChange: (value: boolean) => void
  onModelChange: (id: string) => void
  onShowMetricsChange: (value: boolean) => void
  onOpenPayload: () => void
  onClearChats: () => void
  onRefreshProvider: () => void
  onSignIn: () => void
  onSignOut: () => void
  onOpenEmailAuth?: (mode: 'login' | 'signup' | 'link' | 'forgot') => void
}

const TABS: Array<{ id: SettingsTab; label: string; icon: typeof Info }> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'privacy', label: 'Privacy & shield', icon: ShieldCheck },
  { id: 'account', label: 'Account', icon: UserRound },
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
  user,
  shieldOn,
  modelId,
  provider,
  showMetrics,
  hasPayload,
  onClose,
  onShieldChange,
  onModelChange,
  onShowMetricsChange,
  onOpenPayload,
  onClearChats,
  onRefreshProvider,
  onSignIn,
  onSignOut,
  onOpenEmailAuth,
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const panelRef = useRef<HTMLDivElement>(null)

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
            <span className="eyebrow">WORKSPACE</span>
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
            <span>Preview build</span>
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
                <p>Choose how new messages run and what the workspace shows you.</p>
              </div>

              <section className="settings-section">
                <h4>Model type</h4>
                <p className="settings-help">
                  Choose the intelligence tier for the task. It selects a matching model — you can
                  still switch models below.
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
                              <span className="model-choice-glyph" style={{ color: model.color }}>
                                {model.glyph}
                              </span>
                              <span className="settings-model-copy">
                                <strong>{model.name}</strong>
                                <small>
                                  {model.maker} · {model.meta} · {model.descriptor}
                                  {model.capabilities?.includes('image') && (
                                    <>
                                      {' '}
                                      <span className="model-cap-badge">
                                        <Eye size={9} />
                                        Vision
                                      </span>
                                    </>
                                  )}
                                </small>
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

              <div className="settings-callout">
                <LockKeyhole size={15} />
                <p>
                  Chats and preferences live in this tab&apos;s memory. Reloading starts a clean
                  session.
                </p>
              </div>
            </div>
          )}

          {tab === 'privacy' && (
            <div className="settings-pane">
              <div className="settings-pane-head">
                <h3>Privacy &amp; shield</h3>
                <p>Personal identifiers are replaced on this device before a request is routed.</p>
              </div>

              <div className={`privacy-hero ${shieldOn ? 'is-on' : 'is-off'}`}>
                <span className="privacy-hero-icon">
                  <ShieldCheck size={22} />
                </span>
                <div>
                  <strong>PII shield {shieldOn ? 'is on' : 'is off'}</strong>
                  <p>
                    {shieldOn
                      ? 'Names, emails, and phone numbers become placeholders. Answers are restored only in this tab.'
                      : 'Prompts and file text will be sent as written. Names can identify you.'}
                  </p>
                </div>
                <span className="privacy-state">{shieldOn ? 'ON' : 'OFF'}</span>
              </div>

              <div className="setting-row">
                <div>
                  <strong>Shield personal identifiers</strong>
                  <span>Detects names, email addresses, and phone numbers locally.</span>
                </div>
                <Toggle
                  checked={shieldOn}
                  label="Shield personal identifiers"
                  onChange={onShieldChange}
                />
              </div>

              <div className="settings-facts">
                <div>
                  <FileUp size={15} />
                  <span>File limit</span>
                  <strong>25 MB each</strong>
                </div>
                <div>
                  <ScanSearch size={15} />
                  <span>Detection</span>
                  <strong>On device</strong>
                </div>
                <div>
                  <Gauge size={15} />
                  <span>Files per message</span>
                  <strong>Up to 5</strong>
                </div>
                <div>
                  <LockKeyhole size={15} />
                  <span>Retention</span>
                  <strong>None</strong>
                </div>
              </div>

              <div className="settings-actions">
                <button
                  className="settings-action"
                  onClick={onOpenPayload}
                  disabled={!hasPayload}
                  title={hasPayload ? undefined : 'Send a message first to inspect a payload'}
                >
                  <ShieldCheck size={15} /> Inspect last request
                </button>
                <button
                  className="settings-action danger"
                  onClick={() => {
                    if (window.confirm('Clear every chat in this tab? This cannot be undone.')) {
                      onClearChats()
                    }
                  }}
                >
                  <Trash2 size={15} /> Clear all chats
                </button>
              </div>

              <p className="settings-fineprint">
                Detection is heuristic. Use the audit view to review exactly what would leave this
                tab before sharing sensitive material.
              </p>
            </div>
          )}

          {tab === 'account' && (
            <div className="settings-pane">
              <div className="settings-pane-head">
                <h3>Account</h3>
                <p>Sign-in is optional. It adds an identity to this session, not a data trail.</p>
              </div>

              {user ? (
                <>
                  <div className="account-card">
                    {userPicture(user) ? (
                      <img
                        src={userPicture(user)}
                        alt=""
                        className="avatar account-card-avatar"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="avatar avatar-fallback account-card-avatar">{userInitials(user)}</span>
                    )}
                    <div className="account-card-copy">
                      <strong>{userDisplayName(user)}</strong>
                      <span>{user.email}</span>
                      <small>
                        <Check size={11} /> Signed in with {user.provider === 'both' ? 'Google & Email' : user.provider === 'email' ? 'Email' : 'Google'}
                      </small>
                    </div>
                  </div>

                  <div className="settings-facts">
                    <div>
                      <UserRound size={15} />
                      <span>Profile storage</span>
                      <strong>Memory only</strong>
                    </div>
                    <div>
                      <LockKeyhole size={15} />
                      <span>Password</span>
                      <strong>Never stored</strong>
                    </div>
                    <div>
                      <ShieldCheck size={15} />
                      <span>Account data</span>
                      <strong>Not sold</strong>
                    </div>
                  </div>

                  {user.provider === 'google' && onOpenEmailAuth && (
                    <button className="settings-action" onClick={() => onOpenEmailAuth('link')}>
                      <Mail size={15} /> Link email account
                    </button>
                  )}
                  {user.provider === 'google' && onOpenEmailAuth && (
                    <button className="settings-action" onClick={() => onOpenEmailAuth('forgot')}>
                      <Mail size={15} /> Send sign-in code
                    </button>
                  )}



                  <button className="settings-action danger" onClick={onSignOut}>
                    <LogOut size={15} /> Sign out
                  </button>
                </>
              ) : (
                <>
                  <div className="account-card guest">
                    <span className="avatar avatar-guest account-card-avatar">
                      <UserRound size={20} />
                    </span>
                    <div className="account-card-copy">
                      <strong>You&apos;re using Mint as a guest</strong>
                      <span>No account is required to run a private request.</span>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h4>Why sign in?</h4>
                    <ul className="settings-list">
                      <li>Attach a name and avatar to this session.</li>
                      <li>Keep chat history tied to your identity while the tab is open.</li>
                      <li>Google handles authentication — Mint never sees a password.</li>
                    </ul>
                  </div>

                  <button className="google-button settings-google" onClick={onSignIn}>
                    <span className="google-g" aria-hidden="true">
                      <svg viewBox="0 0 48 48">
                        <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
                        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                        <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
                      </svg>
                    </span>
                    Sign in with Google
                  </button>
                  {onOpenEmailAuth && (
                    <button className="settings-action" onClick={() => onOpenEmailAuth('login')} style={{ marginTop: 8 }}>
                      <Mail size={15} /> Continue with email
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'about' && (
            <div className="settings-pane">
              <div className="settings-pane-head">
                <h3>About Mint</h3>
                <p>A private AI workspace built around the conversation, not the account.</p>
              </div>

              <div className="about-lockup">
                <span className="about-mark">M</span>
                <div>
                  <strong>Mint</strong>
                  <span>Private AI workspace · v1.0</span>
                </div>
              </div>

              <p className="about-copy">
                Mint keeps prompts, files, redaction, and chat history in this tab. When a
                server-side NVIDIA key is available, answers stream from NVIDIA NIM through a local
                proxy, so the key never enters the browser. Without a key, answers come from the
                local demo engine.
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
                  <ShieldCheck size={15} />
                  <span>Redaction</span>
                  <strong>On device</strong>
                </div>
                <div>
                  <FileUp size={15} />
                  <span>Upload limit</span>
                  <strong>25 MB</strong>
                </div>
                <div>
                  <ScanSearch size={15} />
                  <span>Retention</span>
                  <strong>None</strong>
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
                    <kbd>Ctrl + K</kbd>
                  </div>
                </div>
              </section>

              <p className="settings-fineprint">
                © 2026 Mint Intelligence. Preview build · NVIDIA NIM when a server key is configured.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

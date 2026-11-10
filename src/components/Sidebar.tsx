import { useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  ChevronsUpDown,
  LockKeyhole,
  LogOut,
  Mail,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { Logo } from './Logo'
import type { Conversation } from '../lib/chat'
import type { User } from '../lib/auth'
import { userDisplayName, userInitials, userPicture } from '../lib/auth'

type SidebarProps = {
  chats: Conversation[]
  activeId: string
  open: boolean
  shieldOn: boolean
  user: User | null
  onClose: () => void
  onOpen: () => void
  onNewChat: () => void
  onSelectChat: (id: string) => void
  onDeleteChat: (id: string) => void
  onOpenSettings: (tab: 'general' | 'privacy' | 'account' | 'about') => void
  onOpenEmailAuth?: (mode: 'login' | 'signup' | 'link') => void
  onSignIn: () => void
  onSignOut: () => void
}

function timeLabel(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function Sidebar({
  chats,
  activeId,
  open,
  shieldOn,
  user,
  onClose,
  onOpen,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onOpenSettings,
  onOpenEmailAuth,
  onSignIn,
  onSignOut,
}: SidebarProps) {
  const [search, setSearch] = useState('')
  const [accountOpen, setAccountOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const accountRef = useRef<HTMLDivElement>(null)

  const visibleChats = chats
    .filter((chat) => chat.messages.length > 0)
    .filter((chat) => chat.title.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpen()
        window.setTimeout(() => searchRef.current?.focus(), 40)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onOpen])

  useEffect(() => {
    if (!accountOpen) return
    const onPointer = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [accountOpen])

  const openSettings = (tab: 'general' | 'privacy' | 'account' | 'about') => {
    setAccountOpen(false)
    onOpenSettings(tab)
  }

  return (
    <>
      {open && <div className="sidebar-scrim" onClick={onClose} aria-hidden="true" />}
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Chats and account">
        <div className="sidebar-head">
          <Logo />
          <button className="sidebar-close" onClick={onClose} aria-label="Close sidebar">
            <PanelLeftClose size={17} />
          </button>
        </div>

        <button className="new-chat" onClick={onNewChat} type="button">
          <span className="new-chat-icon">
            <Plus size={16} />
          </span>
          New chat
        </button>

        <label className="chat-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
          />
          {search ? (
            <button
              type="button"
              className="search-clear"
              onClick={() => {
                setSearch('')
                searchRef.current?.focus()
              }}
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          ) : (
            <kbd>Ctrl K</kbd>
          )}
        </label>

        <div className="chat-history">
          <div className="history-head">
            <span>Chats</span>
            <span>{visibleChats.length}</span>
          </div>
          {visibleChats.length === 0 ? (
            <p className="history-empty">
              {search
                ? 'No chats match that search.'
                : 'No chats yet. Your first prompt starts the history.'}
            </p>
          ) : (
            <div className="history-list">
              {visibleChats.map((chat) => (
                <div
                  className={`chat-item ${chat.id === activeId ? 'is-active' : ''}`}
                  key={chat.id}
                >
                  <button
                    className="chat-select"
                    onClick={() => onSelectChat(chat.id)}
                    aria-current={chat.id === activeId ? 'page' : undefined}
                  >
                    <MessageSquare size={14} className="chat-glyph" aria-hidden="true" />
                    <span className="chat-name">{chat.title}</span>
                    <time>{timeLabel(chat.updatedAt)}</time>
                  </button>
                  <button
                    className="chat-delete"
                    onClick={() => onDeleteChat(chat.id)}
                    aria-label={`Delete chat: ${chat.title}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sidebar-bottom">
          <button className="privacy-row" onClick={() => openSettings('privacy')}>
            <span className={`privacy-row-icon ${shieldOn ? 'on' : 'off'}`}>
              <ShieldCheck size={16} />
            </span>
            <span className="privacy-row-copy">
              <strong>PII shield {shieldOn ? 'on' : 'off'}</strong>
              <small>Names stay on this device</small>
            </span>
            <ChevronRight size={14} className="privacy-row-arrow" />
          </button>

          <div className="account-wrap" ref={accountRef}>
            {user ? (
              <>
                <button
                  className="account-row"
                  onClick={() => setAccountOpen((value) => !value)}
                  aria-expanded={accountOpen}
                  aria-haspopup="menu"
                >
                  {userPicture(user) ? (
                    <img
                      src={userPicture(user)}
                      alt=""
                      className="avatar"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="avatar avatar-fallback">{userInitials(user)}</span>
                  )}
                  <span className="account-copy">
                    <strong>{userDisplayName(user)}</strong>
                    <small>{user.provider === 'email' ? 'Signed in with Email' : user.provider === 'both' ? 'Signed in with Google & Email' : 'Signed in with Google'}</small>
                  </span>
                  <ChevronsUpDown size={14} className="account-chevron" />
                </button>
                {accountOpen && (
                  <div className="account-menu" role="menu">
                    <div className="account-menu-id">
                      <strong>{userDisplayName(user)}</strong>
                      <span>{user.email}</span>
                    </div>
                    <button role="menuitem" onClick={() => openSettings('general')}>
                      <Settings size={15} /> Settings
                    </button>
                    <button role="menuitem" onClick={() => openSettings('privacy')}>
                      <ShieldCheck size={15} /> Privacy &amp; shield
                    </button>
                    {user.provider === 'google' && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setAccountOpen(false)
                          onOpenEmailAuth?.('link')
                        }}
                      >
                        <Mail size={15} /> Link email account
                      </button>
                    )}
                    <button
                      role="menuitem"
                      className="account-signout"
                      onClick={() => {
                        setAccountOpen(false)
                        onSignOut()
                      }}
                    >
                      <LogOut size={15} /> Sign out
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="account-guest-row">
                <button className="account-row guest" onClick={onSignIn}>
                  <span className="avatar avatar-guest">
                    <UserRound size={16} />
                  </span>
                  <span className="account-copy">
                    <strong>Sign in</strong>
                    <small>Optional · Google</small>
                  </span>
                  <ChevronRight size={14} className="account-chevron" />
                </button>
                <button
                  className="icon-button account-email-button"
                  onClick={() => onOpenEmailAuth?.('login')}
                  title="Sign in with email"
                  aria-label="Sign in with email"
                >
                  <Mail size={15} />
                </button>
              </div>
            )}
          </div>

          <p className="sidebar-note">
            <LockKeyhole size={11} /> Chats are held in this tab only
          </p>
        </div>
      </aside>
    </>
  )
}

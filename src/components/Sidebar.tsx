import { useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  LockKeyhole,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { Logo } from './Logo'
import type { Conversation } from '../lib/chat'

type SidebarProps = {
  chats: Conversation[]
  activeId: string
  open: boolean
  shieldOn: boolean
  onClose: () => void
  onOpen: () => void
  onNewChat: () => void
  onSelectChat: (id: string) => void
  onDeleteChat: (id: string) => void
  onOpenSettings: (tab: 'general' | 'privacy' | 'about') => void
}

function timeLabel(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function Sidebar({
  chats,
  activeId,
  open,
  shieldOn,
  onClose,
  onOpen,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onOpenSettings,
}: SidebarProps) {
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

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

  return (
    <>
      {open && <div className="sidebar-scrim" onClick={onClose} aria-hidden="true" />}
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Chats">
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
          <button className="privacy-row" onClick={() => onOpenSettings('privacy')}>
            <span className={`privacy-row-icon ${shieldOn ? 'on' : 'off'}`}>
              <ShieldCheck size={16} />
            </span>
            <span className="privacy-row-copy">
              <strong>PII shield {shieldOn ? 'on' : 'off'}</strong>
              <small>Names stay on this device</small>
            </span>
            <ChevronRight size={14} className="privacy-row-arrow" />
          </button>

          <p className="sidebar-note">
            <LockKeyhole size={11} /> Chats are saved on this device
          </p>
        </div>
      </aside>
    </>
  )
}

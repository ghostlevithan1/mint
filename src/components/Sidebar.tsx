import { useEffect, useRef, useState } from 'react'
import {
  MessageSquare,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Logo } from './Logo'
import { MOD_KEY } from '../lib/platform'
import type { Conversation } from '../lib/chat'

type SidebarProps = {
  chats: Conversation[]
  activeId: string
  open: boolean
  onClose: () => void
  onOpen: () => void
  onNewChat: () => void
  onSelectChat: (id: string) => void
  onDeleteChat: (id: string) => void
  onRenameChat: (id: string, title: string) => void
}

function timeLabel(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function Sidebar({
  chats,
  activeId,
  open,
  onClose,
  onOpen,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
}: SidebarProps) {
  const [search, setSearch] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)

  const startRename = (chat: Conversation) => {
    setRenamingId(chat.id)
    setDraft(chat.title)
  }

  const commitRename = () => {
    if (!renamingId) return
    onRenameChat(renamingId, draft)
    setRenamingId(null)
    setDraft('')
  }

  useEffect(() => {
    if (!renamingId) return
    renameRef.current?.focus()
    renameRef.current?.select()
  }, [renamingId])

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
            <Plus size={16} strokeWidth={1.75} />
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
            <span className="kbd-group" aria-hidden="true">
              <kbd>{MOD_KEY}</kbd>
              <kbd>K</kbd>
            </span>
          )}
        </label>

        <div className="chat-history">
          <div className="history-head">
            <span>Chats</span>
            {visibleChats.length > 0 && <span className="history-count">{visibleChats.length}</span>}
          </div>
          {visibleChats.length === 0 ? (
            <p className="history-empty">
              {search
                ? 'No chats match that search.'
                : 'No chats yet'}
            </p>
          ) : (
            <div className="history-list">
              {visibleChats.map((chat) => (
                <div
                  className={`chat-item ${chat.id === activeId ? 'is-active' : ''}`}
                  key={chat.id}
                >
                  {renamingId === chat.id ? (
                    <div className="chat-rename">
                      <MessageSquare size={14} className="chat-glyph" aria-hidden="true" />
                      <input
                        ref={renameRef}
                        value={draft}
                        maxLength={80}
                        aria-label="Chat name"
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            commitRename()
                          } else if (event.key === 'Escape') {
                            event.preventDefault()
                            setRenamingId(null)
                            setDraft('')
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <button
                      className="chat-select"
                      onClick={() => onSelectChat(chat.id)}
                      onDoubleClick={() => startRename(chat)}
                      aria-current={chat.id === activeId ? 'page' : undefined}
                    >
                      <MessageSquare size={14} className="chat-glyph" aria-hidden="true" />
                      <span className="chat-name">{chat.title}</span>
                      <time>{timeLabel(chat.updatedAt)}</time>
                    </button>
                  )}
                  <button
                    className="chat-rename-button"
                    onClick={() => startRename(chat)}
                    aria-label={`Rename chat: ${chat.title}`}
                    title="Rename chat"
                  >
                    <Pencil size={13} />
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

      </aside>
    </>
  )
}

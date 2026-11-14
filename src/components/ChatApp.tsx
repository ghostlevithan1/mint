import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_MODEL_ID, MODELS } from '../lib/data'
import { modelById, type Conversation } from '../lib/chat'
import { clampContextWindow, contextMaxTokens, conversationTokens } from '../lib/context'
import { getStoredJpegConversion, saveJpegConversion } from '../lib/preferences'
import { useConversations } from '../hooks/useConversations'
import { useProviderStatus } from '../hooks/useProviderStatus'
import type { Attachment } from '../lib/files'
import { Sidebar } from './Sidebar'
import { ChatView } from './ChatView'
import { SettingsModal, type SettingsTab } from './SettingsModal'

/** How long the delete toast stays before the removal becomes final. */
const UNDO_MS = 8000

export function ChatApp() {
  const {
    chats,
    activeChat,
    activeId,
    isGenerating,
    compactingChatId,
    storageError,
    sendMessage,
    stopGenerating,
    regenerate,
    newChat,
    selectChat,
    deleteChat,
    restoreChat,
    renameChat,
    clearChats,
    compactChat,
    growContext,
    setChatModel,
  } = useConversations()
  const { status: provider, refresh: refreshProvider } = useProviderStatus()

  const [defaultModelId, setDefaultModelId] = useState(DEFAULT_MODEL_ID)
  const [convertImagesToJpeg, setConvertImagesToJpeg] = useState(getStoredJpegConversion)
  const [showMetrics, setShowMetrics] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [deleted, setDeleted] = useState<{ chat: Conversation; index: number } | null>(null)
  const undoTimer = useRef<number | null>(null)

  const selectedModel = modelById(MODELS, activeChat.modelId ?? defaultModelId)
  const contextMax = contextMaxTokens(selectedModel)
  const contextWindow = clampContextWindow(activeChat.contextWindow, selectedModel)
  const contextUsed = useMemo(
    () => conversationTokens(activeChat.messages),
    [activeChat.messages],
  )

  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  // Esc stops a generation from anywhere in the workspace. Dialogs handle
  // their own Escape first, so only stop when nothing modal is open.
  useEffect(() => {
    if (!isGenerating) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (settingsOpen) return
      event.preventDefault()
      stopGenerating()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isGenerating, settingsOpen, stopGenerating])

  useEffect(() => {
    return () => {
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    }
  }, [])

  const handleSelectModel = (id: string) => {
    setDefaultModelId(id)
    setChatModel(activeId, id)
  }

  const openSettings = (tab: SettingsTab) => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }

  useEffect(() => {
    saveJpegConversion(convertImagesToJpeg)
  }, [convertImagesToJpeg])

  const handleSend = (text: string, attachments: Attachment[]) => {
    sendMessage({
      text,
      attachments,
      model: selectedModel,
      provider: provider.mode,
    })
  }

  const handleRegenerate = (assistantId: string) => {
    regenerate(assistantId, provider.mode)
  }

  const handleDeleteChat = (id: string) => {
    const result = deleteChat(id)
    if (!result) return
    setDeleted(result)
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => {
      setDeleted(null)
      undoTimer.current = null
    }, UNDO_MS)
  }

  const handleUndoDelete = () => {
    if (!deleted) return
    if (undoTimer.current !== null) {
      window.clearTimeout(undoTimer.current)
      undoTimer.current = null
    }
    restoreChat(deleted.chat, deleted.index)
    setDeleted(null)
  }

  /** Downloads every conversation as one JSON file for the user to keep. */
  const handleExportChats = () => {
    const payload = {
      app: 'Mint',
      format: 'mint-chats',
      version: 1,
      exportedAt: new Date().toISOString(),
      chats,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `mint-chats-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  return (
    <div className="chat-app">
      <Sidebar
        chats={chats}
        activeId={activeId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpen={() => setSidebarOpen(true)}
        onNewChat={() => {
          newChat()
          setSidebarOpen(false)
        }}
        onSelectChat={(id) => {
          selectChat(id)
          setSidebarOpen(false)
        }}
        onDeleteChat={handleDeleteChat}
        onRenameChat={renameChat}
      />

      <ChatView
        chat={activeChat}
        model={selectedModel}
        showMetrics={showMetrics}
        convertImagesToJpeg={convertImagesToJpeg}
        isGenerating={isGenerating}
        contextUsed={contextUsed}
        contextWindow={contextWindow}
        contextMax={contextMax}
        onCompact={() => void compactChat(provider.mode)}
        onGrowContext={() => growContext(selectedModel)}
        isCompacting={compactingChatId === activeId}
        onSelectModel={handleSelectModel}
        onSend={handleSend}
        onStop={stopGenerating}
        onRegenerate={handleRegenerate}
        onOpenSettings={openSettings}
        onOpenSidebar={() => setSidebarOpen(true)}
      />

      {storageError && (
        <div className="storage-banner" role="status">
          <span>
            <strong>Chats are not being saved.</strong> {storageError} They stay in this tab only.
          </span>
        </div>
      )}

      {deleted && (
        <div className="undo-toast" role="status">
          <span>
            Deleted <strong>{deleted.chat.title}</strong>
          </span>
          <button type="button" onClick={handleUndoDelete}>
            Undo
          </button>
        </div>
      )}

      <SettingsModal
        open={settingsOpen}
        initialTab={settingsTab}
        modelId={selectedModel.id}
        provider={provider}
        showMetrics={showMetrics}
        convertImagesToJpeg={convertImagesToJpeg}
        chatCount={chats.length}
        messageCount={chats.reduce((sum, chat) => sum + chat.messages.length, 0)}
        onClose={() => setSettingsOpen(false)}
        onRefreshProvider={() => void refreshProvider()}
        onModelChange={handleSelectModel}
        onShowMetricsChange={setShowMetrics}
        onConvertImagesChange={setConvertImagesToJpeg}
        onExportChats={handleExportChats}
        onClearChats={() => {
          clearChats()
          setSettingsOpen(false)
        }}
      />

    </div>
  )
}

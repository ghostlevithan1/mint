import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_MODEL_ID, MODELS } from '../lib/data'
import { modelById, type Conversation } from '../lib/chat'
import { clampContextWindow, contextMaxTokens, conversationTokens } from '../lib/context'
import { redactText } from '../lib/privacy'
import { applyTheme, getStoredTheme, saveTheme, type Theme } from '../lib/theme'
import { getStoredJpegConversion, getStoredWebSearch, saveJpegConversion, saveWebSearch } from '../lib/preferences'
import { useConversations } from '../hooks/useConversations'
import { useProviderStatus } from '../hooks/useProviderStatus'
import type { Attachment } from '../lib/files'
import { Sidebar } from './Sidebar'
import { ChatView } from './ChatView'
import { SettingsModal, type SettingsTab } from './SettingsModal'
import { PayloadModal } from './PayloadModal'

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
  const [themeId, setThemeId] = useState<Theme>(getStoredTheme)
  const [convertImagesToJpeg, setConvertImagesToJpeg] = useState(getStoredJpegConversion)
  const [webSearchOn, setWebSearchOn] = useState(getStoredWebSearch)
  const [shieldOn, setShieldOn] = useState(true)
  const [showMetrics, setShowMetrics] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [payloadMessageId, setPayloadMessageId] = useState<string | null>(null)
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
      if (settingsOpen || payloadMessageId) return
      event.preventDefault()
      stopGenerating()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isGenerating, settingsOpen, payloadMessageId, stopGenerating])

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

  const lastPayloadId = useMemo(() => {
    for (let index = activeChat.messages.length - 1; index >= 0; index -= 1) {
      const message = activeChat.messages[index]
      if (message.role === 'assistant' && (message.redactions?.length ?? 0) > 0) return message.id
    }
    return null
  }, [activeChat])

  const audit = useMemo(() => {
    if (!payloadMessageId) return null
    const chat = chats.find((item) =>
      item.messages.some((message) => message.id === payloadMessageId),
    )
    if (!chat) return null
    const index = chat.messages.findIndex((message) => message.id === payloadMessageId)
    const assistant = chat.messages[index]
    if (!assistant || assistant.role !== 'assistant') return null
    let userIndex = index - 1
    while (userIndex >= 0 && chat.messages[userIndex].role !== 'user') userIndex -= 1
    if (userIndex < 0) return null
    const userMessage = chat.messages[userIndex]
    const redactions = assistant.redactions ?? []
    return {
      redactedPrompt:
        assistant.shieldOn !== false
          ? redactText(userMessage.content, redactions)
          : userMessage.content,
      redactions,
      fileNames: userMessage.attachments?.map((file) => file.name) ?? [],
      shieldOn: assistant.shieldOn !== false,
    }
  }, [payloadMessageId, chats])

  useEffect(() => {
    applyTheme(themeId)
    saveTheme(themeId)
  }, [themeId])

  useEffect(() => {
    saveJpegConversion(convertImagesToJpeg)
  }, [convertImagesToJpeg])

  useEffect(() => {
    saveWebSearch(webSearchOn)
  }, [webSearchOn])

  const handleSend = (text: string, attachments: Attachment[], webSearch?: boolean) => {
    sendMessage({
      text,
      attachments,
      shieldOn,
      model: selectedModel,
      provider: provider.mode,
      webSearch,
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
        shieldOn={shieldOn}
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
        onOpenSettings={openSettings}
      />

      <ChatView
        chat={activeChat}
        model={selectedModel}
        provider={provider}
        shieldOn={shieldOn}
        showMetrics={showMetrics}
        convertImagesToJpeg={convertImagesToJpeg}
        isGenerating={isGenerating}
        contextUsed={contextUsed}
        contextWindow={contextWindow}
        contextMax={contextMax}
        onCompact={() => void compactChat(provider.mode)}
        onGrowContext={() => growContext(selectedModel)}
        isCompacting={compactingChatId === activeId}
        webSearchOn={webSearchOn}
        onToggleWebSearch={() => setWebSearchOn((value) => !value)}
        onSelectModel={handleSelectModel}
        onToggleShield={() => setShieldOn((value) => !value)}
        onSend={handleSend}
        onStop={stopGenerating}
        onRegenerate={handleRegenerate}
        onInspectMessage={setPayloadMessageId}
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
        shieldOn={shieldOn}
        modelId={selectedModel.id}
        provider={provider}
        themeId={themeId}
        showMetrics={showMetrics}
        convertImagesToJpeg={convertImagesToJpeg}
        hasPayload={Boolean(lastPayloadId)}
        chatCount={chats.length}
        messageCount={chats.reduce((sum, chat) => sum + chat.messages.length, 0)}
        onClose={() => setSettingsOpen(false)}
        onRefreshProvider={() => void refreshProvider()}
        onShieldChange={setShieldOn}
        onModelChange={handleSelectModel}
        onThemeChange={setThemeId}
        onShowMetricsChange={setShowMetrics}
        onConvertImagesChange={setConvertImagesToJpeg}
        onExportChats={handleExportChats}
        onOpenPayload={() => {
          if (!lastPayloadId) return
          setSettingsOpen(false)
          setPayloadMessageId(lastPayloadId)
        }}
        onClearChats={() => {
          clearChats()
          setSettingsOpen(false)
        }}
      />

      <PayloadModal
        open={Boolean(payloadMessageId && audit)}
        onClose={() => setPayloadMessageId(null)}
        redactedPrompt={audit?.redactedPrompt ?? ''}
        redactions={audit?.redactions ?? []}
        fileNames={audit?.fileNames ?? []}
        shieldOn={audit?.shieldOn ?? shieldOn}
      />
    </div>
  )
}

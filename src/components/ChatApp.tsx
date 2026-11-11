import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_MODEL_ID, MODELS } from '../lib/data'
import { modelById } from '../lib/chat'
import { clampContextWindow, contextMaxTokens, conversationTokens } from '../lib/context'
import { redactText } from '../lib/privacy'
import { applyTheme, getStoredTheme, saveTheme, type Theme } from '../lib/theme'
import { useConversations } from '../hooks/useConversations'
import { useProviderStatus } from '../hooks/useProviderStatus'
import type { Attachment } from '../lib/files'
import { Sidebar } from './Sidebar'
import { ChatView } from './ChatView'
import { SettingsModal, type SettingsTab } from './SettingsModal'
import { PayloadModal } from './PayloadModal'

export function ChatApp() {
  const {
    chats,
    activeChat,
    activeId,
    isGenerating,
    sendMessage,
    stopGenerating,
    regenerate,
    newChat,
    selectChat,
    deleteChat,
    clearChats,
    compactChat,
    growContext,
    setChatModel,
  } = useConversations()
  const { status: provider, refresh: refreshProvider } = useProviderStatus()

  const [defaultModelId, setDefaultModelId] = useState(DEFAULT_MODEL_ID)
  const [themeId, setThemeId] = useState<Theme>(getStoredTheme)
  const [shieldOn, setShieldOn] = useState(true)
  const [showMetrics, setShowMetrics] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [payloadMessageId, setPayloadMessageId] = useState<string | null>(null)

  const selectedModel = modelById(MODELS, activeChat.modelId ?? defaultModelId)
  const contextMax = contextMaxTokens(selectedModel)
  const contextWindow = clampContextWindow(activeChat.contextWindow, selectedModel)
  const contextUsed = useMemo(
    () => conversationTokens(activeChat.messages),
    [activeChat.messages],
  )

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
    if (!sidebarOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  const handleSend = (text: string, attachments: Attachment[]) => {
    sendMessage({ text, attachments, shieldOn, model: selectedModel, provider: provider.mode })
  }

  const handleRegenerate = (assistantId: string) => {
    regenerate(assistantId, provider.mode)
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
        onDeleteChat={deleteChat}
        onOpenSettings={openSettings}
      />

      <ChatView
        chat={activeChat}
        model={selectedModel}
        provider={provider}
        shieldOn={shieldOn}
        showMetrics={showMetrics}
        isGenerating={isGenerating}
        contextUsed={contextUsed}
        contextWindow={contextWindow}
        contextMax={contextMax}
        onCompact={compactChat}
        onGrowContext={() => growContext(selectedModel)}
        onSelectModel={handleSelectModel}
        onToggleShield={() => setShieldOn((value) => !value)}
        onSend={handleSend}
        onStop={stopGenerating}
        onRegenerate={handleRegenerate}
        onInspectMessage={setPayloadMessageId}
        onOpenSettings={openSettings}
        onOpenSidebar={() => setSidebarOpen(true)}
      />

      <SettingsModal
        open={settingsOpen}
        initialTab={settingsTab}
        shieldOn={shieldOn}
        modelId={selectedModel.id}
        provider={provider}
        themeId={themeId}
        showMetrics={showMetrics}
        hasPayload={Boolean(lastPayloadId)}
        onClose={() => setSettingsOpen(false)}
        onRefreshProvider={() => void refreshProvider()}
        onShieldChange={setShieldOn}
        onModelChange={handleSelectModel}
        onThemeChange={setThemeId}
        onShowMetricsChange={setShowMetrics}
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

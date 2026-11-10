import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_MODEL_ID, MODELS } from '../lib/data'
import { modelById } from '../lib/chat'
import { redactText } from '../lib/privacy'
import { useConversations } from '../hooks/useConversations'
import { useProviderStatus } from '../hooks/useProviderStatus'
import type { Attachment } from '../lib/files'
import type { User } from '../lib/auth'
import { Sidebar } from './Sidebar'
import { ChatView } from './ChatView'
import { SettingsModal, type SettingsTab } from './SettingsModal'
import { PayloadModal } from './PayloadModal'

type ChatAppProps = {
  user: User | null
  onSignInRequest: () => void
  onSignOut: () => void
  onOpenEmailAuth: (mode: 'login' | 'signup' | 'link') => void
}

export function ChatApp({ user, onSignInRequest, onSignOut, onOpenEmailAuth }: ChatAppProps) {
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
  } = useConversations()
  const { status: provider, refresh: refreshProvider } = useProviderStatus()

  const [defaultModelId, setDefaultModelId] = useState(DEFAULT_MODEL_ID)
  const [shieldOn, setShieldOn] = useState(true)
  const [showMetrics, setShowMetrics] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [payloadMessageId, setPayloadMessageId] = useState<string | null>(null)

  const selectedModel = modelById(MODELS, defaultModelId)

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

  const handleSignIn = () => {
    setSettingsOpen(false)
    onSignInRequest()
  }

  return (
    <div className="chat-app">
      <Sidebar
        chats={chats}
        activeId={activeId}
        open={sidebarOpen}
        shieldOn={shieldOn}
        user={user}
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
        onSignIn={handleSignIn}
        onSignOut={onSignOut}
        onOpenEmailAuth={onOpenEmailAuth}
      />

      <ChatView
        chat={activeChat}
        model={selectedModel}
        provider={provider}
        shieldOn={shieldOn}
        showMetrics={showMetrics}
        isGenerating={isGenerating}
        onSelectModel={setDefaultModelId}
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
        user={user}
        shieldOn={shieldOn}
        modelId={defaultModelId}
        provider={provider}
        showMetrics={showMetrics}
        hasPayload={Boolean(lastPayloadId)}
        onClose={() => setSettingsOpen(false)}
        onRefreshProvider={() => void refreshProvider()}
        onShieldChange={setShieldOn}
        onModelChange={setDefaultModelId}
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
        onSignIn={handleSignIn}
        onSignOut={() => {
          setSettingsOpen(false)
          onSignOut()
        }}
        onOpenEmailAuth={onOpenEmailAuth}
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

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_MODEL_ID, MODELS } from '../lib/data';
import { modelById } from '../lib/chat';
import { contextLimitTokens, conversationTokens } from '../lib/context';
import { redactText } from '../lib/privacy';
import { getStoredJpegConversion, getStoredMetrics, getStoredModelId, getStoredShield, saveJpegConversion, saveMetrics, saveModelId, saveShield, } from '../lib/preferences';
import { useConversations } from '../hooks/useConversations';
import { useProviderStatus } from '../hooks/useProviderStatus';
import { Sidebar } from './Sidebar';
import { ChatView } from './ChatView';
import { SettingsModal } from './SettingsModal';
import { PayloadModal } from './PayloadModal';
/** How long the delete toast stays before the removal becomes final. */
const UNDO_MS = 8000;
export function ChatApp() {
    const { chats, activeChat, activeId, isGenerating, compactingChatId, storageError, sendMessage, stopGenerating, regenerate, newChat, selectChat, deleteChat, restoreChat, renameChat, clearChats, compactChat, setChatModel, } = useConversations();
    const { status: provider, refresh: refreshProvider } = useProviderStatus();
    const [defaultModelId, setDefaultModelId] = useState(() => {
        const stored = getStoredModelId();
        return MODELS.some((model) => model.id === stored) ? stored : DEFAULT_MODEL_ID;
    });
    const [convertImagesToJpeg, setConvertImagesToJpeg] = useState(getStoredJpegConversion);
    const [shieldOn, setShieldOn] = useState(getStoredShield);
    const [showMetrics, setShowMetrics] = useState(getStoredMetrics);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsTab, setSettingsTab] = useState('general');
    const [payloadMessageId, setPayloadMessageId] = useState(null);
    const [deleted, setDeleted] = useState(null);
    const undoTimer = useRef(null);
    const selectedModel = modelById(MODELS, activeChat.modelId ?? defaultModelId);
    const contextLimit = contextLimitTokens(selectedModel);
    const contextUsed = useMemo(() => conversationTokens(activeChat.messages), [activeChat.messages]);
    useEffect(() => {
        if (!sidebarOpen)
            return;
        const onKey = (event) => {
            if (event.key === 'Escape')
                setSidebarOpen(false);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [sidebarOpen]);
    // Esc stops a generation from anywhere in the workspace. Dialogs handle
    // their own Escape first, so only stop when nothing modal is open.
    useEffect(() => {
        if (!isGenerating)
            return;
        const onKey = (event) => {
            if (event.key !== 'Escape')
                return;
            if (settingsOpen || payloadMessageId)
                return;
            event.preventDefault();
            stopGenerating();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isGenerating, settingsOpen, payloadMessageId, stopGenerating]);
    useEffect(() => {
        return () => {
            if (undoTimer.current !== null)
                window.clearTimeout(undoTimer.current);
        };
    }, []);
    const handleSelectModel = (id) => {
        setDefaultModelId(id);
        saveModelId(id);
        setChatModel(activeId, id);
    };
    const openSettings = (tab) => {
        setSettingsTab(tab);
        setSettingsOpen(true);
    };
    const lastPayloadId = useMemo(() => {
        for (let index = activeChat.messages.length - 1; index >= 0; index -= 1) {
            const message = activeChat.messages[index];
            if (message.role === 'assistant' && (message.redactions?.length ?? 0) > 0)
                return message.id;
        }
        return null;
    }, [activeChat]);
    const audit = useMemo(() => {
        if (!payloadMessageId)
            return null;
        const chat = chats.find((item) => item.messages.some((message) => message.id === payloadMessageId));
        if (!chat)
            return null;
        const index = chat.messages.findIndex((message) => message.id === payloadMessageId);
        const assistant = chat.messages[index];
        if (!assistant || assistant.role !== 'assistant')
            return null;
        let userIndex = index - 1;
        while (userIndex >= 0 && chat.messages[userIndex].role !== 'user')
            userIndex -= 1;
        if (userIndex < 0)
            return null;
        const userMessage = chat.messages[userIndex];
        const redactions = assistant.redactions ?? [];
        return {
            redactedPrompt: assistant.shieldOn !== false
                ? redactText(userMessage.content, redactions)
                : userMessage.content,
            redactions,
            fileNames: userMessage.attachments?.map((file) => file.name) ?? [],
            shieldOn: assistant.shieldOn !== false,
        };
    }, [payloadMessageId, chats]);
    useEffect(() => {
        saveJpegConversion(convertImagesToJpeg);
    }, [convertImagesToJpeg]);
    useEffect(() => {
        saveShield(shieldOn);
    }, [shieldOn]);
    useEffect(() => {
        saveMetrics(showMetrics);
    }, [showMetrics]);
    const handleSend = (text, attachments) => {
        void sendMessage({
            text,
            attachments,
            shieldOn,
            model: selectedModel,
        });
    };
    const handleDeleteChat = (id) => {
        const result = deleteChat(id);
        if (!result)
            return;
        setDeleted(result);
        if (undoTimer.current !== null)
            window.clearTimeout(undoTimer.current);
        undoTimer.current = window.setTimeout(() => {
            setDeleted(null);
            undoTimer.current = null;
        }, UNDO_MS);
    };
    const handleUndoDelete = () => {
        if (!deleted)
            return;
        if (undoTimer.current !== null) {
            window.clearTimeout(undoTimer.current);
            undoTimer.current = null;
        }
        restoreChat(deleted.chat, deleted.index);
        setDeleted(null);
    };
    /** Downloads every conversation as one JSON file for the user to keep. */
    const handleExportChats = () => {
        const payload = {
            app: 'Mint',
            format: 'mint-chats',
            version: 1,
            exportedAt: new Date().toISOString(),
            chats,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: 'application/json;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `mint-chats-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    };
    return (_jsxs("div", { className: "chat-app", children: [_jsx(Sidebar, { chats: chats, activeId: activeId, open: sidebarOpen, onClose: () => setSidebarOpen(false), onOpen: () => setSidebarOpen(true), onNewChat: () => {
                    newChat();
                    setSidebarOpen(false);
                }, onSelectChat: (id) => {
                    selectChat(id);
                    setSidebarOpen(false);
                }, onDeleteChat: handleDeleteChat, onRenameChat: renameChat }), _jsx(ChatView, { chat: activeChat, model: selectedModel, showMetrics: showMetrics, convertImagesToJpeg: convertImagesToJpeg, isGenerating: isGenerating, contextUsed: contextUsed, contextLimit: contextLimit, onCompact: () => void compactChat(), isCompacting: compactingChatId === activeId, onSelectModel: handleSelectModel, onSend: handleSend, onStop: stopGenerating, onRegenerate: regenerate, onInspectMessage: setPayloadMessageId, onOpenSettings: openSettings, onOpenSidebar: () => setSidebarOpen(true) }), storageError && (_jsx("div", { className: "storage-banner", role: "status", children: _jsxs("span", { children: [_jsx("strong", { children: "Chats are not being saved." }), " ", storageError, " They stay in this tab only."] }) })), deleted && (_jsxs("div", { className: "undo-toast", role: "status", children: [_jsxs("span", { children: ["Deleted ", _jsx("strong", { children: deleted.chat.title })] }), _jsx("button", { type: "button", onClick: handleUndoDelete, children: "Undo" })] })), _jsx(SettingsModal, { open: settingsOpen, initialTab: settingsTab, shieldOn: shieldOn, modelId: selectedModel.id, provider: provider, showMetrics: showMetrics, convertImagesToJpeg: convertImagesToJpeg, hasPayload: Boolean(lastPayloadId), chatCount: chats.length, messageCount: chats.reduce((sum, chat) => sum + chat.messages.length, 0), onClose: () => setSettingsOpen(false), onRefreshProvider: () => void refreshProvider(), onShieldChange: setShieldOn, onModelChange: handleSelectModel, onShowMetricsChange: setShowMetrics, onConvertImagesChange: setConvertImagesToJpeg, onExportChats: handleExportChats, onOpenPayload: () => {
                    if (!lastPayloadId)
                        return;
                    setSettingsOpen(false);
                    setPayloadMessageId(lastPayloadId);
                }, onClearChats: () => {
                    clearChats();
                    setSettingsOpen(false);
                } }), _jsx(PayloadModal, { open: Boolean(payloadMessageId && audit), onClose: () => setPayloadMessageId(null), redactedPrompt: audit?.redactedPrompt ?? '', redactions: audit?.redactions ?? [], fileNames: audit?.fileNames ?? [], shieldOn: audit?.shieldOn ?? shieldOn })] }));
}

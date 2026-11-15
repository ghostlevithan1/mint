import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { MessageSquare, PanelLeftClose, Pencil, Plus, Search, Trash2, X, } from 'lucide-react';
import { Logo } from './Logo';
import { MOD_KEY } from '../lib/platform';
function timeLabel(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
export function Sidebar({ chats, activeId, open, onClose, onOpen, onNewChat, onSelectChat, onDeleteChat, onRenameChat, }) {
    const [search, setSearch] = useState('');
    const [renamingId, setRenamingId] = useState(null);
    const [draft, setDraft] = useState('');
    const searchRef = useRef(null);
    const renameRef = useRef(null);
    const startRename = (chat) => {
        setRenamingId(chat.id);
        setDraft(chat.title);
    };
    const commitRename = () => {
        if (!renamingId)
            return;
        onRenameChat(renamingId, draft);
        setRenamingId(null);
        setDraft('');
    };
    useEffect(() => {
        if (!renamingId)
            return;
        renameRef.current?.focus();
        renameRef.current?.select();
    }, [renamingId]);
    const visibleChats = chats
        .filter((chat) => chat.messages.length > 0)
        .filter((chat) => chat.title.toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    useEffect(() => {
        const onKey = (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                onOpen();
                window.setTimeout(() => searchRef.current?.focus(), 40);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onOpen]);
    return (_jsxs(_Fragment, { children: [open && _jsx("div", { className: "sidebar-scrim", onClick: onClose, "aria-hidden": "true" }), _jsxs("aside", { className: `sidebar ${open ? 'is-open' : ''}`, "aria-label": "Chats", children: [_jsxs("div", { className: "sidebar-head", children: [_jsx(Logo, {}), _jsx("button", { className: "sidebar-close", onClick: onClose, "aria-label": "Close sidebar", children: _jsx(PanelLeftClose, { size: 17 }) })] }), _jsxs("button", { className: "new-chat", onClick: onNewChat, type: "button", children: [_jsx("span", { className: "new-chat-icon", children: _jsx(Plus, { size: 16, strokeWidth: 1.75 }) }), "New chat"] }), _jsxs("label", { className: "chat-search", children: [_jsx(Search, { size: 14, "aria-hidden": "true" }), _jsx("input", { ref: searchRef, value: search, onChange: (event) => setSearch(event.target.value), placeholder: "Search chats", "aria-label": "Search chats" }), search ? (_jsx("button", { type: "button", className: "search-clear", onClick: () => {
                                    setSearch('');
                                    searchRef.current?.focus();
                                }, "aria-label": "Clear search", children: _jsx(X, { size: 12 }) })) : (_jsxs("span", { className: "kbd-group", "aria-hidden": "true", children: [_jsx("kbd", { children: MOD_KEY }), _jsx("kbd", { children: "K" })] }))] }), _jsxs("div", { className: "chat-history", children: [_jsxs("div", { className: "history-head", children: [_jsx("span", { children: "Chats" }), visibleChats.length > 0 && _jsx("span", { className: "history-count", children: visibleChats.length })] }), visibleChats.length === 0 ? (_jsx("p", { className: "history-empty", children: search
                                    ? 'No chats match that search.'
                                    : 'No chats yet' })) : (_jsx("div", { className: "history-list", children: visibleChats.map((chat) => (_jsxs("div", { className: `chat-item ${chat.id === activeId ? 'is-active' : ''}`, children: [renamingId === chat.id ? (_jsxs("div", { className: "chat-rename", children: [_jsx(MessageSquare, { size: 14, className: "chat-glyph", "aria-hidden": "true" }), _jsx("input", { ref: renameRef, value: draft, maxLength: 80, "aria-label": "Chat name", onChange: (event) => setDraft(event.target.value), onBlur: commitRename, onKeyDown: (event) => {
                                                        if (event.key === 'Enter') {
                                                            event.preventDefault();
                                                            commitRename();
                                                        }
                                                        else if (event.key === 'Escape') {
                                                            event.preventDefault();
                                                            setRenamingId(null);
                                                            setDraft('');
                                                        }
                                                    } })] })) : (_jsxs("button", { className: "chat-select", onClick: () => onSelectChat(chat.id), onDoubleClick: () => startRename(chat), "aria-current": chat.id === activeId ? 'page' : undefined, children: [_jsx(MessageSquare, { size: 14, className: "chat-glyph", "aria-hidden": "true" }), _jsx("span", { className: "chat-name", children: chat.title }), _jsx("time", { children: timeLabel(chat.updatedAt) })] })), _jsx("button", { className: "chat-rename-button", onClick: () => startRename(chat), "aria-label": `Rename chat: ${chat.title}`, title: "Rename chat", children: _jsx(Pencil, { size: 13 }) }), _jsx("button", { className: "chat-delete", onClick: () => onDeleteChat(chat.id), "aria-label": `Delete chat: ${chat.title}`, children: _jsx(Trash2, { size: 13 }) })] }, chat.id))) }))] })] })] }));
}

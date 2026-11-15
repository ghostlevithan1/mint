import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Check, Download, FileUp, Gauge, HardDrive, Image as ImageIcon, Info, LockKeyhole, RefreshCw, ScanSearch, ShieldCheck, SlidersHorizontal, Trash2, TriangleAlert, X, } from 'lucide-react';
import { MOD_KEY } from '../lib/platform';
import { LeafMark } from './Logo';
import { MODEL_TYPES, modelsByType } from '../lib/data';
import { formatBytes } from '../lib/privacy';
import { getStoredProfile, PROFILE_MAX_CHARS, saveProfile } from '../lib/preferences';
import { storageUsage } from '../lib/storage';
import { ModelCapabilityBadges, ModelLogo } from './ModelLogo';
const TABS = [
    { id: 'general', label: 'General', icon: SlidersHorizontal },
    { id: 'privacy', label: 'Privacy & shield', icon: ShieldCheck },
    { id: 'about', label: 'About', icon: Info },
];
function Toggle({ checked, label, onChange, }) {
    return (_jsx("button", { type: "button", className: `toggle ${checked ? 'on' : ''}`, role: "switch", "aria-checked": checked, "aria-label": label, onClick: () => onChange(!checked), children: _jsx("span", {}) }));
}
export function SettingsModal({ open, initialTab, shieldOn, modelId, provider, showMetrics, convertImagesToJpeg, hasPayload, chatCount, messageCount, onClose, onShieldChange, onModelChange, onShowMetricsChange, onConvertImagesChange, onExportChats, onOpenPayload, onClearChats, onRefreshProvider, }) {
    const [tab, setTab] = useState(initialTab);
    const [profile, setProfile] = useState(getStoredProfile);
    const [usage, setUsage] = useState(null);
    const panelRef = useRef(null);
    useEffect(() => {
        if (!open || tab !== 'privacy')
            return;
        let cancelled = false;
        void storageUsage().then((value) => {
            if (!cancelled)
                setUsage(value);
        });
        return () => {
            cancelled = true;
        };
    }, [open, tab]);
    useEffect(() => {
        if (!open)
            return;
        setTab(initialTab);
        const onKey = (event) => {
            if (event.key === 'Escape')
                onClose();
        };
        document.addEventListener('keydown', onKey);
        document.body.classList.add('modal-open');
        panelRef.current?.focus();
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.classList.remove('modal-open');
        };
    }, [open, initialTab, onClose]);
    const buildSha = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
    const totalMessages = messageCount.toLocaleString();
    if (!open)
        return null;
    return (_jsx("div", { className: "modal-backdrop", onMouseDown: (event) => event.target === event.currentTarget && onClose(), children: _jsxs("div", { className: "settings-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "settings-title", tabIndex: -1, ref: panelRef, children: [_jsxs("aside", { className: "settings-nav", children: [_jsx("div", { className: "settings-nav-head", children: _jsx("h2", { id: "settings-title", children: "Settings" }) }), _jsx("div", { className: "settings-tabs", role: "tablist", "aria-orientation": "vertical", children: TABS.map((item) => (_jsxs("button", { role: "tab", "aria-selected": tab === item.id, className: tab === item.id ? 'is-active' : '', onClick: () => setTab(item.id), children: [_jsx(item.icon, { size: 15 }), item.label] }, item.id))) }), _jsxs("div", { className: "settings-nav-foot", children: [_jsx("span", { children: "Mint v1.0" }), _jsxs("span", { children: ["build ", buildSha] })] })] }), _jsxs("div", { className: "settings-content", children: [_jsx("button", { className: "icon-button settings-close", onClick: onClose, "aria-label": "Close settings", children: _jsx(X, { size: 18 }) }), tab === 'general' && (_jsxs("div", { className: "settings-pane", children: [_jsxs("div", { className: "settings-pane-head", children: [_jsx("h3", { children: "General" }), _jsx("p", { children: "How Mint answers and what it shows you" })] }), _jsxs("section", { className: "settings-section", children: [_jsx("h4", { children: _jsx("label", { htmlFor: "mint-profile", children: "About you" }) }), _jsx("p", { className: "settings-help", children: "Mint uses this to pitch every explanation at your level. Your year, subjects, exams coming up and how you like things explained. No need for your name." }), _jsx("textarea", { id: "mint-profile", className: "profile-input", value: profile, maxLength: PROFILE_MAX_CHARS, rows: 4, placeholder: "Year 10. Doing GCSE maths, biology and history. I get lost in long paragraphs, so diagrams and worked examples help.", onChange: (event) => {
                                                setProfile(event.target.value);
                                                saveProfile(event.target.value);
                                            } })] }), _jsxs("section", { className: "settings-section", children: [_jsx("h4", { children: "Default model" }), _jsx("p", { className: "settings-help", children: "Quick answers fast, Intelligent thinks harder on tough problems. Applies to your next message. You can switch any time." }), _jsx("div", { className: "settings-models", role: "radiogroup", "aria-label": "Default model", children: MODEL_TYPES.map((type) => {
                                                const items = modelsByType(type.id);
                                                if (!items.length)
                                                    return null;
                                                return (_jsxs("div", { className: "settings-model-group", children: [_jsxs("div", { className: "settings-model-group-head", children: [_jsx("span", { className: "model-group-dot", style: { background: type.color } }), type.label, _jsx("span", { children: items.length })] }), items.map((model) => {
                                                            const selected = model.id === modelId;
                                                            return (_jsxs("button", { role: "radio", "aria-checked": selected, className: `settings-model ${selected ? 'is-selected' : ''}`, onClick: () => onModelChange(model.id), children: [_jsx("span", { className: "model-choice-glyph", children: _jsx(ModelLogo, { maker: model.maker, size: 17 }) }), _jsxs("span", { className: "settings-model-copy", children: [_jsx("strong", { children: model.name }), _jsx("small", { children: model.bestAt }), _jsxs("span", { className: "settings-model-tags", children: [_jsx(ModelCapabilityBadges, { model: model }), _jsxs("small", { children: [model.maker, " \u00B7 ", model.meta, " \u00B7 ", model.context, " context"] })] })] }), _jsxs("span", { className: "settings-model-speed", children: [model.tps, " TPS"] }), _jsx("span", { className: "settings-radio", children: selected && _jsx(Check, { size: 12 }) })] }, model.id));
                                                        })] }, type.id));
                                            }) })] }), _jsxs("section", { className: "settings-section", children: [_jsx("h4", { children: "Conversation" }), _jsxs("div", { className: "setting-row", children: [_jsxs("div", { children: [_jsx("strong", { children: "Show generation metrics" }), _jsx("span", { children: "TPS, TTFT, token count, and elapsed time under each answer." })] }), _jsx(Toggle, { checked: showMetrics, label: "Show generation metrics", onChange: onShowMetricsChange })] })] }), _jsxs("section", { className: "settings-section", children: [_jsxs("h4", { className: "settings-section-title", children: [_jsx(ImageIcon, { size: 13 }), " Images"] }), _jsx("p", { className: "settings-help", children: "Raster images are prepared on this device before they reach a vision model. Applies to newly attached files. Static GIFs always become JPEG because the vision endpoints do not accept GIF uploads, and animated GIFs cannot be sent." }), _jsxs("div", { className: "setting-row", children: [_jsxs("div", { children: [_jsx("strong", { children: "Convert images to JPEG" }), _jsx("span", { children: "Re-encodes PNG, WebP, HEIC, and other raster formats to JPEG before sending." })] }), _jsx(Toggle, { checked: convertImagesToJpeg, label: "Convert images to JPEG", onChange: onConvertImagesChange })] }), _jsxs("div", { className: "settings-warning", role: "note", children: [_jsx(TriangleAlert, { size: 15 }), _jsx("p", { children: convertImagesToJpeg
                                                        ? 'Sending images uses mobile data and model context. JPEG output is downscaled on this device to limit both, but large photos can still be expensive.'
                                                        : 'JPEG conversion is off. Images keep their original format and resolution when possible, which can use more mobile data and model context.' })] })] }), _jsxs("div", { className: "settings-callout", children: [_jsx(LockKeyhole, { size: 15 }), _jsxs("p", { children: [chatCount === 1 ? '1 chat' : `${chatCount} chats`, " with ", totalMessages, ' ', messageCount === 1 ? 'message' : 'messages', " saved in this browser using IndexedDB. They never go to the server, and there is no account to sign in to."] })] })] })), tab === 'privacy' && (_jsxs("div", { className: "settings-pane", children: [_jsxs("div", { className: "settings-pane-head", children: [_jsx("h3", { children: "Privacy & shield" }), _jsx("p", { children: "Personal identifiers are replaced on this device before a request is routed." })] }), _jsxs("div", { className: `privacy-hero ${shieldOn ? 'is-on' : 'is-off'}`, children: [_jsx("span", { className: "privacy-hero-icon", children: _jsx(ShieldCheck, { size: 22 }) }), _jsxs("div", { children: [_jsxs("strong", { children: ["PII shield ", shieldOn ? 'is on' : 'is off'] }), _jsx("p", { children: shieldOn
                                                        ? 'Names, emails, and phone numbers become placeholders. Answers are restored only in this browser.'
                                                        : 'Prompts and file text will be sent as written. Names can identify you.' })] }), _jsx("span", { className: "privacy-state", children: shieldOn ? 'ON' : 'OFF' })] }), _jsxs("div", { className: "setting-row", children: [_jsxs("div", { children: [_jsx("strong", { children: "Shield personal identifiers" }), _jsx("span", { children: "Detects names, email addresses, and phone numbers locally." })] }), _jsx(Toggle, { checked: shieldOn, label: "Shield personal identifiers", onChange: onShieldChange })] }), _jsxs("div", { className: "settings-facts", children: [_jsxs("div", { children: [_jsx(FileUp, { size: 15 }), _jsx("span", { children: "File limit" }), _jsx("strong", { children: "25 MB each" })] }), _jsxs("div", { children: [_jsx(ScanSearch, { size: 15 }), _jsx("span", { children: "Detection" }), _jsx("strong", { children: "On device" })] }), _jsxs("div", { children: [_jsx(Gauge, { size: 15 }), _jsx("span", { children: "Files per message" }), _jsx("strong", { children: "Up to 10" })] }), _jsxs("div", { children: [_jsx(LockKeyhole, { size: 15 }), _jsx("span", { children: "Retention" }), _jsx("strong", { children: "This browser" })] })] }), _jsxs("div", { className: "settings-storage", children: [_jsx(HardDrive, { size: 15 }), _jsxs("div", { children: [_jsx("strong", { children: "Local storage" }), _jsx("span", { children: usage
                                                        ? `${formatBytes(usage.usage)} used${usage.quota ? ` of ${formatBytes(usage.quota)} available` : ''}.`
                                                        : chatCount === 0
                                                            ? 'No chats stored yet.'
                                                            : `${chatCount} chat${chatCount === 1 ? '' : 's'} on this device.` })] })] }), _jsxs("div", { className: "settings-actions", children: [_jsxs("button", { className: "settings-action", onClick: onOpenPayload, disabled: !hasPayload, title: hasPayload ? undefined : 'Send a message first to inspect a payload', children: [_jsx(ShieldCheck, { size: 15 }), " Inspect last request"] }), _jsxs("button", { className: "settings-action", onClick: onExportChats, disabled: chatCount === 0, children: [_jsx(Download, { size: 15 }), " Export all chats"] }), _jsxs("button", { className: "settings-action danger", onClick: () => {
                                                if (window.confirm('Clear every chat in this browser? This cannot be undone.')) {
                                                    onClearChats();
                                                }
                                            }, children: [_jsx(Trash2, { size: 15 }), " Clear all chats"] })] }), _jsx("p", { className: "settings-fineprint", children: "Detection is heuristic. Use the audit view to review exactly what would leave this tab before sharing sensitive material." })] })), tab === 'about' && (_jsxs("div", { className: "settings-pane", children: [_jsxs("div", { className: "settings-pane-head", children: [_jsx("h3", { children: "About Mint" }), _jsx("p", { children: "A tutor that explains things your way" })] }), _jsxs("div", { className: "about-lockup", children: [_jsx("span", { className: "about-mark", children: _jsx(LeafMark, { size: 26 }) }), _jsxs("div", { children: [_jsx("strong", { children: "Mint" }), _jsx("span", { children: "School AI \u00B7 v1.0" })] })] }), _jsx("p", { className: "about-copy", children: "Your chats and files stay in this browser, and names are swapped for placeholders before a question is sent. Questions go through the Mint server to NVIDIA NIM and OpenRouter, and are not stored there." }), _jsxs("div", { className: `settings-provider ${provider.live ? 'is-live' : ''}`, children: [_jsx("span", { className: "provider-dot", "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: provider.label }), _jsx("span", { children: provider.detail })] }), _jsxs("button", { className: "settings-action", onClick: onRefreshProvider, disabled: !provider.checked, children: [_jsx(RefreshCw, { size: 14 }), " Recheck"] })] }), _jsxs("section", { className: "settings-section", children: [_jsx("h4", { children: "Keyboard" }), _jsxs("div", { className: "shortcut-list", children: [_jsxs("div", { children: [_jsx("span", { children: "Send message" }), _jsx("kbd", { children: "Enter" })] }), _jsxs("div", { children: [_jsx("span", { children: "New line" }), _jsx("kbd", { children: "Shift + Enter" })] }), _jsxs("div", { children: [_jsx("span", { children: "Search chats" }), _jsxs("kbd", { children: [MOD_KEY, " + K"] })] }), _jsxs("div", { children: [_jsx("span", { children: "Find in this chat" }), _jsxs("kbd", { children: [MOD_KEY, " + F"] })] }), _jsxs("div", { children: [_jsx("span", { children: "Stop generating" }), _jsx("kbd", { children: "Esc" })] }), _jsxs("div", { children: [_jsx("span", { children: "Rename a chat" }), _jsx("kbd", { children: "Double-click" })] })] })] }), _jsxs("p", { className: "settings-fineprint", children: ["\u00A9 2026 Mint Intelligence \u00B7 build ", buildSha, " \u00B7 Live answers come from NVIDIA NIM and OpenRouter."] })] }))] })] }) }));
}

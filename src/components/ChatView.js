import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronUp, LineChart, ListChecks, Minimize2, PanelLeft, PenLine, Search, Settings, Shapes, UploadCloud, X, } from 'lucide-react';
import { MODELS, MAX_FILES, typeInfo } from '../lib/data';
import { modelById } from '../lib/chat';
import { capabilityLabel, compatibleModels, modelSupportsAttachments, needForAttachments, routeWithinTier, } from '../lib/modelRouting';
import { useAttachments } from '../hooks/useAttachments';
import { ChatMessageView } from './ChatMessage';
import { Composer } from './Composer';
import { ContextMeter } from './ContextMeter';
import { ModelMenu } from './ModelMenu';
import { ModelSwitchModal } from './ModelSwitchModal';
const SUGGESTIONS = [
    {
        icon: Shapes,
        title: 'Explain it with a diagram',
        copy: 'How photosynthesis works',
        prompt: 'Explain how photosynthesis works with a labelled diagram, then check my understanding with two questions.',
    },
    {
        icon: LineChart,
        title: 'Graph a function',
        copy: 'y = x² − 2x − 3 and its roots',
        prompt: 'Plot y = x^2 - 2x - 3, mark where it crosses the x-axis, and explain step by step how to find those roots.',
    },
    {
        icon: ListChecks,
        title: 'Quiz me',
        copy: 'Ten questions on the French Revolution',
        prompt: 'Quiz me with ten questions on the French Revolution, one at a time, and explain each answer after I reply.',
    },
    {
        icon: PenLine,
        title: 'Check my working',
        copy: 'Find the step where it went wrong',
        prompt: 'I will paste my solution. Find the first step where it goes wrong and explain why, without just giving me the final answer.',
    },
];
export function ChatView({ chat, model, showMetrics, convertImagesToJpeg, isGenerating, contextUsed, contextLimit, onCompact, isCompacting, onSelectModel, onSend, onStop, onRegenerate, onInspectMessage, onOpenSettings, onOpenSidebar, }) {
    const [draft, setDraft] = useState('');
    const [dragging, setDragging] = useState(false);
    const [switchOpen, setSwitchOpen] = useState(false);
    const [routeNotice, setRouteNotice] = useState(null);
    const dragDepth = useRef(0);
    const textareaRef = useRef(null);
    const scrollRef = useRef(null);
    const stickRef = useRef(true);
    const findInputRef = useRef(null);
    const [findOpen, setFindOpen] = useState(false);
    const [findQuery, setFindQuery] = useState('');
    const [hitIndex, setHitIndex] = useState(0);
    const { attachments, error, reading, addFiles, removeFile, clear } = useAttachments(convertImagesToJpeg);
    // In-thread search matches whole messages, which keeps it cheap and works
    // with rendered Markdown. Enter / Shift+Enter (or the arrows) jump between
    // hits and the target message is outlined in the thread.
    const hits = useMemo(() => {
        const query = findQuery.trim().toLowerCase();
        if (!query)
            return [];
        const found = [];
        chat.messages.forEach((message, index) => {
            const haystack = [
                message.content,
                message.reasoning ?? '',
                message.attachments?.map((file) => file.name).join(' ') ?? '',
            ]
                .join(' ')
                .toLowerCase();
            if (haystack.includes(query))
                found.push(index);
        });
        return found;
    }, [chat.messages, findQuery]);
    useEffect(() => {
        setHitIndex(0);
    }, [findQuery]);
    useEffect(() => {
        if (!findOpen)
            return;
        const nodes = scrollRef.current?.querySelectorAll('.thread .msg');
        nodes?.forEach((node) => node.classList.remove('is-search-hit'));
        if (!hits.length)
            return;
        const target = nodes?.[hits[Math.min(hitIndex, hits.length - 1)]];
        if (!target)
            return;
        target.classList.add('is-search-hit');
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [findOpen, hits, hitIndex]);
    useEffect(() => {
        if (findOpen)
            return;
        const nodes = scrollRef.current?.querySelectorAll('.is-search-hit');
        nodes?.forEach((node) => node.classList.remove('is-search-hit'));
    }, [findOpen]);
    useEffect(() => {
        const onKey = (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault();
                setFindOpen(true);
                window.setTimeout(() => {
                    findInputRef.current?.focus();
                    findInputRef.current?.select();
                }, 30);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);
    const stepHit = (direction) => {
        if (!hits.length)
            return;
        setHitIndex((current) => (current + direction + hits.length) % hits.length);
    };
    const closeFind = () => {
        setFindOpen(false);
        setFindQuery('');
    };
    const attachmentNeed = needForAttachments(attachments);
    const attachmentBlocked = attachments.length > 0 && !modelSupportsAttachments(model, attachments);
    const alternatives = attachmentBlocked
        ? compatibleModels(attachments).filter((item) => item.id !== model.id)
        : [];
    useEffect(() => {
        setDraft('');
        setSwitchOpen(false);
        setRouteNotice(null);
        clear();
        // Reset the composer when moving to another conversation.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chat.id]);
    useEffect(() => {
        if (!attachmentBlocked)
            setSwitchOpen(false);
    }, [attachmentBlocked]);
    // Only the growing tail matters for stick-to-bottom scrolling; hashing the
    // whole thread on every streaming tick is wasted work.
    const lastMessage = chat.messages[chat.messages.length - 1];
    const signature = `${chat.messages.length}:${lastMessage?.id ?? ''}:${lastMessage?.content.length ?? 0}:${lastMessage?.reasoning?.length ?? 0}:${lastMessage?.phase ?? ''}`;
    useEffect(() => {
        if (!stickRef.current)
            return;
        const el = scrollRef.current;
        if (el)
            el.scrollTop = el.scrollHeight;
    }, [signature]);
    const useSuggestion = (prompt) => {
        setDraft(prompt);
        textareaRef.current?.focus();
    };
    const submit = () => {
        if (isGenerating || reading)
            return;
        if (draft.trim().toLowerCase() === '/compact') {
            void onCompact();
            setDraft('');
            textareaRef.current?.focus();
            return;
        }
        if (!draft.trim() && !attachments.length)
            return;
        if (attachments.length && !modelSupportsAttachments(model, attachments)) {
            setSwitchOpen(true);
            return;
        }
        stickRef.current = true;
        onSend(draft, attachments);
        setDraft('');
        setRouteNotice(null);
        clear();
        textareaRef.current?.focus();
    };
    const handleFiles = async (files) => {
        const loaded = await addFiles(files);
        if (!loaded.length)
            return;
        const next = [...attachments, ...loaded].slice(0, MAX_FILES);
        const route = routeWithinTier(model, next);
        if (route.status === 'switched') {
            onSelectModel(route.model.id);
            setRouteNotice({ model: route.model, need: route.need });
            setSwitchOpen(false);
        }
        else if (route.status === 'blocked') {
            setRouteNotice(null);
            setSwitchOpen(true);
        }
        else {
            setRouteNotice(null);
        }
    };
    const handleRemoveFile = (id) => {
        removeFile(id);
        setRouteNotice(null);
    };
    const chooseSwitch = (next) => {
        onSelectModel(next.id);
        setSwitchOpen(false);
        setRouteNotice({ model: next, need: attachmentNeed });
    };
    const handleDragEnter = (event) => {
        if (!event.dataTransfer.types.includes('Files'))
            return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
    };
    const handleDragOver = (event) => {
        if (!event.dataTransfer.types.includes('Files'))
            return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    };
    const handleDragLeave = (event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0)
            setDragging(false);
    };
    const handleDrop = (event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (event.dataTransfer.files.length) {
            void handleFiles(event.dataTransfer.files);
            textareaRef.current?.focus();
        }
    };
    const isEmpty = chat.messages.length === 0;
    const routeNoticeText = routeNotice
        ? `Switched to ${routeNotice.model.name} (${typeInfo(routeNotice.model.type).label}) so the AI can read your ${capabilityLabel(routeNotice.need)}.`
        : '';
    const routingWarning = attachmentBlocked
        ? `${typeInfo(model.type).label} has no model that can read ${capabilityLabel(attachmentNeed)}. Switch before sending so the AI can read your ${attachments.length === 1 ? 'file' : 'files'}.`
        : '';
    return (_jsxs("main", { className: "chat-main", onDragEnter: handleDragEnter, onDragOver: handleDragOver, onDragLeave: handleDragLeave, onDrop: handleDrop, children: [_jsxs("header", { className: "chat-topbar", children: [_jsxs("div", { className: "topbar-left", children: [_jsx("button", { className: "icon-button mobile-menu", onClick: onOpenSidebar, "aria-label": "Open chat history", children: _jsx(PanelLeft, { size: 17 }) }), _jsx(ModelMenu, { model: model, onSelect: onSelectModel }), !isEmpty && (_jsxs(_Fragment, { children: [_jsx("span", { className: "topbar-sep", "aria-hidden": "true" }), _jsx("span", { className: "topbar-title", children: chat.title })] }))] }), _jsxs("div", { className: "topbar-right", children: [_jsx(ContextMeter, { used: contextUsed, limit: contextLimit, modelName: model.name, compacting: isCompacting, onCompact: onCompact }), _jsx("button", { className: "icon-button", onClick: () => onOpenSettings('general'), "aria-label": "Open settings", children: _jsx(Settings, { size: 17 }) })] })] }), findOpen && (_jsxs("div", { className: "find-bar", role: "search", children: [_jsx(Search, { size: 13, "aria-hidden": "true" }), _jsx("input", { ref: findInputRef, value: findQuery, onChange: (event) => setFindQuery(event.target.value), onKeyDown: (event) => {
                            event.stopPropagation();
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                closeFind();
                            }
                            else if (event.key === 'Enter') {
                                event.preventDefault();
                                stepHit(event.shiftKey ? -1 : 1);
                            }
                        }, placeholder: "Find in this chat", "aria-label": "Find in this chat", autoFocus: true }), _jsx("span", { className: "find-count", "aria-live": "polite", children: hits.length ? `${Math.min(hitIndex + 1, hits.length)}/${hits.length}` : '0/0' }), _jsx("button", { type: "button", onClick: () => stepHit(-1), disabled: !hits.length, "aria-label": "Previous match", children: _jsx(ChevronUp, { size: 14 }) }), _jsx("button", { type: "button", onClick: () => stepHit(1), disabled: !hits.length, "aria-label": "Next match", children: _jsx(ChevronDown, { size: 14 }) }), _jsx("button", { type: "button", onClick: closeFind, "aria-label": "Close find bar", children: _jsx(X, { size: 14 }) })] })), isEmpty ? (_jsx("div", { className: "chat-empty", children: _jsxs("div", { className: "empty-inner", children: [_jsxs("div", { className: "empty-lede", children: [_jsxs("h1", { children: ["Learn anything. ", _jsx("span", { children: "Explained the way you understand it." })] }), _jsx("p", { className: "empty-copy", children: "Ask a question and Mint teaches it step by step, with diagrams, graphs and pictures when words are not enough." }), _jsx("div", { className: "suggestion-list", children: SUGGESTIONS.map((item) => (_jsxs("button", { className: "suggestion", onClick: () => useSuggestion(item.prompt), children: [_jsx(item.icon, { size: 16, strokeWidth: 1.5, className: "suggestion-icon" }), _jsxs("span", { className: "suggestion-copy", children: [_jsx("strong", { children: item.title }), _jsx("small", { children: item.copy })] }), _jsx(ArrowUpRight, { size: 16, strokeWidth: 1.5, className: "suggestion-arrow" })] }, item.title))) })] }), _jsx("figure", { className: "lesson-sheet", "aria-hidden": "true", children: _jsxs("div", { className: "paper paper-graph", children: [_jsx("p", { className: "paper-title", children: "y = x\u00B2 \u2212 2x \u2212 3" }), _jsxs("svg", { className: "graph", viewBox: "0 0 320 200", children: [_jsx("line", { className: "graph-axis", x1: "0", y1: "100", x2: "320", y2: "100" }), _jsx("line", { className: "graph-axis", x1: "113.3", y1: "0", x2: "113.3", y2: "200" }), _jsx("path", { className: "graph-curve", d: "M20 10 Q160 334 300 10" }), _jsx("line", { className: "graph-guide", x1: "160", y1: "100", x2: "160", y2: "172" }), _jsx("circle", { className: "graph-root", cx: "66.7", cy: "100", r: "5" }), _jsx("circle", { className: "graph-root", cx: "253.3", cy: "100", r: "5" }), _jsx("circle", { className: "graph-vertex", cx: "160", cy: "172", r: "3.5" }), _jsx("text", { x: "56", y: "90", textAnchor: "end", children: "\u22121" }), _jsx("text", { x: "264", y: "90", children: "3" }), _jsx("text", { x: "170", y: "188", children: "(1, \u22124)" })] }), _jsxs("p", { className: "paper-note", children: ["Crosses the x-axis at ", _jsx("mark", { children: "x = \u22121" }), " and ", _jsx("mark", { children: "x = 3" })] })] }) })] }) })) : (_jsx("div", { className: "chat-scroll", ref: scrollRef, onScroll: () => {
                    const el = scrollRef.current;
                    if (!el)
                        return;
                    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 130;
                }, children: _jsxs("div", { className: "thread", children: [chat.messages.map((message) => {
                            const messageModel = message.role === 'assistant' ? modelById(MODELS, message.modelId) : undefined;
                            const canInspect = message.role === 'assistant' && (message.redactions?.length ?? 0) > 0;
                            return (_jsx(ChatMessageView, { message: message, model: messageModel, showMetrics: showMetrics, isGenerating: isGenerating, canInspect: canInspect, onRegenerate: onRegenerate, onInspect: () => onInspectMessage(message.id) }, message.id));
                        }), _jsx("div", { className: "thread-end", "aria-hidden": "true" })] }) })), _jsxs("div", { className: "composer-dock", children: [/^\/\w*$/.test(draft.trim()) && (_jsx("div", { className: "slash-hint", children: _jsxs("button", { type: "button", onMouseDown: (event) => event.preventDefault(), onClick: () => {
                                setDraft('/compact');
                                textareaRef.current?.focus();
                            }, children: [_jsx(Minimize2, { size: 12 }), _jsx("strong", { children: "/compact" }), _jsx("span", { children: "Compress this thread now" })] }) })), _jsx(Composer, { text: draft, onTextChange: setDraft, attachments: attachments, uploadError: error, reading: reading, isGenerating: isGenerating, routingWarning: routingWarning, routeNotice: routeNoticeText, onFixRouting: () => setSwitchOpen(true), onDismissRouteNotice: () => setRouteNotice(null), textareaRef: textareaRef, onAttachFiles: (files) => void handleFiles(files), onRemoveFile: handleRemoveFile, onSend: submit, onStop: onStop })] }), dragging && (_jsx("div", { className: "drop-overlay", "aria-hidden": "true", children: _jsxs("div", { className: "drop-card", children: [_jsx(UploadCloud, { size: 26 }), _jsx("strong", { children: "Drop files to attach" }), _jsxs("span", { children: ["Up to ", MAX_FILES, " files, 25 MB each"] })] }) })), _jsx(ModelSwitchModal, { open: switchOpen && attachmentBlocked, need: attachmentNeed, current: model, alternatives: alternatives, fileCount: attachments.length, onClose: () => setSwitchOpen(false), onChoose: chooseSwitch })] }));
}

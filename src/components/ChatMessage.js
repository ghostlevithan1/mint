import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { memo, useEffect, useState } from 'react';
import { AlertTriangle, Brain, Check, Copy, Download, FileCode2, FileSpreadsheet, FileText, Fingerprint, Gauge, Globe2, Image as ImageIcon, Layers, RefreshCw, BookOpen, Calculator, Globe, Timer, Zap, } from 'lucide-react';
import { typeInfo } from '../lib/data';
import { formatBytes } from '../lib/privacy';
import { extractImageLinks } from '../lib/imageLinks';
import { Markdown } from './Markdown';
import { LeafMark } from './Logo';
import { ModelLogo } from './ModelLogo';
import { RemoteImage } from './RemoteImage';
function AttachmentGlyph({ kind }) {
    if (kind === 'image')
        return _jsx(ImageIcon, { size: 14 });
    if (kind === 'sheet')
        return _jsx(FileSpreadsheet, { size: 14 });
    if (kind === 'code')
        return _jsx(FileCode2, { size: 14 });
    return _jsx(FileText, { size: 14 });
}
function AttachmentChips({ files }) {
    return (_jsx("div", { className: "message-files", children: files.map((file) => (_jsxs("span", { className: "message-file", children: [_jsx(AttachmentGlyph, { kind: file.kind }), _jsx("span", { children: file.name }), _jsx("small", { children: formatBytes(file.size) })] }, file.id))) }));
}
const PHASE_COPY = {
    shielding: {
        title: 'Reading your question',
        detail: 'Getting your question ready.',
    },
    routing: {
        title: 'Thinking',
        detail: 'Working out the answer.',
    },
};
/**
 * Live progress for the wait before the first token. NVIDIA Build models can
 * take tens of seconds to warm up, so the copy changes with the elapsed time
 * and always tells the user that Esc stops the wait.
 */
function WaitingProgress({ routing, startedAt, detail, activity, }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 500);
        return () => window.clearInterval(timer);
    }, []);
    const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
    const title = activity
        ? activity
        : routing
            ? seconds >= 20
                ? 'Still thinking'
                : 'Thinking'
            : 'Reading your question';
    const hint = activity
        ? 'Esc stops it.'
        : !routing && seconds < 4
            ? detail
            : seconds >= 30
                ? 'This model is very slow to start. Press Esc to stop, or keep waiting.'
                : seconds >= 10
                    ? 'Some models take 20 to 30 seconds to start. Esc stops it.'
                    : routing
                        ? PHASE_COPY.routing.detail
                        : detail;
    return (_jsxs("div", { className: "thinking", role: "status", "aria-live": "polite", children: [_jsx("span", { className: "thinking-orb", children: activity ? (activity.startsWith('Calculating') ? _jsx(Calculator, { size: 15 }) : _jsx(Globe, { size: 15 })) : routing ? _jsx(Zap, { size: 15 }) : _jsx(BookOpen, { size: 15 }) }), _jsxs("span", { className: "thinking-copy", children: [_jsxs("strong", { children: [title, _jsxs("span", { className: "thinking-elapsed", children: [" \u00B7 ", seconds, "s"] })] }), _jsx("small", { children: hint })] }), _jsxs("span", { className: "thinking-dots", "aria-hidden": "true", children: [_jsx("i", {}), _jsx("i", {}), _jsx("i", {})] })] }));
}
function ReasoningPanel({ text, live }) {
    if (live) {
        return (_jsxs("div", { className: "reasoning-live", role: "status", "aria-live": "polite", children: [_jsxs("div", { className: "reasoning-head", children: [_jsx(Brain, { size: 12 }), _jsx("span", { children: "Thinking out loud" })] }), _jsx("div", { className: "reasoning-text", children: text })] }));
    }
    return (_jsxs("details", { className: "reasoning-block", children: [_jsxs("summary", { children: [_jsx(Brain, { size: 12 }), _jsx("span", { children: "Model reasoning" }), _jsxs("small", { children: [text.length.toLocaleString(), " chars"] })] }), _jsx("div", { className: "reasoning-text", children: text })] }));
}
export const ChatMessageView = memo(function ChatMessageView({ message, model, showMetrics, isGenerating, canInspect, onRegenerate, onInspect, }) {
    const [copied, setCopied] = useState(false);
    if (message.role === 'system') {
        // While /compact runs, the streamed summary is shown live instead of the
        // usual collapsed note.
        if (message.phase === 'generating') {
            return (_jsx("article", { className: "msg msg-system is-compacting", children: _jsxs("div", { className: "compacting-note", role: "status", "aria-live": "polite", children: [_jsxs("span", { className: "compacting-head", children: [_jsx(Layers, { size: 13 }), _jsx("strong", { children: "Compacting this thread\u2026" }), _jsxs("span", { className: "thinking-dots", "aria-hidden": "true", children: [_jsx("i", {}), _jsx("i", {}), _jsx("i", {})] })] }), message.content && _jsx("pre", { className: "compacting-live", children: message.content })] }) }));
        }
        return (_jsx("article", { className: "msg msg-system", children: _jsxs("details", { className: "context-note", children: [_jsxs("summary", { children: [_jsx(Layers, { size: 13 }), _jsx("span", { children: "Context compacted" }), _jsx("small", { children: "Earlier turns were summarised to save room." })] }), _jsx("pre", { children: message.content })] }) }));
    }
    if (message.role === 'user') {
        const hasText = message.content.trim().length > 0;
        const imageLinks = extractImageLinks(message.content);
        return (_jsx("article", { className: "msg msg-user", children: _jsxs("div", { className: "user-bubble", children: [message.attachments && message.attachments.length > 0 && (_jsx(AttachmentChips, { files: message.attachments })), hasText ? (_jsx("p", { className: "user-text", children: message.content })) : (_jsxs("p", { className: "user-text user-text-muted", children: ["Shared ", message.attachments?.length ?? 0, " file", (message.attachments?.length ?? 0) === 1 ? '' : 's'] })), imageLinks.map((image) => (_jsx(RemoteImage, { url: image.url, alt: image.alt }, image.url)))] }) }));
    }
    const copyAnswer = async () => {
        try {
            await navigator.clipboard.writeText(message.content);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        }
        catch {
            setCopied(false);
        }
    };
    const exportAnswer = () => {
        const blob = new Blob([message.content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `mint-${model?.id ?? 'answer'}.md`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    };
    const stats = message.stats;
    const waiting = message.phase === 'shielding' || message.phase === 'routing';
    const streaming = message.phase === 'generating';
    return (_jsxs("article", { className: "msg msg-assistant", children: [_jsx("div", { className: "assistant-rail", "aria-hidden": "true", children: _jsx("span", { className: "assistant-mark", children: _jsx(LeafMark, { size: 16 }) }) }), _jsxs("div", { className: "assistant-body", children: [_jsxs("header", { className: "assistant-head", children: [_jsx("strong", { children: "Mint" }), model && (_jsxs(_Fragment, { children: [_jsxs("span", { className: "assistant-model", children: [_jsx(ModelLogo, { maker: model.maker, size: 11 }), model.name] }), _jsx("span", { className: "assistant-type", style: { color: typeInfo(model.type).color }, children: typeInfo(model.type).label })] })), message.fallbackFrom && (_jsx("span", { className: "fallback-tag", title: "The selected model was unavailable upstream, so the default model answered.", children: "Fallback model" })), message.stopped && _jsx("span", { className: "stopped-tag", children: "Stopped" })] }), (message.webQuery !== undefined ||
                        (message.webSources && message.webSources.length > 0)) && (_jsxs("div", { className: "web-sources", children: [message.webQuery ? (_jsxs("span", { className: "web-sources-label", children: [_jsx(Globe2, { size: 11 }), "Searched the web", message.webSources && message.webSources.length > 0
                                        ? ` · ${message.webSources.length} source${message.webSources.length === 1 ? '' : 's'}`
                                        : ''] })) : (_jsxs("span", { className: "web-sources-label", children: [_jsx(Globe2, { size: 11 }), "Read ", message.webSources?.length === 1 ? '1 link' : `${message.webSources?.length ?? 0} links`] })), message.webSources?.map((source) => (_jsx("a", { href: source.url, target: "_blank", rel: "noreferrer noopener", title: source.url, children: source.title }, source.url)))] })), message.error && (_jsxs("div", { className: "message-error", role: "alert", children: [_jsx(AlertTriangle, { size: 15 }), _jsxs("div", { children: [_jsx("strong", { children: "Request failed" }), _jsx("p", { children: message.error })] })] })), waiting && (_jsx(WaitingProgress, { routing: message.phase === 'routing', startedAt: message.createdAt, activity: message.activity, detail: message.phase === 'routing' ? PHASE_COPY.routing.detail : PHASE_COPY.shielding.detail })), message.reasoning && (_jsx(ReasoningPanel, { text: message.reasoning, live: streaming && !message.content })), !waiting && message.content && (_jsxs("div", { className: `assistant-text ${streaming ? 'is-streaming' : ''}`, children: [_jsx(Markdown, { text: message.content }), streaming && _jsx("span", { className: "typing-caret", "aria-hidden": "true" })] })), !message.error && !waiting && !message.content && message.phase === 'done' && (_jsx("p", { className: "assistant-empty", children: "No response captured. Try running this prompt again." })), message.phase === 'done' && message.content && canInspect && (_jsx("div", { className: "message-meta", children: _jsx("button", { className: "meta-link", onClick: onInspect, children: "See what was sent" }) })), showMetrics && stats && message.phase !== 'shielding' && message.phase !== 'routing' && (_jsxs("div", { className: "msg-metrics", "aria-label": "Generation metrics", children: [_jsxs("div", { className: "metric-primary", children: [_jsx(Gauge, { size: 13 }), _jsx("strong", { children: stats.tps.toFixed(1) }), _jsx("span", { children: "TPS" })] }), _jsxs("div", { className: "metric-cell", children: [_jsxs("span", { children: [_jsx(Timer, { size: 11 }), " TTFT"] }), _jsxs("strong", { children: [Math.round(stats.ttft), "ms"] })] }), _jsxs("div", { className: "metric-cell", children: [_jsxs("span", { children: [_jsx(Zap, { size: 11 }), " Tokens"] }), _jsx("strong", { children: stats.tokens })] }), _jsxs("div", { className: "metric-cell", children: [_jsxs("span", { children: [_jsx(Fingerprint, { size: 11 }), " Elapsed"] }), _jsxs("strong", { children: [stats.elapsed.toFixed(1), "s"] })] })] })), message.phase === 'done' && message.error && (_jsx("div", { className: "message-actions", children: _jsxs("button", { onClick: () => onRegenerate(message.id), disabled: isGenerating, "aria-label": "Retry this request", children: [_jsx(RefreshCw, { size: 14 }), " Retry"] }) })), message.phase === 'done' && !message.error && message.content && (_jsxs("div", { className: "message-actions", children: [_jsxs("button", { onClick: copyAnswer, "aria-label": "Copy answer", children: [copied ? _jsx(Check, { size: 14 }) : _jsx(Copy, { size: 14 }), copied ? 'Copied' : 'Copy'] }), _jsxs("button", { onClick: exportAnswer, "aria-label": "Export answer as Markdown", children: [_jsx(Download, { size: 14 }), " Export"] }), _jsxs("button", { onClick: () => onRegenerate(message.id), disabled: isGenerating, "aria-label": "Regenerate answer", children: [_jsx(RefreshCw, { size: 14 }), " Regenerate"] })] }))] })] }));
}, areMessagePropsEqual);
/**
 * Event handlers are recreated on every parent render but behave identically,
 * so they are excluded from the comparison. During a stream this keeps every
 * finished message from re-rendering on each token flush.
 */
function areMessagePropsEqual(previous, next) {
    return (previous.message === next.message &&
        previous.model === next.model &&
        previous.showMetrics === next.showMetrics &&
        previous.isGenerating === next.isGenerating &&
        previous.canInspect === next.canInspect);
}

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Gauge, Minimize2, X } from 'lucide-react';
import { formatTokens } from '../lib/context';
export function ContextMeter({ used, limit, modelName, compacting, onCompact, }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
    const nearLimit = percent >= 95;
    useEffect(() => {
        if (!open)
            return;
        const onPointer = (event) => {
            if (!wrapRef.current?.contains(event.target))
                setOpen(false);
        };
        const onKey = (event) => {
            if (event.key === 'Escape')
                setOpen(false);
        };
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);
    return (_jsxs("div", { className: "context-meter-wrap", ref: wrapRef, children: [_jsxs("button", { type: "button", className: `context-meter ${nearLimit ? 'is-near' : ''}`, onClick: () => setOpen((value) => !value), "aria-haspopup": "dialog", "aria-expanded": open, title: "Context window", children: [_jsx("span", { className: "context-meter-track", "aria-hidden": "true", children: _jsx("span", { style: { width: `${percent}%` } }) }), _jsxs("span", { className: "context-meter-label", children: [formatTokens(used), " / ", formatTokens(limit)] })] }), open && (_jsxs("div", { className: "context-popover", role: "dialog", "aria-label": "Context window", children: [_jsxs("div", { className: "context-popover-head", children: [_jsxs("div", { children: [_jsx("span", { className: "eyebrow", children: "Context window" }), _jsx("strong", { children: modelName })] }), _jsx("button", { type: "button", className: "icon-button", onClick: () => setOpen(false), "aria-label": "Close context window", children: _jsx(X, { size: 13 }) })] }), _jsxs("div", { className: "context-big", children: [_jsx("strong", { children: formatTokens(used) }), _jsxs("span", { children: ["of ", formatTokens(limit), " tokens"] }), _jsxs("em", { className: nearLimit ? 'is-near' : '', children: [percent.toFixed(0), "%"] })] }), _jsx("div", { className: `context-bar ${nearLimit ? 'is-near' : ''}`, "aria-hidden": "true", children: _jsx("span", { style: { width: `${percent}%` } }) }), _jsx("p", { className: "context-help", children: "How much of this conversation Mint can send with each question. Older turns are summarised automatically at 95%." }), _jsxs("div", { className: "context-stats", children: [_jsxs("span", { children: [_jsx(Gauge, { size: 11 }), " ", formatTokens(Math.max(0, limit - used)), " free"] }), _jsxs("span", { children: [_jsx(Minimize2, { size: 11 }), " /compact"] })] }), _jsx("div", { className: "context-actions", children: _jsxs("button", { type: "button", onClick: onCompact, disabled: used < 64 || compacting, children: [_jsx(Minimize2, { size: 13 }), compacting ? 'Compacting…' : 'Compact now'] }) })] }))] }));
}

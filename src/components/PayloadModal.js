import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Check, Copy, LockKeyhole, Mail, Phone, RotateCcw, ShieldCheck, UserRound, X } from 'lucide-react';
function KindIcon({ kind }) {
    if (kind === 'email')
        return _jsx(Mail, { size: 14 });
    if (kind === 'phone')
        return _jsx(Phone, { size: 14 });
    return _jsx(UserRound, { size: 14 });
}
export function PayloadModal({ open, onClose, redactedPrompt, redactions, fileNames, shieldOn, }) {
    const [copied, setCopied] = useState(false);
    const [showOriginals, setShowOriginals] = useState(true);
    useEffect(() => {
        if (!open) {
            setCopied(false);
            setShowOriginals(true);
            return;
        }
        const onKey = (event) => {
            if (event.key === 'Escape')
                onClose();
        };
        document.addEventListener('keydown', onKey);
        document.body.classList.add('modal-open');
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.classList.remove('modal-open');
        };
    }, [open, onClose]);
    if (!open)
        return null;
    const payload = `${redactedPrompt || '[No prompt text]'}${fileNames.length
        ? `\n\n--- ATTACHMENTS (processed on device) ---\n${fileNames.map((name) => `• ${name}`).join('\n')}`
        : ''}`;
    const copyPayload = async () => {
        try {
            await navigator.clipboard.writeText(payload);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        }
        catch {
            setCopied(false);
        }
    };
    return (_jsx("div", { className: "modal-backdrop", onMouseDown: (event) => event.target === event.currentTarget && onClose(), children: _jsxs("div", { className: "payload-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "payload-title", children: [_jsxs("div", { className: "payload-header", children: [_jsxs("div", { children: [_jsx("span", { className: "eyebrow", children: "PII shield / audit view" }), _jsx("h2", { id: "payload-title", children: "See exactly what leaves." })] }), _jsx("button", { type: "button", className: "icon-button", onClick: onClose, "aria-label": "Close audit view", children: _jsx(X, { size: 19 }) })] }), _jsxs("div", { className: "payload-status", children: [_jsx("div", { className: "payload-status-icon", children: _jsx(ShieldCheck, { size: 22 }) }), _jsxs("div", { children: [_jsx("strong", { children: shieldOn ? 'Shield is active' : 'Shield is off' }), _jsx("span", { children: shieldOn
                                        ? `${redactions.length} identifier${redactions.length === 1 ? '' : 's'} will be replaced before the request leaves this tab.`
                                        : 'Your prompt will be sent without redaction. Names can identify you.' })] }), _jsx("div", { className: "payload-status-code", children: shieldOn ? 'On' : 'Off' })] }), _jsxs("div", { className: "payload-grid", children: [_jsxs("div", { className: "payload-pane", children: [_jsxs("div", { className: "pane-top", children: [_jsx("span", { children: "Request preview" }), _jsxs("button", { type: "button", className: "subtle-button", onClick: copyPayload, children: [copied ? _jsx(Check, { size: 13 }) : _jsx(Copy, { size: 13 }), copied ? 'Copied' : 'Copy'] })] }), _jsxs("div", { className: "payload-code", children: [_jsx("span", { className: "code-label", children: "Prompt" }), _jsx("pre", { children: payload })] }), _jsxs("div", { className: "payload-footnote", children: [_jsx(LockKeyhole, { size: 13 }), "File contents are read on this device. Only the placeholder text above is routed to the model."] })] }), _jsxs("div", { className: "substitution-pane", children: [_jsxs("div", { className: "pane-top", children: [_jsx("span", { children: "Substitutions" }), _jsxs("button", { type: "button", className: "subtle-button", onClick: () => setShowOriginals((value) => !value), "aria-pressed": showOriginals, children: [_jsx(RotateCcw, { size: 13 }), " ", showOriginals ? 'Hide originals' : 'Show originals'] })] }), redactions.length === 0 ? (_jsxs("div", { className: "empty-shield", children: [_jsx(ShieldCheck, { size: 24 }), _jsx("strong", { children: "Nothing detected" }), _jsx("p", { children: "No names, emails, or phone numbers were found in the current context." })] })) : (_jsx("div", { className: "substitution-list", children: redactions.map((item) => (_jsxs("div", { className: "substitution-row", children: [_jsx("span", { className: `substitution-icon ${item.kind}`, children: _jsx(KindIcon, { kind: item.kind }) }), _jsxs("span", { className: "substitution-original", children: [showOriginals ? item.original : '••••••••', _jsx("small", { children: item.kind })] }), _jsx("span", { className: "substitution-arrow", children: "\u2192" }), _jsx("code", { children: item.placeholder })] }, `${item.kind}-${item.original}`))) })), _jsxs("div", { className: "substitution-summary", children: [_jsxs("div", { children: [_jsx("span", { children: "Names" }), _jsx("strong", { children: redactions.filter((item) => item.kind === 'name').length })] }), _jsxs("div", { children: [_jsx("span", { children: "Emails" }), _jsx("strong", { children: redactions.filter((item) => item.kind === 'email').length })] }), _jsxs("div", { children: [_jsx("span", { children: "Phones" }), _jsx("strong", { children: redactions.filter((item) => item.kind === 'phone').length })] })] }), _jsx("p", { className: "rehydrate-note", children: "When the answer comes back, placeholders are restored to the original names inside this browser. Chat history is saved in this browser only \u2014 never on the server." })] })] }), _jsxs("div", { className: "payload-footer", children: [_jsxs("span", { children: [_jsx("span", { className: "status-dot" }), " Local scan \u00B7 0 names in transit"] }), _jsx("button", { type: "button", className: "button button-primary compact-button", onClick: onClose, children: "Close audit view" })] })] }) }));
}

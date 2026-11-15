import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
import { ArrowUp, FileCode2, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Paperclip, ArrowLeftRight, Square, TriangleAlert, X, } from 'lucide-react';
import { attachmentTokens, estimateTextTokens } from '../lib/context';
import { formatBytes } from '../lib/privacy';
function FileGlyph({ kind }) {
    if (kind === 'image')
        return _jsx(ImageIcon, { size: 13 });
    if (kind === 'sheet')
        return _jsx(FileSpreadsheet, { size: 13 });
    if (kind === 'code')
        return _jsx(FileCode2, { size: 13 });
    return _jsx(FileText, { size: 13 });
}
export function Composer({ text, onTextChange, attachments, uploadError, reading, isGenerating, routingWarning, routeNotice, textareaRef, onFixRouting, onDismissRouteNotice, onAttachFiles, onRemoveFile, onSend, onStop, }) {
    const fileInputRef = useRef(null);
    const tokens = estimateTextTokens(text) +
        attachments.reduce((sum, file) => sum + attachmentTokens(file), 0);
    const unreadableImages = attachments.filter((file) => file.kind === 'image' && !file.dataUrl);
    const imageWarning = unreadableImages.length
        ? unreadableImages
            .map((file) => `${file.name}: ${file.imageError ?? 'This image could not be prepared for sending on this device.'}`)
            .join(' ')
        : '';
    const composerError = [uploadError, imageWarning].filter(Boolean).join(' ');
    const canSend = (text.trim().length > 0 || attachments.length > 0) &&
        !reading &&
        !isGenerating &&
        !routingWarning &&
        !unreadableImages.length;
    useEffect(() => {
        const el = textareaRef.current;
        if (!el)
            return;
        el.style.height = '0px';
        el.style.height = `${Math.min(200, Math.max(28, el.scrollHeight))}px`;
    }, [text, textareaRef]);
    const handleFileInput = (event) => {
        if (event.target.files)
            onAttachFiles(event.target.files);
        event.target.value = '';
    };
    const submit = () => {
        if (!canSend)
            return;
        onSend();
    };
    return (_jsx("div", { className: "composer-wrap", children: _jsxs("div", { className: `composer ${isGenerating ? 'is-busy' : ''}`, children: [_jsx("input", { ref: fileInputRef, type: "file", multiple: true, hidden: true, onChange: handleFileInput, disabled: isGenerating }), attachments.length > 0 && (_jsx("div", { className: "composer-files", children: attachments.map((file) => (_jsxs("span", { className: `composer-file${file.kind === 'image' && !file.dataUrl ? ' is-error' : ''}`, title: file.imageError, children: [_jsx("span", { className: `composer-file-glyph ${file.kind}`, children: _jsx(FileGlyph, { kind: file.kind }) }), _jsxs("span", { className: "composer-file-copy", children: [_jsx("strong", { children: file.name }), _jsxs("small", { children: [formatBytes(file.size), " \u00B7", ' ', file.kind === 'image'
                                                ? file.dataUrl
                                                    ? 'vision ready'
                                                    : 'not sendable'
                                                : file.text
                                                    ? 'read locally'
                                                    : 'held locally'] })] }), _jsx("button", { type: "button", onClick: () => onRemoveFile(file.id), "aria-label": `Remove ${file.name}`, disabled: isGenerating, children: _jsx(X, { size: 12 }) })] }, file.id))) })), composerError && (_jsx("p", { className: "composer-error", role: "alert", children: composerError })), routingWarning && (_jsxs("div", { className: "composer-routing", role: "alert", children: [_jsx(TriangleAlert, { size: 13 }), _jsx("span", { children: routingWarning }), _jsx("button", { type: "button", onClick: onFixRouting, children: "Switch model" })] })), routeNotice && (_jsxs("div", { className: "composer-route-note", role: "status", children: [_jsx(ArrowLeftRight, { size: 12 }), _jsx("span", { children: routeNotice }), _jsx("button", { type: "button", onClick: onDismissRouteNotice, "aria-label": "Dismiss model switch notice", children: _jsx(X, { size: 11 }) })] })), _jsx("textarea", { ref: textareaRef, value: text, onChange: (event) => onTextChange(event.target.value), onKeyDown: (event) => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            submit();
                        }
                    }, onPaste: (event) => {
                        if (isGenerating || reading)
                            return;
                        const files = Array.from(event.clipboardData?.files ?? []);
                        if (!files.length)
                            return;
                        // Pasted screenshots and copied files attach instead of turning
                        // into unusable text.
                        event.preventDefault();
                        onAttachFiles(files);
                    }, placeholder: "Message Mint\u2026", "aria-label": "Message", rows: 1, maxLength: 8000, spellCheck: true }), _jsxs("div", { className: "composer-toolbar", children: [_jsx("div", { className: "composer-tools", children: _jsx("button", { type: "button", className: "composer-tool", onClick: () => fileInputRef.current?.click(), disabled: isGenerating || reading, "aria-label": "Attach files, up to 25 megabytes each", title: "Attach files", children: reading ? _jsx(Loader2, { size: 15, className: "spin" }) : _jsx(Paperclip, { size: 15 }) }) }), _jsxs("div", { className: "composer-submit-group", children: [tokens > 0 && (_jsxs("span", { className: "composer-tokens", children: [tokens.toLocaleString(), " tokens"] })), text.length > 7000 && _jsxs("span", { className: "composer-chars", children: [text.length, "/8,000"] }), isGenerating ? (_jsx("button", { type: "button", className: "send-button stop", onClick: onStop, "aria-label": "Stop generating", children: _jsx(Square, { size: 14, fill: "currentColor" }) })) : (_jsx("button", { type: "button", className: "send-button", onClick: submit, disabled: !canSend, "aria-label": "Send message", children: _jsx(ArrowUp, { size: 17 }) }))] })] })] }) }));
}

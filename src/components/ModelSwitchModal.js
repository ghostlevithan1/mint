import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
import { ArrowRight, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { MODEL_TYPES, typeInfo } from '../lib/data';
import { ModelCapabilityBadges, ModelLogo } from './ModelLogo';
export function ModelSwitchModal({ open, need, current, alternatives, fileCount, onClose, onChoose, }) {
    const panelRef = useRef(null);
    useEffect(() => {
        if (!open)
            return;
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
    }, [open, onClose]);
    if (!open || !alternatives.length)
        return null;
    const groups = MODEL_TYPES.map((type) => ({
        type,
        items: alternatives.filter((model) => model.type === type.id),
    })).filter((group) => group.items.length);
    const fileNoun = need === 'image'
        ? fileCount === 1
            ? 'image'
            : 'images'
        : fileCount === 1
            ? 'file'
            : 'files';
    return (_jsx("div", { className: "modal-backdrop", onMouseDown: (event) => event.target === event.currentTarget && onClose(), children: _jsxs("div", { className: "model-switch-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "model-switch-title", tabIndex: -1, ref: panelRef, children: [_jsx("button", { type: "button", className: "icon-button modal-close", onClick: onClose, "aria-label": "Close", children: _jsx(X, { size: 15 }) }), _jsxs("div", { className: "switch-head", children: [_jsx("span", { className: "switch-icon", "aria-hidden": "true", children: _jsx(TriangleAlert, { size: 17 }) }), _jsxs("div", { children: [_jsx("p", { className: "switch-kicker", children: "Model switch needed" }), _jsxs("h2", { id: "model-switch-title", children: ["This ", need === 'image' ? 'image' : 'file', " needs a model that can read it"] })] })] }), _jsxs("p", { className: "switch-copy", children: [_jsx("strong", { children: typeInfo(current.type).label }), " has no", ' ', need === 'image' ? 'vision' : 'compatible', " model, so it cannot read your", ' ', fileNoun, ". Switch to one of these \u2014 your ", fileNoun, ' ', fileCount === 1 ? 'stays' : 'stay', " attached."] }), _jsx("div", { className: "switch-options", children: groups.map((group) => (_jsxs("section", { className: "switch-group", children: [_jsxs("div", { className: "switch-group-head", children: [_jsx("span", { className: "model-group-dot", style: { background: group.type.color } }), _jsx("strong", { style: { color: group.type.color }, children: group.type.label }), _jsx("em", { children: group.type.tagline })] }), group.items.map((model) => (_jsxs("button", { type: "button", className: "switch-option", onClick: () => onChoose(model), children: [_jsx("span", { className: "model-choice-glyph", children: _jsx(ModelLogo, { maker: model.maker, size: 17 }) }), _jsxs("span", { className: "switch-option-copy", children: [_jsx("span", { children: _jsx("strong", { children: model.name }) }), _jsxs("em", { children: [model.maker, " \u00B7 ", model.bestAt] }), _jsx(ModelCapabilityBadges, { model: model })] }), _jsxs("span", { className: "switch-option-cta", children: ["Switch", _jsx(ArrowRight, { size: 12 })] })] }, model.id)))] }, group.type.id))) }), _jsxs("p", { className: "switch-foot", children: [_jsx(ShieldCheck, { size: 11 }), "Model type is preserved when possible; this switch only changes what can read the", ' ', fileNoun, "."] })] }) }));
}

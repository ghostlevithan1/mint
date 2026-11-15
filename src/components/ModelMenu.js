import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { MODEL_TYPES, MODELS, modelsByType, typeInfo } from '../lib/data';
import { ModelCapabilityBadges, ModelLogo } from './ModelLogo';
export function ModelMenu({ model, onSelect }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const currentType = typeInfo(model.type);
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
    return (_jsxs("div", { className: "model-menu-wrap", ref: wrapRef, children: [_jsxs("button", { type: "button", className: "model-trigger", onClick: () => setOpen((value) => !value), "aria-haspopup": "listbox", "aria-expanded": open, children: [_jsx("span", { className: "model-glyph", children: _jsx(ModelLogo, { maker: model.maker, size: 15 }) }), _jsx("span", { className: "model-trigger-name", children: model.name }), _jsx("span", { className: "model-type-chip", style: { color: currentType.color }, children: currentType.label }), _jsx(ChevronDown, { size: 13, className: open ? 'is-open' : '' })] }), open && (_jsxs("div", { className: "model-popover", role: "listbox", "aria-label": "Choose a model", children: [_jsxs("div", { className: "model-popover-head", children: [_jsx("span", { children: "Model type" }), _jsxs("span", { children: [MODELS.length, " models \u00B7 ", MODEL_TYPES.length, " tiers"] })] }), _jsx("div", { className: "model-groups", children: MODEL_TYPES.map((type) => {
                            const items = modelsByType(type.id);
                            if (!items.length)
                                return null;
                            return (_jsxs("section", { className: "model-group", children: [_jsxs("div", { className: "model-group-head", children: [_jsx("span", { className: "model-group-dot", style: { background: type.color } }), _jsx("strong", { style: { color: type.color }, children: type.label }), _jsx("em", { children: type.detail }), _jsx("span", { className: "model-group-count", children: items.length })] }), items.map((item) => {
                                        const selected = item.id === model.id;
                                        return (_jsxs("button", { type: "button", role: "option", "aria-selected": selected, className: `model-choice ${selected ? 'is-selected' : ''}`, onClick: () => {
                                                onSelect(item.id);
                                                setOpen(false);
                                            }, children: [_jsx("span", { className: "model-choice-glyph", children: _jsx(ModelLogo, { maker: item.maker, size: 17 }) }), _jsxs("span", { className: "model-choice-copy", children: [_jsxs("span", { children: [_jsx("strong", { children: item.name }), _jsx("small", { children: item.maker })] }), _jsx("em", { className: "model-choice-best", children: item.bestAt }), _jsxs("span", { className: "model-choice-tags", children: [_jsx(ModelCapabilityBadges, { model: item }), _jsxs("small", { children: [item.meta, " \u00B7 ", item.context, " context"] })] })] }), _jsxs("span", { className: "model-choice-speed", children: [item.tps, _jsx("small", { children: "TPS" })] }), _jsx("span", { className: "model-choice-check", children: selected && _jsx(Check, { size: 14 }) })] }, item.id));
                                    })] }, type.id));
                        }) }), _jsx("p", { className: "model-popover-note", children: "Model type sets the reasoning depth. Applies to your next message \u2014 switch any time." })] }))] }));
}

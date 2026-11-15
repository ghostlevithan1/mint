import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { modelCapabilities } from '../lib/data';
import { Eye, FileText } from 'lucide-react';
import { MODEL_LOGOS } from './modelLogoPaths';
const LOGO_COLORS = {
    NVIDIA: '#76B900',
    DeepSeek: '#4D6BFE',
    Meta: '#0866FF',
    Google: '#4285F4',
    'Thinking Machines': '#E8E3D6',
    Poolside: '#59B8FF',
};
function LogoMark({ maker }) {
    const logo = MODEL_LOGOS[maker];
    if (!logo)
        return _jsx("circle", { cx: "12", cy: "12", r: "8", fill: "currentColor", opacity: ".8" });
    return _jsx("path", { d: logo.path, fill: "currentColor" });
}
export function ModelLogo({ maker, size = 16, className = '', }) {
    const logo = MODEL_LOGOS[maker];
    return (_jsx("span", { className: `model-logo ${className}`.trim(), style: { color: LOGO_COLORS[maker] ?? 'currentColor' }, "aria-hidden": "true", title: maker, children: _jsx("svg", { width: size, height: size, viewBox: logo?.viewBox ?? '0 0 24 24', fill: "none", children: _jsx(LogoMark, { maker: maker }) }) }));
}
function CapabilityIcon({ capability }) {
    if (capability === 'image')
        return _jsx(Eye, { size: 9 });
    return _jsx(FileText, { size: 9 });
}
const CAPABILITY_LABEL = {
    text: 'Text',
    image: 'Vision',
};
export function ModelCapabilityBadges({ model, showText = true, }) {
    const capabilities = modelCapabilities(model);
    return (_jsx("span", { className: "model-caps", children: capabilities.map((capability) => {
            if (!showText && capability === 'text')
                return null;
            return (_jsxs("span", { className: `model-cap-badge cap-${capability}`, children: [_jsx(CapabilityIcon, { capability: capability }), CAPABILITY_LABEL[capability]] }, capability));
        }) }));
}

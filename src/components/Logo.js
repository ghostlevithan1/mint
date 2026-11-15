import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Mint's mark: a mint leaf split along its midrib, in one flat colour. */
export function LeafMark({ size = 20 }) {
    return (_jsxs("svg", { className: "leaf-mark", viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": "true", children: [_jsx("path", { d: "M4 20C4 11 10 4 20 4Z", transform: "translate(-0.7 -0.7)", fill: "currentColor" }), _jsx("path", { d: "M20 4C20 14 13 20 4 20Z", transform: "translate(0.7 0.7)", fill: "currentColor" }), _jsx("path", { d: "M4.6 19.4 2 22", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" })] }));
}
export function Logo() {
    return (_jsxs("a", { className: "brand", href: "#top", "aria-label": "Mint home", children: [_jsx("span", { className: "brand-mark", children: _jsx(LeafMark, {}) }), _jsx("strong", { className: "brand-word", children: "Mint" })] }));
}

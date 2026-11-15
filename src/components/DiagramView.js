import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useMemo } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { DiagramError, parseDiagramSpec, wrapLabel } from '../lib/diagramSpec';
const W = 560;
const H = 380;
const CX = W / 2;
const CY = H / 2;
const polar = (radius, angle) => [
    CX + radius * Math.cos(angle),
    CY + radius * Math.sin(angle),
];
/** A label placed outside the ring, anchored away from the centre so it never overlaps the drawing. */
function OuterLabel({ angle, radius, label }) {
    const [x, y] = polar(radius, angle);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
    const lines = wrapLabel(label);
    const shift = sin < -0.3 ? -(lines.length - 1) * 16 : sin > 0.3 ? 4 : -((lines.length - 1) * 16) / 2;
    return (_jsx("text", { className: "diagram-label", x: x, y: y + shift, textAnchor: anchor, dominantBaseline: "middle", children: lines.map((line, i) => (_jsx("tspan", { x: x, dy: i === 0 ? 0 : 16, children: line }, i))) }));
}
function Cycle({ nodes }) {
    const n = nodes.length;
    const R = 112;
    const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const gap = 0.24;
    return (_jsxs("svg", { className: "diagram-svg", viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", children: [_jsx("defs", { children: _jsx("marker", { id: "dg-arrow", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto", children: _jsx("path", { d: "M1 1 9 5 1 9", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round" }) }) }), nodes.map((_, i) => {
                const [x1, y1] = polar(R, angle(i) + gap);
                const [x2, y2] = polar(R, angle(i + 1) - gap);
                return (_jsx("path", { className: "diagram-arrow", d: `M${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2}`, markerEnd: "url(#dg-arrow)" }, `a${i}`));
            }), nodes.map((node, i) => {
                const [x, y] = polar(R, angle(i));
                return (_jsxs("g", { children: [_jsx("circle", { className: "diagram-dot", cx: x, cy: y, r: 15 }), _jsx("text", { className: "diagram-num", x: x, y: y, textAnchor: "middle", dominantBaseline: "central", children: i + 1 }), _jsx(OuterLabel, { angle: angle(i), radius: R + 30, label: node.label })] }, i));
            })] }));
}
function Hub({ nodes }) {
    const [centre, ...branches] = nodes;
    const n = branches.length;
    const R = 120;
    const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const centreLines = wrapLabel(centre.label, 12);
    return (_jsxs("svg", { className: "diagram-svg", viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", children: [branches.map((_, i) => {
                const [x1, y1] = polar(52, angle(i));
                const [x2, y2] = polar(R, angle(i));
                return _jsx("line", { className: "diagram-branch", x1: x1, y1: y1, x2: x2, y2: y2 }, `l${i}`);
            }), _jsx("circle", { className: "diagram-centre", cx: CX, cy: CY, r: 52 }), _jsx("text", { className: "diagram-centre-label", x: CX, y: CY - ((centreLines.length - 1) * 16) / 2, textAnchor: "middle", dominantBaseline: "middle", children: centreLines.map((line, i) => (_jsx("tspan", { x: CX, dy: i === 0 ? 0 : 16, children: line }, i))) }), branches.map((node, i) => {
                const [x, y] = polar(R, angle(i));
                return (_jsxs("g", { children: [_jsx("circle", { className: "diagram-dot is-small", cx: x, cy: y, r: 5 }), _jsx(OuterLabel, { angle: angle(i), radius: R + 16, label: node.label })] }, i));
            })] }));
}
/**
 * Draws the fenced ```diagram spec: a numbered process, a cycle, or a central
 * idea with its parts. Details go in a list under the drawing, so the drawing
 * stays readable and the text stays selectable.
 */
export const DiagramView = memo(function DiagramView({ spec, streaming = false }) {
    const result = useMemo(() => {
        try {
            return { diagram: parseDiagramSpec(spec) };
        }
        catch (error) {
            return { error: error instanceof DiagramError ? error.message : 'The diagram could not be drawn.' };
        }
    }, [spec]);
    if ('error' in result) {
        return streaming ? (_jsxs("div", { className: "plot-pending", role: "status", children: [_jsx(Loader2, { size: 16, className: "spin", "aria-hidden": "true" }), _jsx("span", { children: "Drawing the diagram" })] })) : (_jsxs("div", { className: "plot-error", role: "status", children: [_jsx(TriangleAlert, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: result.error })] }));
    }
    const { diagram } = result;
    // Steps are the list itself; cycles and hubs list only when there is detail to add.
    const details = diagram.type === 'hub'
        ? diagram.nodes.slice(1).filter((node) => node.detail)
        : diagram.type === 'steps' || diagram.nodes.some((node) => node.detail)
            ? diagram.nodes
            : [];
    return (_jsxs("figure", { className: `diagram diagram-${diagram.type}`, children: [diagram.title && _jsx("figcaption", { className: "plot-title", children: diagram.title }), diagram.type === 'cycle' && _jsx(Cycle, { ...diagram }), diagram.type === 'hub' && _jsx(Hub, { ...diagram }), details.length > 0 && (_jsx("ol", { className: "diagram-list", children: details.map((node, i) => (_jsxs("li", { children: [_jsx("span", { className: "diagram-step", children: diagram.type === 'hub' ? '' : i + 1 }), _jsxs("div", { children: [_jsx("strong", { children: node.label }), node.detail && _jsx("p", { children: node.detail })] })] }, i))) }))] }));
});

import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { compileExpression, formatTick, niceTicks, parsePlotSpec, PlotError, sharedTicks } from '../lib/plotSpec';
import { clampLabel, estimateTextWidth, insideArea, nearestOnSegment, panView, placeMarkerLabels, placeReadout, squareView, zoomView } from '../lib/plotGeometry';
const W = 640;
const H = 360;
// The left margin is wide enough for a 6-character tick label (e.g. -1.0e+5)
// to end at x = 48 and still start inside the canvas.
const M = { top: 16, right: 20, bottom: 40, left: 56 };
const IW = W - M.left - M.right;
const IH = H - M.top - M.bottom;
const SERIES = ['#86d95f', '#8fb4d9', '#e0b26a', '#d6a28c', '#5fc8b0', '#e5484d', '#c9c9cd', '#a1c96a'];
/** How close a click must land, in viewBox units, to count as hitting a curve. */
const HIT_RADIUS = 18;
const ZOOM_SPEED = 0.0015;
/** Pointer movement below this many units is a click, not a drag. */
const DRAG_THRESHOLD = 3;
/** Radius of the dot shown on a clicked point. */
const DOT_RADIUS = 4.5;
function coordinate(value) {
    if (value === 0)
        return '0';
    const abs = Math.abs(value);
    if (abs >= 1e6 || abs < 1e-4)
        return value.toExponential(2);
    return String(Number(value.toPrecision(5)));
}
function Chart({ data }) {
    const interactive = data.chart === 'line' || data.chart === 'scatter';
    const isBars = !interactive;
    const initial = useMemo(() => {
        const base = { x0: data.xRange[0], x1: data.xRange[1], y0: data.yRange[0], y1: data.yRange[1] };
        // Line and scatter graphs use square units, like a Desmos window. The
        // extra room always goes to the smaller axis, so nothing is cut off.
        return interactive ? squareView(base, IW / IH) : base;
    }, [data, interactive]);
    // Equation curves are sampled over the starting window, which square units
    // may widen, so the drawn curve reaches the edges of the plot.
    const lines = useMemo(() => {
        if (!interactive)
            return data.lines;
        const samples = 600;
        return data.lines.map((line) => {
            if (!line.expr)
                return line;
            try {
                const fn = compileExpression(line.expr);
                const points = [];
                for (let i = 0; i < samples; i += 1) {
                    const x = initial.x0 + ((initial.x1 - initial.x0) * i) / (samples - 1);
                    points.push([x, fn(x)]);
                }
                return { ...line, points };
            }
            catch {
                return line;
            }
        });
    }, [data.lines, initial, interactive]);
    const [view, setView] = useState(initial);
    const [selection, setSelection] = useState(null);
    const [barPick, setBarPick] = useState(null);
    const [dragging, setDragging] = useState(false);
    const svgRef = useRef(null);
    const viewRef = useRef(view);
    const dragRef = useRef(null);
    const { x0, x1, y0, y1 } = view;
    const sx = (x) => M.left + ((x - x0) / (x1 - x0)) * IW;
    const sy = (y) => M.top + (1 - (y - y0) / (y1 - y0)) * IH;
    // A new spec (a different graph) starts from its own default window.
    useEffect(() => {
        setView(initial);
        setSelection(null);
        setBarPick(null);
    }, [initial]);
    useEffect(() => {
        viewRef.current = view;
    }, [view]);
    /** Cursor position in viewBox units plus the data value under it. */
    const pointAt = useCallback((current, clientX, clientY) => {
        const svg = svgRef.current;
        if (!svg)
            return null;
        const rect = svg.getBoundingClientRect();
        if (!rect.width || !rect.height)
            return null;
        const px = ((clientX - rect.left) / rect.width) * W;
        const py = ((clientY - rect.top) / rect.height) * H;
        if (px < M.left || px > W - M.right || py < M.top || py > H - M.bottom)
            return null;
        return {
            px,
            py,
            x: current.x0 + ((px - M.left) / IW) * (current.x1 - current.x0),
            y: current.y0 + (1 - (py - M.top) / IH) * (current.y1 - current.y0),
        };
    }, []);
    // Wheel is registered by hand because React's synthetic wheel listener is
    // passive, so preventDefault() there would not stop the page from scrolling.
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg || !interactive)
            return;
        const onWheel = (event) => {
            const point = pointAt(viewRef.current, event.clientX, event.clientY);
            if (!point)
                return;
            event.preventDefault();
            const factor = Math.exp(event.deltaY * ZOOM_SPEED);
            setView((current) => zoomView(current, point, factor, initial));
        };
        svg.addEventListener('wheel', onWheel, { passive: false });
        return () => svg.removeEventListener('wheel', onWheel);
    }, [interactive, initial, pointAt]);
    const reset = () => {
        setView(initial);
        setSelection(null);
        setBarPick(null);
    };
    const onPointerDown = (event) => {
        if (event.button !== 0)
            return;
        const point = pointAt(view, event.clientX, event.clientY);
        if (!point)
            return;
        // Capture keeps the drag alive when the pointer leaves the chart, but it is
        // not available for every pointer (or synthetic event), so it is optional.
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        catch {
            // keep dragging without capture
        }
        dragRef.current = { id: event.pointerId, px: point.px, py: point.py, view, moved: false };
        setDragging(true);
    };
    const onPointerMove = (event) => {
        const drag = dragRef.current;
        if (!drag || drag.id !== event.pointerId)
            return;
        const svg = svgRef.current;
        if (!svg)
            return;
        const rect = svg.getBoundingClientRect();
        if (!rect.width || !rect.height)
            return;
        const px = ((event.clientX - rect.left) / rect.width) * W;
        const py = ((event.clientY - rect.top) / rect.height) * H;
        const dxPx = px - drag.px;
        const dyPx = py - drag.py;
        if (!drag.moved && Math.hypot(dxPx, dyPx) <= DRAG_THRESHOLD)
            return;
        drag.moved = true;
        const dx = -(dxPx / IW) * (drag.view.x1 - drag.view.x0);
        const dy = (dyPx / IH) * (drag.view.y1 - drag.view.y0);
        setView(panView(drag.view, dx, dy, initial));
    };
    const onPointerUp = (event) => {
        const drag = dragRef.current;
        if (!drag || drag.id !== event.pointerId)
            return;
        dragRef.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (!drag.moved)
            setSelection(findSelection(event.clientX, event.clientY));
    };
    const onPointerCancel = (event) => {
        if (dragRef.current?.id !== event.pointerId)
            return;
        dragRef.current = null;
        setDragging(false);
    };
    /** Nearest point on any curve, within the click radius, in data space. */
    const findSelection = (clientX, clientY) => {
        const point = pointAt(viewRef.current, clientX, clientY);
        if (!point)
            return null;
        const current = viewRef.current;
        let best = null;
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const color = SERIES[index % SERIES.length];
            if (line.mode === 'scatter') {
                for (const [x, y] of line.points) {
                    if (!Number.isFinite(y))
                        continue;
                    const distance = Math.hypot(sx(x) - point.px, sy(y) - point.py);
                    if (distance <= HIT_RADIUS && (!best || distance < best.distance)) {
                        best = { x, y, label: line.label, color, distance };
                    }
                }
                continue;
            }
            let previous = null;
            for (const [x, y] of line.points) {
                if (!Number.isFinite(y) || y < current.y0 - (current.y1 - current.y0) || y > current.y1 + (current.y1 - current.y0)) {
                    previous = null;
                    continue;
                }
                const next = { x: sx(x), y: sy(y) };
                if (previous) {
                    const hit = nearestOnSegment({ x: point.px, y: point.py }, previous, next);
                    if (hit.distance <= HIT_RADIUS && (!best || hit.distance < best.distance)) {
                        best = {
                            x: current.x0 + ((hit.x - M.left) / IW) * (current.x1 - current.x0),
                            y: current.y0 + (1 - (hit.y - M.top) / IH) * (current.y1 - current.y0),
                            label: line.label,
                            color,
                            distance: hit.distance,
                        };
                    }
                }
                previous = next;
            }
        }
        return best;
    };
    const tickStep = interactive ? sharedTicks(x0, x1, y0, y1) : null;
    const yTicks = tickStep ? tickStep.y : niceTicks(y0, y1, 5);
    const xTicks = tickStep ? tickStep.x : [];
    const inside = (y) => y >= y0 - (y1 - y0) && y <= y1 + (y1 - y0);
    // Breaks the path at gaps, so asymptotes and undefined regions are not joined.
    const path = (points) => {
        let d = '';
        let pen = false;
        for (const [x, y] of points) {
            if (!Number.isFinite(y) || !inside(y)) {
                pen = false;
                continue;
            }
            d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`;
            pen = true;
        }
        return d;
    };
    const band = isBars ? IW / Math.max(1, data.bars.length) : 0;
    const showEveryLabel = data.bars.length <= 12;
    const pickedBar = barPick !== null ? data.bars[barPick] : null;
    const zoomed = x1 - x0 < initial.x1 - initial.x0 - 1e-9 || y1 - y0 < initial.y1 - initial.y0 - 1e-9;
    const dotX = selection ? sx(selection.x) : 0;
    const dotY = selection ? sy(selection.y) : 0;
    const showSeries = lines.length > 1;
    const readoutLabel = selection && selection.label.length > 26 ? `${selection.label.slice(0, 25)}…` : (selection?.label ?? '');
    const readoutLines = selection
        ? [
            ...(showSeries ? [readoutLabel] : []),
            `x = ${coordinate(selection.x)}`,
            `y = ${coordinate(selection.y)}`,
        ]
        : [];
    // Rough width of the 12px monospace readout, in viewBox units, so it can be
    // kept inside the plot frame instead of spilling over the axes.
    const readoutWidth = Math.max(0, ...readoutLines.map(estimateTextWidth)) + 4;
    const readout = selection
        ? placeReadout({ x: dotX, y: dotY }, readoutLines.length, readoutWidth, {
            left: M.left,
            right: W - M.right,
            top: M.top,
            bottom: H - M.bottom,
        })
        : null;
    const markerLabels = placeMarkerLabels(data.markers.map((point) => ({ x: sx(point.x), y: sy(point.y) })), data.markers.map((point) => estimateTextWidth(point.label ?? '')), { left: M.left, right: W - M.right, top: M.top, bottom: H - M.bottom });
    // Panning or zooming can carry a selected point out of the frame. The dot and
    // guide lines must not be drawn outside the graph, so hide them there.
    const pointInside = selection !== null &&
        insideArea({ x: dotX, y: dotY }, { left: M.left, right: W - M.right, top: M.top, bottom: H - M.bottom }, DOT_RADIUS);
    return (_jsxs("div", { className: "plot-canvas", children: [_jsxs("svg", { ref: svgRef, className: "plot-svg", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": data.title || 'Graph', onClick: interactive ? undefined : () => setBarPick(null), children: [_jsx("defs", { children: _jsx("clipPath", { id: "plot-area", children: _jsx("rect", { x: M.left, y: M.top, width: IW, height: IH }) }) }), yTicks.map((t) => (_jsxs("g", { children: [data.grid && _jsx("line", { className: "plot-grid", x1: M.left, x2: W - M.right, y1: sy(t), y2: sy(t) }), _jsx("text", { className: "plot-tick", x: M.left - 8, y: sy(t), textAnchor: "end", dominantBaseline: "middle", children: formatTick(t, M.left - 10) })] }, `y${t}`))), xTicks.map((t) => {
                        const label = formatTick(t, W);
                        // The first and last ticks sit on the frame, so nudge their labels in
                        // rather than letting them hang outside the graph.
                        const labelX = clampLabel(sx(t), estimateTextWidth(label), M.left, W - M.right);
                        return (_jsxs("g", { children: [data.grid && _jsx("line", { className: "plot-grid", y1: M.top, y2: H - M.bottom, x1: sx(t), x2: sx(t) }), _jsx("text", { className: "plot-tick", x: labelX, y: H - M.bottom + 18, textAnchor: "middle", children: label })] }, `x${t}`));
                    }), y0 < 0 && y1 > 0 && _jsx("line", { className: "plot-axis", x1: M.left, x2: W - M.right, y1: sy(0), y2: sy(0) }), !isBars && x0 < 0 && x1 > 0 && (_jsx("line", { className: "plot-axis", y1: M.top, y2: H - M.bottom, x1: sx(0), x2: sx(0) })), _jsx("line", { className: "plot-frame", x1: M.left, x2: W - M.right, y1: H - M.bottom, y2: H - M.bottom }), _jsxs("g", { clipPath: "url(#plot-area)", children: [isBars &&
                                data.bars.map((bar, i) => {
                                    const top = sy(Math.max(0, bar.value));
                                    const base = sy(Math.max(y0, Math.min(0, bar.value)));
                                    const gap = data.chart === 'histogram' ? 1 : band * 0.18;
                                    return (_jsx("rect", { className: "plot-bar", x: M.left + band * i + gap, y: Math.min(top, base), width: Math.max(1, band - gap * 2), height: Math.abs(base - top), rx: data.chart === 'histogram' ? 0 : 3, fill: SERIES[0], onClick: (event) => {
                                            event.stopPropagation();
                                            setBarPick(i);
                                        } }, i));
                                }), lines.map((line, i) => line.mode === 'scatter' ? (_jsx("g", { fill: SERIES[i % SERIES.length], children: line.points
                                    .filter(([, y]) => Number.isFinite(y))
                                    .map(([x, y], j) => (_jsx("circle", { cx: sx(x), cy: sy(y), r: 3 }, j))) }, i)) : (_jsx("path", { className: "plot-line", d: path(line.points), stroke: SERIES[i % SERIES.length] }, i))), data.markers.map((point, i) => (_jsxs("g", { className: "plot-marker", children: [_jsx("circle", { cx: sx(point.x), cy: sy(point.y), r: 5 }), point.label && (_jsx("text", { x: markerLabels[i].x, y: markerLabels[i].y, textAnchor: markerLabels[i].anchor, children: point.label }))] }, `m${i}`)))] }), isBars &&
                        data.bars.map((bar, i) => {
                            if (!(showEveryLabel || i % Math.ceil(data.bars.length / 8) === 0))
                                return null;
                            const label = bar.label.length > 10 ? `${bar.label.slice(0, 9)}…` : bar.label;
                            // Labels are centered on their band, so the outermost ones need a
                            // nudge inside rather than hanging over the frame.
                            const labelX = clampLabel(M.left + band * (i + 0.5), estimateTextWidth(label), M.left, W - M.right);
                            return (_jsx("text", { className: "plot-tick", x: labelX, y: H - M.bottom + 18, textAnchor: "middle", children: label }, `b${i}`));
                        }), pickedBar && barPick !== null && (() => {
                        const label = `${pickedBar.label.length > 16 ? `${pickedBar.label.slice(0, 15)}…` : pickedBar.label}: ${coordinate(pickedBar.value)}`;
                        // A bar can rise above the window, so hold the guide inside the frame.
                        const top = Math.max(M.top, Math.min(sy(Math.max(0, pickedBar.value)), sy(Math.max(y0, Math.min(0, pickedBar.value)))));
                        return (_jsxs("g", { pointerEvents: "none", children: [_jsx("line", { className: "plot-readout-guide", x1: M.left + band * (barPick + 0.5), x2: M.left + band * (barPick + 0.5), y1: top, y2: H - M.bottom }), _jsx("text", { className: "plot-readout-text", x: clampLabel(M.left + band * (barPick + 0.5), estimateTextWidth(label), M.left, W - M.right), y: Math.max(M.top + 14, top - 10), textAnchor: "middle", children: label })] }));
                    })(), selection && readout && (_jsxs("g", { pointerEvents: "none", children: [pointInside && (_jsxs(_Fragment, { children: [_jsx("line", { className: "plot-readout-guide", x1: dotX, x2: dotX, y1: M.top, y2: H - M.bottom }), _jsx("line", { className: "plot-readout-guide", x1: M.left, x2: W - M.right, y1: dotY, y2: dotY }), _jsx("circle", { className: "plot-readout-dot", cx: dotX, cy: dotY, r: DOT_RADIUS, fill: selection.color })] })), _jsxs("text", { className: "plot-readout-text", x: readout.x, y: readout.y, textAnchor: readout.anchor, children: [showSeries && (_jsx("tspan", { x: readout.x, y: readout.y, children: readoutLabel })), _jsx("tspan", { x: readout.x, y: readout.y + (showSeries ? 15 : 0), children: `x = ${coordinate(selection.x)}` }), _jsx("tspan", { x: readout.x, y: readout.y + (showSeries ? 30 : 15), children: `y = ${coordinate(selection.y)}` })] })] })), data.xLabel && (_jsx("text", { className: "plot-label", x: M.left + IW / 2, y: H - 4, textAnchor: "middle", children: data.xLabel })), data.yLabel && (_jsx("text", { className: "plot-label", transform: `translate(12 ${M.top + IH / 2}) rotate(-90)`, textAnchor: "middle", children: data.yLabel })), interactive && (_jsx("rect", { className: `plot-hit${dragging ? ' is-dragging' : ''}`, x: M.left, y: M.top, width: IW, height: IH, "aria-hidden": "true", onPointerDown: onPointerDown, onPointerMove: onPointerMove, onPointerUp: onPointerUp, onPointerCancel: onPointerCancel, onDoubleClick: reset }))] }), (zoomed || selection || barPick !== null) && interactive && (_jsx("button", { type: "button", className: "plot-reset", onClick: reset, children: "Reset view" }))] }));
}
/**
 * Draws the fenced ```plot spec the model emits, in the browser. While the
 * fence is still streaming the JSON is incomplete, so it shows a quiet
 * pending state instead of an error.
 */
export const PlotImage = memo(function PlotImage({ spec, streaming = false }) {
    const result = useMemo(() => {
        try {
            return { data: parsePlotSpec(spec) };
        }
        catch (error) {
            return { error: error instanceof PlotError ? error.message : 'The graph could not be drawn.' };
        }
    }, [spec]);
    if ('error' in result) {
        if (streaming) {
            return (_jsxs("div", { className: "plot-pending", role: "status", children: [_jsx(Loader2, { size: 16, className: "spin", "aria-hidden": "true" }), _jsx("span", { children: "Drawing the graph" })] }));
        }
        return (_jsxs("div", { className: "plot-error", role: "status", children: [_jsx(TriangleAlert, { size: 14, "aria-hidden": "true" }), _jsx("span", { children: result.error })] }));
    }
    const { data } = result;
    const legend = data.lines.length > 1;
    const interactive = data.chart === 'line' || data.chart === 'scatter';
    return (_jsxs("figure", { className: "plot-figure", children: [data.title && _jsx("figcaption", { className: "plot-title", children: data.title }), _jsx(Chart, { data: data }), legend && data.chart !== 'bar' && data.chart !== 'histogram' && (_jsx("ul", { className: "plot-legend", children: data.lines.map((line, i) => (_jsxs("li", { children: [_jsx("span", { style: { background: SERIES[i % SERIES.length] } }), line.label] }, i))) })), interactive ? (_jsx("p", { className: "plot-hint", children: "Scroll to zoom \u00B7 drag to pan \u00B7 click a curve for exact values \u00B7 double-click to reset" })) : (_jsx("p", { className: "plot-hint", children: "Click a bar for its exact value" }))] }));
});

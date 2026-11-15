/**
 * Parses the ```plot spec the model emits and turns it into drawable data.
 * Runs in the browser, so graphs need no server or Python. Equations go
 * through a small whitelist parser: nothing model-written is ever eval'd.
 */
import { estimateTextWidth } from './plotGeometry';
const MAX_EXPR_CHARS = 300;
const DEFAULT_SAMPLES = 400;
const MAX_SAMPLES = 2000;
const MAX_EQUATIONS = 6;
const MAX_SERIES = 8;
const MAX_SERIES_POINTS = 500;
const MAX_DATA_POINTS = 2000;
const MAX_CATEGORIES = 24;
const MAX_POINTS = 12;
const MAX_TEXT = 120;
export class PlotError extends Error {
}
const FUNCTIONS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    exp: Math.exp, log: Math.log, ln: Math.log, log2: Math.log2, log10: Math.log10,
    sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
    min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTANTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };
/** Unicode maths the model or a student may paste in, mapped to the parser's names. */
const SYMBOLS = {
    'π': ' pi ',
    'τ': ' tau ',
    '−': ' - ',
    '–': ' - ',
    '—': ' - ',
    '×': ' * ',
    '·': ' * ',
    '⋅': ' * ',
    '÷': ' / ',
};
function normalizeExpression(expr) {
    return expr.replace(/[πτ−–—×·⋅÷]/g, (symbol) => SYMBOLS[symbol] ?? symbol);
}
function tokenize(expr) {
    const tokens = normalizeExpression(expr).trim().replace(/\*\*/g, '^').match(/\d*\.?\d+(?:e[+-]?\d+)?|[a-z_][a-z0-9_]*|[-+*/^(),]|\S/gi);
    return tokens ?? [];
}
/** Compiles an equation in x to a function. Throws PlotError on anything outside the whitelist. */
export function compileExpression(expr) {
    const tokens = tokenize(expr.trim());
    let pos = 0;
    const peek = () => tokens[pos];
    const take = () => tokens[pos++];
    const expect = (token) => {
        if (take() !== token)
            throw new PlotError('The equation is not valid math syntax.');
    };
    const startsPrimary = (token) => token !== undefined && (token === '(' || /^[\d.a-z_]/i.test(token));
    function expression() {
        let left = term();
        while (peek() === '+' || peek() === '-') {
            const op = take();
            const a = left;
            const b = term();
            left = op === '+' ? (x) => a(x) + b(x) : (x) => a(x) - b(x);
        }
        return left;
    }
    function term() {
        let left = unary();
        for (;;) {
            const token = peek();
            if (token === '*' || token === '/') {
                take();
                const a = left;
                const b = unary();
                left = token === '*' ? (x) => a(x) * b(x) : (x) => a(x) / b(x);
            }
            else if (startsPrimary(token)) {
                // Implicit multiplication, as in 2x or 3sin(x).
                const a = left;
                const b = power();
                left = (x) => a(x) * b(x);
            }
            else {
                return left;
            }
        }
    }
    function unary() {
        if (peek() === '-') {
            take();
            const a = unary();
            return (x) => -a(x);
        }
        if (peek() === '+') {
            take();
            return unary();
        }
        return power();
    }
    function power() {
        const base = primary();
        if (peek() !== '^')
            return base;
        take();
        const exponent = unary();
        return (x) => Math.pow(base(x), exponent(x));
    }
    function primary() {
        const token = take();
        if (token === undefined)
            throw new PlotError('The equation ends too early.');
        if (token === '(') {
            const inner = expression();
            expect(')');
            return inner;
        }
        if (/^\d|^\./.test(token)) {
            const value = Number(token);
            if (!Number.isFinite(value))
                throw new PlotError('Numbers in equations must be finite.');
            return () => value;
        }
        const name = token.toLowerCase();
        if (name === 'x')
            return (x) => x;
        if (Object.hasOwn(CONSTANTS, name)) {
            const value = CONSTANTS[name];
            return () => value;
        }
        if (Object.hasOwn(FUNCTIONS, name) && peek() === '(') {
            take();
            const args = [expression()];
            while (peek() === ',') {
                take();
                args.push(expression());
            }
            expect(')');
            const fn = FUNCTIONS[name];
            return (x) => fn(...args.map((arg) => arg(x)));
        }
        throw new PlotError(`Unknown name "${token}" in the equation.`);
    }
    if (!tokens.length || expr.length > MAX_EXPR_CHARS) {
        throw new PlotError(`Equations must be 1-${MAX_EXPR_CHARS} characters.`);
    }
    const compiled = expression();
    if (pos < tokens.length)
        throw new PlotError('The equation is not valid math syntax.');
    return compiled;
}
// ---------- spec validation ----------
function text(value) {
    return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '';
}
function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
function numbers(value, field, max) {
    if (!Array.isArray(value) || value.length < 1 || value.length > max || !value.every(finite)) {
        throw new PlotError(`"${field}" must be a list of 1-${max} numbers.`);
    }
    return value;
}
function range(value) {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(finite) || !(value[0] < value[1])) {
        return null;
    }
    return [value[0], value[1]];
}
function extent(values) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of values) {
        if (!Number.isFinite(v))
            continue;
        if (v < lo)
            lo = v;
        if (v > hi)
            hi = v;
    }
    if (lo === Infinity)
        return [-1, 1];
    if (lo === hi)
        return [lo - 1, hi + 1];
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
}
/** Robust y extent: ignores the spikes near asymptotes (tan, 1/x) that would flatten the curve. */
function curveExtent(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (sorted.length < 20)
        return extent(sorted);
    const lo = sorted[Math.floor(sorted.length * 0.02)];
    const hi = sorted[Math.ceil(sorted.length * 0.98) - 1];
    const full = sorted[sorted.length - 1] - sorted[0];
    return full > (hi - lo) * 4 ? extent([lo, hi]) : extent(sorted);
}
/**
 * Best-effort repair of the JSON slips models make in plot specs: a string
 * left open (with the object's closing braces swallowed into it), missing
 * closing braces, trailing commas, or prose after the object. Returns the
 * repaired text, or null when the input cannot be salvaged.
 */
export function repairPlotJson(raw) {
    const start = raw.indexOf('{');
    if (start < 0)
        return null;
    const stack = [];
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = start; i < raw.length; i += 1) {
        const char = raw[i];
        if (inString) {
            if (escaped) {
                out += char;
                escaped = false;
            }
            else if (char === '\\') {
                out += char;
                escaped = true;
            }
            else if (char === '"') {
                inString = false;
                out += char;
            }
            else if (char === '\n' || char === '\r') {
                out += '\\n';
            }
            else if (char === '\t') {
                out += '\\t';
            }
            else {
                out += char;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
            out += char;
        }
        else if (char === '{' || char === '[') {
            stack.push(char === '{' ? '}' : ']');
            out += char;
        }
        else if (char === '}' || char === ']') {
            if (stack[stack.length - 1] !== char)
                return null;
            stack.pop();
            out += char;
            // The object is complete; anything after it is commentary.
            if (!stack.length)
                return out;
        }
        else if (char === ',') {
            let next = i + 1;
            while (next < raw.length && /\s/.test(raw[next]))
                next += 1;
            if (raw[next] !== '}' && raw[next] !== ']')
                out += char;
        }
        else {
            out += char;
        }
    }
    if (inString) {
        // The model often forgets the closing quote and the object's own braces
        // end up inside the string, e.g. "vertex (0,0)}]. Pull them back out.
        const tail = /[}\]]*$/.exec(out)?.[0] ?? '';
        if (tail)
            out = out.slice(0, out.length - tail.length);
        out += '"';
        for (const char of tail) {
            if (stack[stack.length - 1] !== char)
                return null;
            stack.pop();
            out += char;
            if (!stack.length)
                return out;
        }
    }
    while (stack.length)
        out += stack.pop() ?? '';
    return out;
}
export function parsePlotSpec(raw) {
    let spec;
    try {
        spec = JSON.parse(raw);
    }
    catch {
        // Models occasionally slip: an unfinished string, a trailing comma, the
        // tail of the object inside a string, or prose after the JSON. Repair what
        // can be repaired instead of dropping the whole graph.
        const repaired = repairPlotJson(raw);
        if (repaired === null)
            throw new PlotError('The plot spec must be valid JSON.');
        try {
            spec = JSON.parse(repaired);
        }
        catch {
            throw new PlotError('The plot spec must be valid JSON.');
        }
    }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
        throw new PlotError('The plot spec must be a JSON object.');
    }
    const s = spec;
    const chart = (text(s.chart) || 'line').toLowerCase();
    if (chart !== 'line' && chart !== 'scatter' && chart !== 'bar' && chart !== 'histogram') {
        throw new PlotError('"chart" must be line, scatter, bar or histogram.');
    }
    const data = {
        chart,
        title: text(s.title),
        xLabel: text(s.xLabel),
        yLabel: text(s.yLabel),
        grid: s.grid !== false,
        lines: [],
        markers: [],
        bars: [],
        xRange: [0, 1],
        yRange: [0, 1],
    };
    if (chart === 'bar') {
        const series = Array.isArray(s.series) ? s.series[0] : undefined;
        if (!series || typeof series !== 'object') {
            throw new PlotError('A bar chart needs one series with "x" labels and "y" values.');
        }
        const ys = numbers(series.y, 'series[0].y', MAX_CATEGORIES);
        const xs = Array.isArray(series.x) ? series.x : [];
        if (xs.length !== ys.length)
            throw new PlotError('Bar "x" and "y" must have the same length.');
        data.bars = ys.map((value, i) => ({ label: String(xs[i]).slice(0, 40), value }));
        data.yRange = extent([0, ...ys]);
        if (Math.min(...ys) >= 0)
            data.yRange[0] = 0;
        return data;
    }
    if (chart === 'histogram') {
        const values = numbers(s.data, 'data', MAX_DATA_POINTS);
        const binCount = Math.round(Math.min(100, Math.max(4, finite(s.bins) ? s.bins : 20)));
        const [lo, hi] = extent(values);
        const width = (hi - lo) / binCount;
        const counts = new Array(binCount).fill(0);
        for (const v of values)
            counts[Math.min(binCount - 1, Math.floor((v - lo) / width))] += 1;
        data.bars = counts.map((value, i) => ({ label: (lo + width * (i + 0.5)).toPrecision(3), value }));
        data.xRange = [lo, hi];
        data.yRange = [0, Math.max(...counts) * 1.08];
        return data;
    }
    // line and scatter
    const xRange = range(s.xRange) ?? [-10, 10];
    const samples = Math.round(Math.min(MAX_SAMPLES, Math.max(32, finite(s.samples) ? s.samples : DEFAULT_SAMPLES)));
    const mode = chart === 'scatter' ? 'scatter' : 'line';
    const ys = [];
    const equations = Array.isArray(s.equations) ? s.equations : [];
    if (equations.length > MAX_EQUATIONS)
        throw new PlotError(`At most ${MAX_EQUATIONS} equations can be plotted.`);
    for (const item of equations) {
        const expr = item && typeof item === 'object' ? item.expr : undefined;
        if (typeof expr !== 'string')
            throw new PlotError('Each equation needs an "expr" string.');
        const fn = compileExpression(expr);
        const points = [];
        for (let i = 0; i < samples; i += 1) {
            const x = xRange[0] + ((xRange[1] - xRange[0]) * i) / (samples - 1);
            const y = fn(x);
            points.push([x, y]);
            ys.push(y);
        }
        data.lines.push({ label: text(item.label) || expr, points, mode, expr });
    }
    const series = Array.isArray(s.series) ? s.series : [];
    if (series.length > MAX_SERIES)
        throw new PlotError(`At most ${MAX_SERIES} series can be plotted.`);
    let seriesX = [];
    series.forEach((item, index) => {
        const record = item && typeof item === 'object' ? item : {};
        const xs = numbers(record.x, `series[${index}].x`, MAX_SERIES_POINTS);
        const yv = numbers(record.y, `series[${index}].y`, MAX_SERIES_POINTS);
        if (xs.length !== yv.length)
            throw new PlotError('Series "x" and "y" must have the same length.');
        data.lines.push({
            label: text(record.label) || `Series ${data.lines.length + 1}`,
            points: xs.map((x, i) => [x, yv[i]]),
            mode,
        });
        seriesX = seriesX.concat(xs);
        ys.push(...yv);
    });
    const points = Array.isArray(s.points) ? s.points.slice(0, MAX_POINTS) : [];
    for (const item of points) {
        const record = item && typeof item === 'object' ? item : {};
        if (!finite(record.x) || !finite(record.y))
            continue;
        data.markers.push({ x: record.x, y: record.y, label: text(record.label).slice(0, 40) });
        ys.push(record.y);
    }
    if (!data.lines.length && !data.markers.length) {
        throw new PlotError('Nothing to plot: add "equations", "series" or "points".');
    }
    data.xRange = equations.length || !seriesX.length ? xRange : extent(seriesX);
    data.yRange = range(s.yRange) ?? (equations.length ? curveExtent(ys) : extent(ys));
    return data;
}
/** The "nice" step (1, 2, 5 × 10^n) closest to a requested spacing. */
export function niceStep(raw) {
    if (!(raw > 0) || !Number.isFinite(raw))
        return 1;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    // The candidate nearest to the raw step, so the count stays close to the target.
    return [1, 2, 5, 10]
        .map((m) => m * magnitude)
        .reduce((best, m) => (Math.abs(Math.log(m / raw)) < Math.abs(Math.log(best / raw)) ? m : best));
}
/** Tick values at an exact step covering [lo, hi]. */
export function ticksBetween(lo, hi, step) {
    if (!(step > 0) || !Number.isFinite(step))
        return [];
    const ticks = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) {
        ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
    }
    return ticks;
}
/** Evenly spaced "nice" tick values (1, 2, 5 × 10^n) covering [lo, hi]. */
export function niceTicks(lo, hi, target = 6) {
    return ticksBetween(lo, hi, niceStep((hi - lo) / target));
}
/**
 * One step shared by both axes, with a target per axis so neither gets too
 * crowded. Equal data units plus equal steps make every grid cell square.
 */
export function sharedTicks(x0, x1, y0, y1, xTarget = 7, yTarget = 5) {
    const step = Math.max(niceStep((x1 - x0) / xTarget), niceStep((y1 - y0) / yTarget));
    return { x: ticksBetween(x0, x1, step), y: ticksBetween(y0, y1, step), step };
}
// ---------- tick formatting ----------
/** The default tick label: precise enough to read, short enough to scan. */
function plainTick(value) {
    if (value === 0)
        return '0';
    const abs = Math.abs(value);
    if (abs >= 1e5 || abs < 1e-3)
        return value.toExponential(1);
    return String(Number(value.toPrecision(4)));
}
/**
 * Formats a tick value, falling back to shorter scientific forms when the
 * label would be wider than `maxWidth` (viewBox units). Long y-axis labels
 * would otherwise run off the left edge of the canvas, because that axis has
 * the least room.
 */
export function formatTick(value, maxWidth = Infinity) {
    const base = plainTick(value);
    if (estimateTextWidth(base) <= maxWidth || value === 0 || !Number.isFinite(value))
        return base;
    for (const digits of [1, 0]) {
        const label = value.toExponential(digits);
        if (estimateTextWidth(label) <= maxWidth)
            return label;
    }
    return value.toExponential(0);
}

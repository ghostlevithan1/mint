/**
 * Parses the ```diagram spec the model emits. The model sends plain JSON; the
 * browser does the drawing, so no model-written markup ever reaches the page.
 */
export class DiagramError extends Error {
}
const MIN_NODES = { steps: 2, cycle: 3, hub: 3 };
const MAX_NODES = 9;
function text(value, max) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}
export function parseDiagramSpec(raw) {
    let spec;
    try {
        spec = JSON.parse(raw);
    }
    catch {
        throw new DiagramError('The diagram spec must be valid JSON.');
    }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
        throw new DiagramError('The diagram spec must be a JSON object.');
    }
    const s = spec;
    const type = text(s.type, 10).toLowerCase() || 'steps';
    if (type !== 'steps' && type !== 'cycle' && type !== 'hub') {
        throw new DiagramError('"type" must be steps, cycle or hub.');
    }
    const nodes = (Array.isArray(s.nodes) ? s.nodes : [])
        .map((item) => {
        const record = item && typeof item === 'object' ? item : {};
        return { label: text(record.label, 40), detail: text(record.detail, 200) };
    })
        .filter((node) => node.label)
        .slice(0, MAX_NODES);
    if (nodes.length < MIN_NODES[type]) {
        throw new DiagramError(`A ${type} diagram needs at least ${MIN_NODES[type]} labelled nodes.`);
    }
    return { type, title: text(s.title, 120), nodes };
}
/** Splits a label into at most two lines of about `width` characters, for SVG text. */
export function wrapLabel(label, width = 14) {
    const words = label.split(' ');
    const lines = [''];
    for (const word of words) {
        const current = lines[lines.length - 1];
        if (!current || (current + ' ' + word).length <= width) {
            lines[lines.length - 1] = current ? `${current} ${word}` : word;
        }
        else if (lines.length < 2) {
            lines.push(word);
        }
        else {
            lines[1] = `${lines[1]} ${word}`;
        }
    }
    return lines.map((line) => (line.length > width + 6 ? `${line.slice(0, width + 5)}…` : line));
}

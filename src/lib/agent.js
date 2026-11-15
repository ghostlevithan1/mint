import { compileExpression } from './plotSpec';
export const MAX_TOOL_STEPS = 4;
const TOOL_BLOCK = /```tool[^\n]*\n([\s\S]*?)\n?```/;
/** The first complete tool call in a reply, or null. */
export function parseToolCall(text) {
    const match = TOOL_BLOCK.exec(text);
    if (!match)
        return null;
    let value;
    try {
        value = JSON.parse(match[1]);
    }
    catch {
        return null;
    }
    if (!value || typeof value !== 'object')
        return null;
    const call = value;
    const str = (key, max) => typeof call[key] === 'string' ? call[key].trim().slice(0, max) : '';
    if (call.name === 'search' && str('query', 200))
        return { name: 'search', query: str('query', 200) };
    if (call.name === 'read' && /^https?:\/\//i.test(str('url', 2000)))
        return { name: 'read', url: str('url', 2000) };
    if (call.name === 'calculate' && str('expression', 300)) {
        return { name: 'calculate', expression: str('expression', 300) };
    }
    return null;
}
/** Hides tool blocks, including one still streaming, so the student only sees the answer. */
export function stripToolCalls(text) {
    return text.replace(/```tool[\s\S]*?(?:```|$)/g, '').trim();
}
/** Exact arithmetic for the model, through the same whitelist parser as graphs. */
export function runCalculator(expression) {
    try {
        const value = compileExpression(expression.replace(/×/g, '*').replace(/÷/g, '/'))(0);
        if (!Number.isFinite(value))
            return `${expression} has no finite value.`;
        return `${expression} = ${Number(value.toPrecision(12))}`;
    }
    catch (error) {
        return `Could not calculate ${expression}: ${error instanceof Error ? error.message : 'invalid expression'}`;
    }
}
/** One-line status shown while a tool runs. */
export function toolStatus(call) {
    if (call.name === 'search')
        return `Searching the web for "${call.query}"`;
    if (call.name === 'read')
        return `Reading ${call.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}`;
    return `Calculating ${call.expression}`;
}

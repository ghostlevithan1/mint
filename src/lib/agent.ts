import { compileExpression } from './plotSpec'

/**
 * Mint's tools. The model asks for one by ending its turn with a fenced
 * ```tool block holding JSON; the browser runs it and sends the result back.
 * A text protocol instead of native tool calling, so every model can use it.
 */

export type ToolCall =
  | { name: 'search'; query: string }
  | { name: 'read'; url: string }
  | { name: 'calculate'; expression: string }

export const MAX_TOOL_STEPS = 4

const TOOL_BLOCK = /```tool[^\n]*\n([\s\S]*?)\n?```/

/** The first complete tool call in a reply, or null. */
export function parseToolCall(text: string): ToolCall | null {
  const match = TOOL_BLOCK.exec(text)
  if (!match) return null
  let value: unknown
  try {
    value = JSON.parse(match[1])
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const call = value as Record<string, unknown>
  const str = (key: string, max: number) =>
    typeof call[key] === 'string' ? (call[key] as string).trim().slice(0, max) : ''

  if (call.name === 'search' && str('query', 200)) return { name: 'search', query: str('query', 200) }
  if (call.name === 'read' && /^https?:\/\//i.test(str('url', 2000))) return { name: 'read', url: str('url', 2000) }
  if (call.name === 'calculate' && str('expression', 300)) {
    return { name: 'calculate', expression: str('expression', 300) }
  }
  return null
}

/** Hides tool blocks, including one still streaming, so the student only sees the answer. */
export function stripToolCalls(text: string): string {
  return text.replace(/```tool[\s\S]*?(?:```|$)/g, '').trim()
}

/** Exact arithmetic for the model, through the same whitelist parser as graphs. */
export function runCalculator(expression: string): string {
  try {
    const value = compileExpression(expression.replace(/×/g, '*').replace(/÷/g, '/'))(0)
    if (!Number.isFinite(value)) return `${expression} has no finite value.`
    return `${expression} = ${Number(value.toPrecision(12))}`
  } catch (error) {
    return `Could not calculate ${expression}: ${error instanceof Error ? error.message : 'invalid expression'}`
  }
}

/** One-line status shown while a tool runs. */
export function toolStatus(call: ToolCall): string {
  if (call.name === 'search') return `Searching the web for "${call.query}"`
  if (call.name === 'read') return `Reading ${call.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}`
  return `Calculating ${call.expression}`
}

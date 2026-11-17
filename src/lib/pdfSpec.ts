/**
 * Parses the ```pdf spec the model emits. The model sends plain JSON describing
 * a document; the browser lays it out and writes the file, so no model-written
 * markup or code ever runs.
 */

export type PdfBlock =
  | { type: 'heading'; text: string; level: 1 | 2 }
  | { type: 'text'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'numbers'; items: string[] }
  | { type: 'table'; rows: string[][] }
  | { type: 'rule' }

export type PdfDocument = {
  title: string
  filename: string
  blocks: PdfBlock[]
}

export class PdfSpecError extends Error {}

const MAX_BLOCKS = 300
const MAX_ITEMS = 100
const MAX_ROWS = 100
const MAX_COLUMNS = 8
const MAX_TEXT = 8000

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, max) : ''
}

function list(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => text(item, 1000).replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, MAX_ITEMS)
}

export function pdfFilename(raw: string, title: string): string {
  const base = (raw || title || 'mint-document')
    .replace(/\.pdf$/i, '')
    .replace(/[^\p{L}\p{N} _.-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^[._-]+/, '')
    .slice(0, 60)
  return `${base || 'mint-document'}.pdf`
}

export function parsePdfSpec(raw: string): PdfDocument {
  let spec: unknown
  try {
    spec = JSON.parse(raw)
  } catch {
    throw new PdfSpecError('The PDF spec must be valid JSON.')
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new PdfSpecError('The PDF spec must be a JSON object.')
  }
  const s = spec as Record<string, unknown>
  const title = text(s.title, 160)
  if (!Array.isArray(s.blocks)) {
    throw new PdfSpecError('The PDF spec needs a "blocks" array.')
  }

  const blocks: PdfBlock[] = []
  for (const item of s.blocks.slice(0, MAX_BLOCKS)) {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const type = text(record.type, 10).toLowerCase()
    if (type === 'heading') {
      const value = text(record.text, 200).replace(/\s+/g, ' ')
      if (value) blocks.push({ type, text: value, level: record.level === 2 ? 2 : 1 })
    } else if (type === 'text') {
      const value = text(record.text, MAX_TEXT)
      if (value) blocks.push({ type, text: value })
    } else if (type === 'bullets' || type === 'numbers') {
      const items = list(record.items)
      if (items.length) blocks.push({ type, items })
    } else if (type === 'table') {
      const rows = (Array.isArray(record.rows) ? record.rows : [])
        .slice(0, MAX_ROWS)
        .map((row) =>
          (Array.isArray(row) ? row : []).slice(0, MAX_COLUMNS).map((cell) => text(cell, 300).replace(/\s+/g, ' ')),
        )
        .filter((row) => row.length)
      if (rows.length) blocks.push({ type, rows })
    } else if (type === 'rule') {
      blocks.push({ type })
    }
  }

  if (!title && !blocks.length) {
    throw new PdfSpecError('The PDF has no title or content.')
  }
  return { title, filename: pdfFilename(text(s.filename, 80), title), blocks }
}

/**
 * Turns a PDF into Markdown in the browser, so any model can read it. pdf.js
 * (loaded only when a PDF is attached) supplies positioned text; the layout
 * step below rebuilds headings, lists, tables and paragraphs from positions
 * and font sizes. Nothing is uploaded: the file is read on this device.
 */

export type PdfTextItem = {
  str: string
  x: number
  y: number
  width: number
  size: number
}

export const PDF_MAX_PAGES = 100
export const PDF_MAX_CHARS = 200_000

type Line = { y: number; x: number; size: number; cells: string[] }

const BULLET = /^[•▪◦●‣·∙*–—-]\s+/
const NUMBERED = /^\d{1,3}[.)]\s+\S/

function buildLines(items: PdfTextItem[]): Line[] {
  // pdf.js emits blank items that span gaps; the real gaps are measured from the text.
  const sorted = items
    .filter((item) => item.str.trim())
    .sort((a, b) => b.y - a.y || a.x - b.x)

  const rows: PdfTextItem[][] = []
  for (const item of sorted) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(row[0].y - item.y) <= Math.max(item.size, row[0].size) * 0.45) row.push(item)
    else rows.push([item])
  }

  const lines: Line[] = []
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x)
    const cells: string[] = []
    let current = ''
    let end = row[0].x
    for (const item of row) {
      const gap = item.x - end
      if (current && gap > item.size * 1.8) {
        cells.push(current.trim())
        current = ''
      } else if (current && gap > item.size * 0.12 && !/\s$/.test(current) && !/^\s/.test(item.str)) {
        current += ' '
      }
      current += item.str
      end = Math.max(end, item.x + item.width)
    }
    if (current.trim()) cells.push(current.trim())
    if (!cells.length) continue
    lines.push({
      y: row[0].y,
      x: row[0].x,
      size: Math.max(...row.map((item) => item.size)),
      cells: cells.map((cell) => cell.replace(/\s+/g, ' ')),
    })
  }
  return lines
}

/** The font size most characters are set in, taken as the body text size. */
function bodySize(pages: Line[][]): number {
  const weight = new Map<number, number>()
  for (const line of pages.flat()) {
    const key = Math.round(line.size * 2) / 2
    weight.set(key, (weight.get(key) ?? 0) + line.cells.join('').length)
  }
  let best = 11
  let most = 0
  for (const [size, chars] of weight) {
    if (chars > most) {
      best = size
      most = chars
    }
  }
  return best
}

function escapeCell(cell: string) {
  return cell.replace(/\|/g, '\\|')
}

function tableMarkdown(rows: string[][]): string {
  const columns = Math.max(...rows.map((row) => row.length))
  const padded = rows.map((row) => Array.from({ length: columns }, (_, index) => escapeCell(row[index] ?? '')))
  const line = (row: string[]) => `| ${row.join(' | ')} |`
  return [line(padded[0]), line(Array(columns).fill('---')), ...padded.slice(1).map(line)].join('\n')
}

/** Joins wrapped lines into a paragraph, undoing end-of-line hyphenation. */
function joinWrapped(previous: string, next: string): string {
  if (/[a-z]-$/.test(previous) && /^[a-z]/.test(next)) return previous.slice(0, -1) + next
  return `${previous} ${next}`
}

export function layoutToMarkdown(pages: PdfTextItem[][]): string {
  const laid = pages.map(buildLines)
  const body = bodySize(laid)
  const out: string[] = []

  laid.forEach((lines, pageIndex) => {
    if (!lines.length) return
    if (pages.length > 1) out.push(`*Page ${pageIndex + 1}*`)

    let paragraph = ''
    let lastY = 0
    let lastSize = body
    let tableRows: string[][] = []

    const flushParagraph = () => {
      if (paragraph) out.push(paragraph)
      paragraph = ''
    }
    const flushTable = () => {
      if (tableRows.length >= 2) out.push(tableMarkdown(tableRows))
      else if (tableRows.length === 1) out.push(tableRows[0].join('  '))
      tableRows = []
    }

    for (const line of lines) {
      const text = line.cells.join(' ')
      const gap = lastY ? lastY - line.y : Infinity

      if (line.cells.length >= 2 && line.size < body * 1.25) {
        flushParagraph()
        tableRows.push(line.cells)
        lastY = line.y
        lastSize = line.size
        continue
      }
      flushTable()

      if (line.size >= body * 1.2 && text.length <= 160) {
        flushParagraph()
        const hashes = line.size >= body * 1.7 ? '#' : line.size >= body * 1.4 ? '##' : '###'
        const previous = out[out.length - 1]
        if (previous?.startsWith(`${hashes} `) && lastSize === line.size && gap < line.size * 1.8) {
          out[out.length - 1] = `${previous} ${text}`
        } else {
          out.push(`${hashes} ${text}`)
        }
      } else if (BULLET.test(text) || NUMBERED.test(text)) {
        flushParagraph()
        paragraph = BULLET.test(text) ? `- ${text.replace(BULLET, '')}` : text
      } else if (paragraph && gap <= line.size * 1.7) {
        paragraph = joinWrapped(paragraph, text)
      } else {
        flushParagraph()
        paragraph = text
      }
      lastY = line.y
      lastSize = line.size
    }
    flushParagraph()
    flushTable()
  })

  // Consecutive list items belong together without blank lines between them.
  return out
    .join('\n\n')
    .replace(/(^- .*)\n\n(?=- )/gm, '$1\n')
    .replace(/(^\d{1,3}[.)] .*)\n\n(?=\d{1,3}[.)] )/gm, '$1\n')
    .trim()
}

export class PdfReadError extends Error {
  name = 'PdfReadError'
}

/** Reads every page's text with pdf.js and converts it. Throws PdfReadError when nothing readable is found. */
export async function pdfToMarkdown(data: Uint8Array): Promise<{ markdown: string; pages: number; truncated: boolean }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  }

  const task = pdfjs.getDocument({ data })
  let document: Awaited<typeof task.promise>
  try {
    document = await task.promise
  } catch (error) {
    void task.destroy()
    const name = (error as { name?: string })?.name
    if (name === 'PasswordException') throw new PdfReadError('This PDF is password protected.')
    throw new PdfReadError('This PDF could not be opened.')
  }

  try {
    const pageCount = Math.min(document.numPages, PDF_MAX_PAGES)
    const pages: PdfTextItem[][] = []
    for (let number = 1; number <= pageCount; number += 1) {
      const page = await document.getPage(number)
      const content = await page.getTextContent()
      pages.push(
        content.items.flatMap((item) => {
          if (!('str' in item)) return []
          const [a, b, , , x, y] = item.transform as number[]
          return [{ str: item.str, x, y, width: item.width, size: Math.hypot(a, b) || item.height }]
        }),
      )
      page.cleanup()
    }
    const markdown = layoutToMarkdown(pages)
    if (!markdown.replace(/\*Page \d+\*/g, '').trim()) {
      throw new PdfReadError('This PDF has no selectable text (it may be a scan).')
    }
    return {
      markdown,
      pages: document.numPages,
      truncated: document.numPages > pageCount,
    }
  } finally {
    void task.destroy()
  }
}

/**
 * A small PDF writer: A4 pages, the built-in Helvetica fonts, wrapped text,
 * lists and tables. No dependency and no network; it returns the file's bytes.
 * Text is limited to what the standard fonts hold (Latin-1 plus common
 * punctuation); anything else is written as "?".
 */

import type { PdfDocument } from './pdfSpec'
import { saveBlob } from './download'

type Font = 'regular' | 'bold'

const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
]
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611,
  556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389,
  280, 389, 584,
]

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const MARGIN = 56
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const BODY_SIZE = 11
const BODY_LEADING = 15

/** Standard-font (WinAnsi) code for a character, or 63 ("?") when the font has none. */
function encodeChar(char: string): number {
  const code = char.codePointAt(0) ?? 63
  if (code === 9) return 32
  if (code >= 32 && code <= 126) return code
  if (code >= 160 && code <= 255) return code
  switch (char) {
    case '€': return 0x80
    case '…': return 0x85
    case '‘': return 0x91
    case '’': return 0x92
    case '“': return 0x93
    case '”': return 0x94
    case '•': return 0x95
    case '–': return 0x96
    case '—': return 0x97
    case '−': return 0x2d
    case '×': return 0xd7
    default: return 63
  }
}

function charWidth(code: number, font: Font): number {
  const table = font === 'bold' ? BOLD : REGULAR
  if (code >= 32 && code <= 126) return table[code - 32]
  return 556
}

function encode(value: string): number[] {
  return Array.from(value, encodeChar)
}

function measure(codes: number[], font: Font, size: number): number {
  let total = 0
  for (const code of codes) total += charWidth(code, font)
  return (total * size) / 1000
}

function wrap(value: string, font: Font, size: number, width: number): number[][] {
  const lines: number[][] = []
  for (const paragraph of value.split('\n')) {
    const words = paragraph.split(/ +/).filter(Boolean)
    if (!words.length) {
      lines.push([])
      continue
    }
    // Widths are added up as we go, so each character is measured once.
    const space = measure([32], font, size)
    let current: number[] = []
    let currentWidth = 0
    for (const word of words) {
      const codes = encode(word)
      const wordWidth = measure(codes, font, size)
      const joined = current.length ? currentWidth + space + wordWidth : wordWidth
      if (joined <= width) {
        if (current.length) current.push(32)
        current.push(...codes)
        currentWidth = joined
        continue
      }
      if (current.length) lines.push(current)
      current = []
      currentWidth = 0
      for (const code of codes) {
        const charWidthNow = (charWidth(code, font) * size) / 1000
        if (current.length && currentWidth + charWidthNow > width) {
          lines.push(current)
          current = []
          currentWidth = 0
        }
        current.push(code)
        currentWidth += charWidthNow
      }
    }
    lines.push(current)
  }
  return lines
}

function pdfString(codes: number[]): string {
  let out = ''
  for (const code of codes) {
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += `\\${String.fromCharCode(code)}`
    else if (code > 126 || code < 32) out += `\\${code.toString(8).padStart(3, '0')}`
    else out += String.fromCharCode(code)
  }
  return `(${out})`
}

const num = (value: number) => (Math.round(value * 100) / 100).toString()

class Layout {
  pages: string[] = []
  private ops: string[] = []
  y = PAGE_HEIGHT - MARGIN

  constructor() {
    this.newPage()
  }

  private newPage() {
    if (this.pages.length || this.ops.length) this.pages.push(this.ops.join('\n'))
    this.ops = []
    this.y = PAGE_HEIGHT - MARGIN
  }

  /** Makes room for `height` points, starting a new page when it does not fit. */
  ensure(height: number) {
    if (this.y - height < MARGIN && this.y < PAGE_HEIGHT - MARGIN) this.newPage()
  }

  gap(height: number) {
    this.y -= height
  }

  line(codes: number[], x: number, font: Font, size: number, leading: number) {
    this.ensure(leading)
    this.y -= leading
    if (codes.length) {
      this.ops.push(
        `BT /${font === 'bold' ? 'F2' : 'F1'} ${size} Tf ${num(x)} ${num(this.y + (leading - size) / 2 + size * 0.1)} Td ${pdfString(codes)} Tj ET`,
      )
    }
  }

  /** Wrapped text; returns nothing but moves the cursor down. */
  paragraph(value: string, font: Font, size: number, leading: number, x = MARGIN, width = CONTENT_WIDTH) {
    for (const codes of wrap(value, font, size, width)) this.line(codes, x, font, size, leading)
  }

  rect(x: number, top: number, width: number, height: number, gray: number) {
    this.ops.push(`${gray} g ${num(x)} ${num(top - height)} ${num(width)} ${num(height)} re f 0 g`)
  }

  stroke(x1: number, y1: number, x2: number, y2: number, gray = 0.75) {
    this.ops.push(`${gray} G 0.6 w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S 0 G`)
  }

  finish(): string[] {
    this.newPage()
    return this.pages
  }
}

function drawTable(layout: Layout, rows: string[][]) {
  const columns = Math.max(...rows.map((row) => row.length))
  const columnWidth = CONTENT_WIDTH / columns
  const pad = 5
  const size = 10
  const leading = 13
  rows.forEach((row, rowIndex) => {
    const font: Font = rowIndex === 0 ? 'bold' : 'regular'
    const cells = Array.from({ length: columns }, (_, index) =>
      wrap(row[index] ?? '', font, size, columnWidth - pad * 2),
    )
    const height = Math.max(...cells.map((lines) => lines.length)) * leading + pad * 2 - 2
    layout.ensure(height)
    const top = layout.y
    if (rowIndex === 0) layout.rect(MARGIN, top, CONTENT_WIDTH, height, 0.92)
    cells.forEach((lines, index) => {
      const saved = layout.y
      layout.y = top - pad + 1
      for (const codes of lines) layout.line(codes, MARGIN + index * columnWidth + pad, font, size, leading)
      layout.y = saved
    })
    layout.y = top - height
    layout.stroke(MARGIN, layout.y, MARGIN + CONTENT_WIDTH, layout.y)
    if (rowIndex === 0) layout.stroke(MARGIN, top, MARGIN + CONTENT_WIDTH, top)
  })
  layout.gap(10)
}

export function buildPdf(doc: PdfDocument): Uint8Array {
  const layout = new Layout()

  if (doc.title) {
    layout.paragraph(doc.title, 'bold', 24, 30)
    layout.gap(4)
    layout.stroke(MARGIN, layout.y, MARGIN + CONTENT_WIDTH, layout.y, 0.6)
    layout.gap(14)
  }

  for (const block of doc.blocks) {
    if (block.type === 'heading') {
      const size = block.level === 1 ? 17 : 13
      layout.gap(block.level === 1 ? 8 : 4)
      layout.ensure(size * 1.3 + BODY_LEADING * 2)
      layout.paragraph(block.text, 'bold', size, size * 1.3)
      layout.gap(4)
    } else if (block.type === 'text') {
      layout.paragraph(block.text, 'regular', BODY_SIZE, BODY_LEADING)
      layout.gap(8)
    } else if (block.type === 'bullets' || block.type === 'numbers') {
      block.items.forEach((item, index) => {
        const marker = block.type === 'bullets' ? [0x95] : encode(`${index + 1}.`)
        const lines = wrap(item, 'regular', BODY_SIZE, CONTENT_WIDTH - 24)
        lines.forEach((codes, lineIndex) => {
          layout.line(codes, MARGIN + 24, 'regular', BODY_SIZE, BODY_LEADING)
          if (lineIndex === 0) {
            const after = layout.y
            layout.y = after + BODY_LEADING
            layout.line(marker, MARGIN + 8, 'regular', BODY_SIZE, BODY_LEADING)
            layout.y = after
          }
        })
        layout.gap(3)
      })
      layout.gap(5)
    } else if (block.type === 'table') {
      layout.gap(2)
      drawTable(layout, block.rows)
    } else if (block.type === 'rule') {
      layout.gap(4)
      layout.stroke(MARGIN, layout.y, MARGIN + CONTENT_WIDTH, layout.y)
      layout.gap(12)
    }
  }

  const pages = layout.finish()
  const objects: string[] = []
  const pageIds = pages.map((_, index) => 5 + index * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  pages.forEach((content, index) => {
    const id = pageIds[index]
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`
    objects[id + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  })

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = out.length
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id += 1) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

  const bytes = new Uint8Array(out.length)
  for (let index = 0; index < out.length; index += 1) bytes[index] = out.charCodeAt(index) & 0xff
  return bytes
}

export function downloadPdf(doc: PdfDocument) {
  saveBlob(new Blob([buildPdf(doc) as BlobPart], { type: 'application/pdf' }), doc.filename)
}

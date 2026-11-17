/**
 * Reads common document formats in the browser and turns them into Markdown:
 * .docx, .pptx, .odt, .odp, .ods, .epub and .rtf. The Office, OpenDocument and
 * EPUB formats are ZIP archives of XML, read with the platform's
 * DecompressionStream, so there is no parsing library and no upload.
 */

import { attr, child, find, outermost, parseXml, textOf, unescapeXml, visit, type TextRule, type XmlElement } from './xmlScan'

export { unescapeXml }

const ENTRY_LIMIT = 16_000_000
const TOTAL_LIMIT = 48_000_000

/** A character reference, or nothing when it is not a valid code point. */
function codePointChar(value: number): string {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ''
}

/** Inflates raw deflate data, giving up if it grows past `limit` bytes (a zip bomb). */
async function inflateRaw(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      await reader.cancel()
      throw new Error('entry too large')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  // EOCD signature PK\x05\x06; scan backwards from the end.
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset
    }
  }
  return -1
}

export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 64 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

/** Inflates the archive entries `want` accepts, as UTF-8 text keyed by path. */
export async function readZipEntries(
  bytes: Uint8Array,
  want: (name: string) => boolean,
): Promise<Map<string, string>> {
  const entries = new Map<string, string>()
  try {
    const eocd = findEndOfCentralDirectory(bytes)
    if (eocd < 0) return entries
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const entryCount = view.getUint16(eocd + 10, true)
    let offset = view.getUint32(eocd + 16, true)
    const decoder = new TextDecoder()
    let total = 0

    for (let index = 0; index < entryCount; index += 1) {
      if (
        bytes[offset] !== 0x50 ||
        bytes[offset + 1] !== 0x4b ||
        bytes[offset + 2] !== 0x01 ||
        bytes[offset + 3] !== 0x02
      ) {
        break
      }
      const flags = view.getUint16(offset + 8, true)
      const method = view.getUint16(offset + 10, true)
      const compressedSize = view.getUint32(offset + 20, true)
      const nameLength = view.getUint16(offset + 28, true)
      const extraLength = view.getUint16(offset + 30, true)
      const commentLength = view.getUint16(offset + 32, true)
      const localHeaderOffset = view.getUint32(offset + 42, true)
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
      offset += 46 + nameLength + extraLength + commentLength

      // Encrypted entries cannot be read.
      if (!want(name) || flags & 1) continue

      const localNameLength = view.getUint16(localHeaderOffset + 26, true)
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
      try {
        let data: Uint8Array | undefined
        if (method === 0) data = compressed
        else if (method === 8) data = await inflateRaw(compressed, Math.min(ENTRY_LIMIT, TOTAL_LIMIT - total))
        if (!data) continue
        total += data.length
        entries.set(name, decoder.decode(data))
      } catch {
        // Skip unreadable entries; partial text is better than none.
      }
    }
  } catch {
    // Malformed archive: fall through with whatever was read.
  }
  return entries
}

const tidy = (value: string) => value.replace(/[ \t\r\n]+/g, ' ').trim()
const names = (...list: string[]) => new Set(list)

function escapeCell(cell: string) {
  return cell.replace(/\|/g, '\\|')
}

export function tableToMarkdown(rows: string[][]): string {
  const filled = rows.filter((row) => row.some(Boolean))
  if (!filled.length) return ''
  let columns = 0
  for (const row of filled) columns = Math.max(columns, row.length)
  // A one-column table is a callout box, not data.
  if (columns === 1) return filled.map((row) => row[0]).filter(Boolean).join('\n\n')
  const padded = filled.map((row) => Array.from({ length: columns }, (_, index) => escapeCell(row[index] ?? '')))
  const line = (row: string[]) => `| ${row.join(' | ')} |`
  return [line(padded[0]), line(Array(columns).fill('---')), ...padded.slice(1).map(line)].join('\n')
}

const joinBlocks = (parts: string[]) => parts.filter(Boolean).join('\n\n').replace(/(^ *- .*)\n\n(?= *- )/gm, '$1\n')

/* ------------------------------------------------------------------ docx */

const wordRule = (name: string): TextRule =>
  name === 'w:t' ? 'text' : name === 'w:tab' || name === 'w:br' || name === 'w:cr' ? 'space' : undefined

const wordText = (paragraph: XmlElement) => tidy(textOf(paragraph, wordRule))

function wordTable(table: XmlElement): string {
  const rows = outermost(table, names('w:tr')).map((row) =>
    outermost(row, names('w:tc')).map((cell) =>
      outermost(cell, names('w:p')).map(wordText).filter(Boolean).join(' '),
    ),
  )
  return tableToMarkdown(rows)
}

export function docxToMarkdown(documentXml: string): string {
  const out: string[] = []
  for (const block of outermost(parseXml(documentXml), names('w:p', 'w:tbl'))) {
    if (block.name === 'w:tbl') {
      out.push(wordTable(block))
      continue
    }
    const text = wordText(block)
    if (!text) continue
    const properties = child(block, 'w:pPr')
    const style = attr(child(properties, 'w:pStyle'), 'w:val') ?? ''
    const numbering = child(properties, 'w:numPr')
    const heading = /^heading\s*(\d)/i.exec(style)
    if (/^title$/i.test(style)) out.push(`# ${text}`)
    else if (heading) out.push(`${'#'.repeat(Math.min(6, Number(heading[1])))} ${text}`)
    else if (numbering || /^list/i.test(style)) {
      const level = Number(attr(child(numbering, 'w:ilvl'), 'w:val') ?? 0) || 0
      out.push(`${'  '.repeat(Math.min(level, 6))}- ${text}`)
    } else out.push(text)
  }
  return joinBlocks(out)
}

/* ------------------------------------------------------------------ pptx */

const slideRule = (name: string): TextRule =>
  name === 'a:t' ? 'text' : name === 'a:br' ? 'space' : name === 'a:fld' ? 'skip' : undefined

function slideParagraphs(element: XmlElement): { text: string; level: number }[] {
  return outermost(element, names('a:p')).flatMap((paragraph) => {
    const text = tidy(textOf(paragraph, slideRule))
    const level = Number(attr(child(paragraph, 'a:pPr'), 'lvl') ?? 0) || 0
    return text ? [{ text, level }] : []
  })
}

const placeholderType = (shape: XmlElement) => attr(find(shape, 'p:ph'), 'type') ?? ''

function slideToMarkdown(xml: string, notesXml: string, number: number): string {
  let title = ''
  const body: string[] = []
  for (const shape of outermost(parseXml(xml), names('p:sp', 'a:tbl'))) {
    if (shape.name === 'a:tbl') {
      const rows = outermost(shape, names('a:tr')).map((row) =>
        outermost(row, names('a:tc')).map((cell) => slideParagraphs(cell).map((p) => p.text).join(' ')),
      )
      body.push(tableToMarkdown(rows))
      continue
    }
    const paragraphs = slideParagraphs(shape)
    if (!paragraphs.length) continue
    if (/^(?:title|ctrTitle)$/.test(placeholderType(shape))) {
      const text = paragraphs.map((p) => p.text).join(' ')
      title = title ? `${title} ${text}` : text
    } else {
      body.push(paragraphs.map((p) => `${'  '.repeat(Math.min(p.level, 6))}- ${p.text}`).join('\n'))
    }
  }

  const notes = notesXml
    ? outermost(parseXml(notesXml), names('p:sp'))
        .filter((shape) => placeholderType(shape) === 'body')
        .flatMap((shape) => slideParagraphs(shape).map((p) => p.text))
    : []
  return joinBlocks([
    `## Slide ${number}${title ? `: ${title}` : ''}`,
    ...body,
    notes.length ? `*Notes:* ${notes.join(' ')}` : '',
  ])
}

export function pptxToMarkdown(files: Map<string, string>): string {
  const slides = [...files.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return joinBlocks(
    slides.map((name, index) => {
      const slideFile = name.slice(name.lastIndexOf('/') + 1)
      const rels = files.get(`ppt/slides/_rels/${slideFile}.rels`) ?? ''
      const target = /Target="\.\.\/notesSlides\/(notesSlide\d{1,6}\.xml)"/.exec(rels)?.[1]
      return slideToMarkdown(files.get(name) ?? '', target ? (files.get(`ppt/notesSlides/${target}`) ?? '') : '', index + 1)
    }),
  )
}

/* ------------------------------------------------------- OpenDocument */

const odfRule = (name: string): TextRule =>
  name === 'text:s' || name === 'text:tab' || name === 'text:line-break' ? 'space' : name === 'text:note' ? 'skip' : undefined

const odfInline = (element: XmlElement) => tidy(textOf(element, odfRule, true))

function odfTable(table: XmlElement): string {
  const rows = outermost(table, names('table:table-row')).map((row) => {
    const cells: string[] = []
    for (const cell of outermost(row, names('table:table-cell', 'table:covered-table-cell'))) {
      const repeat = Number(attr(cell, 'table:number-columns-repeated') ?? 1) || 1
      const text = outermost(cell, names('text:p', 'text:h')).map(odfInline).filter(Boolean).join(' ')
      for (let count = 0; count < Math.min(repeat, text ? 1 : 50); count += 1) cells.push(text)
    }
    while (cells.length && !cells[cells.length - 1]) cells.pop()
    return cells
  })
  return tableToMarkdown(rows)
}

export function odfToMarkdown(contentXml: string, kind: 'odt' | 'odp' | 'ods'): string {
  const out: string[] = []
  let listDepth = 0
  let slide = 0
  visit(parseXml(contentXml), {
    enter(element) {
      if (element.name === 'table:table') {
        const name = kind === 'ods' ? attr(element, 'table:name') : ''
        if (name) out.push(`## ${name}`)
        out.push(odfTable(element))
        return false
      }
      if (element.name === 'text:list-item') listDepth += 1
      else if (element.name === 'draw:page') {
        slide += 1
        const name = attr(element, 'draw:name')
        out.push(`## Slide ${slide}${name && !/^page\d+$/i.test(name) ? `: ${name}` : ''}`)
      } else if (element.name === 'text:h') {
        const level = Number(attr(element, 'text:outline-level') ?? 1) || 1
        const text = odfInline(element)
        if (text) out.push(`${'#'.repeat(Math.min(6, Math.max(1, level)))} ${text}`)
        return false
      } else if (element.name === 'text:p') {
        const text = odfInline(element)
        if (text) out.push(listDepth ? `${'  '.repeat(Math.min(listDepth - 1, 6))}- ${text}` : text)
        return false
      }
    },
    exit(element) {
      if (element.name === 'text:list-item') listDepth = Math.max(0, listDepth - 1)
    },
  })
  return joinBlocks(out)
}

/* ------------------------------------------------------------------ epub */

const HTML_SKIP = names('script', 'style', 'head', 'title', 'svg', 'math')
const HTML_BLOCK = names('p', 'div', 'tr', 'ul', 'ol', 'blockquote', 'section', 'article', 'table', 'pre')

function htmlToMarkdown(html: string): string {
  let out = ''
  visit(parseXml(html), {
    enter(element) {
      const name = element.name.toLowerCase()
      if (HTML_SKIP.has(name)) return false
      const heading = /^h([1-6])$/.exec(name)
      if (heading) {
        out += `\n\n${'#'.repeat(Number(heading[1]))} ${tidy(textOf(element, () => undefined, true))}\n\n`
        return false
      }
      if (name === 'li') out += '\n- '
      else if (name === 'br') out += '\n'
    },
    exit(element) {
      const name = element.name.toLowerCase()
      if (HTML_BLOCK.has(name)) out += '\n\n'
      else if (name === 'td' || name === 'th') out += ' | '
    },
    text(raw) {
      out += unescapeXml(raw)
    },
  })
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function resolvePath(base: string, href: string): string {
  const parts = `${base}${href}`.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part && part !== '.') out.push(part)
  }
  return out.join('/')
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const localName = (name: string) => name.slice(name.indexOf(':') + 1)

export function epubToMarkdown(files: Map<string, string>): string {
  const container = parseXml(files.get('META-INF/container.xml') ?? '')
  const rootfile = outermost(container, names('rootfile'))[0]
  const opfPath = attr(rootfile, 'full-path') ?? ''
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const manifest = new Map<string, string>()
  const spine: string[] = []
  visit(parseXml(files.get(opfPath) ?? ''), {
    enter(element) {
      const name = localName(element.name)
      if (name === 'item') {
        const id = attr(element, 'id')
        const href = attr(element, 'href')
        if (id && href) manifest.set(id, safeDecode(href.split('#')[0]))
      } else if (name === 'itemref') {
        const idref = attr(element, 'idref')
        if (idref) spine.push(idref)
      }
    },
  })
  let order = spine
    .map((id) => manifest.get(id))
    .filter((href): href is string => Boolean(href))
    .map((href) => resolvePath(base, href))
  if (!order.length) {
    order = [...files.keys()].filter((name) => /\.(?:xhtml|html|htm)$/i.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }
  return joinBlocks(order.map((name) => htmlToMarkdown(files.get(name) ?? '')))
}

/* ------------------------------------------------------------------- rtf */

const RTF_SKIP = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr',
  'object', 'themedata', 'datastore', 'latentstyles', 'listtable', 'listoverridetable', 'rsidtbl', 'generator',
  'fldinst', 'xmlnstbl', 'colorschememapping', 'private', 'bkmkstart', 'bkmkend',
])
const RTF_SYMBOLS: Record<string, string> = {
  bullet: '•', endash: '–', emdash: '—', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”',
  tab: '\t', par: '\n', line: '\n', sect: '\n', page: '\n', cell: '\t', row: '\n', emspace: ' ', enspace: ' ',
}

export function rtfToText(rtf: string): string {
  const decoder = new TextDecoder('windows-1252')
  const stack: { skip: boolean; uc: number }[] = []
  let skip = false
  let uc = 1
  let out = ''
  let index = 0
  let skipChars = 0

  while (index < rtf.length) {
    const char = rtf[index]
    if (char === '{') {
      stack.push({ skip, uc })
      index += 1
      // `{\*\word ...}` is an optional destination: ignore it entirely.
      if (rtf.startsWith('\\*', index)) skip = true
    } else if (char === '}') {
      const top = stack.pop()
      if (top) ({ skip, uc } = top)
      index += 1
    } else if (char === '\\') {
      const next = rtf[index + 1] ?? ''
      if (next === '\\' || next === '{' || next === '}') {
        if (!skip && !skipChars) out += next
        else if (skipChars) skipChars -= 1
        index += 2
      } else if (next === "'") {
        const code = Number.parseInt(rtf.slice(index + 2, index + 4), 16)
        if (!skip && !skipChars && Number.isFinite(code)) out += decoder.decode(Uint8Array.of(code))
        else if (skipChars) skipChars -= 1
        index += 4
      } else if (next === '~') {
        if (!skip) out += ' '
        index += 2
      } else if (/[a-zA-Z]/.test(next)) {
        const match = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(index, index + 40))
        if (!match) {
          index += 2
          continue
        }
        const word = match[1]
        index += match[0].length
        if (RTF_SKIP.has(word)) skip = true
        else if (word === 'uc') uc = Number(match[2] ?? 1)
        else if (word === 'u' && match[2] !== undefined) {
          if (!skip) out += codePointChar(Number(match[2]) < 0 ? Number(match[2]) + 65536 : Number(match[2]))
          skipChars = uc
        } else if (!skip && RTF_SYMBOLS[word] !== undefined) out += RTF_SYMBOLS[word]
      } else {
        index += 2
      }
    } else if (char === '\r' || char === '\n') {
      index += 1
    } else {
      if (skipChars) skipChars -= 1
      else if (!skip) out += char
      index += 1
    }
  }
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* -------------------------------------------------------------- dispatch */

export const DOCUMENT_EXTENSIONS = new Set(['docx', 'pptx', 'odt', 'odp', 'ods', 'epub', 'rtf'])
export const DOCUMENT_TEXT_LIMIT = 200_000

/** Markdown for a supported document, or undefined when it cannot be read. */
export async function documentToMarkdown(bytes: Uint8Array, extension: string): Promise<string | undefined> {
  try {
    if (extension === 'rtf') {
      const head = new TextDecoder('latin1').decode(bytes.subarray(0, 16))
      if (!head.includes('{\\rtf')) return undefined
      return rtfToText(new TextDecoder('latin1').decode(bytes)) || undefined
    }
    if (!looksLikeZip(bytes)) return undefined

    let markdown = ''
    if (extension === 'docx') {
      const files = await readZipEntries(bytes, (name) => name === 'word/document.xml')
      markdown = docxToMarkdown(files.get('word/document.xml') ?? '')
    } else if (extension === 'pptx') {
      markdown = pptxToMarkdown(
        await readZipEntries(bytes, (name) => /^ppt\/(?:slides\/(?:_rels\/)?slide\d+\.xml(?:\.rels)?|notesSlides\/notesSlide\d+\.xml)$/.test(name)),
      )
    } else if (extension === 'odt' || extension === 'odp' || extension === 'ods') {
      const files = await readZipEntries(bytes, (name) => name === 'content.xml')
      markdown = odfToMarkdown(files.get('content.xml') ?? '', extension)
    } else if (extension === 'epub') {
      markdown = epubToMarkdown(
        await readZipEntries(bytes, (name) => name === 'META-INF/container.xml' || /\.(?:opf|xhtml|html|htm)$/i.test(name)),
      )
    }
    return markdown.trim() ? markdown.slice(0, DOCUMENT_TEXT_LIMIT) : undefined
  } catch {
    return undefined
  }
}

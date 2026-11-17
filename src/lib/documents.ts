/**
 * Reads common document formats in the browser and turns them into Markdown:
 * .docx, .pptx, .odt, .odp, .ods, .epub and .rtf. The Office, OpenDocument and
 * EPUB formats are ZIP archives of XML, read with the platform's
 * DecompressionStream, so there is no parsing library and no upload.
 */

const ENTRY_LIMIT = 40_000_000
const TOTAL_LIMIT = 120_000_000

/** A character reference, or nothing when it is not a valid code point. */
function codePointChar(value: number): string {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ''
}

export function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePointChar(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePointChar(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
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

const tidy = (value: string) => unescapeXml(value).replace(/[ \t\r\n]+/g, ' ').trim()

function escapeCell(cell: string) {
  return cell.replace(/\|/g, '\\|')
}

export function tableToMarkdown(rows: string[][]): string {
  const filled = rows.filter((row) => row.some(Boolean))
  if (!filled.length) return ''
  const columns = Math.max(...filled.map((row) => row.length))
  // A one-column table is a callout box, not data.
  if (columns === 1) return filled.map((row) => row[0]).filter(Boolean).join('\n\n')
  const padded = filled.map((row) => Array.from({ length: columns }, (_, index) => escapeCell(row[index] ?? '')))
  const line = (row: string[]) => `| ${row.join(' | ')} |`
  return [line(padded[0]), line(Array(columns).fill('---')), ...padded.slice(1).map(line)].join('\n')
}

/** Pulls the `\u0000TABLE n\u0000` placeholders out so tables are handled apart from running text. */
function extractBlocks(xml: string, pattern: RegExp): { rest: string; blocks: string[] } {
  const blocks: string[] = []
  const rest = xml.replace(pattern, (match) => {
    blocks.push(match)
    return `\u0000TABLE${blocks.length - 1}\u0000`
  })
  return { rest, blocks }
}

const joinBlocks = (parts: string[]) => parts.filter(Boolean).join('\n\n').replace(/(^\s*- .*)\n\n(?=\s*- )/gm, '$1\n')

/* ------------------------------------------------------------------ docx */

function wordText(paragraph: string): string {
  let out = ''
  for (const match of paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)\s*\/>/g)) {
    out += match[1] === undefined ? (match[0].startsWith('<w:tab') ? ' ' : '\n') : match[1]
  }
  return unescapeXml(out).replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, ' ').trim()
}

function wordTable(xml: string): string {
  const rows = [...xml.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map((row) =>
    [...row[0].matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map((cell) =>
      [...cell[0].matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map((p) => wordText(p[0])).filter(Boolean).join(' '),
    ),
  )
  return tableToMarkdown(rows)
}

export function docxToMarkdown(documentXml: string): string {
  const { rest, blocks } = extractBlocks(documentXml, /<w:tbl>[\s\S]*?<\/w:tbl>/g)
  const out: string[] = []
  for (const match of rest.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>|\u0000TABLE(\d+)\u0000/g)) {
    if (match[1] !== undefined) {
      out.push(wordTable(blocks[Number(match[1])]))
      continue
    }
    const text = wordText(match[0])
    if (!text) continue
    const style = /<w:pStyle\s+w:val="([^"]*)"/.exec(match[0])?.[1] ?? ''
    const heading = /^heading\s*(\d)/i.exec(style)
    if (/^title$/i.test(style)) out.push(`# ${text}`)
    else if (heading) out.push(`${'#'.repeat(Math.min(6, Number(heading[1])))} ${text}`)
    else if (/<w:numPr>/.test(match[0]) || /^list/i.test(style)) {
      const level = Number(/<w:ilvl\s+w:val="(\d+)"/.exec(match[0])?.[1] ?? 0)
      out.push(`${'  '.repeat(Math.min(level, 6))}- ${text}`)
    } else out.push(text)
  }
  return joinBlocks(out)
}

/* ------------------------------------------------------------------ pptx */

function slideParagraphs(xml: string): { text: string; level: number }[] {
  const out: { text: string; level: number }[] = []
  for (const match of xml.replace(/<a:fld\b[\s\S]*?<\/a:fld>/g, '').matchAll(/<a:p[\s>][\s\S]*?<\/a:p>/g)) {
    let text = ''
    for (const part of match[0].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br(?:\s[^>]*)?\/?>/g)) {
      text += part[1] === undefined ? ' ' : part[1]
    }
    text = tidy(text)
    if (text) out.push({ text, level: Number(/<a:pPr[^>]*\blvl="(\d)"/.exec(match[0])?.[1] ?? 0) })
  }
  return out
}

function slideToMarkdown(xml: string, notesXml: string, number: number): string {
  const { rest, blocks } = extractBlocks(xml, /<a:tbl>[\s\S]*?<\/a:tbl>/g)
  let title = ''
  const body: string[] = []
  for (const shape of rest.matchAll(/<p:sp>[\s\S]*?<\/p:sp>|\u0000TABLE(\d+)\u0000/g)) {
    if (shape[1] !== undefined) {
      const rows = [...blocks[Number(shape[1])].matchAll(/<a:tr[\s>][\s\S]*?<\/a:tr>/g)].map((row) =>
        [...row[0].matchAll(/<a:tc[\s>][\s\S]*?<\/a:tc>/g)].map((cell) =>
          slideParagraphs(cell[0]).map((p) => p.text).join(' '),
        ),
      )
      body.push(tableToMarkdown(rows))
      continue
    }
    const paragraphs = slideParagraphs(shape[0])
    if (!paragraphs.length) continue
    if (/<p:ph\b[^>]*type="(?:title|ctrTitle)"/.test(shape[0])) {
      title = title ? `${title} ${paragraphs.map((p) => p.text).join(' ')}` : paragraphs.map((p) => p.text).join(' ')
    } else {
      body.push(paragraphs.map((p) => `${'  '.repeat(Math.min(p.level, 6))}- ${p.text}`).join('\n'))
    }
  }

  const notes = [...notesXml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)]
    .filter((shape) => /<p:ph\b[^>]*type="body"/.test(shape[0]))
    .flatMap((shape) => slideParagraphs(shape[0]).map((p) => p.text))
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
      const target = /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(rels)?.[1]
      return slideToMarkdown(files.get(name) ?? '', target ? (files.get(`ppt/notesSlides/${target}`) ?? '') : '', index + 1)
    }),
  )
}

/* ------------------------------------------------------- OpenDocument */

function odfInline(xml: string): string {
  return tidy(
    xml
      .replace(/<text:s\b[^>]*\/>/g, ' ')
      .replace(/<text:(?:tab|line-break)\b[^>]*\/>/g, ' ')
      .replace(/<text:note\b[\s\S]*?<\/text:note>/g, '')
      .replace(/<[^>]+>/g, ''),
  )
}

function odfTable(xml: string): string {
  const rows = [...xml.matchAll(/<table:table-row(?=[\s>])[\s\S]*?<\/table:table-row>/g)].map((row) => {
    const cells: string[] = []
    for (const cell of row[0].matchAll(/<table:(?:table-cell|covered-table-cell)(?=[\s>/])([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:table-cell|covered-table-cell)>)/g)) {
      const repeat = Number(/table:number-columns-repeated="(\d+)"/.exec(cell[1])?.[1] ?? 1)
      const text = cell[2] ? [...cell[2].matchAll(/<text:p\b[\s\S]*?<\/text:p>/g)].map((p) => odfInline(p[0])).filter(Boolean).join(' ') : ''
      for (let count = 0; count < Math.min(repeat, text ? 1 : 50); count += 1) cells.push(text)
    }
    while (cells.length && !cells[cells.length - 1]) cells.pop()
    return cells
  })
  return tableToMarkdown(rows)
}

export function odfToMarkdown(contentXml: string, kind: 'odt' | 'odp' | 'ods'): string {
  const { rest, blocks } = extractBlocks(contentXml, /<table:table(?=[\s>])[\s\S]*?<\/table:table>/g)
  const out: string[] = []
  let listDepth = 0
  let slide = 0
  const token =
    /<text:h\b[\s\S]*?<\/text:h>|<text:p\b[^>]*?(?:\/>|>[\s\S]*?<\/text:p>)|<text:list-item\b[^>]*>|<\/text:list-item>|<draw:page\b[^>]*>|\u0000TABLE(\d+)\u0000/g
  for (const match of rest.matchAll(token)) {
    const piece = match[0]
    if (match[1] !== undefined) {
      const table = blocks[Number(match[1])]
      const name = kind === 'ods' ? /table:name="([^"]*)"/.exec(table)?.[1] : ''
      if (name) out.push(`## ${unescapeXml(name)}`)
      out.push(odfTable(table))
    } else if (piece.startsWith('<text:list-item')) listDepth += 1
    else if (piece.startsWith('</text:list-item')) listDepth = Math.max(0, listDepth - 1)
    else if (piece.startsWith('<draw:page')) {
      slide += 1
      const name = /draw:name="([^"]*)"/.exec(piece)?.[1]
      out.push(`## Slide ${slide}${name && !/^page\d+$/i.test(name) ? `: ${unescapeXml(name)}` : ''}`)
    } else if (piece.startsWith('<text:h')) {
      const level = Number(/text:outline-level="(\d+)"/.exec(piece)?.[1] ?? 1)
      const text = odfInline(piece)
      if (text) out.push(`${'#'.repeat(Math.min(6, Math.max(1, level)))} ${text}`)
    } else {
      const text = odfInline(piece)
      if (text) out.push(listDepth ? `${'  '.repeat(Math.min(listDepth - 1, 6))}- ${text}` : text)
    }
  }
  return joinBlocks(out)
}

/* ------------------------------------------------------------------ epub */

function htmlToMarkdown(html: string): string {
  const text = html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${tidy(inner.replace(/<[^>]+>/g, ''))}\n\n`)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|ul|ol|blockquote|section|table)>/gi, '\n\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
  return unescapeXml(text)
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

export function epubToMarkdown(files: Map<string, string>): string {
  const container = files.get('META-INF/container.xml') ?? ''
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1] ?? ''
  const opf = files.get(opfPath) ?? ''
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const manifest = new Map<string, string>()
  for (const item of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = /\bid="([^"]*)"/.exec(item[0])?.[1]
    const href = /\bhref="([^"]*)"/.exec(item[0])?.[1]
    if (id && href) manifest.set(id, decodeURIComponent(href.split('#')[0]))
  }
  let order = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]*)"/g)]
    .map((ref) => manifest.get(ref[1]))
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

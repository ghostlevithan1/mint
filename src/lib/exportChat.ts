/**
 * Saving answers and whole chats: as Markdown, or as an A4 PDF written by
 * pdfWriter.ts. Everything happens in the browser.
 */

import type { ChatMessage, Conversation } from './chat'
import { parsePdfSpec, pdfFilename, type PdfBlock, type PdfDocument } from './pdfSpec'
import { downloadPdf } from './pdfWriter'
import { saveBlob } from './download'

/** Inline Markdown as plain text: no asterisks or backticks in the PDF. */
export function plainInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=$|[\s).,;:!?])/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

const VISUAL_FENCES: Record<string, string> = { plot: 'graph', diagram: 'diagram' }

/**
 * A generated PDF fence carries a real document. Its blocks are copied into
 * the export so a saved answer or chat is complete, not a placeholder note.
 */
function pdfFenceBlocks(body: string[], skipTitle?: string): PdfBlock[] {
  try {
    const doc = parsePdfSpec(body.join('\n'))
    const blocks: PdfBlock[] = []
    if (doc.title && doc.title !== skipTitle) blocks.push({ type: 'heading', text: doc.title, level: 1 })
    blocks.push(...doc.blocks)
    return blocks
  } catch {
    return [{ type: 'text', text: '[A PDF file appears here in the app.]' }]
  }
}

/** The first valid generated PDF document inside a markdown answer, if any. */
export function embeddedPdf(markdown: string): PdfDocument | null {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (!trimmed.startsWith('```') && !trimmed.startsWith('~~~')) continue
    const fence = trimmed.slice(0, 3)
    const language = trimmed.slice(3).trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const body: string[] = []
    let cursor = index + 1
    while (cursor < lines.length && !lines[cursor].trim().startsWith(fence)) {
      body.push(lines[cursor])
      cursor += 1
    }
    index = cursor
    if (language !== 'pdf') continue
    try {
      return parsePdfSpec(body.join('\n'))
    } catch {
      // Keep looking: a later fence may be the complete document.
    }
  }
  return null
}

/** A model answer as PDF blocks. Graphs and diagrams are drawn by the app, so the PDF names them instead. */
export function markdownToPdfBlocks(markdown: string, skipPdfTitle?: string): PdfBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: PdfBlock[] = []
  let paragraph: string[] = []

  const flush = () => {
    const text = plainInline(paragraph.join(' '))
    if (text) blocks.push({ type: 'text', text })
    paragraph = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (!trimmed) {
      flush()
      continue
    }

    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      flush()
      const fence = trimmed.slice(0, 3)
      const language = trimmed.slice(3).trim().split(/\s+/)[0]?.toLowerCase() ?? ''
      const body: string[] = []
      let cursor = index + 1
      while (cursor < lines.length && !lines[cursor].trim().startsWith(fence)) {
        body.push(lines[cursor])
        cursor += 1
      }
      index = cursor
      if (language === 'pdf') blocks.push(...pdfFenceBlocks(body, skipPdfTitle))
      else if (VISUAL_FENCES[language]) blocks.push({ type: 'text', text: `[A ${VISUAL_FENCES[language]} appears here in the app.]` })
      else if (body.some((line) => line.trim())) blocks.push({ type: 'text', text: body.join('\n').replace(/\t/g, '    ') })
      continue
    }

    if (trimmed.startsWith('$$') || trimmed.startsWith('\\[')) {
      flush()
      const close = trimmed.startsWith('$$') ? '$$' : '\\]'
      const open = trimmed.startsWith('$$') ? '$$' : '\\['
      const body: string[] = [trimmed.slice(open.length)]
      let cursor = index
      while (!body.join('\n').includes(close) && cursor + 1 < lines.length) {
        cursor += 1
        body.push(lines[cursor])
      }
      index = cursor
      const tex = body.join('\n').split(close)[0].trim()
      if (tex) blocks.push({ type: 'text', text: tex })
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flush()
      const text = plainInline(heading[2])
      if (text) blocks.push({ type: 'heading', text, level: heading[1].length <= 2 ? 1 : 2 })
      continue
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush()
      blocks.push({ type: 'rule' })
      continue
    }

    const bullet = /^[-*+]\s+/
    const numbered = /^\d+[.)]\s+/
    if (bullet.test(trimmed) || numbered.test(trimmed)) {
      flush()
      const marker = bullet.test(trimmed) ? bullet : numbered
      const items: string[] = []
      let cursor = index
      while (cursor < lines.length && marker.test(lines[cursor].trim())) {
        const item = plainInline(lines[cursor].trim().replace(marker, ''))
        if (item) items.push(item)
        cursor += 1
      }
      if (items.length) blocks.push({ type: marker === bullet ? 'bullets' : 'numbers', items })
      index = cursor - 1
      continue
    }

    if (trimmed.startsWith('|')) {
      flush()
      const rows: string[][] = []
      let cursor = index
      while (cursor < lines.length && lines[cursor].trim().startsWith('|')) {
        const cells = lines[cursor]
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => plainInline(cell))
        if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) rows.push(cells)
        cursor += 1
      }
      if (rows.length) blocks.push({ type: 'table', rows })
      index = cursor - 1
      continue
    }

    paragraph.push(trimmed.startsWith('> ') ? trimmed.slice(2) : trimmed)
  }
  flush()
  return blocks
}

export function answerToPdf(markdown: string, title: string): PdfDocument {
  const document = embeddedPdf(markdown)
  if (document) {
    // The answer is (mostly) a generated document: keep its own name so the
    // saved file matches the card, and include any prose around it.
    return {
      title: document.title || title,
      filename: document.filename || pdfFilename('', title),
      blocks: markdownToPdfBlocks(markdown, document.title),
    }
  }
  return { title, filename: pdfFilename('', title), blocks: markdownToPdfBlocks(markdown) }
}

const speaker = (message: ChatMessage, modelName: (id?: string) => string) =>
  message.role === 'user' ? 'You' : `Mint${message.modelId ? ` (${modelName(message.modelId)})` : ''}`

/** The conversation worth saving: questions and finished answers, without failed or empty turns. */
function exportable(chat: Conversation): ChatMessage[] {
  return chat.messages.filter(
    (message) =>
      (message.role === 'user' || message.role === 'assistant') &&
      !message.error &&
      (message.content.trim() || message.attachments?.length),
  )
}

/** Pushes an answer's headings down so they sit under the speaker's heading. Code blocks are left alone. */
function demoteHeadings(markdown: string, by: number): string {
  let fenced = false
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
      if (fenced) return line
      const heading = /^(#{1,6})(\s.*)$/.exec(line)
      return heading ? `${'#'.repeat(Math.min(6, heading[1].length + by))}${heading[2]}` : line
    })
    .join('\n')
}

export function chatToMarkdown(chat: Conversation, modelName: (id?: string) => string): string {
  const parts = [`# ${chat.title}`, `*Saved from Mint on ${new Date().toLocaleDateString()}*`]
  for (const message of exportable(chat)) {
    parts.push(`## ${speaker(message, modelName)}`)
    if (message.attachments?.length) parts.push(`*Attached: ${message.attachments.map((file) => file.name).join(', ')}*`)
    if (message.content.trim()) {
      parts.push(message.role === 'assistant' ? demoteHeadings(message.content.trim(), 2) : message.content.trim())
    }
  }
  return `${parts.join('\n\n')}\n`
}

export function chatToPdf(chat: Conversation, modelName: (id?: string) => string): PdfDocument {
  const blocks: PdfBlock[] = []
  for (const message of exportable(chat)) {
    blocks.push({ type: 'heading', text: speaker(message, modelName), level: 2 })
    if (message.attachments?.length) {
      blocks.push({ type: 'text', text: `Attached: ${message.attachments.map((file) => file.name).join(', ')}` })
    }
    if (message.role === 'user') {
      const text = message.content.trim()
      if (text) blocks.push({ type: 'text', text })
    } else {
      blocks.push(...markdownToPdfBlocks(message.content))
    }
    blocks.push({ type: 'rule' })
  }
  return { title: chat.title, filename: pdfFilename('', chat.title), blocks }
}

/** True when the text has characters the PDF's built-in font cannot print. */
export function hasUnprintableText(text: string): boolean {
  return /[^\u0000-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac\u2212]/.test(text)
}

function saveText(filename: string, text: string) {
  saveBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), filename)
}

export function downloadChatMarkdown(chat: Conversation, modelName: (id?: string) => string) {
  saveText(pdfFilename('', chat.title).replace(/\.pdf$/, '.md'), chatToMarkdown(chat, modelName))
}

export function downloadChatPdf(chat: Conversation, modelName: (id?: string) => string) {
  downloadPdf(chatToPdf(chat, modelName))
}

export function downloadAnswerPdf(markdown: string, title: string) {
  downloadPdf(answerToPdf(markdown, title))
}

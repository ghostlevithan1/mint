import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy, Download, FileCode2 } from 'lucide-react'
import {
  TEXT_FILE_LIMIT,
  describeFence,
  downloadTextFile,
  type FenceInfo,
} from '../lib/generatedFiles'

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-${index}`}>{part.slice(2, -2)}</strong>
    }
    return <span key={`${keyPrefix}-${index}`}>{part}</span>
  })
}

type Block =
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'numbers'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'table'; rows: string[][] }
  | { type: 'code'; code: string; info: FenceInfo }

function CodeFileCard({ code, info }: { code: string; info: FenceInfo }) {
  const [copied, setCopied] = useState(false)
  const compact = code.length < TEXT_FILE_LIMIT

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <figure className={`file-card ${compact ? 'is-compact' : 'is-large'}`}>
      <figcaption className="file-card-head">
        <span className="file-card-icon" aria-hidden="true">
          <FileCode2 size={13} />
        </span>
        <span className="file-card-name" title={info.filename}>
          {info.filename}
        </span>
        <span className="file-card-meta">
          {info.language} · {code.length.toLocaleString()} chars
        </span>
        <span className="file-card-actions">
          <button type="button" onClick={() => void copy()} title="Copy file contents">
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => downloadTextFile(info.filename, code, info.extension)}
            title={`Download ${info.filename}`}
          >
            <Download size={12} />
            Download
          </button>
        </span>
      </figcaption>
      <pre>
        <code>{code}</code>
      </pre>
    </figure>
  )
}

function parseBlocks(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      continue
    }

    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      flushParagraph()
      const fence = trimmed.slice(0, 3)
      const info = trimmed.slice(3).trim()
      const codeLines: string[] = []
      let cursor = index + 1
      while (cursor < lines.length && !lines[cursor].trim().startsWith(fence)) {
        codeLines.push(lines[cursor])
        cursor += 1
      }
      blocks.push({
        type: 'code',
        code: codeLines.join('\n'),
        info: describeFence(info, index),
      })
      index = cursor
      continue
    }

    if (trimmed.startsWith('### ')) {
      flushParagraph()
      blocks.push({ type: 'heading', level: 3, text: trimmed.slice(4) })
      continue
    }
    if (trimmed.startsWith('## ')) {
      flushParagraph()
      blocks.push({ type: 'heading', level: 2, text: trimmed.slice(3) })
      continue
    }
    if (trimmed.startsWith('> ')) {
      flushParagraph()
      blocks.push({ type: 'quote', text: trimmed.slice(2) })
      continue
    }
    if (trimmed.startsWith('- ')) {
      flushParagraph()
      const items: string[] = []
      let cursor = index
      while (cursor < lines.length && lines[cursor].trim().startsWith('- ')) {
        items.push(lines[cursor].trim().slice(2))
        cursor += 1
      }
      blocks.push({ type: 'bullets', items })
      index = cursor - 1
      continue
    }
    if (/^\d+\.\s/.test(trimmed)) {
      flushParagraph()
      const items: string[] = []
      let cursor = index
      while (cursor < lines.length && /^\d+\.\s/.test(lines[cursor].trim())) {
        items.push(lines[cursor].trim().replace(/^\d+\.\s/, ''))
        cursor += 1
      }
      blocks.push({ type: 'numbers', items })
      index = cursor - 1
      continue
    }
    if (trimmed.startsWith('|')) {
      flushParagraph()
      const rows: string[][] = []
      let cursor = index
      while (cursor < lines.length && lines[cursor].trim().startsWith('|')) {
        const cells = lines[cursor]
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cell.trim())
        if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) rows.push(cells)
        cursor += 1
      }
      blocks.push({ type: 'table', rows })
      index = cursor - 1
      continue
    }

    paragraph.push(trimmed)
  }

  flushParagraph()
  return blocks
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text)
  return (
    <div className="markdown">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          if (block.level === 2) {
            return <h3 key={index}>{inline(block.text, `h-${index}`)}</h3>
          }
          return <h4 key={index}>{inline(block.text, `h-${index}`)}</h4>
        }
        if (block.type === 'paragraph') {
          return <p key={index}>{inline(block.text, `p-${index}`)}</p>
        }
        if (block.type === 'bullets') {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item, `b-${index}-${itemIndex}`)}</li>
              ))}
            </ul>
          )
        }
        if (block.type === 'numbers') {
          return (
            <ol key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item, `n-${index}-${itemIndex}`)}</li>
              ))}
            </ol>
          )
        }
        if (block.type === 'quote') {
          return <blockquote key={index}>{inline(block.text, `q-${index}`)}</blockquote>
        }
        if (block.type === 'code') {
          return <CodeFileCard key={index} code={block.code} info={block.info} />
        }
        if (block.type === 'table') {
          return (
            <div className="markdown-table-wrap" key={index}>
              <table>
                <thead>
                  <tr>
                    {block.rows[0]?.map((cell, cellIndex) => (
                      <th key={cellIndex}>{inline(cell, `t-${index}-${cellIndex}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.slice(1).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{inline(cell, `td-${index}-${rowIndex}-${cellIndex}`)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return null
      })}
    </div>
  )
}

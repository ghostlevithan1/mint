import assert from 'node:assert/strict'
import test from 'node:test'
import { layoutToMarkdown, pdfToMarkdown, PdfReadError, type PdfTextItem } from '../src/lib/pdfToMarkdown.ts'
import { parsePdfSpec } from '../src/lib/pdfSpec.ts'
import { buildPdf } from '../src/lib/pdfWriter.ts'

const item = (str: string, x: number, y: number, size = 11): PdfTextItem => ({
  str,
  x,
  y,
  size,
  width: str.length * size * 0.5,
})

test('layout finds headings, paragraphs, lists and tables', () => {
  const md = layoutToMarkdown([
    [
      item('Big Title', 50, 800, 24),
      item('First line of a paragraph that', 50, 760),
      item('wraps onto a second line.', 50, 746),
      item('Another paragraph.', 50, 710),
      item('• one', 50, 680),
      item('• two', 50, 666),
      item('Name', 50, 630),
      item('Score', 300, 630),
      item('Ada', 50, 616),
      item('99', 300, 616),
    ],
  ])
  assert.match(md, /^# Big Title/)
  assert.match(md, /First line of a paragraph that wraps onto a second line\./)
  assert.match(md, /\n\nAnother paragraph\./)
  assert.match(md, /- one\n- two/)
  assert.match(md, /\| Name \| Score \|\n\| --- \| --- \|\n\| Ada \| 99 \|/)
})

test('layout joins hyphenated words and labels pages', () => {
  const md = layoutToMarkdown([
    [item('a photo-', 50, 700), item('synthesis note', 50, 686)],
    [item('Second page', 50, 700)],
  ])
  assert.match(md, /\*Page 1\*/)
  assert.match(md, /photosynthesis note/)
  assert.match(md, /\*Page 2\*\n\nSecond page/)
})

test('a PDF written by Mint reads back as markdown', async () => {
  const doc = parsePdfSpec(
    JSON.stringify({
      title: 'Cell notes',
      blocks: [
        { type: 'heading', text: 'Organelles' },
        { type: 'text', text: 'The nucleus holds the DNA.' },
        { type: 'bullets', items: ['Mitochondria release energy'] },
        { type: 'table', rows: [['Part', 'Job'], ['Ribosome', 'Makes protein']] },
      ],
    }),
  )
  const { markdown, pages } = await pdfToMarkdown(buildPdf(doc))
  assert.equal(pages, 1)
  assert.match(markdown, /# Cell notes/)
  assert.match(markdown, /Organelles/)
  assert.match(markdown, /The nucleus holds the DNA\./)
  assert.match(markdown, /- Mitochondria release energy/)
  assert.match(markdown, /\| Part \| Job \|/)
  assert.match(markdown, /\| Ribosome \| Makes protein \|/)
})

test('unreadable and empty PDFs fail with a clear error', async () => {
  await assert.rejects(pdfToMarkdown(new TextEncoder().encode('not a pdf')), PdfReadError)
  const empty = buildPdf({ title: '', filename: 'x.pdf', blocks: [{ type: 'rule' }] })
  await assert.rejects(pdfToMarkdown(empty), /no selectable text/)
})

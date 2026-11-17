import assert from 'node:assert/strict'
import test from 'node:test'
import { SYSTEM_PROMPT } from '../server/core.ts'
import { PdfSpecError, parsePdfSpec, pdfFilename } from '../src/lib/pdfSpec.ts'
import { buildPdf } from '../src/lib/pdfWriter.ts'

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')

test('the system prompt example is a valid pdf spec', () => {
  const example = /```pdf\n([\s\S]*?)```/.exec(SYSTEM_PROMPT)?.[1]
  assert.ok(example, 'prompt has a pdf example')
  const doc = parsePdfSpec(example)
  assert.equal(doc.filename, 'photosynthesis-revision.pdf')
  assert.ok(doc.blocks.length >= 4)
})

test('parsePdfSpec rejects bad input and drops unknown blocks', () => {
  assert.throws(() => parsePdfSpec('{nope'), PdfSpecError)
  assert.throws(() => parsePdfSpec('[]'), PdfSpecError)
  assert.throws(() => parsePdfSpec('{"title":"x"}'), PdfSpecError)
  const doc = parsePdfSpec('{"title":"T","blocks":[{"type":"script","text":"x"},{"type":"text","text":"hi"}]}')
  assert.deepEqual(doc.blocks, [{ type: 'text', text: 'hi' }])
})

test('pdfFilename is safe', () => {
  assert.equal(pdfFilename('../../evil name.pdf', ''), 'evil-name.pdf')
  assert.equal(pdfFilename('', 'My Notes!'), 'My-Notes.pdf')
  assert.equal(pdfFilename('', ''), 'mint-document.pdf')
})

test('buildPdf writes a well-formed multi-page file', () => {
  const long = Array.from({ length: 200 }, (_, i) => `Line ${i} with (brackets) and \\ slash é “quotes”`).join('\n')
  const doc = parsePdfSpec(
    JSON.stringify({
      title: 'Big',
      blocks: [
        { type: 'heading', text: 'Part' },
        { type: 'text', text: long },
        { type: 'bullets', items: ['a', 'b'] },
        { type: 'table', rows: [['H1', 'H2'], ['x', 'y']] },
      ],
    }),
  )
  const pdf = text(buildPdf(doc))
  assert.ok(pdf.startsWith('%PDF-1.4'))
  assert.ok(pdf.trimEnd().endsWith('%%EOF'))
  const pages = Number(/\/Count (\d+)/.exec(pdf)?.[1])
  assert.ok(pages >= 3, `expected several pages, got ${pages}`)
  assert.equal((pdf.match(/\/Type \/Page /g) ?? []).length, pages)
  const startxref = Number(/startxref\n(\d+)/.exec(pdf)?.[1])
  assert.ok(pdf.slice(startxref).startsWith('xref'))
  for (const match of pdf.matchAll(/(\d{10}) 00000 n/g)) {
    assert.match(pdf.slice(Number(match[1])), /^\d+ 0 obj/)
  }
  for (const match of pdf.matchAll(/\/Length (\d+)>>\nstream\n/g)) {
    const start = (match.index ?? 0) + match[0].length
    assert.equal(pdf.slice(start + Number(match[1]), start + Number(match[1]) + 10), '\nendstream')
  }
})

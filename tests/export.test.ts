import assert from 'node:assert/strict'
import test from 'node:test'
import type { Conversation } from '../src/lib/chat.ts'
import { chatToMarkdown, chatToPdf, hasUnprintableText, markdownToPdfBlocks, plainInline } from '../src/lib/exportChat.ts'
import { readAttachment } from '../src/lib/files.ts'
import { buildPdf } from '../src/lib/pdfWriter.ts'
import { pdfToMarkdown } from '../src/lib/pdfToMarkdown.ts'

test('inline markdown becomes plain text', () => {
  assert.equal(plainInline('**Bold** and *soft* with `code` and [site](https://a.example/x)'), 'Bold and soft with code and site (https://a.example/x)')
  assert.equal(plainInline('2 * 3 * 4'), '2 * 3 * 4')
})

test('an answer becomes headings, lists, tables and notes for visuals', () => {
  const blocks = markdownToPdfBlocks(
    [
      '## The method',
      'First **idea** wraps',
      'onto a second line.',
      '',
      '- one',
      '- two',
      '',
      '1. step',
      '2. next',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```plot',
      '{"chart":"bar"}',
      '```',
      '```python',
      'print(1)',
      '```',
      '$$',
      'x^2',
      '$$',
      '---',
    ].join('\n'),
  )
  assert.deepEqual(blocks, [
    { type: 'heading', text: 'The method', level: 1 },
    { type: 'text', text: 'First idea wraps onto a second line.' },
    { type: 'bullets', items: ['one', 'two'] },
    { type: 'numbers', items: ['step', 'next'] },
    { type: 'table', rows: [['A', 'B'], ['1', '2']] },
    { type: 'text', text: '[A graph appears here in the app.]' },
    { type: 'text', text: 'print(1)' },
    { type: 'text', text: 'x^2' },
    { type: 'rule' },
  ])
})

const chat: Conversation = {
  id: 'c',
  title: 'Photosynthesis help',
  createdAt: 0,
  updatedAt: 0,
  messages: [
    { id: '1', role: 'user', content: 'Explain it', createdAt: 0, attachments: [{ id: 'f', name: 'notes.pdf', size: 1, kind: 'document', text: '', extension: 'pdf' }] },
    { id: '2', role: 'assistant', content: '## Short\nPlants make **sugar**.', createdAt: 0, modelId: 'm', phase: 'done' },
    { id: '3', role: 'assistant', content: '', createdAt: 0, error: 'failed', phase: 'done' },
    { id: '4', role: 'system', content: 'summary', createdAt: 0 },
  ],
}

test('a chat exports as markdown without failed turns or system notes', () => {
  const md = chatToMarkdown(chat, () => 'Model X')
  assert.match(md, /^# Photosynthesis help\n/)
  assert.match(md, /## You\n\n\*Attached: notes\.pdf\*\n\nExplain it/)
  assert.match(md, /## Mint \(Model X\)\n\n#### Short\nPlants make \*\*sugar\*\*\./)
  assert.ok(!md.includes('summary') && !md.includes('failed'))
})

test('a chat exports as a PDF that reads back', async () => {
  const doc = chatToPdf(chat, () => 'Model X')
  assert.equal(doc.filename, 'Photosynthesis-help.pdf')
  const { markdown } = await pdfToMarkdown(buildPdf(doc))
  assert.match(markdown, /Photosynthesis help/)
  assert.match(markdown, /Mint \(Model X\)/)
  assert.match(markdown, /Plants make sugar\./)
  assert.ok(!markdown.includes('**'))
})

test('unprintable scripts are detected so the menu can warn', () => {
  assert.equal(hasUnprintableText('Hello café “quoted” – ok'), false)
  assert.equal(hasUnprintableText('你好'), true)
})

test('files the reader cannot open carry a warning, readable ones do not', async () => {
  const bad = await readAttachment(new File([new Uint8Array([0x4d, 0x5a, 0, 0, 1, 2, 3, 4])], 'tool.exe'))
  assert.match(bad.warning ?? '', /binary/)
  const legacy = await readAttachment(new File(['x'], 'old.doc'))
  assert.match(legacy.warning ?? '', /older format/)
  const brokenPdf = await readAttachment(new File(['not a pdf'], 'a.pdf'))
  assert.match(brokenPdf.warning ?? '', /could not be opened/)
  const good = await readAttachment(new File(['print(1)\n'], 'a.py'))
  assert.equal(good.warning, undefined)
})

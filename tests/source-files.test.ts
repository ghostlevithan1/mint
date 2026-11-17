import assert from 'node:assert/strict'
import test from 'node:test'
import { extensionOf, kindOf, readAttachment } from '../src/lib/files.ts'
import { decodeText, looksLikeText, notebookToMarkdown } from '../src/lib/sourceFiles.ts'

const file = (name: string, content: string | Uint8Array, type = '') => new File([content as BlobPart], name, { type })

test('common language files are recognised as code', () => {
  for (const name of [
    'main.c', 'util.h', 'app.cpp', 'Main.java', 'App.kt', 'view.swift', 'main.go', 'lib.rs', 'app.rb',
    'index.php', 'script.lua', 'analysis.R', 'Program.cs', 'build.gradle', 'main.dart', 'App.vue',
    'page.svelte', 'run.ps1', 'deploy.bat', 'query.sql', 'schema.graphql', 'main.tf', 'a.mjs', 'x.scala',
  ]) {
    assert.equal(kindOf(extensionOf(name)), 'code', name)
  }
})

test('config and doc files are plain text, spreadsheets stay sheets', () => {
  for (const name of ['config.toml', 'settings.ini', 'notes.rst', 'paper.tex', 'fix.patch', '.gitignore', 'data.tsv']) {
    assert.equal(kindOf(extensionOf(name)), 'text', name)
  }
  assert.equal(kindOf(extensionOf('data.csv')), 'sheet')
})

test('extensionless names such as Dockerfile are known', () => {
  assert.equal(extensionOf('Dockerfile'), 'dockerfile')
  assert.equal(extensionOf('src/Makefile'), 'makefile')
  assert.equal(extensionOf('LICENSE'), 'license')
  assert.equal(extensionOf('randomname'), '')
  assert.equal(kindOf(extensionOf('Dockerfile')), 'text')
})

test('decodeText handles UTF-8 and UTF-16 byte-order marks', () => {
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69])), 'hi')
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])), 'hi')
})

test('looksLikeText separates source from binary', () => {
  assert.equal(looksLikeText(new TextEncoder().encode('fn main() { println!("héllo"); }\n')), true)
  assert.equal(looksLikeText(new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])), false)
  assert.equal(looksLikeText(new Uint8Array(0)), false)
  assert.equal(looksLikeText(Uint8Array.from({ length: 400 }, (_, i) => (i % 7 === 0 ? 1 : 65))), false)
})

test('notebooks keep prose and code with text outputs, and drop images', () => {
  const notebook = JSON.stringify({
    metadata: { language_info: { name: 'python' } },
    cells: [
      { cell_type: 'markdown', source: ['# Title\n', 'Some prose'] },
      {
        cell_type: 'code',
        source: ['x = 1\n', 'print(x)'],
        outputs: [
          { output_type: 'stream', text: ['1\n'] },
          { output_type: 'display_data', data: { 'image/png': 'AAAA', 'text/plain': ['<Figure>'] } },
          { output_type: 'error', ename: 'ValueError', evalue: 'bad', traceback: ['\u001b[31mx\u001b[0m'] },
        ],
      },
    ],
  })
  assert.equal(
    notebookToMarkdown(notebook),
    '# Title\nSome prose\n\n```python\nx = 1\nprint(x)\n```\n\nOutput:\n```text\n1\n```\n\nOutput:\n```text\n<Figure>\n```\n\nOutput:\n```text\nValueError: bad\n```',
  )
  assert.equal(notebookToMarkdown('not json'), undefined)
})

test('readAttachment reads code, notebooks and unknown-but-textual files', async () => {
  const code = await readAttachment(file('main.rs', 'fn main() {}\n'))
  assert.equal(code.kind, 'code')
  assert.equal(code.text, 'fn main() {}\n')

  const docker = await readAttachment(file('Dockerfile', 'FROM node:22\n'))
  assert.equal(docker.kind, 'text')
  assert.equal(docker.text, 'FROM node:22\n')

  const nb = await readAttachment(file('a.ipynb', JSON.stringify({ cells: [{ cell_type: 'code', source: 'print(1)' }] })))
  assert.equal(nb.text, '```python\nprint(1)\n```')

  const odd = await readAttachment(file('script.xyz', 'just some text\n'))
  assert.equal(odd.kind, 'text')
  assert.equal(odd.text, 'just some text\n')

  const bin = await readAttachment(file('tool.exe', new Uint8Array([0x4d, 0x5a, 0, 0, 1, 2, 3])))
  assert.equal(bin.kind, 'other')
  assert.match(bin.text, /binary file/)
})

test('very long source files are cut with a note', async () => {
  const long = await readAttachment(file('big.py', 'x = 1\n'.repeat(60_000)))
  assert.match(long.text, /cut off\.\]$/)
  assert.ok(long.text.length < 201_000)
})

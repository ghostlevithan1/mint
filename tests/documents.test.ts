import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import test from 'node:test'
import { documentToMarkdown, readZipEntries, rtfToText } from '../src/lib/documents.ts'

/** Builds a ZIP with stored or deflated entries. The reader ignores CRCs, so they are zero. */
function zip(files: Record<string, string>, deflate = false): Uint8Array {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name)
    const raw = Buffer.from(text)
    const data = deflate ? deflateRawSync(raw) : raw
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(deflate ? 8 : 0, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(deflate ? 8 : 0, 10)
    header.writeUInt32LE(data.length, 20)
    header.writeUInt32LE(raw.length, 24)
    header.writeUInt16LE(nameBytes.length, 28)
    header.writeUInt32LE(offset, 42)
    central.push(header, nameBytes)
    parts.push(local, nameBytes, data)
    offset += 30 + nameBytes.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...parts, directory, end]))
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

test('zip reader inflates deflated and stored entries and skips unwanted ones', async () => {
  for (const deflate of [false, true]) {
    const entries = await readZipEntries(zip({ 'a.txt': 'hello', 'b.txt': 'skip me' }, deflate), (name) => name === 'a.txt')
    assert.deepEqual([...entries], [['a.txt', 'hello']])
  }
})

test('docx becomes markdown with headings, lists and tables', async () => {
  const body = `<w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Intro &amp; goals</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>first</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>nested</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Score</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>Ada</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>99</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Callout text</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>`
  const md = await documentToMarkdown(zip({ 'word/document.xml': body }, true), 'docx')
  assert.equal(
    md,
    '# Intro & goals\n\nHello world\n\n- first\n  - nested\n\n| Name | Score |\n| --- | --- |\n| Ada | 99 |\n\nCallout text\n\nAfter',
  )
})

test('pptx becomes one section per slide, with notes', async () => {
  const slide = (title: string, bullet: string) =>
    `<p:sld><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r><a:br><a:rPr/></a:br><a:r><a:t>x</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:pPr lvl="0"/><a:r><a:t>${bullet}</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>sub</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sld>`
  const notes = `<p:notes><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Say this</a:t></a:r></a:p></p:txBody></p:sp></p:notes>`
  const md = await documentToMarkdown(
    zip({
      'ppt/slides/slide10.xml': slide('Last', 'z'),
      'ppt/slides/slide2.xml': slide('Second', 'b'),
      'ppt/slides/slide1.xml': slide('First', 'a'),
      'ppt/slides/_rels/slide1.xml.rels': '<Relationships><Relationship Target="../notesSlides/notesSlide1.xml"/></Relationships>',
      'ppt/notesSlides/notesSlide1.xml': notes,
    }),
    'pptx',
  )
  assert.ok(md)
  assert.ok(md.indexOf('## Slide 1: First x') < md.indexOf('## Slide 2: Second x'))
  assert.ok(md.indexOf('## Slide 2: Second x') < md.indexOf('## Slide 3: Last x'))
  assert.match(md, /## Slide 1: First x\n\n- a\n  - sub\n\n\*Notes:\* Say this/)
})

test('odt and ods are read from content.xml', async () => {
  const odt = `<office:document-content><text:h text:outline-level="2">Title</text:h><text:p>Plain<text:s/>text</text:p>
    <text:list><text:list-item><text:p>one</text:p></text:list-item><text:list-item><text:p>two</text:p></text:list-item></text:list></office:document-content>`
  assert.equal(await documentToMarkdown(zip({ 'content.xml': odt }), 'odt'), '## Title\n\nPlain text\n\n- one\n- two')

  const ods = `<office:document-content><table:table table:name="Grades"><table:table-row>
    <table:table-cell><text:p>Name</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2"/><table:table-cell><text:p>Score</text:p></table:table-cell></table:table-row>
    <table:table-row><table:table-cell><text:p>Ada</text:p></table:table-cell><table:table-cell/><table:table-cell/><table:table-cell><text:p>9</text:p></table:table-cell></table:table-row></table:table></office:document-content>`
  assert.equal(
    await documentToMarkdown(zip({ 'content.xml': ods }), 'ods'),
    '## Grades\n\n| Name |  |  | Score |\n| --- | --- | --- | --- |\n| Ada |  |  | 9 |',
  )
})

test('epub follows the reading order', async () => {
  const md = await documentToMarkdown(
    zip({
      'META-INF/container.xml': '<container><rootfile full-path="OEBPS/content.opf"/></container>',
      'OEBPS/content.opf':
        '<package><manifest><item id="a" href="b.xhtml"/><item id="b" href="a.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
      'OEBPS/a.xhtml': '<html><head><title>x</title></head><body><h1>Second</h1><p>two &amp; more</p></body></html>',
      'OEBPS/b.xhtml': '<html><body><h1>First</h1><ul><li>item</li></ul></body></html>',
    }),
    'epub',
  )
  assert.equal(md, '# First\n\n- item\n\n# Second\n\ntwo & more')
})

test('rtf keeps text, drops formatting groups and decodes escapes', () => {
  const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}{\colortbl;\red0;}{\*\generator Word;}\pard Hello \b bold\b0  caf\'e9 \u8364?\par Line two\line wraps \{braces\}\par}`
  assert.equal(rtfToText(rtf), 'Hello bold café €\nLine two\nwraps {braces}')
})

test('unreadable input returns undefined instead of throwing', async () => {
  assert.equal(await documentToMarkdown(new TextEncoder().encode('x'.repeat(100)), 'docx'), undefined)
  assert.equal(await documentToMarkdown(zip({ 'word/document.xml': '<w:document/>' }), 'docx'), undefined)
  assert.equal(await documentToMarkdown(new TextEncoder().encode('plain'), 'rtf'), undefined)
})

/**
 * A small, forgiving XML/XHTML reader for the document converters. It runs in
 * linear time on any input: no lazy `<a>[\s\S]*?</a>` regular expressions,
 * which take quadratic time (and freeze the tab) on a crafted file with many
 * unclosed tags. Nesting is capped, so walking the tree cannot overflow.
 */

export type XmlElement = { name: string; attrs: string; children: XmlChild[] }
/** Text children are kept as written (still entity-escaped). */
export type XmlChild = XmlElement | string

const MAX_DEPTH = 256
const VOID_HTML = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr', 'param'])
const NAME_START = /[A-Za-z_]/

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
    .replace(/&#x([0-9a-f]{1,8});/gi, (_, hex) => codePointChar(Number.parseInt(hex, 16)))
    .replace(/&#(\d{1,10});/g, (_, dec) => codePointChar(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
}

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: '#root', attrs: '', children: [] }
  const stack: XmlElement[] = [root]
  const top = () => stack[stack.length - 1]
  const addText = (text: string) => {
    if (text) top().children.push(text)
  }

  let pos = 0
  let nextGt = -1
  while (pos < xml.length) {
    const lt = xml.indexOf('<', pos)
    if (lt < 0) {
      addText(xml.slice(pos))
      break
    }
    addText(xml.slice(pos, lt))

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4)
      pos = end < 0 ? xml.length : end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9)
      addText(escapeText(xml.slice(lt + 9, end < 0 ? xml.length : end)))
      pos = end < 0 ? xml.length : end + 3
      continue
    }

    // The next '>' is remembered, so a run of '<' without one stays linear.
    if (nextGt < lt) nextGt = xml.indexOf('>', lt)
    if (nextGt < 0) {
      addText(escapeText(xml.slice(lt)))
      break
    }
    const nextLt = xml.indexOf('<', lt + 1)
    if (nextLt >= 0 && nextLt < nextGt) {
      // A stray '<' in text, such as "a < b".
      addText('&lt;')
      pos = lt + 1
      continue
    }

    const inner = xml.slice(lt + 1, nextGt)
    pos = nextGt + 1
    if (inner[0] === '?' || inner[0] === '!') continue

    if (inner[0] === '/') {
      const name = inner.slice(1).trim()
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].name === name) {
          stack.length = index
          break
        }
      }
      continue
    }

    if (!NAME_START.test(inner[0] ?? '')) {
      addText(escapeText(`<${inner}>`))
      continue
    }
    let nameEnd = 1
    while (nameEnd < inner.length && !/[\s/]/.test(inner[nameEnd])) nameEnd += 1
    const name = inner.slice(0, nameEnd)
    const selfClosing = inner.endsWith('/')
    const element: XmlElement = { name, attrs: inner.slice(nameEnd, selfClosing ? -1 : undefined), children: [] }
    top().children.push(element)
    if (!selfClosing && !VOID_HTML.has(name.toLowerCase()) && stack.length < MAX_DEPTH) stack.push(element)
  }
  return root
}

/** An attribute's value, unescaped, or undefined. */
export function attr(element: XmlElement | undefined, name: string): string | undefined {
  if (!element) return undefined
  const { attrs } = element
  let from = 0
  for (;;) {
    const at = attrs.indexOf(`${name}=`, from)
    if (at < 0) return undefined
    from = at + 1
    if (at > 0 && !/\s/.test(attrs[at - 1])) continue
    const quote = attrs[at + name.length + 1]
    if (quote !== '"' && quote !== "'") continue
    const start = at + name.length + 2
    const end = attrs.indexOf(quote, start)
    return end < 0 ? undefined : unescapeXml(attrs.slice(start, end))
  }
}

/** The first direct child with this name. */
export function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return element?.children.find((node): node is XmlElement => typeof node !== 'string' && node.name === name)
}

/** The first descendant with this name, depth first. */
export function find(element: XmlElement, name: string): XmlElement | undefined {
  const stack: XmlChild[] = [...element.children].reverse()
  while (stack.length) {
    const node = stack.pop()!
    if (typeof node === 'string') continue
    if (node.name === name) return node
    for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push(node.children[index])
  }
  return undefined
}

/** Descendants whose name is in `names`, in document order, without looking inside a match. */
export function outermost(element: XmlElement, names: Set<string>): XmlElement[] {
  const out: XmlElement[] = []
  const stack: XmlChild[] = [...element.children].reverse()
  while (stack.length) {
    const node = stack.pop()!
    if (typeof node === 'string') continue
    if (names.has(node.name)) {
      out.push(node)
      continue
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push(node.children[index])
  }
  return out
}

export type TextRule = 'text' | 'space' | 'break' | 'skip' | undefined

/**
 * Collects text in document order. `rule` decides per element: 'text' collects
 * the text inside it, 'space' / 'break' stand for a space or newline, 'skip'
 * ignores it. With `allText`, text everywhere is collected.
 */
export function textOf(element: XmlElement, rule: (name: string) => TextRule, allText = false): string {
  let out = ''
  const stack: [XmlChild, boolean][] = []
  for (let index = element.children.length - 1; index >= 0; index -= 1) stack.push([element.children[index], allText])
  while (stack.length) {
    const [node, collecting] = stack.pop()!
    if (typeof node === 'string') {
      if (collecting) out += node
      continue
    }
    const action = rule(node.name)
    if (action === 'skip') continue
    if (action === 'space') {
      out += ' '
      continue
    }
    if (action === 'break') {
      out += '\n'
      continue
    }
    const inside = collecting || action === 'text'
    for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push([node.children[index], inside])
  }
  return unescapeXml(out)
}

/** Visits elements in order with enter/exit callbacks; return false from `enter` to skip the children. */
export function visit(
  root: XmlElement,
  handlers: { enter?: (element: XmlElement) => boolean | void; exit?: (element: XmlElement) => void; text?: (raw: string) => void },
): void {
  const stack: (XmlChild | { exit: XmlElement })[] = [...root.children].reverse()
  while (stack.length) {
    const node = stack.pop()!
    if (typeof node === 'string') {
      handlers.text?.(node)
    } else if ('exit' in node) {
      handlers.exit?.(node.exit)
    } else {
      if (handlers.enter?.(node) === false) continue
      stack.push({ exit: node })
      for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push(node.children[index])
    }
  }
}

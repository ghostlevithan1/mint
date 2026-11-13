export type ImageLink = {
  url: string
  alt: string
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i
const BARE_URL = /https:\/\/[^\s<>()"'`]+/g
const MD_IMAGE = /!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g

/** A remote image URL worth rendering: https only, path ends in an image extension. */
export function isImageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    return IMAGE_EXT.test(url.pathname)
  } catch {
    return false
  }
}

/** Filename from the URL as a fallback alt text. */
function altFromUrl(url: string): string {
  try {
    const name = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    const decoded = decodeURIComponent(name)
    return decoded || 'Image'
  } catch {
    return 'Image'
  }
}

function cleanBareUrl(raw: string): string {
  // Drop trailing punctuation that commonly hugs a URL in prose.
  return raw.replace(/[.,;:!?)\]]+$/, '')
}

/**
 * True when a line is nothing but an image reference (markdown image or a bare
 * image URL), so it can render as a block instead of inline text.
 */
export function isImageLine(line: string): ImageLink | null {
  const trimmed = line.trim()
  const md = trimmed.match(/^!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)$/)
  if (md && isImageUrl(md[2])) {
    return { url: md[2], alt: md[1].trim() || altFromUrl(md[2]) }
  }
  if (isImageUrl(trimmed)) return { url: trimmed, alt: altFromUrl(trimmed) }
  return null
}

/** Every image reference in a message, de-duplicated, in order of appearance. */
export function extractImageLinks(text: string): ImageLink[] {
  const links: ImageLink[] = []
  const seen = new Set<string>()
  const add = (url: string, alt: string) => {
    if (seen.has(url)) return
    seen.add(url)
    links.push({ url, alt })
  }
  for (const match of text.matchAll(MD_IMAGE)) {
    if (isImageUrl(match[2])) add(match[2], match[1].trim() || altFromUrl(match[2]))
  }
  for (const match of text.matchAll(BARE_URL)) {
    const url = cleanBareUrl(match[0])
    if (isImageUrl(url)) add(url, altFromUrl(url))
  }
  return links
}

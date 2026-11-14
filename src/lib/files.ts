import { FILE_LIMIT, MAX_FILES } from './data'

export type AttachmentKind = 'text' | 'document' | 'sheet' | 'image' | 'code' | 'other'

export type Attachment = {
  id: string
  name: string
  size: number
  kind: AttachmentKind
  text: string
  extension: string
  /** Downscaled data URL for vision models. Images only. */
  dataUrl?: string
  /** Prepared image size in pixels, used for context estimation. */
  width?: number
  height?: number
  /** Present when an image could not be decoded on this device. */
  imageError?: string
}

export type ReadAttachmentOptions = {
  /** Re-encode decodable raster images as JPEG before sending. Defaults to true. */
  convertImagesToJpeg?: boolean
}

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'log',
  'html',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'yml',
  'yaml',
  'xml',
  'sql',
  'sh',
  'env',
  'svg',
])

const CODE_EXTENSIONS = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'css', 'html', 'json', 'sh', 'svg'])
const SHEET_EXTENSIONS = new Set(['csv', 'xls', 'xlsx', 'numbers'])
const XLSX_EXTENSIONS = new Set(['xlsx', 'xlsm', 'xltx'])

/** Binary formats that cannot be read client-side at all. */
const UNREADABLE_DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'rtf', 'pages', 'numbers', 'xls'])
const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'jfif',
  'gif',
  'webp',
  'bmp',
  'heic',
  'heif',
  'avif',
  'tif',
  'tiff',
  'ico',
])

const IMAGE_MAX_EDGE = 1600
const IMAGE_DECODE_EDGE = 2400
const IMAGE_MAX_CHARS = 1_200_000
/**
 * Images that fit this cap are kept inline in the persisted chat so follow-ups
 * survive reloads. Anything larger is sent but dropped for storage.
 */
export const PERSIST_IMAGE_MAX_CHARS = 350_000
/** Base64 inflates by ~4/3; keep a raw fallback under the client data-URL cap. */
const RAW_IMAGE_FALLBACK_BYTES = 850_000
const SERVER_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const JPEG_MIMES = new Set(['image/jpeg'])
const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
}
const SCALE_STEPS = [IMAGE_MAX_EDGE, 1280, 1024, 816, 640, 480, 360, 256]

export function extensionOf(name: string) {
  const parts = name.split('.')
  return parts.length > 1 ? parts.pop()!.toLowerCase() : ''
}

export function kindOf(extension: string, mime = ''): AttachmentKind {
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (SHEET_EXTENSIONS.has(extension)) return 'sheet'
  if (CODE_EXTENSIONS.has(extension)) return 'code'
  if (TEXT_EXTENSIONS.has(extension)) return 'text'
  if (['pdf', 'doc', 'docx', 'rtf', 'pages'].includes(extension)) return 'document'
  // Android pickers can return a display name without an extension. Trust the
  // MIME type so gallery photos still reach the vision path.
  if (mime.toLowerCase().startsWith('image/')) return 'image'
  return 'other'
}

function imageMimeOf(file: File, extension: string) {
  const declared = file.type.trim().toLowerCase()
  if (declared === 'image/jpg') return 'image/jpeg'
  if (declared.startsWith('image/')) return declared
  return MIME_BY_EXTENSION[extension] ?? ''
}

/** The format to keep when JPEG conversion is disabled. */
function preservedImageMime(file: File, extension: string) {
  const mime = imageMimeOf(file, extension)
  if (mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp') return mime
  // Canvas cannot reliably write GIF, BMP, HEIC, TIFF, or AVIF. PNG keeps the
  // image lossless and is accepted by the proxy.
  return 'image/png'
}

type DecodedImage = {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

async function decodeImage(file: File): Promise<DecodedImage | undefined> {
  if (typeof createImageBitmap === 'function') {
    // Decode at a bounded width first. Phone photos can be 100+ megapixels;
    // decoding one at full size can exhaust memory before the downscale runs.
    try {
      const bitmap = await createImageBitmap(file, {
        resizeWidth: IMAGE_DECODE_EDGE,
        resizeQuality: 'high',
      })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    } catch {
      // Fall through to a plain decode, then an <img> element.
    }

    try {
      const bitmap = await createImageBitmap(file)
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    } catch {
      // Formats such as HEIC may not decode in Chromium; try an <img> below.
    }
  }

  if (typeof Image === 'function' && typeof URL !== 'undefined') {
    const url = URL.createObjectURL(file)
    try {
      const image = new Image()
      image.decoding = 'async'
      if (typeof image.decode === 'function') {
        image.src = url
        await image.decode()
      } else {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve()
          image.onerror = () => reject(new Error('image-decode'))
          image.src = url
        })
      }
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      }
    } catch {
      URL.revokeObjectURL(url)
    }
  }

  return undefined
}

type PreparedImage = {
  url: string
  width: number
  height: number
}

async function encodeImage(file: File, outputMime: string): Promise<PreparedImage | undefined> {
  let decoded: DecodedImage | undefined
  try {
    decoded = await decodeImage(file)
    if (!decoded || !decoded.width || !decoded.height) return undefined

    const sourceEdge = Math.max(decoded.width, decoded.height)
    const qualities =
      outputMime === 'image/png' ? [undefined] : [0.86, 0.72, 0.6, 0.5, 0.4, 0.3, 0.22]
    let smallest: PreparedImage | undefined
    let lastEdge = 0

    for (const step of SCALE_STEPS) {
      // Never upscale, and skip repeated sizes for images smaller than the cap.
      const edge = Math.min(step, sourceEdge)
      if (edge === lastEdge) continue
      lastEdge = edge

      const scale = edge / sourceEdge
      const width = Math.max(1, Math.round(decoded.width * scale))
      const height = Math.max(1, Math.round(decoded.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) return undefined

      if (outputMime === 'image/jpeg') {
        // Flatten transparency onto white so JPEG encoding stays predictable.
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, width, height)
      }
      context.drawImage(decoded.source, 0, 0, width, height)

      for (const quality of qualities) {
        const url =
          quality === undefined
            ? canvas.toDataURL(outputMime)
            : canvas.toDataURL(outputMime, quality)
        if (!smallest || url.length < smallest.url.length) smallest = { url, width, height }
        // Highest-quality image that fits the storage budget wins; we stop
        // shrinking as soon as one does.
        if (url.length <= PERSIST_IMAGE_MAX_CHARS) return { url, width, height }
      }
    }
    return smallest && smallest.url.length <= IMAGE_MAX_CHARS ? smallest : undefined
  } catch {
    return undefined
  } finally {
    decoded?.release()
  }
}

function imageSignatureMime(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).startsWith('GIF8')) {
    return 'image/gif'
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return ''
}

/**
 * Walks the GIF block structure and returns true when a second frame is found.
 * A single-frame GIF is safe to re-encode, but re-encoding an animated one as
 * JPEG silently drops every frame after the first.
 */
export function gifIsAnimated(bytes: Uint8Array): boolean {
  if (bytes.length < 14) return false
  const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5])
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return false

  let pos = 13
  const packed = bytes[10]
  if (packed & 0x80) pos += 3 * (1 << ((packed & 0x07) + 1))

  const skipSubBlocks = () => {
    while (pos < bytes.length) {
      const size = bytes[pos++]
      if (size === 0) return true
      pos += size
    }
    return false
  }

  let frames = 0
  while (pos < bytes.length) {
    const block = bytes[pos++]
    if (block === 0x3b) return false // trailer reached before a second frame
    if (block === 0x21) {
      pos += 1 // extension label, then its sub-blocks
      if (!skipSubBlocks()) return false
      continue
    }
    if (block === 0x2c) {
      frames += 1
      if (frames > 1) return true
      if (pos + 9 > bytes.length) return false
      const imagePacked = bytes[pos + 8]
      pos += 9
      if (imagePacked & 0x80) pos += 3 * (1 << ((imagePacked & 0x07) + 1))
      if (pos >= bytes.length) return false
      pos += 1 // LZW minimum code size
      if (!skipSubBlocks()) return false
      continue
    }
    return false
  }
  return false
}

async function isAnimatedGif(file: File, extension: string): Promise<boolean> {
  if (extension !== 'gif' && imageMimeOf(file, extension) !== 'image/gif') return false
  try {
    return gifIsAnimated(new Uint8Array(await file.arrayBuffer()))
  } catch {
    return false
  }
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
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

/**
 * Lists and inflates the useful parts of an OOXML (.xlsx) archive with the
 * platform's ZIP format and DecompressionStream — no parsing library and no
 * added bundle weight.
 */
async function readXlsxEntries(bytes: Uint8Array): Promise<Map<string, string>> {
  const entries = new Map<string, string>()
  try {
    const eocd = findEndOfCentralDirectory(bytes)
    if (eocd < 0) return entries
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const entryCount = view.getUint16(eocd + 10, true)
    let offset = view.getUint32(eocd + 16, true)
    const textDecoder = new TextDecoder()

    for (let index = 0; index < entryCount; index += 1) {
      if (
        bytes[offset] !== 0x50 ||
        bytes[offset + 1] !== 0x4b ||
        bytes[offset + 2] !== 0x01 ||
        bytes[offset + 3] !== 0x02
      ) {
        break
      }
      const method = view.getUint16(offset + 10, true)
      const compressedSize = view.getUint32(offset + 20, true)
      const uncompressedSize = view.getUint32(offset + 24, true)
      const nameLength = view.getUint16(offset + 28, true)
      const extraLength = view.getUint16(offset + 30, true)
      const commentLength = view.getUint16(offset + 32, true)
      const localHeaderOffset = view.getUint32(offset + 42, true)
      const name = textDecoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
      offset += 46 + nameLength + extraLength + commentLength

      const isText =
        name === 'xl/sharedStrings.xml' ||
        /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
      if (!isText) continue

      const localNameLength = view.getUint16(localHeaderOffset + 26, true)
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
      try {
        if (method === 0) {
          entries.set(name, textDecoder.decode(compressed))
        } else if (method === 8 && uncompressedSize) {
          entries.set(name, textDecoder.decode(await inflateRaw(compressed)))
        }
      } catch {
        // Skip unreadable entries; partial text is better than none.
      }
    }
  } catch {
    // Malformed archive: fall through with whatever was read.
  }
  return entries
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
}

/** Extracts visible cell text from an .xlsx in reading order. */
async function extractXlsxText(file: File): Promise<string | undefined> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length < 64 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return undefined
    const entries = await readXlsxEntries(bytes)
    if (!entries.size) return undefined

    const sharedRaw = entries.get('xl/sharedStrings.xml') ?? ''
    const sharedStrings: string[] = []
    if (sharedRaw) {
      for (const match of sharedRaw.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)) {
        const text = unescapeXml(
          [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
            .map((part) => part[1])
            .join(''),
        ).replace(/\s+/g, ' ')
        sharedStrings.push(text)
      }
    }

    const worksheetNames = [...entries.keys()]
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

    const lines: string[] = []
    for (const name of worksheetNames) {
      const xml = entries.get(name) ?? ''
      for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells: string[] = []
        for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
          const attrs = cell[1]
          const body = cell[2]
          const valueMatch = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)
          const inlineMatch = body.match(/<t[^>]*>([\s\S]*?)<\/t>/)
          let value = ''
          if (/t\s*=\s*"s"/.test(attrs)) {
            const index = Number(valueMatch?.[1])
            value = Number.isFinite(index) ? sharedStrings[index] ?? '' : ''
          } else if (inlineMatch) {
            value = unescapeXml(inlineMatch[1])
          } else if (valueMatch) {
            value = unescapeXml(valueMatch[1])
          }
          cells.push(value)
        }
        const line = cells.join('\t').replace(/[ ]+/g, ' ').trimEnd()
        if (line.trim()) lines.push(line)
      }
    }
    const text = lines.join('\n').slice(0, 200_000)
    return text.trim() ? text : undefined
  } catch {
    return undefined
  }
}

async function readRawImage(
  file: File,
  allowed: Set<string>,
): Promise<string | undefined> {
  // Only fall back to the original bytes when they fit the server limit.
  if (file.size <= 0 || file.size > RAW_IMAGE_FALLBACK_BYTES) {
    return undefined
  }

  // Make sure the bytes match an accepted format before forwarding the
  // original file upstream, regardless of what the file name or MIME claims.
  let mime = ''
  try {
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
    mime = imageSignatureMime(header)
  } catch {
    return undefined
  }
  if (!mime || !allowed.has(mime)) return undefined

  return new Promise<string | undefined>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : ''
      const comma = raw.indexOf(',')
      if (comma < 0) return resolve(undefined)
      const url = `data:${mime};base64,${raw.slice(comma + 1)}`
      resolve(url.length > 64 && url.length <= IMAGE_MAX_CHARS ? url : undefined)
    }
    reader.onerror = () => resolve(undefined)
    reader.readAsDataURL(file)
  })
}

export async function readAttachment(
  file: File,
  options: ReadAttachmentOptions = {},
): Promise<Attachment> {
  const extension = extensionOf(file.name)
  const kind = kindOf(extension, file.type)
  let text = ''
  if (TEXT_EXTENSIONS.has(extension)) {
    try {
      text = (await file.slice(0, 200_000).text()).slice(0, 200_000)
    } catch {
      text = ''
    }
  } else if (kind === 'sheet' && XLSX_EXTENSIONS.has(extension)) {
    text = (await extractXlsxText(file)) ?? ''
    if (!text) {
      text = `[Spreadsheet "${file.name}": could not be read as an Office .xlsx file. Export it as .csv or .txt and attach that, or convert sheets to images.]`
    }
  } else if (kind === 'document' || (kind === 'sheet' && UNREADABLE_DOCUMENT_EXTENSIONS.has(extension))) {
    // No trustworthy client-side extractor for these. Say so in the context
    // instead of silently attaching a filename the model can't use.
    text = `[Document "${file.name}": the contents of this file cannot be sent to the model. Export the text as .txt, the spreadsheet as .csv or .xlsx, or convert pages to images.]`
  }

  let dataUrl: string | undefined
  let width: number | undefined
  let height: number | undefined
  let imageError: string | undefined
  if (kind === 'image') {
    const sourceMime = imageMimeOf(file, extension)
    if (await isAnimatedGif(file, extension)) {
      // NVIDIA rejects GIF uploads, so an animation cannot be sent at all.
      imageError =
        'Animated GIFs cannot be sent to NVIDIA models. Attach a still image or export a single frame first.'
    } else if (options.convertImagesToJpeg !== false || sourceMime === 'image/gif') {
      // GIF is never accepted upstream, so still GIFs become JPEG even when
      // automatic conversion is switched off.
      const prepared = await encodeImage(file, 'image/jpeg')
      if (prepared) {
        dataUrl = prepared.url
        width = prepared.width
        height = prepared.height
      } else {
        // If the browser cannot re-encode, a JPEG original can still be sent.
        dataUrl = await readRawImage(file, JPEG_MIMES)
      }
    } else {
      // Prefer the original bytes while they fit the storage budget. If they
      // don't, re-encode smaller so the image both sends and persists.
      const raw = await readRawImage(file, SERVER_IMAGE_MIMES)
      if (raw && raw.length <= PERSIST_IMAGE_MAX_CHARS) {
        dataUrl = raw
      } else {
        const prepared = await encodeImage(file, preservedImageMime(file, extension))
        if (prepared) {
          dataUrl = prepared.url
          width = prepared.width
          height = prepared.height
        } else if (raw) {
          dataUrl = raw
        }
      }
    }
    if (!dataUrl && !imageError) {
      imageError = 'This image could not be prepared for sending on this device.'
    }
  }

  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    size: file.size,
    kind,
    text,
    extension: extension || 'file',
    dataUrl,
    width,
    height,
    imageError,
  }
}

export type FileValidation = {
  accepted: File[]
  error: string
}

export function validateIncoming(files: FileList | File[], existingCount: number): FileValidation {
  const incoming = Array.from(files)
  if (!incoming.length) return { accepted: [], error: '' }

  const availableSlots = Math.max(0, MAX_FILES - existingCount)
  if (availableSlots <= 0) {
    return { accepted: [], error: `You can attach up to ${MAX_FILES} files per message.` }
  }

  const tooLarge = incoming.filter((file) => file.size > FILE_LIMIT)
  const usable = incoming.filter((file) => file.size <= FILE_LIMIT && file.size > 0)
  const accepted = usable.slice(0, availableSlots)

  let error = ''
  if (tooLarge.length) {
    error = `${tooLarge.map((file) => file.name).join(', ')} exceeds the 25 MB limit and was rejected.`
  } else if (incoming.length > availableSlots) {
    error = `Only ${availableSlots} more file${availableSlots === 1 ? '' : 's'} can be added.`
  }

  return { accepted, error }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

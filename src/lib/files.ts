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
  /** Present when an image could not be decoded on this device. */
  imageError?: string
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
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic'])

const IMAGE_MAX_EDGE = 1600
const IMAGE_DECODE_EDGE = 2400
const IMAGE_MAX_CHARS = 1_200_000
/** Base64 inflates by ~4/3; keep a raw fallback under the client data-URL cap. */
const RAW_IMAGE_FALLBACK_BYTES = 850_000
const ACCEPTED_IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i

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

async function encodeImage(file: File): Promise<string | undefined> {
  let decoded: DecodedImage | undefined
  try {
    decoded = await decodeImage(file)
    if (!decoded || !decoded.width || !decoded.height) return undefined

    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return undefined

    // Flatten transparency onto white so JPEG encoding stays predictable.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(decoded.source, 0, 0, width, height)

    let smallest = ''
    for (const quality of [0.86, 0.7, 0.55, 0.42]) {
      const url = canvas.toDataURL('image/jpeg', quality)
      if (!smallest || url.length < smallest.length) smallest = url
      if (url.length <= IMAGE_MAX_CHARS) return url
    }
    return smallest.length <= IMAGE_MAX_CHARS ? smallest : undefined
  } catch {
    return undefined
  } finally {
    decoded?.release()
  }
}

function hasImageSignature(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return true
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return true
  }
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).startsWith('GIF8')) {
    return true
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return true
  }
  return false
}

async function readRawImage(file: File): Promise<string | undefined> {
  // Only fall back to the original bytes when they fit the server limit.
  if (file.size <= 0 || file.size > RAW_IMAGE_FALLBACK_BYTES) {
    return Promise.resolve(undefined)
  }

  // Decoding failed; make sure the bytes at least look like a supported image
  // before forwarding the original file upstream.
  try {
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
    if (!hasImageSignature(header)) return undefined
  } catch {
    return undefined
  }

  return new Promise<string | undefined>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      resolve(
        url.length > 64 &&
          ACCEPTED_IMAGE_DATA_URL.test(url) &&
          url.length <= IMAGE_MAX_CHARS
          ? url
          : undefined,
      )
    }
    reader.onerror = () => resolve(undefined)
    reader.readAsDataURL(file)
  })
}

export async function readAttachment(file: File): Promise<Attachment> {
  const extension = extensionOf(file.name)
  const kind = kindOf(extension, file.type)
  let text = ''
  if (TEXT_EXTENSIONS.has(extension)) {
    try {
      text = (await file.slice(0, 200_000).text()).slice(0, 200_000)
    } catch {
      text = ''
    }
  }

  let dataUrl: string | undefined
  if (kind === 'image') {
    dataUrl = await encodeImage(file)
    if (!dataUrl) dataUrl = await readRawImage(file)
  }

  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    size: file.size,
    kind,
    text,
    extension: extension || 'file',
    dataUrl,
    imageError:
      kind === 'image' && !dataUrl
        ? 'This image could not be decoded on this device.'
        : undefined,
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

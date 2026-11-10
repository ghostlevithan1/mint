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
const IMAGE_MAX_CHARS = 1_200_000
const RAW_IMAGE_FALLBACK_BYTES = 3_500_000

export function extensionOf(name: string) {
  const parts = name.split('.')
  return parts.length > 1 ? parts.pop()!.toLowerCase() : ''
}

export function kindOf(extension: string): AttachmentKind {
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (SHEET_EXTENSIONS.has(extension)) return 'sheet'
  if (CODE_EXTENSIONS.has(extension)) return 'code'
  if (TEXT_EXTENSIONS.has(extension)) return 'text'
  if (['pdf', 'doc', 'docx', 'rtf', 'pages'].includes(extension)) return 'document'
  return 'other'
}

async function encodeImage(file: File): Promise<string | undefined> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file)
      try {
        const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
        const width = Math.max(1, Math.round(bitmap.width * scale))
        const height = Math.max(1, Math.round(bitmap.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) return undefined

        // Flatten transparency onto white so JPEG encoding stays predictable.
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, width, height)
        context.drawImage(bitmap, 0, 0, width, height)

        let smallest = ''
        for (const quality of [0.86, 0.7, 0.55]) {
          const url = canvas.toDataURL('image/jpeg', quality)
          if (!smallest || url.length < smallest.length) smallest = url
          if (url.length <= IMAGE_MAX_CHARS) return url
        }
        return smallest.length <= IMAGE_MAX_CHARS * 1.5 ? smallest : undefined
      } finally {
        bitmap.close()
      }
    }
  } catch {
    // Formats such as HEIC may not decode in Chromium; try a raw data URL below.
  }

  if (file.size > RAW_IMAGE_FALLBACK_BYTES) return undefined
  return new Promise<string | undefined>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      resolve(/^data:image\/(?:png|jpe?g|webp|gif);base64,/.test(url) ? url : undefined)
    }
    reader.onerror = () => resolve(undefined)
    reader.readAsDataURL(file)
  })
}

export async function readAttachment(file: File): Promise<Attachment> {
  const extension = extensionOf(file.name)
  const kind = kindOf(extension)
  let text = ''
  if (TEXT_EXTENSIONS.has(extension)) {
    try {
      text = (await file.slice(0, 200_000).text()).slice(0, 200_000)
    } catch {
      text = ''
    }
  }
  const dataUrl = kind === 'image' ? await encodeImage(file) : undefined
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    size: file.size,
    kind,
    text,
    extension: extension || 'file',
    dataUrl,
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

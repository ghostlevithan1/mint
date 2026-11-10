import { FILE_LIMIT, MAX_FILES } from './data'

export type AttachmentKind = 'text' | 'document' | 'sheet' | 'image' | 'code' | 'other'

export type Attachment = {
  id: string
  name: string
  size: number
  kind: AttachmentKind
  text: string
  extension: string
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
])

const CODE_EXTENSIONS = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'css', 'html', 'json', 'sh'])
const SHEET_EXTENSIONS = new Set(['csv', 'xls', 'xlsx', 'numbers'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic'])

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

export async function readAttachment(file: File): Promise<Attachment> {
  const extension = extensionOf(file.name)
  let text = ''
  if (TEXT_EXTENSIONS.has(extension)) {
    try {
      text = (await file.slice(0, 200_000).text()).slice(0, 200_000)
    } catch {
      text = ''
    }
  }
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    size: file.size,
    kind: kindOf(extension),
    text,
    extension: extension || 'file',
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

import { useRef, useState } from 'react'
import { MAX_FILES } from '../lib/data'
import { readAttachment, validateIncoming, type Attachment } from '../lib/files'

export function useAttachments(convertImagesToJpeg = true) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const readingRef = useRef(false)

  /** Reads files and resolves with the newly added attachments, if any. */
  const addFiles = async (files: FileList | File[]): Promise<Attachment[]> => {
    if (readingRef.current) return []
    const { accepted, error: validationError } = validateIncoming(files, attachments.length)
    if (validationError) setError(validationError)
    else setError('')
    if (!accepted.length) return []

    readingRef.current = true
    setReading(true)
    try {
      const loaded = await Promise.all(
        accepted.map((file) => readAttachment(file, { convertImagesToJpeg })),
      )
      setAttachments((current) => [...current, ...loaded].slice(0, MAX_FILES))
      return loaded
    } catch {
      setError('A file could not be read on this device. Please try another file.')
      return []
    } finally {
      readingRef.current = false
      setReading(false)
    }
  }

  const removeFile = (id: string) => {
    setAttachments((current) => current.filter((file) => file.id !== id))
    setError('')
  }

  const clear = () => {
    setAttachments([])
    setError('')
  }

  return { attachments, error, reading, addFiles, removeFile, clear, setError }
}

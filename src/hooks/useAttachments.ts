import { useRef, useState } from 'react'
import { MAX_FILES } from '../lib/data'
import { readAttachment, validateIncoming, type Attachment } from '../lib/files'

export function useAttachments() {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const readingRef = useRef(false)

  const addFiles = async (files: FileList | File[]) => {
    if (readingRef.current) return
    const { accepted, error: validationError } = validateIncoming(files, attachments.length)
    if (validationError) setError(validationError)
    else setError('')
    if (!accepted.length) return

    readingRef.current = true
    setReading(true)
    try {
      const loaded = await Promise.all(accepted.map(readAttachment))
      setAttachments((current) => [...current, ...loaded].slice(0, MAX_FILES))
    } catch {
      setError('A file could not be read on this device. Please try another file.')
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

import { memo, useMemo } from 'react'
import { Download, FileText, Loader2, TriangleAlert } from 'lucide-react'
import { PdfSpecError, parsePdfSpec } from '../lib/pdfSpec'
import { downloadPdf } from '../lib/pdfWriter'

/** Turns the fenced ```pdf spec into a downloadable PDF card. */
export const PdfCard = memo(function PdfCard({ spec, streaming = false }: { spec: string; streaming?: boolean }) {
  const result = useMemo(() => {
    try {
      return { doc: parsePdfSpec(spec) }
    } catch (error) {
      return { error: error instanceof PdfSpecError ? error.message : 'The PDF could not be made.' }
    }
  }, [spec])

  if ('error' in result) {
    return streaming ? (
      <div className="plot-pending" role="status">
        <Loader2 size={16} className="spin" aria-hidden="true" />
        <span>Writing the PDF</span>
      </div>
    ) : (
      <div className="plot-error" role="status">
        <TriangleAlert size={14} aria-hidden="true" />
        <span>{result.error}</span>
      </div>
    )
  }

  const { doc } = result
  const headings = doc.blocks.filter((block) => block.type === 'heading')
  return (
    <figure className="file-card is-compact">
      <figcaption className="file-card-head">
        <span className="file-card-icon" aria-hidden="true">
          <FileText size={13} />
        </span>
        <span className="file-card-name" title={doc.filename}>
          {doc.filename}
        </span>
        <span className="file-card-meta">PDF</span>
        <span className="file-card-actions">
          <button
            type="button"
            onClick={() => downloadPdf(doc)}
            title={`Download ${doc.filename}`}
          >
            <Download size={12} />
            Download
          </button>
        </span>
      </figcaption>
      <div className="file-card-note">
        <FileText size={13} />
        <p>
          {doc.title || 'Untitled document'}
          {headings.length > 0 && ` — ${headings.map((block) => block.text).join(' · ')}`}
        </p>
      </div>
    </figure>
  )
})

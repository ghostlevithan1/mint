import { useState } from 'react'
import { ExternalLink, FileWarning } from 'lucide-react'

/**
 * A remote image referenced by a URL in a message. Renders lazily with no
 * referrer, and degrades to a plain link if the host is unreachable, blocks
 * hotlinking, or the URL dies.
 */
export function RemoteImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <a
        className="remote-image-fallback"
        href={url}
        target="_blank"
        rel="noreferrer noopener"
      >
        <FileWarning size={14} aria-hidden="true" />
        <span>{alt}</span>
        <small>Could not load image — open link</small>
      </a>
    )
  }

  return (
    <figure className="remote-image">
      <a href={url} target="_blank" rel="noreferrer noopener" title="Open original">
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </a>
      <figcaption>
        <span className="remote-image-alt" title={alt}>
          {alt}
        </span>
        <a href={url} target="_blank" rel="noreferrer noopener">
          Open original
          <ExternalLink size={11} aria-hidden="true" />
        </a>
      </figcaption>
    </figure>
  )
}

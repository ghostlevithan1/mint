import { useState } from 'react'
import { ExternalLink, FileWarning, ImageOff } from 'lucide-react'
import { useImageHost } from '../hooks/useImageHost'
import { imageHost } from '../lib/imageLinks'

type RemoteImageProps = {
  url: string
  alt: string
  /**
   * Links the student typed themselves load straight away. Images in an
   * answer wait for a click (or an allowed site), because loading one tells
   * that site the full URL, which a model could have filled with private text.
   */
  trusted?: boolean
}

/** Whether to show the image now, and the controls that change that. */
function useImageGate(url: string, trusted: boolean) {
  const host = imageHost(url)
  const [allowed, allowHost] = useImageHost(host)
  const [revealed, setRevealed] = useState(false)
  return {
    host,
    visible: trusted || allowed || revealed,
    show: () => setRevealed(true),
    always: () => {
      allowHost()
      setRevealed(true)
    },
  }
}

/**
 * A remote image referenced by a URL in a message. Renders lazily with no
 * referrer, and degrades to a plain link if the host is unreachable, blocks
 * hotlinking, or the URL dies.
 */
export function RemoteImage({ url, alt, trusted = false }: RemoteImageProps) {
  const [failed, setFailed] = useState(false)
  const gate = useImageGate(url, trusted)

  if (!gate.visible) {
    return (
      <div className="remote-image-gate" role="group" aria-label={`Image from ${gate.host}`}>
        <ImageOff size={15} aria-hidden="true" />
        <span className="remote-image-gate-copy">
          <strong title={alt}>{alt}</strong>
          <small>Image from {gate.host}. Not loaded until you choose to.</small>
        </span>
        <button type="button" onClick={gate.show}>
          Show
        </button>
        <button type="button" className="is-quiet" onClick={gate.always}>
          Always show from {gate.host}
        </button>
      </div>
    )
  }

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

/** An image written inside a sentence, held back the same way. */
export function InlineRemoteImage({ url, alt, trusted = false }: RemoteImageProps) {
  const gate = useImageGate(url, trusted)

  if (!gate.visible) {
    return (
      <span className="remote-image-chip">
        <ImageOff size={12} aria-hidden="true" />
        <span title={alt}>{alt}</span>
        <button type="button" onClick={gate.show} title={`Load this image from ${gate.host}`}>
          Show
        </button>
        <button type="button" className="is-quiet" onClick={gate.always} title={`Always show images from ${gate.host}`}>
          Always
        </button>
      </span>
    )
  }

  return (
    <a
      className="markdown-inline-image"
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={alt}
    >
      <img src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    </a>
  )
}

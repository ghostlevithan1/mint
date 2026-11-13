import { memo, useEffect, useState } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import { fetchPlotImage } from '../lib/plots'

/**
 * Renders the fenced ```plot spec the model emits. Invalid JSON stays in a
 * neutral "pending" state instead of spamming the endpoint; once the fence is
 * closed the spec is complete and the server draws it with matplotlib.
 */
export const PlotImage = memo(function PlotImage({ spec }: { spec: string }) {
  const [state, setState] = useState<'pending' | 'ready' | 'error'>('pending')
  const [image, setImage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(spec)
    } catch {
      parsed = null
    }
    if (!parsed) {
      setState('pending')
      return
    }
    let active = true
    setState('pending')
    fetchPlotImage(spec)
      .then((rendered) => {
        if (!active) return
        setImage(rendered)
        setState('ready')
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(caught instanceof Error ? caught.message : 'The plot could not be rendered.')
        setState('error')
      })
    return () => {
      active = false
    }
  }, [spec])

  if (state === 'error') {
    return (
      <div className="plot-error" role="status">
        <TriangleAlert size={13} aria-hidden="true" />
        <span>{error}</span>
      </div>
    )
  }

  if (state === 'pending') {
    return (
      <div className="plot-pending" role="status">
        <Loader2 size={15} className="spin" aria-hidden="true" />
        <span>Plotting…</span>
      </div>
    )
  }

  return (
    <figure className="remote-image plot-image">
      <img src={image} alt="Plot rendered from the model's spec" loading="lazy" decoding="async" />
      <figcaption>
        <span className="remote-image-alt">Rendered locally with matplotlib</span>
      </figcaption>
    </figure>
  )
})

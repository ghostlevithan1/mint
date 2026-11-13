import { THEMES, type Theme } from './theme'

type PlotResponse = {
  image?: unknown
  error?: { code?: string; message?: string }
}

const cache = new Map<string, string>()

/** Best-effort client-side theme preference so figures match the app. */
function withTheme(specText: string): string {
  try {
    const parsed = JSON.parse(specText) as Record<string, unknown>
    if (typeof parsed !== 'object' || parsed === null) return specText
    if (typeof parsed.theme === 'string' && parsed.theme.length > 0) return specText
    const current =
      typeof document !== 'undefined'
        ? (document.documentElement.dataset.theme as Theme | undefined)
        : undefined
    const mode = THEMES.find((theme) => theme.id === current)?.mode ?? 'dark'
    return JSON.stringify({ ...parsed, theme: mode })
  } catch {
    return specText
  }
}

/** Renders a plot spec through /api/plot. Memoized for the session. */
export async function fetchPlotImage(spec: string): Promise<string> {
  const key = spec.trim()
  const cached = cache.get(key)
  if (cached) return cached

  const response = await fetch('/api/plot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec: withTheme(key) }),
  })
  const data = (await response.json().catch(() => null)) as PlotResponse | null
  if (!response.ok) {
    const message = data?.error?.message ?? 'The plot could not be rendered.'
    throw new Error(message)
  }
  if (!data || typeof data.image !== 'string') {
    throw new Error('The plot renderer returned an unreadable image.')
  }
  cache.set(key, data.image)
  return data.image
}

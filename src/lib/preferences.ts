import { PLOT_DETAIL_DEFAULT, clampPlotDetail } from './plotSpec'

function readFlag(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback
  try {
    const value = localStorage.getItem(key)
    if (value === 'off') return false
    if (value === 'on') return true
  } catch {
    // ignore
  }
  return fallback
}

function saveFlag(key: string, enabled: boolean): void {
  try {
    localStorage.setItem(key, enabled ? 'on' : 'off')
  } catch {
    // ignore
  }
}

const JPEG_CONVERSION_KEY = 'mint.images.convertToJpeg'

/** JPEG conversion is on by default so attachment formats stay predictable. */
export function getStoredJpegConversion(): boolean {
  return readFlag(JPEG_CONVERSION_KEY, true)
}

export function saveJpegConversion(enabled: boolean): void {
  saveFlag(JPEG_CONVERSION_KEY, enabled)
}

const SHIELD_KEY = 'mint.shield'

/** The PII shield is on unless the user turned it off. */
export function getStoredShield(): boolean {
  return readFlag(SHIELD_KEY, true)
}

export function saveShield(enabled: boolean): void {
  saveFlag(SHIELD_KEY, enabled)
}

const METRICS_KEY = 'mint.metrics'

export function getStoredMetrics(): boolean {
  return readFlag(METRICS_KEY, false)
}

export function saveMetrics(enabled: boolean): void {
  saveFlag(METRICS_KEY, enabled)
}

const MODEL_KEY = 'mint.defaultModel'

export function getStoredModelId(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(MODEL_KEY)
  } catch {
    return null
  }
}

export function saveModelId(id: string): void {
  try {
    localStorage.setItem(MODEL_KEY, id)
  } catch {
    // ignore
  }
}

const PROFILE_KEY = 'mint.profile'
export const PROFILE_MAX_CHARS = 1000

/** What the student told Mint about themselves; sent as context with each question. */
export function getStoredProfile(): string {
  if (typeof localStorage === 'undefined') return ''
  try {
    return (localStorage.getItem(PROFILE_KEY) ?? '').slice(0, PROFILE_MAX_CHARS)
  } catch {
    return ''
  }
}

export function saveProfile(text: string): void {
  try {
    localStorage.setItem(PROFILE_KEY, text.slice(0, PROFILE_MAX_CHARS))
  } catch {
    // ignore
  }
}

const THINKING_KEY = 'mint.showThinking'
let showThinking: boolean | null = null
const thinkingListeners = new Set<() => void>()

/** Whether the model's reasoning ("thinking") is shown with its answers. On unless turned off. */
export function getShowThinking(): boolean {
  if (showThinking === null) showThinking = readFlag(THINKING_KEY, true)
  return showThinking
}

/** Saves the setting and updates every message on screen. */
export function setShowThinking(enabled: boolean): void {
  if (enabled === getShowThinking()) return
  showThinking = enabled
  saveFlag(THINKING_KEY, enabled)
  for (const listener of thinkingListeners) listener()
}

export function subscribeShowThinking(listener: () => void): () => void {
  thinkingListeners.add(listener)
  return () => {
    thinkingListeners.delete(listener)
  }
}

const PLOT_DETAIL_KEY = 'mint.plotDetail'
let plotDetail: number | null = null
const plotDetailListeners = new Set<() => void>()

/** Points calculated along each equation curve (see PLOT_DETAIL_MIN/MAX). */
export function getPlotDetail(): number {
  if (plotDetail !== null) return plotDetail
  let stored: string | null = null
  try {
    stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(PLOT_DETAIL_KEY)
  } catch {
    // ignore
  }
  plotDetail = stored === null ? PLOT_DETAIL_DEFAULT : clampPlotDetail(stored)
  return plotDetail
}

/** Saves the setting and redraws every open graph. */
export function setPlotDetail(value: number): void {
  const next = clampPlotDetail(value)
  if (next === plotDetail) return
  plotDetail = next
  try {
    localStorage.setItem(PLOT_DETAIL_KEY, String(next))
  } catch {
    // ignore
  }
  for (const listener of plotDetailListeners) listener()
}

export function subscribePlotDetail(listener: () => void): () => void {
  plotDetailListeners.add(listener)
  return () => {
    plotDetailListeners.delete(listener)
  }
}


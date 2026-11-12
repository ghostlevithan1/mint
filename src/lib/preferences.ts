const JPEG_CONVERSION_KEY = 'mint.images.convertToJpeg'
const WEB_SEARCH_KEY = 'mint.webSearch'

/** JPEG conversion is on by default so attachment formats stay predictable. */
export function getStoredJpegConversion(): boolean {
  if (typeof localStorage === 'undefined') return true
  try {
    const value = localStorage.getItem(JPEG_CONVERSION_KEY)
    if (value === 'off') return false
    if (value === 'on') return true
  } catch {
    // ignore
  }
  return true
}

export function saveJpegConversion(enabled: boolean): void {
  try {
    localStorage.setItem(JPEG_CONVERSION_KEY, enabled ? 'on' : 'off')
  } catch {
    // ignore
  }
}

/** Web search is opt-in so idle prompts never spend requests. */
export function getStoredWebSearch(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(WEB_SEARCH_KEY) === 'on'
  } catch {
    return false
  }
}

export function saveWebSearch(enabled: boolean): void {
  try {
    localStorage.setItem(WEB_SEARCH_KEY, enabled ? 'on' : 'off')
  } catch {
    // ignore
  }
}

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

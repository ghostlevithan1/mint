const JPEG_CONVERSION_KEY = 'mint.images.convertToJpeg'

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

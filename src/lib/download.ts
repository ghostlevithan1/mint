/**
 * Starts a browser download for a Blob. The anchor is placed in the document
 * before it is clicked: some browsers ignore a click on a detached `<a download>`
 * element, so the download silently never starts there.
 */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Browsers read the blob while the click is handled; revoke it afterwards.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  javascript: 'js',
  js: 'js',
  jsx: 'jsx',
  python: 'py',
  py: 'py',
  bash: 'sh',
  sh: 'sh',
  shell: 'sh',
  zsh: 'sh',
  json: 'json',
  yaml: 'yml',
  yml: 'yml',
  markdown: 'md',
  md: 'md',
  html: 'html',
  css: 'css',
  scss: 'scss',
  sql: 'sql',
  csv: 'csv',
  txt: 'txt',
  text: 'txt',
  xml: 'xml',
  svg: 'svg',
  java: 'java',
  go: 'go',
  rust: 'rs',
  rs: 'rs',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  cs: 'cs',
  php: 'php',
  ruby: 'rb',
  rb: 'rb',
  kotlin: 'kt',
  swift: 'swift',
  dockerfile: 'dockerfile',
}

const MIME_TYPES: Record<string, string> = {
  json: 'application/json;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  html: 'text/html;charset=utf-8',
  css: 'text/css;charset=utf-8',
  js: 'text/javascript;charset=utf-8',
  svg: 'image/svg+xml',
  xml: 'application/xml;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
}

export const TEXT_FILE_LIMIT = 2000

export type FenceInfo = {
  language: string
  filename: string
  extension: string
}

function isTextExtension(extension: string) {
  return Boolean(MIME_TYPES[extension]) || extension === 'txt' || extension === 'py' || extension === 'ts'
}

/** Reads a fenced code block's info string, e.g. ```ts title="app.ts" */
export function describeFence(info: string, index: number): FenceInfo {
  const named = /(?:title|filename|file)\s*=\s*"([^"]+)"/i.exec(info)
  const filenameMatch = named?.[1] ?? ''
  const rest = info.replace(/(?:title|filename|file)\s*=\s*"[^"]*"/gi, '').trim()
  const tokens = rest.split(/\s+/).filter(Boolean)

  let language = ''
  let filename = filenameMatch
  for (const token of tokens) {
    const clean = token.replace(/^[`"']+|[`"']+$/g, '')
    if (!clean) continue
    if (!filename && /\.[a-z0-9]{1,8}$/i.test(clean)) {
      filename = clean
      continue
    }
    if (!language && LANGUAGE_EXTENSIONS[clean.toLowerCase()]) {
      language = clean.toLowerCase()
    }
  }

  const explicitExtension = /\.([a-z0-9]{1,8})$/i.exec(filename)?.[1]?.toLowerCase() ?? ''
  const extension = explicitExtension || LANGUAGE_EXTENSIONS[language] || 'txt'
  const safeName = filename.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 80)
  const fallback = `mint-snippet-${index + 1}.${extension}`

  return {
    language: language || extension,
    filename: safeName || fallback,
    extension,
  }
}

export function mimeForFile(extension: string): string {
  return MIME_TYPES[extension.toLowerCase()] ?? 'text/plain;charset=utf-8'
}

export function isTextFile(extension: string): boolean {
  return isTextExtension(extension.toLowerCase())
}

export function downloadTextFile(filename: string, text: string, extension: string) {
  const blob = new Blob([text], { type: mimeForFile(extension) })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // Give the browser a moment to start the download before the blob URL dies.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

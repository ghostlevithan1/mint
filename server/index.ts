import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { brotliCompress, constants, gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { handleChatHttp, handleStatusHttp, sendJson } from './node-http'
import { handleSearchHttp, handleWebHttp } from './web'

const compressBrotli = promisify(brotliCompress)
const compressGzip = promisify(gzip)

const COMPRESSIBLE_EXTENSIONS = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.txt',
  '.map',
])
const COMPRESS_MIN_BYTES = 1024

// Compressed copies are kept in memory so each asset is only compressed once
// per deploy. The whole dist folder is only a few megabytes.
const compressedCache = new Map<string, { stamp: string; body: Buffer }>()

async function compressedBody(
  filePath: string,
  stamp: string,
  encoding: 'br' | 'gzip',
  data: Buffer,
): Promise<Buffer> {
  const key = `${filePath}\0${encoding}`
  const cached = compressedCache.get(key)
  if (cached?.stamp === stamp) return cached.body

  const body =
    encoding === 'br'
      ? await compressBrotli(data, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
        })
      : await compressGzip(data, { level: 6 })

  compressedCache.set(key, { stamp, body })
  if (compressedCache.size > 96) {
    const oldest = compressedCache.keys().next().value
    if (oldest) compressedCache.delete(oldest)
  }
  return body
}

const root = process.cwd()
const distDir = resolve(root, 'dist')
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
}

function sendText(res: ServerResponse, status: number, body: string) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(body)
}

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    sendText(res, 405, 'Method not allowed')
    return
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  let pathname = ''
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    sendText(res, 400, 'Bad request')
    return
  }

  if (pathname.includes('\0')) {
    sendText(res, 400, 'Bad request')
    return
  }

  const requestedPath = pathname === '/' ? '/index.html' : pathname
  const candidate = resolve(distDir, `.${requestedPath}`)
  if (candidate !== distDir && !candidate.startsWith(distDir + sep)) {
    sendText(res, 403, 'Forbidden')
    return
  }

  let filePath = candidate
  let info = await stat(filePath).catch(() => null)

  // Single-page app fallback: extensionless routes return index.html.
  if (!info?.isFile()) {
    if (extname(pathname)) {
      sendText(res, 404, 'Not found')
      return
    }
    filePath = resolve(distDir, 'index.html')
    info = await stat(filePath).catch(() => null)
    if (!info?.isFile()) {
      sendText(res, 500, 'Build not found. Run npm run build first.')
      return
    }
  }

  const data = await readFile(filePath)
  const extension = extname(filePath).toLowerCase()
  const isHashedAsset = filePath.includes(`${sep}assets${sep}`)
  const accepts = String(req.headers['accept-encoding'] ?? '')
  const encoding: 'br' | 'gzip' | '' = accepts.includes('br')
    ? 'br'
    : accepts.includes('gzip')
      ? 'gzip'
      : ''

  let payload = data
  const compressible = COMPRESSIBLE_EXTENSIONS.has(extension)
  if (compressible) {
    // Caches must not serve an encoded copy to a client that asked for plain
    // bytes (or the reverse), even when this response is sent uncompressed.
    res.setHeader('Vary', 'Accept-Encoding')
  }
  if (
    encoding &&
    compressible &&
    data.byteLength >= COMPRESS_MIN_BYTES
  ) {
    payload = await compressedBody(
      filePath,
      `${info?.mtimeMs ?? 0}:${info?.size ?? data.byteLength}`,
      encoding,
      data,
    )
    res.setHeader('Content-Encoding', encoding)
  }

  res.statusCode = 200
  res.setHeader('Content-Type', MIME_TYPES[extension] ?? 'application/octet-stream')
  res.setHeader('Content-Length', payload.byteLength)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader(
    'Cache-Control',
    isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  )

  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(payload)
}

const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

  if (pathname === '/healthz') {
    sendText(res, 200, 'ok')
    return
  }

  if (pathname === '/api/status') {
    handleStatusHttp(req, res, root)
    return
  }

  if (pathname === '/api/web') {
    void handleWebHttp(req, res)
    return
  }

  if (pathname === '/api/search') {
    void handleSearchHttp(req, res)
    return
  }

  if (pathname === '/api/chat') {
    void handleChatHttp(req, res, root)
    return
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, {
      error: { code: 'NOT_FOUND', message: 'Unknown API endpoint.' },
    })
    return
  }

  void serveStatic(req, res).catch(() => {
    if (res.headersSent) {
      if (!res.writableEnded) res.end()
      return
    }
    sendText(res, 500, 'Internal server error')
  })
})

server.listen(port, host, () => {
  console.log(`Mint listening on http://${host}:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}

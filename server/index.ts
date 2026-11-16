import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, relative, resolve, sep } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { handleChatHttp, handleCspReportHttp, handleStatusHttp, sendJson } from './node-http'
import { identifyDevice } from './device'
import { guardApi } from './limits'
import { trackPathTamper } from './tamper'
import { handleSearchHttp, handleWebHttp } from './web'

const COMPRESSIBLE_EXTENSIONS = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.txt',
  '.map',
  '.ttf',
])
const COMPRESS_MIN_BYTES = 1024

const root = process.cwd()
const distDir = resolve(root, 'dist')
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

/** One built file, held in memory with its compressed copies. */
type Asset = {
  body: Buffer
  br: Buffer | null
  gzip: Buffer | null
  type: string
  etag: string
  immutable: boolean
  compressible: boolean
}

/**
 * The whole built app (a few megabytes), keyed by URL path. It is read once at
 * startup, so a page load costs no disk reads, and the compressed copies made
 * by `npm run build` (scripts/precompress.mjs) are served as they are, so the
 * small Render instance never spends CPU compressing. Only listed paths can be
 * served, which also rules out path traversal.
 */
const assets = new Map<string, Asset>()

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name)
      return entry.isDirectory() ? listFiles(path) : Promise.resolve(entry.isFile() ? [path] : [])
    }),
  )
  return nested.flat()
}

async function loadAssets(): Promise<void> {
  const files = await listFiles(distDir)
  const present = new Set(files)
  await Promise.all(
    files
      .filter((file) => !file.endsWith('.br') && !file.endsWith('.gz'))
      .map(async (file) => {
        const body = await readFile(file)
        const extension = extname(file).toLowerCase()
        const compressible = COMPRESSIBLE_EXTENSIONS.has(extension) && body.byteLength >= COMPRESS_MIN_BYTES
        const sibling = (suffix: string) => (present.has(file + suffix) ? readFile(file + suffix) : null)
        const [br, gzip] = compressible ? await Promise.all([sibling('.br'), sibling('.gz')]) : [null, null]
        const urlPath = `/${relative(distDir, file).split(sep).join('/')}`
        assets.set(urlPath, {
          body,
          br,
          gzip,
          type: MIME_TYPES[extension] ?? 'application/octet-stream',
          etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 22)}"`,
          immutable: urlPath.startsWith('/assets/'),
          compressible,
        })
      }),
  )
}

/** Fallback for a build made without the precompress step: compress once, then keep it. */
function encodedBody(asset: Asset, encoding: 'br' | 'gzip'): Buffer {
  if (encoding === 'br') {
    asset.br ??= brotliCompressSync(asset.body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
    return asset.br
  }
  asset.gzip ??= gzipSync(asset.body, { level: 6 })
  return asset.gzip
}

// Locked down because the app handles private text. Everything it needs is
// same-origin: bundled fonts, Vite JS/CSS, and data: URLs for local previews.
// img-src allows any https: image so image links pasted into a chat render
// inline; remote hosts see the viewer's IP but nothing else (no cookies, no
// referrer — see RemoteImage / referrerPolicy="no-referrer").
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  // Blocked scripts are reported here; see tamper.ts for how repeats are treated.
  'report-uri /api/csp-report',
].join('; ')

function setSecurityHeaders(res: ServerResponse) {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
}

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

  // The page itself carries the device cookie; hashed assets stay cookie-free so
  // shared caches can keep serving them.
  if (!pathname.startsWith('/assets/')) identifyDevice(req, res)

  let asset = assets.get(pathname === '/' ? '/index.html' : pathname)
  if (!asset) {
    // Single-page app fallback: extensionless routes return index.html.
    if (extname(pathname)) {
      sendText(res, 404, 'Not found')
      return
    }
    asset = assets.get('/index.html')
    if (!asset) {
      sendText(res, 500, 'Build not found. Run npm run build first.')
      return
    }
  }

  res.setHeader('Content-Type', asset.type)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Cache-Control', asset.immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
  res.setHeader('ETag', asset.etag)
  // Caches must not serve an encoded copy to a client that asked for plain
  // bytes (or the reverse), even when this response is sent uncompressed.
  if (asset.compressible) res.setHeader('Vary', 'Accept-Encoding')

  // A returning visitor revalidates the page (no-cache) and gets a bodyless 304
  // when nothing changed since their copy.
  const known = String(req.headers['if-none-match'] ?? '')
  if (known && known.split(',').some((tag) => tag.trim().replace(/^W\//, '') === asset.etag)) {
    res.statusCode = 304
    res.end()
    return
  }

  const accepts = String(req.headers['accept-encoding'] ?? '')
  const encoding: 'br' | 'gzip' | '' = !asset.compressible
    ? ''
    : accepts.includes('br')
      ? 'br'
      : accepts.includes('gzip')
        ? 'gzip'
        : ''
  const payload = encoding ? encodedBody(asset, encoding) : asset.body
  if (encoding) res.setHeader('Content-Encoding', encoding)

  res.statusCode = 200
  res.setHeader('Content-Length', payload.byteLength)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(payload)
}

const server = createServer((req, res) => {
  setSecurityHeaders(res)
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

  if (pathname === '/healthz') {
    sendText(res, 200, 'ok')
    return
  }

  // Path probing (browsers never send "..") counts as a strike for the device.
  if (/\.\.|%2e|%00|%5c|\\/i.test(req.url ?? '')) trackPathTamper(req, res)

  if (pathname === '/api/status') {
    handleStatusHttp(req, res, root)
    return
  }

  if (pathname === '/api/csp-report') {
    void handleCspReportHttp(req, res)
    return
  }

  if (pathname === '/api/web') {
    if (!guardApi(req, res, 'web')) return
    void handleWebHttp(req, res)
    return
  }

  if (pathname === '/api/search') {
    if (!guardApi(req, res, 'web')) return
    void handleSearchHttp(req, res)
    return
  }

  if (pathname === '/api/chat') {
    if (!guardApi(req, res, 'chat')) return
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

// Render's proxy reuses connections to the app. Node's 5-second idle timeout
// can close one just as the proxy sends on it, which surfaces as a random 502,
// so idle connections are kept a little longer than the proxy keeps them.
server.keepAliveTimeout = 65_000
server.headersTimeout = 66_000

const started = performance.now()
await loadAssets()
server.listen(port, host, () => {
  console.log(
    `Mint listening on http://${host}:${port} (${assets.size} files in memory, ready in ${Math.round(performance.now() - started)} ms)`,
  )
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // Stop taking new connections, drop idle ones now, and give answers that
    // are still streaming up to 10 seconds to finish.
    server.close(() => process.exit(0))
    server.closeIdleConnections()
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}

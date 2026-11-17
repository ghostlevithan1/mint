import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  HttpError,
  MAX_BODY_BYTES,
  acceptedModelIds,
  createChatResponse,
  getStatusPayload,
  type JsonRecord,
} from './core'
import { clock } from './clock'
import { identifyDevice } from './device'
import { activeBanUntil, guardApi, sendBanned } from './limits'
import { BAN_THRESHOLD, inspectChatBody, recordCspReport, recordTamper } from './tamper'
import { webReaderStatus } from './web'

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(body))
}

/**
 * Reads a JSON body of at most `limit` bytes. Past the limit it answers at once
 * instead of reading on, and the connection is closed after the reply, so an
 * oversized upload cannot keep a socket busy.
 */
export function readJsonBody(
  req: IncomingMessage,
  res?: ServerResponse,
  limit = MAX_BODY_BYTES,
): Promise<JsonRecord> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false

    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > limit) tooLarge = true

    const refuse = () => {
      req.removeAllListeners('data')
      req.pause()
      if (res) {
        res.setHeader('Connection', 'close')
        res.once('finish', () => req.destroy())
      }
      reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.'))
    }
    if (tooLarge) {
      refuse()
      return
    }

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        tooLarge = true
        chunks.length = 0
        refuse()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (tooLarge) return
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        const parsed = raw ? (JSON.parse(raw) as unknown) : {}
        resolveBody(parsed && typeof parsed === 'object' ? (parsed as JsonRecord) : {})
      } catch {
        reject(new HttpError(400, 'BAD_JSON', 'Request body must be valid JSON.'))
      }
    })

    req.on('error', () => {
      reject(new HttpError(400, 'REQUEST_ERROR', 'Could not read the request body.'))
    })
  })
}

async function writeChunk(res: ServerResponse, chunk: Uint8Array) {
  if (res.writableEnded) return false
  if (res.write(Buffer.from(chunk))) return true

  return new Promise<boolean>((resolveWrite) => {
    const cleanup = () => {
      res.off('drain', onDrain)
      res.off('close', onClose)
    }
    const onDrain = () => {
      cleanup()
      resolveWrite(true)
    }
    const onClose = () => {
      cleanup()
      resolveWrite(false)
    }
    res.on('drain', onDrain)
    res.on('close', onClose)
  })
}

export async function pipeWebResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status
  response.headers.forEach((value, name) => {
    res.setHeader(name, value)
  })

  if (!response.body) {
    if (!res.writableEnded) res.end()
    return
  }

  res.flushHeaders()
  const reader = response.body.getReader()
  let clientGone = false
  const onClose = () => {
    clientGone = true
  }
  res.on('close', onClose)

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (clientGone) {
        await reader.cancel().catch(() => undefined)
        break
      }
      if (!(await writeChunk(res, value))) {
        await reader.cancel().catch(() => undefined)
        break
      }
    }
  } catch {
    // The client disconnected or the upstream stream was aborted.
  } finally {
    res.off('close', onClose)
    if (!res.writableEnded) res.end()
  }
}

export function handleStatusHttp(
  req: IncomingMessage,
  res: ServerResponse,
  root = process.cwd(),
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    sendJson(res, 405, {
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for this endpoint.' },
    })
    return
  }

  // Lets the page show a ban (with its countdown) as soon as it loads.
  const device = identifyDevice(req, res)
  const bannedUntil = activeBanUntil(req, res, device)
  sendJson(res, 200, {
    ...getStatusPayload(root),
    webReaders: webReaderStatus(),
    // Both forms: the page counts down from the relative one, so a wrong clock cannot skew it.
    device: {
      bannedUntil: bannedUntil || null,
      bannedForMs: bannedUntil ? Math.max(0, bannedUntil - clock.now()) : null,
    },
  })
}

/** A body for a small endpoint, refused past `limit` bytes. */
function readSmallBody(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolveBody) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= limit) chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > limit) return resolveBody(null)
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolveBody(null)
      }
    })
    req.on('error', () => resolveBody(null))
  })
}

/** Browsers post here when the page's Content-Security-Policy blocks something. */
export async function handleCspReportHttp(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for this endpoint.' } })
    return
  }
  if (!guardApi(req, res, 'report')) return
  recordCspReport(req, res, await readSmallBody(req, 8_192))
  res.statusCode = 204
  res.end()
}

export async function handleChatHttp(
  req: IncomingMessage,
  res: ServerResponse,
  root = process.cwd(),
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, {
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for this endpoint.' },
    })
    return
  }

  const controller = new AbortController()
  const abort = () => {
    if (!res.writableEnded) controller.abort()
  }
  req.on('aborted', abort)
  res.on('close', abort)

  try {
    const body = await readJsonBody(req, res)

    // Only the shape of the request is checked, never what was typed. A clear
    // forgery from a known device bans it; one below the threshold is let
    // through (a stale tab can send a retired model id).
    const tamper = inspectChatBody(body, acceptedModelIds(root))
    if (tamper.weight) {
      const ban = recordTamper(req, res, tamper)
      if (ban) {
        sendBanned(res, ban.expiresAt)
        return
      }
      if (tamper.weight >= BAN_THRESHOLD) {
        throw new HttpError(403, 'REQUEST_REJECTED', 'That request was not valid and was not sent.')
      }
    }

    const response = await createChatResponse(body, { root, signal: controller.signal })
    await pipeWebResponse(res, response)
  } catch (error) {
    if (res.headersSent) {
      if (!res.writableEnded) res.end()
      return
    }

    if (error instanceof HttpError) {
      sendJson(res, error.status, {
        error: { code: error.code, message: error.message },
      })
      return
    }

    sendJson(res, 500, {
      error: { code: 'REQUEST_ERROR', message: 'Could not handle the request.' },
    })
  } finally {
    req.off('aborted', abort)
    res.off('close', abort)
  }
}

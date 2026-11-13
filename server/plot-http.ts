import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpError } from './core'
import { readJsonBody, sendJson } from './node-http'
import { renderPlot } from './plot'

const MAX_SPEC_CHARS = 32 * 1024

const STATUS_BY_CODE: Record<string, number> = {
  BAD_SPEC: 400,
  SPEC_REJECTED: 400,
  SPEC_TOO_LARGE: 413,
  PYTHON_UNAVAILABLE: 503,
  RENDER_TIMEOUT: 504,
  RENDER_TOO_LARGE: 500,
  RENDER_FAILED: 500,
}

export async function handlePlotHttp(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, {
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for this endpoint.' },
    })
    return
  }

  try {
    const body = await readJsonBody(req)
    const spec = typeof body.spec === 'string' ? body.spec : ''
    if (!spec.trim() || spec.length > MAX_SPEC_CHARS) {
      throw new HttpError(400, 'BAD_SPEC', 'Send a plot spec of at most 32 KB.')
    }
    const result = await renderPlot(spec)
    if ('image' in result) {
      sendJson(res, 200, { image: result.image })
      return
    }
    const status = STATUS_BY_CODE[result.code] ?? 500
    sendJson(res, status, {
      error: { code: result.code, message: result.error },
    })
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, {
        error: { code: error.code, message: error.message },
      })
      return
    }
    sendJson(res, 500, {
      error: { code: 'PLOT_ERROR', message: 'The plot could not be rendered.' },
    })
  }
}

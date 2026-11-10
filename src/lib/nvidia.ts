export type StreamUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

type StreamMessage = {
  role: 'user' | 'assistant'
  content: string
}

type StreamRequest = {
  model: string
  messages: StreamMessage[]
  temperature?: number
  max_tokens?: number
}

type StreamHandlers = {
  signal: AbortSignal
  onDelta: (delta: string) => void
  onUsage?: (usage: StreamUsage) => void
}

type StreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
    }
    finish_reason?: string | null
  }>
  usage?: StreamUsage
}

export class ChatApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'ChatApiError'
    this.code = code
    this.status = status
  }
}

/**
 * Streams an NVIDIA NIM response through the local server proxy. The browser
 * never sees the API key: it only talks to /api/chat on the same origin.
 */
export async function streamNvidiaChat(request: StreamRequest, handlers: StreamHandlers) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal: handlers.signal,
  })

  if (!response.ok) {
    let code = 'HTTP_ERROR'
    let message = `Inference request failed (${response.status}).`
    try {
      const data = (await response.json()) as {
        error?: { code?: string; message?: string }
      }
      if (data.error?.code) code = data.error.code
      if (data.error?.message) message = data.error.message
    } catch {
      // A static host or proxy may return HTML instead of JSON.
    }
    throw new ChatApiError(message, code, response.status)
  }

  if (!response.body) {
    throw new ChatApiError('The inference response had no body.', 'EMPTY_BODY', 502)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let done = false

  const handleData = (data: string) => {
    if (!data) return false
    if (data === '[DONE]') return true
    try {
      const parsed = JSON.parse(data) as StreamChunk
      const delta = parsed.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta) handlers.onDelta(delta)
      if (parsed.usage) handlers.onUsage?.(parsed.usage)
    } catch {
      // Ignore keep-alive or malformed provider frames.
    }
    return false
  }

  try {
    while (!done) {
      const { value, done: streamDone } = await reader.read()
      if (streamDone) break

      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')

        if (!line || line.startsWith(':') || !line.startsWith('data:')) continue
        if (handleData(line.slice(5).trim())) {
          done = true
          break
        }
      }
    }

    const tail = buffer.trim()
    if (!done && tail.startsWith('data:')) {
      handleData(tail.slice(5).trim())
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

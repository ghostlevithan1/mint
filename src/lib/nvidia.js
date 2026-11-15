export class ChatApiError extends Error {
    code;
    status;
    constructor(message, code, status) {
        super(message);
        this.name = 'ChatApiError';
        this.code = code;
        this.status = status;
    }
}
/**
 * Streams a chat completion through the local server proxy, which routes to
 * NVIDIA NIM or OpenRouter. The browser never sees an API key: it only talks
 * to /api/chat on the same origin.
 */
export async function streamNvidiaChat(request, handlers) {
    const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: handlers.signal,
    });
    if (!response.ok) {
        let code = 'HTTP_ERROR';
        let message = `Inference request failed (${response.status}).`;
        try {
            const data = (await response.json());
            if (data.error?.code)
                code = data.error.code;
            if (data.error?.message)
                message = data.error.message;
        }
        catch {
            // A static host or proxy may return HTML instead of JSON.
        }
        throw new ChatApiError(message, code, response.status);
    }
    if (!response.body) {
        throw new ChatApiError('The inference response had no body.', 'EMPTY_BODY', 502);
    }
    const usedModel = response.headers.get('x-mint-model') ?? undefined;
    const fallbackFrom = response.headers.get('x-mint-fallback') ?? undefined;
    if (usedModel || fallbackFrom) {
        handlers.onModel?.({ model: usedModel, fallbackFrom });
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    let streamError = null;
    const handleData = (data) => {
        if (!data)
            return false;
        if (data === '[DONE]')
            return true;
        try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
                streamError = new ChatApiError(parsed.error.message || 'The model stopped with an error. Try again or switch models.', 'STREAM_ERROR', 502);
                return true;
            }
            const choice = parsed.choices?.[0];
            const delta = choice?.delta;
            const reasoning = delta?.reasoning_content || delta?.reasoning;
            if (typeof reasoning === 'string' && reasoning) {
                handlers.onReasoning?.(reasoning);
            }
            if (typeof delta?.content === 'string' && delta.content)
                handlers.onDelta(delta.content);
            if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
                handlers.onFinish?.(choice.finish_reason);
            }
            if (parsed.usage)
                handlers.onUsage?.(parsed.usage);
        }
        catch {
            // Ignore keep-alive or malformed provider frames.
        }
        return false;
    };
    try {
        while (!done) {
            const { value, done: streamDone } = await reader.read();
            if (streamDone)
                break;
            buffer += decoder.decode(value, { stream: true });
            let newline = buffer.indexOf('\n');
            while (newline >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf('\n');
                if (!line || line.startsWith(':') || !line.startsWith('data:'))
                    continue;
                if (handleData(line.slice(5).trim())) {
                    done = true;
                    break;
                }
            }
        }
        const tail = buffer.trim();
        if (!done && tail.startsWith('data:')) {
            handleData(tail.slice(5).trim());
        }
    }
    finally {
        await reader.cancel().catch(() => undefined);
    }
    if (streamError)
        throw streamError;
}

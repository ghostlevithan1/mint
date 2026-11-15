import { HttpError, MAX_BODY_BYTES, createChatResponse, getStatusPayload, } from './core';
import { webReaderStatus } from './web';
export function sendJson(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(JSON.stringify(body));
}
export function readJsonBody(req) {
    return new Promise((resolveBody, reject) => {
        const chunks = [];
        let size = 0;
        let tooLarge = false;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                tooLarge = true;
                chunks.length = 0;
                return;
            }
            if (!tooLarge)
                chunks.push(chunk);
        });
        req.on('end', () => {
            if (tooLarge) {
                reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.'));
                return;
            }
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                const parsed = raw ? JSON.parse(raw) : {};
                resolveBody(parsed && typeof parsed === 'object' ? parsed : {});
            }
            catch {
                reject(new HttpError(400, 'BAD_JSON', 'Request body must be valid JSON.'));
            }
        });
        req.on('error', () => {
            reject(new HttpError(400, 'REQUEST_ERROR', 'Could not read the request body.'));
        });
    });
}
async function writeChunk(res, chunk) {
    if (res.writableEnded)
        return false;
    if (res.write(Buffer.from(chunk)))
        return true;
    return new Promise((resolveWrite) => {
        const cleanup = () => {
            res.off('drain', onDrain);
            res.off('close', onClose);
        };
        const onDrain = () => {
            cleanup();
            resolveWrite(true);
        };
        const onClose = () => {
            cleanup();
            resolveWrite(false);
        };
        res.on('drain', onDrain);
        res.on('close', onClose);
    });
}
export async function pipeWebResponse(res, response) {
    res.statusCode = response.status;
    response.headers.forEach((value, name) => {
        res.setHeader(name, value);
    });
    if (!response.body) {
        if (!res.writableEnded)
            res.end();
        return;
    }
    res.flushHeaders();
    const reader = response.body.getReader();
    let clientGone = false;
    const onClose = () => {
        clientGone = true;
    };
    res.on('close', onClose);
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (clientGone) {
                await reader.cancel().catch(() => undefined);
                break;
            }
            if (!(await writeChunk(res, value))) {
                await reader.cancel().catch(() => undefined);
                break;
            }
        }
    }
    catch {
        // The client disconnected or the upstream stream was aborted.
    }
    finally {
        res.off('close', onClose);
        if (!res.writableEnded)
            res.end();
    }
}
export function handleStatusHttp(req, res, root = process.cwd()) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, {
            error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for this endpoint.' },
        });
        return;
    }
    sendJson(res, 200, { ...getStatusPayload(root), webReaders: webReaderStatus() });
}
export async function handleChatHttp(req, res, root = process.cwd()) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, {
            error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for this endpoint.' },
        });
        return;
    }
    const controller = new AbortController();
    const abort = () => {
        if (!res.writableEnded)
            controller.abort();
    };
    req.on('aborted', abort);
    res.on('close', abort);
    try {
        const body = await readJsonBody(req);
        const response = await createChatResponse(body, { root, signal: controller.signal });
        await pipeWebResponse(res, response);
    }
    catch (error) {
        if (res.headersSent) {
            if (!res.writableEnded)
                res.end();
            return;
        }
        if (error instanceof HttpError) {
            sendJson(res, error.status, {
                error: { code: error.code, message: error.message },
            });
            return;
        }
        sendJson(res, 500, {
            error: { code: 'REQUEST_ERROR', message: 'Could not handle the request.' },
        });
    }
    finally {
        req.off('aborted', abort);
        res.off('close', abort);
    }
}

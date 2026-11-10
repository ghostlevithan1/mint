import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendJson, readJsonBody } from './node-http'
import * as store from './auth-store'

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export async function handleAuthHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname.replace(/^\/api\/auth\/?/, '')
  const method = req.method ?? 'GET'

  await store.ensureLoaded()

  try {
    // POST /api/auth/signup
    if (path === 'signup' && method === 'POST') {
      const body = await readJsonBody(req)
      const user = await store.createEmailUser(str(body.email), str(body.password), str(body.displayName) || undefined)
      const token = await store.createEmailVerificationToken(user.id)
      sendJson(res, 200, { user, token })
      return
    }

    // POST /api/auth/login
    if (path === 'login' && method === 'POST') {
      const body = await readJsonBody(req)
      const user = await store.authenticateUser(str(body.email), str(body.password))
      sendJson(res, 200, { user })
      return
    }

    // POST /api/auth/google
    if (path === 'google' && method === 'POST') {
      const body = await readJsonBody(req)
      const user = await store.signInWithGoogleAsync({
        id: str(body.id),
        email: str(body.email),
        displayName: str(body.displayName) || undefined,
        pictureUrl: str(body.pictureUrl) || undefined,
      })
      sendJson(res, 200, { user })
      return
    }

    // POST /api/auth/verify-email
    if (path === 'verify-email' && method === 'POST') {
      const body = await readJsonBody(req)
      const ok = await store.verifyEmail(str(body.token))
      sendJson(res, 200, { ok })
      return
    }

    // POST /api/auth/create-verify-token
    if (path === 'create-verify-token' && method === 'POST') {
      const body = await readJsonBody(req)
      const token = await store.createEmailVerificationToken(str(body.userId))
      sendJson(res, 200, { token })
      return
    }

    // POST /api/auth/forgot
    if (path === 'forgot' && method === 'POST') {
      const body = await readJsonBody(req)
      const user = await store.getUserByEmail(str(body.email))
      if (!user) {
        sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'No account found with this email' } })
        return
      }
      const token = await store.createPasswordResetToken(user.id)
      sendJson(res, 200, { token, userId: user.id })
      return
    }

    // POST /api/auth/reset
    if (path === 'reset' && method === 'POST') {
      const body = await readJsonBody(req)
      const user = await store.verifyPasswordResetToken(str(body.token))
      if (!user) {
        sendJson(res, 400, { error: { code: 'INVALID', message: 'login failed' } })
        return
      }
      sendJson(res, 200, { user })
      return
    }

    // POST /api/auth/access-id
    if (path === 'access-id' && method === 'POST') {
      const body = await readJsonBody(req)
      try {
        const user = await store.authenticateByAccessId(str(body.accountId))
        sendJson(res, 200, { user })
      } catch {
        sendJson(res, 400, { error: { code: 'INVALID', message: 'login failed' } })
      }
      return
    }

    // POST /api/auth/link
    if (path === 'link' && method === 'POST') {
      const body = await readJsonBody(req)
      const user = await store.linkEmailToGoogle(str(body.userId), str(body.password))
      sendJson(res, 200, { user })
      return
    }

    // GET /api/auth/me?userId=...
    if (path === 'me' && method === 'GET') {
      const userId = url.searchParams.get('userId') ?? ''
      const user = await store.getUserById(userId)
      if (!user) {
        sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'User not found' } })
        return
      }
      sendJson(res, 200, { user })
      return
    }

    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown auth endpoint.' } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Auth error'
    sendJson(res, 400, { error: { code: 'AUTH_ERROR', message: msg } })
  }
}

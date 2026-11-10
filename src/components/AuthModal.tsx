import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, LockKeyhole, X } from 'lucide-react'

export type User = {
  name: string
  email: string
  initials: string
  picture?: string
}

type GoogleTokenResponse = { access_token?: string; error?: string }
type GoogleTokenClient = { requestAccessToken: () => void }
type GoogleApi = {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string
        scope: string
        callback: (response: GoogleTokenResponse) => void
        error_callback?: (error: { message?: string }) => void
      }) => GoogleTokenClient
    }
  }
}

declare global {
  interface Window {
    google?: GoogleApi
  }
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

function loadGoogleSdk(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Google sign-in failed to load.')), {
        once: true,
      })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.googleIdentity = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google sign-in failed to load.'))
    document.head.appendChild(script)
  })
}

type AuthModalProps = {
  open: boolean
  onClose: () => void
  onSignIn: (user: User) => void
}

export function AuthModal({ open, onClose, onSignIn }: AuthModalProps) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const tokenClient = useRef<GoogleTokenClient | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setStatus('idle')
      setMessage('')
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('modal-open')
    popupRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('modal-open')
    }
  }, [open, onClose])

  if (!open) return null

  const handleGoogle = async () => {
    setStatus('connecting')
    setMessage('')

    if (!CLIENT_ID) {
      // Preview builds have no OAuth client connected. This creates an in-memory
      // session only; nothing is persisted and no account request is made.
      await new Promise((resolve) => setTimeout(resolve, 850))
      onSignIn({
        name: 'Alex Morgan',
        email: 'alex.morgan@example.com',
        initials: 'AM',
      })
      onClose()
      return
    }

    try {
      await loadGoogleSdk()
      if (!window.google?.accounts?.oauth2) throw new Error('Google sign-in is unavailable.')
      if (!tokenClient.current) {
        tokenClient.current = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: 'openid email profile',
          callback: async (response) => {
            if (!response.access_token) {
              setStatus('error')
              setMessage('Google did not return an access token. Please try again.')
              return
            }
            try {
              const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${response.access_token}` },
              })
              if (!profileResponse.ok) throw new Error('Could not read your Google profile.')
              const profile = (await profileResponse.json()) as {
                name?: string
                email?: string
                picture?: string
              }
              const name = profile.name || profile.email?.split('@')[0] || 'Member'
              onSignIn({
                name,
                email: profile.email || '',
                initials: name
                  .split(/\s+/)
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase(),
                picture: profile.picture,
              })
              onClose()
            } catch (error) {
              setStatus('error')
              setMessage(error instanceof Error ? error.message : 'Sign-in failed.')
            }
          },
          error_callback: (error) => {
            setStatus('error')
            setMessage(error.message || 'Google sign-in was cancelled.')
          },
        })
      }
      tokenClient.current.requestAccessToken()
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Google sign-in failed.')
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        tabIndex={-1}
        ref={popupRef}
      >
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close sign-in">
          <X size={18} />
        </button>

        <div className="auth-logo-lockup">
          <div className="auth-mint-mark">
            <svg viewBox="0 0 30 30" aria-hidden="true">
              <path d="M4 26V7h5.1L15 17.6 20.9 7H26v19h-5V16.1L15 26l-6-9.9V26H4Z" fill="currentColor" />
            </svg>
          </div>
          <div className="auth-connector">
            <span />
            <LockKeyhole size={13} />
            <span />
          </div>
          <div className="auth-google-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
            </svg>
          </div>
        </div>

        <p className="eyebrow centered">IDENTITY LAYER / GOOGLE</p>
        <h2 id="auth-title">Sign in. Nothing else.</h2>
        <p className="auth-copy">
          Google handles authentication. Mint never sees your password, and your profile stays in
          session memory on this device.
        </p>

        <button className="google-button" onClick={handleGoogle} disabled={status === 'connecting'}>
          {status === 'connecting' ? (
            <Loader2 size={19} className="spin" />
          ) : (
            <span className="google-g" aria-hidden="true">
              <svg viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
                <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
              </svg>
            </span>
          )}
          {status === 'connecting' ? 'Opening Google…' : 'Continue with Google'}
        </button>

        {!CLIENT_ID && (
          <p className="auth-note">
            <Check size={12} /> Preview mode — this creates a local demo identity. Add{' '}
            <code>VITE_GOOGLE_CLIENT_ID</code> for live Google OAuth.
          </p>
        )}
        {status === 'error' && <p className="auth-error">{message}</p>}

        <div className="auth-trust">
          <span>
            <LockKeyhole size={13} /> TLS 1.3
          </span>
          <span>OAuth 2.0</span>
          <span>No password stored</span>
        </div>
        <p className="auth-legal">
          By continuing, you agree to the Terms and Privacy Notice. Mint does not sell or use
          account data for advertising.
        </p>
      </div>
    </div>
  )
}

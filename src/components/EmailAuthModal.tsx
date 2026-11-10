import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Mail, LockKeyhole, UserRound, X, Eye, EyeOff } from 'lucide-react'
import { type User } from '../lib/auth'
import {
  createEmailUser,
  authenticateUser,
  createEmailVerificationToken,
  verifyEmail,
  linkEmailToGoogle,
  validateEmail,
  createPasswordResetToken,
  verifyPasswordResetToken,
  getUserByEmail,
} from '../lib/auth'

type AuthMode = 'login' | 'signup' | 'verify' | 'link' | 'forgot' | 'reset'

interface EmailAuthModalProps {
  open: boolean
  onClose: () => void
  onSignIn: (user: User) => void
  initialMode?: 'login' | 'signup' | 'link'
  googleUser?: User | null
  onUseGoogle?: () => void
}

export function EmailAuthModal({ open, onClose, onSignIn, initialMode, googleUser, onUseGoogle }: EmailAuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode ?? (googleUser ? 'link' : 'login'))
  const [email, setEmail] = useState(googleUser?.email ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [resetDevCode, setResetDevCode] = useState<string | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      const startMode: AuthMode = initialMode ?? (googleUser ? 'link' : 'login')
      setMode(startMode)
      setEmail(googleUser?.email ?? '')
      setPassword('')
      setConfirmPassword('')
      setDisplayName('')
      setCode('')
      setStatus('idle')
      setMessage('')
      setShowPassword(false)
      setDevCode(null)
      setResetDevCode(null)
    }
  }, [open, initialMode, googleUser])

  useEffect(() => {
    if (open) emailRef.current?.focus()
  }, [open, mode])

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setStatus('loading')
    setMessage('')

    try {
      if (mode === 'login') {
        const user = await authenticateUser(email, password)
        setStatus('idle')
        onSignIn(user)
        onClose()
      } else if (mode === 'signup') {
        if (!validateEmail(email)) throw new Error('Please enter a valid email')
        if (password.length < 8) throw new Error('Password must be at least 8 characters')
        if (password !== confirmPassword) throw new Error('Passwords do not match')

        const user = await createEmailUser(email, password, displayName || email.split('@')[0])
        const token = createEmailVerificationToken(user.id)
        setDevCode(token)
        setMode('verify')
        setStatus('idle')
        setMessage('Account created. Enter the verification code to activate it.')
      } else if (mode === 'verify') {
        const ok = verifyEmail(code.trim())
        if (!ok) throw new Error('Invalid or expired verification code')
        setMessage('Email verified! You can now sign in.')
        setTimeout(() => {
          setMode('login')
          setCode('')
          setMessage('')
          setDevCode(null)
        }, 1500)
        setStatus('idle')
      } else if (mode === 'link') {
        if (!googleUser) throw new Error('No Google account to link')
        if (password.length < 8) throw new Error('Password must be at least 8 characters')
        if (password !== confirmPassword) throw new Error('Passwords do not match')
        const user = await linkEmailToGoogle(googleUser.id, password)
        setStatus('idle')
        onSignIn(user)
        onClose()
      } else if (mode === 'forgot') {
        if (!validateEmail(email)) throw new Error('Please enter a valid email')
        const user = getUserByEmail(email)
        if (!user) throw new Error('No account found with this email')
        const token = createPasswordResetToken(user.id)
        setResetDevCode(token)
        setMode('reset')
        setStatus('idle')
        setMessage('A reset code has been sent. Enter it below to sign in.')
      } else if (mode === 'reset') {
        // Run the check and a 1s timer concurrently; wait for both.
        const checkPromise = Promise.resolve().then(() => verifyPasswordResetToken(code.trim()))
        const timerPromise = sleep(1000)
        const [user] = await Promise.all([checkPromise, timerPromise])
        if (!user) throw new Error('login failed')
        setStatus('idle')
        onSignIn(user)
        onClose()
      }
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Something went wrong')
    }
  }

  if (!open) return null

  const title =
    mode === 'login' ? 'Welcome back' :
    mode === 'signup' ? 'Create your account' :
    mode === 'verify' ? 'Verify your email' :
    mode === 'forgot' ? 'Reset password' :
    mode === 'reset' ? 'Enter reset code' :
    'Link email account'

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" tabIndex={-1}>
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <p className="eyebrow centered">EMAIL AUTHENTICATION</p>
        <h2 id="auth-title">{title}</h2>

        {status === 'error' && <p className="auth-error" role="alert">{message}</p>}
        {status === 'idle' && message && <p className="auth-note">{message}</p>}

        <form onSubmit={handleSubmit}>
          {mode === 'forgot' && (
            <div className="form-group">
              <label htmlFor="forgot-email">Email</label>
              <div className="input-wrapper">
                <Mail size={16} className="input-icon" />
                <input
                  id="forgot-email"
                  ref={emailRef}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  disabled={status === 'loading'}
                  required
                />
              </div>
            </div>
          )}

          {mode === 'reset' && (
            <>
              {resetDevCode && (
                <div className="auth-note" style={{ marginBottom: 12 }}>
                  <Check size={12} /> Demo mode — your reset code is <strong>{resetDevCode}</strong>
                </div>
              )}
              <div className="form-group">
                <label htmlFor="reset-code">Reset Code</label>
                <div className="input-wrapper">
                  <Mail size={16} className="input-icon" />
                  <input
                    id="reset-code"
                    ref={emailRef}
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="6-digit code"
                    disabled={status === 'loading'}
                    required
                    maxLength={10}
                  />
                </div>
              </div>
            </>
          )}

          {(mode === 'login' || mode === 'signup') && (
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <div className="input-wrapper">
                <Mail size={16} className="input-icon" />
                <input
                  id="email"
                  ref={emailRef}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  disabled={status === 'loading'}
                  required
                />
              </div>
            </div>
          )}

          {mode === 'link' && (
            <div className="form-group">
              <label htmlFor="link-email">Email</label>
              <div className="input-wrapper">
                <Mail size={16} className="input-icon" />
                <input
                  id="link-email"
                  type="email"
                  value={email}
                  disabled
                  required
                />
              </div>
            </div>
          )}

          {(mode === 'login' || mode === 'signup' || mode === 'link') && (
            <>
              <div className="form-group">
                <label htmlFor="password">Password</label>
                <div className="input-wrapper">
                  <LockKeyhole size={16} className="input-icon" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'link' ? 'Create a password for email sign-in' : 'Enter your password'}
                    disabled={status === 'loading'}
                    required={mode !== 'link'}
                    minLength={8}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {(mode === 'signup' || mode === 'link') && (
                <div className="form-group">
                  <label htmlFor="confirmPassword">Confirm Password</label>
                  <div className="input-wrapper">
                    <LockKeyhole size={16} className="input-icon" />
                    <input
                      id="confirmPassword"
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm your password"
                      disabled={status === 'loading'}
                      required
                      minLength={8}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {mode === 'signup' && (
            <div className="form-group">
              <label htmlFor="displayName">Name (optional)</label>
              <div className="input-wrapper">
                <UserRound size={16} className="input-icon" />
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  disabled={status === 'loading'}
                />
              </div>
            </div>
          )}

          {mode === 'verify' && (
            <>
              {devCode && (
                <div className="auth-note" style={{ marginBottom: 12 }}>
                  <Check size={12} /> Demo mode — your verification code is <strong>{devCode}</strong>
                </div>
              )}
              <div className="form-group">
                <label htmlFor="code">Verification Code</label>
                <div className="input-wrapper">
                  <Mail size={16} className="input-icon" />
                  <input
                    id="code"
                    ref={emailRef}
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="6-digit code"
                    disabled={status === 'loading'}
                    required
                    maxLength={10}
                  />
                </div>
              </div>
            </>
          )}

          <button
            type="submit"
            className="google-button"
            disabled={status === 'loading'}
            style={{ marginTop: 6 }}
          >
            {status === 'loading' ? (
              <Loader2 size={19} className="spin" />
            ) : mode === 'login' ? (
              'Sign In with Email'
            ) : mode === 'signup' ? (
              'Create Account'
            ) : mode === 'verify' ? (
              'Verify Email'
            ) : mode === 'forgot' ? (
              'Send Reset Code'
            ) : mode === 'reset' ? (
              'Verify & Sign In'
            ) : (
              'Link Email Account'
            )}
          </button>
        </form>

        {mode === 'login' && (
          <div style={{ textAlign: 'right', marginTop: 6 }}>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setMode('forgot')
                setMessage('')
                setResetDevCode(null)
                setCode('')
              }}
              style={{ fontSize: 11 }}
            >
              Forgot password?
            </button>
          </div>
        )}

        {(mode === 'login' || mode === 'signup') && (
          <div className="auth-switch">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login')
                setMessage('')
                setDevCode(null)
              }}
            >
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </button>
          </div>
        )}

        {(mode === 'forgot' || mode === 'reset') && (
          <div className="auth-switch">
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setMode('login')
                setMessage('')
                setResetDevCode(null)
                setCode('')
              }}
            >
              Back to sign in
            </button>
          </div>
        )}

        {onUseGoogle && (
          <button
            type="button"
            className="auth-switch link-button"
            onClick={onUseGoogle}
            style={{ marginTop: 8, width: '100%' }}
          >
            Continue with Google instead
          </button>
        )}

        <div className="auth-trust">
          <span>
            <LockKeyhole size={13} /> Secure &amp; encrypted
          </span>
          <span>SHA-256 hashed</span>
          <span>No plaintext password</span>
        </div>
        <p className="auth-legal">
          By continuing, you agree to the Terms and Privacy Notice. Mint does not sell or use account data for advertising.
        </p>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { AuthModal } from './components/AuthModal'
import { EmailAuthModal } from './components/EmailAuthModal'
import { ChatApp } from './components/ChatApp'
import type { User } from './lib/auth'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [googleOpen, setGoogleOpen] = useState(false)
  const [emailAuth, setEmailAuth] = useState<{ open: boolean; mode: 'login' | 'signup' | 'link' }>({
    open: false,
    mode: 'login',
  })

  const openEmailAuth = (mode: 'login' | 'signup' | 'link' = 'login') => {
    setEmailAuth({ open: true, mode })
    setGoogleOpen(false)
  }

  return (
    <div className="app">
      <ChatApp user={user} onSignInRequest={() => setGoogleOpen(true)} onSignOut={() => setUser(null)} onOpenEmailAuth={openEmailAuth} />
      <AuthModal
        open={googleOpen}
        onClose={() => setGoogleOpen(false)}
        onSignIn={setUser}
        onUseEmail={(mode) => openEmailAuth(mode)}
      />
      <EmailAuthModal
        open={emailAuth.open}
        onClose={() => setEmailAuth((state) => ({ ...state, open: false }))}
        onSignIn={setUser}
        initialMode={emailAuth.mode}
        googleUser={user?.provider === 'google' ? user : null}
        onUseGoogle={() => {
          setEmailAuth((state) => ({ ...state, open: false }))
          setGoogleOpen(true)
        }}
      />
    </div>
  )
}

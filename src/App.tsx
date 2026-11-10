import { useState } from 'react'
import { AuthModal } from './components/AuthModal'
import { EmailAuthModal } from './components/EmailAuthModal'
import { ChatApp } from './components/ChatApp'
import type { User } from './lib/auth'
import {
  loadSession,
  saveSession,
  clearSession,
  addRecentAccount,
  getRecentAccounts,
  cacheSessionUser,
} from './lib/auth'

export default function App() {
  const [user, setUser] = useState<User | null>(() => loadSession())
  const [recentAccounts, setRecentAccounts] = useState<User[]>(() => getRecentAccounts())
  const [googleOpen, setGoogleOpen] = useState(false)
  const [emailAuth, setEmailAuth] = useState<{ open: boolean; mode: 'login' | 'signup' | 'link' | 'forgot' }>({
    open: false,
    mode: 'login',
  })

  const handleSignIn = (authUser: User) => {
    setUser(authUser)
    saveSession(authUser.id)
    cacheSessionUser(authUser)
    addRecentAccount(authUser)
    setRecentAccounts(getRecentAccounts())
  }

  const handleSignOut = () => {
    clearSession()
    setUser(null)
  }

  const handleSwitchAccount = (account: User) => {
    setUser(account)
    saveSession(account.id)
    addRecentAccount(account)
    setRecentAccounts(getRecentAccounts())
  }

  const openEmailAuth = (mode: 'login' | 'signup' | 'link' | 'forgot' = 'login') => {
    setEmailAuth({ open: true, mode })
    setGoogleOpen(false)
  }

  return (
    <div className="app">
      <ChatApp
        user={user}
        onSignInRequest={() => setGoogleOpen(true)}
        onSignOut={handleSignOut}
        onOpenEmailAuth={openEmailAuth}
        recentAccounts={recentAccounts}
        onSwitchAccount={handleSwitchAccount}
      />
      <AuthModal
        open={googleOpen}
        onClose={() => setGoogleOpen(false)}
        onSignIn={handleSignIn}
        onUseEmail={(mode) => openEmailAuth(mode)}
      />
      <EmailAuthModal
        open={emailAuth.open}
        onClose={() => setEmailAuth((state) => ({ ...state, open: false }))}
        onSignIn={handleSignIn}
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

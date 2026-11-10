import { useState } from 'react'
import { AuthModal, type User } from './components/AuthModal'
import { ChatApp } from './components/ChatApp'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authOpen, setAuthOpen] = useState(false)

  return (
    <div className="app">
      <ChatApp
        user={user}
        onSignInRequest={() => setAuthOpen(true)}
        onSignOut={() => setUser(null)}
      />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onSignIn={setUser} />
    </div>
  )
}

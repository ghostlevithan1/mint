import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'katex/dist/katex.min.css'
// Self-hosted so the UI never reaches a third-party origin.
import '@fontsource-variable/geist/wght.css'
import '@fontsource-variable/geist-mono/wght.css'
import './styles.css'
import { preloadNameDetector } from './lib/privacy'

// Warm the name detector once the page is idle, before the first message.
const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 1200))
idle(() => void preloadNameDetector())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

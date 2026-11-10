import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { applyTheme, cycleTheme, getStoredTheme, themeLabel, type Theme } from '../lib/theme'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme)

  useEffect(() => {
    applyTheme(theme)
    try {
      localStorage.setItem('mint.theme', theme)
    } catch {
      // ignore
    }
  }, [theme])

  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme((current) => cycleTheme(current))}
      title={`Theme: ${themeLabel(theme)}`}
      aria-label={`Theme: ${themeLabel(theme)}`}
    >
      <Icon size={13} />
      <span>{themeLabel(theme)}</span>
    </button>
  )
}

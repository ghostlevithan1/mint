export type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'mint.theme'

export function getStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'system'
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    // ignore
  }
  return 'system'
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === 'system') {
    delete root.dataset.theme
  } else {
    root.dataset.theme = theme
  }
}

export function cycleTheme(theme: Theme): Theme {
  if (theme === 'system') return 'light'
  if (theme === 'light') return 'dark'
  return 'system'
}

export function themeLabel(theme: Theme): string {
  if (theme === 'system') return 'Auto'
  if (theme === 'light') return 'Light'
  return 'Dark'
}

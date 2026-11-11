export type Theme =
  | 'dark'
  | 'light'
  | 'midnight'
  | 'ocean'
  | 'forest'
  | 'sunset'
  | 'blush'
  | 'lavender'
  | 'paper'

export type ThemePreview = {
  bg: string
  panel: string
  accent: string
  text: string
}

export type ThemeDefinition = {
  id: Theme
  name: string
  mode: 'dark' | 'light'
  preview: ThemePreview
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'dark',
    name: 'Dark',
    mode: 'dark',
    preview: { bg: '#070906', panel: '#101510', accent: '#9be72f', text: '#f1f5ef' },
  },
  {
    id: 'light',
    name: 'Light',
    mode: 'light',
    preview: { bg: '#f2f5ee', panel: '#ffffff', accent: '#548a0b', text: '#141a14' },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    mode: 'dark',
    preview: { bg: '#05070f', panel: '#101528', accent: '#6f8cff', text: '#eef2ff' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    mode: 'dark',
    preview: { bg: '#04100f', panel: '#0d2422', accent: '#2fd4b4', text: '#eafaf6' },
  },
  {
    id: 'forest',
    name: 'Forest',
    mode: 'dark',
    preview: { bg: '#0c100a', panel: '#1a2115', accent: '#c8e05a', text: '#f0f5e8' },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    mode: 'dark',
    preview: { bg: '#12080b', panel: '#24151b', accent: '#ff8a5c', text: '#fff0ee' },
  },
  {
    id: 'blush',
    name: 'Blush',
    mode: 'light',
    preview: { bg: '#fbf0f2', panel: '#ffffff', accent: '#b83e70', text: '#2c1420' },
  },
  {
    id: 'lavender',
    name: 'Lavender',
    mode: 'light',
    preview: { bg: '#f3f1fb', panel: '#ffffff', accent: '#6d51c4', text: '#1e1830' },
  },
  {
    id: 'paper',
    name: 'Paper',
    mode: 'light',
    preview: { bg: '#f6f1e7', panel: '#fffdf8', accent: '#96601a', text: '#2a2419' },
  },
]

const THEME_IDS = new Set<string>(THEMES.map((theme) => theme.id))
const STORAGE_KEY = 'mint.theme'

function preferredTheme(): Theme {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

export function getStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'dark'
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    // Older builds stored "system"; map it to the current OS preference once.
    if (value === 'system') return preferredTheme()
    if (value && THEME_IDS.has(value)) return value as Theme
  } catch {
    // ignore
  }
  return 'dark'
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  const definition = THEMES.find((item) => item.id === theme)
  if (meta && definition) meta.setAttribute('content', definition.preview.bg)
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // ignore
  }
}

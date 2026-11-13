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
    preview: { bg: '#121310', panel: '#1e201a', accent: '#86d95f', text: '#ecefe6' },
  },
  {
    id: 'light',
    name: 'Light',
    mode: 'light',
    preview: { bg: '#f7f7f5', panel: '#ffffff', accent: '#3f7a12', text: '#1a1a18' },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    mode: 'dark',
    preview: { bg: '#0b0d14', panel: '#181c28', accent: '#8696ee', text: '#e9ecf5' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    mode: 'dark',
    preview: { bg: '#0c1211', panel: '#1a2422', accent: '#46bda2', text: '#e8f0ee' },
  },
  {
    id: 'forest',
    name: 'Forest',
    mode: 'dark',
    preview: { bg: '#121310', panel: '#20211a', accent: '#a8c257', text: '#edeee0' },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    mode: 'dark',
    preview: { bg: '#141110', panel: '#241f1c', accent: '#e0885a', text: '#f0e9e4' },
  },
  {
    id: 'blush',
    name: 'Blush',
    mode: 'light',
    preview: { bg: '#faf7f5', panel: '#ffffff', accent: '#a8486a', text: '#2a2424' },
  },
  {
    id: 'lavender',
    name: 'Lavender',
    mode: 'light',
    preview: { bg: '#f8f7fa', panel: '#ffffff', accent: '#6556ab', text: '#221f2b' },
  },
  {
    id: 'paper',
    name: 'Paper',
    mode: 'light',
    preview: { bg: '#f7f4ec', panel: '#fffefa', accent: '#8f5f16', text: '#26221a' },
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

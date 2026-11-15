/**
 * Sites the student has allowed to show images inside answers.
 *
 * An answer can contain `![x](https://site/a.png?anything)`. Loading that image
 * tells the site the whole URL, and a model steered by a web page could put
 * the student's own text in it. So images in model output wait for a click,
 * and "always show images from this site" is remembered here, on this device.
 */

const KEY = 'mint.imageHosts'
const MAX_HOSTS = 50

let hosts: string[] | null = null
const listeners = new Set<() => void>()

function normalize(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, '')
}

function load(): string[] {
  if (hosts) return hosts
  let parsed: unknown = []
  try {
    parsed = JSON.parse((typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)) ?? '[]')
  } catch {
    // A missing or damaged value just means nothing is allowed yet.
  }
  hosts = Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(-MAX_HOSTS)
    : []
  return hosts
}

export function isImageHostAllowed(host: string): boolean {
  const name = normalize(host)
  return Boolean(name) && load().includes(name)
}

export function allowImageHost(host: string): void {
  const name = normalize(host)
  if (!name || load().includes(name)) return
  hosts = [...load(), name].slice(-MAX_HOSTS)
  try {
    localStorage.setItem(KEY, JSON.stringify(hosts))
  } catch {
    // The choice still holds for this session.
  }
  for (const listener of listeners) listener()
}

export function subscribeImageHosts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

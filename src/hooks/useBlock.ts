import { useEffect, useState, useSyncExternalStore } from 'react'
import { clearBlock, getBlockSnapshot, subscribeBlock, type Block } from '../lib/blocks'

/** The current time, refreshed about four times a second while `until` is still ahead. */
export function useNow(until: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until) return
    setNow(Date.now())
    if (until <= Date.now()) return
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= until) window.clearInterval(timer)
    }, 250)
    return () => window.clearInterval(timer)
  }, [until])
  return now
}

/** The pause in force, with its live remaining time. It ends itself when the time is up. */
export function useBlock(): { block: Block | null; remainingMs: number } {
  const stored = useSyncExternalStore(subscribeBlock, getBlockSnapshot, () => null)
  const now = useNow(stored?.until)
  const remainingMs = stored ? Math.max(0, stored.until - now) : 0

  useEffect(() => {
    if (stored && stored.until <= Date.now()) clearBlock()
  }, [stored, remainingMs])

  return { block: stored && remainingMs > 0 ? stored : null, remainingMs }
}

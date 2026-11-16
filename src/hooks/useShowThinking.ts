import { useSyncExternalStore } from 'react'
import { getShowThinking, setShowThinking, subscribeShowThinking } from '../lib/preferences'

/** The "show thinking" setting, shared by Settings and every answer on screen. */
export function useShowThinking(): [boolean, (value: boolean) => void] {
  const show = useSyncExternalStore(subscribeShowThinking, getShowThinking, getShowThinking)
  return [show, setShowThinking]
}

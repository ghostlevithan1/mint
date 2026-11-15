import { useSyncExternalStore } from 'react'
import { allowImageHost, isImageHostAllowed, subscribeImageHosts } from '../lib/imageHosts'

/** Whether images from `host` may load without a click, and a way to allow them. */
export function useImageHost(host: string): [boolean, () => void] {
  const allowed = useSyncExternalStore(
    subscribeImageHosts,
    () => isImageHostAllowed(host),
    () => false,
  )
  return [allowed, () => allowImageHost(host)]
}

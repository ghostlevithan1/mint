import { useCallback, useEffect, useState } from 'react'
import { INITIAL_PROVIDER_STATUS, type ProviderStatus } from '../lib/provider'

type StatusResponse = {
  provider?: string
  configured?: boolean
  models?: Record<string, string>
}

export function useProviderStatus() {
  const [status, setStatus] = useState<ProviderStatus>(INITIAL_PROVIDER_STATUS)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/status', { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`Status request failed (${response.status}).`)
      const data = (await response.json()) as StatusResponse
      const live = data.provider === 'nvidia' && data.configured === true
      setStatus({
        checked: true,
        configured: data.configured === true,
        mode: live ? 'nvidia' : 'demo',
        label: live ? 'NVIDIA NIM' : 'Local demo',
        detail: live
          ? 'Answers stream from NVIDIA NIM through the server proxy.'
          : 'Live inference is not configured. Answers come from the local demo engine.',
      })
    } catch {
      setStatus({
        checked: true,
        configured: false,
        mode: 'demo',
        label: 'Local demo',
        detail:
          'The inference proxy is unavailable. Answers come from the local demo engine until it is reachable.',
      })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { status, refresh }
}

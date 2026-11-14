import { useCallback, useEffect, useState } from 'react'
import { INITIAL_PROVIDER_STATUS, type ProviderStatus } from '../lib/provider'

type StatusResponse = {
  configured?: boolean
  providers?: { nvidia?: boolean; openrouter?: boolean }
}

export function useProviderStatus() {
  const [status, setStatus] = useState<ProviderStatus>(INITIAL_PROVIDER_STATUS)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/status', { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`Status request failed (${response.status}).`)
      const data = (await response.json()) as StatusResponse
      const nvidia = data.providers?.nvidia ?? data.configured === true
      const openrouter = data.providers?.openrouter === true
      const live = nvidia || openrouter
      const names = [nvidia && 'NVIDIA NIM', openrouter && 'OpenRouter'].filter(Boolean)
      setStatus({
        checked: true,
        live,
        label: live ? names.join(' + ') : 'Not configured',
        detail: !live
          ? 'The server has no API keys, so questions cannot be answered yet.'
          : nvidia && openrouter
            ? 'Answers stream from NVIDIA NIM and OpenRouter through the server proxy.'
            : nvidia
              ? 'Answers stream from NVIDIA NIM. Gemma 4 and Inkling need an OpenRouter key (OPEN_CODE_KEY).'
              : 'Answers stream from OpenRouter. The NVIDIA models need an NVIDIA API key.',
      })
    } catch {
      setStatus({
        checked: true,
        live: false,
        label: 'Unreachable',
        detail: 'The Mint server could not be reached. Check your connection.',
      })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { status, refresh }
}

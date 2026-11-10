export type ProviderMode = 'nvidia' | 'demo'

export type ProviderStatus = {
  checked: boolean
  configured: boolean
  mode: ProviderMode
  label: string
  detail: string
}

export const INITIAL_PROVIDER_STATUS: ProviderStatus = {
  checked: false,
  configured: false,
  mode: 'nvidia',
  label: 'Checking inference provider',
  detail: 'Checking whether a server-side NVIDIA key is available.',
}

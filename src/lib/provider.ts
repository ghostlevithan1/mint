export type ProviderStatus = {
  checked: boolean
  /** True when the server has at least one provider key and can stream live answers. */
  live: boolean
  label: string
  detail: string
}

export const INITIAL_PROVIDER_STATUS: ProviderStatus = {
  checked: false,
  live: false,
  label: 'Checking inference provider',
  detail: 'Checking whether live inference is available.',
}

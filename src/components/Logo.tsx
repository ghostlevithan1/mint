export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <a className="brand" href="#top" aria-label={compact ? 'Mint home' : undefined}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 30 30" role="img">
          <path d="M4 26V7h5.1L15 17.6 20.9 7H26v19h-5V16.1L15 26l-6-9.9V26H4Z" fill="currentColor" />
          <path d="M23.5 2H27v3.5h-3.5z" fill="var(--green-bright)" />
        </svg>
      </span>
      {!compact && (
        <span className="brand-word">
          <strong>MINT</strong>
          <span>PRIVATE AI</span>
        </span>
      )}
    </a>
  )
}

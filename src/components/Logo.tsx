export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <a className="brand" href="#top" aria-label={compact ? 'Mint home' : undefined}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 30 30" role="img">
          <path d="M5 25V6h4.8L15 17.2 20.2 6H25v19h-4.6V14.6L15 24.4l-5.4-9.8V25H5Z" fill="currentColor" />
        </svg>
      </span>
      {!compact && (
        <span className="brand-word">
          <strong>Mint</strong>
          <span>Private AI</span>
        </span>
      )}
    </a>
  )
}

/** Mint's mark: a mint leaf split along its midrib, in one flat colour. */
export function LeafMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="leaf-mark" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M4 20C4 11 10 4 20 4Z" transform="translate(-0.7 -0.7)" fill="currentColor" />
      <path d="M20 4C20 14 13 20 4 20Z" transform="translate(0.7 0.7)" fill="currentColor" />
      <path d="M4.6 19.4 2 22" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function Logo() {
  return (
    <a className="brand" href="#top" aria-label="Mint home">
      <span className="brand-mark">
        <LeafMark />
      </span>
      <strong className="brand-word">Mint</strong>
    </a>
  )
}

import type { FileCapability, Model } from '../lib/data'
import { modelCapabilities } from '../lib/data'
import { Eye, FileText, Globe2 } from 'lucide-react'

const LOGO_COLORS: Record<string, string> = {
  NVIDIA: '#76B900',
  DeepSeek: '#4D6BFE',
  Meta: '#0866FF',
  Mistral: '#FA520F',
  MiniMax: '#F23F79',
  Poolside: '#59B8FF',
}

function LogoMark({ maker }: { maker: string }) {
  if (maker === 'NVIDIA') {
    return (
      <>
        <path
          d="M12 4.2c-5.1 0-9.2 3-11 7.8 1.8 4.8 5.9 7.8 11 7.8s9.2-3 11-7.8c-1.8-4.8-5.9-7.8-11-7.8Zm0 13.1a5.3 5.3 0 1 1 0-10.6 5.3 5.3 0 0 1 0 10.6Z"
          fill="currentColor"
          opacity=".85"
        />
        <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      </>
    )
  }
  if (maker === 'DeepSeek') {
    return (
      <>
        <path
          d="M4.5 13.2c2.7-4.1 7.4-5.4 11.4-3.7 1.5.7 2.7 1.9 3.6 3.4-1.5-.6-2.7-.8-4.1-.4-1.1 3-3.7 4.9-7.1 4.9-2.6 0-4.6-1.3-5.7-3 1.2.2 2.1 0 2.8-.5-.7-.5-1.2-1.2-1.5-2.1.5.2.9.3 1.4.2-.3-.5-.6-1-.8-1.6Z"
          fill="currentColor"
        />
        <circle cx="16.6" cy="7.7" r="1.15" fill="currentColor" />
      </>
    )
  }
  if (maker === 'Meta') {
    return (
      <path
        d="M6.1 8.3c1.8 0 3 1.4 4.8 4.1 1.2 1.8 2 2.7 3.1 2.7 1.5 0 2.5-1.3 2.5-3.2s-1-3.2-2.6-3.2c-1 0-1.8.5-2.7 1.6L9.8 8.7c1.2-1.5 2.5-2.2 4.2-2.2 2.9 0 4.8 2.3 4.8 5.4s-2 5.4-4.7 5.4c-1.8 0-3.1-1-4.5-3.2-1.3-2-1.9-2.7-3.3-2.7-1.6 0-2.6 1.3-2.6 3.2s1 3.2 2.6 3.2c1 0 1.8-.5 2.8-1.7l1.4 1.6C9.3 19.2 8 20 6.3 20 3.9 20 2 17.7 2 14.5s1.9-6.2 4.1-6.2Z"
        fill="currentColor"
      />
    )
  }
  if (maker === 'Mistral') {
    return (
      <path
        d="M2 5h3v4H2V5Zm4 0h3v4H6V5Zm10 0h3v4h-3V5Zm3 0h3v4h-3V5ZM4 9h3v4H4V9Zm4 0h3v4H8V9Zm5 0h3v4h-3V9Zm4 0h3v4h-3V9ZM2 13h3v6H2v-6Zm4 0h5v6H6v-6Zm7 0h5v6h-5v-6Zm7 0h2v6h-2v-6Zm-4 0h2v6h-2v-6Z"
        fill="currentColor"
      />
    )
  }
  if (maker === 'MiniMax') {
    return (
      <path
        d="M2 19V6.5l4.2 4.2L11 5l4.8 5.7L20 6.5V19h-3v-6.8l-2.2 2.6h-2.6L10 12.2V19H7v-6.8l-2 2.6v4.2H2Z"
        fill="currentColor"
      />
    )
  }
  if (maker === 'Poolside') {
    return (
      <>
        <path d="M4 8.4h16v2.2H4V8.4Z" fill="currentColor" opacity=".7" />
        <path
          d="M3.5 13.6c1.8-.9 3-.9 4.8 0s3 .9 4.8 0 3-.9 4.8 0 2.6.8 3.6.4v2.6c-1.4.5-2.6.4-4.2-.3-1.6-.8-2.8-.8-4.4 0-1.6.8-2.8.8-4.4 0-1.6-.8-2.8-.8-4.4 0l-.6-2.7Z"
          fill="currentColor"
        />
      </>
    )
  }
  return <circle cx="12" cy="12" r="8" fill="currentColor" opacity=".8" />
}

export function ModelLogo({
  maker,
  size = 16,
  className = '',
}: {
  maker: string
  size?: number
  className?: string
}) {
  return (
    <span
      className={`model-logo ${className}`.trim()}
      style={{ color: LOGO_COLORS[maker] ?? 'currentColor' }}
      aria-hidden="true"
      title={maker}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <LogoMark maker={maker} />
      </svg>
    </span>
  )
}

function CapabilityIcon({ capability }: { capability: FileCapability }) {
  if (capability === 'image') return <Eye size={9} />
  if (capability === 'web') return <Globe2 size={9} />
  return <FileText size={9} />
}

const CAPABILITY_LABEL: Record<FileCapability, string> = {
  text: 'Text',
  image: 'Vision',
  web: 'Web',
}

export function ModelCapabilityBadges({
  model,
  showText = true,
}: {
  model: Model
  showText?: boolean
}) {
  const capabilities = modelCapabilities(model)
  return (
    <span className="model-caps">
      {capabilities.map((capability) => {
        if (!showText && capability === 'text') return null
        return (
          <span className={`model-cap-badge cap-${capability}`} key={capability}>
            <CapabilityIcon capability={capability} />
            {CAPABILITY_LABEL[capability]}
          </span>
        )
      })}
    </span>
  )
}

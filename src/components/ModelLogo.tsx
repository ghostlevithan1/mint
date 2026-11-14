import type { FileCapability, Model } from '../lib/data'
import { modelCapabilities } from '../lib/data'
import { Eye, FileText, Globe2 } from 'lucide-react'
import { MODEL_LOGOS } from './modelLogoPaths'

const LOGO_COLORS: Record<string, string> = {
  NVIDIA: '#76B900',
  DeepSeek: '#4D6BFE',
  Meta: '#0866FF',
  Mistral: '#FA520F',
  MiniMax: '#F23F79',
  Poolside: '#59B8FF',
}

function LogoMark({ maker }: { maker: string }) {
  const logo = MODEL_LOGOS[maker]
  if (!logo) return <circle cx="12" cy="12" r="8" fill="currentColor" opacity=".8" />
  return <path d={logo.path} fill="currentColor" />
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
  const logo = MODEL_LOGOS[maker]
  return (
    <span
      className={`model-logo ${className}`.trim()}
      style={{ color: LOGO_COLORS[maker] ?? 'currentColor' }}
      aria-hidden="true"
      title={maker}
    >
      <svg
        width={size}
        height={size}
        viewBox={logo?.viewBox ?? '0 0 24 24'}
        fill="none"
      >
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

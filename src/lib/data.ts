export type ModelType = 'quick' | 'normal' | 'intelligent'

/** File capabilities a model can actually read. Text is always supported. */
export type FileCapability = 'text' | 'image'

export type ModelTypeInfo = {
  id: ModelType
  label: string
  tagline: string
  detail: string
  color: string
  defaultModelId: string
}

export const MODEL_TYPES: ModelTypeInfo[] = [
  {
    id: 'quick',
    label: 'Quick',
    tagline: 'Fastest',
    detail: 'Drafts, summaries, and light edits where speed matters.',
    color: '#9BE72F',
    defaultModelId: 'nemotron-lightning',
  },
  {
    id: 'normal',
    label: 'Normal',
    tagline: 'Balanced',
    detail: 'Everyday reasoning and general chat at a steady pace.',
    color: '#8ED6FF',
    defaultModelId: 'minimax-flash',
  },
  {
    id: 'intelligent',
    label: 'Intelligent',
    tagline: 'Deepest',
    detail: 'Complex analysis, long context, and high-stakes work.',
    color: '#FFB454',
    defaultModelId: 'mistral-large-4',
  },
]

export type Model = {
  id: string
  type: ModelType
  name: string
  maker: string
  descriptor: string
  meta: string
  tps: number
  context: string
  color: string
  glyph: string
  /** Extra capabilities beyond plain text. */
  capabilities?: FileCapability[]
}

/** Capabilities including the text support every model has. */
export function modelCapabilities(model: Model): FileCapability[] {
  return ['text', ...(model.capabilities ?? [])]
}

export const MODELS: Model[] = [
  {
    id: 'nemotron-lightning',
    type: 'quick',
    name: 'Nemotron 3.5 Lightning',
    maker: 'NVIDIA',
    descriptor: 'Fast drafts',
    meta: '30B A3B',
    tps: 185,
    context: '128K',
    color: '#9BE72F',
    glyph: 'N',
  },
  {
    id: 'nemotron-nano-omni',
    type: 'quick',
    name: 'Nemotron 3 Nano Omni',
    maker: 'NVIDIA',
    descriptor: 'Multimodal speed',
    meta: '30B A3B',
    tps: 158,
    context: '128K',
    color: '#B5FF4D',
    glyph: 'N',
    capabilities: ['image'],
  },
  {
    id: 'laguna-xs',
    type: 'normal',
    name: 'Laguna XS 2.1',
    maker: 'Poolside',
    descriptor: 'Code-first',
    meta: 'XS',
    tps: 132,
    context: '128K',
    color: '#8ED6FF',
    glyph: 'L',
  },
  {
    id: 'minimax-flash',
    type: 'normal',
    name: 'MiniMax M3.1 Flash',
    maker: 'MiniMax',
    descriptor: 'Balanced chat',
    meta: 'M3.1',
    tps: 126,
    context: '128K',
    color: '#7BD3FF',
    glyph: 'M',
  },
  {
    id: 'muse-glimmer',
    type: 'normal',
    name: 'Muse Glimmer 30B',
    maker: 'Meta',
    descriptor: 'Creative balance',
    meta: '30B',
    tps: 114,
    context: '128K',
    color: '#E8F1E5',
    glyph: 'M',
  },
  {
    id: 'mistral-large-4',
    type: 'intelligent',
    name: 'Mistral Large 4',
    maker: 'Mistral',
    descriptor: 'Frontier reasoning',
    meta: '1T A52B',
    tps: 52,
    context: '256K',
    color: '#FFB454',
    glyph: 'M',
  },
  {
    id: 'nemotron-super-vl',
    type: 'intelligent',
    name: 'Nemotron 3.5 Super VL',
    maker: 'NVIDIA',
    descriptor: 'Vision + reasoning',
    meta: '120B A12B',
    tps: 61,
    context: '128K',
    color: '#A8F05A',
    glyph: 'N',
    capabilities: ['image'],
  },
  {
    id: 'nemotron-ultra',
    type: 'intelligent',
    name: 'Nemotron 3 Ultra',
    maker: 'NVIDIA',
    descriptor: 'Deep reasoning',
    meta: '550B A55B',
    tps: 38,
    context: '128K',
    color: '#9BE72F',
    glyph: 'N',
  },
  {
    id: 'deepseek-flash',
    type: 'intelligent',
    name: 'DeepSeek V4.1 Flash',
    maker: 'DeepSeek',
    descriptor: 'Efficient reasoning',
    meta: 'V4.1',
    tps: 88,
    context: '128K',
    color: '#7FB4FF',
    glyph: 'D',
  },
]

export const DEFAULT_MODEL_ID = 'minimax-flash'

export function typeInfo(id: ModelType) {
  return MODEL_TYPES.find((item) => item.id === id) ?? MODEL_TYPES[0]
}

export function modelsByType(id: ModelType) {
  return MODELS.filter((model) => model.type === id)
}

export type Redaction = {
  original: string
  placeholder: string
  kind: 'name' | 'email' | 'phone'
}

export const SAMPLE_PROMPTS = [
  'Summarize the attached report for Sarah Chen. Flag the three most important risks and note anything that needs follow-up before Friday.',
  'Review this contract excerpt for Marcus Reed. Identify unusual liability terms, auto-renewal language, and obligations that should be negotiated.',
  'Draft a concise reply to James Okafor about the Q3 forecast. Reference the attached spreadsheet and suggest two next steps for the revenue team.',
]

export const FILE_LIMIT = 25 * 1024 * 1024
export const MAX_FILES = 5

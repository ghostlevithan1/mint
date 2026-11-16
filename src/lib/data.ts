export type ModelType = 'quick' | 'normal' | 'intelligent'

/** Capabilities a model actually supports. Text is always supported. */
export type FileCapability = 'text' | 'image'

export type ModelTypeInfo = {
  id: ModelType
  label: string
  tagline: string
  detail: string
  color: string
}

export const MODEL_TYPES: ModelTypeInfo[] = [
  {
    id: 'quick',
    label: 'Quick',
    tagline: 'Fastest',
    detail: 'Drafts, summaries, and light edits where speed matters.',
    color: '#86D95F',
  },
  {
    id: 'normal',
    label: 'Normal',
    tagline: 'Balanced',
    detail: 'Everyday reasoning and general chat at a steady pace.',
    color: '#8FB4D9',
  },
  {
    id: 'intelligent',
    label: 'Intelligent',
    tagline: 'Deepest',
    detail: 'Complex analysis, long context, and high-stakes work.',
    color: '#E0B26A',
  },
]

export type Model = {
  id: string
  type: ModelType
  name: string
  maker: string
  /** What this model is best at, in one sentence. */
  bestAt: string
  meta: string
  tps: number
  context: string
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
    bestAt: 'Quick drafts, short rewrites, and summaries where speed matters most.',
    meta: '30B A3B',
    tps: 185,
    context: '128K',
  },
  {
    id: 'nemotron-nano-omni',
    type: 'quick',
    name: 'Nemotron 3 Nano Omni',
    maker: 'NVIDIA',
    bestAt: 'Reading screenshots, diagrams, and photos while keeping replies fast.',
    meta: '30B A3B',
    tps: 158,
    context: '128K',
    capabilities: ['image'],
  },
  {
    id: 'gemma-4-31b',
    type: 'quick',
    name: 'Gemma 4 31B',
    maker: 'Google',
    bestAt: 'Fast, clear explanations and quick reads of photos and worksheets.',
    meta: '31B',
    tps: 90,
    context: '256K',
    capabilities: ['image'],
  },
  {
    id: 'gpt-oss-20b',
    type: 'quick',
    name: 'GPT-OSS 20B',
    maker: 'OpenAI',
    bestAt: 'Fast step-by-step answers to maths, science, and homework questions.',
    meta: '21B A3.6B',
    tps: 120,
    context: '128K',
  },
  {
    id: 'laguna-xs',
    type: 'normal',
    name: 'Laguna XS 2.1',
    maker: 'Poolside',
    bestAt: 'Code generation, refactors, and debugging across a repository.',
    meta: 'XS',
    tps: 132,
    context: '128K',
  },
  {
    id: 'muse-glimmer',
    type: 'normal',
    name: 'Muse Glimmer 30B',
    maker: 'Meta',
    bestAt: 'Creative writing, brainstorming, and tone-sensitive copy.',
    meta: '30B',
    tps: 114,
    context: '128K',
  },
  {
    id: 'minimax-m3-flash',
    type: 'normal',
    name: 'MiniMax M3.1 Flash',
    maker: 'MiniMax',
    bestAt: 'Very quick, well-organised everyday answers, long documents, and photos.',
    meta: 'M3.1 Flash',
    tps: 150,
    context: '1M',
    capabilities: ['image'],
  },
  {
    id: 'nemotron-super-vl',
    type: 'intelligent',
    name: 'Nemotron 3.5 Super VL',
    maker: 'NVIDIA',
    bestAt: 'Vision-heavy analysis, charts, and detailed reasoning over images.',
    meta: '120B A12B',
    tps: 61,
    context: '128K',
    capabilities: ['image'],
  },
  {
    id: 'nemotron-ultra',
    type: 'intelligent',
    name: 'Nemotron 3 Ultra',
    maker: 'NVIDIA',
    bestAt: 'Deep multi-step reasoning, research, and hard technical problems.',
    meta: '550B A55B',
    tps: 38,
    context: '128K',
  },
  {
    id: 'deepseek-flash',
    type: 'intelligent',
    name: 'DeepSeek V4.1 Flash',
    maker: 'DeepSeek',
    bestAt: 'Efficient math, logic, and structured step-by-step reasoning.',
    meta: 'V4.1',
    tps: 88,
    context: '128K',
  },
]

/**
 * Models taken out of the picker. They are kept only so answers they gave in
 * saved chats still carry their real name; nothing can be sent to them.
 */
export const RETIRED_MODELS: Model[] = [
  {
    id: 'inkling-2-small',
    type: 'normal',
    name: 'Inkling 2 Small',
    maker: 'Thinking Machines',
    bestAt: 'Retired.',
    meta: '594B A17B',
    tps: 110,
    context: '1M',
  },
]

/** The model an earlier answer came from, retired models included. */
export function answerModel(id?: string): Model | undefined {
  return MODELS.find((model) => model.id === id) ?? RETIRED_MODELS.find((model) => model.id === id)
}

export const DEFAULT_MODEL_ID = 'nemotron-lightning'

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

export const FILE_LIMIT = 25 * 1024 * 1024
export const MAX_FILES = 10

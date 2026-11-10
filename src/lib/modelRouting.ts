import {
  MODELS,
  modelCapabilities,
  type FileCapability,
  type Model,
  type ModelType,
} from './data'
import type { Attachment } from './files'

/**
 * The capability a set of attachments needs from a model. Images need vision;
 * every other file is handled as text context.
 */
export type AttachmentNeed = FileCapability

export function needForAttachments(attachments: Attachment[]): AttachmentNeed {
  return attachments.some((file) => file.kind === 'image') ? 'image' : 'text'
}

export function modelSupportsAttachments(model: Model, attachments: Attachment[]): boolean {
  if (!attachments.length) return true
  return modelCapabilities(model).includes(needForAttachments(attachments))
}

export function compatibleModels(attachments: Attachment[], type?: ModelType): Model[] {
  if (!attachments.length) return []
  const need = needForAttachments(attachments)
  return MODELS.filter(
    (model) => (!type || model.type === type) && modelCapabilities(model).includes(need),
  )
}

export type RouteResult =
  | { status: 'ok'; model: Model; need: AttachmentNeed }
  | { status: 'switched'; model: Model; previous: Model; need: AttachmentNeed }
  | { status: 'blocked'; need: AttachmentNeed; alternatives: Model[] }

/**
 * Keeps the chosen intelligence tier and picks a model in it that can read the
 * attached files. When the tier has no capable model, the caller must ask the
 * user to switch before sending.
 */
export function routeWithinTier(current: Model, attachments: Attachment[]): RouteResult {
  if (!attachments.length) return { status: 'ok', model: current, need: 'text' }

  const need = needForAttachments(attachments)
  const inTier = compatibleModels(attachments, current.type)

  if (!inTier.length) {
    return {
      status: 'blocked',
      need,
      alternatives: compatibleModels(attachments).filter((model) => model.id !== current.id),
    }
  }

  if (inTier.some((model) => model.id === current.id)) {
    return { status: 'ok', model: current, need }
  }

  // Prefer the fastest capable model inside the same tier.
  const [best] = [...inTier].sort((a, b) => b.tps - a.tps)
  return { status: 'switched', model: best, previous: current, need }
}

export function capabilityLabel(need: AttachmentNeed): string {
  return need === 'image' ? 'images' : 'text files'
}

import { MODELS, modelCapabilities, } from './data';
export function needForAttachments(attachments) {
    return attachments.some((file) => file.kind === 'image' && Boolean(file.dataUrl))
        ? 'image'
        : 'text';
}
export function modelSupportsAttachments(model, attachments) {
    if (!attachments.length)
        return true;
    return modelCapabilities(model).includes(needForAttachments(attachments));
}
export function compatibleModels(attachments, type) {
    if (!attachments.length)
        return [];
    const need = needForAttachments(attachments);
    return MODELS.filter((model) => (!type || model.type === type) && modelCapabilities(model).includes(need));
}
/**
 * Keeps the chosen intelligence tier and picks a model in it that can read the
 * attached files. When the tier has no capable model, the caller must ask the
 * user to switch before sending.
 */
export function routeWithinTier(current, attachments) {
    if (!attachments.length)
        return { status: 'ok', model: current, need: 'text' };
    const need = needForAttachments(attachments);
    const inTier = compatibleModels(attachments, current.type);
    if (!inTier.length) {
        return {
            status: 'blocked',
            need,
            alternatives: compatibleModels(attachments).filter((model) => model.id !== current.id),
        };
    }
    if (inTier.some((model) => model.id === current.id)) {
        return { status: 'ok', model: current, need };
    }
    // Prefer the fastest capable model inside the same tier.
    const [best] = [...inTier].sort((a, b) => b.tps - a.tps);
    return { status: 'switched', model: best, previous: current, need };
}
export function capabilityLabel(need) {
    return need === 'image' ? 'images' : 'text files';
}

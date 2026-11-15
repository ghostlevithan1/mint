export function uid() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        return crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
export function buildChatTitle(text, attachments) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean)
        return clean.length > 48 ? `${clean.slice(0, 48).trimEnd()}…` : clean;
    if (attachments.length === 1)
        return `Review ${attachments[0].name}`;
    if (attachments.length > 1)
        return `Review ${attachments.length} files`;
    return 'New chat';
}
export function modelById(models, id) {
    return models.find((model) => model.id === id) ?? models[0];
}

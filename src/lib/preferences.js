function readFlag(key, fallback) {
    if (typeof localStorage === 'undefined')
        return fallback;
    try {
        const value = localStorage.getItem(key);
        if (value === 'off')
            return false;
        if (value === 'on')
            return true;
    }
    catch {
        // ignore
    }
    return fallback;
}
function saveFlag(key, enabled) {
    try {
        localStorage.setItem(key, enabled ? 'on' : 'off');
    }
    catch {
        // ignore
    }
}
const JPEG_CONVERSION_KEY = 'mint.images.convertToJpeg';
/** JPEG conversion is on by default so attachment formats stay predictable. */
export function getStoredJpegConversion() {
    return readFlag(JPEG_CONVERSION_KEY, true);
}
export function saveJpegConversion(enabled) {
    saveFlag(JPEG_CONVERSION_KEY, enabled);
}
const SHIELD_KEY = 'mint.shield';
/** The PII shield is on unless the user turned it off. */
export function getStoredShield() {
    return readFlag(SHIELD_KEY, true);
}
export function saveShield(enabled) {
    saveFlag(SHIELD_KEY, enabled);
}
const METRICS_KEY = 'mint.metrics';
export function getStoredMetrics() {
    return readFlag(METRICS_KEY, false);
}
export function saveMetrics(enabled) {
    saveFlag(METRICS_KEY, enabled);
}
const MODEL_KEY = 'mint.defaultModel';
export function getStoredModelId() {
    if (typeof localStorage === 'undefined')
        return null;
    try {
        return localStorage.getItem(MODEL_KEY);
    }
    catch {
        return null;
    }
}
export function saveModelId(id) {
    try {
        localStorage.setItem(MODEL_KEY, id);
    }
    catch {
        // ignore
    }
}
const PROFILE_KEY = 'mint.profile';
export const PROFILE_MAX_CHARS = 1000;
/** What the student told Mint about themselves; sent as context with each question. */
export function getStoredProfile() {
    if (typeof localStorage === 'undefined')
        return '';
    try {
        return (localStorage.getItem(PROFILE_KEY) ?? '').slice(0, PROFILE_MAX_CHARS);
    }
    catch {
        return '';
    }
}
export function saveProfile(text) {
    try {
        localStorage.setItem(PROFILE_KEY, text.slice(0, PROFILE_MAX_CHARS));
    }
    catch {
        // ignore
    }
}

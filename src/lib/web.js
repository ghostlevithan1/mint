const URL_PATTERN = /\bhttps?:\/\/[^\s<>"`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;
const MAX_LINKS = 3;
const READ_TIMEOUT_MS = 45_000;
const SEARCH_TIMEOUT_MS = 11_000;
const MAX_SEARCH_PAGES = 3;
const MAX_QUERY_CHARS = 300;
/** Pulls distinct http(s) links out of a prompt, ignoring trailing punctuation. */
export function extractUrls(text) {
    const found = text.match(URL_PATTERN) ?? [];
    const cleaned = [];
    for (const raw of found) {
        const candidate = raw.replace(TRAILING_PUNCTUATION, '');
        try {
            const url = new URL(candidate);
            if (url.protocol !== 'http:' && url.protocol !== 'https:')
                continue;
            if (!url.hostname)
                continue;
            const normalized = url.toString();
            if (!cleaned.includes(normalized))
                cleaned.push(normalized);
        }
        catch {
            // Ignore text that only looks like a link.
        }
    }
    return cleaned.slice(0, MAX_LINKS);
}
export async function readWebPage(url, signal, pageBudget = 48_000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort);
    try {
        const response = await fetch('/api/web', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ url, pageBudget }),
            signal: controller.signal,
        });
        if (!response.ok) {
            const detail = (await response.json().catch(() => null));
            throw new Error(detail?.error?.message ?? `That link could not be read (${response.status}).`);
        }
        return (await response.json());
    }
    finally {
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}
/** Reads every link in parallel and folds the pages into a prompt-ready brief. */
export async function fetchWebContext(urls, signal, maxChars = 18_000) {
    if (!urls.length)
        return { sources: [], context: '' };
    // Per-page slice of the total budget, also sent to the server so its page
    // cap can double toward the model's context window when a page is big.
    const perPage = Math.max(600, Math.floor(maxChars / urls.length));
    const results = await Promise.allSettled(urls.map((url) => readWebPage(url, signal, perPage)));
    if (signal?.aborted)
        return { sources: [], context: '' };
    const sources = [];
    const blocks = [];
    for (const result of results) {
        if (result.status !== 'fulfilled')
            continue;
        const page = result.value;
        const text = page.text.slice(0, perPage).trim();
        if (!text)
            continue;
        sources.push({ url: page.url, title: page.title || page.url });
        blocks.push(`Web page: ${page.title || page.url}\nURL: ${page.url}\n\n${text}`);
    }
    return {
        sources,
        context: blocks.join('\n\n---\n\n').slice(0, maxChars),
    };
}
/** Asks the server to run a web search (DuckDuckGo, no key, no RPM cost). */
export async function searchWeb(query, signal) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort);
    try {
        const response = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query }),
            signal: controller.signal,
        });
        if (!response.ok) {
            const detail = (await response.json().catch(() => null));
            throw new Error(detail?.error?.message ?? `Web search failed (${response.status}).`);
        }
        const payload = (await response.json());
        return Array.isArray(payload.results) ? payload.results : [];
    }
    finally {
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}
/** The prompt minus any pasted links, trimmed to what a search engine wants. */
function deriveSearchQuery(text) {
    const cleaned = text.replace(URL_PATTERN, ' ').replace(/\s+/g, ' ').trim();
    return cleaned.slice(0, MAX_QUERY_CHARS);
}
/**
 * Runs a full web-search turn: search the prompt, read the top pages, and
 * fold everything into a prompt-ready brief. Failures are reported in the
 * result instead of thrown, so the answer can still be generated.
 */
export async function fetchWebSearchContext(prompt, signal, maxChars = 18_000) {
    const query = deriveSearchQuery(prompt);
    const empty = { sources: [], context: '' };
    if (!query)
        return { query, ...empty };
    let results;
    try {
        results = await searchWeb(query, signal);
    }
    catch (error) {
        if (signal?.aborted)
            return { query, ...empty };
        return {
            query,
            ...empty,
            error: error instanceof Error && error.message
                ? error.message
                : 'Web search is unavailable right now.',
        };
    }
    if (!results.length)
        return { query, ...empty };
    if (signal?.aborted)
        return { query, ...empty };
    const top = results.slice(0, MAX_SEARCH_PAGES);
    const pages = await fetchWebContext(top.map((result) => result.url), signal, maxChars);
    const digest = top
        .map((result, index) => `${index + 1}. ${result.title}\nURL: ${result.url}\nSummary: ${result.snippet}`)
        .join('\n\n');
    const header = `Web search results for "${query}" (fetched just now):\n\n${digest}`;
    const context = `${header}\n\n---\n\n${pages.context}`.slice(0, maxChars);
    const seen = new Set(pages.sources.map((source) => source.url));
    const sources = [
        ...pages.sources,
        ...top
            .filter((result) => !seen.has(result.url))
            .map((result) => ({ url: result.url, title: result.title || result.url })),
    ];
    return { query, sources, context };
}

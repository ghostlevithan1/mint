# Mint — Private AI Workspace

A responsive, chat-first AI workspace with privacy built into the conversation.
Ask anything or attach files, pick a model, and watch a streamed answer arrive with
live generation metrics — while personal identifiers are replaced on-device before
anything leaves the tab.

Answers stream from **NVIDIA NIM** when a server-side key is configured. Without a
key, the workspace falls back to a local demo engine and clearly labels those answers
as simulated. The API key is read only by the server; it is never bundled into the
browser.

## Stack

- Vite + React 18 + TypeScript
- NVIDIA NIM via the OpenAI-compatible `chat/completions` endpoint
- A small Node server (`server/index.ts`) that serves the build and proxies SSE;
  the same middleware is installed as a Vite plugin for local development
- Hand-written CSS design system (no UI framework)
- IndexedDB for chat history (gzip-compressed, local to the browser)
- Open access: no accounts, no sign-in, no invite code

## Run locally

```bash
npm install
npm run dev
```

Open the printed URL (default `http://127.0.0.1:5173`). There is no gate to
configure: the workspace is open to anyone who can reach the server.

Production build:

```bash
npm run build
npm start
```

`npm start` runs the production server on `PORT` (default `3000`; Render injects
`10000`). `npm run preview` still works for a quick static check.

## Access

There is no sign-in and no invite code. Anyone with the link can open the
workspace and start a chat.

That means the public endpoints are only as private as the URL. If you need to
lock the site down later, the smallest change is a shared code checked by
`guardApi` in `server/limits.ts`; the rate limit below is the current spending
guard.

## Rate limits

- `/api/chat`: **15 requests per minute per client IP**. This is the budget that
  keeps one visitor or script from draining the NVIDIA key.
- `/api/web` and `/api/search`: 60 requests per minute per client IP.
- `MINT_RATE_LIMIT=0` disables chat limiting for local testing.

Visitors behind the same router share one budget, so a busy household or office
may hit the limit together. Raise `MINT_RATE_LIMIT` if that becomes a problem.

Responses include `X-RateLimit-Limit` and `X-RateLimit-Remaining`; a limited
request answers `429` with `Retry-After` and a readable message.

## NVIDIA NIM setup

The server reads the key at request time. Choose one of these options:

1. Create a file named exactly `key` in the project root:

   ```
   API KEY:"nvapi-..."
   ```

2. Or add the key to `.env`:

   ```
   NVIDIA_API_KEY=nvapi-...
   ```

3. Or set `NVIDIA_API_KEY` in the shell before starting the server.

The `key` file and `.env` are git-ignored. The key is never sent to the browser,
never written to logs, and never included in an error message.

Every model belongs to a **model type**: Quick, Normal, or Intelligent. The type
sets the reasoning depth and pace; the model menu and Settings both group models by
it. Override any mapping with the generated `NVIDIA_MODEL_*` variable shown in
`.env.example`.

| Model type | App model | NVIDIA NIM model |
| --- | --- | --- |
| Quick | Nemotron 3.5 Lightning | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| Quick | Nemotron 3 Nano Omni | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` |
| Normal | Laguna XS 2.1 | `poolside/laguna-xs-2.1` |
| Normal | MiniMax M3.1 Flash | `minimaxai/minimax-m3.1-flash` |
| Normal | Muse Glimmer 30B | `meta/muse-glimmer-30b` |
| Intelligent | Mistral Large 4 | `mistralai/mistral-large-4-1t-a52b` |
| Intelligent | Nemotron 3.5 Super VL | `nvidia/nemotron-3.5-super-vl-120b-a12b` |
| Intelligent | Nemotron 3 Ultra | `nvidia/nemotron-3-ultra-550b-a55b` |
| Intelligent | DeepSeek V4.1 Flash | `deepseek-ai/deepseek-v4.1-flash` |

If an upstream model disappears (HTTP 404/410), the server retries once on the
default model and marks the answer with `X-Mint-Fallback`; the UI shows a
`FALLBACK MODEL` tag instead of failing the turn.

The composer footer shows whether the workspace is on **NVIDIA NIM · live** or
**Local demo**. Settings → About has a **Recheck** button after you add a key.
The server reads the file at runtime, so no restart is required.

Some NVIDIA Build models have very long time-to-first-token. The waiting card
counts elapsed seconds, explains that 20–30 s warm-ups happen, and reminds you
that `Esc` stops the request.

## Using the workspace

- **New chat** starts a fresh conversation; the sidebar keeps history across reloads.
- **Search chats** filters history, or press `Ctrl/Cmd + K` from anywhere.
- **Find in this chat** opens with `Ctrl/Cmd + F`, counts matches, and jumps
  between them inside the thread.
- **Rename** a chat with the pencil or by double-clicking it.
- **Delete** removes a chat immediately with an undo toast.
- **Model type** groups every model into Quick, Normal, or Intelligent.
- **Composer** accepts text and up to **10 files**, each capped at **25 MB**. Drop
  files anywhere on the conversation, use the paperclip, or paste a file or
  screenshot.
- **Image links** (https URLs ending in `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`,
  `.avif`, `.bmp`, or `.svg`) render inline for both you and the model, with a
  link to open the original. Remote image hosts see your IP address (not your
  chat) — the browser sends no cookies and no referrer.
- **Plots** — ask any model to chart something ("plot y = x^2 - 4", "graph a bar
  chart of quarterly revenue") and it answers with a fenced `plot` spec that the
  browser draws as an SVG graph, with marked points for roots and turning points.
  Line and scatter graphs use square units, like a Desmos window: one data unit is
  the same length on both axes, so shapes are never stretched. Scroll to zoom, drag
  to pan, and click a curve for exact values. Specs are
  validated and equations go through a whitelist parser, so the model never runs
  code. No server or Python is involved. Equations use the variable `x`; constants
  `pi`/`π`, `e`, `tau`/`τ`; operators `+ - * / ^` (and `**`), parentheses, and
  implicit multiplication (`2x`, `3sin(x)`, `2π`); and the functions `sin cos tan
  asin acos atan sinh cosh tanh exp log ln log2 log10 sqrt abs floor ceil min max
  pow`. Angles are in radians. Charts are `line`, `scatter`, `bar` or `histogram`.
- **Enter** sends; **Shift + Enter** adds a line; **Esc** stops generation.
- **Export all chats** (Settings → Privacy) downloads one JSON file.
- **Stop** ends a streamed answer; **Regenerate** re-runs the last response.
- **Metrics** under each answer are measured from the live SSE stream. Demo answers
  are labelled `SIMULATED`; live answers are labelled `NVIDIA NIM`.
- **Demo engine** covers a small scripted set: simple linear equations and
  arithmetic, contract/legal reviews, research summaries, email drafts, and code
  reviews.

## Privacy and storage model

- Chat history, attachments, preferences, and theme are stored **in this browser**
  (IndexedDB, gzip-compressed). They are never uploaded as history and there is no
  account or sign-in.
- If IndexedDB is unavailable or full, the workspace keeps working in memory and
  shows a banner saying chats are not being saved.
- Files are validated client-side; each file is capped at **25 MB** and the
  workspace accepts up to **10 files**.
- Names, email addresses and phone numbers are detected locally and replaced with
  placeholders such as `[PERSON_01]`, `[EMAIL_01]` and `[PHONE_01]`.
- **Inspect payload** shows the exact redacted request before it leaves the tab.
- Returned answers are rehydrated locally, so placeholders become the original
  values only inside the browser.
- A live request replays as much prior conversation as fits the selected model's
  context window, oldest turns first. The server relays it to NVIDIA NIM for the
  length of the request; it does not write prompts or answers to disk.
- The PII shield can be toggled per message from the composer or in Settings.
- The NVIDIA key lives on the server. The browser only calls `/api/chat`, and the
  server attaches the key upstream.

Redaction is heuristic (pattern + stopword based). Review the audit view before
relying on it for sensitive material.

## Security headers

The production server sets, on every response:

- `Content-Security-Policy` (default-src self, no inline scripts, data:/blob:/https:
  images, inline styles for React/KaTeX)
- `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options`
- `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`
- `X-Robots-Tag: noindex, nofollow, noarchive`

`public/robots.txt` disallows everything, and `index.html` carries a `noindex`
meta tag, so a deployed instance stays out of search engines.

## Deploy on Render

`render.yaml` describes the service. Set these environment
variables in the dashboard (they are `sync: false`, so they are never committed):

- `NVIDIA_API_KEY` — enables live inference
- `MINT_RATE_LIMIT` — defaults to `15`; keep it set, it is the only spending guard

Build with `npm ci --include=dev && npm run build`, start with `npm start`. The
health check is `/healthz`. Every endpoint is public: `/api/status` only reports
configuration, while `/api/chat`, `/api/web` and `/api/search` are limited per IP.

## Project layout

```
server/
  index.ts                   production HTTP server, static files, security headers
  limits.ts                  per-IP rate limiting for chat, web and search
  core.ts                    model mapping, upstream SSE, fallback on 404/410
  node-http.ts               /api/chat and /api/status handlers
  web.ts                     /api/web page reader and /api/search
  nvidia.ts                  Vite dev/preview proxy with the same limits
src/
  components/
    ChatApp.tsx              chat orchestration, undo, export
    Sidebar.tsx              new chat, history, rename, search, shield
    ChatView.tsx             top bar, empty state, thread, find bar, drag/drop
    Composer.tsx             text input, attachments, paste, shield, send/stop
    ChatMessage.tsx          message bubbles, markdown, metrics, waiting timer
    SettingsModal.tsx        general, privacy, storage, export, about
    PlotImage.tsx            draws the ```plot fence as an SVG graph
    PayloadModal.tsx         redacted payload audit
  hooks/
    useConversations.ts      chats, streaming, compacting, undo, storage errors
    useProviderStatus.ts     checks /api/status for live vs demo mode
    useAttachments.ts        25 MB / 10-file validation and local reading
  lib/
    chat.ts                  conversation and message types
    storage.ts               IndexedDB persistence and usage estimate
    nvidia.ts                browser-side SSE parser for /api/chat
    plotSpec.ts              plot spec validation and the safe equation parser
    web.ts                   link reading and web search client
    files.ts                 attachment kinds, reading, validation
    privacy.ts               PII detection, redaction, rehydration
    demo-engine.ts           simulated answers and intent routing
  styles/
    base.css                 tokens and shared primitives
    chat.css                 sidebar, thread, composer, responsive layout
    modal.css                settings and payload modals
public/
  robots.txt                 disallow all
  manifest.webmanifest       installable app metadata
```

## Request flow

```
Browser (redact PII) ──POST /api/chat──▶ Node server ──Bearer key──▶ NVIDIA NIM
        ▲                                (rate limit)                    │
        └────────── SSE chunks ◀─────────────────────────────────────────┘
```

`/api/status` reports whether a key is configured and which NVIDIA model IDs are
mapped. It returns no key material. `/api/chat` accepts an app model ID, not an
arbitrary upstream model, so the browser cannot repoint the proxy at another
provider.

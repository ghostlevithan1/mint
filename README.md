# Mint — Private AI Workspace

A responsive, chat-first AI workspace with privacy built into the conversation.
Ask anything or attach files, pick a model, and watch a streamed answer arrive with
live generation metrics — while personal identifiers are replaced on-device before
anything leaves the tab.

Answers stream from **NVIDIA NIM** or **OpenRouter** through server-side keys.
Without a key for a model's provider, that model shows a clear "not set up"
error. The API keys are read only by the server; they are never bundled into
the browser.

## Stack

- Vite + React 18 + TypeScript
- NVIDIA NIM and OpenRouter via the OpenAI-compatible `chat/completions` endpoint
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
`10000`). `npm run build` compiles the server to plain JavaScript
(`dist-server/index.js`) and writes Brotli and gzip copies of the app, so the
server starts on bare Node, holds the whole app in memory and never compresses
at request time. `npm run start:source` runs the TypeScript server directly
through tsx, for trying server changes without a build. `npm run preview` still
works for a quick static check.

## Access

There is no sign-in and no invite code. Anyone with the link can open the
workspace and start a chat.

That means the public endpoints are only as private as the URL. If you need to
lock the site down later, the smallest change is a shared code checked by
`guardApi` in `server/limits.ts`; the rate limit below is the current spending
guard.

## Usage limits, spam lock and bans

Mint has no accounts, so a **device** is a browser holding a signed cookie
(`mint_device`) that the server issues when the page loads. Limits, locks and bans
attach to it, so classmates on one school network do not share a budget.

| Rule | What happens |
| --- | --- |
| **Message limit** | 15 messages a minute per device (`MINT_RATE_LIMIT`; 60 web requests). Past it, sending pauses and the page counts the time left down live (`m:ss`), above the composer and on the failed message. |
| **Spam lock** | 1.5 messages a second sustained for 5 seconds (8 attempts in 5 s) locks sending until the device has stopped for 10 seconds. Attempts made while locked restart that quiet period. |
| **Network ceiling** | Clearing cookies gives a fresh device, so each network also has a ceiling of 4x the device budget (`MINT_IP_RATE_LIMIT`). A client that keeps no cookie is counted per network at the device budget. IPv6 is counted per /64, since one subscriber usually holds a whole /64. |
| **Tampering ban** | A request altered by hand (see below) bans the device for **24 hours**. The page shows the countdown, including after a reload. |

**What counts as tampering.** Only the *shape* of a request, never what is typed, so
pasting code, SQL or HTML into a question cannot get anyone banned. Clear forgeries
that a real page cannot produce ban at once: a model id that is not a plain
identifier (`"; DROP TABLE`, `<script>`), `__proto__`/`constructor` keys, an unknown
message role or content type, or an image that is a web address instead of a data
URL. Ambiguous differences (a retired model id from a stale tab, an extra field, a
parameter out of range, a `..` in a path, a blocked inline script reported by the
browser) are single strikes; three within ten minutes ban. Script reports count at
most once a minute.

**Where bans are kept.** Each ban is saved to `data/device-bans.json` (at most 5,000
records; finished bans are dropped first) (device id,
time, short signal codes, user agent, and the network as a keyed hash, never the
address or anything typed) and is also written into the banned browser's own signed
cookie, so it survives the server restarting or losing its disk, as long as
`MINT_DEVICE_SECRET` stays the same (set it; `render.yaml` generates one). The page
also remembers the countdown in local storage so Send is disabled instantly, but the
server enforces every pause on its own. Clearing cookies or using a private window
gives a new device, which is the limit of identifying browsers without accounts.

Manage them with `npm run bans` (active), `npm run bans -- --all`,
`npm run bans -- remove <id>` (lifts one; the record stays, marked lifted, which also
overrides the ban still in that browser's cookie) and `npm run bans -- clear`.
A running server notices edits within seconds. On Render's free plan the disk is
wiped on each deploy, so the file is lost, but the cookie still carries the ban.

**Who counts as one visitor (the network ceiling).** A client can write anything in
`X-Forwarded-For`, so that header is never trusted from its left end. On Render
(`RENDER=true`) the edge-set `True-Client-IP` / `CF-Connecting-IP` identify the
visitor. Elsewhere the socket address is used; behind your own proxy set
`MINT_PROXY_HOPS=n` to take the n-th entry from the right of `X-Forwarded-For`, or
`MINT_TRUST_PROXY_HEADERS=1` if that proxy sets `True-Client-IP` itself.
`MINT_RATE_LIMIT=0` turns off chat limiting and the spam lock for local testing.

Refusals answer `429` (or `403` for a ban) with `Retry-After` and a JSON body that
includes `retryAfter` (seconds) and `retryAt`, which the page counts down from.
`X-RateLimit-Limit` and `X-RateLimit-Remaining` describe the device budget.
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

## OpenRouter setup

Gemma 4 31B and MiniMax M3.1 Flash run on OpenRouter. Set the OpenRouter API key as
`OPEN_CODE_KEY` (in the Render dashboard, `.env`, or the shell; `OPENROUTER_API_KEY`
also works). Without it, those two models answer with a "needs an OpenRouter key"
error and every NVIDIA model keeps working.

Inkling 2 Small was removed. A tab opened before that still sends its id; the
server answers with the default model instead of counting it as tampering, and
old Inkling answers in saved chats keep their label.

## Models

Every model belongs to a **model type**: Quick, Normal, or Intelligent. The type
sets the reasoning depth and pace; the model menu and Settings both group models by
it. Override any mapping with the generated `NVIDIA_MODEL_*` or
`OPENROUTER_MODEL_*` variable shown in `.env.example`.

| Model type | App model | Provider | Upstream model |
| --- | --- | --- | --- |
| Quick | Nemotron 3.5 Lightning | NVIDIA NIM | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| Quick | Nemotron 3 Nano Omni | NVIDIA NIM | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` |
| Quick | Gemma 4 31B | OpenRouter | `google/gemma-4-31b-it` |
| Quick | GPT-OSS 20B | NVIDIA NIM | `openai/gpt-oss-20b` |
| Normal | Laguna XS 2.1 | NVIDIA NIM | `poolside/laguna-xs-2.1` |
| Normal | Muse Glimmer 30B | NVIDIA NIM | `meta/muse-glimmer-30b` |
| Normal | MiniMax M3.1 Flash | OpenRouter | `minimax/minimax-m3.1-flash` |
| Intelligent | Nemotron 3.5 Super VL | NVIDIA NIM | `nvidia/nemotron-3.5-super-vl-120b-a12b` |
| Intelligent | Nemotron 3 Ultra | NVIDIA NIM | `nvidia/nemotron-3-ultra-550b-a55b` |
| Intelligent | DeepSeek V4.1 Flash | NVIDIA NIM | `deepseek-ai/deepseek-v4.1-flash` |

If an upstream model disappears (HTTP 404/410), the server retries once on the
default model and marks the answer with `X-Mint-Fallback`; the UI shows a
`FALLBACK MODEL` tag instead of failing the turn.

Settings → About shows whether the server has a key, with a **Recheck** button
after you add one. The server reads `.env`, `.env.local` and `key` once and keeps
them in memory, so restart it after editing those files. Environment variables
set in the shell or on Render are read live.

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
- **Tools** — Mint is agentic: it decides on its own when to search the web, read
  a page or calculate exactly. It ends a reply with a fenced `tool` JSON block,
  the browser runs the tool (through `/api/search`, `/api/web` or the local
  calculator) and sends the result back, up to 4 steps per question. Tool
  blocks are hidden from the answer and searched sources show above it.
- **Plots** — ask any model to chart something ("plot y = x^2 - 4", "graph a bar
  chart of quarterly revenue") and it answers with a fenced `plot` spec that the
  browser draws as an SVG graph, with marked points for roots and turning points.
  Line and scatter graphs use square units, like a Desmos window: one data unit is
  the same length on both axes, so shapes are never stretched. Scroll to zoom, drag
  to pan, and click a curve for exact values. Specs are
  validated and equations go through a whitelist parser, so the model never runs
  code. No server or Python is involved. Equations use `x`, and `y` on the plane,
  `z` in a complex graph, `i` for the imaginary unit, and `n` in a sequence;
  constants `pi`/`π`, `e`, `tau`/`τ`; operators `+ - * / ^` (and `**`), parentheses,
  and implicit multiplication (`2x`, `xy`, `3sin(x)`, `2π`); and the functions
  `sin cos tan asin acos atan sinh cosh tanh exp log ln log2 log10 sqrt cbrt abs
  floor ceil round sign fract min max pow atan2 mod re im conj arg`. Angles are in
  radians. Named constants can be given in `"params"`.
  Charts are `line`, `scatter`, `bar`, `histogram`, `pie`, `cobweb`, `sequence`,
  `complex` and `fractal`:
  - **Equations in x and y**, such as `x^2 + y^2 = 1` or `y > x^2`, are traced over
    the window on screen and stay sharp when zoomed. An inequality shades the region
    where it holds (`src/lib/implicit.ts`).
  - **Iteration**: `cobweb` draws x(n+1) = f(x) as a staircase from `x0` with the
    line y = x; `sequence` plots the values at each step, or x(n) = f(n) when the
    rule uses `n` (including two-term rules such as Fibonacci with `x1`).
  - **Complex**: a `complex` chart colours the plane by f(z), showing the angle of
    f(z) as a hue and its size as brightness (zeros dark, poles white); a complex
    `f(x)` in a line chart draws its real and imaginary parts as two curves.
  - **Fractals**: `fractal` with `mode` mandelbrot, julia or newton, an `expr`, the
    Julia constant `c` and `maxIterations`. They zoom 4096×; a wheel zoom paints in
    slices so the page stays responsive (`src/lib/complexField.ts`).
  **Graph detail** (Settings → General → Graphs) sets how many points are worked out
  along each equation curve before they are joined with straight lines (20 to 2,000;
  default 600). Graphs already on screen redraw when it changes. Each graph also
  carries a plain-text reading (window, values along the curve, marked points) for
  screen readers.
- **Reading PDFs** — attach a PDF like any file. The models only take text and
  images, so Mint converts it to Markdown on your device first (headings, paragraphs,
  lists and simple tables, with `*Page n*` markers; up to 100 pages and 200,000
  characters) and sends that text. The file itself is never uploaded. Scanned PDFs
  with no selectable text, and password-protected ones, cannot be read; the model is
  told so instead. The reader is pdf.js (`pdfjs-dist`, legacy build for older
  browsers), loaded only when a PDF is attached.
- **Reading other documents** — `.docx`, `.pptx`, `.odt`, `.odp`, `.ods`, `.epub`
  and `.rtf` are converted to Markdown on your device the same way (headings, lists,
  tables, one `## Slide n` section per slide with its speaker notes, spreadsheets as
  tables). They are read straight from the file's XML with the browser's built-in
  decompression, so there is no extra library. `.xlsx` and `.csv` work as before.
  The old binary formats (`.doc`, `.ppt`, `.xls`, Apple Pages and Numbers) cannot
  be read; the model is told to ask for a `.docx`, `.pptx`, `.xlsx` or `.pdf` copy.
  Images inside documents are not read.
- **Reading code and text files** — source files in the common languages (JavaScript,
  TypeScript, Python, C/C++, C#, Java, Kotlin, Swift, Go, Rust, Ruby, PHP, Lua, R,
  Dart, Scala, shell and PowerShell, SQL, Vue, Svelte and many more), config and
  markup (JSON, YAML, TOML, INI, XML, Markdown, LaTeX, diffs), extensionless names such
  as `Dockerfile` and `Makefile`, and Jupyter notebooks (`.ipynb`: prose, code and text
  output; images are dropped) are read as text. UTF-16 files work. A file with an
  unfamiliar extension is still read if its content is text; a binary one is reported
  as such. Long files are cut at 200,000 characters, with a note saying so
  (`src/lib/sourceFiles.ts`).
- **Making PDFs** — ask for a worksheet, study guide or printable notes and the model
  answers with a fenced `pdf` spec (title, then headings, text, bullet and numbered
  lists, tables and rules). The browser lays it out and writes an A4 PDF locally
  (`src/lib/pdfWriter.ts`, built-in Helvetica, no dependency) behind a Download
  button. Text is limited to Latin letters and common punctuation; other scripts
  print as `?`.
- **Saving answers and chats** — each answer has **Export** (Markdown) and **PDF**
  buttons, and the download icon in the top bar saves the whole chat as a PDF or
  Markdown file (failed turns and context notes are left out; graphs and diagrams
  are noted by name in the PDF because the app draws them). Letters outside the
  Latin range print as `?` in PDFs, and the menu says so when a chat has any.
- **Unreadable files are flagged** — if an attached file cannot be read (a binary
  file, a damaged or scanned PDF, an old `.doc`), its chip turns amber and says
  "not readable" before you send, with the reason above the composer, instead of
  claiming it was read.
- **Enter** sends; **Shift + Enter** adds a line; **Esc** stops generation.
- **Export all chats** (Settings → Privacy) downloads one JSON file.
- **Stop** ends a streamed answer; **Regenerate** re-runs the last response.
- **Metrics** (Settings → General) under each answer are measured from the live
  SSE stream.
- **Context meter** in the top bar shows how much of the conversation is sent with
  each question. Older turns are summarised automatically near the limit, or type
  `/compact` to do it now.

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
- The same list shields the whole request, not just the new message: earlier turns,
  your profile, file names, fetched page text and the `/compact` transcript. One
  placeholder never stands for two different people, and compacted summaries keep
  the list.
- Returned answers are rehydrated locally, so placeholders become the original
  values only inside the browser.
- **Images in answers wait for a click.** Loading an image tells its site the full
  URL, and a model steered by a web page could put your text in it. Block and inline
  images show the site and a Show button; "Always show from this site" is kept on
  this device. Links you typed yourself load directly.
- The web reader checks each address when it connects (not just when it looks the
  name up), so a hostile DNS answer cannot point it at an internal address.
- A request replays as much prior conversation as fits the selected model's
  context window (capped at 96K tokens), newest turns first. The server relays it
  to that model's provider for the length of the request; it does not write
  prompts or answers to disk.
- The PII shield is on by default and can be turned off in Settings → Privacy.
- Provider keys live on the server. The browser only calls `/api/chat`, and the
  server attaches the right key upstream.
- One cookie is set: `mint_device`, a random id signed by the server (HttpOnly,
  SameSite=Lax). It carries no personal data; it exists so usage limits and bans can
  follow a browser instead of a shared network address.

**What the shield does not hide.** Topics shaped like names ("the French
Revolution", "Cold War", "New York", "Boyle's Law") are recognised as topics
(`src/lib/nonNames.ts`). Well-known historical and public figures ("Napoleon",
"Marie Curie", "Martin Luther King Jr.") reach the tutor so it can teach about them
(`src/lib/famousPeople.ts`). A figure's name is still hidden after a title or an
introduction ("Mr Newton", "my friend Charles Darwin", "my name is…"), and names many
living people share (Muhammad Ali, Dante, or Gandhi on its own) are left off the
list so they always stay hidden.

Redaction is heuristic (pattern + stopword based). Review the audit view before
relying on it for sensitive material.

## Security headers

The production server sets, on every response:

- `Content-Security-Policy` (default-src self, no inline scripts, data:/blob:/https:
  images, inline styles for React/KaTeX)
- `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options`
- `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`
- `X-Robots-Tag: noindex, nofollow, noarchive`

The CSP also has `report-uri /api/csp-report`: a blocked inline or foreign script is
reported there, and a repeat of that counts toward a tampering ban (see above).

The API only accepts JSON posts from Mint's own page. A `text/plain` post (the
kind another site can send without a CORS check), a `Sec-Fetch-Site: cross-site`
request or a foreign `Origin` is refused, so other sites cannot spend the provider
budget through their visitors' browsers. Bodies over the limit (16 KB for
`/api/web` and `/api/search`) are refused before they are read, a malformed request
path gets a 400 instead of reaching the router, and the page reader has one 12-second
deadline covering every redirect and the whole body.

HTML from the web and attached documents are parsed in linear time
(`stripHtml` in `server/web.ts`, `src/lib/xmlScan.ts`). A crafted page or file full of
unclosed tags cannot freeze the server or the tab. `tests/security.test.ts` holds
regression tests for each of these.

If you set `CRAWL4AI_URL`, run that crawler where it cannot reach private networks
or cloud metadata: it follows redirects on its own, outside Mint's address checks.

`public/robots.txt` disallows everything, and `index.html` carries a `noindex`
meta tag, so a deployed instance stays out of search engines.

## Deploy on Render

`render.yaml` describes the service. Set these environment
variables in the dashboard (they are `sync: false`, so they are never committed):

- `NVIDIA_API_KEY` — enables the NVIDIA NIM models
- `OPEN_CODE_KEY` — OpenRouter key for Gemma 4 31B and MiniMax M3.1 Flash
- `MINT_RATE_LIMIT` — messages a minute per device, default `15`; keep it set, it is
  the only spending guard
- `MINT_DEVICE_SECRET` — signs the device cookie and the bans written into it; any
  random string of 16+ characters. Keep it fixed (`render.yaml` generates one)

Build with `npm ci --include=dev && npm run build`, start with `npm start`. The
health check is `/healthz`. Every endpoint is public: `/api/status` only reports
configuration (and whether this device is banned), while `/api/chat`, `/api/web` and
`/api/search` are limited per device.

## Project layout

```
server/
  index.ts                   production HTTP server, static files, security headers
  limits.ts                  per-device limits, spam lock, network ceiling, ban checks
  device.ts                  signed device cookie (carries the ban expiry)
  bans.ts                    saved bans (data/device-bans.json), lifts and pardons
  tamper.ts                  spots hand-altered requests; strikes and 24h bans
  clock.ts                   replaceable clock, so timing rules are testable
  core.ts                    model mapping, upstream SSE, fallback on 404/410
  node-http.ts               /api/chat and /api/status handlers
  web.ts                     /api/web page reader and /api/search
  safe-fetch.ts              connect-time address checks for the page reader
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
    LimitBanner.tsx          live countdown when sending is paused (limit, spam, ban)
  hooks/
    useConversations.ts      chats, streaming, compacting, undo, storage errors
    useModalFocus.ts         focus trap, Escape and focus restore for dialogs
    usePlotDetail.ts         the graph detail setting, shared with every graph
    useBlock.ts              the current pause and its live remaining time
    useProviderStatus.ts     checks /api/status for a configured key
    useAttachments.ts        25 MB / 10-file validation and local reading
  lib/
    chat.ts                  conversation and message types
    storage.ts               IndexedDB persistence and usage estimate
    nvidia.ts                browser-side SSE parser for /api/chat
    plotSpec.ts              plot spec validation and the safe equation parser
    mathExpr.ts              the equation parser and its real and complex evaluators
    implicit.ts              marching squares: curves and shaded regions in x and y
    complexField.ts          domain colouring, Mandelbrot, Julia and Newton pictures
    pdfSpec.ts               pdf spec validation (blocks, safe file name)
    pdfWriter.ts             lays out and writes the PDF bytes in the browser
    exportChat.ts            answer and chat export (Markdown, PDF), Markdown to PDF blocks
    pdfToMarkdown.ts         reads an attached PDF with pdf.js and rebuilds it as Markdown
    sourceFiles.ts           code/text file types, notebooks, text sniffing, UTF-16
    documents.ts             ZIP reader and docx/pptx/odf/epub/rtf to Markdown converters
    web.ts                   link reading and web search client
    agent.ts                 tool call parsing, calculator and tool status
    files.ts                 attachment kinds, reading, validation
    privacy.ts               PII detection, redaction, rehydration
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
        ▲                                (rate limit)      └──────────▶ OpenRouter
        └────────── SSE chunks ◀─────────────────────────────────────────┘
```

`/api/status` reports which provider keys are configured and which model IDs are
mapped. It returns no key material. `/api/chat` accepts an app model ID, not an
arbitrary upstream model, so the browser cannot repoint the proxy at another
provider.

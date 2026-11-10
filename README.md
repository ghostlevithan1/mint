# Mint — Private AI Workspace

A responsive, chat-first AI workspace with privacy built into the conversation.
Ask anything or attach files, pick a model, and watch a streamed answer arrive with
live generation metrics — while personal identifiers are replaced on-device before
anything leaves the tab.

The conversation is the product: history, search, and the composer fill the screen.
Account, privacy, and preferences live in the sidebar and Settings modal, out of the
way until you need them.

Answers stream from **NVIDIA NIM** when a server-side key is configured. Without a
key, the workspace falls back to a local demo engine and clearly labels those answers
as simulated. The API key is read only by the server; it is never bundled into the
browser.

## Stack

- Vite + React 18 + TypeScript
- NVIDIA NIM via the OpenAI-compatible `chat/completions` endpoint
- A small Vite server plugin that proxies SSE without exposing the key
- Hand-written CSS design system (no UI framework)
- Google Identity Services for optional sign-in

## Run locally

```bash
npm install
npm run dev
```

Open the printed URL (default `http://127.0.0.1:5173`).

Production build:

```bash
npm run build
npm run preview
```

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
never written to logs, and never included in an error message. For a static
deployment, run the same proxy separately or use a server that injects
`NVIDIA_API_KEY`.

Every model belongs to a **model type**: Quick, Normal, or Intelligent. The type
sets the reasoning depth and pace; the model menu and Settings both group models by
it. Override any mapping with the generated `NVIDIA_MODEL_*` variable shown in
`.env.example` (for example `NVIDIA_MODEL_NEMOTRON_LIGHTNING`).

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

The composer footer shows whether the workspace is on **NVIDIA NIM · live** or
**Local demo**. Settings → About has a **Recheck** button after you add a key.
The server reads the file at runtime, so no restart is required.

## Using the workspace

- **New chat** starts a fresh conversation; the sidebar keeps in-memory history.
- **Search chats** filters history, or press `Ctrl/Cmd + K` from anywhere.
- **Model type** groups every model into Quick, Normal, or Intelligent. Pick a tier
  in Settings or choose a specific model from the top-bar menu; both apply to the
  next message.
- **Composer** accepts text and up to **5 files**, each capped at **25 MB**. Drop
  files anywhere on the conversation or use the paperclip.
- **Enter** sends; **Shift + Enter** adds a line.
- **Stop** ends a streamed answer; **Regenerate** re-runs the last response.
- **Settings** holds the default model, metric visibility, privacy controls, account,
  and shortcuts.
- **Metrics** under each answer are measured from the live SSE stream. Demo answers
  are labelled `SIMULATED`; live answers are labelled `NVIDIA NIM`.
- **Demo engine** covers a small scripted set: simple linear equations and
  arithmetic, contract/legal reviews, research summaries, email drafts, and code
  reviews. Anything else returns an explicit limitation notice with live-setup
  steps instead of inventing an answer.

## Google sign-in

1. Copy `.env.example` to `.env`.
2. Create an OAuth **Web application** client in Google Cloud Console.
3. Add `http://localhost:5173` (and your deployed origin) to **Authorized
   JavaScript origins**.
4. Set `VITE_GOOGLE_CLIENT_ID=...` and restart the dev server.

Without a client ID, "Continue with Google" creates an in-memory demo identity so
the flow can be reviewed offline. Account details are never persisted to storage.

## Privacy model

- Files are validated client-side; each file is capped at **25 MB** and the
  workspace accepts up to **5 files**.
- Names, email addresses and phone numbers are detected locally and replaced with
  placeholders such as `[PERSON_01]`, `[EMAIL_01]` and `[PHONE_01]`.
- **Inspect payload** shows the exact redacted request before it leaves the tab.
- Returned answers are rehydrated locally, so placeholders become the original
  values only inside the browser.
- Each live request contains the current message and the text of its attachments
  only. Earlier turns stay in the tab and are not replayed to the model.
- Chats, preferences, and account identity live in React memory for the session
  only. Reloading clears everything.
- The PII shield can be toggled per message from the composer or in Settings.
- The NVIDIA key lives on the server. The browser only calls `/api/chat`, and the
  server attaches the key upstream.

Redaction is heuristic (pattern + stopword based). Review the audit view before
relying on it for sensitive material. Redaction protects names, emails, and phone
numbers; it is not a substitute for reviewing the payload.

## Project layout

```
server/
  nvidia.ts                  key loading, model mapping, SSE proxy, status API
src/
  App.tsx                    auth host and app composition
  components/
    ChatApp.tsx              chat, settings, audit, and auth orchestration
    Sidebar.tsx              new chat, history/search, shield, account menu
    ChatView.tsx             top bar, empty state, thread, drag-and-drop
    Composer.tsx             text input, attachments, shield, send/stop
    ChatMessage.tsx          message bubbles, markdown, metrics, errors, actions
    ModelMenu.tsx            top-bar model switcher
    SettingsModal.tsx        general, privacy, account, about, provider status
    AuthModal.tsx            Google OAuth + demo fallback
    PayloadModal.tsx         redacted payload audit
  hooks/
    useConversations.ts      in-memory chats, live SSE streaming, demo fallback
    useProviderStatus.ts     checks /api/status for live vs demo mode
    useAttachments.ts        25 MB / 5-file validation and local reading
  lib/
    chat.ts                  conversation and message types
    nvidia.ts                browser-side SSE parser for /api/chat
    provider.ts              provider mode and status types
    files.ts                 attachment kinds, reading, validation
    privacy.ts               PII detection, redaction, rehydration
    demo-engine.ts           simulated answers and intent routing
  styles/
    base.css                 tokens and shared primitives
    chat.css                 sidebar, thread, composer, responsive layout
    modal.css                settings, auth, and payload modals
public/robots.txt
```

## Request flow

```
Browser (redact PII) ──POST /api/chat──▶ Vite server ──Bearer key──▶ NVIDIA NIM
        ▲                                    │
        └────────── SSE chunks ◀─────────────┘
```

`/api/status` reports whether a key is configured and which NVIDIA model IDs are
mapped. It returns no key material. `/api/chat` accepts an app model ID, not an
arbitrary upstream model, so the browser cannot repoint the proxy at another
provider.

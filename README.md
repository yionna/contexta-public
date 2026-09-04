# Contexta

Contexta is an experimental AI news sensemaking workspace presented as a small desktop environment. It turns a rolling stream of AI coverage into clustered developments, an explorable 3D relationship graph, and conversations with a cast of synthetic coworkers.

This repository contains the public demo. It is designed to make provenance and uncertainty visible: indexed coverage is a lead, not verified truth, and important claims should always be checked against the linked sources.

**Live demo:** https://contexta-yionna-4gz0.onrender.com/

> **Display note:** Contexta is best experienced on a desktop or tablet. The demo can be opened on a phone, but some desktop-style windows, navigation controls, and the 3D graph are not yet fully optimized for small screens.

## What it does

- **TL;DR newswire** — collects recent AI coverage from GDELT, Bing News, and selected publisher feeds, then normalizes and deduplicates it.
- **Semantic organization** — uses Qwen through Cloudflare Workers AI to assign validated categories, event labels, actors, technologies, concerns, affected groups, and policy issues.
- **Connections** — renders current developments as an interactive 3D network with inspectable, evidence-linked relationship reasons.
- **Chat** — supports topic rooms, direct messages, quoted replies, staged story sharing, and sequential responses from distinct synthetic coworkers.
- **Source-aware briefings** — performs guarded article extraction and fallback research while stating when only headline-level evidence is available.
- **Desktop interface** — includes movable and resizable windows, a taskbar, three themes, a local profile, interface feedback sounds, and a draggable pixel cat.

## Demo status

Contexta is a portfolio/demo project, not a production news service. It currently uses browser-local persistence and a small Node server with in-memory caches and rate limits. There are no user accounts, shared databases, durable chat history, or editorial verification workflows.

Model-generated categories, summaries, highlights, and graph relationships can be wrong. The graph represents semantic overlap, not causation.

## Stack

| Layer | Technology |
| --- | --- |
| Client | React 19, TypeScript, Vite |
| Interface | CSS, Lucide icons, desktop-style window system |
| Graph | Three.js via `react-force-graph-3d` |
| Server | Node.js HTTP server |
| AI | Cloudflare Workers AI, Qwen generation and embeddings |
| News discovery | GDELT, Bing News RSS, selected direct RSS feeds |
| Persistence | Browser `localStorage` and process-memory caches |

## Architecture

```text
public news indexes and publisher feeds
                  │
                  ▼
 normalize URLs · deduplicate · recover publisher links
                  │
                  ▼
 Qwen annotation · schema validation · event clustering
                  │
          ┌───────┴────────┐
          ▼                ▼
   TL;DR newswire     3D Connections
          │                │
          └───────┬────────┘
                  ▼
 staged story share · safe article extraction · live fallback research
                  │
                  ▼
     Lil Bot briefing · interest-based coworker conversation
```

Provider credentials remain on the server. Retrieved pages are treated as untrusted input, and model output is normalized before reaching the interface.

## Local setup

### Requirements

- Node.js 20.19+ or a compatible newer release
- npm
- A Cloudflare account with Workers AI access

### Install

```bash
git clone https://github.com/yionna/contexta.git
cd contexta
npm ci
cp .env.example .env.local
```

Replace the placeholder values in `.env.local` with a dedicated Cloudflare account ID and Workers AI token. Never place secrets in `VITE_*` variables or commit `.env.local`.

Run the API and client in separate terminals:

```bash
npm run dev:ai
```

```bash
npm run dev
```

The Vite development server proxies `/api` to the Node server configured on port `8787` by default.

## Configuration

The safe template in `.env.example` documents all supported variables. The important settings are:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_AI_API_TOKEN`
- `AI_API_BASE_URL`
- `AI_GENERATION_MODEL`
- `AI_EMBEDDING_MODEL`
- AI and external-request quota limits
- `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_ALLOWED_HOSTNAMES`, and `SESSION_SECRET` for public deployment

The server validates required values and refuses placeholder credentials.

## Available commands

```bash
npm run dev                    # Vite client
npm run dev:ai                 # API server with file watching
npm run start:ai               # API server without file watching
npm run build                  # TypeScript and production build
npm run lint                   # ESLint
npm run test:persona-routing   # conversation-routing regressions
npm run test:article           # article-fetch and SSRF protections
npm run test:security          # sessions, rate limits, and response headers
npm run test:news              # news-source contract tests
```

## Free deployment on Render

The included [`render.yaml`](render.yaml) deploys the client and API together as one Render Web Service. The production server reads Render's `PORT`, binds to `0.0.0.0`, serves the built Vite assets, and returns `index.html` for client-side routes.

1. Create a Cloudflare Turnstile widget and allow the final `*.onrender.com` hostname (plus any custom domain).
2. In Render, create a Blueprint from this repository.
3. Supply the prompted Cloudflare account, Workers AI, and Turnstile values. Set `TURNSTILE_ALLOWED_HOSTNAMES` to an exact comma-separated hostname list without protocols or paths.
4. Let Render generate `SESSION_SECRET`; never expose it or `TURNSTILE_SECRET_KEY` to the browser.
5. Deploy, then confirm `/api/ai/health` and complete the browser challenge before exercising live AI.

Render sets `NODE_ENV=production`, which makes Turnstile protection mandatory. Production startup fails closed when its site key, secret key, hostname allowlist, or 32-character session secret is absent. Local development remains ungated unless `DEMO_AUTH_REQUIRED=true` is set explicitly.

## Repository map

```text
src/App.tsx             desktop shell and product interfaces
src/App.css             layout, themes, responsive behavior, and visual system
src/data.ts             coworker definitions and shared data types
src/lib/ai.ts           typed browser-to-server API client
server/index.mjs        routes, validation, rate limits, and orchestration
server/news.mjs         news discovery, normalization, and deduplication
server/semantic.mjs     semantic annotation validation and clustering
server/article.mjs      bounded article extraction and URL safety
server/prompts.mjs      grounded assistant and coworker behavior
server/ai.mjs           Cloudflare Workers AI adapter
```

## Security boundaries

- Provider secrets are server-only and ignored by Git.
- Every route that can initiate external work is rate-limited before that work begins; AI usage has a separate tighter quota.
- Public AI routes require a server-validated Turnstile challenge and a signed, short-lived, HttpOnly session cookie.
- Article retrieval rejects private, loopback, link-local, special-use, credential-bearing, and unsupported destinations, revalidates redirects, and pins each connection to the public DNS result that was checked.
- Provider error bodies and tokens are not returned to the browser.
- Production responses include CSP, HSTS, referrer, permissions, content-type, frame, and cross-origin isolation headers.
- The current in-memory limiter is suitable for a single-instance public demo. Multi-instance deployment needs a shared persistent limiter and durable session strategy.

## Development history

See [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) for the consolidated implementation history and known follow-up work.

## Media attribution

Background tracks are bundled locally. Creator credits and original source pages are recorded in [src/assets/music/LICENSE.md](src/assets/music/LICENSE.md). The music files are not fetched from third-party hosts at runtime.

Project artwork provenance is recorded in [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md), and third-party terms are summarized in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Contexta is public for portfolio review but is **source-available, not open source**. The code, visual design, characters, prompts, documentation, and original assets may not be copied, modified, redistributed, publicly hosted, or commercially used except as permitted by [LICENSE.md](LICENSE.md) or with prior written permission.

Third-party packages and media retain their own licenses and are excluded from the Contexta license grant. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Security issues should be reported privately as described in [SECURITY.md](SECURITY.md).

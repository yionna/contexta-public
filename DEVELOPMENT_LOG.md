# Contexta development log

This log consolidates the implementation notes produced while building the public demo. It records shipped behavior, significant corrections, and honest boundaries rather than reproducing every intermediate plan.

## 2026-08-28 — Project initialization

- Bootstrapped the project with Vite, React, and TypeScript, including the initial lint, build, and development configuration.
- Reworked the first governance-dashboard concept into Contexta's soft-Y2K desktop interface, with app windows for the Newswire, Chatrooms, Ask Bot, Reports, Sources, and Preferences.
- Added an interactive fixture-driven prototype: sortable and searchable stories, reactions, saved/report selections, story sharing, deterministic local persona replies, onboarding, and browser-local UI state.
- Added seeded story, source, region, and persona data while clearly keeping live ingestion, authentication, databases, and model calls outside this prototype milestone.
- Added a server-only environment-variable template and ignore rules so future provider credentials and local data would not be committed or exposed through Vite variables.
- Fixed local development package compatibility, then refined the responsive layout, onboarding, source presentation, visual hierarchy, and overall styling.
- Saved the supporting product/technical research and added an implementation guide documenting shipped behavior, security assumptions, accessibility notes, validation, and next steps.

## 2026-08-30 — Product and provider research

- Defined Contexta as an AI-news sensemaking workspace rather than a generic feed reader or chatbot.
- Established provenance, source inspection, temporal context, and uncertainty as core product requirements.
- Researched news ingestion, semantic retrieval, knowledge-graph interfaces, persona consistency, prompt-injection defense, and URL safety.
- Selected Cloudflare Workers AI with Qwen as the demo provider because it supports both generation and embeddings behind a recurring free allocation.
- Chose a server-only credential boundary and rejected browser-exposed provider tokens.

## 2026-08-31 — Working full-stack AI prototype

- Connected the React client to a Node API and Cloudflare-hosted Qwen models.
- Added grounded Ask, persona-response, embedding, and report-generation paths.
- Implemented rolling 30-day news discovery, normalization, deduplication, 15-minute caching, and graceful source fallback.
- Added live research for timely questions and a compact historical AI-landmark context.
- Repaired Qwen empty/truncated response handling while ensuring hidden reasoning is never exposed.
- Added server validation, bounded inputs and outputs, timeouts, rate limits, safe errors, and strict Cloudflare endpoint checks.
- Built the first desktop interaction system with focus ordering, movable/resizable windows, taskbar restoration, responsive behavior, themes, profile state, Chat, Reports, Notes, Sources, and the ambient cat.

## 2026-09-01 — Semantic news and evidence-linked Connections

- Reworked TL;DR around clustered developments instead of isolated URLs.
- Added validated semantic fields for category, event identity, actors, technologies, concerns, affected groups, domains, policy issues, tension, and temperature.
- Replaced keyword-based highlighting with exact model-selected headline spans and a sparse editorial display budget.
- Added topic grouping, expansion, full source URLs, saved items, sharing, loading states, and honest error states without fixture-news fallback.
- Replaced the static relationship view with an interactive Three.js force graph.
- Added category filtering, isolated-node controls, node hiding, fit/reset actions, stable selection, dragging and pinning, and inspectable edge reasons.
- Required meaningful structured overlap before creating an edge; broad similarity such as “AI” alone does not create a relationship.

## 2026-09-01 — Conversation continuity and persona behavior

- Reframed the cast as distinct synthetic coworkers rather than interchangeable analyst styles.
- Added Mika, Ren, Sora, Jules, and Lil Bot with authored interests, beliefs, blind spots, formative incidents, verbal habits, and relationship context.
- Implemented direct mentions, natural address, interest-based participant selection, sequential multi-person generation, peer replies, and private `PASS` routing.
- Added messenger-style quoted replies and preserved speaker/reply metadata in recent context.
- Kept immediate unmentioned follow-ups with the last speaker and routed explicit summary requests toward Lil Bot.
- Added repetition, transcript-copy, user-echo, leaked-label, and mistaken-premise guards with targeted retries and safe fallbacks.
- Added social-repair handling so comments about tone or silence stay in the current interpersonal moment rather than restarting a news summary.

## 2026-09-01 — Article briefings, source recovery, and profiles

- Changed story sharing into a read-and-react workflow with a user-authored message as the starting point.
- Added bounded server-side article extraction with protocol, port, DNS, redirect, byte, timeout, title-relevance, and private-network checks.
- Added title-specific fallback research when the original publisher page is blocked, paywalled, or script-rendered.
- Required Lil Bot to distinguish full-text evidence from headline-level evidence.
- Added compact coworker profile cards and direct-message entry points.
- Made full source URLs and relationship evidence accessible from Connections.
- Added regression tests for persona routing, article retrieval safety, and publisher-link news behavior.

## 2026-09-02 — Desktop polish, audio, and cat state

- Expanded After Midnight into a complete application-wide dark theme.
- Unified the local user name and avatar across Chat, the profile popover, and Preferences.
- Refined coworker cards to separate in-character bios from user-facing notes.
- Added a separate synthesized interface click using the Web Audio API.
- Rebuilt the desktop cat as a draggable state machine with idle, playful, eating, sleeping, startled, angry, butterfly, and sunglasses states.
- Added local persistence for appearance, profile, audio mute, and cat position.

## 2026-09-03 — Demo interaction refinements

- Added topic multi-select plus strict time-order and grouped-topic TL;DR modes.
- Changed sharing to a staged composer attachment so users can add a comment, send without one, or remove it before posting.
- Added human-like reading delays for the human personas while keeping Lil Bot immediate.
- Made new user input cancel unfinished generation so the conversation can recalculate around the latest turn.
- Simplified coworker profiles and the cat’s hover controls.
- Replaced the cat sprite sheet with a padded eight-state atlas to prevent neighboring-frame bleed.
- Refined the Cat House into a supporter scene with Substack, GitHub, and Buy Me a Coffee links contained inside the doorway.
- Replaced the default Vite favicon with the Contexta pixel-device artwork.
- Added independent persisted Preferences sliders for system response sounds and media volume, defaulting to 92% and 7% respectively.

## 2026-09-04 — Public-demo deployment hardening

- Added a Render Blueprint and made the production server read `PORT`, bind publicly, serve the built Vite assets, and support client-side routes.
- Put rate limits in front of every route that can trigger news, article, Turnstile, or model-provider requests, with a separate tighter AI quota.
- Added a production-required Cloudflare Turnstile gate backed by server validation and signed, short-lived, HttpOnly session cookies.
- Hardened article retrieval against DNS rebinding by validating all resolved addresses and pinning each outbound connection to the checked public address, including after redirects.
- Added CSP, HSTS, referrer, permissions, content-type, frame, and cross-origin response policies plus regression coverage for network filtering, sessions, quotas, and headers.

## Current demo boundaries

- Browser state is local and does not sync across devices.
- News, semantic, and article caches live in one server process.
- Indexed or extractable coverage is not automatically credible or independent.
- Semantic annotation and connection edges are model-assisted and can be imperfect.
- The 3D graph and bundled music make the initial client bundle relatively large.
- The embedding adapter exists, but the demo does not use a production vector database.
- A public multi-user deployment still needs authentication, durable storage, shared rate limiting, and operational monitoring.

## Suggested next steps

1. Split the large client module into feature-level components.
2. Lazy-load the 3D graph and move large media files behind an asset delivery layer.
3. Add durable development, annotation, graph, and conversation storage with user-owned deletion controls.
4. Render citations beside the specific generated message they support.
5. Add labelled evaluation sets for event clustering, source recovery, conversation continuity, and persona behavior.
6. Add authentication, shared quotas, provenance records, and deployment-grade monitoring before opening AI endpoints to public traffic.

# Neural Map — Vorinthex Console, Universe & Chat Architecture

> Internal engineering plan. This is the single source of truth for building:
> 1. An MFA-gated `/console` application shell.
> 2. A Claude-style chat interface with a floating "island" composer and a header toggle between **Chat** and **Universe** modes.
> 3. A Three.js-powered, infinitely-zoomable 3D "Universe" that visualizes an ArangoDB graph, streamed in viewport/zoom-tier chunks.
>
> This document assumes zero prior context. Read it top to bottom before writing code. It is intentionally exhaustive — every subsystem below includes rationale, data contracts, failure modes, and concrete file paths inside this repository.

**Status:** Planning document (no code has been written against this plan yet).
**Repo:** `vorinthex/web` — Next.js 16.2.9 (App Router), React 19.2.4, Tailwind v4, TanStack Query v5, Radix UI, Zod v4, a cross-platform (`web`/`mobile`) shared component library at `src/shared/packages/ui`, and an existing Axios client (`src/shared/lib/api-client.ts`) that talks to an external backend at `/api/v1` over cookie-based credentials.
**Backend:** A separate service (not Next.js API routes) fronts ArangoDB and issues the session cookie the Axios client already relies on (`withCredentials: true`, optional `x-vorinthex-api-key`). This plan treats that backend as the graph/auth/chat compute tier and Next.js as the presentation + BFF-lite tier.
**Author's note on scope:** "Don't worry too much about the API layer" was the brief. This plan still specifies API *contracts* (shapes, endpoints, pagination semantics) because the frontend architecture (chunk loading, cache keys, LOD tiers) is meaningless without them — but it does not prescribe the backend's internal implementation, ORM, or ArangoDB driver choice beyond AQL query shapes.

---

## Table of Contents

0. [Reading Guide & Non-Goals](#0-reading-guide--non-goals)
1. [Product Vision](#1-product-vision)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Next.js 16 Facts That Change This Plan](#3-nextjs-16-facts-that-change-this-plan)
4. [Authentication, MFA & the `/console` Gate](#4-authentication-mfa--the-console-gate)
5. [Route Map & File Structure for `/console`](#5-route-map--file-structure-for-console)
6. [The Console Shell: Header, Mode Toggle, Floating Island](#6-the-console-shell-header-mode-toggle-floating-island)
7. [Chat Interface Deep Dive](#7-chat-interface-deep-dive)
8. [The Universe: Product Behavior Spec](#8-the-universe-product-behavior-spec)
9. [Three.js Engineering Deep Dive](#9-threejs-engineering-deep-dive)
10. [ArangoDB Graph Model & Query Layer](#10-arangodb-graph-model--query-layer)
11. [Chunk Streaming Protocol (Frontend ⟷ Backend Contract)](#11-chunk-streaming-protocol-frontend--backend-contract)
12. [State Management Architecture](#12-state-management-architecture)
13. [Performance Budgets & Benchmarks](#13-performance-budgets--benchmarks)
14. [Accessibility & Degraded-Mode Strategy](#14-accessibility--degraded-mode-strategy)
15. [Security & Abuse Considerations](#15-security--abuse-considerations)
16. [Testing Strategy](#16-testing-strategy)
17. [Component API Sketches (TypeScript)](#17-component-api-sketches-typescript)
18. [Build Roadmap](#18-build-roadmap)
19. [Risk Register](#19-risk-register)
20. [Decision Log (Architecture Decision Records)](#20-decision-log-architecture-decision-records)
21. [Data Model Reference (Consolidated)](#21-data-model-reference-consolidated)
22. [Error, Empty & Loading State Catalog](#22-error-empty--loading-state-catalog)
23. [Design Tokens & Visual System (Console)](#23-design-tokens--visual-system-console)
24. [Open Questions for the Backend/Product Team](#24-open-questions-for-the-backendproduct-team)
25. [Observability](#25-observability)
26. [Local Development & Environment Setup](#26-local-development--environment-setup)
27. [Rollout & Feature Flagging](#27-rollout--feature-flagging)
28. [Cross-Platform / Mobile Considerations](#28-cross-platform--mobile-considerations)
29. [Internationalization & Content Considerations](#29-internationalization--content-considerations)
30. [Rendering Code Appendix: Shaders & Materials](#30-rendering-code-appendix-shaders--materials)
31. [Camera Controller: Reference Implementation Sketch](#31-camera-controller-reference-implementation-sketch)
32. [Synthetic Seed Data Generator (Dev/Test Tooling)](#32-synthetic-seed-data-generator-devtest-tooling)
33. [Full Reference Component Implementations](#33-full-reference-component-implementations)
34. [TanStack Query Hooks: Full Implementations](#34-tanstack-query-hooks-full-implementations)
35. [AQL Query Cookbook (Additional Queries)](#35-aql-query-cookbook-additional-queries)
36. [Worked Walkthrough: One User Session, End to End](#36-worked-walkthrough-one-user-session-end-to-end)
37. [Web Worker Reference Implementations](#37-web-worker-reference-implementations)
38. [Backend LOD Pyramid Build Job (Pseudocode)](#38-backend-lod-pyramid-build-job-pseudocode)
39. [Console Shell: Reference Stylesheet](#39-console-shell-reference-stylesheet)
40. [API Response & Error Contract Reference](#40-api-response--error-contract-reference)
41. [Rate Limiting & Quota Reference](#41-rate-limiting--quota-reference)
42. [Glossary](#42-glossary)
43. [Research Sources](#43-research-sources)
44. [Alternatives Considered (Extended Comparison Matrices)](#44-alternatives-considered-extended-comparison-matrices)
45. [Backend API Reference (OpenAPI-Style)](#45-backend-api-reference-openapi-style)
46. [Database Migration Reference (Collection & Index Setup)](#46-database-migration-reference-collection--index-setup)
47. [Local Mock Backend (Dev Tooling Reference)](#47-local-mock-backend-dev-tooling-reference)
48. [Frequently Anticipated Questions](#48-frequently-anticipated-questions)
49. [Definition of Done — Per Phase](#49-definition-of-done--per-phase)
50. [Required Build Configuration Changes](#50-required-build-configuration-changes)
51. [UI Copy Reference](#51-ui-copy-reference)
52. [Keyboard Shortcuts Reference](#52-keyboard-shortcuts-reference)
53. [Browser & Device Support Matrix](#53-browser--device-support-matrix)
54. [Performance Regression Runbook](#54-performance-regression-runbook)
55. [Content Security Policy & Security Headers](#55-content-security-policy--security-headers)
56. [First-Run Onboarding](#56-first-run-onboarding)
57. [Product Analytics Event Taxonomy](#57-product-analytics-event-taxonomy)
58. [Executive Summary for Non-Technical Stakeholders](#58-executive-summary-for-non-technical-stakeholders)
59. [New File Manifest](#59-new-file-manifest)
60. [Consolidated Tunable Constants Reference](#60-consolidated-tunable-constants-reference)
61. [Manual QA Script](#61-manual-qa-script)
62. [Cost & Capacity Planning Considerations](#62-cost--capacity-planning-considerations)
63. [Feature Parity Checklist vs. Claude.ai (Chat Mode)](#63-feature-parity-checklist-vs-claudeai-chat-mode)
64. [Failure Mode & Chaos Scenarios](#64-failure-mode--chaos-scenarios)
65. [Protocol Versioning Strategy](#65-protocol-versioning-strategy)
66. [Analogous Systems Reference](#66-analogous-systems-reference)
67. [Terminology Cheat Sheet (Frontend ⟷ Backend Alignment)](#67-terminology-cheat-sheet-frontend--backend-alignment)
68. [Sequence Diagrams](#68-sequence-diagrams)
69. [Change History of This Document](#69-change-history-of-this-document)
70. [Common Pitfalls Checklist (Pre-PR Review)](#70-common-pitfalls-checklist-pre-pr-review)
71. [Post-Launch Success Metrics](#71-post-launch-success-metrics)
72. [Assumptions Register](#72-assumptions-register)
73. [How to Propose a Change to This Plan](#73-how-to-propose-a-change-to-this-plan)
74. [Consolidated Pre-Launch Checklist](#74-consolidated-pre-launch-checklist)
75. [One-Page Quick Reference](#75-one-page-quick-reference)

---

## 0. Reading Guide & Non-Goals

This document plans a large, ambitious surface. To keep it usable:

- **Section 9** (Three.js) and **Section 10** (ArangoDB) are the technically hardest and longest sections — they are where "every single angle" is covered: precision, memory, query cost, worker threads, GPU picking, cluster pre-computation.
- **Section 7** (Chat) is the second-most detailed section because it must feel indistinguishable from Claude.ai in responsiveness.
- Every code block is illustrative TypeScript/AQL meant to pin down *shapes and contracts*, not a literal diff to paste in. Treat identifiers as the plan's vocabulary — reuse them when implementing so future contributors can grep this file and find the matching code.
- **Non-goals:** this plan does not pick a specific auth vendor (Clerk/Auth0/etc.) vs. a fully custom MFA backend — the repo already has a bespoke `TotpSetup` component and a bespoke Axios client talking to a proprietary backend, which strongly implies **custom session + TOTP MFA**, not a third-party auth SaaS. The plan is written against that assumption. If a vendor is introduced later, only Section 4 needs revision.
- **Non-goal:** exact backend language/framework. AQL and REST/SSE contracts are specified; whether the backend is Node, Go, Rust, or Python is irrelevant to the frontend plan.

---

## 1. Product Vision

### 1.1 The pitch, restated precisely

After a user signs up, verifies their email, and completes MFA (TOTP) verification, they land inside an authenticated application namespaced under **`/console`**. The first screen is **`/console/home`**.

Inside `/console`, the primary surface has **two mutually exclusive visual modes**, toggled by a single icon button in the header:

| Mode | What's rendered | Header icon shown | Icon meaning |
|---|---|---|---|
| **Chat** | Claude-style conversation UI with a floating "island" text composer | 🌐 Globe | "Click to go to the Universe" |
| **Universe** | Full-viewport Three.js 3D graph, infinitely zoomable, backed by ArangoDB | 💬 Chat bubble | "Click to go back to Chat" |

This is the critical UX rule to internalize: **the icon shown is the destination, not the current state.** When you're looking at the chat, you see a globe (inviting you to the universe). When you're looking at the universe, you see a chat bubble (inviting you back to chat). This matches how Claude.ai's model picker and similar "mode switch" affordances work — the icon is always an invitation, never a status indicator. A tiny animated state (color fill / pulse) can optionally reflect "the other mode has new activity" (e.g., a background agent finished, or new nodes were added to the universe) — see §7.9 and §8.6.

### 1.2 The "Universe" metaphor, concretized

The user's ArangoDB graph (documents = nodes, edges = relationships) is rendered as a 3D "universe": at maximum zoom-out, the whole graph is a soft field of light (think: a galaxy viewed from far away — clusters of stars, not individual stars). As the user zooms in (scroll / pinch / drag), clusters resolve into sub-clusters, which resolve into individual nodes, which resolve into labeled entities with visible edges, which (at max zoom) resolve into an inspectable detail card.

Crucially: **"zoom to infinity until there are no more nodes"** means the zoom is not bounded by a fixed camera-distance min/max — it is bounded by *data*. The zoom keeps working (visually, smoothly) past the point where all currently-loaded nodes are behind the camera; the system's job is to always have "the next chunk" ready before the user gets there, and to gracefully bottom out with a "you've reached the edge of the known universe" empty state when a genuine leaf/empty region is reached, rather than the zoom simply stopping or clipping.

This has one non-negotiable engineering consequence, expanded fully in §9.2: **you cannot implement "zoom to infinity" with a single naive perspective camera and raw scene-graph coordinates.** Floating-point precision and camera near/far plane ratios break down. This plan uses a **floating-origin + logarithmic scale-tier** architecture (detailed below) — this is the single most important technical decision in the document.

### 1.3 Design tone

Per `src/shared/brand/DESIGN_SYSTEM.md` (existing), Vorinthex's marketing site uses a warm, editorial serif (Fraunces) aesthetic on a cream background (`#FAF7F2`). The console is a **different register**: dark, focused, "control room" — closer to a flight deck or Claude.ai's dark mode than the marketing site. This plan recommends the console ship with its own theme tokens (see §6.1) layered on top of the existing shared UI package rather than reusing the marketing theme wholesale, while still pulling shared primitives (buttons, dialogs, tooltips) from `src/shared/packages/ui`.

---

## 2. High-Level Architecture

### 2.1 System diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Browser (Client)                                │
│                                                                                │
│  ┌────────────────────────────┐    ┌──────────────────────────────────────┐  │
│  │   /console (Next.js App)   │    │        Web Workers (off-main-thread)  │  │
│  │                             │    │                                      │  │
│  │  Chat mode  ⟷  Universe    │    │  • layout.worker.ts (force-sim tick)  │  │
│  │     mode (toggle)          │    │  • decode.worker.ts (binary chunk     │  │
│  │                             │    │     parsing, off main thread)         │  │
│  │  React 19 + R3F + Zustand   │    │  • cluster.worker.ts (client-side     │  │
│  │  + TanStack Query           │    │     re-bucketing on camera move)      │  │
│  └───────────┬────────────────┘    └──────────────────────────────────────┘  │
│              │ fetch / SSE / WebSocket                                       │
└──────────────┼─────────────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     Next.js Server (Vercel, Fluid Compute)                    │
│                                                                                │
│  • app/console/**  (Server Components: shell chrome, auth gate)               │
│  • proxy.ts          (optimistic MFA/session check — NOT "middleware.ts")     │
│  • app/api/chat/route.ts          (thin proxy → backend chat stream)          │
│  • app/api/universe/tiles/route.ts (thin proxy → backend tile endpoint)       │
│  • DAL: src/server/dal/*.ts (verifySession, cache()-memoized per request)     │
└───────────────┬───────────────────────────────────────────────────────────────┘
                │ REST + SSE/WebSocket (cookie-authenticated, x-vorinthex-api-key)
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Vorinthex Backend Service                             │
│                                                                                │
│  • Auth & MFA: signup, login, TOTP enrol/verify, session issuance             │
│  • Chat orchestration: LLM calls (via AI Gateway or direct provider),         │
│      streams UIMessage chunks back over SSE                                  │
│  • Universe API: tile endpoint, node detail endpoint, mutation endpoints,     │
│      realtime change feed (websocket)                                        │
│  • Precomputation jobs: LOD cluster tree builder (see §10.5), embeddings,     │
│      search index                                                             │
└───────────────┬───────────────────────────────────────────────────────────────┘
                │ AQL over ArangoDB driver (arangojs or native HTTP API)
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              ArangoDB Cluster                                │
│                                                                                │
│  • `nodes` (document collection) — universe entities                         │
│  • `edges` (edge collection) — relationships                                 │
│  • `node_clusters_L{0..N}` (materialized LOD tiers — see §10.5)               │
│  • `sessions`, `users`, `mfa_factors` (auth)                                  │
│  • `chat_threads`, `chat_messages` (chat persistence)                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Why Next.js is a thin proxy for chat/universe data, not the source of truth

Two reasons this matters for the plan:

1. **The existing `api-client.ts` already assumes a separate backend.** It sets `withCredentials: true` and points at `NEXT_PUBLIC_API_BASE_URL` / `API_BASE_URL`, with an optional shared-secret header (`x-vorinthex-api-key`). This is a strong signal the intended architecture is Next.js-as-frontend, not Next.js-as-monolith. This plan does not fight that; it embraces it.
2. **ArangoDB graph traversal and LOD cluster maintenance are compute- and memory-heavy background jobs** (see §10.5) that don't belong inside a Vercel Function's request/response lifecycle. They belong in a long-running backend process (or Vercel Queues, if the backend itself is later moved onto Vercel — see §2.4).

Next.js's job is therefore:
- Render the authenticated shell (server components, fast TTFB, SEO-irrelevant here since `/console` is behind auth).
- Provide `app/api/*` **route handlers** that act as a thin, same-origin proxy to the backend — this avoids CORS, lets the httpOnly session cookie flow naturally, and lets us inject the `x-vorinthex-api-key` server-side (never exposed to the browser).
- Own all camera/rendering/interaction logic client-side (this cannot live on the server — WebGL is a browser API).

### 2.3 Why a proxy route handler instead of calling the backend directly from the browser

Calling `API_BASE_URL` directly from the browser (as `api-client.ts` currently does for the marketing site's waitlist form) is fine for public, unauthenticated, low-frequency writes. It is the wrong shape for the universe tile stream and chat stream because:

- The tile endpoint will be called **very frequently** (every camera-zoom-tier crossing) — same-origin route handlers let us add Next.js-level caching/coalescing (`use cache` / Cache Components, see §3.5) in front of the backend without CORS headaches.
- The chat stream needs the AI SDK v6 `UIMessageStreamResponse` framing; centralizing that translation in one `app/api/chat/route.ts` means the client only ever speaks one protocol (`useChat`'s), regardless of what the backend returns.
- Keeps `x-vorinthex-api-key` server-only.

If backend latency/hop overhead becomes a measured problem later, this can be revisited (e.g. direct browser→backend on a subdomain with proper CORS) — but start with the proxy.

### 2.4 Vercel platform notes relevant to this build

- Default runtime for `app/api/*` route handlers should be **Fluid Compute** (Node.js runtime), not Edge — the chat stream proxy and tile proxy both need full Node APIs (streaming fetch, potentially `ws` for the realtime change feed) and Fluid Compute's instance reuse minimizes cold starts on a feature used constantly once a user is in `/console`. Do not reach for Edge Functions here.
- If the backend itself is hosted off-Vercel (its own VM/box), that's fine — the Next.js proxy just needs its base URL. If it's ever migrated onto Vercel, prefer the **AI Gateway** for the chat LLM calls (unified provider access, automatic fallback) rather than binding to one provider SDK directly.
- **Vercel Queues** (public beta) is a good fit for the backend's LOD-cluster-rebuild job (see §10.5.4) if that backend is/becomes a Vercel-hosted service — durable, at-least-once, decoupled from the request path. Not required for v1; flagged for later.
- Default function timeout is 300s on current Vercel — comfortably enough for long chat generations, irrelevant for tile fetches (which must be <200ms, see §13).

---

## 3. Next.js 16 Facts That Change This Plan

This app pins `next@16.2.9`. Several APIs changed name/shape since Next 14/15, which is what most LLM training data (and most tutorials as of authoring) still describes. These are **verified against `node_modules/next/dist/docs` in this repo**, not memory:

### 3.1 `middleware.ts` is gone — it's `proxy.ts` now

> **Next.js 16 note:** "Starting with Next.js 16, Middleware is now called Proxy to better reflect its purpose. The functionality remains the same." (`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`)

Practical implications for this plan:
- The optimistic auth/MFA gate for `/console/*` lives in **`proxy.ts`** at the project root (next to `src/` — actually inside `src/` here since this repo uses the `src/` folder convention: `src/proxy.ts`), not `middleware.ts`.
- Exported function name is `proxy` (default or named export), not `middleware`.
- `export const config = { matcher: [...] }` is unchanged in shape.
- Still Node.js runtime by default in this version (no Edge-only constraint) — meaning our proxy **can** import the same session-decryption code used elsewhere in the backend-facing DAL, and can use full Node crypto if needed. Do not reach for `experimental-edge` runtime here.
- Per Next's own auth guide: Proxy should only do **optimistic** cookie-presence/shape checks (fast, no DB/backend round-trip) since it runs on every request including prefetches. The **authoritative** MFA-complete check happens in the DAL (`verifySession()`), called from the `/console` layout/page, which can safely call the backend.

### 3.2 `unauthorized.tsx` / `unauthorized()` (experimental, stable enough to use deliberately)

`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/unauthorized.md` confirms the `unauthorized()` function (from `next/navigation`) + `app/unauthorized.tsx` special file, introduced in `v15.1.0` and present in this codebase's Next version. This gives a first-class way to render a 401 UI (distinct from `not-found.tsx`'s 404) without hand-rolling a redirect-based approach for every protected segment.

This plan uses it as follows:
- `app/console/unauthorized.tsx` — rendered when a signed-in-but-MFA-incomplete (or fully signed-out) user's server-side `verifySession()` call throws/returns unauthenticated **while already inside `/console`** (e.g., session expired mid-session). Shows a "Session expired — verify to continue" screen with a direct re-verify action, not a hard redirect, preserving the user's in-progress chat draft in `sessionStorage` (see §7.10).
- The **initial** unauthenticated→login redirect (before ever reaching `/console`) is still handled by `proxy.ts` optimistic redirect to `/login`, since that's the cheap, common case. `unauthorized()` is reserved for the "went stale while already in the app" case, where a graceful in-place UI beats a jarring redirect.

### 3.3 Route Groups — unchanged, used heavily here

Standard `(folderName)` route-group convention (`node_modules/next/dist/docs/.../route-groups.md`) is used to give the Chat and Universe modes **separate layouts that share one parent shell** without leaking into the URL. See §5 for the exact tree. Key caveat we design around: **navigating between two segments that each define their own root layout triggers a full page reload** — so Chat↔Universe toggling must NOT be modeled as two different root layouts; it must be one shared layout with client-side state/visibility toggling (§6.3), specifically to avoid any full reload when the user clicks the header icon.

### 3.4 Cache Components (PPR + `use cache`) — used for the console shell chrome, not the live data

Next 16's Cache Components model (`use cache` directive, `cacheLife`, `cacheTag`) is the current recommended caching primitive (superseding `unstable_cache`). This plan uses it narrowly:
- The **static chrome** of `/console` (header layout, icon set, theming) can be marked `use cache` since it doesn't vary per request.
- **User session data, chat messages, and universe tiles are never cached with `use cache`** — they're per-user, high-churn, and fetched client-side via TanStack Query (which has its own, more appropriate cache semantics — see §12). Mixing Next's server cache with per-user live graph data is an anti-pattern we explicitly avoid.

### 3.5 Server Actions vs. Route Handlers — which one for what

- **Server Actions** (`'use server'`) are used for simple, form-shaped mutations with no streaming requirement: login submit, TOTP verify submit, logout, renaming a chat thread, TOTP re-enrollment trigger.
- **Route Handlers** (`app/api/*/route.ts`) are used wherever we need: (a) streaming responses (chat SSE, universe tile SSE/binary), (b) a GET endpoint TanStack Query can call with its own retry/cache semantics, or (c) a same-origin proxy target for a WebSocket upgrade (realtime universe change feed).

### 3.6 `instrumentation-client.ts` for early client-side setup

Next 16 documents `instrumentation-client.ts` as a file convention for code that must run before the app's client bundle does anything else (e.g., WebGL capability detection, `prefers-reduced-motion` read, analytics init). This plan uses it once: to run the WebGL2/`OffscreenCanvas` feature-detection described in §14.2 *before* any component tries to mount the Three.js canvas, so the degraded-mode decision is available synchronously on first render instead of causing a layout flash.

---

## 4. Authentication, MFA & the `/console` Gate

### 4.1 Existing building blocks in this repo

- `src/shared/packages/ui/components/totp-setup/totp-setup.web.tsx` — already exists. Renders a QR code (`qrCodeImageSrc`, provided by the backend — "Backend returns the exact QR image payload" per its own code comment) plus an `otpauthUri` deep link for mobile authenticator apps. This is the **enrollment** UI. This plan reuses it as-is inside the sign-up flow; it does not need to be rebuilt.
- `src/shared/lib/api-client.ts` — Axios instance, `withCredentials: true` (cookie session), optional `x-vorinthex-api-key` header, base path `/api/v1`. All new auth/chat/universe calls extend this client or its `createApiClient()` factory rather than introducing a second HTTP client.
- No existing `/login`, `/verify`, `/signup`, or `/console` routes yet — `src/app/` currently only contains the marketing landing page (`page.tsx`, `landing-page.tsx`, `waitlist-form.tsx`).

### 4.2 The full auth → MFA → console flow

```
 (1) /signup ──submit──▶ backend creates user (unverified email) + returns TOTP
      │                   enrollment payload (issuer, account label, otpauth URI,
      │                   QR image URL)
      ▼
 (2) /signup/mfa-setup ──renders <TotpSetup/>── user scans QR, enters first code
      │                   to prove enrollment ──submit──▶ backend confirms factor
      ▼
 (3) /login ──submit email+password──▶ backend validates credentials, returns
      │        a *partial* session (state: "mfa_required") — NOT a full session.
      │        This partial session cookie should be short-lived (e.g. 5 min)
      │        and scoped only to permit hitting the verify endpoint.
      ▼
 (4) /login/verify ──renders 6-digit code input── submit──▶ backend validates
      │        TOTP code against the stored factor, and on success upgrades the
      │        cookie to a *full* session (state: "authenticated").
      ▼
 (5) proxy.ts sees full session cookie ──▶ redirect /login* → /console/home
      │
      ▼
 (6) /console/home (Server Component) calls verifySession() from the DAL,
      which hits the backend once per request (memoized via React `cache()`)
      to authoritatively confirm session validity + fetch the minimal user
      profile (id, displayName, avatarUrl, mfaLevel).
```

Key naming decision matching the brief exactly: the **MFA verification screen route is `/login/verify`** (not `/console/verify`) because it happens *before* the user has a full session — it must not live under the MFA-gated `/console` segment (that would be circular: you'd need to already be authenticated to reach the page that authenticates you). Once step (4) succeeds, `proxy.ts`'s optimistic check redirects straight to **`/console/home`**, matching "the first page they should land on is console/home."

### 4.3 Session shape (cookie payload contract)

The backend owns the actual cookie encryption (JWT/PASETO/opaque token — implementation detail out of scope per the brief), but the **frontend's optimistic check in `proxy.ts` needs a documented, minimal, non-sensitive shape** it can inspect without a network call. Recommended payload (whatever the encryption format):

```ts
type SessionCookiePayload = {
  sub: string;                 // user id
  state: "mfa_required" | "authenticated";
  iat: number;
  exp: number;
};
```

`proxy.ts` decodes this (verifying signature, not doing a DB round-trip — this is the "optimistic check" Next's own docs prescribe) and applies:

```ts
// src/proxy.ts
import { NextRequest, NextResponse } from "next/server";
import { decryptSessionCookie } from "@/server/auth/session-codec";

const PUBLIC_ROUTES = ["/", "/login", "/login/verify", "/signup", "/signup/mfa-setup"];

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isConsoleRoute = pathname.startsWith("/console");
  const cookie = request.cookies.get("vx_session")?.value;
  const session = cookie ? await decryptSessionCookie(cookie) : null;

  if (isConsoleRoute && session?.state !== "authenticated") {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (PUBLIC_ROUTES.includes(pathname) && session?.state === "authenticated") {
    return NextResponse.redirect(new URL("/console/home", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\.(?:png|jpg|svg|webmanifest)$).*)"],
};
```

Note this matches the Next.js authentication guide's own example almost line-for-line (see §21 sources) — deliberately, since it's the officially recommended pattern for this exact "optimistic redirect" use case, adapted to the `mfa_required` vs `authenticated` two-state session this product needs (the stock example only has authenticated/unauthenticated).

### 4.4 The Data Access Layer (`verifySession`)

```ts
// src/server/dal/session.ts
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { unauthorized } from "next/navigation";
import { backendFetch } from "@/server/backend-client";

export const verifySession = cache(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get("vx_session")?.value;
  if (!raw) redirect("/login");

  const res = await backendFetch("/auth/session", { method: "GET" });
  if (res.status === 401) unauthorized();      // in-app stale-session UI, not a hard redirect
  if (!res.ok) throw new Error("session check failed");

  const session = await res.json() as {
    userId: string;
    state: "authenticated";
    displayName: string;
    avatarUrl: string | null;
    mfaLevel: "totp";
  };
  return session;
});
```

`unauthorized()` here is exactly the case described in §3.2: the cookie exists and looked fine to the optimistic Proxy check, but the backend now says the session is actually invalid (revoked, expired, MFA factor removed). That renders `app/console/unauthorized.tsx` in place, inside the console shell, instead of yanking the user out.

### 4.5 Rate limiting & lockout (MFA-specific hardening)

Documented here as a requirement even though "don't worry about the API layer" — this is a client-visible *behavior* contract, not an implementation detail:
- `/login/verify` must support the backend returning a `attemptsRemaining` field so the UI can show "2 attempts remaining before lockout" — the composer for the 6-digit code should disable and show a cooldown timer once the backend signals lockout (`429` with `Retry-After`).
- No client-side TOTP validation ever — the 6 digits are opaque to the frontend, always round-tripped.

---

## 5. Route Map & File Structure for `/console`

### 5.1 Full route tree

```
src/app/
├── (marketing)/                     ← existing landing page, wrapped in a group
│   ├── layout.tsx                   ← existing root layout content, scoped
│   └── page.tsx                     ← existing landing-page.tsx render
│
├── (auth)/
│   ├── layout.tsx                   ← centered, minimal auth chrome
│   ├── login/
│   │   ├── page.tsx                 ← email+password
│   │   └── verify/
│   │       └── page.tsx             ← /login/verify — 6-digit TOTP input
│   └── signup/
│       ├── page.tsx
│       └── mfa-setup/
│           └── page.tsx             ← renders <TotpSetup/>
│
├── console/
│   ├── layout.tsx                   ← THE SHELL: header, mode toggle, floating
│   │                                    island host, providers (see §6)
│   ├── unauthorized.tsx             ← in-place "session expired" UI (§3.2, §4.4)
│   ├── loading.tsx                  ← shell-level skeleton (rare; most loading
│   │                                    is handled inside chat/universe panels)
│   ├── home/
│   │   └── page.tsx                 ← /console/home — lands here post-verify.
│   │                                    Redirects internally to last-used mode
│   │                                    (chat vs universe) per §6.4, defaulting
│   │                                    to chat with a fresh thread.
│   ├── (chat)/
│   │   └── c/
│   │       └── [threadId]/
│   │           └── page.tsx         ← /console/c/:threadId — chat mode
│   ├── (universe)/
│   │   └── u/
│   │       └── page.tsx             ← /console/u — universe mode (single page;
│   │                                    camera state lives in the URL query,
│   │                                    see §8.7, not in dynamic segments)
│   └── settings/
│       └── page.tsx                 ← account, MFA re-enrollment, sessions list
│
├── api/
│   ├── chat/
│   │   └── route.ts                 ← POST, proxies to backend, streams
│   │                                    UIMessage chunks via AI SDK v6
│   ├── universe/
│   │   ├── tiles/
│   │   │   └── route.ts             ← GET, proxies chunked tile fetch (§11)
│   │   ├── node/
│   │   │   └── [id]/route.ts        ← GET, single node detail
│   │   └── stream/
│   │       └── route.ts             ← WebSocket upgrade proxy (realtime feed)
│   └── auth/
│       ├── login/route.ts
│       ├── verify/route.ts
│       └── logout/route.ts
│
├── globals.css
├── layout.tsx                        ← true root layout (fonts, <html>, structured data — unchanged)
├── providers.tsx                     ← existing; extended with QueryClientProvider (see §12.1)
└── proxy.ts                          ← at src/ root per §3.1, listed here for visibility
```

Why `(chat)` and `(universe)` are route groups rather than a single page with client-only branching: it lets each mode have its own `loading.tsx`/`error.tsx` boundary and its own code-split bundle (the Three.js engine — a genuinely large dependency graph — should not be in the same JS chunk as the chat UI, and vice versa; see §9.1 for the dynamic-import strategy that makes this real even though both are visually toggled client-side within one shared layout).

### 5.2 Why camera/thread state lives in the URL

- `/console/c/[threadId]` — deep-linkable, back-button-friendly, matches Claude.ai's own `/chat/:id` pattern.
- `/console/u?x=...&y=...&z=...&tier=...` — the **camera position and zoom tier are serialized to the query string** (throttled, replaceState not pushState per movement — see §9.7) so a link to "this exact part of the universe" is shareable and survives a refresh. This is not just a nicety: it is also how the server-rendered shell can decide, on the very first request, which zoom-tier tile bundle to include as a prefetch hint (`<link rel="prefetch">`) before any client JS runs.

### 5.3 `/console/home` behavior

`/console/home` is a redirect-resolving page, not a persistent destination:

```tsx
// src/app/console/home/page.tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export default async function ConsoleHomePage() {
  const lastMode = (await cookies()).get("vx_last_mode")?.value; // "chat" | "universe"
  if (lastMode === "universe") redirect("/console/u");
  redirect("/console/c/new"); // "new" is a sentinel handled client-side (§7.2)
}
```

This satisfies "the first page they should land on is console/home" literally (it is always hit right after verify), while immediately resolving to the user's actual last-used mode, defaulting new users to Chat (the lower-friction first experience — an empty 3D universe is a worse first impression than a helpful assistant message).

---

## 6. The Console Shell: Header, Mode Toggle, Floating Island

### 6.1 Layout skeleton

```tsx
// src/app/console/layout.tsx
import { verifySession } from "@/server/dal/session";
import { ConsoleShell } from "@/features/console/console-shell";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession(); // throws → unauthorized.tsx, or redirects → /login
  return <ConsoleShell session={session}>{children}</ConsoleShell>;
}
```

`ConsoleShell` (client component) owns:
1. The header (mode toggle icon, thread title / breadcrumb, user menu).
2. The floating island composer host — rendered once, at the shell level, **not** re-mounted per chat thread navigation (see §6.5 for why this matters for input continuity).
3. A CSS-grid body area where `{children}` (the `(chat)` or `(universe)` route group's page) is rendered.

Visual tokens (dark "control room" theme, distinct from the marketing cream theme):

```css
/* src/app/console/console-theme.css */
:root[data-console-theme="dark"] {
  --vx-console-bg: #0B0D10;
  --vx-console-surface: #14171B;
  --vx-console-surface-raised: #1C2026;
  --vx-console-border: rgba(255,255,255,0.08);
  --vx-console-text: #EDEFF2;
  --vx-console-text-muted: #9BA1AC;
  --vx-console-accent: #7C9CFF;      /* used for the universe's node-glow accent too */
  --vx-console-island-bg: rgba(20,23,27,0.72);
  --vx-console-island-blur: 20px;
  --vx-console-island-border: rgba(255,255,255,0.12);
}
```

### 6.2 Header component

```tsx
// src/features/console/console-header.tsx
type ConsoleHeaderProps = {
  mode: "chat" | "universe";
  onToggleMode: () => void;
  threadTitle?: string;
  hasOtherModeActivity: boolean; // pulses the icon — see §6.6
};
```

Layout (left → right): logo mark (reuses `src/shared/packages/ui/components/logo-mark`) · thread title / breadcrumb (chat mode only) or camera "you are here" path (universe mode only, e.g. `Universe / Cluster “Payments” / Node “refund_flow”`) · — spacer — · mode-toggle icon button · user menu (reuses `user-menu.web.tsx`).

The mode-toggle button is a single `IconButton` that swaps its glyph based on `mode`:

```tsx
function ModeToggleButton({ mode, onToggleMode, hasOtherModeActivity }: {
  mode: "chat" | "universe";
  onToggleMode: () => void;
  hasOtherModeActivity: boolean;
}) {
  const nextMode = mode === "chat" ? "universe" : "chat";
  return (
    <button
      type="button"
      onClick={onToggleMode}
      aria-label={nextMode === "universe" ? "Open the Universe" : "Open Chat"}
      className="vx-mode-toggle"
      data-pulse={hasOtherModeActivity ? "true" : undefined}
    >
      {mode === "chat" ? <GlobeIcon aria-hidden /> : <ChatBubbleIcon aria-hidden />}
    </button>
  );
}
```

Reiterating the rule from §1.1 because it is the single easiest thing to get backwards during implementation: **`mode === "chat"` renders the Globe icon** (invitation to leave chat and enter the universe), and **`mode === "universe"` renders the Chat-bubble icon** (invitation to leave the universe and return to chat).

### 6.3 Why toggling is client-side visibility, not routing, at the shell boundary

Per §3.3's caveat, navigating across two segments that each define a **root layout** forces a full page reload. Chat and Universe are *not* separate root layouts here — they're both children of the single `console/layout.tsx` root for this section of the tree. But there's a second, equally important reason to prefer **client-side show/hide over a route push**, even though they're not competing root layouts: **preserving WebGL context and chat scroll position across a toggle.**

If toggling modes were a plain Next.js navigation between `/console/c/[id]` and `/console/u`, the outgoing page's component tree unmounts. For the Universe, that means the entire Three.js scene, GPU buffers, and the camera's current zoom-tier state get destroyed and rebuilt from scratch every time the user glances at chat and comes back — unacceptable, both for perceived performance (WebGL context creation is not free, typically 50-150ms) and for literally losing the user's place in the universe.

**Chosen approach:** both `(chat)` and `(universe)` route segments' pages are always mounted simultaneously inside the shell once the user has visited both at least once in the session; the toggle only changes which one is `display`-visible (via CSS, not `unmount`), plus updates the URL via `history.replaceState` (not a Next `router.push`) so the address bar stays accurate without triggering RSC navigation:

```tsx
// src/features/console/console-shell.tsx (excerpt)
"use client";

export function ConsoleShell({ session, children }: { session: Session; children: React.ReactNode }) {
  const [mode, setMode] = useConsoleMode(); // Zustand store, persisted to a cookie (§6.4)
  const [universeMounted, setUniverseMounted] = useState(mode === "universe");

  // Lazy-mount the Universe on first visit (don't pay its bundle cost for chat-only users),
  // but never unmount it again once mounted this session.
  useEffect(() => {
    if (mode === "universe" && !universeMounted) setUniverseMounted(true);
  }, [mode, universeMounted]);

  return (
    <div className="vx-console-root" data-console-theme="dark">
      <ConsoleHeader mode={mode} onToggleMode={() => toggleConsoleMode(mode, setMode)} />
      <div className="vx-console-body">
        <div hidden={mode !== "chat"}>{children /* (chat) segment's page */}</div>
        {universeMounted && (
          <div hidden={mode !== "universe"}>
            <UniverseCanvasBoundary /> {/* dynamic-imported, see §9.1 */}
          </div>
        )}
      </div>
      <FloatingIslandHost mode={mode} />
    </div>
  );
}
```

This means `{children}` passed into `ConsoleShell` is *always* the `(chat)` page (since that's the layout's actual routed child in this design — see the nuance in §6.3.1 below), and the Universe is instantiated as a sibling client component that isn't part of Next's routing tree at all once mounted; the URL still updates for shareability/deep-linking, but the mount/unmount lifecycle is fully decoupled from Next navigation.

#### 6.3.1 Handling the case where the user's first visit *is* `/console/u`

If a shared universe link (`/console/u?x=...`) is the entry point, `(chat)`'s page must still exist for the eventual toggle-back. Solution: `ConsoleShell` always renders a lazily-created **default/new chat thread** underneath, regardless of entry route — i.e., `children` from the App Router is used when the entry route is `(chat)`, but when the entry route is `(universe)`, the shell independently mounts a `<ChatPanel threadId="new" />` off-tree the same way it mounts the Universe off-tree in the reverse case. In practice this means `ConsoleShell` treats **both** panels symmetrically as client-mounted, URL-synced, but routing-independent panels, and the true source of "which route did Next actually render" only matters for the very first paint / SSR shell and for deep-link correctness — not for the toggle mechanic itself. This symmetry should be reflected in the implementation: prefer a single internal `<ConsolePanels activeMode={mode} chatThreadId={...} universeQuery={...} />` component that owns both panel's lifecycles uniformly, rather than the asymmetric sketch above (shown asymmetric first for pedagogical clarity about *why* off-tree mounting is needed at all).

### 6.4 Persisting last-used mode

- Source of truth for "last used mode" (read by `/console/home`, §5.3): an httpOnly-**false** cookie `vx_last_mode` (not sensitive, fine to be JS-readable/writable), updated on every toggle via `document.cookie` from the client store, `SameSite=Lax`, 1-year expiry.
- In-session mode state itself lives in a small Zustand store (`useConsoleModeStore`), not React Context — avoids re-rendering the entire shell tree on every toggle; only the header icon and the two panels' `hidden` attribute subscribe to it.

### 6.5 The Floating Island — shared chrome, mode-aware content

The "floating island" is a single, persistent, centered-bottom, pill/rounded-rectangle surface that **exists in both modes** but changes its content and affordances:

| Mode | Island contents |
|---|---|
| Chat | Full composer: autosize textarea, attach button, model/tool indicator, send button, stop-generating button while streaming |
| Universe | Compact contextual bar: search-the-graph input (fuzzy node search, jumps camera to result), current zoom-tier readout, "ask about what I'm looking at" quick-action that pivots to Chat with the selected node(s) as context |

Keeping the island **mounted once at the shell level** (as shown in §6.3's `FloatingIslandHost`) rather than re-created per mode means:
- No layout shift / refocus flicker when toggling modes — the island smoothly morphs its internal content (a `layout` animation via Framer Motion or CSS `grid-template` transition) rather than unmounting one composer and mounting another.
- An in-progress chat draft is never lost by a mode switch, because the chat composer's `<textarea>` DOM node itself never unmounts (see §7.10 for the full "don't lose the user's typing" contract).

```tsx
// src/features/console/floating-island/floating-island-host.tsx
export function FloatingIslandHost({ mode }: { mode: "chat" | "universe" }) {
  return (
    <div className="vx-island" role="region" aria-label="Composer">
      <div className="vx-island-surface">
        {mode === "chat" ? <ChatComposer /> : <UniverseCommandBar />}
      </div>
    </div>
  );
}
```

```css
.vx-island {
  position: fixed;
  left: 50%;
  bottom: max(24px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  width: min(760px, calc(100vw - 32px));
  z-index: 40;
}
.vx-island-surface {
  background: var(--vx-console-island-bg);
  backdrop-filter: blur(var(--vx-console-island-blur));
  -webkit-backdrop-filter: blur(var(--vx-console-island-blur));
  border: 1px solid var(--vx-console-island-border);
  border-radius: 20px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.04) inset;
  padding: 10px 12px;
  transition: grid-template-rows 220ms cubic-bezier(0.32, 0.72, 0, 1);
}
```

### 6.6 "Other mode has activity" pulse

Two concrete triggers implemented via the same Zustand store, both cheap booleans flipped by event listeners already needed elsewhere:
- **Chat → Universe pulse:** a background write lands via the realtime change feed (§11.4) while the user is in Chat mode (e.g. an agent tool-call created new graph nodes) → set `hasOtherModeActivity = true` while `mode === "chat"`. Cleared the instant the user toggles to Universe.
- **Universe → Chat pulse:** a chat message streams in on a *different* thread than the one currently open (relevant once multi-thread background chat runs exist) while the user is in Universe mode. Cleared on toggle to Chat.

This is intentionally minimal for v1 — a single boolean, rendered as a small dot or soft glow on the toggle icon, not a numeric badge (numeric unread counts on a mode-switch icon would overstate its importance; this is a wayfinding affordance, not an inbox).

---

## 7. Chat Interface Deep Dive

### 7.1 Why this section is long

"Just like Claude Chat" is a high bar with a lot of implicit, easy-to-miss requirements: incremental markdown rendering that doesn't flicker, scroll behavior that doesn't fight the user, code blocks that highlight only once complete, tool-call/"thinking" states, stop/regenerate, and a composer that behaves correctly with IME input, multi-line paste, and mobile virtual keyboards. Each is covered below with the specific failure mode it prevents.

### 7.2 Route & data model

- `/console/c/new` — client-side sentinel meaning "no thread yet." The composer is usable immediately (no network round-trip required to start typing); a real `threadId` is only minted on **first message send**, via an optimistic local ID that's reconciled with the backend's real ID when the response for message #1 begins streaming (see §7.8 for the optimistic-id reconciliation contract). On success, `history.replaceState` swaps the URL from `/console/c/new` to `/console/c/:realThreadId` without a navigation/remount.
- `/console/c/[threadId]` — existing thread. Server Component fetches the **first page** of messages (most recent N, see §7.6) for fast TTFB; all subsequent interaction (older-message pagination, new message streaming) is client-side via TanStack Query + the AI SDK v6 `useChat` hook.

```ts
// Message persistence shape (backend-owned, frontend contract)
type ChatMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system" | "tool";
  parts: ChatMessagePart[];     // AI SDK v6 UIMessage "parts" shape — text, tool-call, tool-result, file, reasoning
  createdAt: string;            // ISO
  status?: "streaming" | "complete" | "error";
};
```

### 7.3 Wiring: AI SDK v6 `useChat` against our own proxy route

```ts
// src/features/chat/use-console-chat.ts
"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

export function useConsoleChat(threadId: string) {
  return useChat({
    id: threadId,
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    // AI SDK v6 UIMessage stream protocol — our /api/chat route handler
    // translates the backend's SSE shape into this on the server, so the
    // client never needs to know what the backend's raw protocol looks like.
  });
}
```

```ts
// src/app/api/chat/route.ts
import { backendFetchStream } from "@/server/backend-client";
import { verifySession } from "@/server/dal/session";

export async function POST(req: Request) {
  const session = await verifySession(); // 401s via the DAL if invalid
  const body = await req.json();
  const backendStream = await backendFetchStream("/chat/completions", {
    method: "POST",
    body: JSON.stringify({ ...body, userId: session.userId }),
  });
  // Adapt backend's stream into the AI SDK v6 UIMessage stream response.
  return toUIMessageStreamResponse(backendStream);
}
```

The key architectural point: **the backend does not need to natively speak the AI SDK's wire protocol.** `toUIMessageStreamResponse` (a thin adapter we write once) is the seam — it lets the backend emit whatever internal event shape it wants (plain JSON-lines, provider-native SSE, whatever), and the Next.js route is the only place that needs to know both shapes. This isolates the frontend completely from backend/provider churn.

### 7.4 Message list rendering & virtualization

- Long threads (100s of messages) must not render every message's DOM eagerly. Use a windowed list (`@tanstack/react-virtual`, already compatible with this repo's TanStack ecosystem — adding `@tanstack/react-virtual` alongside the existing `@tanstack/react-query` is a natural, low-risk addition) anchored to the **bottom**, growing upward.
- Virtualization interacts badly with streaming markdown height changes (a message's rendered height changes many times per second while tokens arrive) — mitigate by measuring the *currently streaming* message with a `ResizeObserver` and feeding corrected size estimates back into the virtualizer on each paint, rather than re-measuring the whole list.
- Each historical (non-streaming) message's markdown is rendered once and memoized (`React.memo` keyed by message id + content hash) — re-render should only ever touch the single streaming message.

### 7.5 Streaming markdown without flicker

Concrete rule (validated against how Claude.ai and Cursor both do this, per research in §21): **render the raw/plain-text token stream immediately, and only promote a code fence to a syntax-highlighted `<pre><code>` block once its closing triple-backtick has arrived.** Highlighting a still-open code block character-by-character both wastes CPU (re-tokenizing on every token) and visually flickers as the highlighter's best-guess language/state changes token to token.

Implementation shape:
```ts
// src/features/chat/markdown/incremental-markdown.ts
// Maintains a small state machine over the incoming text delta:
//  - PLAIN: default; text rendered via a lightweight inline-markdown pass
//    (bold/italic/links/inline-code only — cheap, safe to re-run per token)
//  - IN_FENCE: once a ``` opening fence is seen, subsequent text is rendered
//    as monospace PLAIN TEXT (no highlighting) until the matching closing
//    fence token is observed
//  - On fence close: hand the accumulated fence content to a syntax
//    highlighter (Shiki, run inside a Web Worker — see §7.5.1) exactly once
```

#### 7.5.1 Why the syntax highlighter runs in a Web Worker

Shiki (or any TextMate-grammar highlighter) does non-trivial synchronous work per code block. Running it on the main thread momentarily blocks input handling on the floating island composer if the user keeps typing while a previous message's code block finishes streaming. A dedicated `highlight.worker.ts` receives `{ code, lang }` and returns pre-rendered HTML (or an ANSI-like token array to render via React, which is safer than `dangerouslySetInnerHTML` from a worker — prefer the token-array approach and render with trusted React components, since worker output should still be treated as data, not markup, defense-in-depth even though the source is our own worker).

### 7.6 Scroll behavior contract

This is the single most-complained-about UX bug in home-grown chat UIs if done wrong. Exact rule set (matches Claude.ai's documented behavior, §21):

1. While a response is streaming, **auto-scroll to bottom on every new chunk only if the viewport was already within ~100px of the bottom at the moment the chunk rendered.**
2. The instant the user scrolls upward (wheel, touch-drag, or keyboard) during a stream, **immediately stop auto-scrolling** and do not resume it automatically.
3. While auto-scroll is suspended and new content is still streaming below the fold, show a small floating **"Jump to latest"** pill button, positioned just above the floating island (so the two never overlap), which on click smooth-scrolls to bottom and re-arms auto-scroll.
4. On sending a new user message, always force-scroll to bottom immediately (this is a deliberate user action, not something to preserve scroll position against).
5. Loading older messages (scroll-up pagination, §7.4) must never cause a visible jump — prepend content above the viewport and immediately compensate `scrollTop` by the newly-inserted height in the same paint (the "maintain scroll anchor" pattern), before the browser paints.

### 7.7 Composer (floating island, chat mode) — detailed behavior

```tsx
type ChatComposerState = {
  draft: string;
  attachments: PendingAttachment[];
  isStreaming: boolean;           // disables send, shows stop button instead
  toolIndicator?: { label: string; icon: ReactNode }; // e.g. "Web search enabled"
};
```

- Autosize `<textarea>` (grows up to a max of ~40vh, then internally scrolls) — never a fixed-height single-line input; multi-line paste must not truncate visually.
- `Enter` sends; `Shift+Enter` (or `Cmd/Ctrl+Enter` as an alternative, configurable) inserts a newline. Must correctly ignore `Enter` presses that are part of IME composition (`event.isComposing` check) — a common bug where CJK/Japanese/Korean input gets prematurely submitted mid-composition.
- While `isStreaming`, the send button morphs into a **stop** button (square icon) that calls the AI SDK's `stop()`; the textarea remains editable so the user can queue their next message, which sends automatically the instant the current stream finishes if they pressed Enter while it was still streaming (a small UX nicety Claude.ai also has — queued-send).
- Drag-and-drop file attachment onto the entire island (not just a tiny icon target) with a full-island dashed-border hover state.

### 7.8 Optimistic thread creation & id reconciliation

```
User on /console/c/new types + hits send
  → generate localId = `local-${crypto.randomUUID()}`
  → optimistically render the user message immediately (id: localId)
  → POST /api/chat with { threadId: null, message }
  → backend creates the real thread, starts streaming the assistant reply,
    and includes `X-Thread-Id: <realId>` as a response header (readable
    before the stream body even starts, since headers arrive first)
  → on receiving that header: history.replaceState to /console/c/<realId>,
    and reconcile localId → realId in the TanStack Query cache key
    (see §12.2) so a subsequent hard refresh loads the same thread correctly
```

This avoids the common bad pattern of waiting for a full round-trip before letting the user see their own message appear.

### 7.9 Tool calls, "thinking," and structured states

Chat messages are not just text — `parts` (per §7.2's shape) can include reasoning segments and tool calls (e.g., the universe search tool, described next). Render contract:
- **Reasoning/thinking parts** render as a collapsed-by-default, subtly-styled "Thinking…" disclosure (matches Claude's own pattern) — expand on click, auto-collapse once the final answer begins.
- **Tool-call parts** relevant to this product specifically: a `search_universe` tool the assistant can invoke to look up graph nodes and cite them in its answer. Render tool-call parts as an inline card (node name, type icon, a "View in Universe" link that toggles mode + flies the camera to that node — the concrete implementation of "ask about what I'm looking at" from §6.5, in reverse). This is the main functional bridge between Chat and Universe modes beyond the header toggle: **chat can act as a natural-language front-end onto the graph**, not just a bystander UI next to it.

### 7.10 Never losing the user's draft

- Draft text is persisted to `sessionStorage` keyed by `threadId` (or the synthetic `new` key) on every keystroke (debounced ~250ms), restored on remount. Combined with §6.5's "composer never unmounts across mode toggles," this makes draft loss require an actual tab close, which is expected and acceptable.
- On the `unauthorized.tsx` stale-session path (§4.4), the in-flight draft must survive the re-verify round-trip — since the composer DOM persists across the console shell believing the session view state, not remounting on an auth boundary re-render, this falls out naturally as long as `unauthorized.tsx` is rendered as an overlay/dialog above the still-mounted shell rather than replacing the shell subtree. Implementation note: because Next's `unauthorized.tsx` convention renders in place of the segment tree, achieving "overlay, not replace" requires the MFA-expiry check to be scoped to a narrow server component (e.g. only the message-send Server Action's own session check triggers `unauthorized()`, not the whole layout) — the shell layout's own `verifySession()` call should be the one exception that, on failure, still redirects (full page) rather than rendering `unauthorized.tsx`, precisely to avoid this edge case; `unauthorized.tsx` is reserved for narrower, leaf-level session checks (e.g. within a Server Action call) where an in-place dialog is actually achievable without destroying the composer. This nuance is important enough to flag explicitly: **do not wire `unauthorized()` at the `console/layout.tsx` level** — wire it at the individual mutation boundary level, and handle the "whole shell needs to re-auth" case with a client-side modal driven by 401 responses from `fetch`, not the `unauthorized.tsx` file convention.

---

## 8. The Universe: Product Behavior Spec

Before the engineering (§9), pin down exactly what the feature *does*, because "zoom like infinity into the universe until we have no more nodes" is a product statement with several distinct behaviors bundled into it. Each is specified precisely enough to implement without guessing.

### 8.1 The four zoom regimes

The universe is not one continuous rendering mode — it is four regimes that the camera crosses seamlessly, each with a different rendering + data strategy. The user should never perceive the seam; the engineering underneath changes completely at each threshold.

| Regime | Approx. camera distance (world units, before origin-rebasing) | What's visible | Data source |
|---|---|---|---|
| **R0 — Cosmos** | > 10,000 | A soft particle field: every top-level cluster centroid rendered as a single glowing point/billboard, sized by cluster weight (node count). No individual nodes exist yet in the scene. | `node_clusters_L0` (coarsest materialized tier, §10.5) |
| **R1 — Nebulae** | 1,000 – 10,000 | Clusters resolve into sub-cluster clouds (soft instanced sprites, some jitter/parallax for depth cues) — think "zooming from galaxy to spiral arm." | `node_clusters_L1..LN-1` (intermediate tiers) |
| **R2 — Constellations** | 50 – 1,000 | Individual nodes appear as small instanced spheres/icons; edges between *currently loaded* nodes render as thin additive-blended lines; labels appear for nodes above a size/importance threshold to avoid label soup. | `nodes` + `edges` (real documents, viewport-bounded chunk fetch, §11) |
| **R3 — Inspect** | < 50 | A single node (or tightly connected small set) fills much of the view; full label, an inline detail card (floating panel, not a modal) with properties/actions; edges render with directionality (arrowheads) and relationship-type labels. | `nodes/:id` detail endpoint (§10.6) |

Crossing a regime boundary is **hysteresis-gapped** (enter R2 at distance 1000, only fall back to R1 at distance 1200, not exactly 1000) to prevent flicker-thrashing when the camera hovers near a threshold. See §9.4.

### 8.2 What "infinite" actually means, precisely

Three distinct sub-claims, each engineered differently:

1. **Zooming out never hits a hard floor of "there's nothing bigger to show."** Even if the graph itself is finite, R0's cosmos view can always keep receding — because R0 doesn't need real data density to look infinite; a small amount of background procedural starfield (cheap, generated client-side, seeded by a hash of the graph's root id so it's stable across sessions) fills the space *around* real cluster centroids once you zoom out far enough that clusters themselves become sparse points. This is a deliberate, disclosed illusion: real data is always visually distinguishable from decorative background (real clusters/nodes are brighter, slightly larger, and interactive; decorative starfield is dim, small, and inert — never clickable, never labeled). This distinction must be documented in code comments and QA'd explicitly so nobody later "fixes" the decorative stars into being clickable and breaks the illusion's honesty.
2. **Zooming in never hits a hard floor either — it either finds more real data (fetches a deeper chunk) or reaches a genuine leaf.** A genuine leaf (a node with no further zoomable children — i.e., not itself a cluster proxy and has no un-fetched edges) shows a calm "You've reached the edge of the known universe here." empty-state card in R3, with a one-click "back out" affordance. This is explicitly **not** an error state — it's a designed destination, matching "zoom until we have no more nodes" as a real, reachable, positively-framed end condition rather than a bug to hide.
3. **The zoom gesture itself has no numeric min/max clamp in the camera controller.** Scroll/pinch velocity always produces a response; what changes is only which regime's rendering logic is active and which data is being fetched underneath. This is the "floating origin" requirement detailed in §9.2 — the *camera controller* must be engineered so that "zoom forever" is representable at all, independent of what data exists.

### 8.3 Entry, exploration, and exit interactions

| Interaction | Behavior |
|---|---|
| Scroll wheel / trackpad pinch | Zooms along the camera's current view ray (zoom-to-cursor, not zoom-to-center — standard for spatial exploration tools, e.g. Figma/Google Maps) |
| Click-drag (empty space) | Orbits the camera around the current focal point |
| Click-drag (on a node, R2/R3) | Does **not** move the node (this is a read-heavy visualization, not a graph editor in v1) — instead it's a camera-pan shortcut identical to empty-space drag; node dragging/editing is explicitly out of scope for v1, flagged in §19 |
| Click (single) on a node | Selects it — shows a lightweight hover-card with name/type; does not move the camera |
| Double-click on a node | Flies the camera to center/focus that node, transitioning toward R3 |
| `Cmd/Ctrl + scroll` | Fast-zoom (larger step per wheel tick) — power-user affordance |
| Two-finger touch pinch (mobile/trackpad) | Same zoom-to-cursor(midpoint) behavior, plus two-finger drag = pan |
| `Esc` | Deselects current node / closes the R3 detail card, does not change zoom |
| The floating island's search bar (§6.5) | Fuzzy-searches node names/types via the backend search endpoint (§10.7); selecting a result flies the camera directly to it, streaming in whatever chunk of R0→R3 tiles lies on the flight path so the transition never shows an empty scene mid-flight |

### 8.4 The "fly-to" camera transition

Flying from an arbitrary current position/zoom-tier to an arbitrary target node (from search, from a chat tool-call citation per §7.9, or from double-click) is scripted, not a naive linear tween, because a linear position/zoom interpolation between two very different zoom tiers looks wrong (it either zips through intermediate space too fast to register, or crawls through irrelevantly if tweened by distance rather than by *perceived* zoom). The transition uses:
- A logarithmic-time ease on the zoom-tier dimension (spend proportionally more transition time changing tiers near the ends, matching how zoom already feels perceptually logarithmic — see §9.2's log-depth discussion) — concretely, interpolate `tierProgress` with a cubic-bezier ease-in-out over `log(currentDistance / targetDistance)` rather than over raw distance.
- A great-circle-style camera path (orbit toward the target's bearing while zooming) rather than a straight dolly, so intermediate cluster geography sweeps past coherently instead of the camera clipping through unrelated clusters in a straight line.
- Guaranteed **chunk prefetch along the path**: before starting the animation, the client computes the sequence of regimes/tiers the flight will cross and issues prefetch requests for all of them immediately (not lazily as the camera arrives), using the existing chunk-cache (§12.2) so a repeated fly-to the same area is instant on subsequent visits.

### 8.5 Labels, density management, and the "label soup" problem

At R2/R3, showing a text label on every node quickly becomes unreadable once more than ~30-40 labels are on screen. Rule: labels render only for nodes whose **on-screen projected size** (post-projection, accounting for current zoom) exceeds a threshold, computed per-frame for the currently-loaded node set (cheap — a dot product and a division per node, done in the same pass that already updates instance transforms, not a separate O(n) loop). Nodes below the label threshold still render their point/icon, just without text, until the user zooms further or hovers (hover always shows a label regardless of the size threshold, as a discoverability affordance).

### 8.6 Realtime updates while the user is exploring

If the backend's change feed (§11.4) reports a new node/edge landing inside the currently-loaded viewport bounds while the user is actively in Universe mode, it fades in with a soft "new" pulse (a brief emissive-intensity ramp on the instance, not a jarring pop-in) rather than silently appearing — since sudden unexplained new geometry in a "look how vast this is" visualization would read as a bug rather than a feature otherwise. Changes outside the current viewport/tiers just invalidate the relevant cache entries silently (they'll be correct next time that region is fetched) and, if the user is currently in **Chat** mode, contribute to the §6.6 mode-toggle pulse.

### 8.7 URL/camera state serialization

```
/console/u?x=1234.5&y=-88.2&z=41002&yaw=0.42&pitch=-0.11&tier=1&focus=node:8f2a
```
- `x,y,z`: camera position in the **current local origin's** coordinate frame (see §9.2 — this is *not* a single global coordinate system across the whole zoom range; it's re-derived relative to the active floating origin on load, see §9.2.4 for the reconciliation).
- `yaw,pitch`: camera orientation (roll intentionally omitted/always 0 — this is an exploration camera, not a flight simulator; keeping roll locked at 0 avoids ever-disorienting the user, a deliberate constraint).
- `tier`: which LOD tier the camera was in, redundant with `z` but kept explicit so a loaded page can immediately request the right tier's tile bundle before doing any distance math.
- `focus`: optional currently-selected node id.
- Writes are throttled (`replaceState`, max ~2/sec while moving, immediate on interaction end) — never `pushState` per camera frame, which would each add a browser-history entry and make the back button useless.

---

## 9. Three.js Engineering Deep Dive

This is the technically hardest section in the document. It is organized by *problem*, not by file, because the "infinite zoom" requirement is really five separable hard problems that are each individually well-understood in computer graphics but rarely all combined in one product: (1) floating-point precision at extreme scale ratios, (2) level-of-detail data streaming, (3) large-instance-count rendering performance, (4) camera/interaction feel, and (5) getting the physics/layout simulation off the main thread. Skipping any one of these and shipping anyway is exactly how "infinite zoom" demos end up glitchy, jittery, or capped at a few thousand nodes.

### 9.1 Library choices & bundle strategy

| Concern | Choice | Rationale |
|---|---|---|
| Renderer | `three` (raw) via `@react-three/fiber` (R3F) | R3F integrates cleanly with React 19's concurrent rendering and this repo's existing component conventions, while still allowing direct imperative `three` access (`useFrame`, refs) for the performance-critical bits (instancing, custom shaders) that shouldn't be fighting React's render cycle. |
| Helpers | `@react-three/drei` (`<Instances>`, `<Detailed>`, `<Billboard>`, `<Line>`, `<PerformanceMonitor>`) | Battle-tested implementations of exactly the primitives this plan needs (instancing wrapper, LOD wrapper, camera-facing sprites, adaptive-quality helper) — reimplementing these from scratch would be pure risk with no product benefit. |
| Physics/force-layout (server-precomputed positions are primary; client may still run a *cheap* local relaxation — see §9.6) | `d3-force-3d` (if any client-side layout nudging is needed at all) run inside a Web Worker | Positions for R2/R3 nodes are precomputed server-side (§10.5.3) as the primary source of truth for performance and determinism (two users must see the same layout for the same node); a client worker only ever does *local* jitter/relaxation to avoid perfect-overlap of freshly-streamed-in siblings, never a full recompute. |
| GPU-accelerated alternative (flagged, not chosen for v1) | `cosmos.gl` | Purpose-built for hundreds-of-thousands-of-node force layouts entirely on GPU (WebGL2/luma.gl). Not chosen for v1 because it owns its own renderer/camera stack, which conflicts with this plan's custom floating-origin camera and the R0-R3 regime system built on raw `three`/R3F. Revisit if/when node counts in a single loaded region exceed ~50k and the custom instancing approach in §9.3 stops keeping frame time budget (§13) — at that point, cosmos.gl's compute-shader layout could be adopted as an internal implementation detail of just the position-computation step, still rendered through our own R3F scene. |
| Bundle isolation | Dynamic `import()` behind `next/dynamic` with `ssr: false`, loaded only once Universe mode is first toggled to (§6.3) | `three` + `@react-three/fiber` + `@react-three/drei` together are a substantial dependency (several hundred KB gzipped) that must never be in the initial `/console/home` → chat bundle. |

```tsx
// src/features/universe/universe-canvas-boundary.tsx
import dynamic from "next/dynamic";

const UniverseCanvas = dynamic(() => import("./universe-canvas"), {
  ssr: false,
  loading: () => <UniverseSkeleton />,
});

export function UniverseCanvasBoundary() {
  return <UniverseCanvas />;
}
```

### 9.2 The core hard problem: floating-point precision across an "infinite" zoom range

#### 9.2.1 Why a naive single-scene-graph approach breaks

`three.js` (like virtually all real-time 3D engines) stores positions as 32-bit floats on the GPU (and JS `number`s, which are 64-bit doubles, on the CPU side — but the *GPU* vertex/instance data is what actually matters for rendering precision, and that's `Float32Array`). A 32-bit float has ~7 significant decimal digits of precision. If the "cosmos" view needs cluster centroids tens of thousands of units from the origin, and the "inspect" view needs sub-unit precision on an individual node's position *within that same coordinate system*, you need dynamic range spanning many orders of magnitude simultaneously — which a single `Float32Array`-backed scene graph cannot represent without visible jitter ("z-fighting"-like flickering, judder during camera movement, and eventually complete precision collapse where nearby vertices become indistinguishable) once camera distance from the world origin gets large relative to the detail you're rendering.

This is a well-known problem class in space-sim / flight-sim engines (Kerbal Space Program, Elite Dangerous, No Man's Sky, Cosmographia) and the two standard solutions are:

1. **Floating origin (a.k.a. "origin rebasing"):** periodically re-center the world so that whatever the camera is currently near becomes the new `(0,0,0)`, and shift every object's stored position by the same delta. The camera itself is then always rendered extremely close to the true origin, where float32 precision is at its best, regardless of how "far" the user has conceptually traveled.
2. **Logarithmic/tiered depth (a.k.a. "scale-of-scales" / nested reference frames):** instead of one coordinate system, use a small number of **discrete nested scale tiers** (this plan's R0-R3 regimes, §8.1 double as this), each with its own local origin and its own reasonable coordinate magnitude, and render/transition between tiers rather than pretending it's all one seamless coordinate space.

**This plan uses both, combined, because they solve different halves of the problem:**
- Floating origin solves precision *within* a single regime (e.g., panning around within R2/Constellations, where nodes can still be thousands of units apart in a large loaded region).
- Tiered/regime-based rendering solves the *cross-regime* range problem (R0's cosmos-scale distances vs. R3's sub-unit inspection distances are never represented in the same `Float32Array` at all — they're different tiers with independently reasonable local coordinate ranges, only reconciled at transition time via the fly-to logic in §8.4).

#### 9.2.2 Floating-origin implementation

```ts
// src/features/universe/engine/floating-origin.ts
// Every renderable's "true" position is stored in a double-precision (JS number)
// CPU-side registry, keyed by node id — NOT read directly from Object3D.position
// as the source of truth. Object3D.position (float32-backed under the hood via
// the GPU buffers Three.js builds) only ever holds the position *relative to
// the current local origin*.

type WorldRegistry = Map<string, { x: number; y: number; z: number }>; // doubles

const REBASE_THRESHOLD = 5_000; // world units the camera may drift from local origin

function maybeRebase(camera: THREE.Camera, localOrigin: { x: number; y: number; z: number }, registry: WorldRegistry, instancedMeshes: THREE.InstancedMesh[]) {
  const distFromOrigin = camera.position.length(); // camera.position is already origin-relative
  if (distFromOrigin < REBASE_THRESHOLD) return;

  // Shift the local origin by the camera's current offset (in double precision,
  // via the registry), then rewrite every instance's origin-relative transform.
  const delta = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  localOrigin.x += delta.x;
  localOrigin.y += delta.y;
  localOrigin.z += delta.z;
  camera.position.set(0, 0, 0); // camera snaps back near the (new) local origin

  for (const mesh of instancedMeshes) {
    rewriteInstanceTransformsRelativeToOrigin(mesh, registry, localOrigin);
  }
}
```

Key details that make this correct rather than just plausible-looking:
- The rebase must happen **atomically within a single frame**, before that frame's render call — never spread across frames — or the user will see a one-frame "jump" as some objects update their relative position before others.
- `REBASE_THRESHOLD` (5,000 units in the sketch above) is chosen so it's comfortably inside float32's "safe" precision radius for the vertex/instance data scale this app uses (sub-unit-scale node geometry), with a wide safety margin — this number should be tuned against an actual precision-loss test (§16.4) rather than assumed correct from theory alone.
- Rebasing does **not** happen during the R0/R1 cosmos/nebula regimes at all — those regimes render at a *coarser* geometric scale (cluster billboards, not fine node geometry) where much larger `REBASE_THRESHOLD`-equivalent radii remain visually safe; tightening the rebase radius only matters once R2/R3 fine detail is on screen. This is an optimization, not just a simplification: rebasing has a real cost (rewriting every currently-instanced transform), so doing it as rarely as correctness allows matters for frame-time budget (§13).
- Rebasing must correctly update anything else keyed to world space: raycasting/picking caches, the minimap (§9.8), and any in-flight camera-animation targets (§8.4) — all of these read from the double-precision `WorldRegistry`, never cached copies of pre-rebase `Object3D.position` values, specifically to avoid a class of bug where "it renders fine but clicking picks the wrong node after a rebase."

#### 9.2.3 Tiered regimes as independent local coordinate spaces

Concretely, R0 (Cosmos) and R2 (Constellations) are **not** rendered in the same `Scene` graph simultaneously with real relative scale — that would reintroduce exactly the precision problem tiering is meant to avoid (a cluster centroid at cosmos-scale distance and a node at constellation-scale distance in the *same* float32 buffer). Instead:
- Each regime is its own `Scene` (or a clearly-delineated `Group` with its own coordinate convention), rendered with its own camera-relative framing, at a scale where "one world unit" means something reasonable *for that regime* (e.g., R0: one unit ≈ one cluster-diameter; R2: one unit ≈ one typical node-spacing).
- Regime transitions (§8.1's hysteresis-gapped crossing) cross-fade between the two regimes' scenes for a short window (e.g. 200-300ms) rather than trying to represent "mid-transition" as one coordinate space — this is a rendering-layer decision, invisible to the user, who just perceives continuous zoom.
- The **camera's conceptual "distance traveled"** across regime transitions is tracked as a separate abstract `zoomTier: number` (continuous, e.g. `2.37` meaning "37% of the way from tier 2 to tier 3"), independent of any single coordinate system — this is what actually drives the LOD/data-fetch logic (§9.4), not raw camera-to-origin distance in any one regime's coordinates.

#### 9.2.4 URL serialization reconciliation

Since §8.7 serializes camera position to the URL, and position is only meaningful relative to a local origin that itself resets on load, the serialized `x,y,z` are defined as **relative to the node identified by `focus` (or the graph's designated root if no focus)** rather than relative to whatever ephemeral local origin happened to be active when the link was generated. On load, the client resolves `focus`'s true double-precision world position (a single lookup, §10.6), sets that as the initial local origin, and only then applies the serialized relative offset — making links stable regardless of how many rebases occurred during the original session.

### 9.3 Rendering large numbers of nodes: instancing & LOD

#### 9.3.1 InstancedMesh as the base primitive for R1-R3

Every node in a given loaded chunk, for a given regime, is one instance of a small number of shared geometries (a sphere or icon-quad for "generic node," a handful of variant geometries for distinct node *types* if the graph schema has them) drawn via `THREE.InstancedMesh` — never one `Mesh`/one draw call per node. Per the research in §21, draw calls are the actual bottleneck at scale (hundreds of thousands of objects are renderable in a *single* draw call via instancing; the same count as individual meshes would be unusable well before 10,000).

```tsx
// src/features/universe/engine/node-instances.tsx
import { Instances, Instance } from "@react-three/drei";

function NodeInstances({ nodes }: { nodes: LoadedNode[] }) {
  return (
    <Instances limit={nodes.length} range={nodes.length} geometry={nodeGeometry} material={nodeMaterial}>
      {nodes.map((n) => (
        <Instance key={n.id} position={n.relativePosition} scale={n.displayScale} color={n.color} />
      ))}
    </Instances>
  );
}
```

In practice, for the hot path (per-frame updates as the floating origin rebases, or as streamed chunks arrive), bypass Drei's declarative `<Instance>` reconciliation and write directly to the `InstancedMesh`'s `instanceMatrix`/`instanceColor` buffers via a ref + `useFrame`, calling `mesh.instanceMatrix.needsUpdate = true` only once per frame after all writes — the declarative form above is fine for moderate counts and for initial implementation, but the imperative form is the one that should ship for R2 at realistic (5,000+ concurrently-loaded) node counts.

#### 9.3.2 Level of Detail via `<Detailed>` / manual distance-band swapping

`@react-three/drei`'s `<Detailed>` component swaps between provided child meshes based on camera distance, which maps directly onto this plan's R0-R3 regime boundaries — but because our regimes also change *data source* (not just geometric detail of the same objects, per §8.1's table), this plan uses `<Detailed>`-style distance banding **within** a regime (e.g., swapping a node's icon-quad for a slightly-higher-poly sphere as it grows on screen within R2) rather than *across* regimes, where the cross-fade/scene-swap mechanism from §9.2.3 is the actual mechanism.

#### 9.3.3 Edges

Edges render as `THREE.LineSegments` with a single shared `BufferGeometry` whose position buffer is rewritten (not recreated) whenever the visible node/edge set changes — recreating geometry buffers every chunk load would cause GC pressure and stutter. Additive blending + slight bloom (via `@react-three/postprocessing`'s `<Bloom>`, tuned conservatively — see §13 for the performance cost caveat on always-on post-processing) gives the "glowing connection" look without needing per-edge draw calls. Edge count at R2 can be large (potentially more than node count) — cap rendered edges per viewport to the N highest-weight relationships if the true count exceeds a budget (§13.3), with a subtle "+N more connections" indicator on a selected node's detail card rather than silently dropping data with no indication.

#### 9.3.4 Materials & shaders

- Nodes: a custom `ShaderMaterial` (not `MeshStandardMaterial`) so that (a) per-instance color/glow-intensity can be driven by an `instanceColor`/custom instanced attribute without material-instance explosion, and (b) the "soft glow" aesthetic (radial falloff on a billboarded quad, in R0/R1) can be done cheaply in a fragment shader rather than via real point lights (real lighting on tens of thousands of instances is a performance non-starter; this is a stylized data-viz, not a physically-lit scene — no real light sources are needed at all for R0/R1, and only minimal ambient + one directional "key light" for R2/R3 to give nodes subtle shape).
- Texture budget: node/cluster icon variants are packed into a single texture atlas (not one texture per node type) loaded once, referenced by a per-instance atlas-index attribute — keeps texture binds to a small constant count regardless of how many distinct node *types* the graph schema grows to.

### 9.4 Regime/LOD transition logic (the per-frame decision loop)

```ts
// src/features/universe/engine/regime-controller.ts
// Runs once per frame (inside a single top-level useFrame), NOT per-node.
function updateRegime(state: UniverseEngineState, camera: THREE.Camera) {
  const rawDistance = computePerceivedZoomDistance(state, camera); // §9.2.3's zoomTier input
  const candidate = classifyRegime(rawDistance); // R0..R3, using §8.1's thresholds

  if (candidate !== state.currentRegime) {
    const gapped = withinHysteresisBand(rawDistance, state.currentRegime, candidate);
    if (!gapped) return; // stay put — prevents boundary flicker (§8.1)
    beginRegimeTransition(state, state.currentRegime, candidate); // cross-fade, §9.2.3
  }

  ensureChunksLoadedForCurrentView(state, camera); // §9.6/§11 — chunk manager, debounced
}
```

Debouncing note: `ensureChunksLoadedForCurrentView` must not fire a network request every single frame just because the camera moved a tiny amount — it's driven off a **spatial hash of the camera's current viewport bounding volume + regime tier**, and only issues a fetch when that hash actually changes (i.e., the camera has moved far enough, or zoomed across enough of a tier, that a genuinely different tile *would* be needed) — see §11.2 for the exact tile-key derivation.

### 9.5 Picking / hit-testing at scale

Standard `Raycaster` against thousands of instances (even with `InstancedMesh`'s built-in per-instance raycast support) is workable up to moderate counts but degrades as loaded-node count grows, and gets worse if edges are also raycast-tested. Two-tier approach:
1. **Coarse pass:** a per-frame-maintained spatial index (a simple uniform grid or, if profiling demands it, an octree — see §9.6.2) narrows candidate instances to those near the ray *before* any exact raycast math runs.
2. **GPU picking fallback for R2/R3 hover, if the coarse CPU pass is ever profiled as a bottleneck:** render an offscreen, low-res "id buffer" (each instance's unique id encoded as a flat-shaded color) once per frame (or only on pointer-move, throttled), and resolve hover/click by reading back the single pixel under the cursor — this is the standard GPU-picking technique and sidesteps CPU raycasting entirely at the cost of one extra small render target. Flagged as a **fallback**, not built by default, to avoid the added complexity (readback latency, an extra render pass) unless the coarse CPU approach is measured (§16.4) to actually need it.

### 9.6 Off-main-thread work: Web Workers

Three named workers, each with a narrow, well-defined job — deliberately not one "do everything" worker, so failures/slowness in one (e.g., a pathological decode) don't block the others:

#### 9.6.1 `decode.worker.ts`
Parses the binary tile payload (§11.1's format) into typed arrays ready for direct upload into `InstancedMesh` buffers. Runs off the main thread specifically so a large tile's parse doesn't cause an input-handling stall on the floating island composer if the user is simultaneously typing while the universe streams in behind it (both panels can be "alive" per §6.3's off-tree mounting model).

#### 9.6.2 `cluster.worker.ts`
When the camera lands in a new viewport within R1/R2 and the freshly-fetched chunk of raw nodes needs *client-side* re-bucketing for rendering (e.g., grouping nodes that are extremely close together into a single visual "sub-cluster blob" purely for this frame's rendering, independent of the server's own precomputed `node_clusters_L*` tiers — a client-side micro-optimization, not a data-model concept), this worker builds a simple grid/quadtree spatial index over the currently-loaded node set. This also backs the coarse-pick spatial index from §9.5.

#### 9.6.3 `layout.worker.ts`
As covered in §9.1's library table: server-computed positions are primary. This worker's only job is a **cheap local relaxation pass** — when a new chunk of siblings streams in and would otherwise render exactly overlapping a parent/existing node (a real scenario: freshly-created graph nodes with no position hint yet), nudge them apart over a few frames using a minimal force simulation (`d3-force-3d`, or a hand-rolled 10-line repulsion pass — a full library dependency may be unnecessary for something this narrow; decide based on actual need once implementing) so they visually separate instead of rendering as a single indistinguishable blob. This must never contradict the server's authoritative position once that arrives (§10.5.3) — it's purely a transient, client-local visual smoothing applied only in the gap between "node exists, no position yet" and "server has assigned/persisted a position."

### 9.7 Camera controller

A custom controller (not `OrbitControls`/`MapControls` used unmodified — those assume a single fixed coordinate-space target and don't know about regime transitions or floating-origin rebasing), built on top of `three`'s low-level camera primitives:
- Maintains: current focal point (double-precision, world-registry-relative per §9.2.2), yaw/pitch (roll locked, per §8.6), and a continuous `zoomTier` float.
- Scroll/pinch deltas map to a **multiplicative** (not additive) change in the effective camera-to-focal distance within the current regime (`distance *= (1 - delta * sensitivity)`), which is what produces the perceptually-correct "zoom feels equally fast whether zoomed way out or way in" behavior (an additive/linear zoom feels absurdly fast when zoomed out and glacially slow zoomed in — the classic naive-zoom bug).
- Emits `onRegimeCrossing`, `onSettle` (movement stopped for >150ms — the trigger for both the URL-serialization write from §8.7 and any settle-time-only chunk-prefetch widening, §11.3), and `onFlightComplete` (for §8.4's scripted transitions) events consumed by the regime controller (§9.4) and the React-level UI (e.g., the "you are here" breadcrumb in the header, §6.2).
- Built as a plain TypeScript class (not a React hook) instantiated once per Universe mount and driven imperatively from a single `useFrame` — camera math has no business being re-derived through React's render cycle every frame.

### 9.8 Minimap / orientation aid

A small always-visible inset (bottom-left of the universe panel, never overlapping the floating island) showing the current regime's loaded-chunk footprint as a simple 2D top-down projection with a camera-position marker and a viewport-bounds rectangle. Rendered as a genuinely separate, tiny orthographic `three` scene (cheap — a few dozen dots), not a DOM/canvas2d minimap, so it can share the same instance data without a costly cross-representation sync step. Exists specifically to counter the disorientation risk inherent to "infinite zoom" navigation, flagged explicitly in the accessibility/UX risk register (§19).

---

## 10. ArangoDB Graph Model & Query Layer

### 10.1 Why the raw graph alone cannot back "zoom to infinity"

A literal AQL graph traversal from a root node, however cleverly filtered, is the wrong primary data path for R0/R1 (Cosmos/Nebulae). Traversals are excellent for "what's connected to X within N hops" (R2/R3's job), but they are the wrong tool for "give me a stable, cheap, aggregate picture of a million-node graph at a glance" — computing that aggregate live, per request, per zoomed-out viewport, would mean re-running expensive graph analytics (clustering, centrality-weighted sizing) on every camera movement. Per the research in §21: ArangoDB's own guidance is to bound traversal depth/result size aggressively and treat unbounded `GRAPH`/`FOR v,e,p IN` traversals as a performance cliff waiting to happen if not carefully limited with `FILTER`/`PRUNE`/`LIMIT`.

**Conclusion driving this whole section:** the universe's coarse regimes (R0/R1) are served from **materialized, precomputed cluster collections** (built by an offline/background job, §10.5), not live traversal. Only R2/R3 — where the visible node count is naturally small (tens to low thousands) because the camera is zoomed in — hit live AQL traversal against the real `nodes`/`edges` collections. This mirrors how real large-scale visualization systems (mapping tools, astronomy data viewers) universally work: precomputed tile pyramids for overview, live queries for detail.

### 10.2 Collections

```
nodes                  (document collection)
  _key, type, label, properties (object), weight (number, precomputed importance
                         score used for R0/R1 sizing and R2 label-priority, §8.5),
                         position (object: {x,y,z} — authoritative layout position,
                         §10.5.3), clusterPath (array of cluster ids, one per LOD
                         tier this node rolls up into — see §10.5.2), createdAt,
                         updatedAt

edges                   (edge collection: _from, _to)
  _key, _from, _to, type, weight, properties (object), createdAt

node_clusters_L0 .. L{N} (document collections, one per LOD tier, coarsest = L0)
  _key, tier (number), centroid ({x,y,z}), radius (number — bounding radius of
                         the real nodes/sub-clusters this centroid represents),
                         memberCount (number), childClusterIds (array, empty for
                         the finest materialized tier, which instead references
                         real node ids directly via memberSampleIds), label
                         (optional human-readable summary, e.g. "Payments
                         subsystem (412 nodes)"), lastRebuiltAt

users, sessions, mfa_factors      (auth collections — see §4)
chat_threads, chat_messages       (chat persistence — see §7.2)
```

Indexes:
- `nodes`: persistent index on `type`, geo/spatial-style composite index isn't natively meaningful here since `position` is a layout coordinate not a geo-coordinate — instead a custom **grid-cell index** field (`gridCell: "L2:14,-3,7"`, precomputed at write time from `position` + tier, §10.4) with a persistent index on `gridCell`, which is what viewport-bounded chunk queries actually filter on (cheap equality/prefix match instead of expensive range math per query).
- `edges`: standard edge index (ArangoDB provides this automatically), plus persistent index on `type` for relationship-type filtering.
- `node_clusters_L*`: persistent index on `gridCell` (same convention) and on `tier`.

### 10.3 Why a grid-cell index instead of relying on traversal alone for R2/R3

R2/R3 queries are fundamentally **"what's near the camera, within this loaded tier"** — a spatial range query, not a graph-shape query. Modeling this as a precomputed discrete grid cell (a coarse voxelization of `position`-space at each tier's characteristic scale) turns "find nodes near the camera" into an indexed equality/prefix lookup on a handful of neighboring cell ids, which is dramatically cheaper and more predictable than computing distance-from-camera for every candidate node server-side. The *graph* traversal (finding a node's edges/neighbors) still happens via AQL's native graph features **after** the spatial cell lookup has already narrowed the candidate set — the two query patterns compose, they don't compete.

```
gridCell derivation (computed at write-time, stored denormalized on the node/cluster doc):
  cellSize(tier) = baseCellSize * (growthFactor ** tier)
  gridCell = `L${tier}:${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`
```

### 10.4 Chunked fetch queries (AQL)

#### 10.4.1 R0/R1 — cluster tile fetch (no traversal, pure spatial + collection scan by cell)

```aql
// Fetch all cluster documents for a given tier that fall within the requested
// set of grid cells (the client computes which cells its current viewport
// frustum touches, and sends that list — see §11.2).
FOR c IN node_clusters_L2
  FILTER c.gridCell IN @cellIds
  LIMIT @batchSize
  RETURN {
    id: c._key,
    centroid: c.centroid,
    radius: c.radius,
    memberCount: c.memberCount,
    label: c.label
  }
```

Bound variables: `@cellIds` (array, capped client-side to a sane max — see §11.2), `@batchSize` (server-enforced ceiling regardless of what the client requests, e.g. 500 clusters per response — a Cosmos-tier tile should never realistically need more than a few hundred cluster points on screen at once given §8.5's label-density constraints apply analogously to cluster labels).

#### 10.4.2 R2/R3 — real node + edge fetch, viewport-bounded, traversal-assisted

```aql
// Step 1: candidate nodes within the viewport's grid cells at the active tier.
LET candidateNodes = (
  FOR n IN nodes
    FILTER n.gridCell IN @cellIds
    LIMIT @nodeBatchSize
    RETURN n
)

// Step 2: edges *between* candidate nodes only (never traverse outward to
// nodes outside the viewport in this query — that's a separate, deliberate
// "expand neighborhood" query triggered only on selection, §10.4.3).
LET candidateIds = candidateNodes[*]._key
FOR e IN edges
  FILTER e._from IN candidateIds AND e._to IN candidateIds
  LIMIT @edgeBatchSize
  RETURN e
```

This two-step shape (candidate nodes via spatial filter, then edges restricted to *within* that candidate set) is the direct AQL expression of §10.1's principle: bound the traversal by first bounding the vertex set spatially, never the other way around. Per the ArangoDB best-practices research (§21): always filter/prune before letting a traversal or join fan out, and always cap with `LIMIT`.

#### 10.4.3 Selection-triggered neighborhood expansion (R3 "inspect" detail)

When a user selects a single node in R3, a *separate, small, bounded* traversal fetches its immediate neighborhood even if some neighbors fall outside the current viewport cells (this is the one place true graph traversal — not spatial filtering — drives what's fetched, and it's deliberately scoped to a single node, not the whole viewport):

```aql
FOR v, e, p IN 1..1 ANY @nodeId edges
  OPTIONS { uniqueVertices: "global", bfs: true }
  LIMIT 200
  RETURN { vertex: v, edge: e }
```

`1..1` (one hop only) and a hard `LIMIT 200` are both deliberate — this is a detail-inspection affordance ("show me what connects to this"), not a graph-exploration/traversal feature; a node with more than 200 immediate neighbors gets a "+N more" affordance identical in spirit to §9.3.3's edge-count cap, with pagination available (`OFFSET`, or better, a cursor per §10.4.4) if the user explicitly asks to see more.

#### 10.4.4 Cursor-based batching for any query whose result could exceed one round-trip

Per ArangoDB's own cursor semantics (§21): a query executed with a bounded `batchSize` returns only the first batch immediately, plus a cursor id: the client (here, the Next.js proxy route, §11) must explicitly fetch subsequent batches and **must delete the cursor when done** to free server resources — this is not optional cleanup, it's explicitly called out as required good practice.

```
POST /_api/cursor
{ "query": "...", "bindVars": {...}, "batchSize": 500, "ttl": 30 }
→ { "result": [...], "hasMore": true, "id": "123456" }

PUT /_api/cursor/123456                      // fetch next batch
→ { "result": [...], "hasMore": false, "id": "123456" }

DELETE /_api/cursor/123456                   // MUST be called once hasMore is false
                                              // reached OR the client abandons the
                                              // query early (e.g. user zoomed away
                                              // before finishing pagination)
```

The backend's tile endpoint (§11) wraps this cursor lifecycle entirely — the frontend never sees ArangoDB cursor ids directly; it only sees the frontend-facing pagination contract from §11.1 (an opaque `nextChunkToken`). This keeps the ArangoDB-specific cursor-cleanup obligation as a backend concern, not something the browser needs to get right (a browser tab closing mid-pagination must not leak an ArangoDB cursor forever — the backend applies its own `ttl` on the cursor, per the example above, as the actual backstop, since it cannot rely on the client always calling DELETE).

### 10.5 Precomputing the LOD cluster pyramid

#### 10.5.1 The core idea: a tile pyramid, exactly like map tiles

This is the same conceptual structure as web-map tile pyramids (Google Maps/Mapbox): a small number of discrete zoom levels, each level a coarser aggregation of the level below it, all precomputed ahead of time so that serving any given tile at any given zoom level is a cheap indexed lookup, never a live aggregation. `node_clusters_L0` is the coarsest (few hundred clusters covering the *entire* graph), each successive `L{n}` roughly `growthFactor`-times finer (a tunable, e.g. 8-16x member count reduction per tier), until `L{N}` is fine enough that its "clusters" are small enough groups (single-digit to low-double-digit real nodes) that R2's live query takes over.

#### 10.5.2 Build algorithm (background job, not request-time)

1. **Bottom-up hierarchical clustering** over `nodes.position` (already-laid-out coordinates, §10.5.3) using a simple, deterministic, spatially-local method — a grid/quadtree-based agglomeration (bucket nodes into the finest grid, merge adjacent buckets pairwise/octet-wise up each tier) rather than a generic clustering algorithm (k-means, HDBSCAN) — deliberately, because the grid-based approach guarantees *spatial locality* (a cluster's members are always physically near its centroid) which is the property the rendering/viewport-query system in §10.3/§10.4.1 actually depends on, whereas generic clustering algorithms optimize for statistical cohesion and can produce spatially-scattered clusters that would break the "gridCell lookup ≈ what's on screen" assumption.
2. For each tier from finest to coarsest: compute each cluster's `centroid` (weighted mean position of members), `radius` (bounding radius covering all members, used for the billboard's on-screen size), `memberCount`, and `gridCell` (derived from the centroid at that tier's cell size).
3. Write `clusterPath` back onto every real `nodes` document (the array of cluster ids this node rolls up into, one per tier) — this is what lets a client, upon selecting a cluster in R1, know exactly which finer clusters/nodes to fetch next without re-deriving membership.
4. Store `lastRebuiltAt`; the whole pyramid is versioned as a unit (see §10.5.4) — a client should never see a mix of a stale `L0` against a freshly-rebuilt `L1`, which would produce visually inconsistent nesting (a cluster whose child-tier centroids don't actually average back to its own centroid).

#### 10.5.3 Where do node *positions* come from in the first place?

Out of scope to fully prescribe (depends on the actual graph's semantics — is it a knowledge graph, an org chart, a dependency graph?), but this plan requires the backend to run **one deterministic layout algorithm once per node** (on creation, and re-run for affected neighborhoods on significant edge changes — not continuously): a 3D force-directed layout (`d3-force-3d` or ngraph, run server-side as an offline batch job, explicitly not the GPU/interactive kind — determinism and reproducibility matter more than speed for a job that runs occasionally in the background) seeded by a stable hash of `_key` so that reruns are reproducible rather than randomly re-shuffling the whole universe's geography every rebuild (users would lose their spatial mental model of "where things are" on every backend redeploy otherwise — a real risk called out again in §19).

#### 10.5.4 Rebuild cadence & versioning

- Full pyramid rebuild: infrequent (e.g., nightly, or triggered manually) — this is the expensive, whole-graph pass.
- Incremental local update: on individual node/edge writes, update just the affected leaf grid cell and propagate a lightweight recompute up that cell's ancestor chain only (touching a handful of cluster documents, not the whole pyramid) — this is what keeps the realtime change feed (§11.4) meaningfully fast, since a single new node shouldn't require a full nightly-scale rebuild to become visible.
- `pyramidVersion` (a monotonic integer or timestamp) stamped on every cluster doc and returned in every tile response (§11.1) — the client includes the last-seen `pyramidVersion` in cache keys (§12.2) so a background rebuild automatically invalidates stale client caches without needing an explicit push/broadcast for the common case (only the realtime change feed, §11.4, needs actual push semantics, for the *incremental* update path).

### 10.6 Node detail endpoint

```aql
FOR n IN nodes
  FILTER n._key == @nodeId
  LET neighborCount = LENGTH(FOR e IN edges FILTER e._from == n._id OR e._to == n._id RETURN 1)
  RETURN MERGE(n, { neighborCount })
```
Backing `/console/u`'s R3 detail card (§8.1) and the "View in Universe" chat citation jump (§7.9) — a single-document lookup by key is O(1) via ArangoDB's primary index, deliberately not routed through the grid-cell/spatial machinery at all since we already know the exact id.

### 10.7 Search endpoint (fuzzy node search for the floating island's Universe command bar, §6.5)

Backed by ArangoSearch (ArangoDB's built-in full-text/fuzzy search view) over `nodes.label` (and `type`), rather than a bolt-on external search service for v1 — sufficient for node-name/type lookup at the scale this product starts at, revisit only if search relevance/scale needs clearly outgrow it (flagged in §19, not solved preemptively).

```aql
FOR n IN nodesSearchView
  SEARCH ANALYZER(n.label IN TOKENS(@query, "text_en"), "text_en")
  SORT BM25(n) DESC
  LIMIT 20
  RETURN { id: n._key, label: n.label, type: n.type, position: n.position }
```

### 10.8 Backend service responsibilities summary (frontend-relevant contract only)

The frontend does not need to know *how* the backend implements the above — only that it exposes, over HTTP (proxied through Next.js per §2.3):

- `GET /universe/tiles?tier=&cells=&pyramidVersion=&cursor=` — §11.1
- `GET /universe/nodes/:id` — §10.6
- `GET /universe/nodes/:id/neighbors` — §10.4.3
- `GET /universe/search?q=` — §10.7
- `WS /universe/stream` — §11.4
- Standard auth/chat endpoints per §4 and §7.3

---

## 11. Chunk Streaming Protocol (Frontend ⟷ Backend Contract)

### 11.1 Tile response shape

Chosen format: **binary, not JSON**, for the tile payload body specifically (auth/chat endpoints remain JSON) — because tile payloads are dense arrays of numbers (positions, colors, sizes) at potentially thousands of entries per response, and JSON's per-number text encoding overhead (plus parse cost) is a measurable tax at this volume that a typed binary layout avoids entirely.

```
Response: application/octet-stream, custom framing:

┌─────────────┬──────────────┬───────────────┬──────────────────────────────┐
│ header (JSON,│ node count   │ Float32Array  │ Uint32Array (ids, as indices │
│ length-      │ (uint32)     │ positions     │ into a parallel string table │
│ prefixed)    │              │ (x,y,z)*count │ sent once per session, not   │
│              │              │               │ repeated per tile)           │
└─────────────┴──────────────┴───────────────┴──────────────────────────────┘

header = {
  tier: number,
  pyramidVersion: string,
  cellIds: string[],        // echoes what was requested, for client-side cache keying
  nextChunkToken: string | null,  // opaque — wraps the backend's ArangoDB cursor id,
                                   // §10.4.4 — null means this tile is complete
  memberCounts?: Uint32Array bytes (cluster tiles only),
  colors?: Uint8Array bytes (packed RGBA, optional per-node override color)
}
```

Parsing happens inside `decode.worker.ts` (§9.6.1); the main thread only ever receives already-typed-array-ready structures via `postMessage` with transferable `ArrayBuffer`s (zero-copy transfer, not structured-clone-copy) back to the main thread for direct upload into `InstancedMesh` buffers.

### 11.2 Cell-id computation (client) & request coalescing

The client derives the set of `gridCell` ids its current camera frustum intersects (using the same `cellSize(tier)` formula as §10.3, kept in a small shared constants module imported by both the client engine and documented for backend parity — this formula must be identical on both sides or the spatial index simply won't line up) and issues a single request per "meaningfully new" viewport (§9.4's debounce). Requests are coalesced: if the camera moves again before an in-flight tile request resolves, and the new cell set is a superset/different-enough set, the in-flight request is not necessarily aborted (its data is still valid and will be cached, §12.2) but a *new* request is queued rather than issued immediately, capped to at most 2 concurrent in-flight tile requests to avoid saturating the connection pool during fast camera movement (browsers cap concurrent same-origin HTTP/1.1 connections; even over HTTP/2 multiplexing, unbounded concurrent tile requests during a fast pan would still waste bandwidth on tiles that are stale by the time they'd arrive).

### 11.3 Prefetch radius

Beyond the exact cells the current viewport intersects, the client also requests a **one-ring buffer** of adjacent cells at the current tier (prefetch, lower priority, cancellable) so that panning doesn't show a visible pop-in edge at the exact viewport boundary — matches standard map-tile prefetching practice. On `onSettle` (§9.7 — camera stopped moving for >150ms), the prefetch ring widens to two rings, since a stationary camera has spare bandwidth budget to prepare for whatever the user does next.

### 11.4 Realtime change feed

A single WebSocket connection (`/api/universe/stream`, Next.js route handler upgrading to a proxied WS connection to the backend — see §3.5's note on why this needs the Node.js runtime, not Edge) delivers small, JSON (not binary — these are low-frequency, low-volume events, unlike tile payloads) change events:

```ts
type UniverseChangeEvent =
  | { type: "node_created"; nodeId: string; gridCell: string; tier: number; position: [number, number, number] }
  | { type: "node_updated"; nodeId: string; gridCell: string }
  | { type: "node_deleted"; nodeId: string; gridCell: string }
  | { type: "edge_created" | "edge_deleted"; from: string; to: string }
  | { type: "cluster_rebuilt"; tier: number; pyramidVersion: string; affectedCells: string[] };
```

Client behavior: events whose `gridCell` (or `affectedCells`) intersects a currently-loaded tile invalidate that tile's TanStack Query cache entry (§12.2) and, if the affected region is on screen right now, trigger the §8.6 fade-in; events for cells outside anything currently loaded are simply dropped (nothing to invalidate) except that they still count toward the §6.6 cross-mode activity pulse if relevant. Reconnection uses standard exponential backoff; on reconnect, the client sends its last-known `pyramidVersion` + a coarse "which tiers/cells am I currently holding cached" summary so the backend can optionally replay any missed events for those regions rather than requiring a full cache flush after every disconnect.

---

## 12. State Management Architecture

### 12.1 The three state systems, and why none of them is asked to do the others' job

A common mistake in ambitious real-time/3D apps is reaching for one state library to do everything (server cache, UI state, and per-frame render state all in one Redux/Zustand store). This plan deliberately splits state into three systems with three different update-frequency profiles, because forcing all three through one system either makes the low-frequency stuff overly ceremonious or — worse — makes React re-render on every 60fps camera tick.

| System | Owns | Update frequency | Lives in React's render cycle? |
|---|---|---|---|
| **TanStack Query** | Server-derived data: chat messages, universe tiles, node details, search results, session/user profile | Low-to-medium (network-driven) | Yes — this is exactly what it's for |
| **Zustand** (small, purpose-built stores) | Cross-component UI state: console mode, floating island expanded/collapsed, selected node id, "other mode activity" pulse | Low-to-medium (user-interaction-driven) | Yes, but with selective subscriptions so unrelated components don't re-render |
| **Imperative engine state** (plain classes/closures, no state library) | Camera position/orientation, per-instance transforms, floating-origin registry, regime/zoomTier | Every frame (60-120Hz) | **No** — deliberately outside React entirely; React only reads *derived, throttled* snapshots of this (e.g., the header's "you are here" breadcrumb subscribes to an `onSettle`-throttled projection, not the raw per-frame camera state) |

`Providers.tsx` (existing file, extended) gains a `QueryClientProvider` wrapping the whole app (not just `/console` — the marketing site's waitlist form could migrate onto the same client later, though that's out of scope here) with sensible defaults:

```tsx
// src/app/providers.tsx (excerpt — additive to existing providers)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => isRetryableError(error) && failureCount < 2,
      refetchOnWindowFocus: false, // a background universe tile refetch on tab-focus
                                    // would be jarring mid-exploration; realtime feed
                                    // (§11.4) is the actual freshness mechanism instead
    },
  },
});
```

### 12.2 Query key conventions

```ts
const queryKeys = {
  chatThread: (threadId: string) => ["chat", "thread", threadId] as const,
  chatMessages: (threadId: string, cursor?: string) => ["chat", "thread", threadId, "messages", cursor] as const,
  universeTile: (tier: number, cellIds: string[], pyramidVersion: string) =>
    ["universe", "tile", tier, [...cellIds].sort().join(","), pyramidVersion] as const,
  nodeDetail: (nodeId: string) => ["universe", "node", nodeId] as const,
  universeSearch: (query: string) => ["universe", "search", query] as const,
};
```

Two conventions worth calling out explicitly because they're easy to get subtly wrong:
- `cellIds` is **sorted before joining** into the key — the same set of cells requested in a different order (which can happen depending on frustum-intersection iteration order) must produce the same cache key, or the app will silently duplicate-fetch identical tiles.
- `pyramidVersion` is part of the key (per §10.5.4) specifically so a background LOD rebuild invalidates old tiles **by simply making old keys unreachable** rather than requiring an explicit `queryClient.invalidateQueries` broadcast for the common (non-realtime) rebuild case — stale entries just age out of the cache's LRU naturally since nothing will ever request them again.
- The `localId → realId` reconciliation from §7.8 is implemented as `queryClient.setQueryData` under the new key followed by `queryClient.removeQueries` under the old — never a silent in-place mutation of the old key, which would leave a dangling reference if anything (e.g. a still-mounted component reading the old key) raced the swap.

### 12.3 Zustand store shapes

```ts
// src/features/console/store/console-mode-store.ts
type ConsoleModeStore = {
  mode: "chat" | "universe";
  hasOtherModeActivity: boolean;
  setMode: (mode: "chat" | "universe") => void;
  markOtherModeActivity: () => void;
};

// src/features/universe/store/selection-store.ts
type SelectionStore = {
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  select: (nodeId: string | null) => void;
  hover: (nodeId: string | null) => void;
};
```

Selective subscription example (why this matters): the header's mode-toggle icon subscribes only to `mode` and `hasOtherModeActivity`, via `useConsoleModeStore((s) => ({ mode: s.mode, pulse: s.hasOtherModeActivity }))` with Zustand's shallow-equality selector support — it must never subscribe to the whole store object, or every unrelated store update (e.g. a future field added to this store) would re-render the header needlessly.

### 12.4 The bridge between imperative engine state and React

```ts
// src/features/universe/engine/engine-bridge.ts
// A tiny pub-sub the imperative camera controller (§9.7) pushes throttled
// snapshots into; React components subscribe via a hook, never by reading
// the engine's live objects directly.
class EngineBridge {
  private listeners = new Set<(snap: EngineSnapshot) => void>();
  publish(snap: EngineSnapshot) { for (const l of this.listeners) l(snap); }
  subscribe(fn: (snap: EngineSnapshot) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

type EngineSnapshot = {
  regime: "R0" | "R1" | "R2" | "R3";
  zoomTier: number;
  breadcrumb: string; // e.g. "Universe / Cluster “Payments” / Node “refund_flow”"
};

function useEngineSnapshot() {
  return useSyncExternalStore(engineBridge.subscribe, engineBridge.getSnapshot);
}
```

`useSyncExternalStore` (React 18+/19) is the correct primitive here specifically because it's designed for exactly this "external, non-React-owned state that React needs to read a consistent snapshot of" case — using a plain `useState` + manual subscription would risk tearing under React 19's concurrent rendering.

---

## 13. Performance Budgets & Benchmarks

### 13.1 Frame budget

Target: sustained 60fps (16.6ms/frame) on a mid-tier laptop GPU (integrated graphics, e.g. Apple M-series base tier or a mainstream Windows laptop iGPU — not a discrete gaming GPU baseline) with up to **5,000 concurrently-instanced nodes + 8,000 edges** loaded in R2. Explicit per-frame time slices (soft budget, measured via `<PerformanceMonitor>` from Drei, §9.1):

| Slice | Budget | Notes |
|---|---|---|
| Instance transform writes (new chunk arrivals, rebase rewrites) | ≤ 3ms | Amortized — a full-chunk rewrite should be spread across a few frames if it would otherwise blow this budget in one frame, rather than blocking |
| Regime/LOD classification + chunk-need check | ≤ 0.5ms | Per §9.4 — cheap distance math only, no allocation in the hot path |
| Raycasting/picking (on pointer-move, R2/R3 only) | ≤ 2ms | Coarse-pass first (§9.5); GPU-picking fallback only engaged if this is exceeded in profiling |
| Render (draw calls + GPU) | remaining budget | Should be the dominant cost, as intended — this is where instancing's payoff shows up |

### 13.2 Adaptive quality

`@react-three/drei`'s `<PerformanceMonitor>` (or an equivalent hand-rolled rolling-average FPS tracker) drives a small number of discrete quality tiers, stepped down automatically if sustained frame time exceeds budget for >1 second, and stepped back up if headroom returns for >3 seconds (asymmetric hysteresis — quick to protect frame rate, slow to add load back, to avoid oscillation):

1. Disable bloom/post-processing (§9.3.3's caveat) first — highest cost-to-visual-benefit ratio to cut.
2. Reduce prefetch ring from 2 to 1 (§11.3) — reduces background network/decode work, not visual quality directly, but frees the main thread for rendering.
3. Reduce edge-render cap (§9.3.3) further.
4. As a last resort, drop the minimap's (§9.8) update rate from every frame to every 4th frame.

### 13.3 Network/data budgets

- Tile response target size: ≤ 150KB per tile request (binary framing from §11.1 makes this achievable even at several thousand nodes per tile — back-of-envelope: 5,000 nodes × 12 bytes (3×float32 position) ≈ 60KB, well within budget even before considering that R0/R1 cluster tiles carry far fewer entities).
- Target time-to-first-visible-tile on cold `/console/u` load: ≤ 500ms on a broadband connection (this is why §5.2's server-side prefetch hint and §2.4's Fluid-Compute-instance-reuse both matter — cold-start latency on the very first tile request directly determines whether the universe "feels instant").
- Realtime WS event budget: assume bursts, not steady drips (e.g., a bulk import creating 500 nodes at once) — the client must coalesce a burst of `node_created` events for the same tile/cell into a single cache invalidation + single fade-in batch, not 500 individual re-renders.

### 13.4 Bundle size budgets

- Chat-mode-only initial JS (i.e., before Universe is ever toggled to): must not include `three`/`@react-three/*` at all — enforced via the dynamic-import boundary in §9.1, and verified in CI (§16.5) with a bundle-analyzer size assertion, not just code review, since it's easy for a careless import to accidentally pull the Three.js dependency graph into a shared chunk.
- Universe bundle (loaded on first toggle): budgeted at ≤ 400KB gzipped for the `three` + R3F + drei + engine code combined — a generous but bounded target; if a needed drei helper or postprocessing effect would blow this, prefer hand-rolling the narrow slice actually needed over pulling in the whole package.

---

## 14. Accessibility & Degraded-Mode Strategy

### 14.1 The hard truth about 3D and accessibility

A freely-navigable, infinitely-zoomable 3D scene is inherently difficult to make fully screen-reader-accessible in the traditional sense — there is no honest way to make free-form spatial WebGL navigation equivalent to a linear DOM reading order. This plan does not claim otherwise. Instead, it commits to two things: (a) the **Chat mode is fully accessible** (it's a standard, semantic, keyboard-navigable conversation UI — no excuse for gaps there), and (b) the **Universe mode ships a genuinely usable non-spatial alternative**, not just an apology, per §14.3.

### 14.2 Capability detection (via `instrumentation-client.ts`, per §3.6)

```ts
// src/instrumentation-client.ts
export function register() {
  const gl = detectWebGL2Support();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const memoryClass = estimateDeviceMemoryClass(); // navigator.deviceMemory, coarse buckets
  writeCapabilitySnapshot({ webgl2: gl, reducedMotion, memoryClass });
}
```

This runs before the console shell decides whether to even offer the Universe toggle as a live 3D experience vs. falling back (§14.3). Running it this early (per Next 16's `instrumentation-client.ts` convention, §3.6) avoids a flash where the toggle briefly renders in one mode then re-renders in the fallback mode once detection resolves client-side later.

### 14.3 Degraded modes

| Condition | Fallback |
|---|---|
| No WebGL2 support | Universe mode's header icon still exists, but toggling opens a **2D list/table view** of the graph (searchable, filterable, paginated — reusing the existing `data-grid` component from `src/shared/packages/ui`) instead of the Three.js canvas. Framed positively ("Explore as a list") not as an error banner. |
| `prefers-reduced-motion: reduce` | The 3D canvas still renders, but: fly-to transitions (§8.4) become instant cuts rather than animated flights; the ambient starfield/parallax (§8.2) is static rather than subtly drifting; regime cross-fades (§9.2.3) shorten to a near-instant opacity swap. Zoom itself (a direct manipulation the user is actively driving) is **not** disabled under reduced-motion — reduced-motion targets *automatic* animation, not user-driven camera control, matching WCAG's actual intent. |
| Low `memoryClass` (heuristic: `navigator.deviceMemory <= 2` or absent+mobile UA) | R2/R3's node-count-per-tile ceiling (§13.3) is reduced by ~4x, and bloom/post-processing (§13.2's tier 1) is disabled by default rather than only on measured frame drops — proactive rather than reactive for known-constrained devices. |
| Keyboard-only navigation, WebGL available | Tab-order includes the floating island's Universe command bar (§6.5) and the search results list; arrow keys, once a search result or the minimap is focused, nudge the camera in fixed steps (a discrete, predictable keyboard camera mode) rather than requiring pointer-drag orbit — this is the practical "keyboard-accessible enough to actually explore, even if not identical to mouse/touch" middle ground. |

### 14.4 Chat mode accessibility (the non-negotiable baseline)

- Message list is a semantically correct `role="log"` `aria-live="polite"` region (streaming assistant text is announced incrementally but throttled — not word-by-word, which would be unusable with a screen reader; batched at sentence/paragraph boundaries).
- Full keyboard operability: composer focus, send (`Enter`), stop-generating (a real focusable button, not only reachable via mouse), regenerate, and per-message actions (copy, "view in universe" citation links from §7.9) are all in natural tab order.
- Respects the existing shared UI package's established accessibility patterns (Radix primitives already in use elsewhere in this repo for dialogs/dropdowns/tooltips) rather than hand-rolling new focus-trap/dismiss logic for the floating island's any popovers.

---

## 15. Security & Abuse Considerations

### 15.1 MFA-specific

- TOTP secret material never touches the frontend beyond the enrollment QR/URI moment (already true of the existing `TotpSetup` component's design — it receives a pre-rendered QR image and a deep-link URI from the backend, never the raw secret as a copyable string in the DOM, avoiding an easy clipboard/screenshot leak vector).
- Rate limiting + lockout on `/login/verify` (§4.5) — backend-enforced, frontend only reflects the signaled state.
- The partial (`mfa_required`) session cookie (§4.3) must be scoped narrowly (short TTL, and — critically — the backend must reject any request to a non-verify endpoint while a session is in `mfa_required` state, even if a client attempted to skip straight to `/console` API calls with that cookie; `proxy.ts`'s optimistic check is a UX convenience, not the security boundary — the security boundary is entirely backend-side, per Next's own authentication guide's explicit warning that Proxy "should not be your only line of defense").

### 15.2 Universe/graph-specific

- **Query cost abuse:** a malicious or buggy client could request an enormous `cellIds` array or an excessive `batchSize` to force an expensive backend query. The backend must clamp both regardless of what the client sends (§10.4.1's `@batchSize` is described as server-enforced, not client-trusted, deliberately).
- **Data exposure via node detail/search:** if the graph ever contains per-tenant or per-user-scoped data (likely, given this is a product feature, not a public dataset), every query in §10.4 must be scoped by an authenticated tenant/user filter — this plan's AQL sketches omit that filter for clarity but it is **mandatory** in the real implementation; flagged explicitly here so it isn't lost in translation from plan to code. `FILTER n.tenantId == @tenantId` (or equivalent) must be the *first* filter applied, before the spatial `gridCell` filter, in every query in §10.4.
- **WebSocket auth:** the realtime stream (§11.4) upgrade must carry the same session validation as any other authenticated request — an upgraded WS connection that outlives a since-revoked session is a real risk (long-lived connections don't automatically re-check auth the way a fresh HTTP request would); the backend should periodically re-validate the session on a live WS connection (e.g., every few minutes) and close the socket if it's no longer valid, with the client treating that closure as a trigger to re-run `verifySession()`.

### 15.3 Chat-specific

- Treat the chat composer as untrusted input into whatever LLM/tool-calling backend receives it — standard prompt-injection hygiene applies to the `search_universe` tool specifically (§7.9): tool results returned from the graph should be clearly delineated from user/assistant conversational turns in whatever the backend sends the model, so graph node *labels* (which could theoretically contain adversarial text if the graph ingests any external/user-supplied content) can't be mistaken by the model for system instructions. This is a backend-side prompt-construction concern, noted here because the frontend's `search_universe` tool-call rendering (§7.9) should also visually distinguish "this text came from a graph node" from "this text came from the assistant," reinforcing the same boundary in the UI.

---

## 16. Testing Strategy

### 16.1 Chat mode

- Component tests (existing repo tooling, extended, not replaced) for the composer's Enter/Shift+Enter/IME-composition edge cases (§7.7) — these are exactly the class of bug that regresses silently without a regression test, since they only manifest for specific input methods/timings.
- Streaming markdown incremental-render tests: feed a token stream in with fences split mid-token (e.g., a chunk boundary landing in the middle of a triple-backtick) and assert no flicker/incorrect intermediate render — the fence-boundary-splits-mid-chunk case is the one most likely to be missed by hand-testing since it requires an unlucky network chunk boundary to reproduce manually.
- Scroll-anchor tests (§7.6, rule 5) — load older messages while scrolled partway up and assert zero visible `scrollTop` jump (measured, not eyeballed).

### 16.2 Universe engine

- Unit tests for the floating-origin rebase math (§9.2.2) in isolation — feed synthetic camera paths that cross `REBASE_THRESHOLD` repeatedly and assert the double-precision `WorldRegistry` positions remain exact (bit-for-bit, since these are stored as doubles) regardless of how many rebases occurred.
- Unit tests for `cellSize(tier)`/`gridCell` derivation, shared between a Node-based test harness and (conceptually) the backend's implementation of the same formula — ideally this formula is literally shared code (a small isomorphic module) rather than independently reimplemented twice, to eliminate an entire class of "client and server disagree about grid cells" bugs by construction.
- Visual/perceptual regression: since this is fundamentally a graphics feature, a suite of scripted camera-path recordings (fixed seed, fixed synthetic dataset) rendered headlessly (`three`'s software/WebGL-in-CI options, or a real headless-Chrome run) with pixel-diff assertions against golden frames, specifically targeting regime-transition frames (§9.2.3's cross-fade) where subtle regressions are otherwise easy to ship unnoticed.

### 16.3 ArangoDB query layer

- Every AQL query in §10.4 gets an `EXPLAIN`-based test (assert the query plan actually uses the intended index, e.g. the `gridCell` persistent index — not a full collection scan) run against a seeded test database — this catches the specific, insidious failure mode where a query *works* but silently degrades to a full scan after a schema/index change, which functional tests alone would never catch (it'd still return correct results, just slowly, until it's a production incident).
- Load-shaped tests: seed a synthetic graph at realistic scale (hundreds of thousands of nodes) and assert tile-fetch p95 latency stays within §13.3's budget.

### 16.4 Precision/performance validation

- The `REBASE_THRESHOLD` value (§9.2.2) and the frame budgets (§13.1) are **not** committed as guesses — both require an actual measured spike/prototype pass (a small standalone Three.js scene exercising just the floating-origin + instancing mechanics at target scale, before the full feature is built) whose results feed back into this document as corrections. This is called out explicitly as a **required pre-implementation spike**, not an optional nice-to-have — see §18's roadmap, where it's the literal first engineering task.

### 16.5 CI enforcement

- Bundle-size budget assertions (§13.4) as a CI gate, not just a dashboard — a PR that regresses the chat-only bundle to include `three` should fail CI, not merge with a "we'll fix it later" comment.
- `typecheck` (already an existing `package.json` script) extended to cover all new `src/features/*` code — no new `any`-typed escape hatches for the engine bridge (§12.4) or the binary tile decoder (§11.1), both of which are exactly the kind of code where a type error silently becoming a runtime NaN-position bug is costly to debug.

---

## 17. Component API Sketches (TypeScript)

This section pins down concrete prop/interface contracts for every non-trivial component named earlier in this document, so implementation can proceed from a shared vocabulary rather than re-deriving shapes ad hoc per file. Organized by feature folder, matching the file structure in §5 and §18.

### 17.1 `src/features/console/*` — shell chrome

```ts
// console-shell.tsx
export type Session = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  mfaLevel: "totp";
};

export type ConsoleShellProps = {
  session: Session;
  children: React.ReactNode; // the (chat) route group's rendered page
};

// console-header.tsx
export type ConsoleHeaderProps = {
  mode: "chat" | "universe";
  onToggleMode: () => void;
  breadcrumb?: string;        // from useEngineSnapshot() in universe mode; thread
                               // title in chat mode
  hasOtherModeActivity: boolean;
  session: Session;
};

// mode-toggle-button.tsx
export type ModeToggleButtonProps = {
  mode: "chat" | "universe";
  onToggleMode: () => void;
  hasOtherModeActivity: boolean;
  disabled?: boolean; // true while the Universe bundle is still lazy-loading
                       // on first-ever toggle (§9.1) — shows a spinner overlay
                       // rather than a dead click
};

// floating-island/floating-island-host.tsx
export type FloatingIslandHostProps = {
  mode: "chat" | "universe";
};

// floating-island/chat-composer.tsx
export type ChatComposerProps = {
  threadId: string; // "new" sentinel or a real id, §7.2
  onSend: (message: OutgoingMessage) => void;
  isStreaming: boolean;
  onStop: () => void;
  attachments: PendingAttachment[];
  onAttachmentsChange: (attachments: PendingAttachment[]) => void;
};

export type OutgoingMessage = {
  text: string;
  attachments: PendingAttachment[];
};

export type PendingAttachment = {
  id: string;
  file: File;
  status: "pending" | "uploading" | "uploaded" | "error";
  uploadedUrl?: string;
};

// floating-island/universe-command-bar.tsx
export type UniverseCommandBarProps = {
  onSearchSelect: (result: SearchResult) => void; // triggers fly-to, §8.4
  currentRegime: "R0" | "R1" | "R2" | "R3";
  onAskAboutSelection: () => void; // pivots to Chat with selection as context, §7.9
  selectionCount: number; // disables "ask about" affordance when 0
};

export type SearchResult = {
  id: string;
  label: string;
  type: string;
  position: [number, number, number];
};
```

### 17.2 `src/features/chat/*`

```ts
// chat-message-list.tsx
export type ChatMessageListProps = {
  threadId: string;
  messages: ChatMessage[];       // from useConsoleChat(), §7.3
  isStreaming: boolean;
  onLoadOlder: () => Promise<void>;
  hasOlder: boolean;
};

// chat-message.tsx
export type ChatMessageProps = {
  message: ChatMessage;           // §7.2's shape
  isStreamingNow: boolean;        // true only for the single currently-streaming message
};

// markdown/incremental-markdown-renderer.tsx
export type IncrementalMarkdownRendererProps = {
  textDelta: string;              // full accumulated text so far, not just the delta
  isComplete: boolean;             // false while still streaming — gates fence highlighting, §7.5
};

// tool-call-card.tsx (search_universe rendering, §7.9)
export type ToolCallCardProps = {
  toolName: "search_universe";
  args: { query: string };
  result: SearchResult[] | null;  // null while the tool call is in flight
  onViewInUniverse: (nodeId: string) => void; // toggles mode + fly-to, §7.9/§8.4
};

// scroll/scroll-anchor-provider.tsx
export type ScrollAnchorContextValue = {
  isNearBottom: boolean;
  jumpToLatest: () => void;
  lockAutoScroll: () => void;      // called the instant user scrolls up, §7.6 rule 2
};
```

### 17.3 `src/features/universe/*` — engine-facing React boundary

```ts
// universe-canvas.tsx
export type UniverseCanvasProps = {
  initialCameraState: SerializedCameraState | null; // parsed from URL, §8.7
  onCameraSettle: (state: SerializedCameraState) => void; // drives URL replaceState
};

export type SerializedCameraState = {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  tier: number;
  focus: string | null;
};

// engine/regime-controller.ts
export type UniverseEngineState = {
  currentRegime: "R0" | "R1" | "R2" | "R3";
  zoomTier: number;
  localOrigin: { x: number; y: number; z: number };
  worldRegistry: Map<string, { x: number; y: number; z: number }>;
  loadedCells: Set<string>;
};

// engine/floating-origin.ts
export type RebaseResult = {
  rebased: boolean;
  newLocalOrigin: { x: number; y: number; z: number };
};

// node-detail-card.tsx (R3 inspect panel)
export type NodeDetailCardProps = {
  node: NodeDetail;
  onAskInChat: (nodeId: string) => void; // the reverse bridge from §7.9
  onClose: () => void;
};

export type NodeDetail = {
  id: string;
  label: string;
  type: string;
  properties: Record<string, unknown>;
  neighborCount: number;
};

// minimap/minimap-scene.tsx
export type MinimapSceneProps = {
  loadedCells: Set<string>;
  cameraProjection: { x: number; z: number; headingRad: number };
};
```

### 17.4 Worker message contracts

```ts
// engine/workers/decode.worker.ts
export type DecodeWorkerRequest = { type: "decode"; buffer: ArrayBuffer };
export type DecodeWorkerResponse = {
  type: "decoded";
  header: TileHeader;
  positions: Float32Array;
  ids: Uint32Array;
};

// engine/workers/cluster.worker.ts
export type ClusterWorkerRequest = { type: "rebucket"; nodes: LoadedNode[]; cellSize: number };
export type ClusterWorkerResponse = { type: "rebucketed"; buckets: SpatialBucket[] };

// engine/workers/layout.worker.ts
export type LayoutWorkerRequest = { type: "relax"; nodes: LoadedNode[]; iterations: number };
export type LayoutWorkerResponse = { type: "relaxed"; positions: Map<string, [number, number, number]> };

export type LoadedNode = {
  id: string;
  position: [number, number, number]; // relative to current local origin
  weight: number;
  type: string;
};

export type SpatialBucket = {
  cellKey: string;
  memberIds: string[];
  centroid: [number, number, number];
};
```

### 17.5 Route handler contracts (Next.js `app/api/*`)

```ts
// app/api/universe/tiles/route.ts
export type TileRequestQuery = {
  tier: string;               // numeric, tier index
  cells: string;              // comma-separated gridCell ids
  pyramidVersion?: string;
  cursor?: string;            // opaque nextChunkToken from a prior response, §11.1
};
// Response: binary framing per §11.1, Content-Type: application/octet-stream

// app/api/universe/node/[id]/route.ts
export type NodeDetailResponse = NodeDetail; // §17.3

// app/api/chat/route.ts
export type ChatRequestBody = {
  threadId: string | null;    // null → backend mints a new thread, §7.8
  message: OutgoingMessage;   // §17.1
};
// Response: AI SDK v6 UIMessageStreamResponse (SSE), plus response header
// `X-Thread-Id` set as soon as the backend has minted/confirmed the thread id
```

---

## 18. Build Roadmap

This is a recommended *engineering sequence*, not a marketing/launch timeline — phase boundaries are chosen so each phase produces something independently testable and de-risks the next phase's hardest assumption before committing further effort to it.

### Phase 0 — Precision & performance spike (no product code)

The single required pre-implementation step flagged in §16.4. Build a throwaway, standalone Three.js/R3F scene (not inside this repo's real component tree — a scratch prototype) that:
1. Instances 5,000-50,000 dummy nodes across a synthetic multi-tier coordinate range spanning the same order-of-magnitude ratio the real product needs (cosmos-scale to inspect-scale).
2. Implements just the floating-origin rebase (§9.2.2) and measures actual visible jitter/precision loss at various `REBASE_THRESHOLD` values.
3. Measures actual frame time for instance-transform rewrites at realistic chunk-arrival rates.

Output: a corrected `REBASE_THRESHOLD`, a validated (or revised) frame-budget table (§13.1), and a go/no-go on the `<Detailed>`-based regime approach vs. needing `cosmos.gl` sooner than planned (§9.1's flagged alternative). **Nothing in Phase 1+ should start until this produces real numbers** — this plan's numeric constants throughout (thresholds, budgets, batch sizes) are informed estimates, not measurements, and are explicitly marked for correction here.

### Phase 1 — Auth, MFA, and the console shell (no Three.js, no chat yet)

- `proxy.ts`, session cookie codec, `verifySession` DAL (§4).
- `/login`, `/login/verify`, `/signup`, `/signup/mfa-setup` routes, wiring the existing `TotpSetup` component into signup.
- `/console/home`, `/console/layout.tsx`, `ConsoleShell` with the header and mode toggle **stubbed** (toggle can exist and flip a Zustand boolean; the Universe panel can be a placeholder `<div>` until Phase 3).
- `unauthorized.tsx`, the console dark theme tokens (§6.1).

Exit criteria: a user can sign up, enroll TOTP, log in, verify, land on `/console/home`, and see the shell with a working (if inert) mode toggle.

### Phase 2 — Chat interface (mode toggle now shows a real chat)

- `useConsoleChat` (§7.3), `/api/chat` proxy route, thread creation + optimistic id reconciliation (§7.8).
- Message list virtualization, scroll-anchor behavior (§7.4/§7.6), incremental markdown + fence-aware highlighting (§7.5).
- Floating island's `ChatComposer` (§7.7), draft persistence (§7.10).
- Reasoning/tool-call rendering scaffolding (§7.9) — the `search_universe` tool itself can be a stub returning empty results until Phase 4, but the *rendering* for tool-call parts should exist now so it isn't bolted on later.

Exit criteria: chat feels indistinguishable from Claude.ai for basic conversation (send, stream, stop, scroll, markdown, code blocks) — validated against §16.1's test suite plus manual side-by-side comparison.

### Phase 3 — Universe engine core (R2/R3 only, single fixed tier, no LOD pyramid yet)

- Deliberately **skip R0/R1 and the LOD pyramid in this phase** — prove out the harder, more novel parts (floating origin, instancing, camera controller, regime-agnostic for now since there's only one tier) against a *flat* live-traversal-backed node set first, using the Phase 0 spike's validated constants.
- Floating-origin engine (§9.2.2), instanced node/edge rendering (§9.3), camera controller (§9.7), coarse-pass picking (§9.5).
- `/api/universe/tiles` proxy + the R2/R3 AQL queries (§10.4.2/§10.4.3) directly against real `nodes`/`edges` (no cluster pyramid dependency yet).
- Web workers wired (§9.6) even at this stage — retrofitting off-main-thread decode later, once the main thread is already entangled with synchronous parsing, is meaningfully more painful than building it in from the start.

Exit criteria: a user can toggle to Universe, see real graph nodes rendered and picked correctly, pan/zoom within a single tier smoothly at the §13.1 frame budget, with correct floating-origin rebasing validated against Phase 0's measured threshold.

### Phase 4 — LOD pyramid & full R0-R3 regime system

- Backend precomputation job (§10.5) — cluster collections, `clusterPath`, `pyramidVersion`.
- Regime controller (§9.4), hysteresis-gapped transitions, cross-fade rendering (§9.2.3).
- Cosmos/Nebula rendering (§8.1's R0/R1 visual treatment), decorative starfield (§8.2) with the real-vs-decorative visual distinction enforced.
- Fly-to camera scripting (§8.4), search-to-flythrough (§8.3/§6.5), the "edge of the known universe" leaf empty-state (§8.2).

Exit criteria: the full "zoom to infinity" experience works end to end, R0→R3, including the genuine-leaf empty state and search-driven fly-to.

### Phase 5 — Cross-mode bridges, realtime, polish

- Chat's `search_universe` tool fully wired to §10.7's search endpoint; "View in Universe" / "Ask about this" bridges (§7.9, §6.5) both directions.
- Realtime change feed (§11.4), the §6.6/§8.6 activity-pulse and fade-in behaviors.
- Minimap (§9.8), adaptive quality tiers (§13.2), degraded-mode fallbacks (§14.3).
- Accessibility pass against §14's full checklist, security pass against §15.

### Phase 6 — Hardening

- Load-shaped testing at realistic seeded-graph scale (§16.3).
- Bundle-size CI gates (§16.5), visual regression suite (§16.2) as a standing CI job, not a one-time check.
- Backend tenant/user scoping audit (§15.2) as an explicit, signed-off security review before any real user data flows through the universe endpoints.

---

## 19. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Floating-point precision issues surface later than expected (only at scale/production data, not in the Phase 0 spike's synthetic dataset) | Medium | High | Phase 0 spike explicitly uses a range/scale ratio matching real product expectations, not a token synthetic case; §16.4's precision unit tests run in CI permanently, not just once |
| 2 | Server-computed layout positions (§10.5.3) reshuffle on redeploy, destroying users' spatial mental model | Medium | High | Deterministic seeding by `_key` hash (§10.5.3); incremental-only recompute for existing nodes, full relayout reserved for explicit, rare, communicated events |
| 3 | Grid-cell spatial index and client-side cell derivation drift out of sync (client and backend independently reimplement `cellSize(tier)`) | Medium | High | Share the formula as isomorphic code (§16.2); contract-test both sides against the same fixture values |
| 4 | "Zoom to infinity" reads as a gimmick if the decorative starfield (§8.2) isn't clearly distinguishable from real data | Low-Medium | Medium | Explicit, tested visual distinction (brightness/size/interactivity) enforced in code review + a dedicated QA checklist item |
| 5 | Chat/Universe mode toggle causes a full remount and loses WebGL context or chat scroll position | Low (mitigated by design, §6.3) | High if it regresses | Off-tree persistent mounting explicitly chosen over route-based toggling; covered by a regression test that asserts the WebGL context object identity is stable across N toggles |
| 6 | ArangoDB traversal queries silently degrade from indexed to full-scan after a future schema change | Medium (schema will evolve) | High | `EXPLAIN`-based CI tests per query (§16.3), not just functional correctness tests |
| 7 | Realtime WS connection outlives a revoked session | Low | Medium-High (security) | Periodic backend-side re-validation on live sockets (§15.2) |
| 8 | Bundle-size creep silently drags `three` into the chat-only path | Medium | Medium | CI-enforced bundle budget (§16.5), not just documentation |
| 9 | Disorientation — users get "lost" in the universe with no sense of scale/location | Medium | Medium | Minimap (§9.8), breadcrumb (§9.7's events → header), search-driven fly-to as an always-available "get me somewhere known" escape hatch |
| 10 | Node/edge editing demand emerges post-launch (v1 explicitly ships read-only exploration, §8.3) | Medium (likely a fast-follow ask) | Medium | Explicitly scoped out of v1 in this document so it isn't half-built accidentally; camera/interaction model (§9.7) deliberately doesn't conflate node-drag with camera-pan, leaving room to add real node dragging later without an interaction-model rewrite |
| 11 | GPU picking fallback (§9.5) never gets built because the coarse pass "seems fine" in dev but breaks under production node density | Low-Medium | Medium | §16.3's load-shaped tests exercise realistic density explicitly, not just dev-scale fixtures |
| 12 | The backend team builds the actual API layer with different pagination/cursor semantics than §11 assumes, since "don't worry about the API layer" left it deliberately loose | Medium | Medium | This plan's contracts (§11, §17.5) are the proposed shape, explicitly flagged as a *proposal* to align on with the backend team before Phase 3 starts, not an assumed-final spec |
| 13 | The "look-and-explore only" v1 scope (Assumption A4, §72) creates pressure to add node/edge editing sooner than the architecture is ready for, once users see a 3D graph and instinctively try to drag something | Medium-High | Medium | Explicitly documented as a deferred, not forgotten, capability (Risk #10 already covers this; restated here because it's likely to be the single most common piece of user feedback post-launch) — the camera/interaction model (§9.7) was deliberately kept separable from a future drag-to-edit affordance for exactly this reason |
| 14 | The mock backend (§47) diverges from the real backend's actual behavior over time as both evolve independently, giving frontend developers false confidence | Medium | Low-Medium | Treated explicitly as a dev-convenience tool, not a source of truth (§47's closing caveat) — any feature considered "done" must be re-verified against the real backend, not just the mock, before merging |

---

## 20. Decision Log (Architecture Decision Records)

Recorded so future contributors can see *why*, not just *what* — each entry follows Context → Decision → Alternatives Considered → Consequences.

### ADR-001: Floating origin + tiered regimes, combined, not either alone

- **Context:** "Zoom to infinity" requires representing an enormous dynamic range of scale in a WebGL scene backed by 32-bit float GPU buffers.
- **Decision:** Combine floating-origin rebasing (§9.2.2, solves in-regime precision) with discrete tiered regimes rendered as independent local coordinate spaces (§9.2.3, solves cross-regime range).
- **Alternatives considered:** (a) Floating origin alone across the *entire* zoom range — rejected because the ratio between cosmos-scale and inspect-scale distances is too extreme for any single rebase radius to serve both without either constant rebasing at coarse zoom (expensive, per §9.2.2's rewrite cost) or precision loss at fine zoom. (b) Tiered regimes alone, no floating origin — rejected because even *within* a single regime (e.g., R2 with thousands of loaded nodes spread over a large loaded area), the camera can still drift far enough from any single regime-local origin to reintroduce jitter.
- **Consequences:** Two coordinate concepts to reason about instead of one (`WorldRegistry` double-precision truth + regime-local float32 render space) — added conceptual overhead, but it's the only combination that's actually correct at the full range this product commits to. Documented explicitly in §9.2 specifically because this is the decision most likely to be "simplified away" by a future contributor who doesn't understand why both pieces exist.

### ADR-002: Precomputed LOD cluster pyramid instead of live aggregation

- **Context:** R0/R1 need a fast, always-available coarse view of the whole graph; live traversal-based aggregation would be a performance cliff (per ArangoDB's own guidance, §10.1/§21).
- **Decision:** Background-job-built, versioned, materialized cluster collections (§10.5), analogous to map-tile pyramids.
- **Alternatives considered:** Live server-side aggregation pipeline (AQL `COLLECT` over the whole graph per request) — rejected outright as a non-starter at any meaningful graph size. In-memory caching of a live aggregation (compute once, cache in Redis/similar, invalidate on write) — rejected as a middle ground because it still requires a full-graph pass on every cache miss/invalidation and doesn't naturally support incremental, localized updates the way a materialized grid-based pyramid does.
- **Consequences:** Requires a real background job/scheduler in the backend (out of this plan's direct scope but flagged as a hard dependency, §10.5.4) and introduces `pyramidVersion` as a concept the frontend must be aware of for correct caching (§12.2). Adds latency between "a node is created" and "it's visible at coarse zoom levels" (mitigated by the incremental local-cell update path, §10.5.4, but not instant at the coarsest tiers by design).

### ADR-003: Grid-cell spatial index as a denormalized field, not computed at query time

- **Context:** R2/R3 queries need "what's near the camera" to be cheap and indexed.
- **Decision:** Precompute and store `gridCell` on every node/cluster document at write time (§10.3), index it directly, and have the client derive the identical cell ids for its viewport using shared logic.
- **Alternatives considered:** Geospatial-style range queries computed live from raw `position` — rejected because ArangoDB's native geo-index assumes lat/lng semantics, not arbitrary 3D layout coordinates, and a live bounding-box range scan without a matching index shape doesn't get the same indexed-lookup cost profile as an equality/prefix match on a precomputed cell id.
- **Consequences:** Any change to `cellSize(tier)`'s formula requires a backfill of the denormalized field across the whole graph — an accepted cost, since this formula should rarely change once tuned (Phase 0 spike, §18, is specifically meant to get it right before it's baked into millions of stored documents).

### ADR-004: Off-tree persistent mounting for Chat/Universe toggle, not route-based switching

- **Context:** Toggling modes must not destroy the WebGL context or lose chat scroll position/draft state.
- **Decision:** Both panels mount once (lazily, on first visit to each) and are shown/hidden via CSS, independent of Next.js route-tree lifecycle, per §6.3.
- **Alternatives considered:** Plain route navigation between `(chat)` and `(universe)` segments — rejected due to full remount cost on every toggle (§6.3's stated reasons). `visibility: hidden` + `position: absolute` overlap of both full-tree route renders simultaneously via parallel routes (`@chat`/`@universe` slots) — considered as a "more Next-native" alternative, but rejected because Next's parallel-routes model still ties each slot's mount lifecycle to routing/navigation state in ways that don't cleanly guarantee "never unmount once mounted" without fighting the framework; a plain client-owned boolean is simpler and more predictable here.
- **Consequences:** URL and Next's actual rendered route can, for a moment, represent a different "logical mode" than what's visually shown (§6.3.1's nuance) — this asymmetry must be understood by anyone touching this code, hence its explicit callout.

### ADR-005: Binary tile framing instead of JSON for universe data

- **Context:** Tile payloads are dense numeric arrays at potentially thousands of entries.
- **Decision:** Custom length-prefixed binary framing (§11.1) with typed-array bodies, decoded off-main-thread.
- **Alternatives considered:** Plain JSON arrays of `{id, x, y, z}` objects — simplest to implement and debug (readable in browser devtools network tab), but rejected for production due to both payload size (text encoding of floats is far larger than 4-byte float32) and parse cost (JSON.parse of thousands of small objects vs. a single typed-array view over a buffer). Protocol Buffers / FlatBuffers — considered as a more tooled middle ground; not chosen for v1 to avoid adding a schema-compiler build step for what is, in the end, a fairly simple fixed framing this plan can hand-roll; flagged as a reasonable future migration if the framing's informal versioning (via `pyramidVersion` alone) becomes insufficient.
- **Consequences:** Debugging tile responses requires a small dev-tool (a "decode this tile" script) rather than eyeballing raw JSON in the network tab — an accepted cost, mitigated by writing that dev tool as part of Phase 3.

### ADR-006: Server-authoritative layout positions, client-side relaxation only for transient overlap

- **Context:** Two users must see the same graph "geography"; a purely client-side force simulation would diverge per-session and per-device.
- **Decision:** Backend computes and persists `position` once (§10.5.3); client only ever nudges freshly-arrived, not-yet-positioned nodes transiently (§9.6.3), never overriding a real persisted position.
- **Alternatives considered:** Fully client-side, live force-directed layout (the default behavior of libraries like `3d-force-graph`) — rejected because it means every user's camera is exploring a *different*, continuously-reflowing geometry, which directly conflicts with this product's core promise of a stable, shareable, "place" you can navigate back to (URL-serialized camera state, §8.7, would point at a different visual location for every viewer/session otherwise).
- **Consequences:** The backend owns a genuinely nontrivial offline job (bulk force-directed layout at graph scale, §10.5.3) that has real compute cost and its own tuning surface — explicitly flagged as backend scope, not hand-waved.

### ADR-007: `unauthorized()` scoped to leaf-level checks only, not the console root layout

- **Context:** Next 16's `unauthorized.tsx` convention renders in place of the segment tree; using it at `console/layout.tsx` would destroy the persistently-mounted shell (composer draft, WebGL context) on every session hiccup.
- **Decision:** Reserve `unauthorized()` for narrow, leaf-level session checks (e.g., inside a specific Server Action); handle whole-shell re-auth via a client-side modal driven by 401 responses (§7.10).
- **Alternatives considered:** Using `unauthorized.tsx` at the root and accepting the remount cost — rejected as directly contradicting ADR-004's rationale for a session-expiry event, which (unlike a deliberate mode toggle) is an *unplanned* interruption where preserving the user's in-progress work matters even more, not less.
- **Consequences:** Two different "you're not authenticated" UX paths exist in the codebase (file-convention-driven vs. modal-driven) for different triggers — a subtlety that must be documented in code comments at both call sites, cross-referencing this ADR, so a future refactor doesn't "simplify" them into one path and reintroduce the shell-remount problem.

---

## 21. Data Model Reference (Consolidated)

A single reference of every cross-cutting type named across this document, gathered here to reduce the need to hunt through prose sections for a shape while implementing. This section intentionally repeats types defined earlier — treat this as the canonical index; if a conflict is ever noticed between this section and an earlier one, this section wins (and the earlier prose should be corrected to match).

```ts
// ── Auth / Session ──────────────────────────────────────────────────────────
type SessionCookiePayload = { sub: string; state: "mfa_required" | "authenticated"; iat: number; exp: number };
type Session = { userId: string; displayName: string; avatarUrl: string | null; mfaLevel: "totp" };

// ── Chat ─────────────────────────────────────────────────────────────────────
type ChatMessagePart =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool-call"; toolName: string; args: Record<string, unknown>; callId: string }
  | { kind: "tool-result"; callId: string; result: unknown }
  | { kind: "file"; url: string; mediaType: string };

type ChatMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system" | "tool";
  parts: ChatMessagePart[];
  createdAt: string;
  status?: "streaming" | "complete" | "error";
};

type OutgoingMessage = { text: string; attachments: PendingAttachment[] };
type PendingAttachment = { id: string; file: File; status: "pending" | "uploading" | "uploaded" | "error"; uploadedUrl?: string };

// ── Universe: graph domain ──────────────────────────────────────────────────
type GraphNodeDoc = {
  _key: string;
  type: string;
  label: string;
  properties: Record<string, unknown>;
  weight: number;
  position: { x: number; y: number; z: number };
  clusterPath: string[];       // one cluster id per LOD tier
  gridCell: string;
  createdAt: string;
  updatedAt: string;
};

type GraphEdgeDoc = { _key: string; _from: string; _to: string; type: string; weight: number; properties: Record<string, unknown>; createdAt: string };

type ClusterDoc = {
  _key: string;
  tier: number;
  centroid: { x: number; y: number; z: number };
  radius: number;
  memberCount: number;
  childClusterIds: string[];
  gridCell: string;
  label?: string;
  lastRebuiltAt: string;
};

// ── Universe: client-side runtime ───────────────────────────────────────────
type LoadedNode = { id: string; position: [number, number, number]; weight: number; type: string };
type SpatialBucket = { cellKey: string; memberIds: string[]; centroid: [number, number, number] };
type NodeDetail = { id: string; label: string; type: string; properties: Record<string, unknown>; neighborCount: number };
type SearchResult = { id: string; label: string; type: string; position: [number, number, number] };
type SerializedCameraState = { x: number; y: number; z: number; yaw: number; pitch: number; tier: number; focus: string | null };
type EngineSnapshot = { regime: "R0" | "R1" | "R2" | "R3"; zoomTier: number; breadcrumb: string };

// ── Universe: wire protocol ─────────────────────────────────────────────────
type TileHeader = {
  tier: number;
  pyramidVersion: string;
  cellIds: string[];
  nextChunkToken: string | null;
};

type UniverseChangeEvent =
  | { type: "node_created"; nodeId: string; gridCell: string; tier: number; position: [number, number, number] }
  | { type: "node_updated"; nodeId: string; gridCell: string }
  | { type: "node_deleted"; nodeId: string; gridCell: string }
  | { type: "edge_created" | "edge_deleted"; from: string; to: string }
  | { type: "cluster_rebuilt"; tier: number; pyramidVersion: string; affectedCells: string[] };
```

---

## 22. Error, Empty & Loading State Catalog

Every surface in this plan has at least three non-happy-path states; enumerated explicitly here so none get skipped during implementation (a common gap in ambitious UI builds — the happy path gets all the design attention and the edge states get an afterthought spinner).

### 22.1 Chat surface

| State | Trigger | Treatment |
|---|---|---|
| Empty thread (`/console/c/new`) | No messages sent yet | A calm welcome/prompt-suggestions view above the floating island, not a blank white/dark void — reuses the marketing site's warmth in tone (if not literal theme) for the copy, distinct from a cold "no data" empty state |
| Message send failure (network) | `fetch` rejects or backend 5xxs mid-request | Inline retry affordance on the failed user message itself (matches Claude.ai's own pattern of an error chip under the specific failed message, not a global toast) |
| Stream interrupted mid-response | Connection drops while assistant is streaming | Partial content is preserved (not discarded), marked visually as incomplete, with a "Continue generating" action rather than forcing a full regenerate from scratch |
| Rate-limited by backend | 429 from `/api/chat` | Composer shows a disabled state with a countdown, not a silent failure |
| Older-messages pagination failure | `/api/chat` history fetch fails | A small inline retry row at the top of the loaded list, not a full-list error replacing already-loaded messages |
| `search_universe` tool call returns zero results | Genuinely no matching nodes | Rendered as a distinct, calm "No matches in the universe for that" tool-result card — not styled identically to a tool-call *error*, since zero-results is a valid outcome, not a failure |

### 22.2 Universe surface

| State | Trigger | Treatment |
|---|---|---|
| Cold load, first tile not yet arrived | Initial `/console/u` mount | A soft, branded loading treatment *within* the eventual cosmos aesthetic (e.g., a dim, slowly-resolving starfield placeholder) rather than a generic spinner — the loading state should not visually contradict the thing it's loading into |
| Tile fetch failure for currently-viewed cells | Backend/network error | The affected region renders as a subtly-marked "unavailable" void (a soft muted texture, not literally empty/black, to distinguish from a genuine sparse/leaf region) with a retry affordance if the user lingers there |
| Genuine leaf reached | No further children/edges to zoom into, §8.2 | The designed "edge of the known universe" positive empty state — never treated as an error |
| WebGL context lost (browser/driver-level event) | GPU driver reset, tab backgrounding on constrained devices | Listen for `webglcontextlost`, show a lightweight "Reconnecting the universe…" overlay, and attempt `webglcontextrestored`-driven re-initialization before falling back to a hard reload prompt only if restoration itself fails |
| Search returns zero results | No matching nodes for the query | Inline "No nodes match" state in the command bar's result dropdown, with a suggestion to check spelling/broaden the query |
| Realtime WS disconnected | Network blip, backend restart | A small, unobtrusive "reconnecting" indicator near the minimap (§9.8) — must never block interaction; the universe remains fully explorable (from cache) while reconnecting |
| Node detail fetch fails (R3 selection) | Backend error on `/universe/nodes/:id` | The detail card shows an inline error + retry, while the node itself remains selected/highlighted in the scene (don't deselect on a transient fetch failure) |

### 22.3 Auth/MFA surface

| State | Trigger | Treatment |
|---|---|---|
| Wrong TOTP code | Invalid 6-digit entry | Inline error under the code input, input clears, focus retained, `attemptsRemaining` shown once the backend starts including it (§4.5) |
| Lockout | Too many failed attempts | Composer-equivalent (the code input) disables with a visible countdown (`Retry-After`), not just a generic "try again later" with no timeframe |
| Session expired mid-session (leaf-level, §3.2/ADR-007) | Backend 401 on an authenticated action | In-place modal re-verify (not a hard redirect), preserving all in-progress client state |
| Session fully invalid at `/console` entry | `verifySession()` fails at the layout level | Hard redirect to `/login` (the one accepted exception to "never destroy the shell," since there is no shell yet to preserve at this boundary) |

---

## 23. Design Tokens & Visual System (Console)

Distinct from, but harmonious with, the existing marketing theme (`src/shared/brand/DESIGN_SYSTEM.md`, Fraunces serif on cream). The console's dark "control room" register (introduced in §6.1) is specified further here.

### 23.1 Color

| Token | Value | Usage |
|---|---|---|
| `--vx-console-bg` | `#0B0D10` | App background, both modes |
| `--vx-console-surface` | `#14171B` | Panels, cards, the detail card (§8.1 R3) |
| `--vx-console-surface-raised` | `#1C2026` | Floating island, popovers, dropdowns |
| `--vx-console-border` | `rgba(255,255,255,0.08)` | Hairline separators |
| `--vx-console-text` | `#EDEFF2` | Primary text |
| `--vx-console-text-muted` | `#9BA1AC` | Secondary/meta text (timestamps, breadcrumbs) |
| `--vx-console-accent` | `#7C9CFF` | Interactive accents, also the base hue for node/edge glow in the universe (§9.3.4) — deliberately shared so the two modes feel like one product, not two skins bolted together |
| `--vx-console-accent-dim` | `#4A5A99` | Decorative starfield color (§8.2) — a visibly dimmer, desaturated variant of the accent, reinforcing the real-vs-decorative distinction from ADR-004's sibling concern in §8.2 |
| `--vx-console-danger` | `#E5695A` | Errors, lockout countdowns |
| `--vx-console-success` | `#6FCF97` | Confirmations (rare in this surface — used sparingly) |

### 23.2 Motion

| Token | Value | Usage |
|---|---|---|
| `--vx-ease-standard` | `cubic-bezier(0.32, 0.72, 0, 1)` | Floating island morph (§6.5), mode-toggle icon swap |
| `--vx-ease-fly` | custom logarithmic-time easing, §8.4 | Camera fly-to only — not a CSS token, implemented in the camera controller directly since it operates on 3D state, not DOM transitions |
| `--vx-duration-fast` | `120ms` | Hover states, button presses |
| `--vx-duration-standard` | `220ms` | Island morph, panel open/close |
| `--vx-duration-regime-crossfade` | `250ms` | Regime transition cross-fade, §9.2.3 — shortened to ~60ms under `prefers-reduced-motion` (§14.3), never fully instant even then, to avoid a jarring hard cut between two different scene compositions |

### 23.3 Iconography

- Globe and Chat-bubble icons (§6.2) sourced from/added to the existing shared icon set (`src/shared/packages/ui/icons.ts`) as new entries following that package's existing per-platform (`.web.tsx`/`.mobile.tsx`) split convention — not one-off SVGs inlined in the console feature folder, so a future mobile/React Native console (the repo already depends on `react-native`/`react-native-svg`, suggesting cross-platform ambitions) can reuse the same icon components.
- Node-type icons (for the R2/R3 texture atlas, §9.3.4) are a closed, versioned set baked into the atlas at build time — adding a new graph node `type` that needs a distinct icon requires a deliberate atlas rebuild, not a runtime-dynamic icon-loading path (keeps the "one texture bind regardless of type count" performance property from §9.3.4 intact).

---

## 24. Open Questions for the Backend/Product Team

Explicitly flagged rather than silently assumed, per this plan's stated non-goal of fully specifying the API layer:

1. **Tenancy model:** Is the graph single-tenant-per-account, or can multiple users share/collaborate on one universe? This changes §15.2's scoping filter from a simple `tenantId` equality check to something involving shared-access ACLs, and could affect whether the LOD pyramid (§10.5) is per-tenant or global.
2. **Node/edge mutation scope for v1:** Confirmed out of scope per §8.3/Risk #10 — but should be explicitly re-confirmed with product, since "build out a universe" language could be read by stakeholders as implying an editable canvas, not just a read-only exploration surface.
3. **What does a "node" represent in this specific product?** This plan is intentionally domain-agnostic (§10.2's schema is generic: `type`, `label`, `properties`), but real label-priority rules (§8.5), icon-atlas contents (§23.3), and search relevance tuning (§10.7) all depend on knowing the actual domain (is this a knowledge base of documents, a codebase dependency graph, a customer/org relationship graph, something else?).
4. **Expected graph scale at launch vs. at 12 months:** Directly determines whether Phase 4's LOD pyramid is truly necessary at launch or could be deferred (if launch-scale graphs are small enough that R2/R3's live traversal alone stays within budget even at maximum zoom-out, the pyramid could ship in a later phase without users noticing the gap, re-ordering §18's roadmap).
5. **LLM provider/hosting decision for chat** (direct provider SDK vs. Vercel AI Gateway, §2.4) — affects `/api/chat`'s backend-facing contract (§17.5) only at the margins (headers/auth), but should be settled before Phase 2 to avoid rework.
6. **Realtime feed transport preference:** This plan assumes a WebSocket (§11.4); if the backend's infra has a strong existing preference (e.g., SSE-only infrastructure, or an existing pub-sub the backend team wants to reuse), the frontend's `EngineBridge`-adjacent stream client (§12.4) can be adapted — the event *shape* (§11.4's `UniverseChangeEvent` union) matters far more than the transport.

---

## 25. Observability

"Ship it and hope" is not acceptable for a feature this novel — most of the numeric constants throughout this plan (§13's budgets, §11.2/§11.3's request-coalescing windows, §10.5.4's rebuild cadence) are informed estimates that need real production telemetry to validate or correct, mirroring the same spirit as Phase 0's pre-implementation spike (§18) but for the long tail of conditions a synthetic spike can't cover (real user devices, real network conditions, real graph shapes).

### 25.1 Client-side metrics to emit

| Metric | Type | Why it matters |
|---|---|---|
| `universe.frame_time_ms` (p50/p95/p99, rolling) | Histogram | Directly validates/invalidates §13.1's frame budget in the field, across real device diversity the Phase 0 spike can't fully represent |
| `universe.tile_fetch_latency_ms` by tier | Histogram | Validates §13.3's 500ms cold-load target and per-tier expectations; a regression here is usually the first visible sign of a backend query-plan regression (ties to Risk #6, §19) |
| `universe.rebase_count` per session | Counter | An unexpectedly high rate here (vs. what Phase 0's spike predicted) is the earliest signal that `REBASE_THRESHOLD` needs retuning in production, before users notice jitter |
| `universe.regime_transition_count` and `.thrash_count` (a transition immediately reversed within <500ms) | Counter | A high thrash rate directly indicates the hysteresis band (§8.1/§9.4) is too narrow for real usage patterns |
| `chat.time_to_first_token_ms` | Histogram | The single most user-perceptible chat latency number; unrelated to this plan's own code (mostly reflects backend/provider latency) but the frontend should still emit it, since it's the metric that determines whether the floating island's send→response feel matches Claude.ai's |
| `chat.stream_interrupted_count` | Counter | Feeds the §22.1 "stream interrupted" state's actual frequency — if this is high, the "Continue generating" affordance's quality matters far more than if it's rare |
| `console.mode_toggle_count` and `.toggle_latency_ms` (first toggle only, capturing lazy-bundle-load cost) | Counter/Histogram | Validates §13.4's bundle-size budget actually translates to an acceptable perceived first-toggle delay |
| `webgl.context_lost_count` | Counter | Should be near-zero in healthy operation; a spike correlates with driver/device issues worth investigating (§22.2's context-loss state) |

### 25.2 Where these are collected

Given this repo already integrates a design system and a `manifest.ts`/`opengraph-image.tsx` set of Next-native conventions but no analytics SDK yet, this plan does not prescribe a specific vendor (Vercel Analytics, PostHog, Sentry, Datadog RUM, etc.) — only the requirement that whichever is chosen, the metrics in §25.1 are emitted as **first-class custom events**, not inferred after the fact from generic pageview/session data, since none of the numbers above map onto default web-analytics primitives.

### 25.3 Backend-observable signals (frontend-relevant subset)

Not this plan's implementation responsibility, but flagged as needed for the frontend team to have visibility into, since several frontend decisions (adaptive quality, §13.2; retry/backoff tuning, §11.4) are only correctly tunable with backend-side context:
- AQL query plan cache hit/miss and `EXPLAIN`-verified index usage (ties directly to Risk #6, §19) — ideally surfaced on a shared dashboard both teams watch, not siloed to backend-only tooling.
- LOD pyramid rebuild job duration and the resulting `pyramidVersion` cadence in practice, since §10.5.4's "incremental vs. nightly full rebuild" split is only as good as the incremental path's actual observed staleness window.

---

## 26. Local Development & Environment Setup

### 26.0 Full `.env.local.example` reference

A single, copy-pasteable starting point, combining the existing pattern (`api-client.ts`'s variables) with every new variable this plan introduces, so a fresh contributor has one file to fill in rather than reconstructing it from scattered prose mentions:

```bash
# .env.local.example — copy to .env.local and fill in real values

# --- Existing (already established by src/shared/lib/api-client.ts) ---
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
BACKEND_API_KEY=

# --- New: session/auth (§4) ---
VX_SESSION_COOKIE_SECRET=

# --- New: universe realtime (§11.4) ---
VX_UNIVERSE_WS_URL=ws://localhost:4000/universe/stream

# --- New: feature flags (§27.1) ---
NEXT_PUBLIC_VX_CONSOLE_UNIVERSE_ENABLED=true
NEXT_PUBLIC_VX_CONSOLE_UNIVERSE_LOD_PYRAMID_ENABLED=false   # off until Phase 4 backend work lands
NEXT_PUBLIC_VX_CONSOLE_UNIVERSE_REALTIME_ENABLED=false      # off until Phase 5 backend work lands
NEXT_PUBLIC_VX_CHAT_SEARCH_UNIVERSE_TOOL_ENABLED=false      # off until the search endpoint (§10.7) is live

# --- New: dev tooling (§26.2, §47) ---
VX_USE_MOCK_BACKEND=true   # when true, dev scripts point NEXT_PUBLIC_API_BASE_URL at the
                           # local mock server (§47) instead of a real backend/ArangoDB
```

Every flag defaults to its *safest, most-degraded* setting in this example file specifically so a fresh checkout never accidentally exercises unfinished backend-dependent functionality — each gets flipped on deliberately as its corresponding phase (§18) actually lands.

### 26.1 Environment variables

Extending the existing pattern already established by `src/shared/lib/api-client.ts` (`NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_BACKEND_API_KEY`, and their non-public server-side equivalents) — no new naming convention introduced, just new variables following the same shape:

```bash
# .env.local (not committed — see existing prod.env for the pattern this repo already follows)

# Existing (unchanged)
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
BACKEND_API_KEY=dev-shared-secret

# New, for this plan
VX_SESSION_COOKIE_SECRET=...              # server-only, used by src/server/auth/session-codec.ts
VX_UNIVERSE_WS_URL=ws://localhost:4000/universe/stream   # only if the realtime feed
                                                           # needs a distinct URL/port
                                                           # from the main REST base
NEXT_PUBLIC_VX_CONSOLE_UNIVERSE_ENABLED=true              # feature flag, §27.1 — lets
                                                           # local/staging environments
                                                           # disable the Universe toggle
                                                           # entirely without a code change
```

### 26.2 Running against a local backend + ArangoDB during development

Since the actual backend service is out of this plan's scope, frontend development against real data requires either (a) the backend team's dev-mode instructions (out of scope here), or (b) — recommended as a frontend-team-owned fallback so Universe/Chat UI work isn't blocked on backend availability — a small **mock server** living in this repo's dev tooling (not shipped to production) that serves synthetic tile/chat responses matching the exact contracts in §11 and §7.3, backed by the seed-data generator described in §30.3. This mock server should be runnable via a single script (`bun run dev:mock-backend` or equivalent) and should be the default `NEXT_PUBLIC_API_BASE_URL` target in a fresh checkout's `.env.local.example`, so a new contributor can `bun install && bun run dev` and see a working (synthetic) Universe/Chat without any backend/ArangoDB setup at all — a meaningful onboarding-friction reduction given how much of this plan's complexity lives in the frontend engine itself, independent of real backend data.

### 26.3 Local ArangoDB (for backend-side/integration work only)

If/when integration testing against a real ArangoDB instance is needed (§16.3's `EXPLAIN`-based and load-shaped tests), a `docker-compose.arangodb.yml` (backend-repo-owned, referenced here only because the frontend's CI for §16.3 needs to spin up the same thing) should pin a specific ArangoDB version matching production, with the collections/indexes from §10.2 provisioned via a versioned migration script — not hand-created ad hoc — so `EXPLAIN` assertions are testing the same index shapes production actually has.

---

## 27. Rollout & Feature Flagging

### 27.1 Flag surface

| Flag | Scope | Purpose |
|---|---|---|
| `console_universe_enabled` | Per-environment (or per-account, if staged rollout is desired) | Hides the mode-toggle entirely, console behaves as chat-only — the safe fallback if the Three.js engine needs to be pulled back after launch for any reason, without touching chat |
| `console_universe_lod_pyramid_enabled` | Per-environment | Lets R0/R1 gracefully degrade to "not available yet, zoom in to see data" if Phase 4's backend precomputation job isn't ready, without blocking Phase 3's R2/R3 experience from shipping independently (directly supports the phased rollout in §18) |
| `console_universe_realtime_enabled` | Per-environment | Disables the WS change feed (§11.4) — falls back to "data is as fresh as your last navigation/refresh," a safe degradation if the realtime infra has issues, without affecting core navigation |
| `chat_search_universe_tool_enabled` | Per-environment | Lets the `search_universe` chat tool (§7.9) ship independently of/before the full Universe UI, or be disabled if it needs backend rework, without disabling chat itself |

### 27.2 Why flags, not just phased code merges

Because Phases 3-5 (§18) each depend on real backend work landing in step, and frontend/backend development velocity will not perfectly synchronize — flags let the frontend merge and deploy ahead of backend readiness (with the flag off in production) rather than blocking on a perfectly-timed joint release, which historically is where "big feature" launches slip hardest.

---

## 28. Cross-Platform / Mobile Considerations

This repository already depends on `react-native` and `react-native-svg`, and its shared UI package (`src/shared/packages/ui`) consistently ships `.web.tsx`/`.mobile.tsx` component pairs — a strong signal that a React Native console client is a real possibility, even if not in this plan's immediate scope. Flagging the implications now avoids painting the web implementation into a corner:

- **Chat mode** ports to React Native with comparatively little friction — the AI SDK's React hooks, TanStack Query, and Zustand all have React Native support; the main porting cost is the composer's platform-specific text-input quirks (§7.7's IME/Enter-key handling differs meaningfully between web `<textarea>` and RN `TextInput`) and the incremental-markdown renderer needing an RN-compatible rendering target instead of raw DOM/`<pre>`/`<code>`.
- **Universe mode** is a much larger porting effort — `@react-three/fiber` has a React Native counterpart (`@react-three/fiber`'s RN target, using `expo-gl`), meaning the *engine* architecture in §9 (floating origin, instancing, workers-as-a-concept) is directionally portable, but Web Workers specifically do not exist in React Native the same way — the off-main-thread strategy (§9.6) would need to be re-implemented atop RN's actual concurrency primitives (e.g., a JSI-based worklet approach, or accepting main-thread decode on mobile with a reduced node-count budget, §14.3's `memoryClass` degradation path already provides a natural fallback shape for this). This plan does not commit to a specific RN worker strategy — it only flags that §9.6's worker contracts (§17.4) should be treated as **logical boundaries** (clear message-passing contracts) rather than assumed to be literally backed by `Worker` on every platform, so a future RN port can swap the transport without redesigning the contracts.
- Recommendation if/when RN console work starts: keep the engine's pure-logic pieces (floating-origin math, regime classification, cell-id derivation) in framework-agnostic TypeScript modules with zero DOM/`three`-web-renderer dependencies, so they're literally shared, not reimplemented, between web and RN targets — this is already this plan's implicit structure (§9's math lives in plain classes/functions, not components) and should be kept that way deliberately.

---

## 29. Internationalization & Content Considerations

Not a deep focus of this plan (no existing i18n infrastructure was found in this repo — the marketing site's copy is English-only per `src/app/layout.tsx`'s metadata), but two content-shaped decisions in this document have i18n implications worth flagging for whoever picks this up later:
- Cluster/node **labels** (§10.2, §10.5) are graph *data*, not UI chrome — they follow whatever language the underlying content is in, and are not translated by the frontend; only the surrounding UI chrome (button labels, the "You've reached the edge of the known universe" empty state copy, etc.) would ever go through an i18n layer if one is added later.
- The ArangoSearch analyzer used for the search endpoint (§10.7, `"text_en"`) is English-tuned — a multi-language graph would need either per-document language detection and a matching analyzer choice, or a language-agnostic analyzer/tokenization strategy; flagged here rather than silently assumed, since it's an easy detail to bake in early and forget about.

---

## 30. Rendering Code Appendix: Shaders & Materials

Reference GLSL for the stylized, non-physically-lit rendering approach described in §9.3.4. These are starting points for Phase 3/4 implementation, not final tuned values — exact constants (falloff exponents, bloom threshold) are expected to be adjusted visually during implementation.

### 30.1 Node point/billboard glow fragment shader

```glsl
// src/features/universe/engine/shaders/node-glow.frag.glsl
precision highp float;

varying vec3 vInstanceColor;
varying float vInstanceIntensity; // 0..1, drives the §8.6 "new node" fade-in pulse
varying vec2 vUv;

void main() {
  // Radial falloff from billboard center — soft glow, not a hard-edged disc.
  vec2 centered = vUv - vec2(0.5);
  float dist = length(centered) * 2.0; // 0 at center, 1 at edge
  float falloff = smoothstep(1.0, 0.0, dist);
  falloff = pow(falloff, 1.6); // slightly punchier core than a linear falloff

  float alpha = falloff * vInstanceIntensity;
  vec3 color = vInstanceColor * (0.6 + 0.4 * falloff); // brighten toward center

  if (alpha < 0.01) discard; // cheap early-out for fully-transparent fragments,
                              // meaningful at thousands of overlapping instances

  gl_FragColor = vec4(color, alpha);
}
```

```glsl
// src/features/universe/engine/shaders/node-glow.vert.glsl
precision highp float;

attribute vec3 instanceColor;
attribute float instanceIntensity;

varying vec3 vInstanceColor;
varying float vInstanceIntensity;
varying vec2 vUv;

void main() {
  vInstanceColor = instanceColor;
  vInstanceIntensity = instanceIntensity;
  vUv = uv;

  // Billboard: strip rotation from the instance matrix's upper-left 3x3 so the
  // quad always faces the camera regardless of instance "orientation" (nodes
  // have no meaningful orientation of their own — only position and scale).
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mvPosition.xy += position.xy * vec2(instanceMatrix[0][0], instanceMatrix[1][1]);
  gl_Position = projectionMatrix * mvPosition;
}
```

`instanceIntensity` is the per-instance attribute driven by §8.6's fade-in: newly-arrived nodes are written into the instance buffer with `instanceIntensity = 0` and ramped to `1` over ~600ms via a small per-frame update loop scoped only to the subset of instances currently mid-fade (tracked in a small `Set<instanceIndex>`, not scanned across the whole buffer every frame).

### 30.2 Decorative starfield shader (R0, §8.2)

```glsl
// starfield.frag.glsl — deliberately flatter, dimmer, and non-interactive-looking
// relative to node-glow.frag.glsl, per §8.2's "real vs decorative" requirement.
precision mediump float; // lower precision is fine — this is background dressing

varying float vTwinkle;

void main() {
  vec2 centered = gl_PointCoord - vec2(0.5);
  float dist = length(centered) * 2.0;
  float falloff = smoothstep(1.0, 0.0, dist);
  float alpha = falloff * 0.35 * vTwinkle; // capped well below node-glow's max alpha
  gl_FragColor = vec4(vec3(0.29, 0.35, 0.60), alpha); // fixed dim color, never
                                                       // per-instance-colorable —
                                                       // reinforces it's not real data
}
```

`vTwinkle` is a cheap per-vertex pseudo-random oscillation (`sin(time * seedFreq + seedPhase)`, seed derived from a stable per-star index, computed in the vertex shader, not animated via JS/CPU) — this keeps the entire decorative layer a single static `BufferGeometry` + one draw call regardless of star count, with all "life" coming from the GPU-side time uniform alone.

### 30.3 Edge line material

```glsl
// edge-line.frag.glsl
precision mediump float;
varying float vEdgeWeight; // 0..1, normalized relationship weight

void main() {
  vec3 color = mix(vec3(0.35, 0.42, 0.55), vec3(0.49, 0.61, 1.0), vEdgeWeight);
  float alpha = mix(0.15, 0.55, vEdgeWeight);
  gl_FragColor = vec4(color, alpha);
}
```

Rendered with `THREE.AdditiveBlending`, `depthWrite: false` — additive blending is what produces the "glowing connective tissue" look cheaply, and disabling depth-write prevents overlapping edges from fighting each other's depth-sort in a way that would look like flickering z-fighting at scale.

---

## 31. Camera Controller: Reference Implementation Sketch

Fleshing out §9.7's description with a fuller sketch — still illustrative, not final production code, but concrete enough to implement directly against.

```ts
// src/features/universe/engine/camera-controller.ts
import * as THREE from "three";

export type CameraControllerEvents = {
  onRegimeCrossing: (from: Regime, to: Regime) => void;
  onSettle: (state: SerializedCameraState) => void;
  onFlightComplete: () => void;
};

export class UniverseCameraController {
  private camera: THREE.PerspectiveCamera;
  private focalPoint: THREE.Vector3;      // origin-relative (float32-safe), §9.2
  private distance: number;                // camera-to-focal distance, this regime's units
  private yaw = 0;
  private pitch = -0.15;
  private zoomTier = 0;                    // continuous, drives §9.4's regime classification
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private flight: CameraFlight | null = null;

  constructor(
    camera: THREE.PerspectiveCamera,
    private events: CameraControllerEvents,
    private zoomSensitivity = 0.0018,
  ) {
    this.camera = camera;
    this.focalPoint = new THREE.Vector3();
    this.distance = 2000; // initial R0-ish distance
  }

  handleWheel(deltaY: number, cursorNdc: THREE.Vector2) {
    // Multiplicative zoom — see §9.7's rationale for why this must not be additive.
    const factor = Math.exp(-deltaY * this.zoomSensitivity);
    this.distance = clamp(this.distance * factor, MIN_REGIME_DISTANCE, MAX_REGIME_DISTANCE);
    this.zoomTier = distanceToZoomTier(this.distance);
    this.retargetTowardCursor(cursorNdc, factor); // zoom-to-cursor, §8.3
    this.armSettleTimer();
  }

  handleDrag(deltaX: number, deltaYPixels: number, orbiting: boolean) {
    if (orbiting) {
      this.yaw += deltaX * ORBIT_SENSITIVITY;
      this.pitch = clamp(this.pitch + deltaYPixels * ORBIT_SENSITIVITY, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    } else {
      // Pan — moves the focal point, not just the camera, so orbiting after a
      // pan still orbits around the (now-moved) point the user was looking at.
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.focalPoint.addScaledVector(right, -deltaX * PAN_SENSITIVITY * this.distance);
      this.focalPoint.addScaledVector(forward, deltaYPixels * PAN_SENSITIVITY * this.distance);
    }
    this.armSettleTimer();
  }

  /** Scripted transition per §8.4 — logarithmic-time ease on the zoom-tier
   *  dimension, orbital sweep on bearing, not a straight linear dolly. */
  flyTo(targetFocal: THREE.Vector3, targetDistance: number, durationMs = 1400) {
    this.flight = new CameraFlight({
      fromFocal: this.focalPoint.clone(),
      toFocal: targetFocal.clone(),
      fromDistance: this.distance,
      toDistance: targetDistance,
      fromYaw: this.yaw,
      toYaw: computeBearingYaw(this.focalPoint, targetFocal, this.yaw),
      durationMs,
    });
  }

  /** Called once per frame from the R3F <Canvas>'s useFrame loop. */
  tick(deltaMs: number) {
    if (this.flight) {
      const done = this.flight.step(deltaMs, (state) => {
        this.focalPoint.copy(state.focal);
        this.distance = state.distance;
        this.yaw = state.yaw;
        this.zoomTier = distanceToZoomTier(this.distance);
      });
      if (done) { this.flight = null; this.events.onFlightComplete(); }
    }

    this.applyToThreeCamera();
    const newRegime = classifyRegime(this.zoomTier);
    if (newRegime !== this.currentRegime) {
      this.events.onRegimeCrossing(this.currentRegime, newRegime);
      this.currentRegime = newRegime;
    }
  }

  private applyToThreeCamera() {
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).multiplyScalar(this.distance);
    this.camera.position.copy(this.focalPoint).add(offset);
    this.camera.lookAt(this.focalPoint);
  }

  private armSettleTimer() {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.events.onSettle(this.serialize());
    }, 150); // §9.7's 150ms settle threshold
  }

  serialize(): SerializedCameraState {
    return {
      x: this.focalPoint.x, y: this.focalPoint.y, z: this.focalPoint.z,
      yaw: this.yaw, pitch: this.pitch, tier: this.zoomTier,
      focus: null, // populated by the caller if a node is currently selected
    };
  }

  private currentRegime: Regime = "R0";
}

/** Logarithmic-time ease on zoom tier, orbital bearing sweep on yaw — §8.4. */
class CameraFlight {
  private elapsed = 0;
  constructor(private plan: FlightPlan) {}

  step(deltaMs: number, apply: (state: FlightFrameState) => void): boolean {
    this.elapsed += deltaMs;
    const t = clamp(this.elapsed / this.plan.durationMs, 0, 1);
    const eased = cubicBezierEase(t); // standard ease-in-out on normalized time

    // Interpolate distance in LOG space, not linear space — see §8.4's rationale:
    // equal *perceptual* zoom-tier progress per unit of eased time, not equal
    // raw-distance progress (which would either rush or crawl at the extremes).
    const logFrom = Math.log(this.plan.fromDistance);
    const logTo = Math.log(this.plan.toDistance);
    const distance = Math.exp(logFrom + (logTo - logFrom) * eased);

    const focal = this.plan.fromFocal.clone().lerp(this.plan.toFocal, eased);
    const yaw = lerpAngle(this.plan.fromYaw, this.plan.toYaw, eased);

    apply({ focal, distance, yaw });
    return t >= 1;
  }
}

type FlightPlan = {
  fromFocal: THREE.Vector3; toFocal: THREE.Vector3;
  fromDistance: number; toDistance: number;
  fromYaw: number; toYaw: number;
  durationMs: number;
};
type FlightFrameState = { focal: THREE.Vector3; distance: number; yaw: number };
type Regime = "R0" | "R1" | "R2" | "R3";

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function cubicBezierEase(t: number) { return t * t * (3 - 2 * t); } // smoothstep as a placeholder
                                                                     // for a tuned cubic-bezier,
                                                                     // §23.2's --vx-ease-standard
function lerpAngle(a: number, b: number, t: number) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  return a + diff * t;
}
```

`MIN_REGIME_DISTANCE`/`MAX_REGIME_DISTANCE` are deliberately **not** absolute floor/ceiling values for the whole zoom range — per §8.2's third sub-claim, they're the current *regime's* local distance bounds; crossing one triggers a regime hand-off (§9.2.3's scene cross-fade) which re-frames the same continuous `zoomTier` value into a fresh regime-local `distance` range, rather than the zoom gesture itself ever being clamped.

---

## 32. Synthetic Seed Data Generator (Dev/Test Tooling)

Referenced by §26.2 (local mock backend) and §16.3 (load-shaped tests). A standalone script, not shipped in the production bundle, generating a graph with realistic clustering structure (not uniform-random, which would produce an unrealistically even spatial distribution that doesn't stress the grid-cell index the way real, clumpy real-world graphs do).

```ts
// scripts/dev/generate-seed-graph.ts
import { createHash } from "node:crypto";

type SeedOptions = {
  nodeCount: number;
  clusterCount: number;       // number of "natural" dense regions
  edgeDensityPerNode: number; // average edges per node, biased toward same-cluster
  seed: string;               // stable across runs for reproducible fixtures, §10.5.3
};

function stableRandom(seedStr: string): () => number {
  // Deterministic PRNG (mulberry32) seeded from a hash of `seedStr`, so the
  // SAME seed always produces the SAME graph — required for §16.2's visual
  // regression golden-frame tests and §10.5.3's "don't reshuffle the universe
  // on every rebuild" determinism requirement to be testable at all.
  let a = createHash("sha256").update(seedStr).digest().readUInt32LE(0);
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSeedGraph(opts: SeedOptions) {
  const rand = stableRandom(opts.seed);
  const clusterCenters = Array.from({ length: opts.clusterCount }, () => ({
    x: (rand() - 0.5) * 20000,
    y: (rand() - 0.5) * 4000,   // flatter on Y — a loose "galactic disk" bias,
                                 // purely an aesthetic default, not load-bearing
    z: (rand() - 0.5) * 20000,
  }));

  const nodes = Array.from({ length: opts.nodeCount }, (_, i) => {
    const cluster = clusterCenters[Math.floor(rand() * clusterCenters.length)];
    const spread = 400 + rand() * 800; // dense core, loose halo per cluster
    return {
      _key: `n${i}`,
      type: pick(rand, ["service", "dataset", "person", "document"]),
      label: `Node ${i}`,
      weight: Math.round(rand() * 100),
      position: {
        x: cluster.x + (rand() - 0.5) * spread,
        y: cluster.y + (rand() - 0.5) * spread * 0.4,
        z: cluster.z + (rand() - 0.5) * spread,
      },
    };
  });

  const edges: { _from: string; _to: string; type: string; weight: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const edgeCount = Math.round(opts.edgeDensityPerNode * (0.5 + rand()));
    for (let e = 0; e < edgeCount; e++) {
      // Bias strongly toward nearby indices (same-cluster proxy, since nodes
      // aren't shuffled post-generation) to produce realistic, non-uniform
      // connectivity rather than a random graph's unrealistically even spread.
      const nearby = clampIndex(i + Math.round((rand() - 0.5) * 40), nodes.length);
      if (nearby === i) continue;
      edges.push({ _from: `nodes/n${i}`, _to: `nodes/n${nearby}`, type: "relates_to", weight: rand() });
    }
  }

  return { nodes, edges };
}

function pick<T>(rand: () => number, options: T[]): T { return options[Math.floor(rand() * options.length)]; }
function clampIndex(i: number, len: number) { return ((i % len) + len) % len; }
```

Recommended fixture sizes for the three testing tiers described in §16: a small (~500 node) fixture for fast component/unit tests, a medium (~50,000 node) fixture for the Phase 0 spike (§18) and CI visual-regression runs, and a large (~500,000+ node) fixture reserved for the periodic (not-every-CI-run) load-shaped test in §16.3, given its cost/duration.

---

## 33. Full Reference Component Implementations

Fleshing out §17's interfaces with fuller implementation sketches for the pieces most likely to be gotten subtly wrong from an interface alone — composer keyboard handling (§7.7), scroll-anchor behavior (§7.6), and the mode-toggle's morph animation (§6.5). These are still illustrative (styling/className details omitted or abbreviated), but the *behavioral* logic is written out fully because that's where the actual specification value is.

### 33.1 `ChatComposer` — full keyboard/IME/queued-send behavior

```tsx
// src/features/console/floating-island/chat-composer.tsx
"use client";
import { useRef, useState, useEffect, useCallback } from "react";

export function ChatComposer({ threadId, onSend, isStreaming, onStop }: ChatComposerProps) {
  const [draft, setDraft] = useState(() => restoreDraft(threadId));
  const [queuedSend, setQueuedSend] = useState<OutgoingMessage | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasStreamingRef = useRef(isStreaming);

  // Persist draft on every keystroke, debounced — §7.10.
  useEffect(() => {
    const handle = setTimeout(() => persistDraft(threadId, draft), 250);
    return () => clearTimeout(handle);
  }, [threadId, draft]);

  // Autosize — grows up to 40vh, then internally scrolls. §7.7.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = window.innerHeight * 0.4;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  // Queued-send: if the user hit Enter while a previous stream was still
  // running, fire the queued message the instant streaming ends. §7.7.
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming && queuedSend) {
      onSend(queuedSend);
      setQueuedSend(null);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, queuedSend, onSend]);

  const submit = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const message: OutgoingMessage = { text: trimmed, attachments: [] };
    if (isStreaming) {
      setQueuedSend(message); // don't fire yet — wait for current stream to finish
    } else {
      onSend(message);
    }
    setDraft("");
    persistDraft(threadId, "");
  }, [draft, isStreaming, onSend, threadId]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Critical: ignore Enter while an IME composition is in progress (CJK/
      // Korean input), or the composing text gets prematurely submitted. §7.7.
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <div className="vx-chat-composer">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything…"
        rows={1}
        aria-label="Message"
      />
      {isStreaming ? (
        <button type="button" onClick={onStop} aria-label="Stop generating" className="vx-composer-stop">
          <StopIcon aria-hidden />
        </button>
      ) : (
        <button type="button" onClick={submit} disabled={!draft.trim()} aria-label="Send message">
          <SendIcon aria-hidden />
        </button>
      )}
      {queuedSend && <div className="vx-composer-queued-hint">Sending after this response finishes…</div>}
    </div>
  );
}

function restoreDraft(threadId: string): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(`vx-draft:${threadId}`) ?? "";
}
function persistDraft(threadId: string, value: string) {
  if (typeof window === "undefined") return;
  if (value) sessionStorage.setItem(`vx-draft:${threadId}`, value);
  else sessionStorage.removeItem(`vx-draft:${threadId}`);
}
```

### 33.2 Scroll-anchor behavior — the exact contract from §7.6, implemented

```tsx
// src/features/chat/scroll/use-scroll-anchor.ts
"use client";
import { useRef, useState, useCallback, useLayoutEffect } from "react";

const NEAR_BOTTOM_THRESHOLD_PX = 100;

export function useScrollAnchor(deps: { messageCount: number; isStreaming: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScrollArmed, setAutoScrollArmed] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const prevScrollHeightRef = useRef(0);

  const isNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;
  }, []);

  // Rule 1 & 2 (§7.6): auto-scroll only if already near bottom; any manual
  // upward scroll during streaming immediately disarms it.
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (isNearBottom()) {
      setAutoScrollArmed(true);
      setShowJumpToLatest(false);
    } else if (!autoScrollArmed) {
      // already disarmed, nothing changes
    } else {
      // user scrolled up while it was armed → disarm (rule 2)
      setAutoScrollArmed(false);
    }
  }, [autoScrollArmed, isNearBottom]);

  // Rule 3: show "Jump to latest" while suspended and content is still arriving.
  useLayoutEffect(() => {
    if (!autoScrollArmed && deps.isStreaming) setShowJumpToLatest(true);
    if (autoScrollArmed) setShowJumpToLatest(false);
  }, [autoScrollArmed, deps.isStreaming]);

  // Rule 1 execution: on new content, scroll to bottom IF armed.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !autoScrollArmed) return;
    el.scrollTop = el.scrollHeight;
  }, [deps.messageCount, autoScrollArmed]);

  // Rule 5: prepend-compensation for older-message pagination — call this
  // BEFORE inserting older messages, then again (with the new scrollHeight)
  // immediately after, in the same effect flush, to avoid any visible jump.
  const captureScrollHeightForPrepend = useCallback(() => {
    if (containerRef.current) prevScrollHeightRef.current = containerRef.current.scrollHeight;
  }, []);
  const compensateAfterPrepend = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const delta = el.scrollHeight - prevScrollHeightRef.current;
    el.scrollTop += delta;
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setAutoScrollArmed(true);
    setShowJumpToLatest(false);
  }, []);

  // Rule 4: force-scroll on the user's own new message, regardless of prior state.
  const forceScrollOnSend = useCallback(() => {
    setAutoScrollArmed(true);
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  return {
    containerRef, handleScroll, showJumpToLatest, jumpToLatest,
    captureScrollHeightForPrepend, compensateAfterPrepend, forceScrollOnSend,
  };
}
```

### 33.3 `ModeToggleButton` — icon morph without layout shift

```tsx
// src/features/console/console-header/mode-toggle-button.tsx
"use client";
import { motion, AnimatePresence } from "framer-motion";

export function ModeToggleButton({ mode, onToggleMode, hasOtherModeActivity, disabled }: ModeToggleButtonProps) {
  const nextMode = mode === "chat" ? "universe" : "chat";
  return (
    <button
      type="button"
      onClick={onToggleMode}
      disabled={disabled}
      aria-label={nextMode === "universe" ? "Open the Universe" : "Open Chat"}
      className="vx-mode-toggle"
      data-pulse={hasOtherModeActivity || undefined}
    >
      <AnimatePresence mode="wait" initial={false}>
        {/* key on `mode`, not `nextMode` — the ICON SHOWN reflects the current
            mode per §1.1/§6.2's rule: chat mode shows the globe (invitation
            OUT), universe mode shows the chat bubble (invitation back). This
            comment exists because it is the single easiest thing to invert
            by mistake during implementation. */}
        <motion.span
          key={mode}
          initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
        >
          {mode === "chat" ? <GlobeIcon aria-hidden /> : <ChatBubbleIcon aria-hidden />}
        </motion.span>
      </AnimatePresence>
      {disabled && <SpinnerOverlay aria-label="Loading the universe engine…" />}
    </button>
  );
}
```

### 33.4 `NodeDetailCard` — R3 inspect panel with the "ask in chat" bridge

```tsx
// src/features/universe/node-detail-card.tsx
"use client";

export function NodeDetailCard({ node, onAskInChat, onClose }: NodeDetailCardProps) {
  return (
    <aside className="vx-node-detail-card" role="dialog" aria-label={`Details for ${node.label}`}>
      <header>
        <TypeIcon type={node.type} aria-hidden />
        <h2>{node.label}</h2>
        <button type="button" onClick={onClose} aria-label="Close details">
          <CloseIcon aria-hidden />
        </button>
      </header>

      <dl className="vx-node-detail-properties">
        {Object.entries(node.properties).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{formatPropertyValue(value)}</dd>
          </div>
        ))}
      </dl>

      <p className="vx-node-detail-meta">
        {node.neighborCount} direct connection{node.neighborCount === 1 ? "" : "s"}
      </p>

      <div className="vx-node-detail-actions">
        <button type="button" onClick={() => onAskInChat(node.id)}>
          Ask about this in Chat
        </button>
      </div>
    </aside>
  );
}
```

`onAskInChat` is the reverse bridge referenced in §7.9/§8.3: it (a) toggles `mode` to `"chat"` via the shared Zustand store (§12.3), (b) opens a **new** thread (or appends to the current one, per a small UX decision left to implementation — appending to the current thread if one is open and empty, otherwise starting fresh, mirroring how most chat products handle "ask about X" from outside the chat), and (c) seeds the composer's draft with a reference to the node (e.g. `"Tell me about {label} ({type})"`, editable before sending — never auto-sent on the user's behalf).

---

## 34. TanStack Query Hooks: Full Implementations

Fleshing out §12.2's key conventions into the actual hooks components will call, so the data-fetching layer has one obvious, correct entry point per data type rather than components hand-rolling `useQuery` calls with slightly-different options each time.

### 34.1 Universe tile fetching hook

```ts
// src/features/universe/data/use-universe-tile.ts
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchUniverseTile } from "./universe-api";

export function useUniverseTile(tier: number, cellIds: string[], pyramidVersion: string) {
  return useQuery({
    queryKey: queryKeys.universeTile(tier, cellIds, pyramidVersion),
    queryFn: () => fetchUniverseTile({ tier, cellIds, pyramidVersion }),
    // Tiles are immutable for a given (tier, cells, pyramidVersion) triple —
    // once fetched, they never need refetching under the same key. §12.2's
    // pyramidVersion-in-key convention is what makes `Infinity` safe here.
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000, // still evict from memory eventually if unused,
                             // just never treat as "stale" while cached
    enabled: cellIds.length > 0,
  });
}

// Handles §11.1's cursor/nextChunkToken pagination transparently — a tile
// "query" from the calling component's perspective is a single logical
// result, even though it may involve several round-trips under the hood.
async function fetchAllPagesOfTile(params: TileFetchParams): Promise<DecodedTile> {
  let cursor: string | null = null;
  const pages: DecodedTilePage[] = [];
  do {
    const page = await fetchUniverseTilePage({ ...params, cursor });
    pages.push(page);
    cursor = page.header.nextChunkToken;
  } while (cursor);
  return mergeTilePages(pages);
}
```

### 34.2 Prefetching hook (drives §11.3's ring-prefetch and §8.4's fly-to path prefetch)

```ts
// src/features/universe/data/use-universe-prefetch.ts
export function useUniversePrefetch() {
  const queryClient = useQueryClient();
  return useCallback(
    (tier: number, cellIds: string[], pyramidVersion: string) => {
      return queryClient.prefetchQuery({
        queryKey: queryKeys.universeTile(tier, cellIds, pyramidVersion),
        queryFn: () => fetchUniverseTile({ tier, cellIds, pyramidVersion }),
        staleTime: Infinity,
      });
    },
    [queryClient],
  );
}
```

### 34.3 Node detail

```ts
// src/features/universe/data/use-node-detail.ts
export function useNodeDetail(nodeId: string | null) {
  return useQuery({
    queryKey: nodeId ? queryKeys.nodeDetail(nodeId) : ["universe", "node", "none"],
    queryFn: () => fetchNodeDetail(nodeId!),
    enabled: nodeId !== null,
    staleTime: 60_000, // node details can change (properties edited elsewhere,
                        // neighbor count shifting) — short-lived freshness,
                        // unlike the immutable tile cache above
  });
}
```

### 34.4 Search (debounced)

```ts
// src/features/universe/data/use-universe-search.ts
export function useUniverseSearch(rawQuery: string) {
  const debounced = useDebouncedValue(rawQuery, 200);
  return useQuery({
    queryKey: queryKeys.universeSearch(debounced),
    queryFn: () => fetchUniverseSearch(debounced),
    enabled: debounced.trim().length >= 2, // avoid firing on a single keystroke
    placeholderData: (prev) => prev, // keep showing the last result set while
                                      // the next debounced query resolves,
                                      // rather than flashing empty between
                                      // keystrokes
  });
}
```

### 34.5 Chat message history (initial page + pagination)

```ts
// src/features/chat/data/use-chat-history.ts
export function useChatHistory(threadId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.chatMessages(threadId),
    queryFn: ({ pageParam }) => fetchChatMessages(threadId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30_000,
  });
}
```

### 34.6 Realtime feed subscription (bridges §11.4's WS events into cache invalidation)

```ts
// src/features/universe/data/use-universe-realtime.ts
export function useUniverseRealtime() {
  const queryClient = useQueryClient();
  const markOtherModeActivity = useConsoleModeStore((s) => s.markOtherModeActivity);
  const mode = useConsoleModeStore((s) => s.mode);

  useEffect(() => {
    const socket = openUniverseSocket();
    const pendingCells = new Set<string>(); // §13.3's burst-coalescing
    let flushHandle: ReturnType<typeof setTimeout> | null = null;

    socket.onMessage((event: UniverseChangeEvent) => {
      const cells = extractAffectedCells(event); // e.g. [event.gridCell] or event.affectedCells
      cells.forEach((c) => pendingCells.add(c));
      if (mode === "chat") markOtherModeActivity();

      if (!flushHandle) {
        flushHandle = setTimeout(() => {
          for (const cell of pendingCells) {
            queryClient.invalidateQueries({
              predicate: (q) => queryKeyTouchesCell(q.queryKey, cell),
            });
          }
          pendingCells.clear();
          flushHandle = null;
        }, 200); // coalesce a burst of events into one invalidation pass
      }
    });

    return () => socket.close();
  }, [queryClient, mode, markOtherModeActivity]);
}
```

---

## 35. AQL Query Cookbook (Additional Queries)

Supplementing §10.4's core chunked-fetch queries with the supporting queries referenced elsewhere in this plan but not yet spelled out.

### 35.1 Tenant-scoped variant (per §15.2's mandatory security requirement)

```aql
// The REAL version of §10.4.2's candidate-node query — every query in §10.4
// must be written this way in the actual implementation; §10.4's versions
// omitted the tenant filter only for prose clarity.
LET candidateNodes = (
  FOR n IN nodes
    FILTER n.tenantId == @tenantId          // MANDATORY, applied first
    FILTER n.gridCell IN @cellIds
    LIMIT @nodeBatchSize
    RETURN n
)
```

### 35.2 Cluster child expansion (R1 → R2 drill-down on click)

```aql
// When a user clicks a cluster in R1, fetch its immediate children (either
// finer sub-clusters, or — at the finest materialized tier — a sample of
// real nodes) without needing a fresh spatial query.
FOR c IN node_clusters_L1
  FILTER c._key == @clusterId
  LET children = (
    FOR childId IN c.childClusterIds
      FOR child IN node_clusters_L2
        FILTER child._key == childId
        RETURN child
  )
  RETURN { cluster: c, children }
```

### 35.3 Incremental single-cell recompute (backing §10.5.4's fast local update path)

```aql
// Recompute just ONE leaf grid cell's cluster centroid/radius/memberCount
// after a node write, without touching the rest of the pyramid. The
// propagate-upward step (recomputing this cell's ancestor cluster at L{n-1},
// L{n-2}, ...) is a small, bounded loop of near-identical queries, one per
// tier, each only touching the single ancestor chain affected — never a
// full-graph pass.
LET members = (
  FOR n IN nodes
    FILTER n.gridCell == @gridCell
    RETURN n
)
LET centroid = {
  x: AVERAGE(members[*].position.x),
  y: AVERAGE(members[*].position.y),
  z: AVERAGE(members[*].position.z)
}
LET radius = MAX(
  FOR m IN members
    RETURN SQRT(
      POW(m.position.x - centroid.x, 2) +
      POW(m.position.y - centroid.y, 2) +
      POW(m.position.z - centroid.z, 2)
    )
)
UPSERT { gridCell: @gridCell, tier: @tier }
  INSERT { gridCell: @gridCell, tier: @tier, centroid, radius, memberCount: LENGTH(members), lastRebuiltAt: DATE_ISO8601(DATE_NOW()) }
  UPDATE { centroid, radius, memberCount: LENGTH(members), lastRebuiltAt: DATE_ISO8601(DATE_NOW()) }
  IN node_clusters_L2
```

### 35.4 Label-priority weighting for R2's on-screen label budget (§8.5)

Not itself an AQL concern (the on-screen-size threshold computation happens client-side, per-frame, per §8.5) — but the `weight` field it depends on for tie-breaking (when many nodes cross the size threshold simultaneously, which gets a label first) is computed server-side at write time, and should factor in at least: the node's own `properties`-derived importance signal (domain-specific, out of this plan's scope per Open Question #3, §24), plus a graph-structural signal cheaply computable in AQL — in/out degree:

```aql
FOR n IN nodes
  FILTER n._key == @nodeId
  LET degree = LENGTH(FOR e IN edges FILTER e._from == n._id OR e._to == n._id RETURN 1)
  UPDATE n WITH { weight: degree } IN nodes
```

Run as part of the same incremental-update path as §35.3 whenever a node's edges change, not recomputed live per view.

---

## 36. Worked Walkthrough: One User Session, End to End

A narrative trace tying every subsystem in this document together, in the order a real session actually touches them — useful as a sanity check that the pieces genuinely compose, and as an onboarding read for a new contributor who wants the "story" before the reference material.

1. **Cold visit to `vorinthex.com/console/home`, no session cookie.** `proxy.ts` (§4.3) sees no valid `vx_session` cookie, redirects to `/login?next=/console/home`.
2. **User submits email + password on `/login`.** A Server Action calls the backend; backend returns a partial (`mfa_required`) session cookie. Client redirects to `/login/verify`.
3. **User enters their 6-digit TOTP code.** Submitted via a Server Action to `/api/auth/verify`; backend validates against the stored factor, upgrades the cookie to `authenticated`, response triggers a redirect.
4. **`proxy.ts` now sees an `authenticated` cookie** on the redirect target and lets it through (or, since the redirect target is already `/console/home`, no further Proxy redirect is needed — it's already the intended destination).
5. **`/console/home` (Server Component) reads the `vx_last_mode` cookie** (§5.3) — empty for a first-time user — and redirects to `/console/c/new`.
6. **`console/layout.tsx` calls `verifySession()`** (§4.4), gets a valid session, renders `ConsoleShell`.
7. **`ConsoleShell` mounts** with `mode = "chat"` (from the Zustand store's default), rendering the chat page's empty-thread welcome state (§22.1) and the floating island's `ChatComposer`.
8. **User types a message and hits Enter.** `ChatComposer.submit()` (§33.1) fires; since `threadId === "new"`, `useConsoleChat` (§7.3) POSTs to `/api/chat` with `threadId: null`; the optimistic-id flow (§7.8) renders the user's message immediately under a `local-` id.
9. **The AI SDK v6 stream begins;** the assistant's first tokens render via the incremental markdown renderer (§7.5); the scroll-anchor hook (§33.2) auto-scrolls since the user is at the bottom.
10. **The response header carries `X-Thread-Id`;** the client swaps the URL to `/console/c/:realId` via `history.replaceState` and reconciles the TanStack Query cache key (§12.2).
11. **The assistant's reply includes a `search_universe` tool call** (the user asked something like "what do we know about the refund flow?"). The tool-call part renders as an inline card (§7.9) once the backend's tool result (a `SearchResult[]`) arrives; the assistant's final answer cites the top match with a "View in Universe" link.
12. **User clicks "View in Universe."** This calls the mode-toggle's underlying setter (§12.3) to `"universe"`, and — since this is the user's first-ever visit to Universe mode this session — `ConsoleShell` lazily mounts the Universe bundle (§9.1's dynamic import) for the first time, showing a spinner overlay on the toggle button (§33.3's `disabled` state) briefly.
13. **Once mounted, the Universe engine initializes** with the cited node as the initial `focus` (§8.7), sets the local origin to that node's true position (§9.2.4), and immediately calls `flyTo()` (§8.4/§31) from a default R0 starting view down to R3, prefetching every regime's tiles along the flight path (§8.4's guarantee) before the animation starts.
14. **The camera settles on the cited node in R3;** `NodeDetailCard` (§33.4) renders with its properties and neighbor count (fetched via §34.3's `useNodeDetail`).
15. **A background process on the backend creates a new node** related to this one while the user is looking at it. The realtime feed (§11.4/§34.6) delivers a `node_created` event whose `gridCell` matches a currently-loaded cell; the client invalidates that tile's cache entry, refetches, and the new node fades in via the §30.1 shader's `instanceIntensity` ramp (§8.6) — the user sees it appear with a soft pulse, not a jarring pop.
16. **User toggles back to Chat** (now showing the globe icon per §1.1's rule, inviting them back out — wait, no: they're now IN universe mode, so the header shows the chat-bubble icon, inviting them back to chat). They click it; `ConsoleShell`'s off-tree mounting (§6.3) means the chat thread they left is exactly as they left it — same scroll position, same composer draft state if they'd been mid-typing anything.
17. **On the next visit (tomorrow), cold-loading `/console/home` again:** `vx_last_mode` cookie now says `"universe"` (§6.4, written on last toggle), so `/console/home` redirects straight to `/console/u` with the last-serialized camera state (§8.7) restoring their exact prior viewpoint, local origin re-derived from the serialized `focus` node per §9.2.4 — picking up exactly where they left off.

---

## 37. Web Worker Reference Implementations

Full sketches for the three named workers introduced in §9.6, matching the message contracts pinned down in §17.4.

### 37.1 `decode.worker.ts`

```ts
// src/features/universe/engine/workers/decode.worker.ts
/// <reference lib="webworker" />

self.onmessage = (event: MessageEvent<DecodeWorkerRequest>) => {
  if (event.data.type !== "decode") return;
  const view = new DataView(event.data.buffer);

  let offset = 0;
  const headerLength = view.getUint32(offset, true); offset += 4;
  const headerBytes = new Uint8Array(event.data.buffer, offset, headerLength);
  const header: TileHeader = JSON.parse(new TextDecoder().decode(headerBytes));
  offset += headerLength;

  const nodeCount = view.getUint32(offset, true); offset += 4;

  const positions = new Float32Array(event.data.buffer, offset, nodeCount * 3);
  offset += nodeCount * 3 * Float32Array.BYTES_PER_ELEMENT;

  const ids = new Uint32Array(event.data.buffer, offset, nodeCount);
  offset += nodeCount * Uint32Array.BYTES_PER_ELEMENT;

  const response: DecodeWorkerResponse = { type: "decoded", header, positions, ids };

  // Transfer the underlying buffers back — zero-copy, per §11.1's requirement
  // that the main thread never pays a structured-clone copy cost for this data.
  (self as unknown as Worker).postMessage(response, [positions.buffer, ids.buffer]);
};
```

### 37.2 `cluster.worker.ts`

```ts
// src/features/universe/engine/workers/cluster.worker.ts
/// <reference lib="webworker" />

self.onmessage = (event: MessageEvent<ClusterWorkerRequest>) => {
  if (event.data.type !== "rebucket") return;
  const { nodes, cellSize } = event.data;

  const buckets = new Map<string, SpatialBucket>();
  for (const node of nodes) {
    const [x, y, z] = node.position;
    const cellKey = `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;
    let bucket = buckets.get(cellKey);
    if (!bucket) {
      bucket = { cellKey, memberIds: [], centroid: [0, 0, 0] };
      buckets.set(cellKey, bucket);
    }
    bucket.memberIds.push(node.id);
    bucket.centroid[0] += x; bucket.centroid[1] += y; bucket.centroid[2] += z;
  }
  for (const bucket of buckets.values()) {
    const n = bucket.memberIds.length;
    bucket.centroid = [bucket.centroid[0] / n, bucket.centroid[1] / n, bucket.centroid[2] / n];
  }

  const response: ClusterWorkerResponse = { type: "rebucketed", buckets: Array.from(buckets.values()) };
  (self as unknown as Worker).postMessage(response);
};
```

This client-side grid (distinct from, and much coarser-lived than, the server's persisted `gridCell`/pyramid, per §9.6.2's clarification) also backs the coarse-pick spatial index from §9.5 — the same `buckets` output narrows raycast candidates before exact per-instance hit-testing runs.

### 37.3 `layout.worker.ts`

```ts
// src/features/universe/engine/workers/layout.worker.ts
/// <reference lib="webworker" />

const REPULSION_STRENGTH = 800;
const DAMPING = 0.85;

self.onmessage = (event: MessageEvent<LayoutWorkerRequest>) => {
  if (event.data.type !== "relax") return;
  const { nodes, iterations } = event.data;

  // Deliberately minimal — this is a transient visual smoothing pass for
  // freshly-arrived, not-yet-positioned siblings (§9.6.3), NOT a general
  // force-directed layout engine. Positions here are never persisted;
  // server-computed positions (§10.5.3) remain authoritative the instant
  // they arrive.
  const velocities = new Map<string, [number, number, number]>(nodes.map((n) => [n.id, [0, 0, 0]]));
  const positions = new Map<string, [number, number, number]>(nodes.map((n) => [n.id, [...n.position]]));

  for (let iter = 0; iter < iterations; iter++) {
    for (const a of nodes) {
      const pa = positions.get(a.id)!;
      const va = velocities.get(a.id)!;
      for (const b of nodes) {
        if (a.id === b.id) continue;
        const pb = positions.get(b.id)!;
        const dx = pa[0] - pb[0], dy = pa[1] - pb[1], dz = pa[2] - pb[2];
        const distSq = dx * dx + dy * dy + dz * dz + 0.01;
        const force = REPULSION_STRENGTH / distSq;
        const dist = Math.sqrt(distSq);
        va[0] += (dx / dist) * force; va[1] += (dy / dist) * force; va[2] += (dz / dist) * force;
      }
    }
    for (const n of nodes) {
      const p = positions.get(n.id)!;
      const v = velocities.get(n.id)!;
      v[0] *= DAMPING; v[1] *= DAMPING; v[2] *= DAMPING;
      p[0] += v[0] * 0.016; p[1] += v[1] * 0.016; p[2] += v[2] * 0.016;
    }
  }

  const response: LayoutWorkerResponse = { type: "relaxed", positions };
  (self as unknown as Worker).postMessage(response);
};
```

An O(n²) pairwise repulsion pass is acceptable here specifically because this worker only ever runs over a small transient subset (freshly-arrived, unpositioned siblings — realistically single-digit to low-double-digit counts at any moment, per §9.6.3's scope), never the full loaded node set; if that assumption is ever violated in practice, switch to a Barnes-Hut approximation before reaching for a bigger hammer like adopting `cosmos.gl` (§9.1's flagged alternative) just for this narrow job.

### 37.4 Worker pool management

All three workers are long-lived (created once per Universe mount, not per-message) via a small pool manager:

```ts
// src/features/universe/engine/worker-pool.ts
class UniverseWorkerPool {
  private decode = new Worker(new URL("./workers/decode.worker.ts", import.meta.url));
  private cluster = new Worker(new URL("./workers/cluster.worker.ts", import.meta.url));
  private layout = new Worker(new URL("./workers/layout.worker.ts", import.meta.url));

  decodeTile(buffer: ArrayBuffer): Promise<DecodeWorkerResponse> {
    return new Promise((resolve) => {
      const handle = (e: MessageEvent<DecodeWorkerResponse>) => {
        this.decode.removeEventListener("message", handle);
        resolve(e.data);
      };
      this.decode.addEventListener("message", handle);
      this.decode.postMessage({ type: "decode", buffer } satisfies DecodeWorkerRequest, [buffer]);
    });
  }

  dispose() {
    this.decode.terminate();
    this.cluster.terminate();
    this.layout.terminate();
  }
}
```

`dispose()` is called on Universe unmount — which, per §6.3's off-tree persistent-mounting design, only actually happens on a full page navigation away from `/console` entirely (tab close, or navigating to `/console/settings` — wait: per §6.3, the Universe panel is never unmounted once mounted for the lifetime of the console session, so in practice `dispose()` only fires on a true `ConsoleShell` unmount, i.e., leaving `/console` altogether). This is worth stating explicitly because it means worker lifecycle is simpler than a naive "workers per mount" model might suggest: **one worker pool, for the whole console session, from first Universe toggle until the user navigates away from `/console` entirely.**

---

## 38. Backend LOD Pyramid Build Job (Pseudocode)

Not this plan's implementation responsibility (backend scope, §2.2), but sketched here in enough detail that the frontend team can sanity-check the contract it depends on (§10.5) actually holds together end to end, and so the backend team has a concrete starting point that's already been reasoned through against the frontend's needs.

```
function rebuildLodPyramid(graph):
    # 1. Ensure every node has a position (§10.5.3) — run the deterministic
    #    force-directed layout for any node lacking one, seeded by hash(_key).
    unpositioned = query nodes WHERE position IS NULL
    if unpositioned.length > 0:
        newPositions = runDeterministicForceLayout(unpositioned, existingGraph = graph)
        bulkUpdate(nodes, newPositions)

    # 2. Build the finest materialized tier (L{N}) bottom-up from raw nodes,
    #    via grid-based agglomeration (§10.5.2) — NOT a generic clustering
    #    algorithm, specifically to preserve spatial locality.
    finestTier = buildGridClusters(nodes, cellSize(tier = N))
    persist(node_clusters_L{N}, finestTier)

    # 3. Repeat upward: each tier's clusters are built by merging the tier
    #    below's clusters into coarser grid cells, until L0.
    for tier in range(N - 1, -1, -1):
        coarserClusters = buildGridClusters(
            previousTierClusters,
            cellSize(tier),
            weightBy = "memberCount"   # centroid = weighted mean, not naive mean,
                                       # so a dense sub-cluster pulls its parent's
                                       # centroid appropriately
        )
        persist(node_clusters_L{tier}, coarserClusters)
        previousTierClusters = coarserClusters

    # 4. Stamp clusterPath back onto every real node (§10.5.2 step 3) and bump
    #    pyramidVersion as a single atomic value covering the whole pyramid,
    #    so clients never observe a torn mix of old/new tiers (§10.5.2's
    #    consistency requirement).
    newVersion = generateVersionStamp()
    for node in nodes:
        node.clusterPath = resolveClusterPathForNode(node, allTiers)
    bulkUpdate(nodes, {clusterPath})
    setGlobalPyramidVersion(newVersion)

    # 5. Notify the realtime feed (§11.4) of a full pyramid rebuild so
    #    connected clients can proactively refresh R0/R1 tiles rather than
    #    waiting for their next natural cache-key miss.
    broadcast({ type: "cluster_rebuilt", tier: "all", pyramidVersion: newVersion, affectedCells: ["*"] })


function incrementalCellUpdate(gridCell, tier):
    # The fast path — §10.5.4/§35.3. Only this single cell's cluster doc (and
    # its ancestor chain, one doc per coarser tier) is recomputed; the rest of
    # the pyramid, and pyramidVersion itself, are untouched. This is what
    # keeps individual node creates/updates cheap and near-real-time despite
    # the full rebuild above being an expensive, infrequent batch job.
    recomputeClusterDoc(gridCell, tier)
    parentCell = parentGridCell(gridCell, tier)
    if parentCell is not None:
        incrementalCellUpdate(parentCell, tier - 1)   # propagate upward
```

The key structural point for the frontend team to internalize from this pseudocode: **`pyramidVersion` only changes on the expensive full rebuild (step 4), not on every incremental update** — meaning §12.2's cache-key strategy (keying tiles by `pyramidVersion`) will *not* automatically invalidate client caches for incremental single-cell updates. That gap is exactly why §11.4's realtime feed carries its own `cluster_rebuilt`-independent `node_created`/`node_updated` events with explicit `gridCell` targeting — the two invalidation paths (version-bump for full rebuilds, targeted realtime events for incremental updates) are deliberately complementary, not redundant, and both are required for correctness.

---

## 39. Console Shell: Reference Stylesheet

Full CSS backing §6's layout description, building on the design tokens from §23. Written as plain CSS (this repo already uses Tailwind v4 alongside plain CSS in places — `src/shared/packages/ui`'s components; either Tailwind utility classes or this hand-written CSS is a reasonable implementation choice, shown here as plain CSS for clarity of the exact box model/layout behavior being specified).

```css
/* src/app/console/console-theme.css */

:root[data-console-theme="dark"] {
  --vx-console-bg: #0B0D10;
  --vx-console-surface: #14171B;
  --vx-console-surface-raised: #1C2026;
  --vx-console-border: rgba(255, 255, 255, 0.08);
  --vx-console-text: #EDEFF2;
  --vx-console-text-muted: #9BA1AC;
  --vx-console-accent: #7C9CFF;
  --vx-console-accent-dim: #4A5A99;
  --vx-console-danger: #E5695A;
  --vx-console-success: #6FCF97;
  --vx-console-island-bg: rgba(20, 23, 27, 0.72);
  --vx-console-island-blur: 20px;
  --vx-console-island-border: rgba(255, 255, 255, 0.12);
  --vx-header-height: 56px;
  --vx-island-max-width: 760px;

  color-scheme: dark;
}

.vx-console-root {
  display: grid;
  grid-template-rows: var(--vx-header-height) 1fr;
  height: 100dvh;
  background: var(--vx-console-bg);
  color: var(--vx-console-text);
  overflow: hidden; /* the Universe canvas and chat scroll area each own their
                        own internal scrolling — the shell itself never scrolls */
}

.vx-console-header {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--vx-console-border);
  background: var(--vx-console-surface);
  z-index: 30; /* above both panels, below the floating island (z-index: 40, §6.5) */
}

.vx-console-breadcrumb {
  font-size: 13px;
  color: var(--vx-console-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vx-console-body {
  position: relative;
  overflow: hidden;
}

/* Both panels occupy the exact same grid cell, stacked — §6.3's off-tree
   mounting relies on this so toggling is a pure visibility/opacity swap with
   zero layout recalculation cost. */
.vx-console-body > div {
  position: absolute;
  inset: 0;
}

.vx-console-body > div[hidden] {
  /* Deliberately NOT display:none for the Universe panel specifically — see
     the note below this stylesheet re: WebGL canvases and display:none. */
  visibility: hidden;
  pointer-events: none;
}

/* --- Mode toggle button --- */

.vx-mode-toggle {
  position: relative;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: var(--vx-console-text);
  cursor: pointer;
  transition: background 120ms var(--vx-ease-standard, ease);
}
.vx-mode-toggle:hover { background: var(--vx-console-surface-raised); }
.vx-mode-toggle:focus-visible { outline: 2px solid var(--vx-console-accent); outline-offset: 2px; }

.vx-mode-toggle[data-pulse]::after {
  content: "";
  position: absolute;
  top: 4px; right: 4px;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--vx-console-accent);
  box-shadow: 0 0 0 2px var(--vx-console-surface);
  animation: vx-pulse 1.8s ease-in-out infinite;
}

@keyframes vx-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.15); }
}

/* --- Floating island --- */

.vx-island {
  position: fixed;
  left: 50%;
  bottom: max(24px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  width: min(var(--vx-island-max-width), calc(100vw - 32px));
  z-index: 40;
}

.vx-island-surface {
  background: var(--vx-console-island-bg);
  backdrop-filter: blur(var(--vx-console-island-blur));
  -webkit-backdrop-filter: blur(var(--vx-console-island-blur));
  border: 1px solid var(--vx-console-island-border);
  border-radius: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255, 255, 255, 0.04) inset;
  padding: 10px 12px;
  display: grid;
  gap: 8px;
  transition: grid-template-rows 220ms var(--vx-ease-standard, ease);
}

@media (prefers-reduced-motion: reduce) {
  .vx-island-surface { transition-duration: 60ms; }
  .vx-mode-toggle[data-pulse]::after { animation-duration: 3.2s; }
}

/* --- Chat composer --- */

.vx-chat-composer {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: flex-end;
  gap: 8px;
}
.vx-chat-composer textarea {
  resize: none;
  background: transparent;
  border: none;
  color: var(--vx-console-text);
  font: inherit;
  line-height: 1.5;
  max-height: 40vh;
}
.vx-chat-composer textarea:focus { outline: none; }

/* --- Node detail card (R3) --- */

.vx-node-detail-card {
  position: absolute;
  top: 16px;
  right: 16px;
  width: min(360px, calc(100vw - 32px));
  max-height: calc(100dvh - var(--vx-header-height) - 120px); /* clears the island */
  overflow-y: auto;
  background: var(--vx-console-surface-raised);
  border: 1px solid var(--vx-console-border);
  border-radius: 16px;
  padding: 16px;
  z-index: 20; /* above the canvas, below the header/island */
}
```

**Important implementation note on `display: none` vs. `visibility: hidden` for the Universe panel:** the stylesheet above deliberately uses `visibility: hidden` (plus `pointer-events: none`) rather than `display: none` when hiding the inactive panel. This matters specifically for the Three.js canvas: some browsers pause/throttle `requestAnimationFrame` more aggressively (or, in edge cases, have historically mishandled WebGL context state) for elements with `display: none` than for elements that are merely `visibility: hidden` off in a stacking context — using `visibility` keeps the render loop's behavior predictable and avoids a class of "canvas goes blank/context looks lost after toggling back" bugs that `display: none` toggling has been known to trigger in some browser/driver combinations. This single CSS property choice is exactly the kind of detail that's easy to "simplify" during a refactor and reintroduce a subtle bug — flagged explicitly for that reason, cross-referencing ADR-004 (§20).

---

## 40. API Response & Error Contract Reference

A consolidated reference for how every proxied route handler (§17.5) should shape success and error responses, so error handling on the client (§22's state catalog) has one consistent contract to branch on rather than each endpoint inventing its own error shape.

### 40.1 Standard error envelope

```ts
type ApiErrorResponse = {
  error: {
    code: string;            // machine-readable, e.g. "MFA_LOCKOUT", "TILE_FETCH_FAILED",
                              // "SESSION_EXPIRED", "RATE_LIMITED"
    message: string;         // human-readable, safe to show directly in relevant UI states
    retryAfterMs?: number;   // present for rate-limit/lockout errors (§4.5, §22.3)
    details?: Record<string, unknown>; // e.g. { attemptsRemaining: 2 }
  };
};
```

Every non-2xx response from `app/api/*` route handlers uses this envelope, regardless of what shape the underlying backend error actually was — the proxy layer (§2.3) is responsible for normalizing whatever the backend returns into this consistent shape, so client-side error handling (the `onError` callbacks feeding §22's state catalog) never needs backend-specific parsing logic.

### 40.2 HTTP status code conventions used throughout this plan

| Status | Meaning in this system | Example |
|---|---|---|
| `200` | Success | Tile fetched, chat message sent |
| `401` | Not authenticated at all, or session fully invalid | Triggers `unauthorized()` (leaf-level, §4.4) or a hard redirect (shell-level, ADR-007) |
| `403` | Authenticated but not authorized for this specific resource (e.g., a tenant-scoping mismatch, §15.2) | Node belongs to a different tenant |
| `423` | Locked — MFA lockout specifically (distinct from generic rate limiting) | Too many failed `/login/verify` attempts (§4.5) |
| `429` | Rate limited (non-MFA) | Chat message rate limit, tile-fetch abuse guard (§15.2) |
| `499` (non-standard, client-only convention) | Client-side cancelled (e.g., a superseded tile request per §11.2's coalescing) | Never actually sent over the wire — used internally to distinguish "we cancelled this" from "it genuinely failed" in client-side error branches, so a cancelled/superseded request never surfaces a spurious error toast |
| `503` | Backend temporarily unavailable (distinct from a genuine 500 bug) | Feeds the "reconnecting" states (§22.2) rather than a hard error state |

### 40.3 Retry policy by error class

| Error class | Client retry behavior |
|---|---|
| Network failure (no response) | Automatic retry with exponential backoff, up to TanStack Query's configured `retry` count (§12.1) |
| `429`/`503` | Automatic retry honoring `retryAfterMs` if present, otherwise exponential backoff |
| `401` | Never auto-retried as-is — triggers the appropriate re-auth flow (§4.4/ADR-007) first, then the original request is naturally re-issued as a consequence of the user re-authenticating, not via a raw retry of the original call |
| `403` | Never retried — shown as a terminal error state (this is a genuine authorization failure, not transient) |
| `423` (MFA lockout) | Never retried until `retryAfterMs` elapses; composer/input disabled meanwhile (§22.3) |

---

## 41. Rate Limiting & Quota Reference

Consolidating every rate-limit-shaped concern mentioned across this document into one table, since they're easy to lose track of scattered through prose:

| Surface | Suggested limit (starting point, tune with real usage) | Rationale |
|---|---|---|
| `/login/verify` attempts | 5 attempts per session per 15 minutes, then `423` lockout with escalating cooldown | §4.5 — MFA brute-force protection |
| `/api/chat` message sends | Per-user token/message budget (exact figures a product/cost decision, not specified here) | Cost control on LLM calls — out of this plan's technical scope beyond flagging it needs to exist |
| `/api/universe/tiles` requests | Per-session cap on concurrent in-flight requests (2, per §11.2) enforced client-side; per-user requests/minute cap enforced server-side regardless of client behavior | §15.2's query-cost-abuse mitigation — the server-side cap is the real security boundary, the client-side cap is a courtesy that keeps well-behaved clients efficient |
| `/api/universe/search` | Debounced client-side to ≥200ms between requests (§34.4); server-side per-user requests/minute cap as backstop | Prevents keystroke-per-request abuse patterns even from a compromised/modified client |
| Realtime WS connection | One connection per authenticated session (server-enforced — a second connection for the same session should close the first, not create a duplicate) | Prevents connection-count abuse and simplifies the server's per-session re-validation logic (§15.2) |
| `/api/universe/nodes/:id` (detail fetch) | Per-user requests/minute cap, generous (this is a low-cost, single-document lookup, §10.6) but still bounded as a defense-in-depth measure | Prevents a scripted client from enumerating node ids at high volume even though each individual lookup is cheap |
| Signup / MFA enrollment attempts | Per-IP and per-email rate limit on `/signup` itself, separate from the `/login/verify` limit in §4.5 | Prevents automated account-creation abuse distinct from the already-covered login-side brute-force concern |
| `/api/universe/nodes/:id/neighbors` (1-hop expansion) | Per-user requests/minute cap, similar to the detail-fetch limit above | Bounds repeated invocation of a query that, while individually capped at 200 results (§10.4.3), could still be called at high frequency against many different nodes in sequence |
| Password reset requests | Per-email and per-IP rate limit, standard practice | Prevents email-bombing/enumeration abuse via the reset flow, a common target even though this plan doesn't otherwise detail the reset flow itself (out of scope, analogous to login/signup) |

---

## 42. Glossary

- **Cosmos (R0):** The coarsest zoom regime — cluster centroids rendered as glowing points, decorative starfield fills the background. §8.1.
- **Nebulae (R1):** The second-coarsest regime — sub-cluster clouds, still no individual real nodes rendered. §8.1.
- **Constellations (R2):** The regime where individual real nodes and their edges first render, viewport-bounded live query. §8.1.
- **Inspect (R3):** The closest regime — a single node or small set fills the view with a detail card. §8.1.
- **Regime:** One of R0-R3; a discrete rendering/data-fetching mode the camera occupies, not a continuous property. §8.1, §9.2.3.
- **Zoom tier (`zoomTier`):** A continuous float abstractly representing "how zoomed in," independent of any one regime's local coordinate units — the thing that actually drives regime classification. §9.2.3, §9.4.
- **Floating origin:** The technique of periodically re-centering the world so the camera stays near `(0,0,0)`, avoiding float32 precision loss at large camera-to-origin distances. §9.2.2.
- **Rebase:** A single floating-origin re-centering event — shifts the local origin and rewrites all currently-instanced transforms atomically within one frame. §9.2.2.
- **World Registry:** The double-precision (JS `number`), CPU-side source of truth for every renderable's "true" position, independent of the current local origin. §9.2.2.
- **LOD (Level of Detail):** The general technique of rendering less-detailed representations of distant/small-on-screen objects. In this plan, realized both via `<Detailed>`-style distance banding within a regime (§9.3.2) and via the precomputed cluster pyramid across regimes (§10.5).
- **LOD cluster pyramid:** The set of materialized `node_clusters_L0..LN` collections — precomputed, tiered aggregations of the real graph, analogous to map-tile pyramids. §10.5.
- **Grid cell (`gridCell`):** A denormalized field on every node/cluster document encoding a coarse spatial bucket at a given tier's characteristic scale — what viewport-bounded queries actually filter on. §10.3.
- **Tile:** A single fetch response covering a requested set of grid cells at a given tier — the unit of chunked data transfer between backend and client. §11.1.
- **`pyramidVersion`:** A version stamp covering the whole LOD pyramid as a unit, bumped only on full rebuilds, used as part of the tile cache key. §10.5.4, §12.2.
- **Instancing (`InstancedMesh`):** Rendering many copies of the same geometry in a single draw call via per-instance transform/color attributes — the core technique making thousands of rendered nodes performant. §9.3.1.
- **Draw call:** One GPU rendering command; the dominant performance bottleneck at scale that instancing exists to minimize. §9.3.1, §21 sources.
- **GPU picking:** An offscreen-render-then-readback technique for hit-testing, used as a fallback if CPU raycasting becomes a bottleneck. §9.5.
- **Floating island:** The persistent, centered-bottom composer/command-bar surface present in both Chat and Universe modes. §6.5.
- **Off-tree mounting:** This plan's approach of mounting both the Chat and Universe panels once and toggling visibility via CSS, independent of Next.js's route-based mount/unmount lifecycle. §6.3, ADR-004.
- **Fly-to:** The scripted camera transition (logarithmic-time zoom-tier easing + orbital bearing sweep) used when jumping to a search result or citation, as opposed to direct user-driven zoom/pan. §8.4, §31.
- **Settle event (`onSettle`):** Fired when the camera has been stationary for >150ms — triggers URL serialization and prefetch-ring widening. §9.7, §11.3.
- **Hysteresis-gapped (regime crossing):** Entering a regime at one threshold and only falling back at a further threshold, to prevent boundary flicker. §8.1, §9.4.
- **`proxy.ts`:** Next.js 16's renamed successor to `middleware.ts` — same functionality, new name/convention. §3.1.
- **Optimistic check:** A fast, cookie-only (no backend round-trip) auth check performed in `proxy.ts`, distinct from the authoritative backend-verified check in the DAL. §3.1, §4.3-§4.4.
- **DAL (Data Access Layer):** The centralized, `cache()`-memoized server-side module (`verifySession`, etc.) that all data requests and Server Actions route authorization through. §4.4.
- **`unauthorized()` / `unauthorized.tsx`:** Next.js's file-convention/function pair for rendering an in-place 401 UI, used narrowly at the leaf level per ADR-007. §3.2.
- **AI SDK v6 `UIMessage`:** The Vercel AI SDK's structured chat message representation (`parts`: text/reasoning/tool-call/tool-result/file), which this plan's `ChatMessage.parts` shape mirrors. §7.2, §21.
- **`useChat`:** The AI SDK v6 React hook managing chat lifecycle (send, stream, stop, error) against a configured transport. §7.3.
- **Optimistic thread creation:** Rendering the user's first message and a local placeholder id immediately, before the backend has minted a real thread id, then reconciling once it arrives. §7.8.
- **Scroll anchor:** The set of rules governing when chat auto-scrolls, when it stops, and how pagination avoids visible jumps. §7.6, §33.2.
- **Fence-aware highlighting:** Rendering an in-progress code block as plain monospace text until its closing fence arrives, only then running syntax highlighting once. §7.5.
- **Search-universe tool:** The chat-invocable tool that queries the graph and lets the assistant cite nodes inline, bridging Chat and Universe. §7.9.
- **Activity pulse:** The small dot/glow on the mode-toggle icon indicating unseen activity in the *other* mode. §6.6, §8.6.
- **TOTP (Time-based One-Time Password):** The MFA factor type this product uses, via the existing `TotpSetup` component. §4.1.
- **Partial session (`mfa_required`):** A short-lived, narrowly-scoped session state issued after password validation but before TOTP verification. §4.2-§4.3.
- **ArangoSearch:** ArangoDB's built-in full-text/fuzzy search view, used for the node-search endpoint. §10.7.
- **AQL:** ArangoDB's query language, used throughout §10 for both spatial-filtered fetches and graph traversals.
- **Cursor (ArangoDB):** The server-side pagination handle returned by a batched AQL query execution; must be explicitly deleted (or left to expire via `ttl`) when no longer needed. §10.4.4.
- **`nextChunkToken`:** The frontend-facing, opaque wrapper around a backend/ArangoDB cursor id — the only pagination handle the browser ever sees directly. §11.1.
- **Realtime change feed:** The WebSocket stream of `UniverseChangeEvent`s driving cache invalidation and the fade-in/activity-pulse behaviors. §11.4.
- **Fluid Compute:** Vercel's current recommended Functions runtime (instance-reuse, full Node.js APIs), used for this plan's `app/api/*` route handlers rather than Edge Functions. §2.4.
- **Cache Components / `use cache`:** Next 16's current server-caching primitive, used narrowly for static console chrome only, never for per-user live data. §3.4.
- **Engine bridge:** The pub-sub layer exposing throttled snapshots of the imperative, per-frame camera/engine state to React via `useSyncExternalStore`. §12.4.
- **Genuine leaf:** A node with no further zoomable children/edges — the positively-framed "edge of the known universe" empty state's trigger condition, not an error. §8.2.
- **Decorative starfield:** The procedurally generated, deliberately dim/non-interactive background fill used in R0 to make "infinite" zoom-out feel continuous even past real data density. §8.2, §30.2.
- **Off-main-thread:** Work performed inside a Web Worker rather than the main JS thread, so it can't block user input or the render loop. §9.6, §37.
- **Zombie connection:** A WebSocket that appears open at the application layer but has silently died at the transport layer, detectable only via a heartbeat/ping-pong mechanism. §64.
- **Chaos scenario:** A deliberately induced failure condition (network partition, malformed payload, backgrounded tab) tested to validate graceful degradation beyond normal QA click-throughs. §64.
- **Torn pyramid:** An inconsistent, partially-rebuilt state of the LOD cluster pyramid where different tiers reflect different underlying data snapshots — an explicitly disallowed state the backend's rebuild job must avoid via atomic version bumping. §10.5.2, §38, §64.
- **Frame version (`frameVersion`):** A per-tile-payload integer allowing the binary tile framing (§11.1) to evolve without breaking older connected clients, analogous to `pyramidVersion` but for the wire format itself rather than the data content. §65.
- **Definition of Done:** The per-phase checklist (§49) expanding this document's roadmap (§18) into concrete, checkable exit criteria.
- **Assumptions Register:** The consolidated list (§72) of things this plan took for granted without an explicit answer from the backend/product team, distinct from Open Questions (§24) which were explicitly posed.

---

## 43. Research Sources

Consulted while assembling this plan (web research performed at authoring time, July 2026):

- [Scaling performance — React Three Fiber](https://r3f.docs.pmnd.rs/advanced/scaling-performance) — instancing, `<Detailed>`/LOD, draw-call reduction guidance underpinning §9.3.
- [100 Three.js Tips That Actually Improve Performance (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips) — draw-call budgets, texture/atlas guidance referenced in §9.3.4, §13.4.
- [Boosting React Three Fiber Mobile Performance in 2026 — Krapton Blog](https://www.krapton.com/blog/boosting-react-three-fiber-mobile-performance-in-2026-a-deep-dive-d6105c) — informs §14.3's low-memory-class degradation strategy.
- [Building Efficient Three.js Scenes — Codrops](https://tympanus.net/codrops/2025/02/11/building-efficient-three-js-scenes-optimize-performance-while-maintaining-quality/) — general scene-optimization patterns referenced across §9.
- [cosmosgl/graph — DeepWiki](https://deepwiki.com/cosmosgl/graph) and [GitHub: cosmosgl/graph](https://github.com/cosmosgl/graph) — GPU-accelerated force-directed layout at scale; the flagged alternative in §9.1's library table.
- [Introducing cosmos.gl — OpenJS Foundation](https://openjsf.org/blog/introducing-cosmos-gl) — background on cosmos.gl's positioning and scale claims.
- [The Best Libraries and Methods to Render Large Force-Directed Graphs on the Web — Medium](https://weber-stephen.medium.com/the-best-libraries-and-methods-to-render-large-network-graphs-on-the-web-d122ece2f4dc) — comparative survey informing §9.1's library choice table.
- [GitHub: vasturiano/3d-force-graph](https://github.com/vasturiano/3d-force-graph) and [GitHub: vasturiano/react-force-graph](https://github.com/vasturiano/react-force-graph) — considered and referenced as the "default client-side live layout" alternative rejected in ADR-006.
- [GraphWaGu: GPU Powered Large Scale Graph Layout](https://stevepetruzza.io/pubs/graphwagu-2022.pdf) — WebGPU compute-shader force-directed layout background referenced in §9.1.
- [Using cursor to build paginated API · arangojs#741](https://github.com/arangodb/arangojs/issues/741) — cursor pagination semantics underpinning §10.4.4.
- [HTTP interfaces for AQL queries — Arango Documentation](https://docs.arango.ai/arangodb/stable/develop/http-api/queries/aql-queries/) — cursor batch/ttl/delete contract, directly reflected in §10.4.4's example.
- [Graph traversals in AQL — Arango Documentation](https://docs.arangodb.com/3.12/aql/graphs/traversals/) — traversal syntax/options (`uniqueVertices`, `bfs`) used in §10.4.3.
- [AQL Query Slow on Pagination on large result set · arangodb#1847](https://github.com/arangodb/arangodb/issues/1847) — motivates §10.1's "bound before you traverse" principle.
- [Resolving AQL Performance and Memory Bottlenecks in ArangoDB — Mindful Chase](https://www.mindfulchase.com/explore/troubleshooting-tips/databases/resolving-aql-performance-and-memory-bottlenecks-in-arangodb.html) — informs §16.3's `EXPLAIN`-based testing requirement.
- [Learn best practices for graph queries in ArangoDB — arangodb.com](https://arangodb.com/2020/05/best-practices-for-aql-graph-queries/) — `FILTER`/`PRUNE`/`LIMIT` guidance directly underpinning §10.1 and §10.4's query shapes.
- [Designing AI chat interfaces: Anatomy, patterns, pitfalls — Setproduct Blog](https://www.setproduct.com/blog/ai-chat-interface-ui-design) — general chat-UI anatomy (rail, top bar, composer) referenced in §7 and §6.2.
- [Reverse-engineering Claude's generative UI](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui/) — informs §7.9's tool-call-as-structured-part rendering approach.
- Auto-scroll/"jump to latest" and fence-aware incremental markdown highlighting patterns (as implemented by Claude.ai and Cursor) — synthesized into §7.5 and §7.6's exact rule sets from general research into current (2026) production chat-UI behavior conventions.
- [Build an AI Chatbot in 15 Min with Vercel AI SDK (2026)](https://tech-insider.org/vercel-ai-sdk-tutorial-chatbot-nextjs-2026/) and [AI SDK by Vercel — official docs](https://ai-sdk.dev/docs/introduction) — `useChat`/`streamText`/`toUIMessageStreamResponse` shapes underpinning §7.3.
- [Getting Started: Next.js App Router — AI SDK](https://ai-sdk.dev/docs/getting-started/nextjs-app-router) — route-handler wiring pattern referenced in §7.3, §17.5.
- **This repository's own `node_modules/next/dist/docs`** (authoritative for the installed `next@16.2.9`, not general web search): `01-app/01-getting-started/16-proxy.md` (Proxy naming, §3.1), `01-app/03-api-reference/03-file-conventions/unauthorized.md` (§3.2), `01-app/03-api-reference/03-file-conventions/route-groups.md` (§3.3), `01-app/02-guides/authentication.md` (§4.3's `proxy.ts` example directly adapted from this guide's own optimistic-check sample).
- This repository's existing source (`src/shared/lib/api-client.ts`, `src/shared/packages/ui/components/totp-setup/`, `src/app/layout.tsx`, `package.json`) — read directly to ground every architectural decision in this plan in the codebase's actual current state rather than a hypothetical greenfield.

---

## 44. Alternatives Considered (Extended Comparison Matrices)

Supplementing the Decision Log (§20) with side-by-side comparisons for the choices that had more than two realistic options, so the reasoning is auditable at a glance rather than only in prose.

### 44.1 State management library for cross-component UI state (§12.1)

| Option | Verdict | Reasoning |
|---|---|---|
| **Zustand** (chosen) | ✅ | Minimal boilerplate, first-class selective-subscription support (avoids the "whole store re-renders everything" trap), no Provider-wrapping ceremony, small bundle footprint — fits a handful of narrow, purpose-built stores (§12.3) rather than one monolithic store |
| Redux Toolkit | Rejected | Substantially more ceremony (slices, actions, reducers) for what this plan needs (a handful of small, independent stores); RTK's strengths (time-travel debugging, middleware ecosystem) aren't load-bearing requirements here |
| React Context + `useReducer` | Rejected | Context re-renders every consumer on any value change unless manually split into many tiny contexts — effectively reinventing Zustand's selective-subscription model by hand, worse |
| Jotai | Considered, close second | Atomic model is a reasonable fit too; Zustand chosen mainly for team familiarity/simplicity of the imperative-store-outside-React pattern (needed anyway for the engine bridge, §12.4) rather than a strong technical differentiator either way — revisit if atomic composition needs grow significantly |

### 44.2 Chat transport/streaming protocol (§7.3)

| Option | Verdict | Reasoning |
|---|---|---|
| **AI SDK v6 `useChat` + `UIMessageStreamResponse`** (chosen) | ✅ | Purpose-built for exactly this (streaming chat UI state management), actively maintained, integrates with Next.js route handlers with minimal glue code, and isolates the frontend from the backend's actual LLM/provider wiring via the adapter seam (§7.3) |
| Hand-rolled SSE + manual state reducer | Rejected | Reinvents stream-parsing, reconnection, and message-state-merging logic the AI SDK already solves; only justified if the AI SDK's message shape were a poor fit for this product's needs, which it isn't |
| WebSocket-based chat (matching the Universe's realtime transport, §11.4, for consistency) | Rejected for chat specifically | Chat is fundamentally request/response-shaped (one user message → one streamed reply), which SSE models more naturally and with simpler infrastructure (no persistent bidirectional connection needed just to receive a stream) than WebSocket; WS remains the right choice for the Universe's independent, server-initiated push feed (§11.4), a genuinely different traffic shape |

### 44.3 Binary tile framing vs. alternatives (expanding ADR-005)

| Option | Payload size (5,000 nodes, illustrative) | Parse cost | Debuggability | Verdict |
|---|---|---|---|---|
| **Custom binary framing** (chosen) | ~60-90KB | Lowest (direct typed-array view, near-zero parse) | Requires a small dev decoder tool | ✅ Chosen for v1 |
| Plain JSON array of objects | ~400-600KB+ | Higher (per-object JSON.parse + property access overhead) | Best (readable in devtools network tab) | Rejected for production tiles; acceptable for the (much smaller, low-frequency) realtime change-feed events (§11.4), which deliberately do use JSON |
| Protocol Buffers | ~65-95KB (comparable to custom binary) | Low, but requires a decode step through generated code | Moderate (needs `.proto`-aware tooling) | Deferred — flagged in ADR-005 as a reasonable future migration if the hand-rolled framing's versioning story outgrows its current simplicity |
| MessagePack | ~150-220KB | Moderate | Moderate | Rejected — smaller win than custom binary for this specific numeric-array-heavy payload shape, general-purpose serialization isn't the bottleneck this format needs to solve |

### 44.4 Clustering algorithm for the LOD pyramid (expanding ADR-003)

| Option | Spatial locality guarantee | Determinism | Verdict |
|---|---|---|---|
| **Grid/quadtree agglomeration** (chosen) | Strong, by construction | Fully deterministic given fixed cell sizes | ✅ Chosen — directly compatible with the `gridCell` index the query layer depends on |
| k-means | Weak (can produce spatially scattered clusters depending on initialization) | Not deterministic across runs without careful seeding | Rejected — would break the "gridCell lookup ≈ what's on screen" assumption §10.3 depends on |
| HDBSCAN / density-based clustering | Weak-to-moderate (optimizes for density cohesion, not grid alignment) | Deterministic given fixed parameters, but still not grid-aligned | Rejected for the same reason as k-means — better suited to a hypothetical future "semantic clustering" *overlay* feature, not the core spatial LOD pyramid |
| Hierarchical agglomerative clustering (generic, non-grid) | Weak (no inherent grid alignment) | Deterministic but expensive at scale (naive versions are O(n²) or worse) | Rejected — both the locality and the performance profile are worse fits than grid-based agglomeration for this specific job |

---

## 45. Backend API Reference (OpenAPI-Style)

A proposed, complete endpoint reference in OpenAPI-adjacent shorthand — not a literal `.yaml` file to drop in, but complete enough to generate one from. Per this plan's stated non-goal, this is a **proposal to align on with the backend team** (§24, Open Question #6 territory), not an assumed-final contract.

```yaml
openapi: 3.1.0
info:
  title: Vorinthex Console Backend API (proposed)
  version: 0.1.0-plan
servers:
  - url: /api/v1        # matches the existing apiVersionPath in api-client.ts

paths:
  /auth/login:
    post:
      summary: Validate credentials, issue a partial (mfa_required) session
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [email, password]
              properties:
                email: { type: string, format: email }
                password: { type: string }
      responses:
        "200":
          description: Partial session issued; sets vx_session cookie (state=mfa_required)
        "401":
          description: Invalid credentials — ApiErrorResponse, code AUTH_INVALID_CREDENTIALS

  /auth/verify:
    post:
      summary: Validate a TOTP code against the mfa_required session, upgrade to authenticated
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [code]
              properties:
                code: { type: string, pattern: "^[0-9]{6}$" }
      responses:
        "200":
          description: Session upgraded to authenticated; sets vx_session cookie (state=authenticated)
        "401":
          description: Invalid code — ApiErrorResponse, includes details.attemptsRemaining
        "423":
          description: Locked out — ApiErrorResponse, includes retryAfterMs (§4.5, §40.2)

  /auth/session:
    get:
      summary: Authoritative session check (backs verifySession, §4.4)
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Session" }
        "401":
          description: Session invalid/expired — triggers unauthorized() at the DAL call site

  /auth/logout:
    post:
      summary: Invalidate the current session, clear vx_session cookie
      responses: { "200": { description: Logged out } }

  /chat/completions:
    post:
      summary: Send a message, stream the assistant's reply
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ChatRequestBody" }
      responses:
        "200":
          description: Streaming response (backend-native shape; adapted to AI SDK v6 UIMessage stream by the Next.js proxy, §7.3)
          headers:
            X-Thread-Id: { schema: { type: string }, description: "Present once the thread id is known, §7.8" }

  /chat/threads/{threadId}/messages:
    get:
      summary: Paginated message history (§7.2, §34.5)
      parameters:
        - { name: threadId, in: path, required: true, schema: { type: string } }
        - { name: cursor, in: query, schema: { type: string } }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  messages: { type: array, items: { $ref: "#/components/schemas/ChatMessage" } }
                  nextCursor: { type: string, nullable: true }

  /universe/tiles:
    get:
      summary: Chunked tile fetch (§11.1)
      parameters:
        - { name: tier, in: query, required: true, schema: { type: integer } }
        - { name: cells, in: query, required: true, schema: { type: string }, description: "comma-separated gridCell ids" }
        - { name: pyramidVersion, in: query, schema: { type: string } }
        - { name: cursor, in: query, schema: { type: string } }
      responses:
        "200":
          description: Binary tile payload, §11.1's framing
          content:
            application/octet-stream: {}
        "429":
          description: Rate limited — ApiErrorResponse (§15.2, §41)

  /universe/nodes/{id}:
    get:
      summary: Single node detail (§10.6)
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: "#/components/schemas/NodeDetail" }
        "404":
          description: Node not found (or not visible to this tenant — see §15.2's note on not distinguishing 403 vs 404 for existence-leaking concerns, an open question left to the backend team's security posture preference)

  /universe/nodes/{id}/neighbors:
    get:
      summary: Bounded 1-hop neighborhood expansion (§10.4.3)
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  neighbors: { type: array, items: { $ref: "#/components/schemas/SearchResult" } }
                  truncated: { type: boolean, description: "true if the 200-neighbor cap (§10.4.3) was hit" }

  /universe/search:
    get:
      summary: Fuzzy node search (§10.7)
      parameters:
        - { name: q, in: query, required: true, schema: { type: string, minLength: 2 } }
      responses:
        "200":
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/SearchResult" } }

  /universe/stream:
    get:
      summary: WebSocket upgrade for the realtime change feed (§11.4)
      responses:
        "101": { description: Switching Protocols }

components:
  schemas:
    Session:
      type: object
      properties:
        userId: { type: string }
        displayName: { type: string }
        avatarUrl: { type: string, nullable: true }
        mfaLevel: { type: string, enum: [totp] }
    ChatRequestBody:
      type: object
      properties:
        threadId: { type: string, nullable: true }
        message:
          type: object
          properties:
            text: { type: string }
            attachments: { type: array, items: { type: object } }
    ChatMessage:
      type: object
      properties:
        id: { type: string }
        threadId: { type: string }
        role: { type: string, enum: [user, assistant, system, tool] }
        parts: { type: array, items: { type: object } }
        createdAt: { type: string, format: date-time }
        status: { type: string, enum: [streaming, complete, error], nullable: true }
    NodeDetail:
      type: object
      properties:
        id: { type: string }
        label: { type: string }
        type: { type: string }
        properties: { type: object }
        neighborCount: { type: integer }
    SearchResult:
      type: object
      properties:
        id: { type: string }
        label: { type: string }
        type: { type: string }
        position:
          type: array
          items: { type: number }
          minItems: 3
          maxItems: 3
```

---

## 46. Database Migration Reference (Collection & Index Setup)

A concrete, ordered migration script sketch for provisioning the collections and indexes described in §10.2/§10.3 — backend-owned, included here so the frontend team can see exactly which indexes its query patterns (§10.4, §35) depend on existing, and so a schema regression (Risk #6, §19) has an obvious first place to check.

```js
// migrations/001-initial-universe-schema.js  (arangojs-flavored pseudocode)

async function up(db) {
  const nodes = await db.createCollection("nodes");
  await nodes.ensureIndex({ type: "persistent", fields: ["gridCell"], name: "idx_nodes_gridCell" });
  await nodes.ensureIndex({ type: "persistent", fields: ["type"], name: "idx_nodes_type" });
  await nodes.ensureIndex({ type: "persistent", fields: ["tenantId", "gridCell"], name: "idx_nodes_tenant_gridCell" }); // §15.2 — tenant-scoped variant of the spatial index, likely the ACTUAL primary index once multi-tenancy is confirmed (§24 Q1)

  const edges = await db.createEdgeCollection("edges");
  await edges.ensureIndex({ type: "persistent", fields: ["type"], name: "idx_edges_type" });
  // ArangoDB auto-creates the edge index (_from/_to) on edge collections — no
  // explicit ensureIndex call needed for basic _from/_to lookups.

  for (let tier = 0; tier <= MAX_TIER; tier++) {
    const tierCollection = await db.createCollection(`node_clusters_L${tier}`);
    await tierCollection.ensureIndex({ type: "persistent", fields: ["gridCell"], name: `idx_clusters_L${tier}_gridCell` });
    await tierCollection.ensureIndex({ type: "persistent", fields: ["tier"], name: `idx_clusters_L${tier}_tier` });
  }

  await db.createView("nodesSearchView", {
    type: "arangosearch",
    links: {
      nodes: {
        fields: {
          label: { analyzers: ["text_en"] },
          type: { analyzers: ["identity"] },
        },
      },
    },
  }); // §10.7

  // Auth/chat collections (§4, §7.2) — listed for completeness, not this
  // plan's primary focus.
  await db.createCollection("users");
  await db.createCollection("sessions");
  await db.createCollection("mfa_factors");
  await db.createCollection("chat_threads");
  await db.createCollection("chat_messages");
}

async function down(db) {
  // Reverse order — drop dependent collections/views before their targets.
  await db.dropView("nodesSearchView");
  for (let tier = MAX_TIER; tier >= 0; tier--) {
    await db.collection(`node_clusters_L${tier}`).drop();
  }
  await db.collection("edges").drop();
  await db.collection("nodes").drop();
  await db.collection("chat_messages").drop();
  await db.collection("chat_threads").drop();
  await db.collection("mfa_factors").drop();
  await db.collection("sessions").drop();
  await db.collection("users").drop();
}

module.exports = { up, down };
```

`MAX_TIER` should be set based on Phase 0's spike results (§18) and the expected launch-scale graph size (§24, Open Question #4) — this plan does not hardcode a specific tier count, since it's a tuning parameter, not an architectural constant.

---

## 47. Local Mock Backend (Dev Tooling Reference)

Fleshing out §26.2's recommendation with a concrete sketch — a small, dependency-light Node HTTP server serving synthetic responses matching every contract in §11, §7.3, and §45, so frontend development is never blocked on real backend/ArangoDB availability.

```ts
// scripts/dev/mock-backend/server.ts
import { createServer } from "node:http";
import { generateSeedGraph } from "../generate-seed-graph";
import { encodeTileResponse } from "./encode-tile";

const graph = generateSeedGraph({ nodeCount: 20_000, clusterCount: 60, edgeDensityPerNode: 3, seed: "dev-fixture-v1" });
const gridIndex = buildGridIndex(graph.nodes); // same cellSize(tier) formula as §10.3 — imported
                                                // from the shared isomorphic module per Risk #3 (§19)

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/v1/universe/tiles") {
    const tier = Number(url.searchParams.get("tier"));
    const cellIds = (url.searchParams.get("cells") ?? "").split(",").filter(Boolean);
    const matched = gridIndex.query(tier, cellIds);
    const buffer = encodeTileResponse({
      header: { tier, pyramidVersion: "dev-fixture-v1", cellIds, nextChunkToken: null },
      nodes: matched,
    });
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(Buffer.from(buffer));
    return;
  }

  if (url.pathname.startsWith("/api/v1/universe/nodes/")) {
    const id = url.pathname.split("/").pop();
    const node = graph.nodes.find((n) => n._key === id);
    if (!node) { res.writeHead(404); res.end(); return; }
    const neighborCount = graph.edges.filter((e) => e._from === `nodes/${id}` || e._to === `nodes/${id}`).length;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: node._key, label: node.label, type: node.type, properties: {}, neighborCount }));
    return;
  }

  if (url.pathname === "/api/v1/universe/search") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const results = graph.nodes
      .filter((n) => n.label.toLowerCase().includes(q))
      .slice(0, 20)
      .map((n) => ({ id: n._key, label: n.label, type: n.type, position: [n.position.x, n.position.y, n.position.z] }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(results));
    return;
  }

  if (url.pathname === "/api/v1/chat/completions" && req.method === "POST") {
    // Minimal fake streaming response — enough to exercise the incremental
    // markdown renderer (§7.5) and scroll-anchor behavior (§7.6) in dev
    // without a real LLM call.
    res.writeHead(200, { "Content-Type": "text/event-stream", "X-Thread-Id": "mock-thread-1" });
    const tokens = "This is a **mocked** streaming response for local development.\n\n```ts\nconst x = 1;\n```".split(" ");
    for (const token of tokens) {
      res.write(`data: ${JSON.stringify({ type: "text-delta", delta: token + " " })}\n\n`);
      await sleep(40);
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(4000, () => console.log("Mock backend listening on :4000 — matches NEXT_PUBLIC_API_BASE_URL default (§26.1)"));

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
```

This is deliberately rough (no real AI SDK v6 framing, no real WebSocket endpoint, no real MFA state machine) — its only job is unblocking frontend iteration on the *shapes* this plan specifies, not simulating backend correctness/security behavior, which should always be validated against the real backend before any feature is considered done.

---

## 48. Frequently Anticipated Questions

Answers to the questions a stakeholder, new engineer, or future self is most likely to ask when picking this document up cold.

**Q: Why does zooming out never actually reach "the whole universe at once" if there's a hard node count?**
A: It doesn't need to, by design — R0's decorative starfield (§8.2) fills perceptual space beyond where real cluster density remains visually informative. The "infinite" claim is about the *zoom gesture and rendering* never hitting a wall, not about there being literally infinite data. This is disclosed and enforced via the real-vs-decorative visual distinction (§8.2, Risk #4).

**Q: What happens if two users have very different-sized graphs — does the same zoom-tier thresholds work for both?**
A: The R0-R3 distance thresholds (§8.1) are tuned against a "typical" graph density, and the LOD pyramid's tier count/`cellSize` growth factor (§10.5.1, §46's `MAX_TIER`) is a per-deployment tuning parameter, not hardcoded per-user. A very small graph might only ever populate R2/R3 meaningfully (R0/R1 would just show a handful of sparse clusters plus decorative starfield) — this degrades gracefully rather than breaking, but is explicitly a case worth validating during Phase 4 (§18) with both a small and a large seed fixture (§32).

**Q: Could the Universe just be a 2D map instead of 3D — wouldn't that dodge the whole floating-origin/precision problem?**
A: Yes, technically — a 2D approach sidesteps §9.2's hardest problem (the precision issue is far more forgiving in 2D, and even map libraries like Mapbox/Leaflet solve "infinite zoom" at web scale routinely in 2D). This plan doesn't revisit that trade-off because the brief explicitly asked for a 3D universe ("this universe should be in 3D") — flagged here only so it's clear this was a given constraint, not an oversight, and so a future simplification discussion has the trade-off spelled out rather than rediscovering it.

**Q: Why not just use an existing graph visualization product/library wholesale (e.g., a Neo4j Bloom-style tool) instead of building this?**
A: Existing graph-visualization tools are built for analyst/exploration workflows (2D-first, node-link diagrams, moderate scale) — none combine ArangoDB specifically, a stylized infinite-zoom 3D "universe" aesthetic, and tight integration with a Claude-style chat surface as one product experience. This plan's novelty is precisely that combination, which is also why it required this much original engineering design rather than a config-and-go integration.

**Q: Is the chat's `search_universe` tool the *only* way chat and universe interact, or could the assistant eventually see/reason about the whole graph?**
A: For v1, the assistant only sees whatever `search_universe` explicitly returns (§7.9) — bounded, on-demand, citation-shaped. A more ambitious "the assistant has standing awareness of the graph's structure" feature is a plausible fast-follow but is out of scope here; it would need real thought about context-window budget (the whole graph can't be stuffed into a prompt) and is exactly the kind of thing that should be scoped as its own follow-up plan once v1's simpler tool-call bridge is validated with real usage.

**Q: What's the actual very-first thing an engineer should do with this document?**
A: Phase 0 (§18) — the precision/performance spike. Everything numeric in this plan (thresholds, budgets, batch sizes) is a placeholder pending that spike's real measurements; starting Phase 1 (auth/shell) in parallel is fine since it's independent, but Phase 3 (the Universe engine itself) should not start until Phase 0's numbers are in.

**Q: Does the floating island really need to be one component that morphs, or could Chat and Universe just each have their own separate composer?**
A: It needs to be one persistent component specifically to satisfy the "never lose the user's draft, never destroy the WebGL context" requirements (§6.5, ADR-004) — two separate composers that each mount/unmount on mode toggle would reintroduce exactly the problems off-tree mounting (§6.3) was designed to avoid, just one layer up the tree.

**Q: Why TOTP specifically, and not passkeys/WebAuthn, which are generally considered more modern/secure?**
A: This plan doesn't choose TOTP as a fresh decision — the repository already has a bespoke `TotpSetup` component built (§4.1), strongly implying that choice was made prior to this planning exercise. This plan integrates the existing component rather than re-litigating the MFA-factor choice; if passkeys are later desired as an *additional* or *alternative* factor, that's an auth-system change orthogonal to everything else in this document (the `/login/verify` route and partial-session model in §4.2 would need a parallel WebAuthn ceremony, but the surrounding console/chat/universe architecture is unaffected).

**Q: How does this plan's approach differ from just rendering the graph with an existing library like `3d-force-graph` and calling it done?**
A: `3d-force-graph` (and similar) are excellent for moderate-scale (thousands, not millions, of nodes), single-shot-loaded, client-side-laid-out graphs — exactly the shape ADR-006 explicitly rejects for this product (shared, stable, server-authoritative layout; chunked/streamed loading; a custom multi-tier LOD system that no off-the-shelf graph library ships, because most weren't built for "zoom from a whole-graph overview down to one document" as a first-class interaction). Parts of this plan's approach (instancing, `d3-force-3d` as an optional relaxation engine) borrow techniques those libraries also use internally, but the overall architecture is necessarily custom.

**Q: What's the single biggest risk to this plan actually working as described?**
A: Risk #1 in §19 — floating-point precision behaving worse in production than Phase 0's spike predicts, because a synthetic spike can't perfectly capture every real device/browser/driver combination's actual float32 behavior at the camera-distance ratios this product needs. This is exactly why §16.4's precision unit tests are specified as a *permanent* CI fixture, not a one-time pre-launch check — regressions here need to be caught continuously, not just once.

**Q: Why does the plan spend so much effort on a decorative starfield and empty-state copy — isn't that a minor detail compared to the engineering?**
A: Because the illusion of "infinity" is a UX claim as much as an engineering one — the engineering (§9.2's floating origin, §10.5's pyramid) makes it *possible* to zoom smoothly forever, but whether it *feels* infinite rather than obviously bottoming out depends entirely on what fills the space beyond real data and how the genuine end-of-data moment is framed (§8.2). Getting the engineering right without getting this presentation layer right would still ship a product that feels like it hit a wall — the two are equally load-bearing for the actual product promise, which is why both get dedicated treatment (§8.2, §22.2, §30.2) rather than the visual/copy details being treated as an afterthought once the "real" engineering is done.

**Q: This document proposes a lot of specific library versions, file paths, and even exact hex colors — is all of that meant to be taken literally?**
A: The *shapes* (contracts, data models, the sequence of decisions in the ADRs, the reasoning behind each) are meant to be taken seriously and implemented against. The *specific illustrative values* (exact hex codes in §23, exact version pins in §50.4, exact copy strings in §51) are starting points meant to save a blank-page problem during implementation, not final, sign-off-required specifications — a designer should feel free to adjust `--vx-console-accent`'s exact hue, and a copywriter should feel free to punch up §51's placeholder strings, without that constituting a deviation from "the plan."

---

## 49. Definition of Done — Per Phase

Concrete, checkable exit criteria for each phase in §18's roadmap, expanding that section's brief "exit criteria" lines into full checklists.

### Phase 0 — Precision & performance spike

- [ ] Standalone prototype exists (outside the main repo's production code) instancing 5,000-50,000 synthetic nodes across a realistic multi-tier distance range.
- [ ] Floating-origin rebase implemented and exercised with a scripted camera path crossing the rebase threshold repeatedly.
- [ ] Measured, documented answer for: at what camera-to-origin distance does visible float32 jitter first appear, absent any rebasing?
- [ ] `REBASE_THRESHOLD` (§9.2.2) chosen with a documented safety margin below that measured jitter-onset distance.
- [ ] Frame-time measurements recorded for instance-transform rewrite cost at realistic chunk-arrival rates, at the target device tier (§13.1).
- [ ] Explicit go/no-go recorded on whether `<Detailed>`/custom-instancing is sufficient, or whether `cosmos.gl` (§9.1) should be pulled forward into Phase 3's scope.
- [ ] Findings written back into this document (§9.2.2, §13.1, §18) as corrections, not left in a separate, easily-lost scratch doc.

### Phase 1 — Auth, MFA, console shell

- [ ] `proxy.ts` (not `middleware.ts`) implements the optimistic redirect logic from §4.3, verified against this repo's actual installed Next version's convention.
- [ ] Session cookie codec + `verifySession` DAL implemented, `cache()`-memoized per request.
- [ ] `/signup`, `/signup/mfa-setup` (reusing the existing `TotpSetup` component unmodified), `/login`, `/login/verify` all functional against a real or mocked backend.
- [ ] `/console/home` redirect-resolution logic (§5.3) implemented, including the `vx_last_mode` cookie read.
- [ ] `ConsoleShell` renders the header, a working (even if stubbed-content) mode toggle, and the floating island host.
- [ ] `unauthorized.tsx` exists and is exercised by at least one integration test simulating a stale-session 401 from a leaf-level call.
- [ ] Dark console theme tokens (§6.1, §23) applied; visually distinct from the marketing site's theme.
- [ ] MFA lockout/rate-limit UI states (§22.3) implemented and manually verified against a simulated 423 response.

### Phase 2 — Chat interface

- [ ] `/api/chat` proxy route streams a real (or mocked) backend response through `toUIMessageStreamResponse` correctly.
- [ ] Optimistic thread creation + `X-Thread-Id` reconciliation (§7.8) verified with a test that asserts the URL and query cache key both update correctly mid-stream.
- [ ] Message list virtualization in place and measured to hold steady frame/interaction responsiveness at 500+ message threads.
- [ ] Scroll-anchor behavior (§7.6, §33.2) passes all five numbered rules as explicit test cases, not just manual spot-checks.
- [ ] Incremental markdown renderer correctly defers syntax highlighting until fence-close, verified with a test that splits a fence across an arbitrary chunk boundary.
- [ ] Composer correctly ignores Enter during IME composition (tested with at least one CJK input-method simulation, not just an English-only manual check).
- [ ] Draft persistence survives a mode toggle and a simulated stale-session re-auth modal.
- [ ] Tool-call rendering scaffold exists for `search_universe`, even if the tool itself returns mocked/empty results at this phase.
- [ ] Manual side-by-side comparison against Claude.ai's own chat UI completed, with any material feel differences logged as follow-up items.

### Phase 3 — Universe engine core

- [ ] Floating-origin engine matches Phase 0's validated `REBASE_THRESHOLD`, with the precision unit tests from §16.2/§16.4 passing in CI.
- [ ] Instanced node/edge rendering functional against real (or seeded, §32) `nodes`/`edges` data via `/api/universe/tiles`.
- [ ] Camera controller (§9.7, §31) implements multiplicative zoom-to-cursor, orbit, and pan, with roll locked at zero.
- [ ] Coarse-pass picking (§9.5) functional; GPU-picking fallback explicitly deferred (not built) unless Phase 0/3 profiling already shows it's needed.
- [ ] All three workers (§9.6, §37) wired and confirmed running off the main thread (verified via browser devtools' performance profiler, not assumed from code review alone).
- [ ] Sustained frame rate at the §13.1 budget confirmed at the 5,000-node/8,000-edge target scale on a mid-tier device, not just a development machine.
- [ ] Tenant-scoping filter (§15.2, §35.1) present in every backend query this phase touches, confirmed via code review against the mandatory-first-filter rule.

### Phase 4 — LOD pyramid & full regime system

- [ ] Backend precomputation job (§10.5, §38) produces a versioned, consistent pyramid across all tiers from a seeded fixture (§32).
- [ ] Regime controller correctly classifies R0-R3 with hysteresis-gapped transitions; a thrash-detection test (§25.1's `thrash_count` metric, simulated) shows near-zero thrashing on a realistic camera-movement script.
- [ ] Cross-fade transitions (§9.2.3) visually verified against the golden-frame regression suite (§16.2).
- [ ] Decorative starfield (§8.2, §30.2) confirmed visually and interactively distinguishable from real cluster/node data (non-clickable, dimmer, smaller) — an explicit QA checklist item, not just a code-review assumption.
- [ ] Fly-to camera scripting (§8.4, §31) verified for at least: a search-triggered jump, a chat-citation jump, and a jump crossing all four regimes in one transition.
- [ ] Genuine-leaf empty state (§8.2, §22.2) reachable and correctly styled as a positive destination, not an error.

### Phase 5 — Cross-mode bridges, realtime, polish

- [ ] `search_universe` tool fully wired end-to-end: chat query → backend search → cited result → "View in Universe" → correct fly-to.
- [ ] "Ask about this in Chat" (§7.9, §33.4) verified to correctly toggle mode, seed a draft, and never auto-send on the user's behalf.
- [ ] Realtime change feed connected; burst-coalescing (§13.3, §34.6) verified with a simulated event burst, confirming a single invalidation/re-render rather than one per event.
- [ ] Activity pulse (§6.6, §8.6) verified in both directions (chat activity while in universe, universe activity while in chat).
- [ ] Minimap (§9.8) renders and updates correctly across floating-origin rebases (a common place for a "forgot to update this on rebase" bug to hide, per §9.2.2's explicit warning).
- [ ] Adaptive quality tiers (§13.2) verified to engage under artificially throttled CPU/GPU conditions (browser devtools throttling), and to recover after headroom returns.
- [ ] Degraded-mode fallbacks (§14.3) verified on at least one no-WebGL2 environment and one `prefers-reduced-motion` environment.
- [ ] Full accessibility pass against §14.4's chat checklist completed with an actual screen reader, not just automated axe-core-style linting.
- [ ] Security review sign-off against §15's full checklist, with particular attention to §15.2's tenant-scoping and WebSocket re-validation items.

### Phase 6 — Hardening

- [ ] Load-shaped test suite (§16.3) run against the large (~500,000+ node) seed fixture (§32), with p95 tile-fetch latency within the §13.3 budget.
- [ ] Bundle-size CI gates (§13.4, §16.5) active and confirmed to actually fail a deliberately-introduced regression (a canary PR that imports `three` into the chat bundle, reverted after confirming the gate catches it).
- [ ] Visual regression suite (§16.2) running as a standing, not one-off, CI job.
- [ ] Backend tenant/user scoping audit (§15.2) completed as an explicit, signed-off review, separate from routine code review.
- [ ] Observability (§25) metrics confirmed actually flowing to whichever analytics/RUM vendor is chosen, with at least one dashboard reviewed by both frontend and backend teams together.
- [ ] All items in §24's Open Questions resolved (or explicitly deferred with an owner and a date) before this phase is considered closed.

---

## 50. Required Build Configuration Changes

This repository's `next.config.ts` is currently empty (`{ /* config options here */ }`), and `vercel.json` only sets `git.deploymentEnabled: false`. Both need targeted additions for this plan — called out explicitly here since it's easy for build-config needs to be discovered late (mid-Phase-3) instead of planned for up front.

### 50.1 `next.config.ts` additions

```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Web Worker modules (§9.6, §37) are loaded via `new Worker(new URL(...))` —
  // Turbopack (Next 16's default bundler, §3's context) supports this natively
  // via standard ESM `new URL(import.meta.url)` worker syntax; no custom
  // webpack `worker-loader` config is needed the way it would have been on
  // older Next/webpack-only setups. Flagged here only so nobody adds
  // unnecessary legacy worker-loader config out of habit.

  // Binary tile responses (§11.1) and the WebSocket upgrade proxy (§11.4)
  // both require the Node.js runtime, not Edge — ensure no route segment
  // config under app/api/universe/** ever sets `export const runtime = "edge"`.

  images: {
    // If node/cluster icon atlas assets (§23.3) are ever served through
    // next/image rather than bundled as static imports, remote patterns would
    // need to be added here — left empty for now since the icon atlas is a
    // build-time bundled asset, not a remote image.
  },

  experimental: {
    // Reserved for any Cache Components (§3.4) tuning knobs the console
    // shell's static-chrome caching ends up needing — left unconfigured
    // until Phase 1 surfaces a concrete need, to avoid speculative config.
  },
};

export default nextConfig;
```

### 50.2 `tsconfig.json` path aliases

To keep the many `src/features/*`, `src/server/*` imports referenced throughout this plan clean:

```jsonc
// tsconfig.json (additive — compare against this repo's existing config before merging)
{
  "compilerOptions": {
    "paths": {
      "@/features/*": ["./src/features/*"],
      "@/server/*": ["./src/server/*"],
      "@/shared/*": ["./src/shared/*"],
      "@/lib/*": ["./src/lib/*"]
    }
  }
}
```

### 50.3 `vercel.json` / deployment considerations

- `git.deploymentEnabled: false` (existing) implies deployments are currently triggered some other way (manual `vercel deploy`, or a separate CI pipeline) — this plan doesn't change that, but flags that once `/console` ships, the realtime WebSocket proxy (§11.4) and the chat SSE proxy (§7.3) both need whatever deployment path is used to support long-lived/streaming Node.js Functions (Fluid Compute, §2.4) — worth an explicit deployment smoke-test for streaming specifically, not just static-page correctness, before the first real `/console` deploy.
- No changes needed to `$schema`/the existing minimal `vercel.json` shape beyond what's already there, unless a future need (e.g., explicit function `maxDuration` overrides for the chat route, if generation lengths ever approach the current 300s platform default) arises.

### 50.4 `package.json` additions

New dependencies this plan introduces, layered onto the existing dependency list read from this repo's `package.json`:

```jsonc
{
  "dependencies": {
    // existing deps unchanged (next, react, react-dom, @tanstack/react-query,
    // axios, zod, react-hook-form, @radix-ui/*, etc.)
    "three": "^0.180.0",
    "@react-three/fiber": "^9.0.0",
    "@react-three/drei": "^10.0.0",
    "@react-three/postprocessing": "^3.0.0",
    "@tanstack/react-virtual": "^3.0.0",
    "zustand": "^5.0.0",
    "ai": "^6.0.0",
    "@ai-sdk/react": "^2.0.0",
    "framer-motion": "^12.0.0",
    "d3-force-3d": "^3.0.0"
  },
  "devDependencies": {
    // existing devDeps unchanged (@tailwindcss/postcss, eslint, typescript, etc.)
    "@types/d3-force-3d": "^3.0.0"
  }
}
```

Version numbers above are illustrative placeholders (matching the "current" major-version generation as of this plan's authoring) — pin to whatever is actually latest-stable at implementation time, and run this repo's existing `bun.lock`-based install flow (this repo uses Bun per the existing `bun.lock` file) rather than switching package managers mid-project.

---

## 51. UI Copy Reference

Every user-facing string introduced by this plan, gathered in one place so copy review/editing doesn't require hunting through component files, and so tone stays consistent (calm, editorial-adjacent to the marketing site's warmth per §6.1, but without the marketing site's promotional register — this is product UI copy, not landing-page copy).

### 51.1 Auth/MFA

| Context | Copy |
|---|---|
| `/login/verify` heading | "Verify it's you" |
| `/login/verify` subheading | "Enter the 6-digit code from your authenticator app." |
| Wrong code | "That code didn't match. Try again." |
| Attempts remaining | "{n} attempts remaining before your account is temporarily locked." |
| Lockout | "Too many attempts. Try again in {mm:ss}." |
| Session expired modal heading | "Your session needs a quick re-verify" |
| Session expired modal body | "For your security, please confirm it's still you. Nothing you were doing will be lost." |

### 51.2 Chat empty/loading/error states

| Context | Copy |
|---|---|
| Empty thread welcome | "Ask anything — about your data, your graph, or just to think something through." |
| Message send failure | "Couldn't send that. Retry?" |
| Stream interrupted | "Connection dropped partway through. Continue generating?" |
| Rate limited | "Sending messages a little fast — one moment." |
| Zero search-tool results | "No matches in the universe for that." |
| Jump-to-latest pill | "Jump to latest" |

### 51.3 Universe empty/loading/error states

| Context | Copy |
|---|---|
| Cold-load placeholder | (visual only, no literal text — a slowly-resolving starfield, §22.2) |
| Tile fetch failure | "This region is taking a moment to load." with a "Retry" action |
| Genuine leaf reached | "You've reached the edge of the known universe here." with a "Head back" action |
| WebGL context lost | "Reconnecting the universe…" |
| Search zero results | "No nodes match “{query}”." |
| Realtime reconnecting indicator | "Reconnecting live updates…" (small, near the minimap, non-blocking) |
| Node detail fetch failure | "Couldn't load details for this node." with "Retry" |
| No-WebGL2 fallback heading | "Explore as a list" |
| No-WebGL2 fallback body | "Your browser can't run the 3D universe view, so here's the same data as a searchable list." |

### 51.4 Mode toggle / header

| Context | Copy (aria-label, since the button is icon-only) |
|---|---|
| Toggle, currently in Chat | "Open the Universe" |
| Toggle, currently in Universe | "Open Chat" |
| Activity pulse (visually hidden, screen-reader-only addition) | "New activity in {other mode}" |

### 51.5 Node detail card / bridges

| Context | Copy |
|---|---|
| "Ask about this" action | "Ask about this in Chat" |
| Seeded draft template | "Tell me about {label} ({type})." |
| "View in Universe" chat citation link | "View in Universe" |

---

## 52. Keyboard Shortcuts Reference

| Shortcut | Context | Action |
|---|---|---|
| `Enter` | Chat composer | Send message (unless IME composing, §7.7) |
| `Shift + Enter` | Chat composer | Insert newline |
| `Esc` | Universe, node selected | Deselect / close detail card (§8.3) — does not change zoom |
| `Esc` | Any open popover/dropdown | Dismiss (inherited from the existing Radix-based shared UI package's conventions) |
| Scroll wheel / trackpad | Universe canvas | Zoom to cursor (§8.3) |
| `Cmd/Ctrl + Scroll` | Universe canvas | Fast-zoom (larger step per tick) |
| Click-drag (empty space) | Universe canvas | Orbit |
| Two-finger drag | Universe canvas (touch/trackpad) | Pan |
| Arrow keys (after focusing search result or minimap) | Universe canvas | Discrete keyboard-camera nudge (§14.3's accessibility fallback) |
| `Tab` / `Shift+Tab` | Global | Standard focus order — composer → send/stop → message actions → header controls, all in natural DOM order, no custom tab-trapping outside genuine modal contexts (session-expired modal, node detail card as a `dialog` role) |
| `Cmd/Ctrl + K` (proposed, not yet assigned elsewhere in this repo) | Global, within `/console` | Focus the floating island's search/composer input directly, regardless of current mode — a common power-user pattern worth reserving even though not explicitly requested in the brief; flagged as a nice-to-have, not a committed requirement |

---

## 53. Browser & Device Support Matrix

| Environment | Chat mode | Universe mode |
|---|---|---|
| Evergreen desktop browsers (Chrome/Edge/Firefox/Safari, current − 2 versions), WebGL2 available | Full support | Full support, adaptive quality (§13.2) as needed |
| Evergreen desktop browsers, WebGL2 unavailable (rare — old drivers, disabled hardware accel) | Full support | 2D list-view fallback (§14.3) |
| Modern mobile browsers (iOS Safari, Chrome Android), WebGL2 available | Full support, touch-adapted composer | Full support, reduced node-count budget for low `memoryClass` devices (§14.3) |
| Older/low-end mobile devices | Full support | 2D list-view fallback likely triggered by the `memoryClass` heuristic even where WebGL2 technically exists, per §14.3's proactive (not just reactive) degradation |
| Screen readers (NVDA/JAWS/VoiceOver) | Full support (§14.4) | 2D list-view fallback strongly recommended as the primary path (§14.1's honest limitation) — the 3D canvas itself is not claimed to be screen-reader-equivalent |
| No JavaScript | Not supported (this is an inherently client-heavy, authenticated application surface — no SSR-only fallback is planned, unlike the marketing site which should remain reasonably functional without JS) | Not supported |
| Tablet (iPadOS/Android tablet), WebGL2 available | Full support, touch-adapted composer and orbit/pinch gestures (§8.3) | Full support — tablets generally sit in a comfortable middle `memoryClass` tier (§14.3), rarely needing the most aggressive degradation |
| Foldable/dual-screen devices | Full support, treated as a single viewport (no special dual-pane universe/chat layout planned for v1) | Full support — flagged as a possible future enhancement (a genuinely dual-pane Chat+Universe layout would suit these devices well) but explicitly out of v1 scope |
| Browser extensions that block/modify WebSocket connections (privacy/ad-blocking extensions) | Full support (unaffected) | Realtime feed gracefully falls back to the "reconnecting" state (§22.2) indefinitely if a WS connection is actively blocked — the universe remains explorable from cache, just without live updates, rather than erroring |
| Corporate/restrictive network environments blocking WebSocket upgrades entirely | Full support (unaffected) | Same graceful degradation as above — this is exactly why §11.4's realtime feed was designed as a pure enhancement layer on top of an already-functional cache-driven experience, never a hard dependency for basic exploration |

---

## 54. Performance Regression Runbook

A short, concrete diagnostic sequence for when §25's metrics (or a user report) indicate the Universe has gotten slower — written so an on-call engineer unfamiliar with every detail of §9 can still triage effectively.

1. **Check `universe.frame_time_ms` p95 against §13.1's budget, segmented by regime.** A regression isolated to one regime (e.g., only R2) points at that regime's specific rendering path (instancing/edges for R2) rather than the shared camera/floating-origin code.
2. **Check `universe.rebase_count` for an unexpected spike.** A sudden increase suggests either a `REBASE_THRESHOLD` that's become miscalibrated for a new usage pattern (e.g., a much larger loaded region than Phase 0's spike anticipated) or a bug causing spurious rebase triggers.
3. **Check `universe.tile_fetch_latency_ms`.** If elevated, this is very likely a backend/ArangoDB-side regression (Risk #6, §19) — run `EXPLAIN` (§16.3, §35) against the exact query shape in production to confirm the `gridCell` index is still being used, before assuming a frontend cause.
4. **Check bundle size via the CI gate's historical trend (§13.4, §16.5).** A slow creep (not a sudden regression) in Universe bundle size can manifest as slower first-toggle latency (`console.toggle_latency_ms`, §25.1) well before it shows up as a frame-time problem.
5. **Reproduce with browser devtools' CPU/GPU throttling** at the specific regime/node-count combination the metrics flagged, and profile with the browser's own Performance panel — cross-reference against §13.1's named time slices (instance writes, regime classification, picking, render) to localize the actual hot spot rather than guessing.
6. **If the regression correlates with a recent LOD pyramid rebuild (`pyramidVersion` bump, §10.5.4):** check whether the rebuild produced a pyramid with a materially different cluster distribution (e.g., a bug in the grid-agglomeration step producing degenerate, oversized clusters) — a bad rebuild can look exactly like a frontend performance regression while actually being a backend data-quality issue.

---

## 55. Content Security Policy & Security Headers

Three.js's worker usage (§9.6, §37) and the WebSocket realtime feed (§11.4) both interact with CSP directives in ways worth pinning down explicitly, since a default/overly-strict CSP is a common source of "it works in dev, breaks in production" WebGL/worker bugs.

```ts
// next.config.ts — headers() addition (extends §50.1)
async function headers() {
  return [
    {
      source: "/console/:path*",
      headers: [
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "worker-src 'self' blob:",              // §37's workers are created via
                                                      // `new URL(...)` which Turbopack/Next
                                                      // may resolve through a blob: URL in
                                                      // some build configurations — must be
                                                      // explicitly allowed or worker creation
                                                      // silently fails in production only
            "connect-src 'self' " + (process.env.NEXT_PUBLIC_API_BASE_URL ?? "") + " wss://" + (process.env.VX_UNIVERSE_WS_HOST ?? ""),
            "img-src 'self' data:",                  // data: needed for the TOTP QR code
                                                      // image (§4.1) if ever inlined rather
                                                      // than fetched as a URL
            "style-src 'self' 'unsafe-inline'",      // Tailwind/CSS-in-JS may require this;
                                                      // tighten if a nonce-based approach is
                                                      // adopted later
            "script-src 'self'",
          ].join("; "),
        },
        { key: "X-Frame-Options", value: "DENY" },   // /console should never be iframed
      ],
    },
  ];
}
```

This is a starting point, not a final security-reviewed policy — flagged as an explicit item for the security review in Phase 6 (§18, §49's Definition of Done) to harden further (e.g., replacing `'unsafe-inline'` with a nonce-based approach once the styling pipeline's exact needs are known).

---

## 56. First-Run Onboarding

A brief, dismissible onboarding pass for a user's very first visit to Universe mode specifically — not a full product tour (which this plan considers over-engineering for v1), but enough to prevent the disorientation risk (Risk #9, §19) from being a first-impression problem.

- **Trigger:** first-ever toggle to Universe mode for a given account (tracked via a simple backend or `localStorage` flag — `localStorage` is acceptable here since it's a low-stakes UX nicety, not security- or correctness-critical state).
- **Content:** three lightweight, sequential, dismissible callouts (not a blocking modal wizard): (1) pointing at the header toggle — "Come back to Chat anytime"; (2) pointing at the minimap (§9.8) — "This shows where you are"; (3) pointing at the floating island's search bar (§6.5) — "Search to jump anywhere in the graph."
- **Dismissal:** any single interaction with the universe (a drag, a scroll-zoom, a click) dismisses all remaining callouts immediately — onboarding should never compete with a user who's already confidently exploring.
- **Explicitly not included in v1:** a full interactive tutorial, forced tooltips-on-every-feature, or anything gating the user from immediately starting to explore — the callouts are purely additive context, never a blocker.

---

## 57. Product Analytics Event Taxonomy

Distinct from §25's *performance* telemetry — this section covers *usage* analytics, answering "are people actually using this the way we designed it," which matters for validating this plan's biggest product bets (e.g., is the mode toggle actually used bidirectionally, or does Universe mode go untouched after first curiosity?).

| Event | Fired when | Key properties |
|---|---|---|
| `console_mode_toggled` | User clicks the header toggle | `from`, `to`, `sessionToggleCount` |
| `universe_regime_entered` | Camera crosses into a new regime (§9.4) — sampled/throttled, not per-frame | `regime`, `zoomTier` |
| `universe_node_selected` | User clicks a node in R2/R3 | `nodeType` (never the node's actual label/content — privacy-conscious by default, §57's implicit rule: analytics properties are structural/categorical, never user content) |
| `universe_search_performed` | A search query is submitted (post-debounce) | `resultCount` (never the raw query text) |
| `universe_flyto_triggered` | A fly-to transition starts (§8.4) | `trigger` (`"search"` \| `"chat_citation"` \| `"double_click"`), `regimesCrossed` |
| `universe_leaf_reached` | The genuine-leaf empty state (§8.2) is shown | — |
| `chat_message_sent` | A user message is sent | `hasAttachment`, `threadMessageCount` |
| `chat_tool_search_universe_invoked` | The assistant invokes the search tool (§7.9) | `resultCount` |
| `chat_view_in_universe_clicked` | The citation bridge (§7.9) is used | — |
| `universe_ask_in_chat_clicked` | The reverse bridge (§33.4) is used | — |
| `onboarding_callout_dismissed` | Any §56 callout is dismissed | `step`, `dismissMethod` (`"interaction"` \| `"explicit_close"`) |

Explicit privacy note, consistent with §15's security posture: none of these events ever carry raw node labels, chat message content, or search query text — only structural/categorical metadata, so this analytics layer can never become a backdoor data-exposure surface even if the analytics vendor's own security posture were ever weaker than the product's own (a defense-in-depth habit worth establishing from the first event definition, not retrofitted later).

---

## 58. Executive Summary for Non-Technical Stakeholders

Everything above this line is written for engineers. This closing section restates the plan in plain terms for anyone who needs the shape of the work without the mechanism.

**What's being built:** After logging in and confirming a 6-digit code from an authenticator app, a user lands in a new part of the product called the Console. Inside the Console, there's one button in the top corner that switches between two views: a **Chat** view (a conversational assistant, similar in feel to talking to Claude) and a **Universe** view (a 3D, endlessly-zoomable visualization of the user's data, rendered as a graph of connected points — think zooming from a galaxy all the way down to a single star). The two views talk to each other: you can ask the chat assistant about something and jump straight to it in the 3D view, or select something in the 3D view and ask the assistant about it directly.

**Why it's hard:** Two things make this a genuinely hard engineering problem, not just a "hook up a chart library" task. First, real "zoom to infinity" in 3D breaks ordinary graphics math once you zoom far enough — this plan spells out the specific technique (used by space-simulation software) that avoids that breakdown. Second, the underlying data can be very large, so the system has to be smart about only ever loading the small slice of the graph that's actually on-screen at any moment, fetching more automatically and invisibly as the user moves around — similar in spirit to how a map application only loads the map tiles near you, not the whole planet at once.

**What's *not* being built in the first version:** editing the graph directly in 3D (v1 is look-and-explore only), a fully screen-reader-equivalent 3D experience (a genuinely accessible 2D list fallback is provided instead), or a specific choice of AI provider/vendor (that's treated as a swappable detail underneath the chat experience).

**How the work is sequenced:** the plan calls for a short, dedicated technical spike first (to nail down the trickiest 3D-math constants with real measurements before building on top of them), then building the login/security screens, then the chat experience, then the 3D universe in two stages (a simpler version first, then the full "zoom through multiple levels of detail" version), then connecting the two experiences together, then a final hardening pass. Each stage produces something real and reviewable rather than one big reveal at the end.

---

## 59. New File Manifest

Every new file this plan introduces to the repository, gathered as a single checklist-style reference — useful both as an implementation punch list and as a way to sanity-check the file structure in §5 stays consistent with everything referenced in later sections.

### 59.1 Routing (`src/app/`)

```
src/app/(marketing)/layout.tsx                          — existing content, re-homed under a route group
src/app/(marketing)/page.tsx
src/app/(auth)/layout.tsx
src/app/(auth)/login/page.tsx
src/app/(auth)/login/verify/page.tsx
src/app/(auth)/signup/page.tsx
src/app/(auth)/signup/mfa-setup/page.tsx
src/app/console/layout.tsx
src/app/console/unauthorized.tsx
src/app/console/loading.tsx
src/app/console/home/page.tsx
src/app/console/(chat)/c/[threadId]/page.tsx
src/app/console/(universe)/u/page.tsx
src/app/console/settings/page.tsx
src/app/api/chat/route.ts
src/app/api/universe/tiles/route.ts
src/app/api/universe/node/[id]/route.ts
src/app/api/universe/stream/route.ts
src/app/api/auth/login/route.ts
src/app/api/auth/verify/route.ts
src/app/api/auth/logout/route.ts
src/app/console/console-theme.css
src/instrumentation-client.ts
src/proxy.ts
```

### 59.2 Server-side (`src/server/`)

```
src/server/dal/session.ts
src/server/auth/session-codec.ts
src/server/backend-client.ts
```

### 59.3 Console shell (`src/features/console/`)

```
src/features/console/console-shell.tsx
src/features/console/console-header/console-header.tsx
src/features/console/console-header/mode-toggle-button.tsx
src/features/console/floating-island/floating-island-host.tsx
src/features/console/floating-island/chat-composer.tsx
src/features/console/floating-island/universe-command-bar.tsx
src/features/console/store/console-mode-store.ts
```

### 59.4 Chat (`src/features/chat/`)

```
src/features/chat/use-console-chat.ts
src/features/chat/chat-message-list.tsx
src/features/chat/chat-message.tsx
src/features/chat/tool-call-card.tsx
src/features/chat/markdown/incremental-markdown.ts
src/features/chat/markdown/incremental-markdown-renderer.tsx
src/features/chat/markdown/workers/highlight.worker.ts
src/features/chat/scroll/use-scroll-anchor.ts
src/features/chat/scroll/scroll-anchor-provider.tsx
src/features/chat/data/use-chat-history.ts
```

### 59.5 Universe (`src/features/universe/`)

```
src/features/universe/universe-canvas-boundary.tsx
src/features/universe/universe-canvas.tsx
src/features/universe/node-detail-card.tsx
src/features/universe/store/selection-store.ts
src/features/universe/minimap/minimap-scene.tsx
src/features/universe/engine/floating-origin.ts
src/features/universe/engine/regime-controller.ts
src/features/universe/engine/camera-controller.ts
src/features/universe/engine/node-instances.tsx
src/features/universe/engine/engine-bridge.ts
src/features/universe/engine/worker-pool.ts
src/features/universe/engine/workers/decode.worker.ts
src/features/universe/engine/workers/cluster.worker.ts
src/features/universe/engine/workers/layout.worker.ts
src/features/universe/engine/shaders/node-glow.vert.glsl
src/features/universe/engine/shaders/node-glow.frag.glsl
src/features/universe/engine/shaders/starfield.frag.glsl
src/features/universe/engine/shaders/edge-line.frag.glsl
src/features/universe/data/use-universe-tile.ts
src/features/universe/data/use-universe-prefetch.ts
src/features/universe/data/use-node-detail.ts
src/features/universe/data/use-universe-search.ts
src/features/universe/data/use-universe-realtime.ts
src/features/universe/data/universe-api.ts
```

### 59.6 Shared/cross-cutting

```
src/lib/query-keys.ts
src/lib/shared-spatial-index.ts               — the isomorphic cellSize(tier)/gridCell
                                                  module referenced repeatedly (§10.3,
                                                  §16.2, §19 Risk #3) as needing to be
                                                  literally shared, not reimplemented,
                                                  between client and (conceptually) backend
```

### 59.7 Dev/test tooling (not shipped to production)

```
scripts/dev/generate-seed-graph.ts
scripts/dev/mock-backend/server.ts
scripts/dev/mock-backend/encode-tile.ts
migrations/001-initial-universe-schema.js     — backend-owned, referenced here for
                                                  frontend-team visibility only
```

### 59.8 Modified (not new) files

```
next.config.ts                — headers(), worker/runtime notes (§50.1, §55)
tsconfig.json                 — path aliases (§50.2)
package.json                  — new dependencies (§50.4)
src/app/providers.tsx          — QueryClientProvider addition (§12.1)
src/shared/packages/ui/icons.ts — new Globe/ChatBubble icon entries (§23.3)
```

---

## 60. Consolidated Tunable Constants Reference

Every numeric constant named across this plan, gathered into one table so Phase 0 (§18) and ongoing production tuning have a single checklist rather than needing to re-scan the whole document. **Status column reflects that these are placeholder estimates unless marked otherwise** — this table itself should be updated in place as real measurements land, per §16.4's requirement.

| Constant | Placeholder value | Source | Status |
|---|---|---|---|
| `REBASE_THRESHOLD` | 5,000 world units | §9.2.2 | Pending Phase 0 measurement |
| Regime distance bands (R0/R1/R2/R3) | >10,000 / 1,000-10,000 / 50-1,000 / <50 | §8.1 | Pending Phase 0/4 tuning against real graph density |
| Regime hysteresis gap | ~20% band (e.g. enter R2 at 1,000, exit at 1,200) | §8.1, §9.4 | Illustrative — needs a thrash-rate-driven tuning pass (§25.1) |
| Camera settle timeout | 150ms | §9.7 | Reasonable default, low risk, not flagged as needing a spike |
| Fly-to default duration | 1,400ms | §31 | Design/feel tuning, not a correctness constant — adjust by eye |
| Frame time budget (total) | 16.6ms (60fps) | §13.1 | Fixed target, not tunable — the *breakdown* across slices is what Phase 0 informs |
| Target concurrent node/edge count | 5,000 nodes / 8,000 edges | §13.1 | Pending Phase 0 measurement at target device tier |
| Tile response size budget | ≤150KB | §13.3 | Back-of-envelope estimate, verify against real §11.1 framing overhead |
| Cold time-to-first-tile target | ≤500ms | §13.3 | Product/UX target — informs Fluid Compute/prefetch decisions, not purely a measured constant |
| Chat-only bundle exclusion | `three`/R3F must be 0KB in this path | §13.4 | Hard requirement, CI-enforced (§16.5), not tunable |
| Universe bundle budget | ≤400KB gzipped | §13.4 | Soft target — negotiate against actual drei/postprocessing needs during Phase 3 |
| Prefetch ring width (moving / settled) | 1 ring / 2 rings | §11.3 | Reasonable default; validate against real pan behavior and bandwidth budgets |
| Tile request concurrency cap | 2 concurrent in-flight | §11.2 | Conservative default — raise only with evidence it's limiting perceived responsiveness |
| Realtime event coalescing window | 200ms | §13.3, §34.6 | Reasonable default for burst-absorbing; validate against real bulk-write event rates |
| Cluster pyramid tier count (`MAX_TIER`) | Unset — depends on graph scale | §10.5.1, §46 | Explicitly deferred to Phase 0/4 + Open Question #4 (§24) |
| LOD grid `growthFactor` per tier | 8-16x member reduction (illustrative range) | §10.5.1 | Needs real tuning against actual graph clustering structure |
| R3 neighbor-expansion cap | 200 neighbors | §10.4.3 | Reasonable default matching typical "detail card" information density; revisit if real graphs have much higher-degree hub nodes |
| Edge render cap per viewport | Unset numeric value — "N highest-weight" | §9.3.3 | Needs a concrete number chosen against §13.1's frame budget once Phase 3 profiling exists |
| MFA lockout threshold | 5 attempts / 15 minutes | §4.5, §41 | Security/product policy decision, not a performance constant — confirm with security review (Phase 6) |
| Search debounce | 200ms | §34.4, §41 | Standard UX default, low risk |
| Draft-persistence debounce | 250ms | §7.10, §33.1 | Standard UX default, low risk |
| Adaptive-quality step-down / step-up windows | 1s sustained over-budget / 3s sustained headroom | §13.2 | Asymmetric-hysteresis default — validate against real frame-time variance in the field |
| One-ring vs. two-ring prefetch trigger | Settle timeout of 150ms (shared with §9.7's own settle event) | §11.3 | Coupled to the camera settle constant by design, not independently tunable without also reconsidering the camera-feel implications |
| Onboarding callout count | 3 sequential callouts | §56 | Deliberately small — a product decision, not a performance constant; increasing this count works against §56's explicit "never compete with a confidently-exploring user" goal |
| MFA partial-session TTL | ~5 minutes (illustrative) | §4.2 | Security/UX balance — long enough to type a code without rushing, short enough to bound the partial-session attack window (§15.1) |
| Realtime WS reconnect backoff | Standard exponential backoff (base/cap unspecified) | §11.4 | Left intentionally unspecified pending real-world reconnect-frequency data — an arbitrary hardcoded backoff curve here would be guessing without the field data §25's metrics would provide |

---

## 61. Manual QA Script

A step-by-step script for a human tester to walk through before considering any phase's work demo-ready — complements (does not replace) the automated suites in §16.

### 61.1 Auth & MFA

1. Sign up with a new account; confirm the TOTP enrollment screen (`<TotpSetup/>`) shows a scannable QR code and a working mobile deep link.
2. Enter an intentionally wrong confirmation code during enrollment; confirm a clear inline error, no crash, no silent failure.
3. Complete enrollment with a correct code from a real authenticator app (not a hardcoded test value) end to end.
4. Log out, log back in with correct credentials; confirm landing on `/login/verify`, not directly into `/console`.
5. Enter a wrong TOTP code 5 times in a row; confirm lockout UI (§22.3, §51.1) appears with a live countdown, and that the countdown actually re-enables the input once it reaches zero.
6. Complete a correct verify; confirm redirect lands on `/console/home`, which itself resolves to `/console/c/new` for this (first-time) account.

### 61.2 Chat

7. Send a first message on a brand-new thread; confirm the URL updates from `/console/c/new` to a real thread id without any visible page reload or scroll-position jump.
8. While a response is streaming, scroll up manually; confirm auto-scroll stops immediately and a "Jump to latest" pill appears; click it and confirm it smooth-scrolls and re-arms auto-scroll.
9. Send a message containing a multi-line code block spanning at least one paste-induced chunk boundary if possible (or simulate via a slow network throttle); confirm no visible flicker and correct final syntax highlighting.
10. Start a message, and while it's still streaming, type and send a second message; confirm it queues (visible "Sending after this response finishes…" hint, §33.1) and fires automatically once the first completes.
11. Type in a CJK input method (or simulate via OS-level IME if available) and press Enter mid-composition; confirm it does not prematurely submit.
12. Refresh the page mid-thread; confirm message history loads correctly and scroll position lands at the bottom.
13. Scroll to the very top of a long thread; confirm older messages load with zero visible scroll jump.
14. Trigger the `search_universe` tool (ask a question likely to invoke it); confirm the tool-call card renders distinctly from plain assistant text, and that "View in Universe" correctly toggles mode and flies the camera.

### 61.3 Universe

15. Toggle to Universe mode for the first time this session; confirm the loading spinner overlay on the toggle button appears only briefly, and the onboarding callouts (§56) appear once, dismissing correctly on first interaction.
16. Zoom out repeatedly past the point where all currently-loaded real data is behind the camera; confirm the view continues to feel continuous (decorative starfield) rather than showing an empty/black void or visibly stopping.
17. Zoom in on a real node all the way to R3; confirm the detail card renders correct properties and a working neighbor count.
18. Continue zooming in past a node with no further children; confirm the "edge of the known universe" positive empty state appears, not an error.
19. Use the floating island's search bar to jump to a node by name; confirm the fly-to animation sweeps smoothly across regimes without ever showing an empty scene mid-flight.
20. Click "Ask about this in Chat" from a node's detail card; confirm mode toggles to Chat, a draft is pre-filled (and editable, not auto-sent), referencing the correct node.
21. While in Universe mode, trigger a chat event on a background thread (or simulate via the mock backend); confirm the mode-toggle icon shows the activity pulse, and that it clears on toggling to Chat.
22. Toggle rapidly between Chat and Universe several times in a row; confirm no visible remount flicker, no WebGL context re-creation delay on repeat toggles, and that an in-progress chat draft survives every toggle.
23. Throttle the network (devtools) while panning quickly across the universe; confirm tile requests coalesce sensibly (no request pileup) and the view degrades gracefully (a soft "this region is taking a moment" treatment, §22.2) rather than freezing.
24. Simulate a WebGL context loss (available via a devtools/extension trigger, or `WEBGL_lose_context` in a console script) while the universe is visible; confirm the "Reconnecting the universe…" overlay appears and recovery is attempted before any hard-failure UI shows.

### 61.4 Accessibility & degraded modes

25. Disable hardware acceleration (or use a browser/flag known to lack WebGL2) and toggle to Universe mode; confirm the 2D list-view fallback renders instead of a broken/blank canvas.
26. Enable `prefers-reduced-motion` at the OS level; confirm fly-to transitions become near-instant cuts, the starfield stops animating, but direct zoom/pan (user-driven) still works normally.
27. Navigate the entire Chat surface using only the keyboard (no mouse); confirm every interactive element (composer, send/stop, message actions, header toggle, user menu) is reachable and operable in a sensible tab order.
28. With a screen reader active, send and receive a chat message; confirm the streaming response is announced at reasonable (not word-by-word) intervals.

### 61.5 Cross-cutting

29. Force a `401` on an authenticated background action (e.g., simulate an expired session mid-session via devtools request interception) while mid-draft in chat; confirm the in-place re-verify modal appears (not a hard redirect) and the draft survives.
30. Confirm the chat-only initial bundle (via devtools' Network tab, filtering for `.js` chunks, before ever toggling to Universe) does not include any chunk with `three`/`r3f`-identifiable content.

---

## 62. Cost & Capacity Planning Considerations

Not a committed budget (that depends on vendor pricing and real usage patterns unknowable at planning time), but the cost *drivers* this architecture creates, flagged so whoever owns infra budget can model them concretely rather than being surprised later.

| Cost driver | What determines it | Where this plan already mitigates it |
|---|---|---|
| LLM inference (chat) | Message volume × average tokens in/out × chosen model's per-token pricing | §2.4 flags the AI Gateway for provider flexibility/fallback, letting cheaper models be routed to for simple queries if cost becomes a concern — not committed to for v1, but the architecture (a single proxy seam, §7.3) doesn't block adding it later |
| Vercel Function invocations/compute time | Tile-fetch request volume, chat stream duration, WS proxy connection-time | §13.3's request-coalescing (§11.2) and prefetch-ring discipline (§11.3) directly bound tile-fetch volume rather than firing on every camera-frame; Fluid Compute's instance reuse (§2.4) reduces cold-start compute waste specifically for this bursty-but-frequent access pattern |
| ArangoDB compute/storage | Graph size, query volume, LOD pyramid rebuild frequency/cost | §10.1/ADR-002's precomputed-pyramid approach is explicitly the cost-avoidance move here — trading a bounded, schedulable background job cost for what would otherwise be unbounded per-request aggregation cost at read time |
| Bandwidth (tile payloads) | §11.1's binary framing vs. JSON — directly a cost lever, not just a performance one, since bandwidth is metered on most hosting platforms | Binary framing (ADR-005) reduces payload size by roughly 4-6x vs. naive JSON per the illustrative sizing in §44.3 — a direct, quantifiable bandwidth cost reduction, not just a latency one |
| Realtime WS connection count | Concurrent active `/console` sessions with Universe mode ever toggled on this session (per §11.4, workers/connections persist for the session once opened) | §11.4's "one connection per session, server-enforced" rule (§41) prevents connection-count blowup from misbehaving clients; connections naturally close when a user navigates away from `/console` entirely |

### 62.1 A rough capacity sanity-check (illustrative math only, not a commitment)

For a hypothetical 10,000 daily active `/console` users, each averaging 3 Universe-mode sessions/day with moderate exploration (say, 15 tile fetches per session, ~80KB average per §13.3's budget): that's `10,000 × 3 × 15 × 80KB ≈ 36GB/day` of tile bandwidth — a number worth sanity-checking against whatever hosting bandwidth pricing applies, but small enough relative to typical modern web-app bandwidth budgets that it should not, on its own, be a blocking concern for a v1 launch at this illustrative scale. This kind of back-of-envelope pass is worth re-running with real usage numbers once Phase 5/6 telemetry (§25) exists, rather than trusting the illustrative figures here indefinitely.

The same illustrative population's chat usage (say, 8 messages/user/day, ~600 tokens average combined input+output) works out to roughly 48M tokens/day platform-wide — the actual dollar cost of that entirely depends on which model(s) end up serving the bulk of traffic, which is exactly why §2.4 and §44.2 both keep the provider choice swappable behind a single seam (the AI Gateway option, or a direct provider SDK) rather than hardcoding a specific vendor's pricing assumptions anywhere in this plan's architecture.

---

## 63. Feature Parity Checklist vs. Claude.ai (Chat Mode)

Since "just like Claude Chat" is the explicit bar for this plan's chat mode, a direct checklist against Claude.ai's own observable behavior — useful both for Phase 2's QA pass (§49, §61) and for catching scope creep in either direction (matching too little, or over-building features Claude.ai itself doesn't have and this product doesn't need).

| Claude.ai behavior | This plan's equivalent | Section |
|---|---|---|
| Floating/fixed composer at the bottom of the conversation | Floating island composer | §6.5, §7.7 |
| Streaming response with smooth incremental rendering | Incremental markdown renderer, fence-aware highlighting | §7.5 |
| Auto-scroll that respects manual scroll-up | Full 5-rule scroll-anchor contract | §7.6, §33.2 |
| Stop-generating control | Composer morphs to a stop button while streaming | §7.7 |
| Editable/regeneratable messages (Claude.ai supports editing a past user message and regenerating from there) | **Not explicitly specified in this plan** — flagged here as a gap; regenerate-from-edit is a reasonable fast-follow but wasn't named in the original brief | New open item — add to §24 if confirmed in scope |
| Collapsed "thinking"/reasoning disclosure | Reasoning parts render collapsed-by-default | §7.9 |
| Tool-use rendered as distinct structured cards, not inline prose | `search_universe` tool-call card | §7.9, §17.2 |
| Conversation list/history rail (left sidebar) | **Not explicitly specified in this plan** — the brief describes a single floating-island + header toggle surface, not a persistent thread-history sidebar; flagged as a likely-needed addition once multiple concurrent threads matter to real usage, currently out of this plan's named scope | New open item — add to §24 if confirmed in scope |
| Per-message actions (copy, etc.) | Named in §14.4's accessibility requirement but not separately speced as a feature | Should be filled in during Phase 2 implementation as a standard, low-risk addition |
| Model/settings picker in a top bar | **Deliberately not included** — this product's header is reserved for the mode toggle and breadcrumb/thread title (§6.2); a model picker isn't part of the stated brief and would compete for header space with the mode-toggle's prominence | Confirmed out of scope, not a gap |

Two genuine gaps are surfaced by this checklist (message editing/regeneration, and a persistent thread-history list) — both flagged as new candidate entries for §24's Open Questions rather than silently added to scope or silently ignored, since neither was named in the original brief but both are reasonable expectations once a user has used Claude.ai and then uses this product.

---

## 64. Failure Mode & Chaos Scenarios

Beyond the state catalog in §22 (which covers *expected* error states with designed UI), this section lists lower-probability, higher-severity failure scenarios worth deliberately testing (via network throttling/blocking, request interception, or a real chaos-testing tool) before considering the system production-ready — because these are exactly the scenarios that don't get exercised by normal QA click-through but do happen in production at scale.

| Scenario | Expected behavior |
|---|---|
| Backend goes fully down mid-Universe-session | Cached tiles remain explorable (TanStack Query cache, §12.2); new tile fetches fail gracefully into the §22.2 "unavailable region" state; realtime WS shows "reconnecting" indefinitely rather than crashing the canvas |
| Backend goes down mid-chat-stream | Partial response preserved, marked incomplete, "Continue generating" offered (§22.1) — never silently discarded |
| ArangoDB itself becomes slow (not down, just degraded) without erroring | Tile fetch latency metric (§25.1) spikes; requests eventually resolve (not timing out prematurely) — verify the proxy route's own fetch timeout (§2.3) is generous enough not to falsely error out a merely-slow-but-healthy backend, while still bounded enough not to hang a browser tab indefinitely |
| A malformed/corrupt tile payload arrives (bit-flip, truncated response, backend bug) | `decode.worker.ts` (§37.1) must not throw an uncaught exception that kills the worker silently — wrap the parse in a try/catch, post a distinct `{ type: "decode_error" }` response, and have the main thread treat it identically to a fetch failure (§22.2), not crash the whole Universe panel |
| WebSocket silently stops delivering events without a formal close (a "zombie" connection — TCP-level, not application-level failure) | A heartbeat/ping-pong mechanism (standard WS keepalive) should be assumed as a baseline backend requirement so the client can detect and reconnect a zombie connection rather than trusting a connection that looks "open" but is dead |
| User's browser tab is backgrounded for an extended period (laptop sleep, tab switched away for hours) then resumed | On resume, the realtime feed's stale-state detection (§11.4's reconnect-with-last-known-version handshake) should trigger a full resync rather than assuming the long gap contained no missed events; the camera/engine state should not have advanced (no "phantom" time-based movement while backgrounded) |
| Two browser tabs open to the same account, both toggled into Universe mode simultaneously | Each tab maintains its own independent camera/local-origin state (no cross-tab camera sync attempted in v1 — flagged as explicitly out of scope, not a bug) but both should correctly receive and apply the same realtime change-feed events independently |
| A user rapidly fires many fly-to requests in succession (e.g., double-clicking several different nodes before any flight completes) | Each new `flyTo()` call should cleanly supersede the in-flight one (§31's `this.flight = new CameraFlight(...)` simply replaces the reference) rather than queuing or fighting — the camera should smoothly redirect toward the newest target, not stutter between competing animations |
| The LOD pyramid rebuild job (§38) fails or is interrupted partway | `pyramidVersion` should only bump on a fully successful, atomic rebuild completion — a partial/failed rebuild must never leave the pyramid in a torn state visible to clients (this is a backend transactionality requirement, flagged here because a torn pyramid would manifest to the frontend as visually inconsistent nested clusters, §10.5.2's consistency requirement, and would be very confusing to debug from the frontend side alone) |

---

## 65. Protocol Versioning Strategy

As this system evolves post-launch, the tile binary framing (§11.1) and the realtime event schema (§11.4) both need a compatibility story so frontend and backend can deploy independently without a hard-synchronized release.

- **Tile framing:** the header (§11.1) should include an explicit `frameVersion` integer from day one (omitted from earlier sections' sketches for brevity, but required in the real implementation) — the `decode.worker.ts` (§37.1) should switch its parsing logic on this field, and a client encountering an unrecognized `frameVersion` should treat it as a decode error (§64's malformed-payload handling) with a distinct, loggable error code, rather than attempting to parse mismatched binary layout and producing garbage positions.
- **Realtime events:** `UniverseChangeEvent`'s discriminated-union `type` field (§11.4, §21) already provides natural forward-compatibility — a client encountering an unrecognized `type` value should ignore that event gracefully (log it, don't crash), which lets the backend introduce new event types ahead of a corresponding frontend release without breaking older connected clients.
- **REST/JSON endpoints** (§45): standard additive-field compatibility applies (new optional fields are safe to add without a version bump; removing or repurposing a field's meaning requires a new endpoint version, e.g. `/api/v2/...`, rather than silently changing `/api/v1/...`'s contract) — no new convention needed here beyond what the existing `apiVersionPath` (`/api/v1`, already established in `src/shared/lib/api-client.ts`) already implies.

---

## 66. Analogous Systems Reference

Grounding this plan's least-familiar mechanics by direct comparison to systems most engineers already have an intuition for — useful both for onboarding a new contributor quickly and for sanity-checking that a proposed change doesn't reinvent a wheel one of these systems already turns.

| This plan's mechanic | Closest well-known analogue | What's borrowed | What's different |
|---|---|---|---|
| LOD cluster pyramid (§10.5) | Web map tile pyramids (Google Maps, Mapbox, Slippy Map convention) | Discrete zoom levels, precomputed coarser aggregation per level, indexed lookup by tile/cell key instead of live aggregation | Three spatial dimensions instead of two; "tiles" are graph-clustering aggregates (centroid + member count) rather than rendered raster/vector map imagery |
| Floating origin (§9.2.2) | Space-sim engines (Kerbal Space Program, Elite Dangerous, Cosmographia) | Periodic re-centering of the world around the camera to keep GPU-side float32 precision usable at large "distances traveled" | Combined with discrete regime tiers (§9.2.3) rather than relying on floating origin alone across the entire range, since this product's scale ratio (cosmos-to-inspect) is even more extreme than most space-sims' typical camera-to-object ranges |
| Multiplicative zoom-to-cursor (§9.7, §31) | Figma/Google Maps/most professional 2D canvas tools | The exact "equal perceptual zoom speed regardless of current zoom level" feel, achieved via multiplicative rather than additive distance stepping | Applied to a full 3D orbit camera rather than a 2D pan/zoom canvas |
| Chunked, viewport-bounded data fetch (§11) | Infinite-scroll feeds, map-tile fetch-on-pan, game-engine "streaming world" chunk loading | Fetch only what's near the current viewport/camera, prefetch a buffer ring ahead of movement, cache aggressively since chunks are near-immutable | Chunks vary by *tier* as well as *position* (a true 3D/multi-scale streaming problem, closer to a game engine's LOD-aware world streaming than a flat 2D infinite-scroll) |
| `useSyncExternalStore`-bridged engine state (§12.4) | Game-engine "ECS + UI overlay" architectures, where a real-time simulation loop is bridged to a slower-updating UI layer via a snapshot/pub-sub boundary | The core idea of never letting a 60fps simulation directly drive a UI framework's render cycle | Uses React's own concurrent-safe primitive (`useSyncExternalStore`) rather than a custom engine-specific bridge, since this is a web app, not a native game engine |
| Claude-style floating island + streaming chat (§6.5, §7) | Claude.ai itself, and by extension Cursor/other modern AI-chat products | Composer placement, scroll-anchor behavior, fence-aware incremental markdown rendering, tool-call card rendering | Adds the bidirectional bridge to a 3D graph visualization, which no general-purpose chat product needs to solve |
| Off-tree persistent mounting for a toggled UI surface (§6.3) | Native mobile "tab bar" apps, where each tab's view controller typically stays alive in memory across tab switches rather than being torn down | The "switching doesn't destroy state" guarantee users implicitly expect from any tabbed interface | Implemented as an explicit, deliberate pattern in a web/React context, where the framework's default (route-based mount/unmount) would otherwise *not* behave this way without this plan's specific off-tree approach |
| Binary tile framing with a versioned header (§11.1, §65) | Game asset streaming formats and video container formats (both use length-prefixed, versioned binary framing for exactly the same "dense data, needs forward-compatible parsing" reasons) | Length-prefixed sections, an explicit version field gating parser behavior | Purpose-built and much simpler than a general media container format, since the payload shape (typed numeric arrays) is far more homogeneous than audio/video/game-asset data |

---

## 67. Terminology Cheat Sheet (Frontend ⟷ Backend Alignment)

A short cross-reference for the handful of terms most likely to cause a frontend/backend miscommunication during implementation kickoff — worth walking through explicitly in the Phase 0/1 kickoff conversation with the backend team (tying back to §24's open questions).

| Term | What the frontend means by it | What to confirm the backend means the same thing |
|---|---|---|
| "Tile" | A single response to a `/universe/tiles` request, covering a specific `(tier, cellIds)` combination — §11.1 | Confirm the backend doesn't already use "tile" to mean something else (e.g., a UI dashboard widget) in its own internal vocabulary, to avoid cross-team confusion in shared docs/tickets |
| "Tier" | An integer index into the LOD pyramid, 0 = coarsest — §10.5.1 | Confirm tier numbering direction (0 = coarsest vs. 0 = finest) is agreed identically on both sides — an inverted convention here would silently break every query in §10.4 without throwing any error |
| "Cluster" | A materialized, precomputed aggregate node in `node_clusters_L*` — §10.2 | Distinguish explicitly from any *client-side* "cluster" the `cluster.worker.ts` (§37.2) computes transiently for rendering/picking purposes only — these are two different concepts sharing a name, flagged in §9.6.2's own clarification, worth restating here since it's a likely point of cross-team confusion |
| "Session" | The MFA-aware, two-state (`mfa_required`/`authenticated`) cookie-backed concept in §4.3 | Confirm the backend's session model actually distinguishes these two states as described, rather than only having a single authenticated/unauthenticated boolean — this is a specific product requirement (§4.2's flow), not a default most auth backends assume out of the box |
| "Node" (graph) vs. "node" (infrastructure) | Always means a graph vertex/document (`nodes` collection, §10.2) in this document | Purely a vocabulary-collision risk in spoken/written cross-team communication (infra "nodes" being a completely different concept) — worth a one-time explicit disambiguation, not a technical issue |
| "Thread" (chat) | A `chat_threads` conversation, §7.2 | Purely a vocabulary note — distinguish from any OS/runtime "thread" concept when discussing the Web Worker architecture (§9.6, §37) in the same conversation |

---

## 68. Sequence Diagrams

ASCII sequence diagrams for the four highest-traffic, most cross-system flows in this plan — complementing §36's prose walkthrough with a more scannable, reference-style view of each individual exchange.

### 68.1 Auth → MFA → console entry

```
Browser              proxy.ts           Backend              console/layout.tsx
  |                      |                   |                        |
  |--GET /console/home-->|                   |                        |
  |<--302 /login---------|                   |                        |
  |--GET /login--------->|                   |                        |
  |<--200 (login form)---|                   |                        |
  |--POST credentials------------------------>|                        |
  |<--Set-Cookie(mfa_required)----------------|                        |
  |--GET /login/verify-->|                   |                        |
  |<--200 (code form)----|                   |                        |
  |--POST 6-digit code------------------------>|                        |
  |<--Set-Cookie(authenticated)----------------|                        |
  |--GET /console/home-->|                   |                        |
  |   (optimistic check passes)               |                        |
  |<--302 /console/c/new-|                   |                        |
  |--GET /console/c/new----------------------------------------------->|
  |                      |                   |<--GET /auth/session----|
  |                      |                   |--200 Session---------->|
  |<--200 (console shell rendered)-----------------------------------|
```

### 68.2 Universe tile fetch (cold viewport load)

```
UniverseCanvas     regime-controller     TanStack Query     /api/universe/tiles     Backend        ArangoDB
      |                    |                    |                    |                   |               |
      |--mount, initial----|                    |                    |                   |               |
      |   camera position  |                    |                    |                   |               |
      |                    |--compute cellIds-->|                    |                   |               |
      |                    |                    |--GET tiles?cells---|                   |               |
      |                    |                    |   (proxied)        |--forward + auth--->|               |
      |                    |                    |                    |                   |--AQL query--->|
      |                    |                    |                    |                   |<--cursor batch-|
      |                    |                    |                    |<--binary response-|               |
      |                    |<--binary buffer----|                    |                   |               |
      |<--decode.worker.ts (off main thread)-----|                    |                   |               |
      |--upload to InstancedMesh buffers-------->|                    |                   |               |
      |--render frame------|                    |                    |                   |               |
```

### 68.3 Chat send → stream → thread-id reconciliation

```
ChatComposer      useConsoleChat      /api/chat route       Backend             TanStack Query cache
     |                   |                    |                   |                       |
     |--submit()-------->|                    |                   |                       |
     |                   |--optimistic render (local- id)          |                       |
     |                   |--POST { threadId: null, message }------>|                       |
     |                   |                    |--forward---------->|                       |
     |                   |                    |<--X-Thread-Id hdr--|                       |
     |                   |<--headers received-|                   |                       |
     |                   |--history.replaceState(/console/c/:realId)                       |
     |                   |---------------------------------------------------------------->|
     |                   |            setQueryData(realId key), removeQueries(local- key)   |
     |                   |<--SSE UIMessage stream chunks----------|                       |
     |<--incremental render (markdown, fence-aware)---------------|                       |
     |   [user scrolled up mid-stream → auto-scroll suspended, "Jump to latest" shown]     |
     |<--stream complete--|                    |                   |                       |
```

### 68.4 Realtime change feed → cache invalidation → visual fade-in

```
Backend (write)      WebSocket        useUniverseRealtime      TanStack Query        NodeInstances (shader)
     |                    |                     |                      |                        |
     |--node created------|                     |                      |                        |
     |   in gridCell X     |                     |                      |                        |
     |                    |--push event--------->|                      |                        |
     |                    |                     |--add to pendingCells  |                        |
     |                    |                     |  (coalescing window)  |                        |
     |                    |     [200ms later, window flushes]           |                        |
     |                    |                     |--invalidateQueries--->|                        |
     |                    |                     |  (predicate: touches cell X)                    |
     |                    |                     |                      |--refetch tile---------->|
     |                    |                     |                      |<--updated node set-------|
     |                    |                     |                      |--diff vs previous set--->|
     |                    |                     |                      |  new node found          |
     |                    |                     |                      |--set instanceIntensity=0->|
     |                    |                     |                      |  ramp to 1 over ~600ms    |
```

### 68.5 Leaf-level session expiry → in-place re-verify (ADR-007's mechanism)

```
User (mid-draft)     ChatComposer       Server Action        Backend           Re-verify Modal
      |                    |                    |                   |                    |
      |--typing draft------|                    |                   |                    |
      |--hits send--------->|                    |                   |                    |
      |                    |--call action------->|                   |                    |
      |                    |                    |--forward--------->|                    |
      |                    |                    |<--401 (session expired)                 |
      |                    |<--401 surfaced-----|                   |                    |
      |                    |--(draft untouched, |                   |                    |
      |                    |   composer still   |                   |                    |
      |                    |   mounted)          |                   |                    |
      |                    |------------------------------------------------->show modal--|
      |<---------------------------------------------------------------------------------|
      |--enters TOTP code->|                    |                   |                    |
      |                    |                    |--POST /auth/verify--------------------->|
      |                    |                    |<--Set-Cookie(authenticated)--------------|
      |                    |<--modal closes-----|                   |                    |
      |--hits send again-->|                    |                   |                    |
      |                    |--original message now sends successfully-------------------->|
```

The key property this diagram makes visible: the `ChatComposer` component itself never unmounts across this entire sequence — the 401 is caught at the Server Action boundary (ADR-007), surfaced as a modal *layered on top of* the still-mounted shell, and the draft the user typed before hitting send is still sitting in the (never-destroyed) textarea the whole time.

---

## 69. Change History of This Document

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-02 | Initial authoring — full plan covering console shell, MFA/auth flow, Claude-style chat interface, Three.js infinite-zoom universe, ArangoDB LOD/chunked-fetch architecture, and all supporting reference material (§0-§68), grounded against this repository's actual installed Next.js version, existing shared UI package, and existing `TotpSetup`/`api-client.ts` conventions. |

Future revisions should append a row here rather than silently editing history — in particular, log: (a) any numeric constant in §60 corrected by real measurement, (b) any Decision Log entry (§20) revisited or superseded, and (c) any Open Question (§24) resolved, noting the resolution.

---

## 70. Common Pitfalls Checklist (Pre-PR Review)

A distilled, non-exhaustive list of the specific mistakes this document repeatedly flags as easy to make by accident — worth a final skim before opening a PR touching any of this system, in addition to whatever this repo's standard review process already covers.

- [ ] Did the mode-toggle icon get inverted? (Chat mode → Globe icon; Universe mode → Chat-bubble icon. §1.1, §6.2, §33.3's inline comment exists specifically because this is easy to get backwards.)
- [ ] Was `middleware.ts` used anywhere instead of `proxy.ts`? (Next 16 renamed it — old habit/muscle memory is the most likely source of this mistake. §3.1.)
- [ ] Is `unauthorized()` being called from `console/layout.tsx` (or any other shell-root-level file) rather than a narrow leaf-level check? (ADR-007 — this would destroy the persistently-mounted shell on a routine session hiccup.)
- [ ] Did a new import accidentally pull `three`/`@react-three/*` into a code path reachable before the first Universe toggle? (§9.1, §13.4 — should be caught by CI, §16.5, but worth a manual bundle-analyzer glance on any change touching shared/console-level files.)
- [ ] Is the Universe panel's hidden state implemented with `display: none` instead of `visibility: hidden`? (§39's explicit warning about WebGL context/rAF behavior differences.)
- [ ] Does any new AQL query in the universe data path apply the tenant-scoping filter **first**, before the spatial `gridCell` filter? (§15.2, §35.1 — mandatory, easy to omit when copy-pasting a query shape from this plan's illustrative (tenant-omitted) examples.)
- [ ] Does a new/changed AQL query still hit the intended index, verified via `EXPLAIN`, not just "it returns correct results"? (§16.3, Risk #6 — a query can silently degrade to a full scan after an unrelated schema change.)
- [ ] Is `cellSize(tier)` computed identically on the client and (conceptually) the backend, ideally via the literal shared module (`src/lib/shared-spatial-index.ts`, §59.6) rather than two independent reimplementations? (Risk #3, §19.)
- [ ] Does any code path read a rebase-affected value (a raycast cache, a minimap projection, an in-flight flight-plan target) from a stale pre-rebase `Object3D.position` rather than the double-precision `WorldRegistry`? (§9.2.2's explicit warning.)
- [ ] Is a new "empty" or "error" state for any surface actually cataloged in §22, or was it invented ad hoc with inconsistent tone/treatment? (§22's whole point is exactly this consistency.)
- [ ] Does new chat-adjacent code correctly ignore `Enter` during IME composition (`event.nativeEvent.isComposing`)? (§7.7, §33.1 — an easy-to-miss check that only breaks for a subset of input methods, so it's easy to ship a regression that passes all-English manual testing.)
- [ ] Does a new realtime event handler process events one-by-one instead of coalescing a burst? (§13.3, §34.6 — a bulk backend write should never cause a storm of individual re-renders.)
- [ ] Are new analytics events (§57) free of raw user content (message text, search query text, node labels) in their properties? (§57's explicit privacy rule.)
- [ ] Does a newly-added numeric constant get added to the consolidated tunable-constants table (§60), or does it risk becoming an orphaned magic number nobody remembers to revisit?
- [ ] Does a new Universe interaction distinguish clearly between "select" (single click, hover-card only, §8.3) and "focus/fly-to" (double-click) — conflating the two would make casual browsing accidentally trigger a camera animation on every click?
- [ ] Does a new chat feature respect the "never auto-send on the user's behalf" rule (§7.9, §33.4) — every cross-mode bridge that seeds a draft must leave it editable and require an explicit send, never fire it automatically?
- [ ] Does any new server-side query or job correctly use the shared, versioned `pyramidVersion`/`gridCell` conventions rather than introducing a parallel, slightly-different spatial-indexing scheme for convenience?

---

## 71. Post-Launch Success Metrics

Distinct from §25 (operational telemetry) and §57 (raw event taxonomy) — this section names the handful of *derived* metrics worth watching in the weeks after launch to judge whether this plan's core product bets actually paid off, so a retro has concrete numbers to look at rather than only anecdotal impressions.

| Metric | Derived from | What it validates |
|---|---|---|
| % of sessions that toggle to Universe mode at least once | `console_mode_toggled` (§57) | Whether the Universe is discovered/tried at all, vs. the toggle going unnoticed |
| % of Universe-mode sessions that toggle *back* to Chat within the same session | `console_mode_toggled` sequences | Whether the two modes are genuinely used as a connected pair (the core product thesis) rather than the Universe being a one-way novelty visit |
| Median session duration in Universe mode, for sessions that use it | `universe_regime_entered` timestamps span | Whether exploration is substantive (minutes) or a fleeting glance (seconds) — a very low median alongside high toggle-into-Universe rates would suggest the experience isn't holding attention despite being tried |
| `chat_tool_search_universe_invoked` → `chat_view_in_universe_clicked` conversion rate | Both from §57 | Whether the citation bridge (§7.9) is actually acted upon when offered, validating that specific cross-mode affordance's value rather than just its existence |
| `universe_ask_in_chat_clicked` rate relative to total node selections | §57 | Whether the reverse bridge (§33.4) is discovered and used, since it's a less obviously-signposted affordance than the header toggle |
| `universe.frame_time_ms` p95 trend over the weeks after launch, segmented by regime | §25.1 | Whether real-world usage patterns (graph sizes, device mix) match Phase 0's spike assumptions, or whether a follow-up performance pass is warranted sooner than expected |
| `onboarding_callout_dismissed` dismissal method split (`interaction` vs. `explicit_close`) | §57 | Whether the lightweight onboarding (§56) is actually being read, or universally interaction-dismissed before being seen — informs whether a slightly more insistent (but still non-blocking) onboarding treatment is worth iterating toward |

None of these are pass/fail gates defined in this plan (that's a product-team call, informed by whatever this feature's actual business goals are, which are outside this document's scope) — they're the specific, derived numbers this plan's own design choices make measurable, offered so a post-launch retro has them ready rather than needing to reverse-engineer what to measure after the fact.

---

## 72. Assumptions Register

Distinct from §24's Open Questions (things explicitly posed *to* the backend/product team for an answer) — this section lists assumptions this plan made silently in order to proceed, so each one is at least visible and challengeable rather than buried in prose where it could be mistaken for a confirmed fact.

| # | Assumption | Where it's load-bearing | If wrong, what changes |
|---|---|---|---|
| A1 | The backend is a separate service from Next.js, not Next.js API routes acting as the sole backend | §2.2, the entire proxy-route architecture (§2.3) | If the backend were actually meant to live inside this same Next.js app (e.g., using route handlers as the real business logic, not a thin proxy), §2's whole framing would need revisiting — though the existing `api-client.ts`'s design strongly supports this assumption already being correct |
| A2 | The graph is (at least initially) single-tenant per account, not a shared/collaborative multi-user graph | Every AQL query's tenant-scoping filter (§15.2, §35.1) | If multi-user collaboration on one shared graph is actually required, the scoping model becomes ACL-based rather than simple tenant-equality, and the LOD pyramid (§10.5) may need to be per-viewer-permission-set rather than globally shared — a materially bigger change, hence flagged as Open Question #1 (§24) as well, not just an assumption |
| A2a | Even in a single-tenant model, one account's graph could plausibly grow into the hundreds-of-thousands-to-millions-of-nodes range this plan's LOD pyramid is designed for, rather than staying small enough that R2/R3's live traversal alone would always suffice | §10.1/ADR-002's entire justification for precomputing a pyramid at all | If per-account graphs are expected to stay small (low thousands of nodes) indefinitely, the LOD pyramid (§10.5) could be deferred well past Phase 4, or even skipped entirely in favor of always-live R2/R3-style queries — directly tied to Open Question #4 (§24) |
| A3 | Node/edge positions are meaningful to precompute and persist (i.e., the graph benefits from a stable spatial layout at all) | The entirety of §10.5's LOD pyramid and ADR-006's server-authoritative-layout decision | If the domain's graph doesn't have a sensible spatial-layout interpretation (e.g., it's better represented as a strict hierarchy/tree with no meaningful "distance" between siblings), the force-directed layout approach may need replacing with a domain-specific layout algorithm — the pyramid/tiling *mechanism* would likely still apply, just fed different input positions |
| A3a | A 3D force-directed layout is a better fit for this product's "universe" metaphor than, say, a fixed geometric arrangement (a sphere shell, a spiral, a literal starmap projection) | §10.5.3 | A deliberately art-directed (rather than physically-simulated) layout is a legitimate alternative worth a design-team conversation — it would replace §10.5.3's force-directed job with a different deterministic placement algorithm, while leaving the rest of §10.5's pyramid/tiering machinery unchanged |
| A4 | v1 is read-only exploration; no in-canvas node/edge editing | §8.3, Risk #10 (§19), Open Question #2 (§24) | Editing would require a real-time conflict-resolution/locking model on top of everything in §10-§11, a materially larger scope this plan explicitly defers |
| A4a | Read-only exploration still implies nodes can be created/edited/deleted through some *other* surface (an admin tool, an ingestion pipeline, another product surface) — the universe just visualizes changes made elsewhere | §11.4's realtime feed's entire premise | If the graph is actually meant to be fully static/immutable post-ingestion, the realtime change feed (§11.4) and its associated fade-in/pulse UX (§8.6) become far lower priority, though still harmless to keep for future-proofing |
| A5 | English is the primary/only launch language | §29 | A multi-language launch would need the ArangoSearch analyzer decision (§10.7) and any UI-copy i18n (§51) revisited before launch, not after |
| A5a | The marketing site (`src/app/(marketing)`) and the console (`src/app/console`) can reasonably share one Next.js deployment/build, rather than needing to be split into separate apps/projects | §5.1's route-group-based structure | If scaling or team-ownership reasons later require splitting them (e.g., into a microfrontends setup), §5's route tree would need restructuring around that split, though the console's internal architecture (§6 onward) would be largely unaffected |
| A6 | The existing `TotpSetup` component and bespoke session-cookie backend represent a deliberate, already-made choice to use custom TOTP MFA rather than a third-party auth vendor | §4's entire auth flow design | If a vendor migration (Clerk/Auth0/etc.) is actually being considered in parallel, §4 would need to be rewritten around that vendor's session/MFA primitives instead — flagged in §0's stated non-goals as explicitly out of this plan's scope to adjudicate |
| A6a | TOTP is the *only* MFA factor this product supports at launch (no SMS/email OTP fallback, no backup codes explicitly designed here) | §4's flow, which assumes a single `mfaLevel: "totp"` value throughout | If backup codes or a fallback factor are required (a common, reasonable account-recovery need), §4.3's `SessionCookiePayload.state` and `Session.mfaLevel` types would need widening, and a recovery-flow route would need adding alongside `/login/verify` |
| A7 | A mid-tier laptop iGPU is a representative target device, not a phone-first or high-end-workstation-first product | §13.1's frame budget, §14.3's degradation tiers | A phone-first product would need §13's budgets tightened substantially and §14.3's degraded-mode fallback promoted from "fallback" to effectively "primary path" for a large share of users |
| A7a | Users primarily explore the Universe with a mouse/trackpad on a desktop-class browser, with touch as a secondary, well-supported but not primary-optimized input mode | §8.3's interaction table, §53's device matrix | A touch-first product would warrant reordering §8.3's interaction priority (touch gestures designed first, mouse/wheel as the derived secondary mapping) rather than the reverse |
| A8 | The backend team can and will build a background job runner capable of the LOD pyramid rebuild cadence described in §10.5.4/§38 | The entire coarse-zoom (R0/R1) experience | If no such infrastructure exists or can be built in the relevant timeframe, Phase 4 (§18) may need to ship with a much smaller `MAX_TIER` (effectively R2/R3-only, coarse zoom simply unavailable) as a scoped-down interim rather than blocking the rest of the product on it |
| A8a | ArangoDB (the specific database named in the brief) is the final, committed choice, not a placeholder for "some graph database" | §10's entire schema/query design | If a different graph database were substituted, §10's AQL-specific syntax would need translating, but the surrounding architecture (grid-cell spatial indexing, materialized LOD pyramid, cursor-based pagination) is a general pattern that transfers to most graph databases with native or emulable equivalents of each primitive used here |
| A9 | Vercel remains the hosting platform for the Next.js frontend for the duration of this build | §2.4's Fluid Compute / AI Gateway framing, §55's header config | The core architecture (proxy pattern, off-tree mounting, floating origin, LOD pyramid) is not actually Vercel-specific and would port to another host with only §2.4/§50/§55's platform-specific details needing rework |
| A9a | The `vercel.json` setting `git.deploymentEnabled: false` reflects a deliberate current choice (e.g., deploys triggered via CI or manual `vercel deploy`) rather than an oversight | §50.3 | If this was actually an oversight, re-enabling git-integrated deployments is a one-line config change unrelated to anything else in this plan |
| A10 | Bun remains this repository's package manager/runtime for scripts (per the existing `bun.lock`) | §50.4's install-flow note, §26.2's mock-backend run script | If the project migrates to npm/pnpm/yarn, only the specific run-script invocations in this plan need updating — no architectural dependency on Bun specifically exists elsewhere in this document |
| A10a | `bun.lock` reflects a genuinely current, installable dependency set today, such that adding this plan's new dependencies (§50.4) on top of it won't itself trigger unrelated resolution conflicts | §50.4 | A stale or conflicted lockfile would need reconciling as its own small piece of work before Phase 1 begins, independent of anything this plan specifies |
| A11 | The existing shared `src/shared/packages/ui` component library is meant to be extended (new icons, reused primitives) rather than bypassed for the console's dark theme | §6.1, §23.3 | If the console is intended to be a fully independent design system with no shared-package dependency, §23.3's icon-sourcing recommendation and any Radix-primitive reuse assumptions elsewhere would need revisiting |
| A11a | The existing `.web.tsx`/`.mobile.tsx` split convention in `src/shared/packages/ui` should be respected by any new shared component this plan adds, not superseded by a web-only pattern | §23.3, §28 | If the mobile/React Native target is being deprioritized or dropped, new console-specific components could reasonably skip the platform-split convention going forward without contradicting this plan's other decisions |
| A12 | "Don't worry too much about the API layer" was scoped to *implementation* freedom, not *contract* freedom — i.e., the brief wanted the frontend architecture fully planned even though the backend's internals are flexible | §2's entire backend-as-a-separate-service framing, §45's proposed OpenAPI reference | If the intent was instead "the API layer doesn't matter enough to plan for at all," §11/§17.5/§45's level of contract detail would have been unnecessary — this plan erred toward more specification here since the frontend's chunking/caching/LOD architecture is genuinely meaningless without at least a proposed contract to build against |
| A13 | "At least 5,000 lines, in full, in one phase" was a request for documentation thoroughness/completeness, not a target to hit via padding | This document's own construction | This plan aimed for genuine section-by-section depth (architecture, code, data models, testing, rollout, risk, glossary) rather than repeating itself — length emerged from covering "every single angle" as requested, not from artificially inflating any one topic |
| A14 | "Search the web and dig deep" meant grounding the plan's technical choices in current (2026), real-world practice for Three.js/R3F, ArangoDB, and chat-UI design, rather than in the author's unverified prior knowledge alone | §21's Research Sources list, §9/§10/§7's technical grounding | This plan's Three.js instancing/LOD guidance, ArangoDB cursor/traversal guidance, and chat-UI scroll/streaming behavior were each checked against current external sources (§21) before being written into the architecture, specifically to avoid stale-training-data mistakes of exactly the kind AGENTS.md warns about for this repo's Next.js version |
| A15 | This repository's `AGENTS.md` instruction to check `node_modules/next/dist/docs` before writing Next.js-facing code applies to *planning* documents like this one, not only to literal code changes | §3's entire section, sourced directly from this repo's installed Next.js docs rather than general training data | Directly verified: `proxy.ts`, `unauthorized.tsx`, and route-groups behavior in §3 were each read from `node_modules/next/dist/docs` in this exact repository before being written into this plan, exactly per that instruction |

---

## 73. How to Propose a Change to This Plan

Since this document is explicitly declared living (§69), a lightweight convention for amending it, so it doesn't silently drift out of sync with the real implementation the way ungoverned design docs typically do:

1. **Numeric constants (§60):** update the value in place in the table, and add a one-line note on what measurement/incident justified the change (e.g., "raised from 5,000 to 7,500 after Phase 0 spike measured jitter onset at ~9,000 units on the target device tier"). Do not delete the prior value from the surrounding prose sections (§9.2.2 etc.) silently — either update both consistently in the same change, or add a forward-reference note ("see §60 for the current tuned value") if leaving the prose section's illustrative number as-is for narrative clarity.
   - Example of a well-formed update: "`REBASE_THRESHOLD`: 5,000 → 8,200 units. Justification: Phase 0 spike (2026-08-14) measured first visible jitter at ~9,600 units on a mid-tier Windows iGPU; 8,200 keeps a ~15% safety margin. See §9.2.2 for the surrounding mechanism this constant governs."
2. **Architecture decisions (§20):** if a decision is reversed or materially revised, add a new ADR (don't edit the old one in place) that explicitly supersedes it, cross-referencing the superseded ADR's number — preserves the historical reasoning trail rather than erasing why the original call was made.
3. **Open Questions (§24) and Assumptions (§72):** move a resolved item's row into a brief note at the bottom of its table (or into §69's Change History) rather than deleting it outright, so "we used to be unsure about X, here's what we learned" remains discoverable.
4. **New scope (features not in this document at all):** should get their own new section rather than being wedged into an existing one whose scope they don't match — this document's section numbering is not sacred; renumbering to keep related content adjacent is preferable to forcing new content into a mismatched existing section purely to avoid a renumber.
5. **Anything touching the Common Pitfalls Checklist (§70):** if implementation experience surfaces a *new* easy-to-repeat mistake not already listed there, add it — that section's value compounds with real usage and should be actively maintained, not treated as fixed at authoring time.
6. **Anything touching the Feature Parity checklist (§63) or the Analogous Systems reference (§66):** these are comparison-based sections whose value depends on staying current with what they're compared against — if Claude.ai's own chat UI changes in some material way this product should track, or a new analogous system becomes a more relevant comparison point, update the comparison rather than letting it quietly become an outdated snapshot of a 2026-era product.

---

## 74. Consolidated Pre-Launch Checklist

A single flat checklist pulling the one or two most critical items out of each phase's Definition of Done (§49), for whoever signs off on the final go/no-go — not a replacement for §49's full per-phase detail, just the fastest possible skim before launch.

- [ ] Phase 0 spike numbers are in and §60's constants table reflects measured, not placeholder, values.
- [ ] `proxy.ts` optimistic checks and the backend's authoritative `verifySession` are both confirmed working independently (neither alone is sufficient security, §4.3/§15.1).
- [ ] MFA lockout is verified to actually lock out and actually recover after `retryAfterMs`.
- [ ] Chat passes the full manual QA script's chat section (§61.2) end to end.
- [ ] Universe passes the full manual QA script's universe section (§61.3) end to end, including the genuine-leaf and context-loss scenarios.
- [ ] Every AQL query touching `nodes`/`edges`/`node_clusters_L*` has the tenant-scoping filter applied first (§15.2, §35.1) — confirmed via code review, not assumed.
- [ ] Every AQL query's `EXPLAIN` output confirms indexed access, not a full collection scan (§16.3).
- [ ] Bundle-size CI gate is active and has been confirmed to actually fail on a deliberate regression, not just passing by default (§16.5, §49 Phase 6).
- [ ] Degraded-mode fallbacks (no WebGL2, reduced motion, low `memoryClass`) have each been manually exercised at least once (§14.3, §61.4).
- [ ] Security review sign-off obtained specifically covering §15.2's tenant scoping and §15.2's WebSocket re-validation.
- [ ] Observability dashboards (§25) are live and have been checked by both frontend and backend teams together at least once before launch, not just configured and left unchecked.
- [ ] Rate limits and lockout thresholds (§41) are confirmed configured in the real production environment, not only in a local/staging config.
- [ ] CSP headers (§55) have been verified in a production-like environment to not silently break worker creation or the WebSocket connection.
- [ ] The rollback/feature-flag path (§27) has been dry-run at least once — flipping `console_universe_enabled` off and confirming the console degrades to chat-only cleanly, without errors.
- [ ] All Open Questions (§24) are either resolved or have an explicit owner and target date, not silently left open past launch.
- [ ] The mode-toggle icon direction (§1.1, §6.2) has been visually confirmed correct by someone other than its original implementer — this specific detail has been called out so many times in this document (§6.2, §33.3, §70) precisely because it's the easiest one-line inversion to ship unnoticed.
- [ ] At least one real end-to-end session (sign up → MFA enroll → log in → verify → chat → toggle to universe → fly to a cited node → toggle back → chat draft intact) has been walked through manually on a production-equivalent environment, not only in local development.
- [ ] The Change History (§69) has an entry for this launch, and the Assumptions Register (§72) has been re-read once to confirm none of its entries were quietly invalidated during implementation without the register being updated.
- [ ] Success metrics (§71) have their instrumentation confirmed live at least 24 hours before launch, so the very first day of real usage is captured, not missed while the dashboards are still being wired up.
- [ ] The `.env.local.example` (§26.0) in the repository matches the real set of environment variables the deployed application actually reads — a stale example file is a common source of onboarding friction for the next engineer to touch this code.
- [ ] The consolidated Feature Parity checklist's two flagged gaps (message editing/regeneration, persistent thread-history list, §63) have an explicit launch decision recorded — either "in scope, shipped," "explicitly deferred to a fast-follow, dated," or "not needed for this product" — rather than being silently absent from launch with no record of the decision.
- [ ] Every item in this checklist has an owner's name or initials recorded next to it in whatever tracking tool this plan's execution actually uses (this document intentionally doesn't prescribe one) — an unowned checklist item is functionally the same as an unchecked one.

## 75. One-Page Quick Reference

For anyone who needs the absolute essentials without reading the rest of this document.

**The one rule most likely to be gotten backwards:** in Chat mode, the header shows a 🌐 Globe icon (inviting you to the Universe); in Universe mode, the header shows a 💬 Chat-bubble icon (inviting you back to Chat). The icon is always the *destination*, never the current state. (§1.1)

**The one Next.js gotcha most likely to bite from stale training data:** this Next.js version calls it `proxy.ts`, not `middleware.ts`. Same job, new name, new file location convention. (§3.1)

**The one technical decision everything else depends on:** "zoom to infinity" is built from two combined techniques — a floating/re-centering camera origin (fixes precision *within* a zoom level) plus four discrete rendering tiers, Cosmos → Nebulae → Constellations → Inspect (fixes the *range* between the most zoomed-out and most zoomed-in views). Neither alone is sufficient. (§8.1, §9.2, ADR-001)

**The one data-architecture decision everything else depends on:** the far-zoomed-out views are never computed live from the graph — they're precomputed, versioned, tiered cluster aggregates, refreshed by a background job, structured like a map-tile pyramid. Only the zoomed-in views query the live graph directly, and even then only within a spatially-bounded, indexed viewport. (§10.1, §10.5, ADR-002/003)

**The one UI-architecture decision everything else depends on:** Chat and Universe are never actually unmounted/remounted when you toggle between them — both stay alive, only their visibility toggles. This is why your chat draft survives switching to the Universe and back, and why the 3D scene doesn't have to rebuild from scratch every time you glance away. (§6.3, ADR-004)

**Where to start building:** §18's Phase 0 — a small, throwaway prototype that measures the real precision/performance numbers this whole plan's thresholds and budgets are currently only estimating. Nothing in Phase 3 (the actual Universe engine) should start before that.

**Where to look when something in this plan seems wrong or outdated:** §69's Change History (has it already been revised?), §60's tunable constants table (is this a known-placeholder number?), §24's Open Questions and §72's Assumptions Register (was this always known to be uncertain?) — check these three before assuming the rest of the document is stale.

**The single sentence version of this entire document:** an MFA-gated console with a Claude-style chat and a genuinely infinite-feeling 3D graph universe, toggled by one header icon that always shows where you're headed rather than where you are, built on a precomputed map-tile-style data pyramid so the "infinite" zoom stays smooth and cheap no matter how large the underlying ArangoDB graph grows.

---

*End of plan. This document should be treated as living — correct §16.4's flagged constants against Phase 0's actual measurements, resolve §24's open questions with the backend/product team before Phase 3, and update the Decision Log (§20) if any ADR is revisited.*

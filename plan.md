# Plan — Routes, Auth UX, Hunt Fixes & Leaderboard Consistency

Investigation completed 2026-07-08. Every issue below was traced to exact
files/lines in the codebase, and the leaderboard diagnosis was verified
against the **production ArangoDB** (read-only, via the same SSH tunnel the
`bun run nodes` script uses). No code has been changed yet — this is the
plan.

---

## 0. Production data findings (read-only prod query, 2026-07-08)

Per-node document counts (prod):

| node | count | | node | count |
|---|---|---|---|---|
| intelligenceFragments | **87** | | users | **14** |
| visitors | 51 | | members | 4 |
| activeVisitors | 154 | | events | 1780 |
| authChallenges | 84 | | paymentCheckouts | 7 |
| processedWebhookEvents | 213 | | superAdmins | 1 |
| products | 4 | | platforms | 1 |
| (all other nodes) | 0 | | | |

Fragment breakdown (the leaderboard smoking gun):

- 87 collect entries total, worth **419,486** fragments (`SUM(f.fragments)`).
- Only **29 entries (206,415 fragments) are "adopted"** (`userId != null`) —
  and they belong to just **2 users**:
  - `Galactic Runner` (oscar.burman@chasacademy.se): **206,407** across 28 entries
  - `Ultrareach Surfer` (ozzodev05@gmail.com): **8** across 1 entry
- **58 entries (213,071 fragments) are anonymous** (`userId == null`),
  spread over 12 explorer ids; **10 explorer ids were never adopted**,
  including one anonymous explorer holding **210,030** fragments (almost
  certainly a second device/browser of an existing user).
- 14 users exist, but only 2 ever had fragments attached.

Conclusions this proves:

1. The board query is **not** a count-vs-sum bug — `listTopCollectors`
   correctly `SUM`s. "Ultrareach Surfer: 8" is a real total (one 8-value
   entry). The board looks wrong because **most collected value never gets
   attached to a user** (anonymous, lossy persistence, or local-only).
2. "You: rank 3, 0 fragments" is exactly `deriveRank(rows, 0)` = 2 rows
   with total > 0, + 1 = 3, with balance 0 because the Next.js in-memory
   ledger reset (serverless cold start).
3. "You: rank 1, 200k+" (the in-list row) is the durable Arango number.
   Two different data sources → two contradictory "you" cards.

---

## 1. Sub-pages for products / capabilities / orchestrators — ALREADY EXIST

**Finding:** every requested route already exists and is statically
generated, registry-driven, with metadata + JSON-LD + sitemap entries:

- `/core`, `/command`, `/studio`, `/launch` → thin wrappers around
  `ProductRoutePage` (`web/app/src/app/core/page.tsx` etc.).
- `/core/[capability]` → `web/app/src/app/core/[capability]/page.tsx`
  (archive, gallery, signal, compass, ascend via `generateStaticParams`).
- `/command/[orchestrator]` → `web/app/src/app/command/[orchestrator]/page.tsx`
  (atlas, hermes, metis, apollo, iris, ledger, orbit, mercury, sentinel,
  athena, forge, themis).
- `/hunt` → `web/app/src/app/hunt/page.tsx` (`<LandingPage initialCave="hunt" />`),
  and `hunt.vorinthex.com` rewrites `/` → `/hunt` via `web/app/src/proxy.ts`.

The reason they feel missing: fixes.md item 13 intentionally stopped the
camera from rewriting the URL while browsing (only direct navigation uses
these URLs). **Action: none required** beyond a smoke-check that each route
renders in the build. Studio/Launch have no children in the registry, so no
nested pages are needed for them today.

**Work item 1.1 (verification only):** `bun run web:build` and confirm all
registry routes render; no code change.

---

## 2. Auth pages: `/auth`, `/auth/join`, `/auth/members` — NEW

**Current state:** sign-in lives at `/signin`
(`web/app/src/app/signin/page.tsx` → `<LandingPage initialCave="signin" />`,
noindex). There is no `/auth*` route. Join and Members Gate caves exist but
have no URLs.

**Fix — three thin pages, same proven pattern:**

| Route | Page | Notes |
|---|---|---|
| `/auth` | `<LandingPage initialCave="signin" />` | sign-in |
| `/auth/join` | `<LandingPage initialCave="join" />` | join flow |
| `/auth/members` | `<LandingPage initialCave="members" />` | members gate (magic link → TOTP → private galaxy) |

- New files: `web/app/src/app/auth/page.tsx`, `auth/join/page.tsx`,
  `auth/members/page.tsx`. Each exports
  `metadata = { robots: { index: false }, title: ... }` (same as `/signin`).
- Convert `/signin` into a **permanent redirect to `/auth`** (Next
  `redirect()` in the page or `permanentRedirect`) so there is one canonical
  auth URL — keeps old links working.
- SEO/AEO checklist (per AGENTS.md): noindex pages → NOT added to
  `sitemap.ts`, no JSON-LD, no llms.txt changes. Nothing else applies.
- Proxy: `proxy.ts` only rewrites `pathname === "/"`, so `/auth/*` cannot
  collide with subdomain routing. No change needed.

**Not in scope (flagged):** `/galaxy/private` is client-trusted
(`localStorage vx_member_email`); a *real* server-side member gate needs a
session cookie + middleware. `api/auth/totp/verify` returns
`{authenticated:true}` without setting any session cookie. Recommend a
follow-up ticket; `/auth/members` in this pass is the cave entry page, same
trust model as today.

---

## 3. Briefing voice auto-plays on any page (e.g. /terms) — BUG

**Root cause (confirmed in code):** the autoplay is by design, and it's
mounted everywhere:

- `web/app/src/components/landing/AudioConductor.tsx:46-48` —
  `useEffect(() => { autoPlayMission(); }, [...])` runs on mount.
  `AudioConductor` is mounted by `LandingPage.tsx:71`, and **every** page
  (`/`, `/terms`, `/privacy`, `/signin`, `/hunt`, product pages…) renders
  `LandingPage`. So visiting `/terms` starts the hunt-briefing voice.
- The "sometimes / delayed" behavior:
  `web/app/src/lib/audio/audio-store.ts:184-193` (`autoPlayMission`) sets
  `missionAutoPending = true` when the browser blocks autoplay, and
  `resumePending()` (`audio-store.ts:249-258`) retries it on the **first
  user gesture** (`AudioConductor.tsx:53-67`, pointerdown/keydown/wheel/
  touchstart/scroll). You land, autoplay is blocked, you scroll into
  /terms → the voice starts "randomly".

**Fix — briefing plays ONLY from the hunt biome's Briefing button:**

1. Delete the autoplay effect (`AudioConductor.tsx:46-48`) and the stale
   doc comment (L10-12 still describes "speaks once on page load").
2. In `audio-store.ts`: delete `autoPlayMission` (L184-193), the
   `missionAutoPlayed`/`missionAutoPending` module flags (L79-81), and the
   mission branch of `resumePending` (L249-255). Keep the ambient-bed
   pending logic — ambient on first gesture is fine and wanted.
3. Keep `toggleMission()` (L157-182) wired to the Briefing button
   (`CaveOverlay.tsx:374-386`) — already correct.

**Acceptance:** load `/`, `/terms`, `/hunt`; scroll/click around — no voice
until the Briefing button inside the hunt is pressed; button still toggles
Stop/Briefing.

---

## 4. Fragment collect modal → auto-collect on click

**Current flow:** clicking a registry crystal only *selects* it
(`web/app/src/components/galaxy/CollectibleField.tsx:94-97,136` →
`select(collectible)`), which opens the `CollectibleTooltip` "modal"
(`web/app/src/components/fragments/FragmentOverlay.tsx:34-135`) with a
"Collect" button that finally calls `collect(selected)`.

**Fix (authed/joined users):**

1. `CollectibleField.handleSelect` (L94-97): if
   `useFragmentsStore.getState().hasJoined` → call `collect(collectible)`
   directly (it already POSTs `/api/fragments/collect` and fires the
   `+N Intelligence Fragments` toast via `applyCollect`,
   `fragments-store.ts:262-317,132-152`). Keep the dissolve animation
   (`CollectibleField.tsx:70-78`) — it keys off `collectedIds`, unaffected.
2. Remove the joined-user "Collect" branch from `CollectibleTooltip`
   (`FragmentOverlay.tsx:77-85`). The tooltip no longer renders for joined
   users at all (collect is instant + toast).
3. Keep `select()` analytics (`landing.fragment_discovered`) by tracking it
   inside the new auto-collect path.
4. Biome floor loot (`BiomeLoot.tsx`) already auto-collects on pointer-down
   — no change.

---

## 5. Unauthenticated fragment pick → Join/Sign-in modal

**Current:** not-joined users clicking a crystal get the tooltip with a
"Join to collect" button and a small "Already on waitlist? Tap here to sign
in" text link (`FragmentOverlay.tsx:86-128`).

**Fix — replace that tooltip block with the hunt-biome pattern:**

- Copy (verbatim, already exists at `CaveOverlay.tsx:476-479`):
  *"New explorer? Join to send your fragments into the hunt. Already
  collecting? Sign in to sync your haul."*
- Buttons: **full-width primary "Join"** + **full-width secondary "Sign
  in"** stacked (`w-full`, sized like the hunt briefing-card buttons —
  primary `px-5 py-3.5 text-xs uppercase`, secondary `px-5 py-3
  text-[0.62rem] uppercase`), no wrapping border box.
- Behavior unchanged underneath: `setPendingCollect(selected)` then
  `enterCave("join")` / `enterCave("signin")` — the pending treasure is
  auto-collected after email submit (`CaveOverlay.tsx JoinFlow.handleSubmit
  :627-653`, `ExplorerSigninFlow` pendingCollect) — this already works,
  keep it.
- **Decision (recommended default):** anonymous biome-floor loot keeps
  collecting silently (it's adopted at sign-in — that pipeline is the
  point). The join/sign-in modal applies to the *registry* crystals users
  deliberately click. If you want the modal on floor loot too, it's the
  same component gated in `collectBiomeLoot` — say the word.

---

## 6. Hunt biome: remove the box around Join/Sign in, full-width buttons

**Current:** `CaveOverlay.tsx:474-503` — wrapper `div` with
`rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3`, buttons
`flex-1` side-by-side, tiny `py-2.5 text-[0.6rem]`.

**Fix:**

- Drop the wrapper's border/background classes (keep only spacing).
- Stack buttons full-width: Join `variant="primary" className="w-full px-5
  py-3.5 text-xs uppercase"`, Sign in `variant="secondary" className="w-full
  px-5 py-3 text-[0.62rem] uppercase"` — identical sizing to the
  Briefing/Return buttons at the top of the hunt (`CaveOverlay.tsx:373-397`).
- Keep the copy paragraph above them.

---

## 7. Lander CTAs: "Join Hunt" + "Sign in"

**Current:** `HeroContent.tsx:44-57` — primary label comes from the
registry: `VORINTHEX_GALAXY_REGISTRY.nexus.content.primaryCta = "Join
Waitlist"` (`registry.ts:62`); secondary is already the literal "Sign in".

**Fix:**

- `registry.ts:62` → `primaryCta: "Join Hunt"` (nexus). Update
  `secondaryCta` (L63, "Already on waitlist? Sign in") → "Sign in" or leave
  (HeroContent doesn't render it — verify no other surface shows it before
  deciding).
- The other entities' `primaryCta: "Join Waitlist"` (registry lines 130,
  206, 284, 349, 438, 499, 560, 621, 682, 767) render in product drawers /
  detail pages — change them all to "Join Hunt" for consistency, plus the
  `"Join Waitlist"` fallback literals in `HeroContent.tsx:49` and
  `DeepLinkDetail.tsx:111`.
- SEO/AEO: registry `content` fields changed → llms.txt/JSON-LD regenerate
  automatically; verify in build.

---

## 8. Header: new Fragment icon for the Hunt button

**Current:** `SiteNav.tsx:101-112` hunt button uses `<AscendIcon size="sm" />`.

**Fix — create a real fragment icon in the shared icon library:**

- New icon `shared/packages/ui/icons/fragment/` following the library
  convention (see `ascend/`): `fragment.web.tsx`, `fragment.mobile.tsx`,
  `index.ts`; 24×24 viewBox, `fill="none"`, `strokeWidth={1.5}` round
  caps/joins, `variant` (`default|inherit|muted|accent|danger|inverse`) and
  `size` (`sm:16 md:20 lg:24`) props, `aria-hidden`.
- Design: a faceted crystal shard — an elongated irregular pentagon with
  1–2 internal facet lines (matches the hunt's crystal loot visuals).
- Register: add export to `shared/packages/ui/icons.ts` barrel + the web
  app shim `web/app/src/components/ui/icons.tsx`.
- Swap into `SiteNav.tsx:107`: `icon={<FragmentIcon size="sm" />}`.

---

## 9. Auth-aware header & lander (Sign out + "Jump Galaxy")

**Current:** no auth context exists. The only auth-reactive control is
`OpenModalButton` (`OpenModalButton.tsx:8-14,48-55`): an authed "Sign in"
click already `startJump("public")`s. `SiteNav` always shows
Join/Sign in/Hunt. **No sign-out exists anywhere** (only a `LogOutIcon` in
the shared library).

**Fix:**

1. **New hook `useAuthProfile()`** (e.g. `web/app/src/lib/auth/use-auth-profile.ts`):
   reads `localStorage vx_profile` on mount (post-hydration, like
   `LeaderboardFlow` does at `CaveOverlay.tsx:349-359`), subscribes to a
   custom `vx-profile-changed` event + `storage` event so all surfaces
   re-render on sign-in/out. Writers of `vx_profile`
   (`CaveOverlay.tsx:1119,1311`, `ArrivalJump.tsx:57,94`,
   `handoff-client.ts:53`) dispatch the event.
2. **Header (`SiteNav.tsx`), authed state:**
   - hide Join + Sign in;
   - primary CTA **"Jump Galaxy"** → `startJump("public")` (reuse the
     `OpenModalButton` jump path / `galaxy-store.ts:365`);
   - keep Hunt button (with new FragmentIcon);
   - add secondary **"Sign out"** button (`LogOutIcon`), header only.
   Unauthed state: exactly today's Join/Sign in/Hunt.
3. **Lander (`HeroContent.tsx`), authed state:** primary becomes
   **"Jump Galaxy"** (`startJump("public")`), and the Join/Sign-in buttons
   are not rendered. Unauthed: "Join Hunt" + "Sign in" (item 7).
4. **Hunt biome:** already auth-aware (standing card vs join box) — no
   extra change beyond item 6.
5. **Sign out implementation:**
   - New route `POST /api/auth/signout`: expire `vorinthex_access` +
     handoff cookies (`clearHandoffCookies` pattern,
     `web/app/src/lib/auth/handoff-cookies.ts:42-45`). **Keep
     `vx_explorer`** — it's the device's anonymous collecting identity;
     clearing it would orphan future anonymous fragments.
   - Client `signOut()`: call the route, remove `vx_profile`,
     `vx_member_email`, `vx_joined` from localStorage, reset
     `useFragmentsStore` balance/hasJoined, dispatch `vx-profile-changed`,
     land back at overview (no jump).

---

## 10. Preload the fragment jar before the hyperjump lands

**Current:** `JumpOverlay.tsx` white-outs for `JUMP_DURATION_MS = 1600`
then `router.replace("/galaxy/public")`; `PublicGalaxy.tsx:27-60` only
starts fetching `GET /api/fragments/globe` in a mount effect → empty jar
for ~1s, then it fills.

**Fix — fetch during the 1600 ms jump window:**

1. New tiny module `web/app/src/lib/fragments/globe-preload.ts`:
   `preloadGlobe()` stores a module-level `Promise` of
   `fetch("/api/fragments/globe").then(r => r.json())`;
   `consumeGlobePreload()` returns-and-clears it (with a freshness guard,
   e.g. ≤15 s old).
2. Call `preloadGlobe()` where the jump starts: in `JumpOverlay` when a
   `"public"` jump begins (covers ALL jump paths — header CTA, authed
   sign-in click, arrival flows) + `router.prefetch("/galaxy/public")`.
3. `PublicGalaxy` mount effect: `await (consumeGlobePreload() ?? fetch(...))`
   — jar renders full on first paint after the jump.

---

## 11. Lander title/CTAs fade while the solar system spins

**Current:** rotation velocity lives outside React in the mutable
`galaxyMotion` object (`galaxy-store.ts:120-138` — `orbitVelocity` set by
drag flicks in `UniverseStage.tsx:225-241`, damped each frame in
`CameraRig.tsx:230-241`). `HeroContent` already has an opacity fade, but
only keyed to `atOverview` (`HeroContent.tsx:24-28`).

**Fix — rAF-driven opacity, no per-frame React renders (repo convention):**

1. In `HeroContent`, add a `ref` on the fading wrapper and a
   `requestAnimationFrame` loop (client effect) that reads
   `Math.abs(galaxyMotion.orbitVelocity)` (+ treat `galaxyMotion.dragging`
   as "spinning") and writes `ref.current.style.opacity` directly.
2. Curve: `target = clamp01(1 - (|v| - V0) / (V1 - V0))` with e.g.
   `V0 = 0.15` rad/s (start fading) and `V1 = 0.9` rad/s (fully hidden),
   then smooth with exponential damping (`opacity += (target - opacity) *
   (1 - exp(-k*dt))`, `k ≈ 4`) so it *slowly* fades back in as
   `CameraRig`'s `THREE.MathUtils.damp(orbitVelocity, 0, 1.3, delta)` decays
   — the fade-in naturally trails the spin-down. Reference for the curve:
   `SpinRig.tsx:90-95` (streak reveal uses the same signals).
3. Also toggle `pointer-events: none` while faded (< 0.4) so invisible
   buttons can't be clicked. Multiply with the existing `atOverview` fade
   (don't fight it — apply rotation fade on the inner container or combine
   opacities).
4. Scope: HeroContent title + CTA row (the user's ask). SiteNav stays
   visible.

---

## 12. Leaderboard consistency — THE CRITICAL FIX

### What prod proves (section 0)

The board's AQL is already `SUM`-correct (`listTopCollectors`,
`backend/src/lib/db/intelligence-fragments.node.ts:112-128`). The chaos
comes from **three unsynchronized ledgers** shown on one screen:

| Surface | Source | Failure mode |
|---|---|---|
| Board rows (`row.total`) | Arango SUM over `userId != null` only | invisible until fragments are adopted; most value is anonymous (213k of 419k) |
| "You" card balance | Next.js **in-memory** ledger (`fragments-server.ts:28-33`, TODO says replace) + localStorage loose rocks + optimistic biome credits | resets to 0 on every serverless cold start; ignores the signed-in user entirely (explorer-cookie only) |
| "You" card rank | `deriveRank(rows, balance)` client-side vs the top-14 rows (`leaderboard-store.ts:53-58`) | rank 3 = "2 rows + 1" whenever local balance collapses |

Plus two persistence leaks that keep real value out of Arango:
- Loose asteroid rocks are localStorage-only, never POSTed
  (`fragments-store.ts:240-260`).
- `/api/fragments/collect` returns early when the volatile in-memory ledger
  rejects (200 ms cooldown 429 / replayed-id 409) **before** persisting to
  the backend (`collect/route.ts:71-99` vs backend persist at L106-125),
  and the client keeps its optimistic credit anyway
  (`fragments-store.ts:224-237`).

### Fix (backend first, then web)

**12.1 One authoritative "standing" endpoint (backend).**
Expose the existing digest query `getUserFragmentPlace(userId)`
(`intelligence-fragments.node.ts:153-183`) over HTTP:
`GET /fragments/standing?explorer_id=...` (API-key + rate-limited like the
rest, Zod strict). Resolve the caller via session/`email_hash`/explorer id
exactly like `GET /fragments/summary` (`backend/src/api/fragments.ts:129-151`)
and return `{ total, rank, entries }` where **total and rank come from the
same COLLECT/SUM family as `listTopCollectors`** — one query epoch, so the
list and the you-card can never structurally disagree. Include the user's
not-yet-adopted explorer entries in *total* only if we also include them in
the board (see 12.4) — same rule on both sides, whichever is chosen.

**12.2 Kill the in-memory Next.js ledger as a source of truth (web).**
- `/api/fragments/progress` → proxy backend (`/fragments/summary` +
  `/fragments/standing`) instead of `getProgress()`'s in-memory Map. The
  in-memory ledger stays only as a same-instance rapid-click debounce, and
  its rejections must **no longer skip backend persistence**: let the
  backend's unique `(explorerId, collectibleId)` index be the dedupe
  authority (`arango-migrate.ts:184-197`); treat its 409 as success-idempotent.
- Client balance = server truth + local loose rocks (until 12.3):
  `hydrateProgress` (`fragments-store.ts:154-183`) keeps its shape but the
  numbers now survive restarts.

**12.3 Stop losing value.**
- Persist loose rocks: `collectLoose` (`fragments-store.ts:240-260`) POSTs
  them as procedural loot (kind `fragment`, value 1-3 fits existing
  `LOOT_BOUNDS`) so every fragment reaches Arango.
- Optimistic biome credit reconciles: on a failed/409 persist, don't
  double-count — simplest is to re-run `hydrateProgress()` after each
  collect burst (debounced), since balance now comes from the server.

**12.4 One data path for both "you" surfaces (web).**
- `leaderboard-store` drops `deriveRank` (L53-58); `myRank` + `myTotal`
  come from `/api/fragments/standing` (fetched on hunt open + refreshed on
  SSE `updateNonce` changes).
- The standing card (`CaveOverlay.tsx:457-473`) renders `myTotal`
  (server), not `useFragmentsStore.balance`.
- In-list "you" highlight matches by `userId` (returned in standing), not
  by alias string compare (`CaveOverlay.tsx:427`).
- **Board scope decision (recommended):** keep the board signed-in-only
  (anonymous rows would all be "Unnamed Explorer" — meaningless), but the
  hunt copy already pushes join/sign-in to "send your fragments into the
  hunt". With 12.2/12.3 + adoption-on-signin (commit dc050b8) the anonymous
  213k gets adopted the next time those explorers sign in on their device.
- Delete the hardcoded demo board fallback in
  `web/app/src/app/api/leaderboard/stream/route.ts:33-44` for configured
  environments (keep it dev-only) — it can masquerade as real data.

**12.5 Acceptance.**
- Cold-start a fresh instance: signed-in you-card shows Arango rank+total
  (206,407 / #1 for Galactic Runner) — never 0 / #3.
- The in-list "You" row and the standing card show identical rank+total.
- Collect a loose rock + a biome crystal, reload: totals unchanged
  (persisted, deduped).
- Anonymous device signs in → its haul appears on the board (adoption) —
  verify with the prod stats script pattern if needed.

---

## 13. Presence funnel split: `visitorSessions` + `userSessions` migration

### Current model (traced)

- `visitors` (`backend/src/lib/db/visitors.node.ts`): one node per distinct
  explorer, keyed by `emailHash` (authed/known) **or** `distinctId`
  (anonymous cookie). Carries `userId` (linked on auth/join, L24) — so the
  anonymous and authed funnels are mixed in one collection.
- `activeVisitors` (`backend/src/lib/db/active-visitors.node.ts`): one node
  per presence session (any visitor, authed or not), carries `emailHash`
  (L21), `visitorId`, `sessionKey`, `connectedAt`/`disconnectedAt`.
- Presence flow (`backend/src/api/presence.ts`): Redis is live truth (TTL
  session keys + `presence:events` pub/sub channel, one SUBSCRIBE per
  instance fanning out to SSE); Arango is the durable ledger; a sweeper
  closes sessions whose Redis key expired. `resolvePresenceVisitor`
  (L128-186) prefers the access token's user and back-links
  `userId`/`emailHash`/alias onto the visitor doc (L172-177).
- Consumers: `joinPresence`/`leavePresence`/`sweepStaleSessions`
  (presence.ts), `countOpenActiveVisitors` → `active_explorers` in the
  leaderboard SSE payload (`backend/src/api/leaderboard.ts:40`),
  `linkVisitorToUser` at signup (`backend/src/api/users.ts:37-50`, carries
  the visitor's alias into `users`), `NODE_REGISTRY`
  (`backend/src/lib/db/registry.ts:49,71`), migration specs
  (`arango-migrate.ts:167-183`).

### Target model — two clean funnels, same pub/sub

Repo collections are camelCase, so `visitor_sessions`/`user_sessions` land
as **`visitorSessions`** and **`userSessions`**:

| Collection | Who | Shape |
|---|---|---|
| `visitors` | anonymous only | drops `userId` + `emailHash`; keyed by `distinctId`; keeps alias/lastSeenAt |
| `visitorSessions` (renamed `activeVisitors`) | anonymous sessions | drops `emailHash`; keeps `visitorId`, `sessionKey`, `connectedAt`/`disconnectedAt` |
| `userSessions` (new) | authed sessions | `{ key, platformId, userId, alias, sessionKey, connectedAt, disconnectedAt, createdAt, updatedAt, embedding: [] }` — **a new entry per session**, like visitorSessions |

Indexes: `visitorSessions` keeps activeVisitors' set (`visitorId`,
`sessionKey` unique, `disconnectedAt`, `platformId+connectedAt`);
`userSessions` gets `userId`, `sessionKey` unique, `disconnectedAt`,
`platformId+connectedAt`, `userId+connectedAt`.

### Code changes (backend)

1. **Node files**: rename `active-visitors.node.ts` →
   `visitor-sessions.node.ts` (collection `visitorSessions`, schema minus
   `emailHash`); new `user-sessions.node.ts` mirroring it (`userId` instead
   of `visitorId`, `countOpenUserSessions`, `listOpenUserSessions`,
   `markUserSessionDisconnected`).
2. **`presence.ts`** — branch at join, one pub/sub for both funnels:
   - `joinPresence`: if `getUserId(c)` resolves → **skip visitor resolution
     entirely**, insert a `userSessions` entry (alias from the `users` doc);
     else → today's `resolvePresenceVisitor` (now distinctId-only, no
     userId/emailHash enrichment) + a `visitorSessions` entry.
   - `SessionRecord` in Redis gains a funnel tag (`t: 'user' | 'visitor'`)
     so `leavePresence` and the sweeper stamp `disconnectedAt` in the right
     collection. Sweeper iterates both open lists.
   - The pub/sub stays exactly one channel (`presence:events`) with the same
     join/move/leave events — stars render identically regardless of funnel
     (optionally include `t` in the event for future styling).
3. **`resolvePresenceVisitor`**: delete the userId/emailHash lookup and
   back-linking (presence.ts:130-143,173-177) — visitors are anonymous by
   definition now.
4. **`users.ts` `linkVisitorToUser`**: keep the alias carry-over at signup
   (find visitor by `distinctId` at the conversion moment, copy alias into
   the new user) but stop writing `userId`/`emailHash` onto the visitor;
   `getVisitorByEmailHash` is deleted with the field.
5. **`leaderboard.ts:40`**: `active_explorers` =
   `countOpenVisitorSessions() + countOpenUserSessions()`.
6. **`NODE_REGISTRY`** (`registry.ts`): remove `activeVisitors`, add
   `visitorSessions` + `userSessions` (they then appear in `bun run nodes`
   and `GET /api/v1/nodes` automatically).
7. Tests: update `visitors.node.test.ts`; add funnel-routing tests
   (authed join → userSessions entry, anonymous join → visitorSessions,
   sweeper closes both).

### Data migration (`arango-migrate.ts`, idempotent like the rest)

1. Add `visitorSessions` + `userSessions` to the `collections` spec with
   the indexes above; migrate-create runs on deploy as usual.
2. **Backfill — partition old `activeVisitors` (prod: 154 docs)**: for each
   doc, resolve its identity: parent visitor's `userId`, else
   `doc.emailHash` → `users.emailHash` lookup. If a user is found → copy
   into `userSessions` (same `_key`, `sessionKey`, timestamps; `userId` set,
   `emailHash` dropped); else → copy into `visitorSessions` (same fields,
   `emailHash` dropped). Use `overwriteMode: 'ignore'` so reruns are no-ops.
3. Drop `activeVisitors` after the copy (add to `droppedCollections` — the
   drop only fires once the copy loop has completed in the same run).
4. **Scrub `visitors`**: `UPDATE v WITH { userId: null, emailHash: null }
   OPTIONS { keepNull: false }` for docs having either field; add
   `visitors: [['emailHash'], ['userId']]` to `legacyIndexesToDrop` and
   remove them from the visitors index spec (keep `distinctId` unique
   sparse + `platformId`).
5. Guard: any open Redis presence sessions at deploy time reference
   activeVisitor keys via `SessionRecord.k` — the migrated docs keep their
   `_key`s, and the new sweeper/leave code looks in both new collections, so
   in-flight sessions close cleanly (worst case the sweeper stamps them on
   its next 30 s pass).

### Acceptance

- Anonymous visit → new `visitors` doc (no userId/emailHash anywhere) +
  `visitorSessions` entry per session.
- Authed visit → `userSessions` entry per session, **no visitors write**.
- Presence stars/SSE unchanged for both funnels (one pub/sub channel).
- After migrate on prod: `activeVisitors` gone; every old session with a
  resolvable user sits in `userSessions` with its `userId`; the rest in
  `visitorSessions`; no `visitors` doc retains `userId`/`emailHash`.
- `active_explorers` count equals the sum of both open-session counts.

---

## 14. Execution order

1. **Leaderboard backend** (12.1) → **web data path** (12.2-12.4) — the
   critical user-facing bug.
2. Briefing autoplay removal (3) — tiny, high annoyance.
3. Collect UX (4, 5, 6) — one PR, all in the fragment/cave components.
4. Header/lander auth pass (7, 8, 9) — icon, labels, auth hook, sign-out,
   Jump Galaxy.
5. Jar preload (10) + rotation fade (11).
6. Presence funnel split + migration (13) — backend-only, independent of
   the UI passes; ship behind its own PR since it touches the deploy-time
   migration.
7. Auth routes (2) + route smoke-check (1).

Each PR: `bun run web:lint && bun run web:typecheck && bun run web:build`,
`bun run backend:check && bun run backend:test` for backend changes; add
tests for the new standing endpoint (same-query consistency) and the
collect-persistence path; verify `/llms.txt`, `/sitemap.xml`, `/robots.txt`
after the registry CTA change.

## 15. Open decisions (defaults chosen, flag if you disagree)

1. **Anonymous floor loot** keeps collecting silently for unauthed users
   (modal only on deliberate registry-crystal clicks) — item 5.
2. **Board stays signed-in-only**; anonymous value surfaces via adoption —
   item 12.4.
3. **`/signin` 308-redirects to `/auth`** (keep old links) — item 2.
4. **Sign out keeps `vx_explorer`** (device collecting identity) and only
   clears session/profile — item 9.
5. **Session collection names are camelCase** (`visitorSessions`,
   `userSessions`) matching every other collection — item 13.
6. **Old `visitors` docs are kept** (scrubbed to anonymous shape) rather
   than deleted, preserving alias/lastSeenAt history — item 13.

---
---

# PART II — Infrastructure Migration Master Plan (AWS ECS on EC2)

> Scope note: this Part is a **blueprint only**. It changes no code, no
> Terraform, no workflows, no AWS resources. It is written to be handed to
> senior AWS Solutions Architects for review before any implementation.
> Every recommendation is justified from what is actually in the repo today
> (audited file-by-file: all Terraform modules, both GitHub workflows, every
> Dockerfile/compose file, the backend runtime, and the web app's hosting
> coupling). Where the repo contradicts its own docs, the code wins and the
> drift is called out.

## A. Executive summary

**Where we are.** Vorinthex is a Bun monorepo with three deployable
surfaces: (1) one Next.js 16 app (`web/app`) deployed as **prebuilt
`vercel deploy` to three Vercel projects** (vorinthex/orbit/hunt) that serve
the same app on different domains, with hostname routing done in-app by
`web/app/src/proxy.ts`; (2) a **Bun/Hono backend** (`backend`) running as
blue-green Docker Compose behind Caddy on a **single `t3.small` EC2 host**,
deployed over SSH from GitHub runners; (3) a **stub render worker** wired to
an existing **ECS/Fargate** service (`vorinthex-production` cluster,
`vorinthex-render` service) that currently runs a no-op. Data lives in
**self-hosted ArangoDB 3.12** on a second single `t3.small` EC2 host (data on
a 30 GiB EBS volume), plus **ElastiCache Redis** (single `cache.t4g.micro`,
no failover, no snapshots) and one private S3 bucket. Region **eu-north-1**.
Terraform (AWS provider 5.100, state in S3 `vorinthex-ai-terraform-state`
with native locking) owns the boxes and network; it does **not** own the app
containers or (in practice) the render task definitions.

**Target.** The requested edge-to-container path —
`Cloudflare → CloudFront → ALB → ECS(EC2) → ASG → Docker → AWS services` —
for **both** the web app and the backend, with ArangoDB moved private and
made durable, Redis made HA, secrets kept in SSM/Secrets Manager, and a
modern GitHub Actions → ECR → Terraform-plan/approve/apply → ECS rolling
pipeline replacing the SSH/Vercel machinery.

**Why it's very achievable.** The hard parts already exist: an ECR repo
(`vorinthex-backend`), OIDC deploy roles (`vorinthex-backend-deploy`,
`vorinthex-ai-infra`, account `938565868704`), a buildx+GHA-cache image
build, an ECS cluster, the `/vorinthex/prod/*` SSM secret contract, and a
task/execution role split. The web app is **barely coupled to Vercel** (no
`vercel.json`, no ISR, no Edge runtime, no `@vercel/*` packages, one
`unoptimized` image) so it self-hosts as standalone Next with essentially
zero code change. `proxy.ts` already routes all domains from one process, so
**one image + one ECS service serves all three domains**.

**Top risks to retire during migration (all pre-existing, not introduced by the move):**
1. Every tier is a **single point of failure** — one app EC2, one Arango EC2,
   one Redis node (no failover/snapshots), one NAT.
2. **No database backups** anywhere (only EBS persistence + S3 versioning).
3. **SSH open to `0.0.0.0/0` by default** on both public-subnet EC2 hosts;
   ArangoDB host has a **public EIP**.
4. **No pre-merge CI** — lint/typecheck/tests run only *after* merge; `main`
   has no branch protection; migrations run irreversibly before rollout with
   no rollback and no pre-migrate backup.
5. **Instance-local state** in two places (`web/app` fragments ledger,
   backend `liveBus`) that must be pinned or moved before scaling replicas.

The migration is best sequenced so each of these is fixed *as* the tier moves
to ECS, not deferred.

---

## B. Phase 1 — Repository & architecture audit (current state)

### B.1 Monorepo layout
```
platform/
  web/app/          Next.js 16.2.9 + React 19 + Tailwind v4, R3F galaxy UI (the only web app)
  backend/          Bun + Hono API ("app" role) + render-worker stub ("render" role)
  shared/           @vorinthex/shared — raw-TS workspace pkg (UI, icons, brand email templates)
  scripts/          image|audio|video — local dev-only asset generators (NOT in prod)
  environments/     per-surface .env (git-crypt for .dev/.prod) + config sync tooling
  terraform/        modules/ + environments/production/ (S3 remote state)
  .github/          workflows/{deploy.yml (1203L), infra.yml (129L)} + .configs/
```
Bun workspaces linked `--hoisted`; a single root `node_modules`. `shared` is
consumed as TypeScript source via `transpilePackages` (no build step).

### B.2 Component → responsibility map

| Concern | Implementation | Location |
|---|---|---|
| Frontend | Next 16 app, 36 prerendered routes + 2 trivial SSR, 62 client comps, R3F canvas | `web/app` |
| API | Hono on `Bun.serve`, `/api/v1/*`, port 3001 | `backend/src/api` |
| Auth | Access/refresh cookies, magic link, TOTP, cross-device handoff | `backend/src/api/{auth,auth-handoff}.ts` |
| Realtime | 4 SSE stream types (live, leaderboard, presence, handoff) | backend + web proxy routes |
| Presence | Redis TTL sessions + pub/sub `presence:events` + 30s Arango sweeper | `backend/src/api/presence.ts` |
| Cron/background | Leaderboard daily digest (hourly `setInterval` + Redis day-lock) | `backend/src/platform/leaderboard-digest.ts` |
| Queue/workers | **Not implemented** — render worker + dispatch are stubs, no queue consumer exists | `backend/src/render-worker`, `dispatch-fargate-render.ts` |
| Database | ArangoDB 3.12 (graph/document), root auth, single node | EC2 graph-db host |
| Cache/coord | ElastiCache Redis 7.1 (rate-limit, presence, pub/sub, digest lock) | `terraform/modules/cache` |
| Object storage | S3 (render outputs) via `@aws-sdk/client-s3` | `backend/src/lib/s3.ts` |
| Email | nodemailer SMTP (likely Resend SMTP) + Resend webhooks via svix | `backend/src/api/{email,resend}.ts` |
| Payments | Polar (raw fetch + signed webhooks) | `backend/src/lib/polar.ts` |
| AI providers | Anthropic/OpenAI/Grok/Perplexity/Google | `backend/src/core/ai-providers.ts` |
| Embeddings | **deterministic stub** (no network) | `backend/src/core/actions/embed.ts` |

### B.3 Current deployment flow (what actually happens on merge to `main`)
`deploy.yml` "Unified Deploy", trigger = **PR closed+merged** (or manual):
`changes` (path-filter) → `sync-configs` (pipeline writes repo Variables to
itself via `GH_PAT`) → 4 `verify-*` jobs (lint/typecheck/test — **post-merge
only**) → **web fan** (3 near-identical jobs: strip docs, hoist `node_modules`
into `web/app/node_modules` *and* `web/app/web/app/node_modules` for Vercel
NFT tracing, push env to Vercel via REST per-key, `vercel build --prod` +
`vercel deploy --prebuilt` on the runner, curl-until-200 on the domain) **and
backend fan** (CONFIG.env → SSM SecureStrings ∥ Docker build → ECR
`:sha`+`:latest` → scp compose+`.env` to Arango box + `docker compose up` →
SSH-tunnel `arango-migrate` + `seed` + `polar:sync` from the runner → app
blue-green via `deploy-app.sh` (SSM self-heals `authorized_keys`, scp,
Caddyfile rewrite + reload) → register new render task-def revision +
`ecs update-service`). Happy path ~5–8 min; observed hangs of 56m–1h40m when
the SSH tunnel or a Redis client stalled.

---

## C. Phase 2–3 — Current infrastructure & AWS resource inventory + verdicts

IaC is **Terraform only** (no CDK/Pulumi/CloudFormation/Terragrunt). Provider
`aws ~> 5.84` (locked 5.100.0), `random`, `tls`; `required_version >= 1.10`;
single `eu-north-1` region, single `production` workspace/dir, **S3 native
locking** (no DynamoDB). Verdicts below drive Parts D–G.

| Service / resource | Current config | Verdict for target |
|---|---|---|
| **EC2 app host** | 1× `t3.small`, AL2023 (unpinned latest AMI), **public subnet + EIP**, gp3 30 GiB encrypted, Docker Compose + Caddy blue-green, SSH deploy | **Replace** → ECS service on an EC2 ASG behind ALB (capacity provider) |
| **EC2 graph-db host** | 1× `t3.small`, **public subnet + EIP**, separate 30 GiB gp3 EBS at `/data/arangodb`, Arango 3.12 container, no IAM role, no backups | **Keep as a fixed standalone host — NOT in the ASG / never autoscaled**; harden → move private, add snapshots/`arangodump`; vertical scaling via GitHub var only (see G.1/G.4) |
| **ElastiCache Redis** | 1× `cache.t4g.micro`, 7.1, TLS+at-rest, **no failover, no snapshots, no AUTH** | **Keep, upgrade** → 2-node Multi-AZ + snapshots + AUTH token |
| **ECS cluster** | `vorinthex-production`, Container Insights on | **Keep & expand** → add app + backend services, EC2 capacity providers |
| **ECS render service** | Fargate **SPOT**, 1024/2048, desired 1, worker is a **no-op stub** (crash-loops if essential) | **Rework** → real queue consumer or set to 0 until implemented; move to EC2 capacity provider |
| **ECR** | `vorinthex-backend`, MUTABLE, scan-on-push, **no lifecycle policy**, created by both TF and CI | **Keep, fix** → add `vorinthex-web` repo, immutable tags, lifecycle expiry, single owner (TF) |
| **S3 runtime bucket** | private, SSE-S3, versioning on, **no lifecycle** | **Keep, add** lifecycle + (optional) CloudFront OAC for public web assets separate bucket |
| **S3 TF state** | `vorinthex-ai-terraform-state`, native lock, `encrypt` not forced | **Keep, force** `encrypt=true`, bring under IaC/versioning+SSE |
| **SSM Parameter Store** | `/vorinthex/prod/*` SecureString, default KMS | **Keep** (it's the secret contract) — optionally split high-value secrets to Secrets Manager for rotation |
| **IAM** | OIDC roles for infra+deploy; task/execution split; **`kms:Decrypt` on `*`**, static AWS keys injected into render task | **Keep pattern, tighten** least-privilege; drop static keys (task role suffices) |
| **VPC** | `10.42.0.0/16`, 2 public + 2 private /24, **single NAT**, 4 SGs | **Keep, expand** → per-tier SGs for ALB/ECS/DB/cache; consider 2 NATs at scale |
| **Route53 / ACM / ALB / CloudFront / WAF / Secrets Manager / RDS** | **None exist** (TLS is Caddy-on-host; DNS external; `IMPLEMENTATION_SUMMARY.md` references a deleted RDS module — stale) | **Add** ACM certs, ALB, CloudFront, WAF; Route53 optional (Cloudflare may own DNS) |
| **Backups / DR** | none (EBS + S3 versioning only) | **Add** EBS DLM snapshots, Arango dumps to S3, ElastiCache snapshots |
| **Observability** | 1 log group, Container Insights; **zero alarms/dashboards** | **Add** alarms, dashboards, tracing |

Dependency graph (current):
```
Cloudflare/DNS ─▶ EIP:app EC2 ─▶ Caddy ─▶ app-blue/green ─┬─▶ Arango EC2 (private IP :8529, plain HTTP, root)
   (web → 3 Vercel projects, separate)                     └─▶ ElastiCache Redis (rediss://, no auth)
GitHub Actions ─(OIDC)─▶ ECR, SSM, ECS(render); ─(SSH)─▶ app EC2 & Arango EC2
Terraform ─(OIDC)─▶ VPC/EC2/EIP/ElastiCache/ECS/ECR/S3/SSM ; state in S3
```

---

## D. Phase 10 — Target network & edge architecture

```
                    ┌────────────── Cloudflare (DNS, proxied, WAF/L7, bot mgmt) ──────────────┐
                    │  vorinthex.com, www, orbit.*, hunt.*, atlas.* … , api.vorinthex.com     │
                    └───────────────────────────────┬────────────────────────────────────────┘
                                                     ▼
                           CloudFront (TLS via ACM, cache _next/static + /public, Host-forwarded)
                              │  default behavior → web origin        │  /api/* (no-cache, no-buffer, all-headers) 
                              ▼                                        ▼
                    ┌──────────────── Application Load Balancer (public subnets, ACM cert) ────────────────┐
                    │  Host/path routing:  web target group  (Next standalone :3000)                        │
                    │                       api target group  (Hono :3001, /api/* , SSE-tuned idle 300s)     │
                    └───────────────────────────────┬─────────────────────────────┬────────────────────────┘
                                                     ▼                             ▼
                              ECS service: web (EC2 ASG, private subnets)   ECS service: api (EC2 ASG, private)
                                                     │                             │
                                                     └──────────────┬──────────────┘
                                       ┌────────────────────────────┼───────────────────────────┐
                                       ▼                            ▼                            ▼
                            ArangoDB (private subnet,     ElastiCache Redis (Multi-AZ,      S3 (runtime + web-assets),
                            EBS + snapshots, no EIP)      AUTH, snapshots)                  SSM/Secrets Manager, SES/SMTP
```

**Design decisions & justification:**
- **Cloudflare in front of CloudFront**: Cloudflare owns DNS + edge WAF/bot
  mitigation/rate-limit (cheap, already the likely DNS owner given
  `api.vorinthex.com`), CloudFront gives AWS-native origin shielding, ACM
  certs, and fine-grained cache behaviors close to the ALB. Use an
  authenticated origin pull (Cloudflare → CloudFront custom header / OAC) so
  the ALB only trusts CloudFront. *Justification:* the app is highly static
  (12 MB immutable public assets + `_next/static`), so a real CDN tier is
  high-value; two CDNs is only worth it because Cloudflare already fronts DNS
  — if it doesn't, collapse to CloudFront-only.
- **Single ALB, two target groups (web + api)** by host/path. `api.*` and
  `/api/*` route to the Hono service; everything else to the Next service.
  *Justification:* one ALB is cheaper and simpler than two; the two services
  have different health checks (`/` vs `/api/v1/health`) and idle timeouts.
- **SSE correctness (critical):** ALB **idle timeout ≥ 300s** on the api
  target group (backend heartbeats every 25s; presence/leaderboard streams
  are long-lived), and CloudFront `/api/*` behavior = **no caching, no
  buffering, forward all headers + cookies** (Host forwarding is mandatory
  for `proxy.ts` hostname routing and for the SSE pass-through in
  `web/app/src/lib/backend.ts` `backendStream()`). Consider letting `/api/*`
  bypass CloudFront straight to the ALB to avoid any buffering surprises.
- **Everything compute + data private.** ECS tasks, ArangoDB, and Redis move
  to **private subnets**; only the ALB is public. This retires the
  public-EIP-on-database risk. Deploys stop using SSH entirely (ECS rolling
  update + SSM Session Manager for break-glass access).
- **NAT:** keep single NAT for cost at low scale; add a second (one per AZ)
  at the 10k-user tier so an AZ loss doesn't cut private egress (LLM/Polar/
  SES calls). VPC keeps `10.42.0.0/16`; add dedicated SGs: `alb-sg` (443 from
  CloudFront/Cloudflare ranges), `web-sg`/`api-sg` (from alb-sg only),
  `db-sg` (8529 from api-sg + migration task SG), `cache-sg` (6379 from
  api-sg). Add **VPC endpoints** (ECR api+dkr, S3 gateway, SSM, CloudWatch
  Logs) so image pulls/secret fetches/logs don't traverse NAT — meaningful
  cost + reliability win at scale.

---

## E. Phase 4 & 15 — Docker & ARM strategy

### E.1 Backend image (`backend/deploy/Dockerfile`)
- `oven/bun:1-slim`, multi-stage (`base`→`deps`→`runtime`), `USER bun`,
  `EXPOSE 3001`, HEALTHCHECK on `/api/v1/health`, Bun runs TS directly (no
  build). `deps` uses a BuildKit cache mount + lockfile-only invalidation —
  **good layer caching already**. GHA `type=gha,mode=max` cache in CI.
- **Size driver = `ffmpeg` + headless-Chromium apt libs + `@sparticuz/chromium`**
  (for `render-post.ts` video/screenshot path). Likely 1–1.5 GB image.
  *Recommendation:* split the **render** role into its **own slimmer image**
  only if/when the render worker is actually implemented — the `api` role
  doesn't need ffmpeg/Chromium at all, so an `api`-only image (drop the apt
  Chromium/ffmpeg block) would shrink the app tier dramatically and speed
  pulls/scale-out. Today both roles share one image; keep that until render
  is real, then split.

### E.2 Web image (new)
Add `web/app/Dockerfile` (multi-stage): builder runs `bun install` + `next build`
with **`output: "standalone"`** and `outputFileTracingRoot = workspaceRoot`
(same value `turbopack.root` already uses), runner = `oven/bun` or
`node:22-slim` serving `.next/standalone/server.js` on :3000, `images.unoptimized: true`
(one logo, drops `sharp`). Build context = **repo root** so `@vorinthex/shared`
+ hoisted deps trace correctly; `.dockerignore` replicates the CI content-strip
(`shared/brand`, `shared/docs`, `CLAUDE.md`, `AGENTS.md`, `.claude`). This
**deletes the entire Vercel NFT `cp -al` hack** and the triple `vercel build`.
One image, built once, `NEXT_PUBLIC_SITE_URL=https://vorinthex.com`, serves
all three domains.

### E.3 ARM64 / Graviton verdict
- **Web image → ARM-ready today.** No native deps (sharp disabled). Build
  multi-arch with buildx, run on `t4g`/`m7g` Graviton → ~20% cheaper.
- **Backend image → blocked on ARM by `@sparticuz/chromium`** (ships an
  x86_64-only Chromium binary); the render task also pins `X86_64`. All other
  deps are pure JS (ioredis, arangojs, hono, zod, otplib…) and Bun is
  multi-arch. *Recommendation:* run the **api** role on Graviton by building
  a Chromium-free api image (the api role never launches Chromium); keep the
  **render** role on x86 until Chromium is replaced (e.g. a Lambda/container
  screenshot service or an ARM Chromium build). Net: the two biggest,
  always-on tiers (web + api) both land on Graviton.
- Use `docker buildx` multi-arch + immutable `:sha` tags (stop mutating
  `:latest` as the deploy pointer; keep `:latest` only as a convenience tag).

---

## F. Phase 6 & 18 — CI/CD and GitHub repository redesign

### F.1 Target pipeline
```
PR opened ─▶ ci.yml (pre-merge, required checks): install(cache) → lint → typecheck → test → build web+backend images (no push)
   │
merge to main ─▶ build-push.yml: buildx multi-arch → ECR :sha (web + api [+ render])  (GHA cache)
   │
   ├─▶ migrate: ECS run-task (one-off) arango-migrate + seed  [AFTER a pre-migrate arangodump→S3]
   ├─▶ deploy-api:  ecs update-service (rolling, minHealthy 100%) → wait services-stable → /api/v1/health smoke
   ├─▶ deploy-web:  ecs update-service (rolling) → wait services-stable → homepage smoke
   └─▶ (render: update-service only when worker is real)
   │
infra changes ─▶ terraform.yml: PR → plan (comment artifact) → manual approve (production env reviewers) → apply
```

**Key changes vs today, each justified:**
1. **Add pre-merge `ci.yml`** (push/PR) and make it a **required status
   check** via branch protection — today tests run only post-merge, so broken
   code reaches production before anyone knows. This is the single highest-ROI
   fix.
2. **Collapse the 3 identical web verify jobs** into one; use a **reusable
   workflow / matrix** and **actions/cache** for `~/.bun` + Next cache. Pin
   `setup-bun`, `vercel`(removed), and `setup-terraform` versions. Eliminates
   ~9 cold `bun install`s and 3 duplicate builds per run.
3. **Replace Vercel deploy with ECR image + `ecs update-service`** for web —
   same mechanism the backend already uses. Deletes the NFT hack, the
   per-key Vercel REST env sync, and the git-disconnected-project complexity.
4. **Replace SSH/scp/`deploy-app.sh` blue-green** with **ECS rolling deploy**
   (`deploymentController: ECS`, `minimumHealthyPercent: 100`,
   `maximumPercent: 200`, ALB health-check draining). No more
   `authorized_keys` SSM self-heal, no `.active` dotfile, no Caddyfile
   rewrite. Break-glass access via **SSM Session Manager**, not SSH keys.
5. **Migrations become a one-off `ecs run-task`** (same image, `command`
   overridden to the migrate entrypoint) inside the VPC — kills the fragile
   `ssh -f -N -L 8529` tunnel from the runner that hung a real run for
   1h40m. **Gate it behind an automated `arangodump`→S3** so there is a
   restore point (today there is none).
6. **Terraform: split plan/apply**. PR-triggered `plan` posts the plan as a
   comment/artifact; `apply` runs only after a human approves the
   `production` GitHub Environment (which must get **required reviewers +
   wait timer** — today it has none, so the gate is cosmetic). Pin TF version.
   Make Terraform the **sole owner of ECR + task definitions** (stop the CI
   `jq`-mutation of live task defs and the imperative ECR create).
7. **Secrets hygiene:** retire the mega-`CONFIG` JSON blob; source backend
   env from SSM directly into task defs (`secrets:` `valueFrom`), which the
   render task already does. Remove the 5 orphaned Vercel secrets, the
   `GH_PAT` self-mutation of repo variables (move `vars.json` to plain repo
   config or Terraform), and the git-crypt→build-config→CONFIG round-trip.
   Fix `build-config.ts` drift (missing `hunt`) or delete it.
8. **GitHub governance:** branch protection on `main` (required PR review +
   required `ci.yml` checks + linear history), add **CODEOWNERS**, enable
   **Dependabot** (or Renovate) for bun/actions/Docker base images, enable
   **secret scanning + push protection**, adopt lightweight **semver tags**
   on release (image tag = `sha` for traceability, human tag for rollback
   targets). Convert the 4 copy-pasted SSH/Python blocks and 3 web jobs into
   **composite actions / reusable workflows** (fixes the literal BOM bug and
   the 1203-line monolith).

### F.2 Deployment strategy (Phase 17) — recommendation
- **API & web: rolling ECS deploys** with ALB health-check draining and
  `minimumHealthyPercent: 100%` → zero-downtime, simplest, native. This is
  strictly better than today's app blue-green because it's ALB-integrated and
  needs no host state.
- **Add blue/green (CodeDeploy) later** for the api tier once traffic
  justifies it — it enables true canary (shift 10% → bake → 100%) and instant
  rollback via listener swap. Not needed at launch scale; document as the
  10k-user upgrade.
- **Canary** via CloudFront/Cloudflare weighted routing or CodeDeploy linear
  is the long-term ideal for the api; **feature flags** (a simple
  Redis/registry-backed flag, which the app's registry pattern already
  suits) decouple release from deploy for risky UX.
- **DB migrations: expand/contract discipline.** The current migrate is
  idempotent and expand-only in spirit; formalize it: never
  drop/rename-in-place in the same deploy that ships code depending on the
  new shape (the presence-funnel migration in Part I §13 is a model — add,
  backfill, then drop in a later deploy). **Always `arangodump`→S3 before
  migrate**; rollback = redeploy previous image (`:sha`) + restore dump if a
  destructive step ran.

---

## G. Phase 8 & 9 — ECS + Auto Scaling design

### G.1 Cluster & capacity providers
One ECS cluster (reuse `vorinthex-production`). **EC2 launch type** with a
**managed capacity provider** backed by an **Auto Scaling Group** (Launch
Template, Graviton `t4g`/`m7g` for web+api). Enable **managed scaling**
(target capacity ~100% with headroom) and **managed termination protection**.
Use a **mixed-instances policy**: on-demand baseline + **Spot** for burst/
stateless web capacity (web and api are shape-tolerant; never put the
migration task or stateful singletons on Spot). *Justification for EC2 over
Fargate:* the prompt mandates ECS-on-EC2; it's also cheaper at steady high
utilization and lets the api tier keep warm Bun processes and shared VPC
endpoints. (Fargate stays a valid choice for the bursty render role.)

> **Core principle — what scales and what does not: the backend autoscales;
> the database is fixed and stable.** The ASG + capacity provider described
> here govern **only the stateless compute tier** (web + api, and later
> render). The **ArangoDB EC2 host is deliberately NOT part of any Auto
> Scaling Group, launch template, or capacity provider** — it is a single,
> statically-provisioned `aws_instance` (the existing `graph-db-host` module),
> and it stays that way (see G.4). A stateful single-writer graph DB must
> never be launched/terminated by a scaling policy, put on Spot, or bin-packed
> by ECS — that would risk the data volume and split-brain the writer. The
> two tiers are decoupled on purpose: the app fleet grows and shrinks with
> traffic; the DB box is pinned and scales **vertically by human decision**,
> not automatically.
>
> **DB sizing stays GitHub-variable-driven (not autoscaled).** The infra
> workflow already exposes `PROD_GRAPH_DB_INSTANCE_TYPE` and
> `PROD_GRAPH_DB_VOLUME_SIZE` (read in `.github/workflows/infra.yml`, wired to
> the module's `graph_db_instance_type` / `graph_db_volume_size`, currently
> unset → falling back to `t3.small` / 30 GiB). **Keep these as the vertical-
> scaling control**: to grow the DB you set/raise the GitHub variable and run
> a Terraform apply (instance-type change is a stop/start on the same EBS data
> volume; volume grows online via `aws_ebs_volume.size` + a filesystem
> resize). Add a matching `PROD_GRAPH_DB_*` variable to the target-state docs
> so the DB's size is always explicit config, never an emergent property of a
> scaling policy. The app tier's sizing (`PROD_INSTANCE_TYPE`, task
> cpu/memory, service min/desired/max) remains its own separate set of
> variables so the two never share a knob.

### G.2 Services & task definitions
| Service | Task (CPU/mem) | Replicas dev/stg/prod | Notes |
|---|---|---|---|
| `web` | 0.5 vCPU / 1 GB | 1 / 2 / 3+ | Next standalone :3000, ALB web TG, `output: standalone`, Graviton |
| `api` | 1 vCPU / 2 GB | 1 / 2 / 3+ | Hono :3001, ALB api TG, SSE-heavy, Graviton (Chromium-free image) |
| `render` | 1 vCPU / 2 GB | 0 until implemented | queue consumer; Spot/Fargate ok; x86 while Chromium x86-only |
| `migrate` | 0.5 vCPU / 1 GB | run-task on deploy | one-off, not a service |

Roles: reuse the **execution role** (ECR pull, SSM secret fetch, logs) and a
per-service **task role** (S3 for render, none extra for web). **Drop the
static `AWS_ACCESS_KEY_ID/SECRET` injected into the render task** — the task
role already grants S3. Tighten `kms:Decrypt` from `*` to the SSM/Secrets
KMS key ARNs. `secrets:` pull from `/vorinthex/prod/*` (unchanged contract).

### G.3 Autoscaling policies
- **Service autoscaling (app-level):** target-tracking on **ALB
  RequestCountPerTarget** (primary — best proxy for web/api load) plus CPU
  60% and memory 70% as guards. Min/desired/max: prod `2/3/20` api,
  `2/3/20` web; stg `1/1/4`; dev `1/1/1`. Scale-out cooldown 60s, scale-in
  300s (avoid flapping; protect SSE connections — prefer connection-draining
  deregistration delay ≥ heartbeat interval).
- **Cluster autoscaling (capacity):** ASG managed by the ECS capacity
  provider (target 100% with a small warm pool). ASG min/max sized to hold
  the service max + one instance headroom per AZ. Spot interruption handling
  via capacity-provider rebalancing; on-demand floor guarantees baseline.
  **This ASG contains web/api/render capacity ONLY — the ArangoDB host is a
  separate standalone instance outside every ASG and launch template (see G.1
  principle box and G.4); no scaling policy can ever target it.**
- **SSE caveat:** long-lived streams make scale-in disruptive (dropping a
  task kills its SSE clients, which reconnect). Set a generous
  deregistration delay and prefer scaling on request rate over raw CPU so we
  don't churn tasks under steady streaming load.

### G.4 Should ArangoDB move to ECS / autoscale? — **No, on both counts (recommendation).**
Keep Arango on a **dedicated, fixed EC2 host** — outside ECS, outside the
ASG, outside any autoscaling. This is the deliberate split from G.1: **backend
autoscales, DB is fixed and stable.** Rationale:
- A stateful single-writer graph DB must not be launched/terminated by a
  scaling policy — that would detach/reattach or risk the EBS data volume and
  could split-brain the writer. It is provisioned as one standalone
  `aws_instance` (`graph-db-host` module), never in a launch template/ASG,
  never on Spot, never ECS-bin-packed.
- **Scale it vertically, by human decision, via GitHub variables.**
  `PROD_GRAPH_DB_INSTANCE_TYPE` and `PROD_GRAPH_DB_VOLUME_SIZE` already exist
  in `infra.yml` (→ `graph_db_instance_type` / `graph_db_volume_size`,
  defaults `t3.small` / 30 GiB). Bigger DB = raise the variable + Terraform
  apply, not an automatic policy. The plan keeps these as the sole DB-sizing
  control and keeps them **separate from the app tier's sizing variables** so
  the two capacity models never share a knob.
- Harden it in place: **private subnet (no EIP)**, **EBS DLM snapshots**,
  scheduled **`arangodump`→S3**, a **scoped DB user** instead of root-as-app,
  keep the EBS-survives-instance-replacement pattern.
- Horizontal DB scaling, when eventually needed, is a **deliberate topology
  change** (Arango cluster / managed Arango Oasis / read replicas at the
  100k-user tier), reviewed and applied on purpose — never an autoscaling
  side effect.

### G.5 Cron & queues (Phase 9 specifics)
- **Leaderboard digest** currently runs in-process on every api replica,
  coordinated by a Redis day-lock — correct but fragile (a mid-run crash
  skips the day). *Recommendation:* move it to an **EventBridge Scheduler →
  `ecs run-task`** one-off (or a tiny scheduled Lambda that hits an internal
  endpoint). Removes it from the request-serving replicas and gives retries.
- **Render queue:** none exists. When built, use **SQS** (already scaffolded
  in dev localstack as `vorinthex-file-events`) + an ECS `render` service
  scaling on `ApproximateNumberOfMessagesVisible`, or keep the Fargate-SPOT
  run-task dispatch (`dispatch-fargate-render.ts`) once it actually calls
  `RunTask`. Until then, set render desired-count **0** so the stub doesn't
  crash-loop.
- **Presence sweeper / liveBus:** the 30s sweeper is idempotent and safe at N
  replicas. `liveBus` is in-process → cross-replica SSE nudges are missed
  (clients fall back to their 5s poll). *Optional improvement:* publish
  liveBus events over the existing Redis pub/sub so all replicas nudge
  instantly — worth doing before the api tier runs many replicas, but it's a
  latency nicety, not a correctness fix.

---

## H. Phase 11–13 — Observability, security, performance

### H.1 Observability (currently: 1 log group, 0 alarms)
- **Logs:** per-service CloudWatch log groups (`/ecs/vorinthex-{web,api,render}`),
  30–90d retention, structured JSON from the Hono `requestLogger`. Ship to a
  cheaper long-term store (S3 via subscription) at scale.
- **Metrics/dashboards:** enable **Container Insights** (already on cluster);
  dashboards for ALB 5xx/latency/RequestCountPerTarget, ECS CPU/mem/task
  count, Redis CPU/evictions/connections, Arango host CPU/disk/EBS burst,
  NAT bytes, CloudFront cache-hit ratio.
- **Alarms (all missing today):** ALB 5xx rate + p99 latency, unhealthy-host
  count, target-group healthy < desired, ECS running < desired, Redis
  memory/evictions, Arango disk > 80% / EBS burst-balance low, NAT throughput,
  certificate expiry, deploy failure (services-not-stable). Route to
  SNS→Slack/email + PagerDuty at scale.
- **Tracing:** add **OpenTelemetry** in the Hono app (traceparent through the
  web→api→Arango/Redis calls) exporting to **AWS X-Ray** or an OTel
  collector sidecar. High value given the SSE + multi-provider AI fan-out.
- **Health:** `/api/v1/health` is already unauthenticated and used by Docker
  HEALTHCHECK, Caddy, and CI — reuse it as the ALB api health check; add a
  deeper `/api/v1/health?deep=1` that pings Arango + Redis for readiness.

### H.2 Security (Phase 12)
Prioritized hardening (all are pre-existing gaps):
1. **Move Arango + Redis + compute to private subnets; drop both public
   EIPs.** Remove world-open SSH — no SSH at all in the ECS model (SSM
   Session Manager for break-glass).
2. **Least-privilege IAM:** scope `kms:Decrypt` to specific key ARNs (not
   `*`), drop static AWS creds from the render task, split the CI OIDC roles
   to minimal actions (ECR push, ECS update, run-task), remove the deploy
   pipeline's `GH_PAT` write access to repo config.
3. **Secrets:** keep SSM as the contract; consider **Secrets Manager** for
   the high-value rotatable secrets (DB creds, `ACCESS_TOKEN_SECRET`,
   `TOTP_SECRET_ENCRYPTION_KEY`, Polar/Resend). Stop persisting generated
   secrets + the SSH key in **Terraform state** (use Secrets Manager +
   `ignore_changes`, or generate out-of-band). Force `encrypt=true` on the
   state backend and lock down the state bucket.
4. **Redis AUTH token + TLS** (TLS already on; add AUTH); **scoped Arango DB
   user** instead of root for the app.
5. **Edge WAF:** Cloudflare WAF + AWS WAF on CloudFront/ALB (managed rules,
   rate-limit on `/api/v1/auth/*` and webhooks; the app already does
   per-IP Redis rate-limiting keyed on `x-forwarded-for` — keep and put WAF
   in front). Enforce security headers at CloudFront (HSTS, etc.).
6. **Supply chain:** immutable ECR tags + `scan-on-push` (on) + lifecycle;
   optionally image signing (cosign); Dependabot + secret scanning +
   push protection on the repo.
7. **Webhook integrity:** Polar/Resend already verify svix signatures — keep;
   ensure the webhook paths stay exempt from the API-key middleware but WAF-
   rate-limited.

### H.3 Performance (Phase 13)
- **Web:** standalone Next on Graviton; CloudFront caches `_next/static` +
  `/public` (12 MB immutable) with long TTL; HTML for `/` **must vary by
  Host** (proxy.ts hostname routing) — set the cache key to include Host or
  bypass cache for `/`. Brotli/gzip at CloudFront. `images.unoptimized`
  removes sharp cold-start cost.
- **API:** Bun is fast; the real cost is **4–5 Arango aggregate queries per
  SSE connection per 5s** (leaderboard/live). At scale, **cache the
  leaderboard/live payload in Redis** (single computed snapshot refreshed on
  `liveBus`/interval, fanned to all SSE clients) instead of per-connection
  DB polling — this is the top backend scaling lever and pairs with the
  Part I §12 leaderboard fix.
- **Build/deploy speed:** GHA cache for bun + Next + Docker layers; VPC
  endpoints for fast ECR pulls; multi-arch built once.
- **Cold starts:** ECS-EC2 keeps warm processes (no serverless cold start);
  keep a warm ASG pool so scale-out doesn't wait on instance boot.

---

## I. Phase 14 — Cost analysis (eu-north-1, order-of-magnitude)

Current baseline is tiny (2× `t3.small`, 1× `cache.t4g.micro`, 1 NAT, low
traffic) — roughly **~$120–180/mo** (2 EC2 ≈ $30, Redis ≈ $12, NAT ≈ $32 +
data, EBS/S3/ECR minimal, Fargate-SPOT render near-zero) **plus Vercel**
(3 projects — Pro seat/usage, call it $20–150/mo depending on plan/bandwidth).

Target at low scale (launch, ≤10k users): ALB (~$18 + LCU), CloudFront
(usage; low), 2–3 small Graviton ECS instances (~$45–90), Redis Multi-AZ
2-node (~$25–35), NAT (~$32), Arango EC2 (~$15–30) → **~$180–320/mo** — but
**Vercel disappears**, and the web tier's CDN bandwidth moves to CloudFront
(cheaper per-GB at volume) fronted by Cloudflare (free/cheap egress). Net at
launch is roughly flat-to-slightly-higher, buying real HA + autoscaling +
one platform.

Savings levers as you grow (Phase 14 asks):
- **Graviton** web+api → ~20% compute.
- **Spot** for stateless web/burst capacity → up to ~60–70% on that slice.
- **Compute Savings Plans / RIs** on the on-demand baseline (1-yr, ~30–40%).
- **VPC endpoints** cut NAT data-processing for ECR/S3/logs.
- **CloudFront + Cloudflare** cut per-GB egress vs Vercel bandwidth and vs
  NAT for asset traffic.
- **ECR lifecycle** (expire untagged/old `:sha`) caps storage creep.
At 1M users the dominant costs shift to api compute (SSE fan-out) + Arango +
Redis + egress; the Redis payload-caching change (H.3) and read-replica/
managed Arango are the big unlocks.

---

## J. Phase 16 — Scaling ladder & bottlenecks

| Tier | Web | API | Data | First bottleneck & fix |
|---|---|---|---|---|
| **100** | 1 task | 1 task | 1 Arango, 1 Redis | none; fix instance-local state (fragments ledger, §12/§K) before >1 replica |
| **1k** | 2 tasks | 2 tasks | +Redis Multi-AZ, snapshots | **fragments ledger + liveBus** must be Redis-backed to run >1 replica correctly |
| **10k** | 2–3 | 3–4 | Arango backups, 2nd NAT | **per-connection SSE DB polling** → cache leaderboard/live payload in Redis; ALB idle/drain tuning |
| **100k** | 4–8 (Spot) | 6–12 | Arango read scaling / managed Arango; Redis cluster-mode | Arango aggregate load + Redis pub/sub fan-out; consider read replicas + snapshot-served payloads |
| **1M** | autoscale 10–30 | 20–50 | managed/clustered Arango, Redis cluster, multi-AZ everything | SSE connection count per task (raise task count / offload streams to a dedicated fan-out tier); egress + provider rate limits; multi-region read |

Cross-cutting bottleneck: **SSE is the scaling shape of this app.** Every
leaderboard/live/presence viewer holds a connection that polls Arango every
5s. The two structural fixes (Redis-cached payload + Redis-fanned liveBus)
convert O(connections) DB load to O(1) and are prerequisites past ~10k.

---

## K. Phase 19–20 — Deliverables index, risks, and ordered migration roadmap

### K.1 Diagrams (ASCII in this doc; convert to draw.io/Mermaid for review)
Architecture (A), Networking/edge (D), CI/CD (F.1), current dependency graph
(C), target ECS/ASG (G) are all captured above. A picture-perfect render is a
follow-up deliverable, not a blocker.

### K.2 Technical-debt / quick-wins register
**Quick wins (low risk, do first, mostly independent of the big migration):**
- Add pre-merge `ci.yml` + branch protection (biggest ROI, no infra change).
- Restrict `ssh_ingress_cidr_blocks` default off `0.0.0.0/0`; add ECR
  lifecycle policy; add EBS DLM snapshots + a nightly `arangodump`→S3 (retire
  the no-backup risk immediately, before any migration).
- Delete 5 orphaned Vercel secrets; fix `build-config.ts` hunt drift; fix
  `vars.json` `t3.micro`↔`t3.small` mismatch; pin toolchain versions.
- Set render desired-count 0 (stop the stub crash-loop) until the worker is real.
- Add required reviewers + wait timer to the `production` GitHub Environment
  (Terraform apply currently has no human gate).
**Deeper debt (address during migration):** mega-`CONFIG` secret; TF state
holding secrets + SSH key; `kms:Decrypt *`; task-def `jq`-mutation vs IaC;
1203-line monolith workflow; instance-local fragments ledger + liveBus;
per-connection SSE DB polling; stale `IMPLEMENTATION_SUMMARY.md` RDS refs.

### K.3 Ordered migration roadmap (each task: priority · complexity · risk · deps · rollback · est · success)

**Wave 0 — Safety net (do before touching topology).**
1. **Automated Arango backups** (`arangodump`→S3 + EBS DLM). P0 · Low · Low ·
   none · rollback n/a · ~0.5d · *Success:* restorable dump in S3 nightly +
   pre-deploy, tested restore into a scratch DB.
2. **Pre-merge CI + branch protection + prod-env reviewers.** P0 · Low · Low ·
   none · revert workflow · ~1d · *Success:* broken PR is blocked before
   merge; apply requires approval.
3. **Security quick-wins** (close SSH default, ECR lifecycle, drop render
   static keys, render desired 0). P0 · Low · Low · none · TF revert · ~1d.

**Wave 1 — Web to ECS (lowest-risk topology move; fully parallel to backend).**
4. **Add `web/app` standalone build + Dockerfile + `vorinthex-web` ECR.**
   P1 · Med · Low · Wave 0 · rollback = keep Vercel live · ~2d · *Success:*
   image builds from repo-root context, `next start` serves all routes
   locally.
5. **Terraform: ALB + web target group + ECS `web` service + ASG/capacity
   provider + ACM cert.** P1 · High · Med · #4 · rollback = DNS stays on
   Vercel · ~3–4d · *Success:* web service healthy behind ALB on a test
   hostname.
6. **CloudFront + Cloudflare in front of the web ALB; cutover one domain
   (hunt) first.** P1 · Med · Med · #5 · rollback = repoint DNS to Vercel ·
   ~2d · *Success:* hunt.vorinthex.com served from ECS, SSE + assets correct,
   then cut orbit + apex. Decommission the 3 Vercel projects only after a
   bake period.

**Wave 2 — Backend app role to ECS (replaces SSH blue-green).**
7. **Chromium-free `api` image (Graviton) + `api` ECS service + ALB api TG
   (SSE idle 300s).** P1 · High · Med · Wave 0 · rollback = keep EC2 Caddy
   host serving `api.vorinthex.com` · ~3–4d · *Success:* `/api/v1/health`
   green behind ALB, all 4 SSE streams stable through CloudFront/ALB for
   >5 min.
8. **Migrations as `ecs run-task` (post-backup), rolling api deploy in CI,
   retire SSH/scp/`deploy-app.sh`/authorized-keys self-heal.** P1 · Med ·
   Med · #7 · rollback = re-enable SSH deploy job · ~2–3d · *Success:* a
   merge deploys api with zero downtime and no SSH.
9. **Cut `api.vorinthex.com` DNS to the api ALB; retire the app EC2 host +
   Caddy.** P1 · Med · Med · #7,#8 · rollback = repoint DNS to the EIP ·
   ~1d.

**Wave 3 — Data & coordination hardening.**
10. **Move Arango to a private subnet (no EIP); scoped DB user; deploys via
    SSM/run-task. Keep it a fixed standalone EC2 host — explicitly NOT in the
    ASG / never autoscaled — with sizing driven only by the
    `PROD_GRAPH_DB_INSTANCE_TYPE` / `PROD_GRAPH_DB_VOLUME_SIZE` GitHub
    variables (backend autoscales; DB is fixed and stable, see G.1/G.4).**
    P1 · Med · Med · Waves 1–2 · rollback = restore public routing · ~2d ·
    *Success:* DB reachable only from `api-sg`/migration task, and no ASG or
    scaling policy references the DB instance.
11. **Redis Multi-AZ (2-node) + AUTH token + snapshots.** P1 · Med · Med ·
    none · rollback = revert to single node · ~1d · *Success:* failover test
    passes, app reconnects.
12. **Move instance-local state to shared stores** (fragments ledger + liveBus
    → Redis; ties into Part I §12). P1 · Med · Med · #7 · rollback = pin api
    replicas to 1 · ~3d · *Success:* balances/rank identical across replicas.

**Wave 4 — Scale, observability, governance polish.**
13. **Autoscaling policies (service + cluster), VPC endpoints, 2nd NAT.**
    P2 · Med · Low · Waves 1–3 · ~2–3d.
14. **Alarms + dashboards + OpenTelemetry/X-Ray.** P2 · Med · Low · Waves
    1–2 · ~3d.
15. **Terraform owns task defs + ECR; split plan/apply with PR-plan comment;
    refactor deploy.yml into reusable workflows; CODEOWNERS + Dependabot +
    secret scanning.** P2 · Med · Low · Waves 1–2 · ~3–4d.
16. **Render worker + SQS (only when the feature is real);
    EventBridge-scheduled digest; Redis-cached SSE payload for scale.**
    P3 · High · Med · Wave 2 · ~1–2wk.

**Sequencing rationale:** Wave 0 makes the system *safe to change at all*
(backups + gates). Web (Wave 1) is the least-risky topology move because the
app is nearly Vercel-agnostic and Vercel stays live as an instant rollback
until DNS cutover. Backend (Wave 2) reuses the ECR/OIDC/ECS muscle memory the
repo already has. Data hardening (Wave 3) waits until compute is on ECS so DB
access paths are stable. Scale/observability/governance (Wave 4) is polish
that doesn't gate the cutover. The two per-app SPOFs with real data risk —
**no DB backup** and **no pre-merge gate** — are fixed first, before any
resource is moved.

### K.4 Open questions for the architect review
1. Does Cloudflare already own DNS? If not, collapse to CloudFront-only (or
   add Route53) — affects D and the WAF split.
2. Is the render pipeline going to be built soon? If yes, design SQS + a
   Chromium-capable render image now; if not, keep it at desired-0.
3. Keep ArangoDB self-managed, or adopt managed/clustered Arango (Oasis) at
   the 100k tier? Affects Wave 3 vs a later Wave 5.
4. Single region acceptable to 1M, or is multi-region read required? (Drives
   Redis/Arango topology and CloudFront origin strategy.)
5. Region stays `eu-north-1` (Graviton availability is fine there) — confirm
   no data-residency reason to split.

> Constraint honored: **no code, Terraform, workflow, or AWS resource was
> modified.** This Part II is analysis and plan only.

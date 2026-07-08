# Fixes & Planned Changes

Full pass completed. Status legend: `[done]` implemented and verified ·
`[investigated]` traced but no code defect found.

---

## 1. `[done]` Unauthenticated "You are holding" replacement

`LeaderboardFlow` now checks `vx_profile` in localStorage. Signed-in
visitors keep the standing row (rank + balance); unauthenticated visitors
see muted copy plus Join (primary) / Sign in (secondary) CTAs instead:

> New explorer? Join to send your fragments into the hunt. Already
> collecting? Sign in to sync your haul.

## 2. `[done]` CTA consistency across auth forms

`ExplorerSigninFlow`'s "Sign in" and `MembersFlow`'s "Continue" submit
buttons are now `variant="primary"` (were `secondary`). `JoinFlow` and
both TOTP panels were already primary.

## 3. `[done]` Sign-in email link routing

Root cause: the sealed-chamber/handoff check only covered the explorer
arrival path (`ArrivalJump.tsx`). Two gaps fixed in
`web/app/src/components/caves/CaveOverlay.tsx`'s `MagicFlow`:
- The `data.status === "authenticated"` branch (reached via a
  `?flow=member` link that actually resolves to an explorer identity) now
  checks `hasPendingHandoff()` and routes to the sealed chamber on foreign
  surfaces, matching `ArrivalJump`.
- Real member TOTP completion (`TotpSetupPanel`/`TotpVerifyPanel`
  `onSuccess`) now checks `hasPendingHandoff()` too: same-device
  completes as before (`startJump("private")`); foreign-device completion
  still finishes TOTP (security proof can't be skipped) but then lands in
  the sealed chamber instead of jumping into `/galaxy/private` on a
  device the visitor doesn't intend to keep using.
- `LinkLandingAction` gained a `"member"` variant with matching copy in
  `SealedFlow`.

## 4. `[done]` Slide-up animation, staggered

New `web/app/src/components/ui/SlideUpCard.tsx` replaces the deleted
`EruptAssembly` (shard/shatter) component. Every cave card and both
bottom drawers (`RockDrawer`, `ProductDrawer`) now slide up immediately —
the `ROCK_DRAWER_HOLD_SECONDS`/`DRAWER_HOLD_SECONDS` 3s holds are gone.
The hunt's multiple islands stagger via `SlideUpCard`'s `index` prop
(0.2s apart: briefing/return @0, call @0.2s, board @0.4s, pulse @0.6s).

## 5. `[done]` Hunt board: no "Open seat" rows

`topRows.map(...)` replaces the old `Array.from({ length: 10 }, ...)`
padding — only real rows render.

## 6. `[investigated]` Fragment values on hunt cards

Traced backend aggregation (`listTopCollectors`, `sumFragmentsTotal` —
both `SUM`, not `COUNT`), local `balance` (built additively), and every
render site (`formatFragments(row.total)`, `formatFragments(balance)`,
`formatFragments(fragmentsTotal)`). No count-vs-sum defect found in the
current code. No fix applied — flag for a live repro if it recurs.

## 7. `[done]` Double hyperjump on sign-in

Root cause: `LandingPage`'s deep-space arrival flight (`intro` flag)
played before `ArrivalJump`'s own hyperjump — two space-travel
animations back to back. Fixed in
`web/app/src/components/landing/LandingPage.tsx`: `intro` is now also
`false` when `arrival` is set, so verify-and-jump deep links land
straight in the solar system and get exactly one hyperjump.

## 8. `[done]` Full rename: "Leaderboard" → "Hunt"

- `CaveKind` value `"leaderboard"` → `"hunt"` (`galaxy-store.ts`,
  `cave-config.ts`'s `CAVE_CONFIGS`/`ANCHORED_CAVE_KINDS`).
- Route moved: `web/app/src/app/leaderboard/` → `web/app/src/app/hunt/`.
- Subdomain: `web/app/src/proxy.ts`'s `CAVE_SUBDOMAIN_PATHS` now maps
  `hunt` → `/hunt`.
- All visible copy ("The Intelligence Hunt" micro-label, "climb the
  leaderboard" prose, llms.txt) now says "Hunt".
- Infra: `.github/workflows/deploy.yml` (`waitlist-leaderboard` /
  `waitlist_leaderboard` tokens → `hunt`), `.github/.configs/secrets.json`
  (+ `.example`) key renamed to `hunt`, `environments/waitlist-leaderboard/`
  → `environments/hunt/`.
- **Live infra updated**: the Vercel project (`prj_SN2E4dodMaSz7VmCSkm0a2AQzfGA`)
  was renamed from `waitlist-leaderboard` to `hunt`; `hunt.vorinthex.com`
  is attached and verified; the old `waitlist-leaderboard.vorinthex.com`
  domain was detached. CONFIG repo secret synced.
- Left untouched (internal, not user-facing): backend
  `/leaderboard/stream` SSE endpoint, `lib/leaderboard/` frontend store
  and copy module, `userWaitlistLeaderboardChanges` DB collection — these
  are data-layer implementation details, not URLs or visible identifiers.

## 9. `[done]` Cursor feedback while dragging to rotate the galaxy

`UniverseStage.tsx`: `grabbing` while actively dragging, `grab` on hover
over the rotatable canvas, reset on pointer up/leave/unmount.

## 10. `[done]` Header simplification

`SiteNav.tsx`: mission-audio toggle removed entirely. New layout: **Join
(primary) | Sign in (secondary) | Hunt (secondary)**.

## 11. `[done]` "Briefing" CTA moves into the hunt biome

`LeaderboardFlow` now opens with a primary **Briefing / Stop** CTA (label
fades in) followed by a secondary **Return to Solar System** button —
the hunt's only exit now that island 2's close (X) is gone.

## 12. `[done]` New `hunt-briefing.mp3`

Regenerated via the same pipeline as the earlier mission-voice pass
(`bun run audio:tts` + `ffmpeg-static` PCM→mp3), script now names "the
hunt" explicitly instead of "leaderboard"/generic "mission".
`web/app/public/audio/brand/mission.mp3` removed;
`hunt-briefing.mp3` added; `MISSION_AUDIO_SRC` in
`web/app/src/lib/audio/audio-store.ts` updated.

## 13. `[done]` Routing scope — Option 1 implemented

Kept every product/capability/orchestrator page as a real, crawlable,
statically generated route (unchanged: `generateStaticParams`,
`generateMetadata`, JSON-LD, sitemap entries) — direct links and search
results still land exactly there. Interactive camera movement no longer
rewrites the address bar to match: removed/guarded the `syncEntityUrl`
calls in `GalaxyScene.tsx` (`selectProduct`/`selectChild`),
`OrbitRail.tsx` (`go`), and `UniverseStage.tsx` (`syncStepPath`) so only
returning all the way to the overview (`step === 0` / path `"/"`) still
syncs the URL.

---

All items closed. No open decisions remain.

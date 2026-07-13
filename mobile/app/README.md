# Vorinthex Core — Mobile Mockup

High-fidelity React Native mockup of the Vorinthex Core consumer app
(Expo SDK 57, TypeScript strict, expo-router). Design source of truth:
the approved mockup in `design/` and `design/design.md`.

This phase is design- and interaction-first: **no auth, no backend, no
payments — local mock data only** (Zod-validated). TanStack Query and a
typed Axios client are wired for the future API but never hit the network.

## Flow

Splash → five-card onboarding (swipe left = skip, right = enable; state in
Zustand) → Building Your Brain → AI brain home → capability screens
(Archive, Gallery, Signal, Compass, Ascend). No bottom navigation.

## Run

```bash
bun install            # from the repo root
bun run mobile:start   # Expo dev server (press a/i for Android/iOS)
bun run mobile:typecheck
```

Native projects are generated on demand (`bunx expo prebuild` in this
folder) — they are not committed.

## Structure

- `src/app` — expo-router routes (thin screens)
- `src/components` — card stack, capability shell, chrome icon treatment,
  neural backgrounds (all animation via Reanimated)
- `src/data` — Zod-validated capability registry + mock content
- `src/state` — Zustand stores (onboarding decisions, local UI state)
- `src/theme` — tokens extending `@vorinthex/shared/ui/tokens`, motion vocabulary
- `assets/brand` — approved chrome icons and the Vorinthex mark, copied
  from `web/app/public/logos` (never redrawn)

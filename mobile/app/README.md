# Vorinthex Core — Mobile Mockup

High-fidelity React Native mockup of the Vorinthex Core consumer app
(Expo SDK 57, TypeScript strict, expo-router). Design source of truth:
the approved mockup in `design/` and `design/design.md`.

This phase is design- and interaction-first: **no auth, no backend, no
payments — local mock data only** (Zod-validated). TanStack Query and a
typed Axios client are wired for the future API but never hit the network.

## Flow

Splash → five-card onboarding (swipe left = skip, right = enable; state in
Zustand) → Building Your Personal AI → personal AI tree → capability screens
(Archive, Gallery, Signal, Compass, Ascend). No bottom navigation.

## Run

```bash
bun install            # from the repo root
bun run mobile:start   # Expo dev server (press a/i for Android/iOS)
bun run mobile:typecheck
```

Native projects are generated on demand (`bunx expo prebuild` in this
folder) — they are not committed.

## Verified Links

Founder MFA links use `https://vorinthex.com/auth/mfa`.

- iOS Universal Links use the `applinks:vorinthex.com` associated domain and the AASA file served by the web app.
- Android App Links are configured for the same path. Set the public `ANDROID_APP_CERTIFICATE_SHA256` production parameter to the Play App Signing SHA-256 fingerprint before enabling Android verification. Multiple fingerprints may be comma-separated during a signing-key rotation.

## Structure

- `src/app` — expo-router routes (thin screens)
- `src/components` — card stack, capability shell, chrome icon treatment
  (UI animation via Reanimated)
- `src/components/three` — all 3D rendered with three.js via
  @react-three/fiber (expo-gl on native, DOM canvas on web), including the
  luminous personal AI tree and capability detail fields
- `src/data` — Zod-validated capability registry + mock content
- `src/state` — Zustand stores (onboarding decisions, local UI state)
- `src/theme` — tokens extending `@vorinthex/shared/ui/tokens`, motion vocabulary
- `assets/brand` — approved chrome icons and the Vorinthex mark, copied
  from `web/app/public/logos` (never redrawn)

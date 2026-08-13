# Vorinthex Mobile

React Native application built with Expo SDK 57, TypeScript strict, and
expo-router. Native projects are generated on demand and are not committed.

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

## Native Google Sign-In

Android uses Google Sign-In's native account chooser and exchanges the
resulting ID token with the backend. In Google Cloud, configure an Android
OAuth client with package `app.vorinthex.com` and the SHA-1 certificate for
each signing key. Keep `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` set to the web OAuth
client ID because that client remains the ID-token audience verified by the
backend.

Get a local development fingerprint after prebuild with:

```bash
cd android
./gradlew signingReport
```

Production uses the EAS signing-key fingerprint. If Google Play App Signing
is enabled, also register the app-signing SHA-1 shown in Play Console. iOS
continues to use the browser flow until an iOS OAuth client and callback URL
scheme are configured.

## Verified Links

Personal and non-MFA member magic links use
`https://vorinthex.com/public/auth/token` and open the installed app. Founder
MFA links remain web-only at `https://vorinthex.com/auth/mfa`.

- iOS Universal Links use the `applinks:vorinthex.com` associated domain and the AASA file served by the web app.
- Android App Links auto-verify the same magic-link path against `ANDROID_APP_CERTIFICATE_SHA256`. Replace the current EAS certificate with the Play App Signing SHA-256 before store distribution. Multiple fingerprints may be comma-separated during a signing-key rotation.

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

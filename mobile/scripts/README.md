# Store submission automation

Automates as much of the Google Play Console and App Store Connect
submission as their public APIs allow, driven by one data file
(`stores.json`) and one command:

```bash
bun run submit            # arrow-key menu: Apple / Google / All / assets / validate
bun run submit apple      # or skip the menu
bun run submit google
bun run submit all
bun run submit assets     # generate screenshots + feature graphic + icon
bun run submit validate   # dry-run: config, files, credentials
```

Zero extra dependencies: plain Bun + `fetch` + `node:crypto` (ES256 JWT
for Apple, RS256 service-account JWT for Google), and the same arrow-key
menu pattern as `backend/scripts`.

## What is automated vs. manual

| Step | Apple (App Store Connect API) | Google (Play Developer API v3) |
|---|---|---|
| Listing metadata per locale | ✅ `appInfoLocalizations` + `appStoreVersionLocalizations` | ✅ `edits.listings` |
| Categories / contact details | ✅ `appInfos` categories | ✅ `edits.details` |
| Screenshots | ✅ reserve → chunked upload → md5 commit (`appScreenshots`) | ✅ `edits.images` (delete-all + upload) |
| Icon + feature graphic | n/a (comes from the binary) | ✅ `edits.images` |
| Country availability | ✅ `POST /v2/appAvailabilities` with an explicit territory list | ❌ **read-only** (`edits.countryavailability` is GET-only) — the script diffs current vs desired and prints the exact Console checklist |
| Binary upload | ❌ no REST endpoint for .ipa — use Transporter (macOS), `xcrun altool`, or `eas submit -p ios` | ✅ `edits.bundles` uploads the .aab and stages a draft release when `mobile/artifacts/vorinthex-core.aab` exists |
| App record creation | ❌ one-time manual (My Apps → +) | ❌ one-time manual (Create app) |
| Privacy labels / data safety / content rating | ❌ questionnaires, Console/ASC only | ❌ questionnaires, Console only |

Everything in an edit on the Google side is committed atomically
(`edits.validate` then `edits.commit`).

## Country availability policy

The app ships ONLY to: the whole EU (27), the rest of EFTA Europe
(Iceland, Liechtenstein, Norway, Switzerland), Great Britain, USA,
Canada, and Australia — 35 countries, defined once in
`stores.json > availability.regions` as ISO alpha-2 codes.

- **Apple**: enforced automatically. The script posts the exact territory
  list (mapped to Apple's alpha-3 ids) with `availableInNewTerritories:
  false`, so newly launched App Store countries stay excluded.
- **Google**: Play offers **no write API** for countries (confirmed:
  `edits.countryavailability` only supports GET). The script reads the
  current selection, diffs it against the policy, and prints a
  copy-pasteable checklist for Play Console → Release → Production →
  Countries/regions.

## Credentials

Environment variables win; otherwise the script reads the git-crypt
encrypted `.github/environments.json` under `secrets.prod.mobile` (then
`secrets.dev.mobile`) — add a `mobile` object there with the same keys:

- `ASC_ISSUER_ID`, `ASC_KEY_ID`, and `ASC_PRIVATE_KEY` (inline .p8 PEM)
  or `ASC_PRIVATE_KEY_PATH`. Create the key in App Store Connect → Users
  and Access → Integrations (role: App Manager).
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (inline JSON) or
  `GOOGLE_PLAY_SERVICE_ACCOUNT_PATH`. Create a Google Cloud service
  account, enable the Google Play Android Developer API, then invite the
  service-account email in Play Console → Users and permissions.

## Store assets

`bun run submit assets` builds the Expo web export, serves it, and
captures every route in `stores.json > screenshotGenerator.routes` with
headless Chrome at exact store sizes:

- Apple iPhone 6.7" — 1290×2796 (the only required iPhone size; Apple
  scales it down for smaller devices; iPad shots aren't required because
  `supportsTablet` is false)
- Play phone — 1080×2340 JPEG (Play: 2–8 shots, 320–3840px, no alpha)
- Play feature graphic 1024×500 (JPEG) and 512×512 icon (PNG), rendered
  from the real brand mark

Output lands in `assets/` (committed) so listings are reviewable in git.

## Binaries

Drop builds into `mobile/artifacts/` as `vorinthex-core.ipa` /
`vorinthex-core.aab` (gitignored). The .aab is uploaded automatically on
the next `bun run submit google`; the .ipa must go through
Transporter/altool/EAS — the script prints the exact command.

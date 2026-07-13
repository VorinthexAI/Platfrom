# Store submission automation

Automates as much of the Google Play Console and App Store Connect
submission as their public APIs allow, driven by one data file
(`stores.json`) and one command:

```bash
bun run submit            # arrow-key menu: Apple / Google / All / Validate
bun run submit apple      # or skip the menu
bun run submit google
bun run submit all
bun run submit validate   # dry-run: config, files, credentials
```

Zero extra dependencies: plain Bun + `fetch` + `node:crypto` (ES256 JWT
for Apple, RS256 service-account JWT for Google), and the same arrow-key
menu pattern as `backend/scripts`.

App identity: **Vorinthex AI**, bundle id / package name
**app.vorinthex.com** (also set in `mobile/app/app.json`).

## What is automated vs. manual

| Step | Apple (App Store Connect API) | Google (Play Developer API v3) |
|---|---|---|
| Listing metadata per locale | ✅ `appInfoLocalizations` + `appStoreVersionLocalizations` | ✅ `edits.listings` |
| Categories / contact details | ✅ `appInfos` categories | ✅ `edits.details` |
| Screenshots / icon / feature graphic | ✅ uploaded from `assets/` (reserve → chunked upload → md5 commit) | ✅ uploaded from `assets/` (`edits.images`, delete-all + upload) |
| Country availability | ✅ `POST /v2/appAvailabilities` with an explicit territory list | ❌ **read-only** (`edits.countryavailability` is GET-only) — the script diffs current vs desired and prints the exact Console checklist |
| Binary upload (.ipa / .aab) | ❌ manual — you upload in App Store Connect (Transporter/Xcode) | ❌ manual — you upload in Play Console (Create release) |
| App record creation | ❌ one-time manual (My Apps → +) | ❌ one-time manual (Create app) |
| Privacy labels / data safety / content rating | ❌ questionnaires, ASC only | ❌ questionnaires, Console only |

Everything on the Google side happens inside one edit that is committed
atomically (`edits.validate` then `edits.commit`).

## Screenshots and graphics — drop-in folders

Nothing is generated. Drop finished images into `assets/` and re-run;
empty folders are simply skipped so you can push metadata first and
images later. See `assets/README.md` for the exact size requirements
(App Store 1290×2796 iPhone shots; Play 2–8 phone shots, 512px icon,
1024×500 feature graphic).

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

# Onboarding store screenshots

The eight real app captures are paired with onboarding steps in
`mobile/app/src/data/intro-screenshot-steps.ts`. The titles come from the same
`intro-step-copy.ts` that the in-app intro uses. Edit `copy.json` here for the
short store subtitles; optionally add a `title` to any entry to override its
onboarding title **only in store artwork**. There are no slide numbers or
step counters in the rendered images.

The full-bleed `graphite-backdrop.jpg` is an optimized copy of the saved
graphite artwork in `scripts/image/outputs/onboarding-frames/` and is tracked
so future renders work without local generated files. The backdrop stretches
to the store canvas. The renderer masks away the old backdrop around the
already-bundled phone composites in `mobile/app/assets/onboarding/frames/`,
then draws the title and subtitle over a light gradient using
local Geist fonts in `template.html` and `template.css` via Playwright/Chromium;
the originals and the in-app intro frames remain untouched. No image-model
calls or credentials are needed.

From the repository root, after `bun install`:

```sh
bun run --cwd scripts/image screenshots:store
```

Edit `copy.json` and run the same command to regenerate both sets. Check the
contact sheets in `scripts/image/outputs/onboarding-store-screenshots/`:

| Store | Output folder | Size | Format |
| --- | --- | --- | --- |
| Apple iPhone 6.7-inch | `apple/` | 1320×2868 | RGB PNG |
| Google Play phone | `google/` | 1080×1920 (9:16) | RGB PNG |

To update the ready-to-submit images after review, run:

```sh
bun run --cwd scripts/image screenshots:store --publish
```

That replaces only `01.png`–`08.png` under
`mobile/scripts/assets/screenshots/apple/iphone-6-7/` and
`mobile/scripts/assets/screenshots/google/phone/`. The two contact sheets stay
in the ignored design-output folder and are never uploaded with store assets.

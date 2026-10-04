# Vorinthex AI Local Design Engine

Local Bun CLI for generating, reviewing, locking, versioning, exporting, and backing up Vorinthex AI brand assets.

It also includes a deterministic HTML-to-PNG product screenshot renderer. See [`product-screenshots/README.md`](product-screenshots/README.md).

For ten paid, screenshot-free portrait frame experiments, run
`bun run scripts/generate-onboarding-frames.ts` from the repository root. The
script uses the git-crypt-unlocked **production backend** OpenRouter key,
generates with `openai/gpt-image-2.5-sunburst`, and saves ten 1080×1920 PNGs,
their original provider images, a manifest, and a contact sheet under
`scripts/image/outputs/onboarding-frames/`. A solid black 9:16 center is
applied locally to reserve space for future screenshots. Reruns skip existing
frames; `--force` explicitly makes another ten paid calls.

To make an eleventh paid concept using the first real Storage screenshot as an
OpenRouter image reference, run `bun run scripts/generate-onboarding-frames.ts
--integrated`. It creates `11-ambient-silver.png`: a soft silver, textured
portrait background with the original screenshot gently feathered and tilted
into it. It does not change the screenshot bundled in the mobile app.

For a separate twelfth comparison with a deeper, dimmer graphite background
and a locally composited black iPhone-style frame, run `bun run
scripts/generate-onboarding-frames.ts --iphone`. Use `--iphone --recompose`
to adjust the deterministic device treatment without another paid model call.

To apply image 12's saved dark backdrop and black device treatment to all eight
onboarding screenshots, run `bun run scripts/generate-onboarding-frames.ts
--all-screenshots`. The eight 1080×1920 PNGs and a contact sheet are written
to `scripts/image/outputs/onboarding-frames/new/`. This step is entirely local
and does not make any additional paid model calls or alter the source images.

`bun run scripts/compose-onboarding-bottom-layer.ts` extracts a short graphite
texture from image 12's saved backdrop. It bundles the reusable layer into the
intro and creates 15 visual frame previews under
`scripts/image/outputs/onboarding-frames/new/steps/`. On screenshot frames it
covers only the baked-in Android navigation row, below the Core composer; on
the other frames it supplies the same subtle bottom treatment. No provider
call or alteration of the uploaded screenshots is required. Optimized versions
of all 15 frames are bundled for the mobile intro under
`mobile/app/assets/onboarding/frames/`.

Run `bun run scripts/generate-onboarding-frames.ts --illustrations` to make
seven paid, full-bleed 9:16 graphite-and-silver scenes for the intro steps that
do not use screenshots. The generated PNGs, original model outputs, prompts,
and contact sheet live under `scripts/image/outputs/onboarding-frames/illustrations/`;
optimized copies are bundled in `mobile/app/assets/onboarding/illustrations/`.
The image 12 backdrop is sent as a color and depth reference. Reruns reuse
finished scenes; `--force --illustrations` deliberately regenerates all seven.
To regenerate just one, pass `--force --illustrations --only=08-ask-in-your-own-words`.

## Setup

```bash
cd scripts/image
bun install
bun run browser:install
```

The CLI reads `OPENROUTER_API_KEY` from `secrets.dev.backend` in the encrypted repository file `.github/environments.json`. The image model handles generation, editing, review, and comparison. Optional non-secret overrides can be supplied through the process environment:

```env
OPENROUTER_IMAGE_MODEL=google/gemini-3.1-flash-lite-image
DEFAULT_SIZE=1024x1024
DEFAULT_SOLID_BACKGROUND=#030405
DEFAULT_OUTPUT_FORMAT=png
```

## Commands

```bash
bun run design
bun run validate
bun run backup
bun run screenshots:render -- --preset all
bun run frame:generate
```

From the monorepo root:

```bash
bun run design
```

## Runtime Folder Structure

The CLI creates missing folders and seed files on first run:

```txt
scripts/image/
├── design-system.md
├── baseline-prompt.md
├── memory/
├── registry/
├── prompts/
├── src/
├── assets/
├── outputs/
├── runs/
└── backups/
```

## Locking Assets

Locked assets keep their silhouette and core identity. Future prompts inject the lock rules automatically. A major redesign of a locked asset is blocked until you unlock it with `UNLOCK <slug>` and provide a reason.

Lock levels:

- `soft`: preserve concept
- `medium`: preserve silhouette and major geometry
- `strict`: preserve silhouette, layout, proportions, and identity
- `frozen`: no regeneration except background/export processing

## Generating Variants

Use `Generate variants` from the menu. Locked assets allow only subtle or medium variation. Each variant is saved as a new version with metadata, prompt snapshot, review notes, and output paths.

## Exporting Packages

`Export asset` writes:

```txt
outputs/packages/<slug>/<version>/
├── <slug>-solid-1024.png
├── <slug>-transparent-1024.png
├── <slug>-solid-512.png
├── <slug>-transparent-512.png
├── <slug>-solid-256.png
├── <slug>-transparent-256.png
├── <slug>-solid-128.png
├── <slug>-transparent-128.png
├── metadata.json
├── prompt.md
└── review.md
```

`Create full asset package` also includes WebP files, favicon/app icon sizes, an SVG placeholder, and a README.

## Transparency Troubleshooting

The engine asks the image model for a transparent PNG, validates alpha, and falls back to local background removal when needed. Transparent exports must have a real alpha channel; checkerboard backgrounds are rejected.

## Updating Design System

Use `Update design system` or edit `design-system.md`. The current file is injected into every generation prompt and its hash is recorded in metadata.

## Example First Run

```bash
bun run design
```

Choose `New asset`, then enter:

```txt
Name: Vorinthex AI
Slug: vorinthex-ai
Category: master-brand
Prompt: Create a minimal chrome circular logo with a sharp downward triangular nexus mark. Full transparent background and solid obsidian version. Fill the full 1024 box. No text. No glitter.
```

Expected outputs include:

```txt
outputs/latest/vorinthex-ai-solid-1024.png
outputs/latest/vorinthex-ai-transparent-1024.png
assets/master-brand/vorinthex-ai/v1/metadata.json
assets/master-brand/vorinthex-ai/v1/review.md
```

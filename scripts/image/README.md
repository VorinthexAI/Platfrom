# Vorinthex AI Local Design Engine

Local Bun CLI for generating, reviewing, locking, versioning, exporting, and backing up Vorinthex AI brand assets.

## Setup

```bash
cd scripts/image
bun install
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`. Model names are configurable:

```env
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_TEXT_MODEL=gpt-5.1
DEFAULT_SIZE=1024x1024
DEFAULT_SOLID_BACKGROUND=#030405
DEFAULT_OUTPUT_FORMAT=png
```

## Commands

```bash
bun run design
bun run validate
bun run backup
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

# Vorinthex Video Asset Engine

AI-first local Bun tool for generating short Vorinthex product, capability, orchestrator, and master-brand videos through OpenRouter's async video API.

## Setup

```bash
cd scripts/video
cp .env.example .env
```

Set:

```env
OPENROUTER_API_KEY=...
OPENROUTER_VIDEO_MODEL=google/veo-3.1-lite
```

## Commands

From repo root:

```bash
bun run video:list-targets
bun run video:generate -- --type product --slug core
bun run video:generate -- --type capability --slug archive --variants 2
bun run video:generate -- --type orchestrator --slug atlas --aspect-ratio 9:16
bun run video:generate -- --type master-brand --slug vorinthex-ai --prompt "A slow chrome logo reveal in obsidian space."
bun run video:validate
```

Generate all registry targets:

```bash
bun run video:generate -- --all
```

## AI-First Usage

The CLI is flag-driven and stable for agents:

- `--type master-brand|product|capability|orchestrator`
- `--slug <slug>`
- `--all`
- `--prompt <extra direction>`
- `--duration 4|5|6|7|8`
- `--resolution 720p|1080p`
- `--aspect-ratio 16:9|9:16`
- `--variants <n>`
- `--reference-image <path-or-url>`
- `--audio` / `--no-audio`

Outputs are written to `scripts/video/outputs/videos/<category>/<slug>/<version>/`.

## Audio

Veo 3.1 Lite supports native synchronized audio. OpenRouter's documented video request parameters do not currently list a required separate audio field, so the engine controls audio through the prompt by default.

Use:

```bash
bun run video:generate -- --type master-brand --slug vorinthex-ai --duration 4 --aspect-ratio 9:16 --audio
```

For silent clips:

```bash
bun run video:generate -- --type product --slug core --no-audio
```

If OpenRouter later exposes explicit provider audio flags, set `VIDEO_SEND_AUDIO_PARAM=true` to include `generate_audio` and `audio` booleans in the payload.

The assets gallery reads `scripts/video/registry/videos.json` dynamically.

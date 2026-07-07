# Vorinthex Audio Asset Engine

AI-first local Bun tool for generating soundtrack and voiceover assets through OpenRouter, then merging audio with existing video files through ffmpeg.

## Commands

From repo root:

```bash
bun run audio:list-targets
bun run audio:generate -- --type master-brand --slug vorinthex-ai --duration 12
bun run audio:tts -- --prompt "Vorinthex AI is the nexus of intelligence."
bun run audio:generate -- --type product --slug core --mode soundtrack
bun run audio:generate -- --type capability --slug archive --mode tts --voice Charon --prompt "Short English voiceover text."
bun run audio:merge -- --video scripts/video/outputs/videos/master-brand/vorinthex-ai/v2/vorinthex-ai-v2.mp4 --audio scripts/audio/outputs/audio/master-brand/vorinthex-ai/v1/vorinthex-ai-v1.mp3
```

The generator reads `scripts/audio/.env` first, then falls back to `scripts/video/.env` so the OpenRouter key can stay in one local ignored file.

## Models

- `google/lyria-3-clip-preview`: short soundtrack clips, good default for brand/product loops.
- `google/lyria-3-pro-preview`: longer music assets when OpenRouter exposes it for the account.
- `google/gemini-3.1-flash-tts-preview`: default English TTS voiceover through OpenRouter speech endpoint, using the `Charon` voice unless overridden.
- `mistralai/voxtral-mini-tts-2603`: alternate TTS voiceover.

Outputs are written to `scripts/audio/outputs/audio/<category>/<slug>/<version>/`.
They are listed in the shared asset library served by `bun run assets`.

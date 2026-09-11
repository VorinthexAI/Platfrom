# Device Frames

Reusable transparent device overlays for deterministic product screenshot composition live here.

Generate `iphone-frame.png` with:

```bash
bun run --cwd scripts/image frame:generate
```

Review generated overlays before committing or publishing them. Device frames must not contain product UI, readable text, logos, or a filled screen area.

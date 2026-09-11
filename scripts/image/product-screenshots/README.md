# Product Screenshot Layouts

`screenshots.json` is the source of truth for branded portrait product images. The renderer combines editable copy, a logo, a product screenshot, an optional generated background, and a reusable transparent device frame in deterministic HTML and CSS.

## Manifest

Paths are resolved relative to the manifest file. Add raw captures under `inputs/` or point at screenshots elsewhere in the repository.

```json
{
  "version": 1,
  "defaults": {
    "logo": "../../../shared/brand/logos/logo-symbol-cream-512.png",
    "deviceFrame": "../../../shared/brand/device-frames/iphone-frame.png",
    "screenInsets": { "top": 2.35, "right": 5.15, "bottom": 2.35, "left": 5.15 }
  },
  "screenshots": [
    {
      "id": "01",
      "title": "Vorinthex AI",
      "description": "Your personal AI brain that grows with you.",
      "screenshot": "./inputs/home.png",
      "backgroundPrompt": "Obsidian depth with restrained chrome reflections"
    }
  ]
}
```

Each card may override `logo`, `deviceFrame`, `screenInsets`, and `screenshotPosition`. Set `background` to a local image for a fixed background. Set `backgroundPrompt` to make `--generate-backgrounds` create and cache one through OpenRouter.

## Render

Install Chromium once after installing dependencies:

```bash
bun run browser:install
```

```bash
bun run screenshots:render
bun run screenshots:render -- --preset all
bun run screenshots:render -- --preset social --generate-backgrounds
bun run screenshots:render -- --preset all --generate-backgrounds --force
```

Presets:

- `social`: 1080x1920
- `apple`: 1320x2868
- `google`: 1320x2868

Outputs are written to `outputs/product-screenshots/<preset>/<id>.png`. Cached backgrounds live under `_generated/backgrounds` and are reused even when `--generate-backgrounds` is omitted.

Use `--publish` with the Apple or Google preset to copy generated files into the corresponding `mobile/scripts/assets/screenshots` submission folder. Publishing overwrites files with matching IDs.

## Device Frame

Generate the reusable frame once:

```bash
bun run frame:generate
```

The image model creates the realistic shell. Local Sharp processing then normalizes it and cuts an exact transparent screen opening. The approved output belongs at `shared/brand/device-frames/iphone-frame.png` and should be reviewed before use. If it is absent, renders use the built-in CSS frame instead.

An existing source image can be normalized without an API call:

```bash
bun run frame:generate -- --source ./frame-source.png
```

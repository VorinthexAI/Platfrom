# Intro screenshots

These bundled images are byte-for-byte copies of the eight screenshots the
account owner uploaded to the local dev **Screenshots** folder. The originals
remain in Storage, and these unchanged copies serve as sources for the intro.

`graphite-bottom-layer.png` is a reusable, locally composed texture from the
saved graphite artwork. The 15 images in `frames/` combine the selected
screenshot or illustration with that bottom treatment, including a dedicated
conversation illustration for step 8. Screenshot frames
cover the baked-in Android navigation row while retaining the Core input;
the eight source screenshots remain unchanged. The intro displays all 15
frames full-bleed with its animated copy over the top-left. Run `bun run
scripts/compose-onboarding-bottom-layer.ts` from the repository root to
refresh the frames and their contact sheet.

| Asset | Source image | Intro step |
| --- | --- | --- |
| `storage-root.jpg` | `1000015215.jpg` | A home for your work |
| `nested-folder.jpg` | `1000015217.jpg` | Make space your way |
| `core-answer.jpg` | `1000015219.jpg` | A personal AI memory |
| `view-files.jpg` | `1000015221.jpg` | See what Core found |
| `generated-work.jpg` | `1000015223.jpg` | Create and keep it |
| `bulk-selection.jpg` | `1000015225.jpg` | Choose more than one |
| `copy-destination.jpg` | `1000015227.jpg` | Let projects change |
| `chat-context.jpg` | `1000015229.jpg` | Pick up an older thread |

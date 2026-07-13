# Store assets — drop your files here

These folders are read by `bun run submit`. Drop the final images in and
re-run; nothing is generated automatically.

| Folder | What to drop | Requirements |
|---|---|---|
| `screenshots/apple/iphone-6-7/` | App Store iPhone screenshots | 1290×2796 (or 1320×2868) PNG/JPEG, 1–10 files. Only the largest iPhone size is required — Apple scales it down. iPad shots aren't needed (`supportsTablet` is false). |
| `screenshots/google/phone/` | Play Store phone screenshots | JPEG or 24-bit PNG (no alpha), 320–3840px per side, max 2:1 ratio, 2–8 files. |
| `store/play-icon-512.png` | Play Store app icon | 512×512 32-bit PNG. |
| `store/feature-graphic-1024x500.jpg` | Play Store feature graphic | 1024×500 JPEG or 24-bit PNG (no alpha). |

Files upload in alphabetical order — prefix with `01-`, `02-`, … to
control the order in the store listing.

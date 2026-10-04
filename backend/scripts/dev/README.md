# Workshop Year dev files

Start local ArangoDB, Redis, and LocalStack with `bun run --cwd backend dev:infra`.
The target account must already exist in the local `vorinthex` database.

```sh
bun run --cwd backend dev:files:seed --email=person@example.com
bun run --cwd backend dev:chats:record --email=person@example.com
bun run --cwd backend dev:files:wipe --email=person@example.com
```

`dev:files:seed` creates a dedicated **The Workshop Year** scope for that user,
with 30 dated documents (Markdown, text, PDF, DOCX), 20 generated images,
10 generated MP3s, and five generated five-second MP4s. The file types are
mixed between the scope root and nested project folders. It uses the same
`agent.image`, `agent.speech`, and `agent.video` capabilities as Core. Provider
generation can take time and incur costs. Reruns reuse persisted file keys or
media cached in the gitignored `backend/scripts/dev/assets/` directory. Reruns
relocate only the fixture files and remove their old folders when empty; other
files and chats are preserved. The seed leaves the user's other scopes intact
and selects the new scope once complete.

The same seed imports six Workshop Year Core chats (12 messages each) from
`workshop-chat-transcripts.json`. They mix workspace reads with ordinary
conversation, preserve navigable file references, and use stable chat/turn keys
so reruns do not duplicate them or call a model. The transcript was recorded
once through the real Core conversation service using `dev:chats:record`;
recording it again makes paid provider calls for turns that are not already
stored locally. The transcript contains only fictional fixture content and
portable file names, never account or storage keys. The seed does not replace
the user's other chats.

`dev:files:wipe` removes **every** file and folder belonging to the specified
dev user, deletes all their non-main scopes, and leaves their main scope empty.
It queues stored objects through the backend's fenced storage-deletion outbox.
It does not delete the account. Both commands reject non-local infrastructure.

## iPhone upload format smoke

Run `bun run --cwd backend dev:iphone:verify` while LocalStack is running.
The script checks that selected image formats target PNG (including HEIC/HEIF),
that MOV retains `video/quicktime`, and that PNG previews for images and videos
reservations validate. It generates an alpha-channel PNG and a real tiny
HEVC-in-MOV sample with the local `ffmpeg-static` executable (or `FFMPEG_PATH`
if supplied), decodes a PNG video preview frame, transfers both originals and
thumbnails through local signed S3 PUTs, verifies MIME/size/round-trip bytes,
and deletes its objects. A mocked OpenRouter response verifies the MOV caption
adapter sends the original HEVC video bytes as `video/mov`, like MP4 captioning,
not just its preview. Add `--live` to run one paid caption through the configured
text action after the mocked check. No database write occurs. Native iPhone
conversion, thumbnail generation, and playback still need an iPhone build to check.

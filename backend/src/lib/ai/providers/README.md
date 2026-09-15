# AI Providers

Providers are transport adapters for external AI services. They translate
provider-neutral action contracts into provider requests and normalize output,
usage, cost, streaming events, and errors.

## Ownership

- `registry.ts` owns provider registration, model metadata, environment
  resolution, and internal-to-external model identifiers.
- `types.ts` owns normalized provider contracts shared by adapters and routing.
- `errors.ts` owns provider error normalization.
- `openrouter.ts` owns the external model API transport behavior, including
  raw document files and image bytes used by Core and document transcription.

Credentials and model configuration come from trusted environment variables.
They are never accepted through model-visible tool or action input and are
never stored in the database.

## Document transcription

The canonical `document.parse` tool imports a file or an ordered pages array.
PDFs and page images use `actions/document-transcription.ts`, which calls the
existing provider-neutral `text` action with raw file/image content, exactly the
transport used for Core attachments. The provider still applies its configured
PDF file-parser plugin. TXT/Markdown and Word documents use local decoders.

Transcription uses a fixed faithful-transcription prompt, structured completion
output, and an explicit output-token bound. Truncated, incomplete, malformed, or
tool-call responses are rejected rather than persisted. Originals/source images
remain available. There is no Textract staging or polling in ingestion.

`document.parse` has no fixed tool price. Its text actions use the normal token
billing fallback. Embeddings retain the existing global action pricing policy.

Run `bun run test:document-ingestion:live` from `backend` to verify the HTTP
upload/page transport, real model transcription, real embeddings, local S3 bytes,
ArangoDB persistence, folder listing, and idempotent replay. It uses an isolated
test principal and temporary local database, creates its own TXT/PDF/large PNG
fixtures, and removes its test objects/database afterward. Local ArangoDB and
LocalStack must already be running.

For completion-time and token measurements against the same PDF/image fixtures,
run `bun run bench:document-transcription:live --filter=pdf-text-1page --samples=3`.

## Route Slots

Actions bind trusted slots such as `text.primary` and `image.primary` to exact
provider/model pairs. Callers select slots through the action execution
options documented in [the actions guide](../actions/README.md). They do not
pass raw provider credentials or external model identifiers.

An unavailable provider is skipped during route selection. An optional slot
that is not declared by the action is also ignored when another requested slot
is usable. Execution fails when no requested route is operational.

## Adding A Provider

1. Implement the normalized adapter contract without domain business logic.
2. Register its environment schema, factory, models, and external identifiers.
3. Bind it to an action slot rather than selecting it inside a tool.
4. Add contract tests for success, malformed output, normalized errors,
   timeouts, and streaming when supported.
5. Add a bounded live smoke test when credentials and API cost permit it.

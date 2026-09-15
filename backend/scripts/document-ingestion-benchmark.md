# Mocked document-ingestion performance

Run from the repository root:

```bash
bun run --cwd backend bench:document-ingestion
bun run --cwd backend bench:document-ingestion --samples=20 --warmups=2 --filter=pdf
bun run --cwd backend bench:document-ingestion --json
```

Use `--output=<existing-directory>/report.json` to save a JSON report. Each
report contains runtime/platform metadata, input and JSON request sizes,
extracted character and chunk counts, HTTP status, mocked dependency call
counts, raw measurements, and min/median/p95/max/mean durations. It includes
per-stage distributions for request encoding, HTTP/transport overhead,
validation, storage upload, extraction, cleanup, embedding preparation, and
persistence. Scans report normalization/OCR together as `scan`.

## Coverage

- TXT, Markdown, PDF, DOC, and DOCX at 1 KiB, 64 KiB, 256 KiB, and 1 MiB.
- One-word and multilingual documents.
- Larger text, 4/8/25 MiB PDF containers, and an 8 MiB DOCX container.
- PNG/JPEG scans with different resolutions and 1, 4, or 12 pages.
- Expected rejections: over 25 MiB uploads, text exceeding 640 semantic chunks,
  scans over 8 MiB per page, over 16 MiB total, and more than 12 pages.

The larger binary-container fixtures hold 128 KiB of mocked extracted text.
Their byte size and extracted text size are intentionally separate, as in an
image-heavy PDF. DOC/DOCX/PDF files are synthetic signature-valid containers;
this benchmark does not measure real Word decoding or OCR quality.

## What is measured

Real work includes JSON serialization/body parsing, base64 validation/decoding,
file signature checks, hashing, TXT/Markdown decoding, text cleanup, semantic
chunking, schema validation, and scan image decoding/normalization with Sharp.

OCR, DOC/DOCX decoding, embedding providers, database writes, object storage,
and authentication are in-memory mocks. There are no paid provider calls or
database/Redis requirements. The package command disables dotenv loading.

Each sample uses fresh in-memory state, avoiding idempotent-replay shortcuts.
Fixture generation, setup, assertions, reporting, and explicit garbage
collection between samples are excluded from the timed request. Normal GC
inside a request remains part of its duration. Warmups are excluded. Runs are
serial, not a concurrent-load or production-latency test.

The default is five measured samples after one warmup per case. With five
samples, nearest-rank p95 equals the maximum; use 20 or more samples for a more
useful percentile. There are no fixed millisecond assertions, since timing
depends on the machine. Unexpected failures still fail the command.

For real model transcription and persistence verification, use the separate
`bun run --cwd backend test:document-ingestion:live` command.

For repeated model-transcription duration and token measurements, use
`bun run --cwd backend bench:document-transcription:live`.
The [historical AWS baseline](document-ocr-performance-live.md) is retained for
comparison; it is no longer an ingestion implementation.

## Recorded local baseline

2026-09-15, Bun 1.3.11, Windows x64, 1,536 embedding dimensions. Twenty
measured samples and two warmups for each of 37 cases: 740 measured requests,
including five expected rejection scenarios. These are mock-service/local CPU
measurements, not predictions of production upload completion time.

| Case | Median | p95 |
| --- | ---: | ---: |
| One-word TXT | 1.55 ms | 1.89 ms |
| 64 KiB TXT | 4.41 ms | 5.50 ms |
| 1 MiB TXT | 60.48 ms | 62.96 ms |
| 1 MiB Markdown | 69.20 ms | 81.00 ms |
| 1 MiB PDF, mocked extraction | 62.82 ms | 65.91 ms |
| 1 MiB DOC, mocked decoding | 57.97 ms | 62.54 ms |
| 1 MiB DOCX, mocked decoding | 65.31 ms | 76.56 ms |
| 4 MiB TXT | 218.58 ms | 261.08 ms |
| 8 MiB PDF, 128 KiB extracted text | 50.31 ms | 57.51 ms |
| 25 MiB PDF, 128 KiB extracted text | 115.22 ms | 128.16 ms |
| 5.16 MiB PNG scan, 1 page | 24.70 ms | 28.46 ms |
| PNG scan, 4 pages / 3.01 MiB | 22.24 ms | 25.00 ms |
| PNG scan, 12 pages / 2.26 MiB | 37.17 ms | 41.97 ms |

The 4 MiB text case generated 402 chunks. Its median embedding-preparation
stage was 88.72 ms and insertion/schema-validation stage was 108.83 ms; the
actual model and database were mocked. The 8 MiB text fixture exceeded the
existing 640-chunk cap and was correctly recorded as rejected. That limit
depends on text structure/word density, not solely on file bytes.

# Model-based document transcription

`document.parse` accepts either a file or an ordered page-image array. PDF and
image sources are transcribed through the same text action and provider-native
file/image transport used by Core attachments. TXT, Markdown, DOC, and DOCX retain
their local decoders. The public scan tool and fixed parsing/scanning Spark
prices have been removed. Pricing follows actual AI-action usage.

## Verification commands

```bash
bun run --cwd backend test:document-ingestion:live
bun run --cwd backend bench:document-transcription:live --filter=pdf-text-1page --samples=3
bun run --cwd backend bench:document-transcription:live --filter=pdf-text --samples=1 --output=<existing-directory>/transcription.json
```

The ingestion test uses real transcription and embeddings, local S3, and an
isolated ArangoDB database. Authentication and the debit ledger are fixtures;
the real billing observer must emit token-based action debits and zero fixed
tool debits. Replays must not regenerate or debit again. Objects/database are
cleaned up afterward.

The benchmark measures full transcription completion, including provider PDF
preprocessing. Its fixture page headings and numbered source records must all
appear, so a short summary cannot pass as a complete transcription. Input/output
tokens and their calculated fallback Spark cost are included in the report.
The benchmark itself does not debit a real user's wallet.

## Recorded verification, 2026-09-15

The one-page PDF completed in **2.45, 2.04, and 2.14 seconds** across three runs,
using 708 input tokens and 426 output tokens each: **0.19872 Sparks** at the
current fallback rates. The old asynchronous AWS baseline had a 46.84-second
median for this fixture.

A subsequent full-record coverage run measured:

| PDF | Duration | Input tokens | Output tokens | Action Sparks | Records verified |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 page | 4.60 s | 708 | 426 | 0.19872 | 28 |
| 5 pages | 5.70 s | 2,060 | 1,794 | 0.8 | 140 |
| 20 pages | 16.22 s | 7,153 | 6,106 | 2.72852 | 560 |

One earlier coverage attempt returned an incomplete stop state and was rejected
by the completion guard; the rerun above passed. The guard rejects truncated,
incomplete, malformed, or tool-call output rather than persisting partial text.
These measurements are samples, not latency guarantees: full transcription of
long documents can be output-token-bound.

The live ingestion test also passed TXT upload, PDF transcription, a 7.2 MB page
image, original/source-byte retrieval, folder listing, and idempotent replay.
Its billing observer recorded two text-action debits (52,240 and 61,200
micro-Sparks from actual provider token usage) and **zero fixed tool debits**.

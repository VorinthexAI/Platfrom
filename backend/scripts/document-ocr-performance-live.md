# Historical AWS OCR performance

This is the pre-migration Textract baseline, retained for comparison. The AWS
ingestion implementation and its runner have been removed. The current unified
`document.parse` pipeline uses model transcription. Measure it with:

```bash
bun run --cwd backend bench:document-transcription:live --samples=3 --filter=pdf-text-1page
```

The measurements below used real AWS S3 and Textract. Database, embedding-model,
HTTP upload, and UI timings were excluded.

## Historical cases and methodology

- Valid selectable-text PDFs with 1, 5, or 20 pages.
- Valid raster/scanned PDFs with 1, 5, or 18 pages, reaching about 25 MiB.
  These contain actual raster image data rather than padding.
- PNG/JPEG images at three resolutions. Image normalization matches camera-scan
  ingestion: rotate and encode PNG before calling Textract.
- TXT/Markdown and DOC/DOCX are not submitted: those formats use local decoders
  in the application, not AWS OCR. Their synthetic fixtures from the mock
  benchmark would not be valid Textract inputs.

Each repetition uses a fresh PDF staging key and therefore a fresh Textract
request token/job. Runs are serial with fresh SDK clients. There are no paid
warmups. Default: three samples per case, configurable from one to ten.

**OCR duration** measures the image extraction call or PDF job submission through
the final result response. It includes network/SDK overhead and asynchronous PDF
polling; it is not a server-only processing measurement. **Total duration** also
includes image normalization or S3 PDF staging and deletion. Fixture generation
and the additional HEAD check confirming S3 deletion are outside the measured
total. The JSON report records these stages, poll counts, original/submitted byte
sizes, extracted character counts, detected pages, confidence, and raw timings.

Every result must contain the verification text and expected page count.
Temporary PDF staging objects are deleted and their absence is verified. The
report is saved after each completed case when `--output` is supplied.

## Recorded AWS run

2026-09-15, `eu-west-1`, Bun 1.3.11, Windows. Nine cases, three repetitions:
**27 successful OCR runs / 159 pages**. All content/page-count and cleanup
checks passed.

| Case | Input size | Pages | Median OCR | Median total | Total range |
| --- | ---: | ---: | ---: | ---: | ---: |
| Text PDF | 2.4 KiB | 1 | 46.56 s | 46.84 s | 21.65–90.69 s |
| Text PDF | 10.8 KiB | 5 | 14.81 s | 15.09 s | 8.27–32.25 s |
| Text PDF | 42.5 KiB | 20 | 12.35 s | 12.69 s | 11.91–15.03 s |
| Scanned PDF | 1.37 MiB | 1 | 5.33 s | 5.54 s | 4.47–5.56 s |
| Scanned PDF | 6.87 MiB | 5 | 5.49 s | 11.32 s | 11.24–11.41 s |
| Scanned PDF | 24.73 MiB | 18 | 12.14 s | 14.34 s | 13.95–32.45 s |
| PNG, 600×800 | 1.38 MiB | 1 | 1.30 s | 1.31 s | 1.29–1.43 s |
| PNG, 1800×1000 | 5.16 MiB | 1 | 1.19 s | 1.22 s | 1.21–1.24 s |
| JPEG, 1800×2400 | 0.31 MiB | 1 | 2.06 s | 2.14 s | 1.82–2.26 s |

Three samples are exploratory measurements, not latency guarantees. The observed
PDF variability means file size alone did not predict latency in this run; the
small one-page PDF was sometimes slower than larger documents. Do not interpret
the table as evidence that larger files are generally faster. Image byte sizes
above refer to the input; normalized PNG payload sizes are in the JSON report.

import { expect, test } from 'bun:test';
import { createBenchmarkRunner, createDocumentBenchmarkCase, documentBenchmarkCases, runDocumentBenchmarks, summarizeDurations } from './document-ingestion-benchmark';

test('duration summaries calculate even/odd medians and nearest-rank p95 without mutating samples', () => {
  const values = [4, 1, 3, 2];
  expect(summarizeDurations(values)).toEqual({ minMs: 1, medianMs: 2.5, p95Ms: 4, maxMs: 4, meanMs: 2.5 });
  expect(values).toEqual([4, 1, 3, 2]);
  expect(summarizeDurations([3, 1, 2]).medianMs).toBe(2);
  expect(() => summarizeDurations([])).toThrow();
});

test('all upload formats run the real pipeline with isolated mocked service dependencies', async () => {
  for (const format of ['txt', 'md', 'pdf', 'doc', 'docx'] as const) {
    const run = await createBenchmarkRunner(createDocumentBenchmarkCase(format, 1024));
    const first = await run(), second = await run();
    for (const result of [first, second]) {
      expect(result.status).toBe('success');
      expect(result.mockCalls.writes).toBe(1);
      expect(result.mockCalls.embeddings).toBe(1);
      expect(result.mockCalls.ocr).toBe(format === 'pdf' ? 1 : 0);
      expect(result.mockCalls.decoder).toBe(format === 'doc' || format === 'docx' ? 1 : 0);
      expect(result.inputBytes).toBe(1024);
      expect(result.totalMs).toBeGreaterThan(0);
      expect(Object.keys(result.stages).sort()).toEqual(['cleanup', 'embed', 'encode', 'extract', 'insert', 'transport', 'upload', 'validate']);
    }
  }
});

test('scanned images use real normalization and chunking with mocked OCR', async () => {
  const scenario = documentBenchmarkCases().find(({ name }) => name === 'png-256x256-1page')!;
  const result = await (await createBenchmarkRunner(scenario))();
  expect(result.status).toBe('success');
  expect(result.pages).toBe(1);
  expect(result.mockCalls).toEqual({ ocr: 1, decoder: 0, embeddings: 1, writes: 1, uploads: 1 });
  expect(result.stages.scan).toBeGreaterThan(0);
});

test('oversized uploads are rejected before mocked storage or model work', async () => {
  const result = await (await createBenchmarkRunner(createDocumentBenchmarkCase('pdf', 25 * 1024 * 1024 + 1, 1024, 'rejected', 'DOCUMENT_TOO_LARGE')))();
  expect(result.status).toBe('rejected');
  expect(result.mockCalls).toEqual({ ocr: 0, decoder: 0, embeddings: 0, writes: 0, uploads: 0 });
});

test('scan page-count limits are recorded as rejected before OCR or storage', async () => {
  const scenario = documentBenchmarkCases().find(({ name }) => name === 'png-256x256-13page')!;
  const result = await (await createBenchmarkRunner(scenario))();
  expect(result.status).toBe('rejected');
  expect(result.httpStatus).toBe(400);
  expect(result.mockCalls).toEqual({ ocr: 0, decoder: 0, embeddings: 0, writes: 0, uploads: 0 });
});

test('reports exclude warmups and include raw samples and stage distributions', async () => {
  const report = await runDocumentBenchmarks({ samples: 2, warmups: 1, filter: 'txt-one-word' });
  expect(report.rows).toHaveLength(1);
  expect(report.rows[0]!.samples).toHaveLength(2);
  expect(report.rows[0]!.durations.minMs).toBeGreaterThan(0);
  expect(report.rows[0]!.stageDurations.embed).toBeDefined();
  await expect(runDocumentBenchmarks({ samples: 0, warmups: 1 })).rejects.toThrow();
});

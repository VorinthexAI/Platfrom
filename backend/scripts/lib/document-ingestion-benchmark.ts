import assert from 'node:assert/strict';
import { Hono } from 'hono';
import sharp from 'sharp';
import { createContentToolHandler } from '../../src/api/content-tools';
import { parseDocument, documentValidate, storageUpload, documentExtract, documentCleanup, documentEmbed, documentInsert, type DocumentParseInput, type DocumentObjectStorage } from '../../src/lib/ai/document-processing';
import { EMBEDDING_DIMENSIONS } from '../../src/lib/embeddings';
import type { Document } from '../../src/lib/db/documents.node';

const KiB = 1024;
const MiB = KiB * KiB;
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const userKey = 'cmrnlzf650002qc7k4p5zem5w';
const mimeTypes = { txt: 'text/plain', md: 'text/markdown', pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } as const;
type Format = keyof typeof mimeTypes;
type FixtureFile = { filename: string; mimeType: string; bytes: Uint8Array };

export interface BenchmarkCase {
  name: string;
  format: Format | 'png' | 'jpeg';
  expected: 'success' | 'rejected';
  expectedError?: string;
  build(): Promise<{ files: FixtureFile[]; extractedText: string }>;
}
export interface BenchmarkSample {
  totalMs: number;
  stages: Record<string, number>;
  inputBytes: number;
  requestBytes: number;
  extractedCharacters: number;
  pages: number;
  chunks: number;
  status: 'success' | 'rejected';
  httpStatus: number;
  error?: string;
  mockCalls: { ocr: number; decoder: number; embeddings: number; writes: number; uploads: number };
}
export interface DurationSummary { minMs: number; medianMs: number; p95Ms: number; maxMs: number; meanMs: number }

export function summarizeDurations(values: number[]): DurationSummary {
  assert(values.length > 0 && values.every((value) => Number.isFinite(value) && value >= 0));
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    minMs: sorted[0]!, medianMs: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!, maxMs: sorted.at(-1)!, meanMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

function textOfSize(size: number, markdown = false) {
  const sentence = markdown ? '# Measurement\n\n- Processing documents requires validation extraction normalization and persistence.\n\n' : 'Processing documents requires validation extraction normalization embeddings and persistence.\n';
  return sentence.repeat(Math.ceil(size / sentence.length)).slice(0, size);
}

/** Word/PDF containers are synthetic: only signature validation is benchmarked; decoding is mocked. */
function syntheticContainer(format: 'doc' | 'docx' | 'pdf', size: number) {
  const bytes = Buffer.alloc(size, 1);
  if (format === 'pdf') { bytes.write('%PDF-1.7\n'); bytes.write('\n%%EOF', size - 6); }
  else if (format === 'doc') bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  else {
    bytes.writeUInt32LE(0x04034b50, 0);
    const names = ['[Content_Types].xml', 'word/document.xml'];
    let offset = size - 22 - names.reduce((sum, name) => sum + 46 + Buffer.byteLength(name), 0);
    for (const name of names) {
      bytes.fill(0, offset, offset + 46 + name.length);
      bytes.writeUInt32LE(0x02014b50, offset);
      bytes.writeUInt32LE(1, offset + 20);
      bytes.writeUInt32LE(1, offset + 24);
      bytes.writeUInt16LE(name.length, offset + 28);
      bytes.write(name, offset + 46);
      offset += 46 + name.length;
    }
    bytes.fill(0, offset);
    bytes.writeUInt32LE(0x06054b50, offset);
  }
  return bytes;
}

export function createDocumentBenchmarkCase(format: Format, size: number, extractedSize = size, expected: 'success' | 'rejected' = 'success', expectedError?: string): BenchmarkCase {
  const sizeLabel = size % MiB === 0 ? `${size / MiB}MiB` : size % KiB === 0 ? `${size / KiB}KiB` : `${size}bytes`;
  return {
    name: `${format}-${sizeLabel}`, format, expected, expectedError,
    async build() {
      const extractedText = textOfSize(extractedSize, format === 'md');
      const bytes = format === 'txt' || format === 'md' ? Buffer.from(textOfSize(size, format === 'md')) : syntheticContainer(format, size);
      return { files: [{ filename: `sample.${format}`, mimeType: mimeTypes[format], bytes }], extractedText };
    },
  };
}

function scanCase(format: 'png' | 'jpeg', width: number, height: number, pages: number, expected: 'success' | 'rejected' = 'success'): BenchmarkCase {
  return {
    name: `${format}-${width}x${height}-${pages}page`, format, expected, ...(expected === 'rejected' ? { expectedError: 'CONTENT_INVALID_INPUT' } : {}),
    async build() {
      // Fixture generation is outside the measured request. Uncompressed PNGs
      // deliberately cover multi-MB transport while normalization stays real.
      const image = sharp({ create: { width, height, channels: 3, background: '#eeeeee' } });
      const bytes = await (format === 'png' ? image.png({ compressionLevel: 0 }) : image.jpeg({ quality: 95 })).toBuffer();
      return { files: Array.from({ length: pages }, (_, index) => ({ filename: `page-${index + 1}.${format}`, mimeType: `image/${format}`, bytes })), extractedText: textOfSize(4 * KiB) };
    },
  };
}

export function documentBenchmarkCases(): BenchmarkCase[] {
  return [
    { name: 'txt-one-word', format: 'txt', expected: 'success', build: async () => ({ files: [{ filename: 'word.txt', mimeType: 'text/plain', bytes: Buffer.from('Hello') }], extractedText: 'Hello' }) },
    { name: 'txt-multilingual', format: 'txt', expected: 'success', build: async () => { const extractedText = 'Hello café 日本語 مرحبا 👋\n'.repeat(2048); return { files: [{ filename: 'unicode.txt', mimeType: 'text/plain', bytes: Buffer.from(extractedText) }], extractedText }; } },
    ...(['txt', 'md', 'pdf', 'doc', 'docx'] as const).flatMap((format) => [KiB, 64 * KiB, 256 * KiB, MiB].map((size) => createDocumentBenchmarkCase(format, size))),
    createDocumentBenchmarkCase('txt', 4 * MiB),
    createDocumentBenchmarkCase('txt', 8 * MiB, 8 * MiB, 'rejected', 'DOCUMENT_EMBEDDING_FAILED'),
    ...[4 * MiB, 8 * MiB, 25 * MiB].map((size) => createDocumentBenchmarkCase('pdf', size, 128 * KiB)),
    createDocumentBenchmarkCase('docx', 8 * MiB, 128 * KiB),
    createDocumentBenchmarkCase('pdf', 25 * MiB + 1, 128 * KiB, 'rejected', 'DOCUMENT_TOO_LARGE'),
    scanCase('png', 256, 256, 1), scanCase('png', 1800, 1000, 1), scanCase('jpeg', 1800, 1000, 1),
    scanCase('png', 512, 512, 4), scanCase('png', 256, 256, 12),
    scanCase('png', 2000, 1400, 1, 'rejected'), scanCase('png', 1800, 1000, 4, 'rejected'), scanCase('png', 256, 256, 13, 'rejected'),
  ];
}

export async function createBenchmarkRunner(scenario: BenchmarkCase) {
  const fixture = await scenario.build();
  const scan = scenario.format === 'png' || scenario.format === 'jpeg';
  return async (): Promise<BenchmarkSample> => {
    const stages: Record<string, number> = {};
    const mockCalls = { ocr: 0, decoder: 0, embeddings: 0, writes: 0, uploads: 0 };
    const objects = new Map<string, Uint8Array>();
    let persisted: Document | undefined;
    let chunks = 0;
    let pipelineFailure: { code?: string; message: string } | undefined;
    const measure = async <T>(stage: string, operation: () => Promise<T>): Promise<T> => {
      const start = performance.now();
      try { return await operation(); }
      catch (error) {
        if (error instanceof Error) pipelineFailure = { ...('code' in error && typeof error.code === 'string' ? { code: error.code } : {}), message: error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message };
        throw error;
      } finally { stages[stage] = (stages[stage] ?? 0) + performance.now() - start; }
    };
    const storage: DocumentObjectStorage = {
      upload: async ({ key, bytes }) => { mockCalls.uploads += 1; objects.set(key, bytes); return { storageKey: key }; },
      delete: async (key) => { objects.delete(key); },
      download: async (key) => { const bytes = objects.get(key); assert(bytes); return { bytes }; },
      copy: async () => { throw new Error('Unexpected copy in benchmark'); },
    };
    const transcribe = async () => { mockCalls.ocr += 1; return { text: fixture.extractedText }; };
    const embedBatch = async ({ texts }: { texts: string[] }) => { mockCalls.embeddings += 1; chunks = texts.length; return texts.map(() => Array<number>(EMBEDDING_DIMENSIONS).fill(0.125)); };
    const insert = async (document: Document) => { mockCalls.writes += 1; persisted = document; return document; };
    const quiet = () => undefined;
    const app = new Hono().post('/content/tools/:tool', createContentToolHandler({
      getIdentity: async () => ({ key: userKey, identityType: 'user' }),
      run: async ({ input }) => {
        const ingestionStart = performance.now();
        const { document } = await parseDocument(input as DocumentParseInput, {
            storage, transcribe, teamKey: 'benchmark', embedBatch, insert, getDocument: async () => null, getFolder: async () => null, logger: quiet,
            actions: {
              validate: (...args) => measure('validate', () => documentValidate(...args)),
              upload: (...args) => measure('upload', () => storageUpload(...args)),
              extract: (source, options) => measure('extract', () => documentExtract(source, { ...options, extractDoc: async () => { mockCalls.decoder += 1; return fixture.extractedText; }, extractDocx: async () => { mockCalls.decoder += 1; return fixture.extractedText; } })),
              cleanup: (...args) => measure('cleanup', () => documentCleanup(...args)),
              embed: (...args) => measure('embed', () => documentEmbed(...args)),
              insert: (...args) => measure('insert', () => documentInsert(...args)),
            },
          });
        if (scan) stages.scan = Math.max(0, performance.now() - ingestionStart - Object.values(stages).reduce((sum, duration) => sum + duration, 0) + (stages.encode ?? 0));
        // Match the public projection: never serialize embeddings or full content.
        return { document: { key: document.key, name: document.name } };
      },
    }));
    const start = performance.now();
    const wireFiles = fixture.files.map(({ bytes, ...file }) => ({ ...file, sizeBytes: bytes.byteLength, encoding: 'base64', content: Buffer.from(bytes).toString('base64') }));
    const input = { scopeKey, idempotencyKey: 'benchmark-request', ...(scan ? { pages: wireFiles, name: 'Benchmark' } : { file: wireFiles[0] }) };
    const body = JSON.stringify({ teamKey: 'benchmark', scopeKey, input });
    stages.encode = performance.now() - start;
    const httpStart = performance.now();
    const response = await app.request('/content/tools/document.parse', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'benchmark-request' }, body });
    const result = await response.json() as { success: boolean; error?: { code: string; message: string } };
    const finished = performance.now();
    const totalMs = finished - start;
    const pipelineMs = Object.entries(stages).filter(([stage]) => stage !== 'encode').reduce((sum, [, value]) => sum + value, 0);
    stages.transport = Math.max(0, finished - httpStart - pipelineMs);
    const status = response.status === 200 && result.success ? 'success' : 'rejected';
    assert.equal(status, scenario.expected, `${scenario.name}: ${JSON.stringify(result)}`);
    if (scenario.expectedError) assert.equal(pipelineFailure?.code ?? result.error?.code, scenario.expectedError);
    if (status === 'success') {
      assert(persisted);
      assert(persisted.content.trim());
      assert.equal(mockCalls.writes, 1);
      assert.equal(mockCalls.uploads, fixture.files.length);
      assert(chunks > 0 && persisted.chunkEmbeddings?.length === chunks);
      if (!scan) assert.equal(persisted.content, fixture.extractedText.trim());
    } else assert.equal(mockCalls.writes, 0);
    const failure = pipelineFailure ?? result.error;
    const sample: BenchmarkSample = { totalMs, stages, inputBytes: fixture.files.reduce((sum, file) => sum + file.bytes.byteLength, 0), requestBytes: Buffer.byteLength(body), pages: scan ? fixture.files.length : 0, extractedCharacters: persisted?.content.length ?? fixture.extractedText.length, chunks, status, httpStatus: response.status, ...(failure ? { error: `${failure.code ?? 'ERROR'}: ${failure.message}` } : {}), mockCalls };
    objects.clear();
    persisted = undefined;
    return sample;
  };
}

export async function runDocumentBenchmarks(options: { samples: number; warmups: number; filter?: string }) {
  assert(Number.isSafeInteger(options.samples) && options.samples >= 1 && options.samples <= 100);
  assert(Number.isSafeInteger(options.warmups) && options.warmups >= 0 && options.warmups <= 10);
  const scenarios = documentBenchmarkCases().filter(({ name }) => !options.filter || name.includes(options.filter));
  assert(scenarios.length > 0, 'No benchmark cases matched');
  const rows = [];
  for (const scenario of scenarios) {
    const run = await createBenchmarkRunner(scenario);
    for (let index = 0; index < options.warmups; index += 1) { await run(); Bun.gc(true); }
    const samples: BenchmarkSample[] = [];
    for (let index = 0; index < options.samples; index += 1) { samples.push(await run()); Bun.gc(true); }
    const stages = [...new Set(samples.flatMap((sample) => Object.keys(sample.stages)))];
    const { totalMs: _firstDuration, stages: _firstStages, ...metadata } = samples[0]!;
    rows.push({ name: scenario.name, format: scenario.format, ...metadata, durations: summarizeDurations(samples.map(({ totalMs }) => totalMs)), stageDurations: Object.fromEntries(stages.map((stage) => [stage, summarizeDurations(samples.map((sample) => sample.stages[stage] ?? 0))])), samples });
  }
  return { mode: 'mocked-ingestion', generatedAt: new Date().toISOString(), runtime: Bun.version, platform: process.platform, architecture: process.arch, embeddingDimensions: EMBEDDING_DIMENSIONS, measuredSamples: options.samples, warmups: options.warmups, gcBetweenSamples: true, mocks: ['OCR', 'DOC/DOCX decoding', 'embedding provider', 'object storage', 'database writes', 'authentication'], realWork: ['JSON/base64 transport', 'input/signature validation', 'SHA-256 hashing', 'TXT/Markdown decoding', 'text cleanup', 'chunking', 'document schemas', 'scan image normalization'], rows };
}

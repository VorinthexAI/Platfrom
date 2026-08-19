import { describe, expect, test } from 'bun:test';
import { DeleteObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { GetDocumentTextDetectionCommand, StartDocumentTextDetectionCommand, type Block, type TextractClient } from '@aws-sdk/client-textract';
import { parseDocument } from '.';
import type { Document } from '@/lib/db/documents.node';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import {
  createAwsTextractDocumentOcr,
  documentCleanup,
  documentEmbed,
  documentExtract,
  documentInsert,
  documentKeyForRequest,
  documentSemanticHash,
  documentValidate,
  storageUpload,
  textractBlocksToExtractionResult,
  type DocumentPipelineActions,
  type DocumentParseResult,
  type DocumentStorage,
  type NormalizedDocument,
} from '.';

const scopeKey = 'cmrnlzf640000qc7k4p5zem5w';
const folderKey = 'cmrnlzf640001qc7k4p5zem5w';
const documentKey = 'cmrnlzf640002qc7k4p5zem5w';
const timestamp = '2026-07-22T00:00:00.000Z';
const folder = { key: folderKey, scopeKey, name: 'Folder', isFavorite: false, embedding: [], createdAt: timestamp, updatedAt: timestamp };
const quiet = () => undefined;
const bytes = (text: string) => new TextEncoder().encode(text);
const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

function minimalDocxBytes(): Uint8Array {
  const names = ['[Content_Types].xml', 'word/document.xml'];
  const local = new Uint8Array(30);
  new DataView(local.buffer).setUint32(0, 0x04034b50, true);
  const central = names.map((name) => {
    const encoded = bytes(name);
    const entry = new Uint8Array(46 + encoded.length);
    const view = new DataView(entry.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(20, 1, true);
    view.setUint32(24, 1, true);
    view.setUint16(28, encoded.length, true);
    entry.set(encoded, 46);
    return entry;
  });
  const end = new Uint8Array(22);
  new DataView(end.buffer).setUint32(0, 0x06054b50, true);
  const result = new Uint8Array(local.length + central.reduce((sum, entry) => sum + entry.length, 0) + end.length);
  let offset = 0;
  for (const part of [local, ...central, end]) { result.set(part, offset); offset += part.length; }
  return result;
}

const fileFor = (extension: string) => {
  const fixtures: Record<string, { mimeType: string; bytes: Uint8Array }> = {
    txt: { mimeType: 'text/plain', bytes: bytes('Plain text') },
    md: { mimeType: 'text/markdown', bytes: bytes('# Markdown') },
    doc: { mimeType: 'application/msword', bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1]) },
    docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: minimalDocxBytes() },
    pdf: { mimeType: 'application/pdf', bytes: bytes('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF') },
  };
  const fixture = fixtures[extension]!;
  return { filename: `report.${extension}`, mimeType: fixture.mimeType, sizeBytes: fixture.bytes.length, bytes: fixture.bytes };
};

const normalized = (extension: 'txt' | 'md' | 'doc' | 'docx' | 'pdf', fileInput = fileFor(extension).bytes): NormalizedDocument => ({
  name: 'Report', extension, mimeType: fileFor(extension).mimeType, sizeBytes: fileInput.length,
  scopeKey, folderKey, fileInput: new Uint8Array(fileInput),
});

const completeDocument = (overrides: Partial<Document> = {}): Document => ({
  key: documentKey, scopeKey, folderKey, name: 'Report', extension: 'txt', mimeType: 'text/plain',
  storageKey: `content/${scopeKey}/${folderKey}/${documentKey}/original.txt`, sizeBytes: 10,
  content: 'Report\n\nBody', embedding,
  isFavorite: false, createdAt: timestamp, updatedAt: timestamp, ...overrides,
});

describe('document-validate action', () => {
  test('accepts every supported extension and MIME signature', async () => {
    for (const extension of ['txt', 'md', 'doc', 'docx', 'pdf'] as const) {
      const result = await documentValidate({ file: fileFor(extension), scopeKey, folderKey }, { logger: quiet });
      expect(result.extension).toBe(extension);
      expect(result.name).toBe('report');
    }
  });

  test('rejects unsupported extensions, MIME mismatches, missing folders, and oversized files', async () => {
    const unsupportedBytes = bytes('rich text');
    await expect(documentValidate({ file: { filename: 'x.rtf', mimeType: 'application/rtf', sizeBytes: unsupportedBytes.length, bytes: unsupportedBytes }, scopeKey, folderKey }, { logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_UNSUPPORTED_TYPE', action: 'document-validate' });
    await expect(documentValidate({ file: { ...fileFor('pdf'), mimeType: 'text/plain' }, scopeKey, folderKey }, { logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_INVALID_MIME_TYPE' });
    await expect(documentValidate({ file: fileFor('txt'), scopeKey, folderKey: '' }, { logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_VALIDATION_FAILED' });
    await expect(documentValidate({ file: fileFor('txt'), scopeKey, folderKey }, { logger: quiet, maxBytes: 2 })).rejects.toMatchObject({ code: 'DOCUMENT_TOO_LARGE' });
  });

  test('rejects malformed DOCX archives before extraction', async () => {
    const malformed = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]);
    await expect(documentValidate({ file: { filename: 'x.docx', mimeType: fileFor('docx').mimeType, sizeBytes: malformed.length, bytes: malformed }, scopeKey, folderKey }, { logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_UPLOAD_INVALID' });
  });

  test('rejects truncated PDFs and unsafe cross-platform filenames', async () => {
    const truncated = bytes('%PDF-1.7\ntruncated');
    await expect(documentValidate({ file: { filename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: truncated.length, bytes: truncated }, scopeKey }, { logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_UPLOAD_INVALID' });
    await expect(documentValidate({ file: { ...fileFor('txt'), filename: 'folder\\report.txt' }, scopeKey }, { logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_INVALID_FILENAME' });
    await expect(documentValidate({ file: { ...fileFor('txt'), filename: 'folder/report.txt' }, scopeKey }, { logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_INVALID_FILENAME' });
  });
});

describe('document-cleanup action', () => {
  test('cleans chunks in source order and normalizes extraction whitespace without stripping meaningful symbols', async () => {
    const source = `${'First section has value €42 and café. '.repeat(500)}\n\n###\nSecond\tsection.\u0000\n||||`;
    const chunks: string[] = [];
    const result = await documentCleanup({ text: source }, {
      logger: quiet,
      clean: async (text) => { chunks.push(text); return text.includes('Second') ? 'Second section.' : 'First section has value €42 and café.'; },
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(result.content).toContain('€42 and café.');
    expect(result.content).toEndWith('Second section.');
    expect(result.content).not.toContain('\t');
    expect(result.content).not.toContain('\u0000');
    expect(result.content).not.toContain('###');
    expect(result.content).not.toContain('||||');
  });

  test('uses deterministic cleanup without a model and rejects empty model output', async () => {
    await expect(documentCleanup({ text: 'Body\r\n\r\n\tSecond  line' }, { logger: quiet })).resolves.toEqual({ content: 'Body\n\n\tSecond  line' });
    await expect(documentCleanup({ text: 'Body' }, { logger: quiet, clean: async () => '   ' })).rejects.toMatchObject({ code: 'DOCUMENT_TEXT_CLEANUP_FAILED', action: 'document-cleanup' });
  });

  test('keeps chunk output ordered when concurrent model calls finish out of order', async () => {
    const source = ['FIRST', 'SECOND', 'THIRD'].map((label) => `${label} ${'word '.repeat(800)}`).join('\n\n');
    let active = 0;
    let maximumActive = 0;
    const result = await documentCleanup({ text: source }, {
      logger: quiet,
      clean: async (text) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const label = text.trimStart().split(' ')[0]!;
        await new Promise((resolve) => setTimeout(resolve, label === 'FIRST' ? 20 : label === 'SECOND' ? 10 : 1));
        active -= 1;
        return label;
      },
    });
    expect(result.content).toBe('FIRST\n\nSECOND\n\nTHIRD');
    expect(maximumActive).toBe(3);
  });
});

describe('document-extract action', () => {
  test('extracts TXT and Markdown as plain text', async () => {
    const txt = await documentExtract({ ...normalized('txt', bytes('First\n\nSecond')), storageKey: 'txt' }, { logger: quiet });
    expect(txt.extractedText).toBe('First\n\nSecond');
    const md = await documentExtract({ ...normalized('md', bytes('# Title\n- One\n- Two')), storageKey: 'md' }, { logger: quiet });
    expect(md.extractedText).toBe('# Title\n- One\n- Two');
  });

  test('rejects empty and invalid UTF-8 text files during extraction', async () => {
    await expect(documentExtract({ ...normalized('txt', bytes('   ')), storageKey: 'txt' }, { logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_EXTRACTION_FAILED' });
    await expect(documentExtract({ ...normalized('md', new Uint8Array([0xff, 0xfe])), storageKey: 'md' }, { logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_EXTRACTION_FAILED' });
  });

  test('uses format adapters for DOC and DOCX', async () => {
    const doc = await documentExtract({ ...normalized('doc'), storageKey: 'doc' }, { logger: quiet, extractDoc: async () => 'Legacy Word' });
    const docx = await documentExtract({ ...normalized('docx'), storageKey: 'docx' }, { logger: quiet, extractDocx: async () => 'Modern Word' });
    expect(doc.extractedText).toBe('Legacy Word');
    expect(docx.extractedText).toBe('Modern Word');
  });

  test('normalizes text-based and scanned PDFs through OCR', async () => {
    for (const text of ['Selectable PDF', 'Scanned OCR']) {
      const result = await documentExtract({ ...normalized('pdf'), storageKey: 'pdf' }, { logger: quiet, ocr: { extract: async () => ({ extractedText: text, metadata: { provider: 'aws-textract' } }) } });
      expect(result.extractedText).toBe(text);
    }
  });

  test('stages and extracts selectable, scanned, and multi-page dummy PDFs through Textract', async () => {
    const fixtures: Array<{ name: string; pdf: Uint8Array; blocks: Block[]; text: string; pages: number }> = [
      {
        name: 'selectable',
        pdf: bytes('%PDF-1.7\n1 0 obj<</Type/Page/Contents 2 0 R>>endobj\n2 0 obj<</Length 36>>stream\nBT (Selectable quarterly report) Tj ET\nendstream\nendobj\n%%EOF'),
        blocks: [{ Id: 'selectable', BlockType: 'LINE', Page: 1, Text: 'Selectable quarterly report' }],
        text: 'Selectable quarterly report',
        pages: 1,
      },
      {
        name: 'scanned',
        pdf: bytes('%PDF-1.7\n1 0 obj<</Type/Page/Resources<</XObject<</Scan 2 0 R>>>>>>endobj\n2 0 obj<</Subtype/Image/Width 1200/Height 1600/BitsPerComponent 8>>stream\nDUMMY-SCANNED-PIXELS\nendstream\nendobj\n%%EOF'),
        blocks: [{ Id: 'scan-line', BlockType: 'LINE', Page: 1, Text: 'OCR from scanned invoice' }],
        text: 'OCR from scanned invoice',
        pages: 1,
      },
      {
        name: 'multi-page-table',
        pdf: bytes('%PDF-1.7\n1 0 obj<</Type/Pages/Count 2/Kids[2 0 R 3 0 R]>>endobj\n2 0 obj<</Type/Page/Parent 1 0 R>>endobj\n3 0 obj<</Type/Page/Parent 1 0 R>>endobj\n%%EOF'),
        blocks: [
          { Id: 'page-one', BlockType: 'LINE', Page: 1, Text: 'Annual results' },
          { Id: 'page-two', BlockType: 'LINE', Page: 2, Text: 'Revenue' },
        ],
        text: 'Annual results\n\nRevenue',
        pages: 2,
      },
    ];

    for (const fixture of fixtures) {
      const storageCommands: Array<PutObjectCommand | DeleteObjectCommand> = [];
      const textractCommands: Array<StartDocumentTextDetectionCommand | GetDocumentTextDetectionCommand> = [];
      const storageClient = {
        send: async (command: PutObjectCommand | DeleteObjectCommand) => {
          storageCommands.push(command);
          return {};
        },
      } as unknown as Pick<S3Client, 'send'>;
      const textractClient = {
        send: async (command: StartDocumentTextDetectionCommand | GetDocumentTextDetectionCommand) => {
          textractCommands.push(command);
          return command instanceof StartDocumentTextDetectionCommand
            ? { JobId: `job-${fixture.name}` }
            : { JobStatus: 'SUCCEEDED', Blocks: fixture.blocks };
        },
      } as unknown as Pick<TextractClient, 'send'>;
      const ocr = createAwsTextractDocumentOcr({
        stagingBucket: 'dummy-textract-eu-west-1',
        sourceBucket: 'dummy-source-eu-north-1',
        storageClient,
        textractClient,
      });

      const validated = await documentValidate({
        file: { filename: `${fixture.name}.pdf`, mimeType: 'application/pdf', sizeBytes: fixture.pdf.byteLength, bytes: fixture.pdf },
        scopeKey,
        folderKey,
      }, { logger: quiet });
      const result = await documentExtract({ ...validated, storageKey: `content/${fixture.name}.pdf` }, { logger: quiet, ocr });

      expect(storageCommands).toHaveLength(2);
      expect(storageCommands[0]).toBeInstanceOf(PutObjectCommand);
      expect(storageCommands[0]!.input).toMatchObject({ Bucket: 'dummy-textract-eu-west-1', Body: fixture.pdf, ContentType: 'application/pdf' });
      expect(storageCommands[1]).toBeInstanceOf(DeleteObjectCommand);
      expect(storageCommands[1]!.input).toMatchObject({ Bucket: 'dummy-textract-eu-west-1', Key: storageCommands[0]!.input.Key });
      expect(textractCommands[0]).toBeInstanceOf(StartDocumentTextDetectionCommand);
      expect(textractCommands[0]!.input).toMatchObject({
        DocumentLocation: { S3Object: { Bucket: 'dummy-textract-eu-west-1', Name: storageCommands[0]!.input.Key } },
      });
      expect(textractCommands[1]).toBeInstanceOf(GetDocumentTextDetectionCommand);
      expect(result.extractedText).toBe(fixture.text);
      expect(result.metadata).toMatchObject({ provider: 'aws-textract', pages: fixture.pages });
    }
  });

  test('removes a staged PDF when Textract rejects it', async () => {
    const storageCommands: Array<PutObjectCommand | DeleteObjectCommand> = [];
    const ocr = createAwsTextractDocumentOcr({
      stagingBucket: 'dummy-textract-eu-west-1',
      storageClient: {
        send: async (command: PutObjectCommand | DeleteObjectCommand) => {
          storageCommands.push(command);
          return {};
        },
      } as unknown as Pick<S3Client, 'send'>,
      textractClient: {
        send: async (command: StartDocumentTextDetectionCommand | GetDocumentTextDetectionCommand) => command instanceof StartDocumentTextDetectionCommand
          ? { JobId: 'failed-job' }
          : { JobStatus: 'FAILED' },
      } as unknown as Pick<TextractClient, 'send'>,
    });

    await expect(ocr.extract('content/rejected.pdf', fileFor('pdf').bytes)).rejects.toThrow('could not extract');
    expect(storageCommands.map((command) => command.constructor)).toEqual([PutObjectCommand, DeleteObjectCommand]);
    expect(storageCommands[1]!.input.Key).toBe(storageCommands[0]!.input.Key);
  });

  test('orders detected lines by page and position', () => {
    const result = textractBlocksToExtractionResult([
      { Id: 'value', BlockType: 'LINE', Page: 1, Text: '$10M', Confidence: 96, Geometry: { BoundingBox: { Top: 0.2, Left: 0.1 } } },
      { Id: 'title', BlockType: 'LINE', Page: 1, Text: 'Annual report', Confidence: 99, Geometry: { BoundingBox: { Top: 0.05, Left: 0.1 } } },
      { Id: 'second-page', BlockType: 'LINE', Page: 2, Text: 'Appendix', Confidence: 93, Geometry: { BoundingBox: { Top: 0.05, Left: 0.1 } } },
    ]);
    expect(result.extractedText).toBe('Annual report\n$10M\n\nAppendix');
    expect(result.metadata).toMatchObject({ averageConfidence: 96, minimumConfidence: 93 });
    expect(result.metadata).toMatchObject({ provider: 'aws-textract', pages: 2 });
  });

  test('deduplicates detected lines', () => {
    const title = { Id: 'title', BlockType: 'LINE' as const, Page: 1, Text: 'Unique title' };
    const result = textractBlocksToExtractionResult([
      title,
      { ...title },
    ]);
    expect(result.extractedText).toBe('Unique title');
  });

  test('returns a structured extraction failure', async () => {
    await expect(documentExtract({ ...normalized('pdf'), storageKey: 'pdf' }, { logger: quiet, ocr: { extract: async () => { throw new Error('provider payload'); } } })).rejects.toMatchObject({ code: 'DOCUMENT_EXTRACTION_FAILED', action: 'document-extract' });
  });
});

describe('storage-upload action', () => {
  test('uploads to a deterministic collision-safe content key', async () => {
    let key = '';
    const result = await storageUpload({ ...normalized('txt'), documentKey }, { logger: quiet, storage: {
      upload: async (input) => { key = input.key; return { storageKey: input.key, bucket: 'content' }; },
      delete: async () => undefined,
    } });
    expect(key).toMatch(new RegExp(`^content/${scopeKey}/${folderKey}/${documentKey}/[a-f0-9]{16}/original\\.txt$`));
    expect(result.storageKey).toBe(key);
  });

  test('returns a structured upload failure', async () => {
    await expect(storageUpload({ ...normalized('txt'), documentKey }, { logger: quiet, storage: {
      upload: async () => { throw new Error('S3 internals'); }, delete: async () => undefined,
    } })).rejects.toMatchObject({ code: 'DOCUMENT_UPLOAD_FAILED', action: 'storage-upload', retryable: true });
  });
});

describe('document-embed action', () => {
  test('embeds name and content using the expected dimensions', async () => {
    let received = '';
    const result = await documentEmbed({ name: 'Report', content: 'Body' }, { logger: quiet, dimensions: 2, embed: async ({ text }) => { received = text; return [1, 2]; } });
    expect(received).toBe('Report\n\nBody');
    expect(result.embedding).toEqual([1, 2]);
  });

  test('rejects provider failures, empty vectors, and incorrect dimensions', async () => {
    await expect(documentEmbed({ name: 'Report', content: 'Body' }, { logger: quiet, dimensions: 2, embed: async () => { throw new Error('provider'); } })).rejects.toMatchObject({ code: 'DOCUMENT_EMBEDDING_FAILED' });
    await expect(documentEmbed({ name: 'Report', content: 'Body' }, { logger: quiet, dimensions: 2, embed: async () => [] })).rejects.toMatchObject({ code: 'DOCUMENT_EMBEDDING_FAILED' });
    await expect(documentEmbed({ name: 'Report', content: 'Body' }, { logger: quiet, dimensions: 2, embed: async () => [1] })).rejects.toMatchObject({ code: 'DOCUMENT_EMBEDDING_FAILED' });
  });

  test('batch embeds every bounded chunk of a large document in order', async () => {
    const content = Array.from({ length: 2_001 }, (_, index) => `word${index}`).join(' ');
    let received: string[] = [];
    const result = await documentEmbed({ name: 'Large report', content }, {
      logger: quiet,
      dimensions: 2,
      embedBatch: async ({ texts }) => { received = texts; return texts.map((_, index) => [index, index + 1]); },
    });
    expect(result.contentChunks).toHaveLength(3);
    expect(result.contentChunks.every((chunk) => chunk.trim().split(/\s+/).length <= 1_000)).toBe(true);
    expect(result.chunkEmbeddings).toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(result.embedding).toEqual([0, 1]);
    expect(received[0]).toBe(`Large report\n\n${result.contentChunks[0]!.trim()}`);
    expect(received.slice(1).every((text, index) => text.includes(`Previous context:\n`) && text.endsWith(result.contentChunks[index + 1]!.trim()))).toBe(true);
  });
});

describe('document-insert action', () => {
  test('inserts only a complete document with a valid folder relationship', async () => {
    let inserted: Document | undefined;
    const result = await documentInsert(completeDocument(), { logger: quiet, getFolder: async () => folder, getDocument: async () => null, insert: async (document) => { inserted = document; return document; } });
    expect(result.document.key).toBe(documentKey);
    expect(inserted?.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  test('rejects missing embedding, content, folder, and failed Arango insertion', async () => {
    const dependencies = { logger: quiet, getFolder: async () => folder, getDocument: async () => null };
    await expect(documentInsert({ ...completeDocument(), embedding: [] }, dependencies)).rejects.toMatchObject({ code: 'DOCUMENT_INSERT_FAILED' });
    await expect(documentInsert({ ...completeDocument(), content: undefined } as never, dependencies)).rejects.toMatchObject({ code: 'DOCUMENT_INSERT_FAILED' });
    await expect(documentInsert(completeDocument(), { ...dependencies, getFolder: async () => null })).rejects.toMatchObject({ code: 'DOCUMENT_INSERT_FAILED' });
    await expect(documentInsert(completeDocument(), { ...dependencies, insert: async () => { throw new Error('Arango unavailable'); } })).rejects.toMatchObject({ code: 'DOCUMENT_INSERT_FAILED' });
  });

});

describe('document.parse tool', () => {
  function harness(failAt?: keyof DocumentPipelineActions) {
    const calls: string[] = [];
    let persisted: Document | null = null;
    const storage: DocumentStorage = {
      upload: async ({ key }) => { calls.push('storage-upload'); if (failAt === 'upload') throw new Error('upload'); return { storageKey: key }; },
      delete: async () => { calls.push('storage-delete'); },
    };
    const fail = (step: keyof DocumentPipelineActions) => { if (failAt === step) throw new Error(step); };
    const actions: DocumentPipelineActions = {
      validate: async (input) => { calls.push('document-validate'); fail('validate'); return normalized('txt', (input.file as ReturnType<typeof fileFor>).bytes); },
      upload: async (input, options) => options!.storage!.upload({ key: `content/${input.documentKey}`, bytes: input.fileInput, mimeType: input.mimeType }),
      extract: async () => { calls.push('document-extract'); fail('extract'); return { extractedText: 'Body' }; },
      cleanup: async () => { calls.push('document-cleanup'); fail('cleanup'); return { content: 'Body' }; },
      embed: async () => { calls.push('document-embed'); fail('embed'); return { embedding: [1, 2], contentChunks: ['Body'], chunkEmbeddings: [[1, 2]], semanticChunkCount: 1, semanticContentHash: documentSemanticHash('Body') }; },
      insert: async (document) => { calls.push('document-insert'); fail('insert'); persisted = document; return { document }; },
    };
    return { calls, storage, actions, get persisted() { return persisted; }, getFolder: async () => folder, getDocument: async () => persisted };
  }

  const input = { file: fileFor('txt'), scopeKey, folderKey, idempotencyKey: 'request-1' };

  test('runs every real action in order and inserts only after embedding', async () => {
    const context = harness();
    const result = await parseDocument(input, { ...context, logger: quiet }) as DocumentParseResult;
    expect(result.document.content).toBe('Body');
    expect(result.document.isFavorite).toBe(false);
    expect(context.calls).toEqual(['document-validate', 'storage-upload', 'document-extract', 'document-cleanup', 'document-embed', 'document-insert']);
    expect(context.calls.indexOf('document-embed')).toBeLessThan(context.calls.indexOf('document-insert'));
  });

  test('embeds and persists cleaned plain text', async () => {
    const context = harness();
    context.actions.cleanup = async ({ text }) => { expect(text).toBe('Body'); return { content: 'Cleaned\n\nFirst item' }; };
    context.actions.embed = async ({ content }) => {
      expect(content).toBe('Cleaned\n\nFirst item');
      return { embedding: [1, 2], contentChunks: ['Cleaned\n\nFirst item'], chunkEmbeddings: [[1, 2]], semanticChunkCount: 1, semanticContentHash: documentSemanticHash(content) };
    };
    const result = await parseDocument(input, { ...context, logger: quiet });
    expect(result.document).toMatchObject({ content: 'Cleaned\n\nFirst item' });
  });

  test('stops on validation and upload failures without inserting', async () => {
    for (const step of ['validate', 'upload'] as const) {
      const context = harness(step);
      await expect(parseDocument(input, { ...context, logger: quiet })).rejects.toThrow();
      expect(context.calls).not.toContain('document-insert');
      expect(context.calls).not.toContain('storage-delete');
    }
  });

  test('rejects PDFs when text extraction fails', async () => {
    const context = harness('extract');
    context.actions.validate = async (value) => normalized('pdf', (value.file as ReturnType<typeof fileFor>).bytes);
    await expect(parseDocument({ ...input, file: fileFor('pdf') }, { ...context, logger: quiet })).rejects.toThrow();
    expect(context.calls).not.toContain('document-insert');
    expect(context.calls.at(-1)).toBe('storage-delete');
  });

  test('rejects documents when extraction completes without text', async () => {
    const context = harness();
    context.actions.extract = async () => ({ extractedText: '' });
    await expect(parseDocument(input, { ...context, logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_EXTRACTION_FAILED' });
    expect(context.calls).not.toContain('document-insert');
    expect(context.calls.at(-1)).toBe('storage-delete');
  });

  test('cleans S3 after non-recoverable post-upload stage failures', async () => {
    for (const step of ['cleanup', 'embed', 'insert'] as const) {
      const context = harness(step);
      await expect(parseDocument(input, { ...context, logger: quiet })).rejects.toThrow();
      expect(context.calls.at(-1)).toBe('storage-delete');
      if (step !== 'insert') expect(context.calls).not.toContain('document-insert');
    }
  });

  test('returns the existing document on an idempotent retry without another upload', async () => {
    const context = harness();
    const first = await parseDocument(input, { ...context, logger: quiet }) as DocumentParseResult;
    const beforeRetry = context.calls.length;
    const second = await parseDocument(input, { ...context, logger: quiet }) as DocumentParseResult;
    expect(second.document.key).toBe(first.document.key);
    expect(context.calls.slice(beforeRetry)).toEqual(['document-validate']);
  });

  test('does not delete the winning object after an ambiguous or concurrent insert failure', async () => {
    const context = harness('insert');
    const key = documentKeyForRequest(scopeKey, folderKey, input.idempotencyKey);
    let lookups = 0;
    const existing = completeDocument({ key, storageKey: `content/${key}` });
    const result = await parseDocument(input, {
      ...context,
      logger: quiet,
      getDocument: async () => (++lookups === 1 ? null : existing),
    }) as DocumentParseResult;
    expect(result.document.key).toBe(key);
    expect(context.calls).not.toContain('storage-delete');
  });

  test('retains the object when database ownership cannot be determined safely', async () => {
    const context = harness('insert');
    let lookups = 0;
    await expect(parseDocument(input, {
      ...context,
      logger: quiet,
      getDocument: async () => {
        if (++lookups === 1) return null;
        throw new Error('database unavailable');
      },
    })).rejects.toMatchObject({ code: 'DOCUMENT_CLEANUP_FAILED' });
    expect(context.calls).not.toContain('storage-delete');
  });

  test('returns a structured error when compensating cleanup cannot complete', async () => {
    const context = harness('cleanup');
    context.storage.delete = async () => { throw new Error('delete failed'); };
    await expect(parseDocument(input, { ...context, logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_CLEANUP_FAILED', action: 'document.parse', retryable: true });
  });
});

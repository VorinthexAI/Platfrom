import { describe, expect, test } from 'bun:test';
import { parseDocument } from '.';
import type { Document } from '@/lib/db/documents.node';
import { EMBEDDING_DIMENSIONS } from '@/lib/openai-embeddings';
import {
  canonicalDocumentRepresentations,
  documentEmbed,
  documentExtract,
  documentGenerateContent,
  documentGenerateHtml,
  documentInsert,
  documentKeyForRequest,
  documentValidate,
  storageUpload,
  type DocumentPipelineActions,
  type DocumentParseResult,
  type DocumentStorage,
  type ExtractedBlock,
  type NormalizedDocument,
} from '.';

const scopeKey = 'cmrnlzf640000qc7k4p5zem5w';
const folderKey = 'cmrnlzf640001qc7k4p5zem5w';
const documentKey = 'cmrnlzf640002qc7k4p5zem5w';
const timestamp = '2026-07-22T00:00:00.000Z';
const folder = { key: folderKey, scopeKey, name: 'Folder', isFavorite: false, embedding: [], deletedAt: null, createdAt: timestamp, updatedAt: timestamp };
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
    pdf: { mimeType: 'application/pdf', bytes: bytes('%PDF-1.7 test') },
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
  storageKey: `archive/${scopeKey}/${folderKey}/${documentKey}/original.txt`, sizeBytes: 10,
  html: '<h1>Report</h1><p>Body</p>', content: 'Report\n\nBody', embedding,
  isFavorite: false, deletedAt: null, createdAt: timestamp, updatedAt: timestamp, ...overrides,
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
});

describe('document-extract action', () => {
  test('extracts TXT and Markdown into normalized blocks', async () => {
    const txt = await documentExtract({ ...normalized('txt', bytes('First\n\nSecond')), storageKey: 'txt' }, { logger: quiet });
    expect(txt.blocks.map(({ type }) => type)).toEqual(['paragraph', 'paragraph']);
    const md = await documentExtract({ ...normalized('md', bytes('# Title\n- One\n- Two')), storageKey: 'md' }, { logger: quiet });
    expect(md.blocks.map(({ type }) => type)).toEqual(['heading', 'bulletList']);
  });

  test('preserves common Markdown inline semantics and joins paragraph lines', async () => {
    const source = '# **Core**\nFirst line with [Archive](https://vorinthex.com/archive)\ncontinues with `**literal**` and *emphasis*.';
    const extracted = await documentExtract({ ...normalized('md', bytes(source)), storageKey: 'md' }, { logger: quiet });
    const { html } = await documentGenerateHtml(extracted, { logger: quiet });
    expect(html).toBe('<h1><strong>Core</strong></h1><p>First line with <a href="https://vorinthex.com/archive">Archive</a> continues with <code>**literal**</code> and <em>emphasis</em>.</p>');
  });

  test('uses format adapters for DOC and DOCX', async () => {
    const doc = await documentExtract({ ...normalized('doc'), storageKey: 'doc' }, { logger: quiet, extractDoc: async () => 'Legacy Word' });
    const docx = await documentExtract({ ...normalized('docx'), storageKey: 'docx' }, { logger: quiet, extractDocx: async () => 'Modern Word' });
    expect(doc.extractedText).toBe('Legacy Word');
    expect(docx.extractedText).toBe('Modern Word');
  });

  test('normalizes text-based and scanned PDFs through OCR', async () => {
    for (const text of ['Selectable PDF', 'Scanned OCR']) {
      const result = await documentExtract({ ...normalized('pdf'), storageKey: 'pdf' }, { logger: quiet, ocr: { extract: async () => ({ extractedText: text, blocks: [{ type: 'paragraph', text }], metadata: { provider: 'aws-textract' } }) } });
      expect(result.extractedText).toBe(text);
    }
  });

  test('returns a structured extraction failure', async () => {
    await expect(documentExtract({ ...normalized('pdf'), storageKey: 'pdf' }, { logger: quiet, ocr: { extract: async () => { throw new Error('provider payload'); } } })).rejects.toMatchObject({ code: 'DOCUMENT_EXTRACTION_FAILED', action: 'document-extract' });
  });
});

describe('storage-upload action', () => {
  test('uploads to a deterministic collision-safe Archive key', async () => {
    let key = '';
    const result = await storageUpload({ ...normalized('txt'), documentKey }, { logger: quiet, storage: {
      upload: async (input) => { key = input.key; return { storageKey: input.key, bucket: 'archive' }; },
      delete: async () => undefined,
    } });
    expect(key).toMatch(new RegExp(`^archive/${scopeKey}/${folderKey}/${documentKey}/[a-f0-9]{16}/original\\.txt$`));
    expect(result.storageKey).toBe(key);
  });

  test('returns a structured upload failure', async () => {
    await expect(storageUpload({ ...normalized('txt'), documentKey }, { logger: quiet, storage: {
      upload: async () => { throw new Error('S3 internals'); }, delete: async () => undefined,
    } })).rejects.toMatchObject({ code: 'DOCUMENT_UPLOAD_FAILED', action: 'storage-upload', retryable: true });
  });
});

describe('document generation actions', () => {
  test('generates deterministic sanitized semantic HTML', async () => {
    const blocks: ExtractedBlock[] = [
      { type: 'heading', level: 2, text: 'Title <script>alert(1)</script>' },
      { type: 'bulletList', children: [{ type: 'listItem', text: 'One' }] },
      { type: 'table', children: [{ type: 'tableRow', children: [{ type: 'tableCell', text: 'Cell' }] }] },
    ];
    const { html } = await documentGenerateHtml({ extractedText: 'safe', blocks }, { logger: quiet });
    expect(html).toBe('<h2>Title &lt;script&gt;alert(1)&lt;/script&gt;</h2><ul><li>One</li></ul><table><tbody><tr><td>Cell</td></tr></tbody></table>');
    expect(html).not.toContain('<script>');
  });

  test('generates normalized plain text with block separation and no tags', async () => {
    const { content } = await documentGenerateContent({ html: '<h1>Report</h1><p>Body</p>' }, { logger: quiet });
    expect(content).toBe('Report\n\nBody');
    expect(content).not.toMatch(/<[^>]+>/);
  });

  test('sanitizes the editor subset and derives list and table text from canonical HTML', () => {
    const result = canonicalDocumentRepresentations(`
      <div><h1 onclick="bad()">Vorinthex Core</h1><script>alert(1)</script>
      <p>Core has <b>five</b> apps.</p><ul><li>Archive</li><li>Gallery</li></ul>
      <table><tr><th>App</th><th>Status</th></tr><tr><td>Core</td><td>Ready</td></tr></table>
      <img src="/core.png" alt="Core map" onerror="bad()"></div>
    `);
    expect(result.html).toBe('<h1>Vorinthex Core</h1><p>Core has <strong>five</strong> apps.</p><ul><li>Archive</li><li>Gallery</li></ul><table><tr><th>App</th><th>Status</th></tr><tr><td>Core</td><td>Ready</td></tr></table><img src="/core.png" alt="Core map">');
    expect(result.content).toBe('Vorinthex Core\n\nCore has five apps.\n\nArchive\nGallery\n\nApp\tStatus\nCore\tReady\n\nCore map');
  });

  test('removes unsafe links and rejects malformed allowed HTML', async () => {
    const { html } = await documentGenerateHtml({ html: '<p><a href="javascript:alert(1)" style="color:red">Unsafe</a> <u>underline</u> <s>old</s></p>' }, { logger: quiet });
    expect(html).toBe('<p><a>Unsafe</a> <u>underline</u> <s>old</s></p>');
    await expect(documentGenerateHtml({ html: '<p>broken</strong>' }, { logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_HTML_GENERATION_FAILED' });
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

  test('rejects archived folders and archived idempotent documents', async () => {
    await expect(documentInsert(completeDocument(), { logger: quiet, getFolder: async () => ({ ...folder, deletedAt: timestamp }), getDocument: async () => null })).rejects.toMatchObject({ code: 'DOCUMENT_INSERT_FAILED' });
    await expect(documentInsert(completeDocument(), { logger: quiet, getFolder: async () => folder, getDocument: async () => completeDocument({ deletedAt: timestamp }) })).rejects.toMatchObject({ code: 'DOCUMENT_INSERT_FAILED' });
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
      upload: async (input, options) => options!.storage!.upload({ key: `archive/${input.documentKey}`, bytes: input.fileInput, mimeType: input.mimeType }),
      extract: async () => { calls.push('document-extract'); fail('extract'); return { extractedText: 'Body', blocks: [{ type: 'paragraph', text: 'Body' }] }; },
      generateHtml: async () => { calls.push('document-generate-html'); fail('generateHtml'); return { html: '<p>Body</p>' }; },
      generateContent: async () => { calls.push('document-generate-content'); fail('generateContent'); return { content: 'Body' }; },
      embed: async () => { calls.push('document-embed'); fail('embed'); return { embedding: [1, 2] }; },
      insert: async (document) => { calls.push('document-insert'); fail('insert'); persisted = document; return { document }; },
    };
    return { calls, storage, actions, get persisted() { return persisted; }, getFolder: async () => folder, getDocument: async () => persisted };
  }

  const input = { file: fileFor('txt'), scopeKey, folderKey, idempotencyKey: 'request-1' };

  test('runs every real action in order and inserts only after embedding', async () => {
    const context = harness();
    const result = await parseDocument(input, { ...context, logger: quiet }) as DocumentParseResult;
    expect(result.document.content).toBe('Body');
    expect(context.calls).toEqual(['document-validate', 'storage-upload', 'document-extract', 'document-generate-html', 'document-generate-content', 'document-embed', 'document-insert']);
    expect(context.calls.indexOf('document-embed')).toBeLessThan(context.calls.indexOf('document-insert'));
  });

  test('rejects action output when content drifts from generated HTML', async () => {
    const context = harness();
    context.actions.generateContent = async () => ({ content: 'Drifted' });
    await expect(parseDocument(input, { ...context, logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_CONTENT_GENERATION_FAILED' });
    expect(context.calls.at(-1)).toBe('storage-delete');
  });

  test('stops on validation and upload failures without inserting', async () => {
    for (const step of ['validate', 'upload'] as const) {
      const context = harness(step);
      await expect(parseDocument(input, { ...context, logger: quiet })).rejects.toThrow();
      expect(context.calls).not.toContain('document-insert');
      expect(context.calls).not.toContain('storage-delete');
    }
  });

  test('cleans S3 after every post-upload stage failure', async () => {
    for (const step of ['extract', 'generateHtml', 'generateContent', 'embed', 'insert'] as const) {
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

  test('rejects an archived document on an idempotent retry without uploading', async () => {
    const context = harness();
    const key = documentKeyForRequest(scopeKey, folderKey, input.idempotencyKey);
    await expect(parseDocument(input, {
      ...context,
      logger: quiet,
      getDocument: async () => completeDocument({ key, deletedAt: timestamp }),
    })).rejects.toMatchObject({ code: 'DOCUMENT_INSERT_FAILED' });
    expect(context.calls).toEqual(['document-validate']);
  });

  test('rejects an archived folder before idempotency lookup or upload', async () => {
    const context = harness();
    await expect(parseDocument(input, {
      ...context,
      logger: quiet,
      getFolder: async () => ({ ...folder, deletedAt: timestamp }),
    })).rejects.toMatchObject({ code: 'DOCUMENT_INSERT_FAILED' });
    expect(context.calls).toEqual(['document-validate']);
  });

  test('does not delete the winning object after an ambiguous or concurrent insert failure', async () => {
    const context = harness('insert');
    const key = documentKeyForRequest(scopeKey, folderKey, input.idempotencyKey);
    let lookups = 0;
    const existing = completeDocument({ key, storageKey: `archive/${key}` });
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
    const context = harness('extract');
    context.storage.delete = async () => { throw new Error('delete failed'); };
    await expect(parseDocument(input, { ...context, logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_CLEANUP_FAILED', action: 'document.parse', retryable: true });
  });
});

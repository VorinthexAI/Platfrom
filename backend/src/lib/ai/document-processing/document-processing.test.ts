import { describe, expect, test } from 'bun:test';
import { DeleteObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { GetDocumentAnalysisCommand, StartDocumentAnalysisCommand, type Block, type TextractClient } from '@aws-sdk/client-textract';
import { parseDocument } from '.';
import { generateDocumentExport } from './exports';
import type { Document } from '@/lib/db/documents.node';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import {
  canonicalDocumentRepresentations,
  createAwsTextractDocumentOcr,
  documentEmbed,
  documentExtract,
  documentGenerateContent,
  documentGenerateHtml,
  htmlToDocumentPreviewBlocks,
  htmlToExtractedBlocks,
  documentInsert,
  documentKeyForRequest,
  documentSemanticHash,
  documentValidate,
  storageUpload,
  textractBlocksToExtractionResult,
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

  test('rejects truncated PDFs and unsafe cross-platform filenames', async () => {
    const truncated = bytes('%PDF-1.7\ntruncated');
    await expect(documentValidate({ file: { filename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: truncated.length, bytes: truncated }, scopeKey }, { logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_UPLOAD_INVALID' });
    await expect(documentValidate({ file: { ...fileFor('txt'), filename: 'folder\\report.txt' }, scopeKey }, { logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_INVALID_FILENAME' });
    await expect(documentValidate({ file: { ...fileFor('txt'), filename: 'folder/report.txt' }, scopeKey }, { logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_INVALID_FILENAME' });
  });
});

describe('document-extract action', () => {
  test('extracts TXT and Markdown into normalized blocks', async () => {
    const txt = await documentExtract({ ...normalized('txt', bytes('First\n\nSecond')), storageKey: 'txt' }, { logger: quiet });
    expect(txt.blocks.map(({ type }) => type)).toEqual(['paragraph', 'paragraph']);
    const md = await documentExtract({ ...normalized('md', bytes('# Title\n- One\n- Two')), storageKey: 'md' }, { logger: quiet });
    expect(md.blocks.map(({ type }) => type)).toEqual(['heading', 'bulletList']);
  });

  test('preserves literal TXT whitespace in canonical HTML', async () => {
    const source = 'Name\tScore\nAda \t  10\n\nIndented:\n    value';
    const extracted = await documentExtract({ ...normalized('txt', bytes(source)), storageKey: 'txt' }, { logger: quiet });
    const { html } = await documentGenerateHtml(extracted, { logger: quiet });
    const { content } = await documentGenerateContent({ html }, { logger: quiet });
    expect(html).toBe('<pre><code>Name\tScore\nAda \t  10\n\nIndented:\n    value</code></pre>');
    expect(content).toBe(source);
  });

  test('preserves common Markdown inline semantics and joins paragraph lines', async () => {
    const source = '# **Core**\nFirst line with [Archive](https://vorinthex.com/archive)\ncontinues with `**literal**` and *emphasis*.';
    const extracted = await documentExtract({ ...normalized('md', bytes(source)), storageKey: 'md' }, { logger: quiet });
    const { html } = await documentGenerateHtml(extracted, { logger: quiet });
    expect(html).toBe('<h1><strong>Core</strong></h1><p>First line with <a href="https://vorinthex.com/archive">Archive</a> continues with <code>**literal**</code> and <em>emphasis</em>.</p>');
  });

  test('preserves sanitized inline semantics from DOCX-style HTML blocks', async () => {
    const blocks = htmlToExtractedBlocks('<p><strong>Bold</strong> and <em>italic</em> with <a href="https://example.com">link</a>.</p>');
    const { html } = await documentGenerateHtml({ extractedText: 'Bold and italic with link.', blocks }, { logger: quiet });
    expect(html).toBe('<p><strong>Bold</strong> and <em>italic</em> with <a href="https://example.com">link</a>.</p>');
  });

  test('projects canonical HTML into strict native preview blocks', () => {
    expect(htmlToDocumentPreviewBlocks('<h2><strong>Native</strong> preview</h2><ol start="3"><li>First<ul><li><code>Nested</code></li></ul></li></ol><table><thead><tr><th colspan="2">Header</th></tr></thead><tbody><tr><td><a href="https://example.com">Link</a></td><td>Value</td></tr></tbody></table><section class="doc-page" data-page="2"><p>Page body</p></section>')).toEqual([
      { type: 'heading', level: 2, content: [{ text: 'Native', bold: true }, { text: ' preview' }] },
      { type: 'orderedList', start: 3, items: [{ content: [{ text: 'First' }], children: [{ type: 'bulletList', items: [{ content: [{ text: 'Nested', code: true }], children: [] }] }] }] },
      { type: 'table', rows: [{ cells: [{ header: true, colSpan: 2, rowSpan: 1, content: [{ text: 'Header' }] }] }, { cells: [{ header: false, colSpan: 1, rowSpan: 1, content: [{ text: 'Link', href: 'https://example.com' }] }, { header: false, colSpan: 1, rowSpan: 1, content: [{ text: 'Value' }] }] }] },
      { type: 'page', page: 2, children: [{ type: 'paragraph', content: [{ text: 'Page body' }] }] },
    ]);
  });

  test('creates native previews for every supported uploaded file format', async () => {
    const cases = [
      ['txt', { logger: quiet }, 'codeBlock'],
      ['md', { logger: quiet }, 'heading'],
      ['doc', { logger: quiet, extractDoc: async () => 'Legacy Word body' }, 'paragraph'],
      ['docx', { logger: quiet, extractDocx: async () => 'Modern Word body' }, 'paragraph'],
      ['pdf', { logger: quiet, ocr: { extract: async () => ({ extractedText: 'PDF body', blocks: [{ type: 'paragraph' as const, text: 'PDF body' }] }) } }, 'paragraph'],
    ] as const;
    for (const [extension, options, expectedType] of cases) {
      const extracted = await documentExtract({ ...normalized(extension), storageKey: extension }, options);
      const { html } = await documentGenerateHtml(extracted, { logger: quiet });
      expect(htmlToDocumentPreviewBlocks(html)[0]?.type).toBe(expectedType);
    }
  });

  test('sanitizes unsafe preview input and tolerates layout edge cases', () => {
    const longToken = 'x'.repeat(20_000);
    const blocks = htmlToDocumentPreviewBlocks(`<script><p>hidden</p></script><p><a href="javascript:alert(1)">Unsafe</a> <a href="https://example.com/path">Safe</a> ${longToken}</p><ol start="99"><li>Deep<ul><li>Nested<ul><li>Again</li></ul></li></ul></li></ol><table><tr><td colspan="999">Wide</td>${Array.from({ length: 20 }, (_, index) => `<td>C${index}</td>`).join('')}</tr></table><hr>`);
    expect(blocks[0]).toMatchObject({ type: 'paragraph' });
    if (blocks[0]?.type !== 'paragraph') throw new Error('Expected a paragraph preview.');
    expect(blocks[0].content.slice(0, 2)).toEqual([{ text: 'Unsafe ' }, { text: 'Safe', href: 'https://example.com/path' }]);
    expect(JSON.stringify(blocks)).not.toContain('hidden');
    expect(JSON.stringify(blocks)).not.toContain('javascript:');
    expect(JSON.stringify(blocks)).toContain(longToken);
    expect(blocks).toContainEqual(expect.objectContaining({ type: 'orderedList', start: 99 }));
    expect(blocks).toContainEqual(expect.objectContaining({ type: 'table' }));
    expect(blocks.at(-1)).toEqual({ type: 'horizontalRule' });
    const table = blocks.find((block) => block.type === 'table');
    expect(table?.rows[0]?.cells).toHaveLength(21);
    expect(table?.rows[0]?.cells[0]?.colSpan).toBe(1);
  });

  test('returns an empty preview for empty content and rejects malformed HTML', () => {
    expect(htmlToDocumentPreviewBlocks('')).toEqual([]);
    expect(() => htmlToDocumentPreviewBlocks('<p>Unclosed')).toThrow('unclosed');
    expect(() => htmlToDocumentPreviewBlocks('<p>Wrong</div>')).toThrow('closing div');
  });

  test('rejects empty and invalid UTF-8 text files during extraction', async () => {
    await expect(documentExtract({ ...normalized('txt', bytes('   ')), storageKey: 'txt' }, { logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_EXTRACTION_FAILED' });
    await expect(documentExtract({ ...normalized('md', new Uint8Array([0xff, 0xfe])), storageKey: 'md' }, { logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_EXTRACTION_FAILED' });
  });

  test('uses extracted DOCX HTML without flattening table layout', async () => {
    const extracted = {
      extractedText: 'Quarter\tRevenue',
      extractedHtml: '<table><tr><th colspan="2">Quarter</th></tr><tr><td>Q1</td><td>Revenue</td></tr></table>',
      blocks: [],
      metadata: { format: 'docx' },
    };
    const { html } = await documentGenerateHtml(extracted, { logger: quiet });
    expect(html).toBe('<table><tr><th colspan="2">Quarter</th></tr><tr><td>Q1</td><td>Revenue</td></tr></table>');
  });

  test('uses format adapters for DOC and DOCX', async () => {
    const doc = await documentExtract({ ...normalized('doc'), storageKey: 'doc' }, { logger: quiet, extractDoc: async () => 'Legacy Word' });
    const docx = await documentExtract({ ...normalized('docx'), storageKey: 'docx' }, { logger: quiet, extractDocx: async () => 'Modern Word' });
    expect(doc.extractedText).toBe('Legacy Word');
    expect(docx.extractedText).toBe('Modern Word');
  });

  test('validates and extracts a real DOCX archive through Mammoth', async () => {
    const exported = await generateDocumentExport({ format: 'docx', html: '<h1>Quarterly report</h1><p>Revenue increased.</p>' });
    const validated = await documentValidate({
      file: { filename: 'report.docx', mimeType: exported.mimeType, sizeBytes: exported.bytes.byteLength, bytes: exported.bytes },
      scopeKey,
      folderKey,
    }, { logger: quiet });
    const result = await documentExtract({ ...validated, storageKey: 'unused-for-docx' }, { logger: quiet });
    expect(result.extractedText).toBe('Quarterly report\n\nRevenue increased.');
    expect(result.blocks.map(({ type }) => type)).toEqual(['paragraph', 'paragraph']);
  });

  test('normalizes text-based and scanned PDFs through OCR', async () => {
    for (const text of ['Selectable PDF', 'Scanned OCR']) {
      const result = await documentExtract({ ...normalized('pdf'), storageKey: 'pdf' }, { logger: quiet, ocr: { extract: async () => ({ extractedText: text, blocks: [{ type: 'paragraph', text }], metadata: { provider: 'aws-textract' } }) } });
      expect(result.extractedText).toBe(text);
    }
  });

  test('stages and extracts selectable, scanned, and multi-page dummy PDFs through Textract', async () => {
    const fixtures: Array<{ name: string; pdf: Uint8Array; blocks: Block[]; text: string; pages: number }> = [
      {
        name: 'selectable',
        pdf: bytes('%PDF-1.7\n1 0 obj<</Type/Page/Contents 2 0 R>>endobj\n2 0 obj<</Length 36>>stream\nBT (Selectable quarterly report) Tj ET\nendstream\nendobj\n%%EOF'),
        blocks: [{ Id: 'selectable', BlockType: 'LAYOUT_TEXT', Page: 1, Text: 'Selectable quarterly report' }],
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
          { Id: 'page-one', BlockType: 'LAYOUT_TITLE', Page: 1, Text: 'Annual results' },
          { Id: 'layout-table', BlockType: 'LAYOUT_TABLE', Page: 2, Relationships: [{ Type: 'CHILD', Ids: ['table'] }] },
          { Id: 'table', BlockType: 'TABLE', Page: 2, Relationships: [{ Type: 'CHILD', Ids: ['cell'] }] },
          { Id: 'cell', BlockType: 'CELL', Page: 2, RowIndex: 1, ColumnIndex: 1, Relationships: [{ Type: 'CHILD', Ids: ['word'] }] },
          { Id: 'word', BlockType: 'WORD', Page: 2, Text: 'Revenue' },
        ],
        text: 'Annual results\n\nRevenue',
        pages: 2,
      },
    ];

    for (const fixture of fixtures) {
      const storageCommands: Array<PutObjectCommand | DeleteObjectCommand> = [];
      const textractCommands: Array<StartDocumentAnalysisCommand | GetDocumentAnalysisCommand> = [];
      const storageClient = {
        send: async (command: PutObjectCommand | DeleteObjectCommand) => {
          storageCommands.push(command);
          return {};
        },
      } as unknown as Pick<S3Client, 'send'>;
      const textractClient = {
        send: async (command: StartDocumentAnalysisCommand | GetDocumentAnalysisCommand) => {
          textractCommands.push(command);
          return command instanceof StartDocumentAnalysisCommand
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
      expect(textractCommands[0]).toBeInstanceOf(StartDocumentAnalysisCommand);
      expect(textractCommands[0]!.input).toMatchObject({
        DocumentLocation: { S3Object: { Bucket: 'dummy-textract-eu-west-1', Name: storageCommands[0]!.input.Key } },
        FeatureTypes: ['LAYOUT', 'TABLES'],
      });
      expect(textractCommands[1]).toBeInstanceOf(GetDocumentAnalysisCommand);
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
        send: async (command: StartDocumentAnalysisCommand | GetDocumentAnalysisCommand) => command instanceof StartDocumentAnalysisCommand
          ? { JobId: 'failed-job' }
          : { JobStatus: 'FAILED' },
      } as unknown as Pick<TextractClient, 'send'>,
    });

    await expect(ocr.extract('content/rejected.pdf', fileFor('pdf').bytes)).rejects.toThrow('could not extract');
    expect(storageCommands.map((command) => command.constructor)).toEqual([PutObjectCommand, DeleteObjectCommand]);
    expect(storageCommands[1]!.input.Key).toBe(storageCommands[0]!.input.Key);
  });

  test('reconstructs PDF pages, headings, and merged table cells from Textract layout blocks', () => {
    const result = textractBlocksToExtractionResult([
      { Id: 'title', BlockType: 'LAYOUT_TITLE', Page: 1, Text: 'Annual report', Geometry: { BoundingBox: { Top: 0.05, Left: 0.1 } } },
      { Id: 'layout-table', BlockType: 'LAYOUT_TABLE', Page: 1, Relationships: [{ Type: 'CHILD', Ids: ['table'] }], Geometry: { BoundingBox: { Top: 0.2, Left: 0.1 } } },
      { Id: 'table', BlockType: 'TABLE', Page: 1, Relationships: [{ Type: 'CHILD', Ids: ['header', 'value'] }] },
      { Id: 'header', BlockType: 'CELL', Page: 1, RowIndex: 1, ColumnIndex: 1, ColumnSpan: 2, EntityTypes: ['COLUMN_HEADER'], Relationships: [{ Type: 'CHILD', Ids: ['header-word'] }] },
      { Id: 'header-word', BlockType: 'WORD', Page: 1, Text: 'Revenue' },
      { Id: 'value', BlockType: 'CELL', Page: 1, RowIndex: 2, ColumnIndex: 1, Relationships: [{ Type: 'CHILD', Ids: ['value-word'] }] },
      { Id: 'value-word', BlockType: 'WORD', Page: 1, Text: '$10M' },
      { Id: 'second-page', BlockType: 'LAYOUT_SECTION_HEADER', Page: 2, Text: 'Appendix', Geometry: { BoundingBox: { Top: 0.05, Left: 0.1 } } },
    ]);
    expect(result.extractedHtml).toBe('<section class="doc-page" data-page="1"><h1>Annual report</h1><table><tbody><tr><th colspan="2">Revenue</th></tr><tr><td>$10M</td></tr></tbody></table></section><section class="doc-page" data-page="2"><h2>Appendix</h2></section>');
    expect(result.extractedText).toBe('Annual report\n\nRevenue\n$10M\n\nAppendix');
    expect(result.metadata).toMatchObject({ provider: 'aws-textract', layout: 'semantic', pages: 2 });
  });

  test('deduplicates Textract blocks and safely stops cyclic relationships', () => {
    const title = { Id: 'title', BlockType: 'LAYOUT_TITLE' as const, Page: 1, Text: 'Unique title' };
    const result = textractBlocksToExtractionResult([
      title,
      { ...title },
      { Id: 'cycle', BlockType: 'LAYOUT_TEXT', Page: 1, Relationships: [{ Type: 'CHILD', Ids: ['cycle'] }] },
    ]);
    expect(result.extractedHtml).toBe('<section class="doc-page" data-page="1"><h1>Unique title</h1></section>');
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

  test('preserves only canonical page and table layout attributes', () => {
    const result = canonicalDocumentRepresentations('<section class="doc-page" data-page="12" style="position:fixed"><table><tr><td colspan="3" rowspan="2" style="color:red">Cell</td></tr></table></section>');
    expect(result.html).toBe('<section class="doc-page" data-page="12"><table><tr><td colspan="3" rowspan="2">Cell</td></tr></table></section>');
    expect(canonicalDocumentRepresentations(result.html)).toEqual(result);
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
      upload: async (input, options) => options!.storage!.upload({ key: `content/${input.documentKey}`, bytes: input.fileInput, mimeType: input.mimeType }),
      extract: async () => { calls.push('document-extract'); fail('extract'); return { extractedText: 'Body', blocks: [{ type: 'paragraph', text: 'Body' }] }; },
      generateHtml: async () => { calls.push('document-generate-html'); fail('generateHtml'); return { html: '<p>Body</p>' }; },
      generateContent: async () => { calls.push('document-generate-content'); fail('generateContent'); return { content: 'Body' }; },
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

  test('rejects PDFs when text extraction fails', async () => {
    const context = harness('extract');
    context.actions.validate = async (value) => normalized('pdf', (value.file as ReturnType<typeof fileFor>).bytes);
    await expect(parseDocument({ ...input, file: fileFor('pdf') }, { ...context, logger: quiet })).rejects.toThrow();
    expect(context.calls).not.toContain('document-insert');
    expect(context.calls.at(-1)).toBe('storage-delete');
  });

  test('rejects documents when extraction completes without text', async () => {
    const context = harness();
    context.actions.extract = async () => ({ extractedText: '', blocks: [] });
    await expect(parseDocument(input, { ...context, logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_EXTRACTION_FAILED' });
    expect(context.calls).not.toContain('document-insert');
    expect(context.calls.at(-1)).toBe('storage-delete');
  });

  test('cleans S3 after non-recoverable post-upload stage failures', async () => {
    for (const step of ['generateHtml', 'generateContent', 'embed', 'insert'] as const) {
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
    const context = harness('generateHtml');
    context.storage.delete = async () => { throw new Error('delete failed'); };
    await expect(parseDocument(input, { ...context, logger: quiet })).rejects.toMatchObject({ code: 'DOCUMENT_CLEANUP_FAILED', action: 'document.parse', retryable: true });
  });
});

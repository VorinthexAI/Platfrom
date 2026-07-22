import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import { embedText } from '@/lib/bedrock-titan';
import { getDocumentById, insertPreparedDocument, documentSchema, type Document, type DocumentExtension } from '@/lib/db/documents.node';
import { getFolderById } from '@/lib/db/folders.node';
import { newId } from '@/lib/ids';
import { documentActionError, DocumentProcessingError } from './errors';
import {
  extractionResultSchema,
  normalizedDocumentSchema,
  type DocumentActionName,
  type EditorDocumentJson,
  type ExtractedBlock,
  type ExtractionResult,
  type NormalizedDocument,
  type UploadedDocumentFile,
} from './schemas';
import { documentStorage, type DocumentStorage } from './storage';
import { awsTextractDocumentOcr, type DocumentOcr } from './textract';
import {
  documentInputToHtml,
  editorDocumentJsonToPlainText,
  htmlToExtractedBlocks,
  htmlToEditorDocumentJson,
  type DocumentHtmlInput,
} from './representation';

export const DEFAULT_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const DEFAULT_EMBEDDING_DIMENSIONS = 1_024;
export const DEFAULT_MAX_EXTRACTED_CHARACTERS = 10_000_000;
const MAX_DOCX_ENTRIES = 10_000;
const MAX_DOCX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_DOCX_COMPRESSION_RATIO = 100;

const MIME_TYPES: Record<DocumentExtension, readonly string[]> = {
  txt: ['text/plain'],
  md: ['text/markdown', 'text/x-markdown', 'text/plain'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  pdf: ['application/pdf'],
};

export interface DocumentActionLogger {
  (event: Record<string, unknown>): void;
}

const defaultLogger: DocumentActionLogger = (event) => console.info(JSON.stringify(event));

async function observed<T>(action: DocumentActionName, metadata: Record<string, unknown>, logger: DocumentActionLogger, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await run();
    logger({ action, status: 'completed', durationMs: Math.round(performance.now() - started), ...metadata });
    return result;
  } catch (error) {
    logger({ action, status: 'failed', durationMs: Math.round(performance.now() - started), ...metadata });
    throw error;
  }
}

async function uploadedFileBytes(file: UploadedDocumentFile, maxBytes: number): Promise<{ filename: string; mimeType: string; sizeBytes: number; bytes: Uint8Array }> {
  if (typeof File !== 'undefined' && file instanceof File) {
    if (file.size > maxBytes) throw new DocumentProcessingError('DOCUMENT_TOO_LARGE', 'The document exceeds the maximum allowed size.', 'document-validate');
    return { filename: file.name, mimeType: file.type, sizeBytes: file.size, bytes: new Uint8Array(await file.arrayBuffer()) };
  }
  const input = file as Exclude<UploadedDocumentFile, File>;
  if (input.sizeBytes > maxBytes) throw new DocumentProcessingError('DOCUMENT_TOO_LARGE', 'The document exceeds the maximum allowed size.', 'document-validate');
  const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
  return { filename: input.filename, mimeType: input.mimeType, sizeBytes: input.sizeBytes, bytes };
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function validateDocxArchive(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names = new Set<string>();
  let entries = 0;
  let totalCompressed = 0;
  let totalExpanded = 0;
  let foundEnd = false;
  for (let offset = 0; offset + 4 <= bytes.byteLength;) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50) {
      if (offset + 46 > bytes.byteLength) return false;
      const compressed = view.getUint32(offset + 20, true);
      const expanded = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const end = offset + 46 + nameLength + extraLength + commentLength;
      if (end > bytes.byteLength) return false;
      names.add(new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength)));
      entries += 1;
      totalCompressed += compressed;
      totalExpanded += expanded;
      if (entries > MAX_DOCX_ENTRIES || totalExpanded > MAX_DOCX_EXPANDED_BYTES) return false;
      if (totalCompressed > 0 && totalExpanded / totalCompressed > MAX_DOCX_COMPRESSION_RATIO) return false;
      offset = end;
      continue;
    }
    if (signature === 0x06054b50) { foundEnd = true; break; }
    offset += 1;
  }
  return foundEnd && names.has('[Content_Types].xml') && names.has('word/document.xml');
}

function validateSignature(extension: DocumentExtension, bytes: Uint8Array): boolean {
  if (extension === 'pdf') return hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (extension === 'doc') return hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (extension === 'docx') return hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]) && validateDocxArchive(bytes);
  return !bytes.includes(0);
}

export async function documentValidate(input: {
  file: UploadedDocumentFile;
  scopeKey: string;
  folderKey: string;
  name?: string;
}, options: { maxBytes?: number; logger?: DocumentActionLogger } = {}): Promise<NormalizedDocument> {
  return observed('document-validate', { scopeKey: input.scopeKey, folderKey: input.folderKey }, options.logger ?? defaultLogger, async () => {
    try {
      const maxBytes = options.maxBytes ?? Number(process.env.ARCHIVE_MAX_DOCUMENT_BYTES ?? DEFAULT_MAX_DOCUMENT_BYTES);
      const uploaded = await uploadedFileBytes(input.file, maxBytes);
      const safeFilename = basename(uploaded.filename.trim());
      if (!safeFilename || safeFilename !== uploaded.filename.trim() || safeFilename === '.' || safeFilename === '..') {
        throw new DocumentProcessingError('DOCUMENT_INVALID_FILENAME', 'The uploaded filename is invalid.', 'document-validate');
      }
      const extension = extname(safeFilename).slice(1).toLowerCase() as DocumentExtension;
      if (!(extension in MIME_TYPES)) throw new DocumentProcessingError('DOCUMENT_UNSUPPORTED_TYPE', 'The document type is not supported.', 'document-validate');
      if (!MIME_TYPES[extension].includes(uploaded.mimeType.toLowerCase())) {
        throw new DocumentProcessingError('DOCUMENT_INVALID_MIME_TYPE', 'The document MIME type does not match its supported type.', 'document-validate');
      }
      if (uploaded.sizeBytes <= 0 || uploaded.bytes.byteLength !== uploaded.sizeBytes || !validateSignature(extension, uploaded.bytes)) {
        throw new DocumentProcessingError('DOCUMENT_UPLOAD_INVALID', 'The uploaded document failed its integrity check.', 'document-validate');
      }
      if (uploaded.sizeBytes > maxBytes) throw new DocumentProcessingError('DOCUMENT_TOO_LARGE', 'The document exceeds the maximum allowed size.', 'document-validate');
      return normalizedDocumentSchema.parse({
        name: input.name?.trim() || safeFilename.slice(0, -(extension.length + 1)),
        extension,
        mimeType: uploaded.mimeType.toLowerCase(),
        sizeBytes: uploaded.sizeBytes,
        scopeKey: input.scopeKey,
        folderKey: input.folderKey,
        fileInput: uploaded.bytes,
      });
    } catch (error) {
      throw documentActionError(error, 'DOCUMENT_VALIDATION_FAILED', 'Document validation failed.', 'document-validate');
    }
  });
}

export async function storageUpload(input: NormalizedDocument & { documentKey: string }, options: { storage?: DocumentStorage; logger?: DocumentActionLogger } = {}) {
  return observed('storage-upload', { documentKey: input.documentKey, scopeKey: input.scopeKey, folderKey: input.folderKey, extension: input.extension, mimeType: input.mimeType, sizeBytes: input.sizeBytes }, options.logger ?? defaultLogger, async () => {
    try {
      const contentHash = createHash('sha256').update(input.fileInput).digest('hex').slice(0, 16);
      const storageKey = `archive/${input.scopeKey}/${input.folderKey}/${input.documentKey}/${contentHash}/original.${input.extension}`;
      return await (options.storage ?? documentStorage).upload({ key: storageKey, bytes: input.fileInput, mimeType: input.mimeType });
    } catch (error) {
      throw documentActionError(error, 'DOCUMENT_UPLOAD_FAILED', 'The document could not be uploaded.', 'storage-upload', true);
    }
  });
}

function paragraphs(text: string): ExtractedBlock[] {
  return text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).map((text) => ({ type: 'paragraph', text }));
}

function parseMarkdown(markdown: string): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let code: string[] | null = null;
  let list: ExtractedBlock | null = null;
  const flushList = () => { if (list) blocks.push(list); list = null; };
  for (const raw of lines) {
    if (/^```/.test(raw)) {
      flushList();
      if (code) { blocks.push({ type: 'codeBlock', text: code.join('\n') }); code = null; } else code = [];
      continue;
    }
    if (code) { code.push(raw); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(raw);
    if (heading) { flushList(); blocks.push({ type: 'heading', level: heading[1]!.length, text: heading[2]!.trim() }); continue; }
    const item = /^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/.exec(raw);
    if (item) {
      const type = item[1] ? 'bulletList' : 'orderedList';
      if (!list || list.type !== type) { flushList(); list = { type, children: [] }; }
      list.children!.push({ type: 'listItem', text: item[3]!.trim() });
      continue;
    }
    flushList();
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(raw)) blocks.push({ type: 'horizontalRule' });
    else if (/^>\s?/.test(raw)) blocks.push({ type: 'blockquote', text: raw.replace(/^>\s?/, '').trim() });
    else if (raw.trim()) blocks.push({ type: 'paragraph', text: raw.trim() });
  }
  flushList();
  if (code) blocks.push({ type: 'codeBlock', text: code.join('\n') });
  return blocks;
}

function extractionFromText(text: string, blocks = paragraphs(text), metadata?: Record<string, unknown>): ExtractionResult {
  const maxCharacters = Number(process.env.ARCHIVE_MAX_EXTRACTED_CHARACTERS ?? DEFAULT_MAX_EXTRACTED_CHARACTERS);
  if (text.length > maxCharacters) throw new Error('Extracted document content exceeds the configured limit.');
  return extractionResultSchema.parse({ extractedText: text.trim(), blocks, metadata });
}

export async function documentExtract(input: NormalizedDocument & { storageKey: string }, options: {
  ocr?: DocumentOcr;
  extractDoc?: (bytes: Uint8Array) => Promise<string>;
  extractDocx?: (bytes: Uint8Array) => Promise<string>;
  logger?: DocumentActionLogger;
} = {}): Promise<ExtractionResult> {
  return observed('document-extract', { scopeKey: input.scopeKey, folderKey: input.folderKey, extension: input.extension, mimeType: input.mimeType, sizeBytes: input.sizeBytes }, options.logger ?? defaultLogger, async () => {
    try {
      if (input.extension === 'pdf') {
        const result = extractionResultSchema.parse(await (options.ocr ?? awsTextractDocumentOcr).extract(input.storageKey));
        if (result.extractedText.length > Number(process.env.ARCHIVE_MAX_EXTRACTED_CHARACTERS ?? DEFAULT_MAX_EXTRACTED_CHARACTERS)) throw new Error('Extracted document content exceeds the configured limit.');
        return result;
      }
      if (input.extension === 'txt') return extractionFromText(new TextDecoder('utf-8', { fatal: true }).decode(input.fileInput));
      if (input.extension === 'md') {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(input.fileInput);
        return extractionFromText(text, parseMarkdown(text), { format: 'markdown' });
      }
      if (input.extension === 'docx') {
        if (options.extractDocx) return extractionFromText(await options.extractDocx(input.fileInput));
        const result = await mammoth.convertToHtml({ buffer: Buffer.from(input.fileInput) });
        const blocks = htmlToExtractedBlocks(result.value);
        const text = blocks.map((block) => block.text ?? (block.children ?? []).map((child) => child.text ?? '').join('\n')).filter(Boolean).join('\n\n');
        return extractionFromText(text, blocks, { warnings: result.messages.length });
      }
      if (options.extractDoc) return extractionFromText(await options.extractDoc(input.fileInput));
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(Buffer.from(input.fileInput));
      return extractionFromText(extracted.getBody());
    } catch (error) {
      throw documentActionError(error, 'DOCUMENT_EXTRACTION_FAILED', 'The document could not be extracted.', 'document-extract', true);
    }
  });
}

export async function documentGenerateHtml(input: DocumentHtmlInput, options: { logger?: DocumentActionLogger } = {}): Promise<{ html: string }> {
  return observed('document-generate-html', {}, options.logger ?? defaultLogger, async () => {
    try {
      return { html: documentInputToHtml(input) };
    } catch (error) {
      throw documentActionError(error, 'DOCUMENT_HTML_GENERATION_FAILED', 'Document HTML generation failed.', 'document-generate-html');
    }
  });
}

export async function documentGenerateJson(input: { html: string }, options: { logger?: DocumentActionLogger } = {}): Promise<{ json: EditorDocumentJson }> {
  return observed('document-generate-json', {}, options.logger ?? defaultLogger, async () => {
    try {
      return { json: htmlToEditorDocumentJson(input.html) };
    } catch (error) {
      throw documentActionError(error, 'DOCUMENT_JSON_GENERATION_FAILED', 'Document JSON generation failed.', 'document-generate-json');
    }
  });
}

export async function documentGenerateContent(input: { json: EditorDocumentJson }, options: { logger?: DocumentActionLogger } = {}): Promise<{ content: string }> {
  return observed('document-generate-content', {}, options.logger ?? defaultLogger, async () => {
    try {
      return { content: editorDocumentJsonToPlainText(input.json) };
    } catch (error) {
      throw documentActionError(error, 'DOCUMENT_CONTENT_GENERATION_FAILED', 'Document content generation failed.', 'document-generate-content');
    }
  });
}

export async function documentEmbed(input: { name: string; content: string }, options: { embed?: typeof embedText; dimensions?: number; logger?: DocumentActionLogger } = {}): Promise<{ embedding: number[] }> {
  return observed('document-embed', {}, options.logger ?? defaultLogger, async () => {
    try {
      const text = `${input.name.trim()}\n\n${input.content.trim()}`;
      const embedding = await (options.embed ?? embedText)({ text });
      const dimensions = options.dimensions ?? Number(process.env.EMBEDDING_DIMENSIONS ?? DEFAULT_EMBEDDING_DIMENSIONS);
      if (!Array.isArray(embedding) || embedding.length === 0 || embedding.some((value) => !Number.isFinite(value)) || embedding.length !== dimensions) {
        throw new Error(`Embedding must contain ${dimensions} finite values.`);
      }
      return { embedding };
    } catch (error) {
      throw documentActionError(error, 'DOCUMENT_EMBEDDING_FAILED', 'Document embedding failed.', 'document-embed', true);
    }
  });
}

export interface DocumentInsertDependencies {
  getFolder?: typeof getFolderById;
  getDocument?: typeof getDocumentById;
  insert?: typeof insertPreparedDocument;
  logger?: DocumentActionLogger;
}

export async function documentInsert(input: Document, options: DocumentInsertDependencies = {}): Promise<{ document: Document }> {
  return observed('document-insert', { documentKey: input.key, scopeKey: input.scopeKey, folderKey: input.folderKey, extension: input.extension, mimeType: input.mimeType, sizeBytes: input.sizeBytes }, options.logger ?? defaultLogger, async () => {
    try {
      const document = documentSchema.parse(input);
      if (document.embedding.length === 0) throw new Error('A document embedding is required.');
      const folder = await (options.getFolder ?? getFolderById)(document.folderKey);
      if (!folder || folder.scopeKey !== document.scopeKey) throw new Error('The Archive folder does not exist in the requested scope.');
      const existing = await (options.getDocument ?? getDocumentById)(document.key);
      if (existing) return { document: existing };
      return { document: await (options.insert ?? insertPreparedDocument)(document) };
    } catch (error) {
      throw documentActionError(error, 'DOCUMENT_INSERT_FAILED', 'Document insertion failed.', 'document-insert', true);
    }
  });
}

export function documentKeyForRequest(scopeKey: string, folderKey: string, idempotencyKey: string | undefined): string {
  if (!idempotencyKey) return newId();
  const digest = createHash('sha256').update(scopeKey).update('\0').update(folderKey).update('\0').update(idempotencyKey).digest('hex');
  return `c${digest.slice(0, 24)}`;
}

export const DOCUMENT_ACTIONS = {
  'document-validate': documentValidate,
  'storage-upload': storageUpload,
  'document-extract': documentExtract,
  'document-generate-html': documentGenerateHtml,
  'document-generate-json': documentGenerateJson,
  'document-generate-content': documentGenerateContent,
  'document-embed': documentEmbed,
  'document-insert': documentInsert,
} as const;

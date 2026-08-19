import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import { EMBEDDING_DIMENSIONS, embedText, embedTexts } from '@/lib/embeddings';
import { getDocumentById, insertPreparedDocument, documentSchema, type Document, type DocumentExtension } from '@/lib/db/documents.node';
import { getFolderById } from '@/lib/db/folders.node';
import { newId } from '@/lib/ids';
import { documentActionError, DocumentProcessingError } from './errors';
import {
  extractionResultSchema,
  normalizedDocumentSchema,
  type DocumentActionName,
  type ExtractionResult,
  type NormalizedDocument,
  type UploadedDocumentFile,
} from './schemas';
import { documentStorage, type DocumentStorage } from './storage';
import { awsTextractDocumentOcr, type DocumentOcr } from './textract';
import { chunkDocumentContent, chunkDocumentText, documentEmbeddingTexts, documentSemanticHash } from './chunking';

export const DEFAULT_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const DEFAULT_EMBEDDING_DIMENSIONS = EMBEDDING_DIMENSIONS;
export const DEFAULT_MAX_EXTRACTED_CHARACTERS = 10_000_000;
const MAX_DOCX_ENTRIES = 10_000;
const MAX_DOCX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_DOCX_COMPRESSION_RATIO = 100;

export function positiveDocumentLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function maxExtractedCharacters(): number {
  return positiveDocumentLimit(process.env.CONTENT_MAX_EXTRACTED_CHARACTERS, DEFAULT_MAX_EXTRACTED_CHARACTERS);
}

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

function validateDocxContent(bytes: Uint8Array): boolean {
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
  if (extension === 'pdf') return hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) && new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 1_024))).includes('%%EOF');
  if (extension === 'doc') return hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (extension === 'docx') return hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]) && validateDocxContent(bytes);
  return !bytes.includes(0);
}

export async function documentValidate(input: {
  file: UploadedDocumentFile;
  scopeKey: string;
  folderKey?: string;
  name?: string;
}, options: { maxBytes?: number; logger?: DocumentActionLogger } = {}): Promise<NormalizedDocument> {
  return observed('document-validate', { scopeKey: input.scopeKey, folderKey: input.folderKey }, options.logger ?? defaultLogger, async () => {
    try {
      const maxBytes = positiveDocumentLimit(options.maxBytes ?? process.env.CONTENT_MAX_DOCUMENT_BYTES, DEFAULT_MAX_DOCUMENT_BYTES);
      const uploaded = await uploadedFileBytes(input.file, maxBytes);
      const safeFilename = basename(uploaded.filename.trim());
      if (!safeFilename || safeFilename !== uploaded.filename.trim() || safeFilename === '.' || safeFilename === '..' || /[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(safeFilename)) {
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
      const storageKey = `content/${input.scopeKey}/${input.folderKey ?? 'root'}/${input.documentKey}/${contentHash}/original.${input.extension}`;
      return await (options.storage ?? documentStorage).upload({ key: storageKey, bytes: input.fileInput, mimeType: input.mimeType });
    } catch (error) {
      throw documentActionError(error, 'DOCUMENT_UPLOAD_FAILED', 'The document could not be uploaded.', 'storage-upload', true);
    }
  });
}

function extractionFromText(text: string, metadata?: Record<string, unknown>): ExtractionResult {
  const maxCharacters = maxExtractedCharacters();
  if (text.length > maxCharacters) throw new Error('Extracted document content exceeds the configured limit.');
  if (!text.trim()) throw new Error('The document contains no extractable text.');
  return extractionResultSchema.parse({ extractedText: text.trim(), metadata });
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
        const result = extractionResultSchema.parse(await (options.ocr ?? awsTextractDocumentOcr).extract(input.storageKey, input.fileInput));
        if (result.extractedText.length > maxExtractedCharacters()) throw new Error('Extracted document content exceeds the configured limit.');
        if (!result.extractedText.trim()) throw new Error('The document contains no extractable text.');
        return result;
      }
      if (input.extension === 'txt') {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(input.fileInput);
        if (text.length > maxExtractedCharacters()) throw new Error('Extracted document content exceeds the configured limit.');
        const extracted = extractionFromText(text);
        return extracted;
      }
      if (input.extension === 'md') {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(input.fileInput);
        if (text.length > maxExtractedCharacters()) throw new Error('Extracted document content exceeds the configured limit.');
        return extractionFromText(text, { format: 'markdown' });
      }
      if (input.extension === 'docx') {
        if (options.extractDocx) return extractionFromText(await options.extractDocx(input.fileInput));
        const result = await mammoth.extractRawText({ buffer: Buffer.from(input.fileInput) });
        return extractionFromText(result.value, { format: 'docx', warnings: result.messages.length });
      }
      if (options.extractDoc) return extractionFromText(await options.extractDoc(input.fileInput));
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(Buffer.from(input.fileInput));
      return extractionFromText(extracted.getBody());
    } catch (error) {
      const message = process.env.NODE_ENV === 'development' && error instanceof Error
        ? `The document could not be extracted: ${error.message}`
        : 'The document could not be extracted.';
      throw documentActionError(error, 'DOCUMENT_EXTRACTION_FAILED', message, 'document-extract', true);
    }
  });
}

export function sanitizeDocumentContent(value: string): string {
  return value.replace(/\0/g, '').replace(/\r\n?/g, '\n').replace(/[\t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function documentCleanup(input: { text: string }, options: { clean?: (text: string) => Promise<string>; logger?: DocumentActionLogger } = {}): Promise<{ content: string }> {
  return observed('document-cleanup', {}, options.logger ?? defaultLogger, async () => {
    try {
      const clean = options.clean;
      if (!clean) {
        const content = sanitizeDocumentContent(input.text);
        if (!content) throw new Error('The document contains no text to clean.');
        if (content.length > maxExtractedCharacters()) throw new Error('Cleaned document content exceeds the configured limit.');
        return { content };
      }
      const chunks = chunkDocumentText(input.text);
      if (!chunks.length) throw new Error('The document contains no text to clean.');
      const cleaned = new Array<string>(chunks.length);
      let cursor = 0;
      const worker = async () => {
        while (cursor < chunks.length) {
          const index = cursor++;
          const chunk = chunks[index];
          if (!chunk) return;
           const content = sanitizeDocumentContent(await clean(chunk.text));
           if (!content) throw new Error(`The document cleanup model returned no content for chunk ${index + 1}.`);
           cleaned[index] = content;
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, () => worker()));
      const content = sanitizeDocumentContent(cleaned.join('\n\n'));
      if (!content) throw new Error('The document cleanup model returned no content.');
      if (content.length > maxExtractedCharacters()) throw new Error('Cleaned document content exceeds the configured limit.');
      return { content };
    } catch (error) {
      throw documentActionError(error, 'DOCUMENT_TEXT_CLEANUP_FAILED', 'Document text cleanup failed.', 'document-cleanup', true);
    }
  });
}

export async function documentEmbed(input: { name: string; content: string }, options: { embed?: typeof embedText; embedBatch?: typeof embedTexts; dimensions?: number; logger?: DocumentActionLogger } = {}): Promise<{ embedding: number[]; contentChunks: string[]; chunkEmbeddings: number[][]; semanticChunkCount: number; semanticContentHash: string }> {
  return observed('document-embed', {}, options.logger ?? defaultLogger, async () => {
    try {
      const contentChunks = chunkDocumentContent(input.content);
      const texts = documentEmbeddingTexts(input.name, contentChunks);
      const chunkEmbeddings = options.embedBatch
        ? await options.embedBatch({ texts })
        : options.embed
          ? await Promise.all(texts.map((text) => options.embed!({ text })))
          : await embedTexts({ texts });
      const dimensions = options.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
      if (chunkEmbeddings.length !== contentChunks.length || chunkEmbeddings.some((embedding) => !Array.isArray(embedding) || embedding.length !== dimensions || embedding.some((value) => !Number.isFinite(value)))) {
        throw new Error(`Embedding must contain ${dimensions} finite values.`);
      }
      return { embedding: chunkEmbeddings[0]!, contentChunks, chunkEmbeddings, semanticChunkCount: contentChunks.length, semanticContentHash: documentSemanticHash(input.content) };
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
      const expectedChunks = chunkDocumentContent(input.content);
      if (input.contentChunks && (input.contentChunks.length !== expectedChunks.length || input.contentChunks.some((chunk, index) => chunk !== expectedChunks[index]))) throw new Error('Document chunks must be derived from canonical content.');
      const contentChunks = input.contentChunks ?? expectedChunks;
      const chunkEmbeddings = input.chunkEmbeddings ?? (contentChunks.length === 1 ? [input.embedding] : undefined);
      const document = documentSchema.parse({ ...input, contentChunks, chunkEmbeddings, semanticChunkCount: contentChunks.length, semanticContentHash: documentSemanticHash(input.content), _semanticChunkingSkipped: undefined });
      if (document.embedding.length === 0) throw new Error('A document embedding is required.');
      if (!document.contentChunks || !document.chunkEmbeddings || document.contentChunks.length !== document.chunkEmbeddings.length) throw new Error('Aligned document chunks and embeddings are required.');
      if (document.folderKey) {
        const folder = await (options.getFolder ?? getFolderById)(document.folderKey);
        if (!folder || folder.scopeKey !== document.scopeKey) throw new Error('The Content folder does not exist in the requested scope.');
      }
      const existing = await (options.getDocument ?? getDocumentById)(document.key);
      if (existing) {
        return { document: existing };
      }
      return { document: await (options.insert ?? insertPreparedDocument)(document) };
    } catch (error) {
      throw documentActionError(error, 'DOCUMENT_INSERT_FAILED', 'Document insertion failed.', 'document-insert', true);
    }
  });
}

export function documentKeyForRequest(scopeKey: string, folderKey: string | undefined, idempotencyKey: string | undefined): string {
  if (!idempotencyKey) return newId();
  const digest = createHash('sha256').update(scopeKey).update('\0').update(folderKey ?? 'root').update('\0').update(idempotencyKey).digest('hex');
  return `c${digest.slice(0, 24)}`;
}

export const DOCUMENT_ACTIONS = {
  'document-validate': documentValidate,
  'storage-upload': storageUpload,
  'document-extract': documentExtract,
  'document-cleanup': documentCleanup,
  'document-embed': documentEmbed,
  'document-insert': documentInsert,
} as const;

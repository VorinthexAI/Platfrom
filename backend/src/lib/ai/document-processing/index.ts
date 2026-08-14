import type { Document } from '@/lib/db/documents.node';
import { documentParseInputSchema, type DocumentParseInput } from './schemas';
import {
  documentEmbed,
  documentExtract,
  documentGenerateContent,
  documentGenerateHtml,
  documentInsert,
  documentKeyForRequest,
  documentValidate,
  storageUpload,
  type DocumentActionLogger,
  type DocumentInsertDependencies,
} from './actions';
import { DocumentProcessingError } from './errors';
import { documentStorage, type DocumentStorage } from './storage';
import type { DocumentOcr } from './textract';
import type { embedText } from '@/lib/embeddings';
import type { embedTexts } from '@/lib/embeddings';
import { htmlToPlainText, sanitizeDocumentHtml } from './representation';

export interface DocumentParseDependencies extends DocumentInsertDependencies {
  storage?: DocumentStorage;
  ocr?: DocumentOcr;
  embed?: typeof embedText;
  embedBatch?: typeof embedTexts;
  embeddingDimensions?: number;
  maxBytes?: number;
  logger?: DocumentActionLogger;
  actions?: Partial<DocumentPipelineActions>;
}

export interface DocumentParseResult {
  document: Document;
}

export interface DocumentPipelineActions {
  validate: typeof documentValidate;
  upload: typeof storageUpload;
  extract: typeof documentExtract;
  generateHtml: typeof documentGenerateHtml;
  generateContent: typeof documentGenerateContent;
  embed: typeof documentEmbed;
  insert: typeof documentInsert;
}

async function deleteWithRetry(storage: DocumentStorage, storageKey: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await storage.delete(storageKey);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
  throw lastError;
}

/** Orchestrates the Content ingestion actions and compensates S3 on every failure after upload. */
export async function parseDocument(rawInput: DocumentParseInput, dependencies: DocumentParseDependencies = {}): Promise<DocumentParseResult> {
  const started = performance.now();
  const input = documentParseInputSchema.parse(rawInput);
  const logger = dependencies.logger ?? ((event) => console.info(JSON.stringify(event)));
  const actions: DocumentPipelineActions = {
    validate: dependencies.actions?.validate ?? documentValidate,
    upload: dependencies.actions?.upload ?? storageUpload,
    extract: dependencies.actions?.extract ?? documentExtract,
    generateHtml: dependencies.actions?.generateHtml ?? documentGenerateHtml,
    generateContent: dependencies.actions?.generateContent ?? documentGenerateContent,
    embed: dependencies.actions?.embed ?? documentEmbed,
    insert: dependencies.actions?.insert ?? documentInsert,
  };
  logger({ action: 'document.parse', status: 'started', scopeKey: input.scopeKey, folderKey: input.folderKey });

  const normalized = await actions.validate(input, { maxBytes: dependencies.maxBytes, logger });
  if (normalized.folderKey) {
    const folder = await (dependencies.getFolder ?? (await import('@/lib/db/folders.node')).getFolderById)(normalized.folderKey);
    if (!folder || folder.scopeKey !== normalized.scopeKey) {
      throw new DocumentProcessingError('DOCUMENT_INSERT_FAILED', 'The Content folder does not exist in the requested scope.', 'document.parse');
    }
    if (folder.deletedAt !== null) {
      throw new DocumentProcessingError('DOCUMENT_INSERT_FAILED', 'The Content folder is archived.', 'document.parse');
    }
  }
  const documentKey = documentKeyForRequest(normalized.scopeKey, normalized.folderKey, input.idempotencyKey);
  if (input.idempotencyKey) {
    const existing = await (dependencies.getDocument ?? (await import('@/lib/db/documents.node')).getDocumentById)(documentKey);
    if (existing) {
      if (existing.deletedAt !== null) {
        throw new DocumentProcessingError('DOCUMENT_INSERT_FAILED', 'The idempotent Content document is archived.', 'document.parse');
      }
      logger({ action: 'document.parse', status: 'completed', documentKey, scopeKey: input.scopeKey, folderKey: input.folderKey, durationMs: Math.round(performance.now() - started), idempotent: true });
      return { document: existing };
    }
  }

  const storage = dependencies.storage ?? documentStorage;
  const uploaded = await actions.upload({ ...normalized, documentKey }, { storage, logger });
  try {
    let extraction;
    try {
      extraction = await actions.extract({ ...normalized, storageKey: uploaded.storageKey }, { ocr: dependencies.ocr, logger });
    } catch (error) {
      if (normalized.extension !== 'pdf') throw error;
      logger({ action: 'document-extract', status: 'failed', documentKey, scopeKey: input.scopeKey, folderKey: input.folderKey, extension: normalized.extension, retained: true });
      extraction = {
        extractedText: 'Text extraction is unavailable for this PDF file.',
        blocks: [{ type: 'paragraph' as const, text: 'Text extraction is unavailable for this PDF file.' }],
        metadata: { extractionStatus: 'unavailable' },
      };
    }
    const generated = await actions.generateHtml(extraction, { logger });
    const html = sanitizeDocumentHtml(generated.html);
    const canonicalContent = htmlToPlainText(html);
    const { content } = await actions.generateContent({ html }, { logger });
    if (content !== canonicalContent) throw new DocumentProcessingError('DOCUMENT_CONTENT_GENERATION_FAILED', 'Document content must be derived from canonical HTML.', 'document-generate-content');
    const semantics = await actions.embed({ name: normalized.name, content }, { embed: dependencies.embed, embedBatch: dependencies.embedBatch, dimensions: dependencies.embeddingDimensions, logger });
    const timestamp = new Date().toISOString();
    const result = await actions.insert({
      key: documentKey,
      scopeKey: normalized.scopeKey,
      ...(normalized.folderKey ? { folderKey: normalized.folderKey } : {}),
      name: normalized.name,
      extension: normalized.extension,
      mimeType: normalized.mimeType,
      storageKey: uploaded.storageKey,
      sizeBytes: normalized.sizeBytes,
      html,
      content,
      isFavorite: false,
      ...semantics,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }, { getFolder: dependencies.getFolder, getDocument: dependencies.getDocument, insert: dependencies.insert, logger });
    logger({ action: 'document.parse', status: 'completed', documentKey, scopeKey: input.scopeKey, folderKey: input.folderKey, extension: normalized.extension, mimeType: normalized.mimeType, sizeBytes: normalized.sizeBytes, durationMs: Math.round(performance.now() - started) });
    return result;
  } catch (error) {
    let existing: Document | null;
    try {
      existing = await (dependencies.getDocument ?? (await import('@/lib/db/documents.node')).getDocumentById)(documentKey);
    } catch (ownershipError) {
      throw new DocumentProcessingError('DOCUMENT_CLEANUP_FAILED', 'Document ownership could not be verified after insertion failed; the uploaded object was retained for safe reconciliation.', 'document.parse', {
        retryable: true,
        cause: new AggregateError([error, ownershipError], 'Insertion and ownership verification failed.'),
      });
    }
    if (existing && existing.deletedAt === null) {
      if (existing.storageKey !== uploaded.storageKey) {
        try {
          await deleteWithRetry(storage, uploaded.storageKey);
        } catch (cleanupError) {
          throw new DocumentProcessingError('DOCUMENT_CLEANUP_FAILED', 'The duplicate document upload could not be cleaned up.', 'document.parse', {
            retryable: true,
            cause: new AggregateError([error, cleanupError], 'Insertion and duplicate cleanup failed.'),
          });
        }
      }
      logger({ action: 'document.parse', status: 'completed', documentKey, scopeKey: input.scopeKey, folderKey: input.folderKey, durationMs: Math.round(performance.now() - started), idempotent: true });
      return { document: existing };
    }
    if (existing && existing.deletedAt !== null && existing.storageKey === uploaded.storageKey) throw error;
    try {
      await deleteWithRetry(storage, uploaded.storageKey);
    } catch (cleanupError) {
      logger({ action: 'document.parse', status: 'failed', documentKey, scopeKey: input.scopeKey, folderKey: input.folderKey, durationMs: Math.round(performance.now() - started), cleanup: 'failed' });
      throw new DocumentProcessingError('DOCUMENT_CLEANUP_FAILED', 'Document parsing failed and its uploaded object could not be cleaned up.', 'document.parse', {
        retryable: true,
        cause: new AggregateError([error, cleanupError], 'Parsing and cleanup failed.'),
      });
    }
    logger({ action: 'document.parse', status: 'failed', documentKey, scopeKey: input.scopeKey, folderKey: input.folderKey, durationMs: Math.round(performance.now() - started), cleanup: 'completed' });
    throw error;
  }
}

export * from './actions';
export * from './chunking';
export * from './errors';
export * from './exports';
export * from './representation';
export * from './schemas';
export * from './storage';
export * from './textract';

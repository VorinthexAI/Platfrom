import sharp from 'sharp';
import { transcribeDocument } from '@/lib/ai/actions/document-transcription';
import { documentStorage } from './storage';
import { documentKeyForRequest, documentCleanup, documentEmbed, documentInsert } from './actions';
import { MAX_DOCUMENT_SCAN_PAGE_BYTES, type DocumentParseInput } from './schemas';
import { DocumentProcessingError } from './errors';
import type { DocumentParseDependencies, DocumentParseResult } from './index';
import { getDocumentById } from '@/lib/db/documents.node';
import { getFolderById } from '@/lib/db/folders.node';
import { reserveStorageKeyForUpload, renewStorageUploadReservation, acknowledgeStorageUploadReservation, releaseStorageUploadReservation, type StorageUploadReservation } from '@/lib/db/storage-deletion-jobs.node';
import { startStorageUploadHeartbeat } from '@/lib/storage-upload-reservation';

export async function parseDocumentPages(input: DocumentParseInput & { pages: NonNullable<DocumentParseInput['pages']> }, dependencies: DocumentParseDependencies): Promise<DocumentParseResult> {
  const storage = dependencies.storage ?? documentStorage;
  const getDocument = dependencies.getDocument ?? getDocumentById;
  const key = documentKeyForRequest(input.scopeKey, input.folderKey, input.idempotencyKey);
  if (input.folderKey) {
    const folder = await (dependencies.getFolder ?? getFolderById)(input.folderKey);
    if (!folder || folder.scopeKey !== input.scopeKey) throw new DocumentProcessingError('DOCUMENT_INSERT_FAILED', 'The document destination is unavailable.', 'document.parse');
  }
  const existing = input.idempotencyKey ? await getDocument(key) : null;
  if (existing) return { document: existing };
  const uploaded: string[] = [];
  const reservations: Array<{ value: StorageUploadReservation; heartbeat: ReturnType<typeof startStorageUploadHeartbeat> }> = [];
  const reserve = dependencies.reserveStorageKey ?? (dependencies.storage ? async (storageKey: string) => ({ storageKey, token: 'custom-storage' }) : reserveStorageKeyForUpload);
  const renew = dependencies.renewStorageReservation ?? (dependencies.storage ? async () => true : renewStorageUploadReservation);
  const acknowledge = dependencies.acknowledgeStorageReservation ?? (dependencies.storage ? async () => true : acknowledgeStorageUploadReservation);
  const release = dependencies.releaseStorageReservation ?? (dependencies.storage ? async () => true : releaseStorageUploadReservation);
  const checkpoint = async () => { dependencies.signal?.throwIfAborted(); for (const item of reservations) await item.heartbeat.checkpoint(); };
  const storageKeys = input.pages.map((_, index) => `content/${input.scopeKey}/${input.folderKey ?? 'root'}/${key}/scan/page-${String(index + 1).padStart(2, '0')}.png`);
  try {
    const pages: Uint8Array[] = [];
    let total = 0;
    for (const page of input.pages) {
      dependencies.signal?.throwIfAborted();
      const bytes = new Uint8Array(await sharp(page.bytes, { animated: false, failOn: 'error', limitInputPixels: 100_000_000 }).rotate().png().toBuffer());
      total += bytes.byteLength;
      if (bytes.byteLength > MAX_DOCUMENT_SCAN_PAGE_BYTES || total > MAX_DOCUMENT_SCAN_PAGE_BYTES * 2) throw new DocumentProcessingError('DOCUMENT_TOO_LARGE', 'Normalized pages exceed the supported size limit.', 'document-validate');
      pages.push(bytes);
    }
    const text = new Array<string>(pages.length);
    let next = 0;
    const workers = await Promise.allSettled(Array.from({ length: Math.min(3, pages.length) }, async () => {
      while (next < pages.length) {
        const index = next++;
        dependencies.signal?.throwIfAborted();
        const reservation = await reserve(storageKeys[index]!);
        if (!reservation) throw new Error('A source page upload or deletion is already in progress');
        const heartbeat = startStorageUploadHeartbeat(reservation, renew, dependencies.reservationHeartbeatMs);
        reservations.push({ value: reservation, heartbeat });
        // Track attempted uploads too: a lost response may still have stored bytes.
        uploaded.push(storageKeys[index]!);
        await storage.upload({ key: storageKeys[index]!, bytes: pages[index]!, mimeType: 'image/png' });
        await heartbeat.checkpoint();
        const result = await (dependencies.transcribe ?? transcribeDocument)({ type: 'image', mimeType: 'image/png', bytes: pages[index]! }, { teamKey: dependencies.teamKey ?? '', signal: dependencies.signal });
        await heartbeat.checkpoint();
        text[index] = result.text;
      }
    }));
    const failures = workers.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) throw failures[0]!.reason;
    await checkpoint();
    const { content } = await (dependencies.actions?.cleanup ?? documentCleanup)({ text: text.join('\n\n') }, { clean: dependencies.cleanText, logger: dependencies.logger });
    const name = input.name ?? `Scanned document ${new Date().toISOString().slice(0, 10)}`;
    const semantics = await (dependencies.actions?.embed ?? documentEmbed)({ name, content }, { embed: dependencies.embed, embedBatch: dependencies.embedBatch, dimensions: dependencies.embeddingDimensions, logger: dependencies.logger });
    await checkpoint();
    const now = new Date().toISOString();
    const result = await (dependencies.actions?.insert ?? documentInsert)({ key, scopeKey: input.scopeKey, ...(input.folderKey ? { folderKey: input.folderKey } : {}), name, content, sourceStorageKeys: storageKeys, ...semantics, mutationPolicy: 'user', isFavorite: false, createdAt: now, updatedAt: now }, { getFolder: dependencies.getFolder, getDocument, insert: dependencies.insert, logger: dependencies.logger });
    for (const item of reservations) if (!await acknowledge(item.value)) throw new Error('Source page upload acknowledgement was lost');
    return result;
  } catch (error) {
    // A post-commit failure must not delete the source pages owned by the saved document.
    const committed = await getDocument(key).catch((cause) => { throw new DocumentProcessingError('DOCUMENT_CLEANUP_FAILED', 'Document ownership could not be verified; source pages were retained.', 'document.parse', { retryable: true, cause }); });
    if (committed) { for (const item of reservations) await acknowledge(item.value); return { document: committed }; }
    const cleanup = await Promise.allSettled(uploaded.map((key) => storage.delete(key)));
    if (cleanup.some((result) => result.status === 'rejected')) throw new DocumentProcessingError('DOCUMENT_CLEANUP_FAILED', 'Source page cleanup requires retry.', 'document.parse', { retryable: true, cause: error });
    for (const item of reservations) await release(item.value);
    throw error;
  } finally { await Promise.all(reservations.map(({ heartbeat }) => heartbeat.stop())); }
}

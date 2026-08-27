import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db, withTransaction } from '@/lib/db/client';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { bookSchema, type Book } from '@/lib/db/books.node';
import { bookContextSchema, type BookContext } from '@/lib/db/book-contexts.node';
import { bookChapterSchema, type BookChapter } from '@/lib/db/book-chapters.node';
import { bookProgressSchema, type BookProgress } from '@/lib/db/book-progress.node';
import { bookSourceSchema, type BookSource } from '@/lib/db/book-sources.node';
import { chapterContextSchema, type ChapterContext } from '@/lib/db/chapter-contexts.node';

export interface BookAccessContext { organizationKey: string; scopeKey: string; userKey: string; generationLeaseToken?: string; signal?: AbortSignal }
export interface BookDetailRow { book: Book; chapters: Array<{ chapter: BookChapter; progress: BookProgress | null }> }
export interface RecoverableBookGeneration { bookKey: string; organizationKey: string; scopeKey: string; userKey: string }
export interface BookDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }> }
type BookTransactionRunner = <T>(collections: { read?: string[]; write: string[] }, fn: (transaction: BookDatabase) => Promise<T>) => Promise<T>;

export class BookRepositoryError extends Error {
  constructor(readonly reason: 'forbidden' | 'not_found' | 'conflict', message: string = reason) { super(message); }
}

const accessQuery = (write: boolean) => `LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate) LET scope = DOCUMENT(scopes, @scopeKey) LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role) FILTER membership != null && scope != null && scope.organizationKey == @organizationKey FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"${write ? '' : ', "member", "viewer"'}] RETURN membership._key`;
const parse = <T>(schema: { parse(value: unknown): T }, value: unknown) => schema.parse(withArangoKey(value as Record<string, unknown>));
const unsetPatch = (patch: Record<string, unknown>) => Object.fromEntries(Object.entries(patch).map(([field, value]) => [field, value === undefined ? null : value]));
const stableKey = (kind: string, ...values: string[]) => `c${createHash('sha256').update([kind, ...values].join('\0')).digest('hex').slice(0, 24)}`;
async function authorize(database: BookDatabase, context: BookAccessContext, write: boolean) {
  const { organizationKey, scopeKey, userKey } = context;
  if ((await (await database.query(accessQuery(write), { organizationKey, scopeKey, userKey })).all()).length === 0) throw new BookRepositoryError('forbidden');
}

export interface BookRepository {
  authorize(context: BookAccessContext, write?: boolean): Promise<void>;
  list(context: BookAccessContext): Promise<BookDetailRow[]>;
  detail(context: BookAccessContext, bookKey: string): Promise<BookDetailRow>;
  findByGenerationRequest(context: BookAccessContext, generationRequestKey: string): Promise<BookDetailRow | null>;
  listRecoverableGenerations(now: string): Promise<RecoverableBookGeneration[]>;
  failTerminalGeneration(job: RecoverableBookGeneration, message: string, now: string): Promise<boolean>;
  claimGeneration(context: BookAccessContext, bookKey: string, leaseToken: string, now: string, leaseExpiresAt: string): Promise<boolean>;
  renewGeneration(context: BookAccessContext, bookKey: string, leaseToken: string, leaseExpiresAt: string): Promise<boolean>;
  releaseGeneration(context: BookAccessContext, bookKey: string, leaseToken: string): Promise<boolean>;
  sourceDocuments(context: BookAccessContext, keys: string[]): Promise<Array<{ key: string; name: string; content: string; updatedAt: string }>>;
  sources(context: BookAccessContext, bookKey: string): Promise<BookSource[]>;
  create(context: BookAccessContext, book: Book, bookContext: BookContext, sources?: BookSource[]): Promise<Book>;
  replaceChapters(context: BookAccessContext, bookKey: string, chapters: BookChapter[], contexts: ChapterContext[], patch: Partial<Book>): Promise<void>;
  updateBook(context: BookAccessContext, bookKey: string, patch: Partial<Book>): Promise<Book>;
  updateChapter(context: BookAccessContext, chapterKey: string, patch: Partial<BookChapter>): Promise<BookChapter>;
  isCancellationRequested(context: BookAccessContext, bookKey: string): Promise<boolean>;
  retryGeneration(context: BookAccessContext, bookKey: string, now: string): Promise<Book>;
  cancelGeneration(context: BookAccessContext, bookKey: string, now: string): Promise<Book>;
  deleteBook(context: BookAccessContext, bookKey: string, now: string): Promise<{ deleted: true; bookKey: string }>;
  publishChapters(context: BookAccessContext, bookKey: string, chapterCount: 10 | 25 | 50, now: string): Promise<void>;
  ensureGalleryExportCollection(context: BookAccessContext, embedding: number[], now: string): Promise<{ collectionKey: string; ownerKey: string }>;
  linkGalleryExportImages(context: BookAccessContext, collectionKey: string, ownerKey: string, imageKeys: string[], now: string): Promise<void>;
  addSources(context: BookAccessContext, bookKey: string, sources: BookSource[]): Promise<void>;
  advanceGeneration(context: BookAccessContext, bookKey: string, now: string): Promise<void>;
  reconcileGeneration(context: BookAccessContext, bookKey: string, completedUnits: number, now: string): Promise<void>;
  enqueueUnreferencedStorage(context: BookAccessContext, storageKeys: string[], now: string): Promise<void>;
  upsertProgress(context: BookAccessContext, bookKey: string, chapterKey: string, progress: BookProgress): Promise<BookProgress>;
}

export function createBookRepository(database: BookDatabase = db, transact: BookTransactionRunner = withTransaction as BookTransactionRunner): BookRepository {
  const readDetail = async (context: BookAccessContext, bookKey?: string) => {
    await authorize(database, context, false);
    const rows = await (await database.query(`FOR book IN books FILTER book.scopeKey == @scopeKey ${bookKey ? '&& book._key == @bookKey' : ''} LET chapters = (FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == book._key LET progress = FIRST(FOR item IN bookProgress FILTER item.scopeKey == @scopeKey && item.userKey == @userKey && item.bookKey == book._key && item.chapterKey == chapter._key LIMIT 1 RETURN item) SORT chapter.position ASC RETURN { chapter, progress }) SORT book.updatedAt DESC RETURN { book, chapters }`, { scopeKey: context.scopeKey, userKey: context.userKey, ...(bookKey ? { bookKey } : {}) })).all() as Array<{ book: unknown; chapters: Array<{ chapter: unknown; progress: unknown | null }> }>;
    return rows.map((row) => ({ book: parse(bookSchema, row.book), chapters: row.chapters.map(({ chapter, progress }) => ({ chapter: parse(bookChapterSchema, chapter), progress: progress ? parse(bookProgressSchema, progress) : null })) }));
  };
  return {
    authorize: (context, write = false) => authorize(database, context, write),
    list: (context) => readDetail(context),
    async detail(context, bookKey) { const row = (await readDetail(context, bookKey))[0]; if (!row) throw new BookRepositoryError('not_found'); return row; },
    async findByGenerationRequest(context, generationRequestKey) { await authorize(database, context, false); const key = (await (await database.query('FOR book IN books FILTER book.scopeKey == @scopeKey && book.generationRequestKey == @generationRequestKey LIMIT 1 RETURN book._key', { scopeKey: context.scopeKey, generationRequestKey })).all())[0]; return typeof key === 'string' ? (await readDetail(context, key))[0] ?? null : null; },
    async listRecoverableGenerations(now) {
      const rows = await (await database.query('FOR book IN books FILTER book.status IN ["queued", "planning", "researching", "writing", "finalizing", "narrating"] FILTER book.generationInput != null && book.generationOwnerKey != null FILTER book.generationLeaseToken == null || book.generationLeaseExpiresAt == null || book.generationLeaseExpiresAt <= @now LET scope = DOCUMENT(scopes, book.scopeKey) FILTER scope != null RETURN { bookKey: book._key, organizationKey: scope.organizationKey, scopeKey: book.scopeKey, userKey: book.generationOwnerKey }', { now })).all();
      return rows.map((row) => z.object({ bookKey: z.string().cuid(), organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(), userKey: z.string().cuid() }).parse(row));
    },
    async failTerminalGeneration(job, message, now) { const rows = await (await database.query('LET scope = DOCUMENT(scopes, @scopeKey) FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && scope != null && scope.organizationKey == @organizationKey FILTER book.generationOwnerKey == @userKey && book.status NOT IN ["ready", "cancelled", "failed"] FILTER book.generationLeaseToken == null || book.generationLeaseExpiresAt == null || book.generationLeaseExpiresAt <= @now UPDATE book WITH { status: "failed", generationError: @message, updatedAt: @now } IN books RETURN 1', { ...job, message: message.slice(0, 4_000), now })).all(); return rows.length === 1; },
    async claimGeneration(context, bookKey, leaseToken, now, leaseExpiresAt) { await authorize(database, context, true); const rows = await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.status NOT IN ["ready", "cancelled"] && book.cancelRequestedAt == null FILTER book.generationLeaseToken == null || book.generationLeaseExpiresAt == null || book.generationLeaseExpiresAt <= @now UPDATE book WITH { generationLeaseToken: @leaseToken, generationLeaseExpiresAt: @leaseExpiresAt } IN books RETURN 1', { bookKey, scopeKey: context.scopeKey, leaseToken, now, leaseExpiresAt })).all(); return rows.length === 1; },
    async renewGeneration(context, bookKey, leaseToken, leaseExpiresAt) { await authorize(database, context, true); const rows = await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.generationLeaseToken == @leaseToken && book.cancelRequestedAt == null && book.status != "cancelled" UPDATE book WITH { generationLeaseExpiresAt: @leaseExpiresAt } IN books RETURN 1', { bookKey, scopeKey: context.scopeKey, leaseToken, leaseExpiresAt })).all(); return rows.length === 1; },
    async releaseGeneration(context, bookKey, leaseToken) { await authorize(database, context, true); const rows = await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.generationLeaseToken == @leaseToken UPDATE book WITH { generationLeaseToken: null, generationLeaseExpiresAt: null } IN books OPTIONS { keepNull: false } RETURN 1', { bookKey, scopeKey: context.scopeKey, leaseToken })).all(); return rows.length === 1; },
    async sourceDocuments(context, keys) { await authorize(database, context, false); const rows = await (await database.query('FOR document IN documents FILTER document.scopeKey == @scopeKey && document._key IN @keys && document.mutationPolicy != "system-only" && (!HAS(document, "_internalDeletion") || document._internalDeletion == null) RETURN document', { scopeKey: context.scopeKey, keys })).all(); if (rows.length !== new Set(keys).size) throw new BookRepositoryError('forbidden', 'One or more selected source documents are unavailable.'); return rows.map((value) => { const source = value as Record<string, unknown>; return { key: String(source._key), name: String(source.name), content: String(source.content), updatedAt: String(source.updatedAt) }; }); },
    async sources(context, bookKey) { await authorize(database, context, false); return (await (await database.query('FOR source IN bookSources FILTER source.scopeKey == @scopeKey && source.bookKey == @bookKey SORT source.createdAt ASC, source._key ASC RETURN source', { scopeKey: context.scopeKey, bookKey })).all()).map((value) => parse(bookSourceSchema, value)); },
    async create(context, book, bookContext, sources = []) {
      try {
        return await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['books', 'bookContexts', 'bookSources'] }, async (transaction) => {
          await authorize(transaction, context, true);
          const inserted = await transaction.query('INSERT @book INTO books RETURN NEW', { book: toArangoDoc(book) });
          await transaction.query('INSERT @context INTO bookContexts', { context: toArangoDoc(bookContextSchema.parse(bookContext)) });
          for (const source of sources) await transaction.query('INSERT @source INTO bookSources', { source: toArangoDoc(bookSourceSchema.parse(source)) });
          return parse(bookSchema, (await inserted.all())[0]);
        });
      } catch (error) { if (isArangoUniqueConstraintError(error)) throw new BookRepositoryError('conflict'); throw error; }
    },
    replaceChapters(context, bookKey, chapters, contexts, patch) {
      return transact({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['books', 'bookChapters', 'chapterContexts'] }, async (transaction) => {
        await authorize(transaction, context, true);
        if (chapters.length !== contexts.length || chapters.some((chapter, index) => contexts[index]?.chapterKey !== chapter.key)) throw new BookRepositoryError('conflict', 'Chapter contexts must match the outline.');
        const updated = await (await transaction.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && LENGTH(FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey LIMIT 1 RETURN 1) == 0 && (!@fenced || (book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled")) UPDATE book WITH @patch IN books OPTIONS { keepNull: false } RETURN 1', { bookKey, scopeKey: context.scopeKey, fenced: context.generationLeaseToken !== undefined, generationLeaseToken: context.generationLeaseToken ?? null, patch: unsetPatch(patch) })).all();
        if (!updated.length) throw new BookRepositoryError(context.generationLeaseToken ? 'conflict' : 'not_found', context.generationLeaseToken ? 'Book generation lease was lost.' : undefined);
        for (const chapter of chapters) await transaction.query('INSERT @chapter INTO bookChapters', { chapter: toArangoDoc(bookChapterSchema.parse(chapter)) });
        for (const chapterContext of contexts) await transaction.query('INSERT @context INTO chapterContexts', { context: toArangoDoc(chapterContextSchema.parse(chapterContext)) });
      });
    },
    async updateBook(context, bookKey, patch) { await authorize(database, context, true); const value = (await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && (!@fenced || (book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled")) UPDATE book WITH @patch IN books OPTIONS { keepNull: false } RETURN NEW', { bookKey, scopeKey: context.scopeKey, fenced: context.generationLeaseToken !== undefined, generationLeaseToken: context.generationLeaseToken ?? null, patch: unsetPatch(patch) })).all())[0]; if (!value) throw new BookRepositoryError(context.generationLeaseToken ? 'conflict' : 'not_found', context.generationLeaseToken ? 'Book generation lease was lost.' : undefined); return parse(bookSchema, value); },
    async updateChapter(context, chapterKey, patch) { await authorize(database, context, true); const value = (await (await database.query('LET chapter = DOCUMENT(bookChapters, @chapterKey) LET book = chapter == null ? null : DOCUMENT(books, chapter.bookKey) FILTER chapter != null && chapter.scopeKey == @scopeKey && (!@fenced || (book != null && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled")) UPDATE chapter WITH @patch IN bookChapters OPTIONS { keepNull: false } RETURN NEW', { chapterKey, scopeKey: context.scopeKey, fenced: context.generationLeaseToken !== undefined, generationLeaseToken: context.generationLeaseToken ?? null, patch: unsetPatch(patch) })).all())[0]; if (!value) throw new BookRepositoryError(context.generationLeaseToken ? 'conflict' : 'not_found', context.generationLeaseToken ? 'Book generation lease was lost.' : undefined); return parse(bookChapterSchema, value); },
    async isCancellationRequested(context, bookKey) { await authorize(database, context, false); const values = await (await database.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey RETURN book.cancelRequestedAt != null || book.status == "cancelled"', { bookKey, scopeKey: context.scopeKey })).all(); if (!values.length) throw new BookRepositoryError('not_found'); return values[0] === true; },
    async retryGeneration(context, bookKey, now) { await authorize(database, context, true); const value = (await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.status IN ["failed", "cancelled"] && book.generationInput != null && book.generationOwnerKey != null FILTER book.generationLeaseToken == null || book.generationLeaseExpiresAt == null || book.generationLeaseExpiresAt <= @now UPDATE book WITH { status: "queued", generationError: null, cancelRequestedAt: null, generationLeaseToken: null, generationLeaseExpiresAt: null, generationAttempt: book.generationAttempt + 1, updatedAt: @now } IN books OPTIONS { keepNull: false } RETURN NEW', { bookKey, scopeKey: context.scopeKey, now })).all())[0]; if (!value) throw new BookRepositoryError('conflict', 'Generation can be retried only when resumable input is available and any active worker lease has expired.'); return parse(bookSchema, value); },
    async cancelGeneration(context, bookKey, now) { await authorize(database, context, true); const value = (await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.status NOT IN ["ready", "cancelled"] UPDATE book WITH { status: "cancelled", cancelRequestedAt: @now, updatedAt: @now } IN books RETURN NEW', { bookKey, scopeKey: context.scopeKey, now })).all())[0]; if (!value) throw new BookRepositoryError('conflict', 'Completed or already cancelled books cannot be cancelled.'); return parse(bookSchema, value); },
    async deleteBook(context, bookKey, now) {
      await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['books', 'bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'chapterContexts', 'bookProgress', 'storageDeletionJobs'] }, async (transaction) => {
        await authorize(transaction, context, true);
        const row = (await (await transaction.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey LET chapters = (FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey RETURN chapter) RETURN { book, chapters }', { bookKey, scopeKey: context.scopeKey })).all())[0] as { book: Record<string, unknown>; chapters: Array<Record<string, unknown>> } | undefined;
        if (!row) throw new BookRepositoryError('not_found');
        const chapterKeys = row.chapters.map((chapter) => String(chapter._key));
        const storageKeys = [row.book.coverStorageKey, ...row.chapters.flatMap((chapter) => [chapter.audioStorageKey, chapter.imageStorageKey])].filter((key): key is string => typeof key === 'string');
        for (const storageKey of storageKeys) await transaction.query('UPSERT { storageKey: @storageKey } INSERT { storageKey: @storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs', { storageKey, now });
        await transaction.query('FOR item IN chapterContexts FILTER item.scopeKey == @scopeKey && item.chapterKey IN @chapterKeys REMOVE item IN chapterContexts', { scopeKey: context.scopeKey, chapterKeys });
        for (const collection of ['bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'bookProgress']) await transaction.query(`FOR item IN ${collection} FILTER item.scopeKey == @scopeKey && item.bookKey == @bookKey REMOVE item IN ${collection}`, { scopeKey: context.scopeKey, bookKey });
        await transaction.query('REMOVE @bookKey IN books', { bookKey });
      });
      return { deleted: true, bookKey };
    },
    async publishChapters(context, bookKey, chapterCount, now) {
      await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['books'] }, async (transaction) => {
        await authorize(transaction, context, true);
        const result = await (await transaction.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled" && book.coverStorageKey != null LET chapters = (FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey SORT chapter.position ASC RETURN chapter) FILTER LENGTH(chapters) == @chapterCount && LENGTH(FOR chapter IN chapters FILTER chapter.status != "audio-ready" || chapter.content == null || chapter.audioStorageKey == null || chapter.audioDurationSeconds == null RETURN 1) == 0 UPDATE book WITH { status: "ready", generationStage: "complete", generationCompletedUnits: book.generationTotalUnits, estimatedMinutes: CEIL(SUM(chapters[*].audioDurationSeconds) / 60), updatedAt: @now } IN books RETURN LENGTH(chapters)', { bookKey, scopeKey: context.scopeKey, generationLeaseToken: context.generationLeaseToken, chapterCount, now })).all();
        if (result[0] !== chapterCount) throw new BookRepositoryError('conflict', 'Book publication prerequisites changed or the generation lease was lost.');
      });
      await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers', 'books', 'bookChapters'], write: ['folders', 'documents'] }, async (transaction) => {
        await authorize(transaction, context, true);
        await transaction.query(`LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey && book.status == "ready" LET chapters = (FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey && chapter.content != null SORT chapter.position ASC RETURN chapter) LET rootKey = @rootKey LET folderKey = @folderKey UPSERT { _key: rootKey } INSERT { _key: rootKey, scopeKey: @scopeKey, name: "Ascend", description: "Published books", mutationPolicy: "user", embedding: book.embedding, isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE {} IN folders UPSERT { _key: folderKey } INSERT { _key: folderKey, scopeKey: @scopeKey, parentFolderKey: rootKey, name: book.title, description: book.description, mutationPolicy: "user", embedding: book.embedding, isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE {} IN folders FOR chapter IN chapters LET documentKey = CONCAT("c", SUBSTRING(SHA256(CONCAT("chapter-export\\u0000", @bookKey, "\\u0000", chapter._key)), 0, 24)) UPSERT { _key: documentKey } INSERT { _key: documentKey, scopeKey: @scopeKey, folderKey, name: chapter.title, extension: "txt", mimeType: "text/plain", content: chapter.content, embedding: chapter.embedding, mutationPolicy: "user", isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE {} IN documents`, {
          bookKey,
          scopeKey: context.scopeKey,
          rootKey: stableKey('archive-ascend-root', context.scopeKey),
          folderKey: stableKey('archive-book-export', context.scopeKey, bookKey),
          now,
        });
      }).catch(() => undefined);
    },
    async ensureGalleryExportCollection(context, embedding, now) {
      await authorize(database, context, true);
      const ownerKey = (await (await database.query('FOR membership IN userOrganizations FILTER membership.organizationId == @organizationKey && membership.userId == @userKey && membership.status == "active" LIMIT 1 RETURN membership._key', { organizationKey: context.organizationKey, userKey: context.userKey })).all())[0];
      if (typeof ownerKey !== 'string') throw new BookRepositoryError('forbidden');
      const collectionKey = stableKey('gallery-ascend-export', context.scopeKey);
      await database.query('UPSERT { _key: @collectionKey } INSERT { _key: @collectionKey, scopeKey: @scopeKey, name: "Ascend", description: "Published book artwork", mutationPolicy: "user", embedding: @embedding, isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE {} IN collections', { collectionKey, scopeKey: context.scopeKey, embedding, now });
      await database.query('UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, memberKey: @ownerKey } INSERT { _key: @memberKey, scopeKey: @scopeKey, collectionKey: @collectionKey, memberKey: @ownerKey, role: "owner", createdAt: @now, updatedAt: @now } UPDATE {} IN collectionMembers', { memberKey: stableKey('gallery-ascend-export-member', context.scopeKey, ownerKey), scopeKey: context.scopeKey, collectionKey, ownerKey, now });
      return { collectionKey, ownerKey };
    },
    async linkGalleryExportImages(context, collectionKey, ownerKey, imageKeys, now) {
      if (!imageKeys.length) return;
      await authorize(database, context, true);
      await database.query('LET collection = DOCUMENT(collections, @collectionKey) FILTER collection != null && collection.scopeKey == @scopeKey && collection.mutationPolicy == "user" && collection.purpose == null FOR imageKey IN UNIQUE(@imageKeys) LET image = DOCUMENT(images, imageKey) FILTER image != null && image.scopeKey == @scopeKey LET relationKey = CONCAT("c", SUBSTRING(SHA256(CONCAT("book-gallery-export\\u0000", @collectionKey, "\\u0000", imageKey)), 0, 24)) UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey } INSERT { _key: relationKey, scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey, addedByKey: @ownerKey, createdAt: @now } UPDATE {} IN collectionImages', { collectionKey, scopeKey: context.scopeKey, ownerKey, imageKeys, now });
    },
    async addSources(context, bookKey, sources) {
      await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['books', 'bookSources'] }, async (transaction) => {
        await authorize(transaction, context, true);
        const owned = await (await transaction.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled" RETURN 1', { bookKey, scopeKey: context.scopeKey, generationLeaseToken: context.generationLeaseToken })).all();
        if (!owned.length) throw new BookRepositoryError('conflict', 'Book generation lease was lost.');
        for (const source of sources) await transaction.query('UPSERT { _key: @key } INSERT @source UPDATE @source IN bookSources', { key: source.key, source: toArangoDoc(bookSourceSchema.parse(source)) });
      });
    },
    async advanceGeneration(context, bookKey, now) { await authorize(database, context, true); const rows = await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled" UPDATE book WITH { generationCompletedUnits: MIN([book.generationTotalUnits, book.generationCompletedUnits + 1]), updatedAt: @now } IN books RETURN 1', { bookKey, scopeKey: context.scopeKey, generationLeaseToken: context.generationLeaseToken, now })).all(); if (!rows.length) throw new BookRepositoryError('conflict', 'Book generation lease was lost.'); },
    async reconcileGeneration(context, bookKey, completedUnits, now) { await authorize(database, context, true); const rows = await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled" UPDATE book WITH { generationCompletedUnits: MAX([book.generationCompletedUnits, MIN([book.generationTotalUnits, @completedUnits])]), updatedAt: @now } IN books RETURN 1', { bookKey, scopeKey: context.scopeKey, generationLeaseToken: context.generationLeaseToken, completedUnits, now })).all(); if (!rows.length) throw new BookRepositoryError('conflict', 'Book generation lease was lost.'); },
    async enqueueUnreferencedStorage(context, storageKeys, now) { if (!storageKeys.length) return; await authorize(database, context, true); await database.query('FOR storageKey IN UNIQUE(@storageKeys) LET referenced = LENGTH(FOR book IN books FILTER book.scopeKey == @scopeKey && book.coverStorageKey == storageKey LIMIT 1 RETURN 1) + LENGTH(FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && (chapter.audioStorageKey == storageKey || chapter.imageStorageKey == storageKey) LIMIT 1 RETURN 1) FILTER referenced == 0 UPSERT { storageKey } INSERT { storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs', { scopeKey: context.scopeKey, storageKeys, now }); },
    async upsertProgress(context, bookKey, chapterKey, progress) { await authorize(database, context, false); const value = (await (await database.query('LET book = DOCUMENT(books, @bookKey) LET chapter = DOCUMENT(bookChapters, @chapterKey) FILTER book != null && book.scopeKey == @scopeKey && chapter != null && chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey UPSERT { scopeKey: @scopeKey, userKey: @userKey, bookKey: @bookKey, chapterKey: @chapterKey } INSERT @progress UPDATE { progressSeconds: MAX([OLD.progressSeconds, @progress.progressSeconds]), isCompleted: OLD.isCompleted || @progress.isCompleted, completedAt: OLD.isCompleted ? OLD.completedAt : @progress.isCompleted ? @progress.completedAt : OLD.completedAt, updatedAt: @progress.updatedAt } IN bookProgress RETURN NEW', { scopeKey: context.scopeKey, userKey: context.userKey, bookKey, chapterKey, progress: toArangoDoc(bookProgressSchema.parse(progress)) })).all())[0]; if (!value) throw new BookRepositoryError('not_found'); return parse(bookProgressSchema, value); },
  };
}

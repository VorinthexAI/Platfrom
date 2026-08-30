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
import { documentSchema, type Document } from '@/lib/db/documents.node';
import { generatedDocumentBindingSchema, type GeneratedDocumentBinding } from '@/lib/db/generated-document-bindings.node';
import { replayableShareSchema, shareSchema, type ReplayableShare, type Share } from '@/lib/db/shares.node';
import { bookExtensionSchema, type BookExtension } from '@/lib/db/book-extensions.node';

export interface BookAccessContext { organizationKey: string; scopeKey: string; userKey: string; generationLeaseToken?: string; signal?: AbortSignal }
export interface BookDetailRow { book: Book; chapters: Array<{ chapter: BookChapter; progress: BookProgress | null }> }
export interface BookGenerationIdentity { bookKey: string; organizationKey: string; scopeKey: string; userKey: string }
export interface BookArchiveExport { chapterKey: string; document: Document; binding: GeneratedDocumentBinding }
export interface PublicBookShareRow { share: Share; book: Book; chapters: BookChapter[] }
export interface BookDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }> }
type BookTransactionRunner = <T>(collections: { read?: string[]; write: string[] }, fn: (transaction: BookDatabase) => Promise<T>) => Promise<T>;

export class BookRepositoryError extends Error {
  constructor(readonly reason: 'forbidden' | 'not_found' | 'conflict' | 'favorite', message: string = reason) { super(message); }
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
  failGeneration(job: BookGenerationIdentity, message: string, now: string): Promise<boolean>;
  claimGeneration(context: BookAccessContext, bookKey: string, leaseToken: string, now: string, leaseExpiresAt: string): Promise<boolean>;
  renewGeneration(context: BookAccessContext, bookKey: string, leaseToken: string, leaseExpiresAt: string): Promise<boolean>;
  releaseGeneration(context: BookAccessContext, bookKey: string, leaseToken: string): Promise<boolean>;
  sourceDocuments(context: BookAccessContext, keys: string[]): Promise<Array<{ key: string; name: string; content: string; updatedAt: string }>>;
  sources(context: BookAccessContext, bookKey: string): Promise<BookSource[]>;
  create(context: BookAccessContext, book: Book, bookContext: BookContext, sources: BookSource[] | undefined, share: ReplayableShare): Promise<Book>;
  replaceChapters(context: BookAccessContext, bookKey: string, chapters: BookChapter[], contexts: ChapterContext[], patch: Partial<Book>): Promise<void>;
  appendChapter(context: BookAccessContext, bookKey: string, chapter: BookChapter, chapterContext: ChapterContext): Promise<void>;
  acceptExtension(context: BookAccessContext, extension: BookExtension, now: string): Promise<{ extension: BookExtension; book: Book; replayed: boolean }>;
  pendingExtension(context: BookAccessContext, bookKey: string): Promise<BookExtension | null>;
  updateExtension(context: BookAccessContext, extensionKey: string, status: BookExtension['status'], now: string): Promise<BookExtension>;
  updateBook(context: BookAccessContext, bookKey: string, patch: Partial<Book>): Promise<Book>;
  updateChapter(context: BookAccessContext, chapterKey: string, patch: Partial<BookChapter>): Promise<BookChapter>;
  isCancellationRequested(context: BookAccessContext, bookKey: string): Promise<boolean>;
  retryGeneration(context: BookAccessContext, bookKey: string, now: string): Promise<Book>;
  cancelGeneration(context: BookAccessContext, bookKey: string, now: string): Promise<Book>;
  setFavorite(context: BookAccessContext, bookKey: string, isFavorite: boolean, now: string): Promise<Book>;
  shareDetail(context: BookAccessContext, bookKey: string): Promise<ReplayableShare>;
  setShareActive(context: BookAccessContext, bookKey: string, active: boolean, now: string): Promise<ReplayableShare>;
  publicShare(tokenHash: string, now: string): Promise<PublicBookShareRow | null>;
  deleteBook(context: BookAccessContext, bookKey: string, now: string): Promise<{ deleted: true; bookKey: string; shareTokenHash: string | null }>;
  publishArchive(context: BookAccessContext, bookKey: string, exports: BookArchiveExport[], now: string): Promise<void>;
  publishChapters(context: BookAccessContext, bookKey: string, chapterCount: number, now: string): Promise<void>;
  ensureGalleryExportCollection(context: BookAccessContext, bookKey: string, bookTitle: string, embedding: number[], now: string): Promise<{ collectionKey: string; ownerKey: string }>;
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
    async failGeneration(job, message, now) { const rows = await (await database.query('LET scope = DOCUMENT(scopes, @scopeKey) FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && scope != null && scope.organizationKey == @organizationKey FILTER book.generationOwnerKey == @userKey && book.status NOT IN ["ready", "cancelled", "failed"] FILTER book.generationLeaseToken == null || book.generationLeaseExpiresAt == null || book.generationLeaseExpiresAt <= @now UPDATE book WITH { status: "failed", generationError: @message, updatedAt: @now } IN books RETURN 1', { bookKey: job.bookKey, organizationKey: job.organizationKey, scopeKey: job.scopeKey, userKey: job.userKey, message: message.slice(0, 4_000), now })).all(); return rows.length === 1; },
    async claimGeneration(context, bookKey, leaseToken, now, leaseExpiresAt) { await authorize(database, context, true); const rows = await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.status NOT IN ["ready", "cancelled"] && book.cancelRequestedAt == null FILTER book.generationLeaseToken == null || book.generationLeaseExpiresAt == null || book.generationLeaseExpiresAt <= @now UPDATE book WITH { generationLeaseToken: @leaseToken, generationLeaseExpiresAt: @leaseExpiresAt } IN books RETURN 1', { bookKey, scopeKey: context.scopeKey, leaseToken, now, leaseExpiresAt })).all(); return rows.length === 1; },
    async renewGeneration(context, bookKey, leaseToken, leaseExpiresAt) { await authorize(database, context, true); const rows = await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.generationLeaseToken == @leaseToken && book.cancelRequestedAt == null && book.status != "cancelled" UPDATE book WITH { generationLeaseExpiresAt: @leaseExpiresAt } IN books RETURN 1', { bookKey, scopeKey: context.scopeKey, leaseToken, leaseExpiresAt })).all(); return rows.length === 1; },
    async releaseGeneration(context, bookKey, leaseToken) { await authorize(database, context, true); const rows = await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.generationLeaseToken == @leaseToken UPDATE book WITH { generationLeaseToken: null, generationLeaseExpiresAt: null } IN books OPTIONS { keepNull: false } RETURN 1', { bookKey, scopeKey: context.scopeKey, leaseToken })).all(); return rows.length === 1; },
    async sourceDocuments(context, keys) { await authorize(database, context, false); const rows = await (await database.query('FOR document IN documents FILTER document.scopeKey == @scopeKey && document._key IN @keys && document.mutationPolicy != "system-only" && (!HAS(document, "_internalDeletion") || document._internalDeletion == null) RETURN document', { scopeKey: context.scopeKey, keys })).all(); if (rows.length !== new Set(keys).size) throw new BookRepositoryError('forbidden', 'One or more selected source documents are unavailable.'); return rows.map((value) => { const source = value as Record<string, unknown>; return { key: String(source._key), name: String(source.name), content: String(source.content), updatedAt: String(source.updatedAt) }; }); },
    async sources(context, bookKey) { await authorize(database, context, false); return (await (await database.query('FOR source IN bookSources FILTER source.scopeKey == @scopeKey && source.bookKey == @bookKey SORT source.createdAt ASC, source._key ASC RETURN source', { scopeKey: context.scopeKey, bookKey })).all()).map((value) => parse(bookSourceSchema, value)); },
    async create(context, book, bookContext, sources = [], share) {
      try {
        return await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['books', 'bookContexts', 'bookSources', 'shares'] }, async (transaction) => {
          await authorize(transaction, context, true);
          const validShare = replayableShareSchema.parse(share);
          if (validShare.sourceType !== 'book' || validShare.sourceKey !== book.key || validShare.scopeKey !== book.scopeKey || validShare.permission !== 'read' || !validShare.revokedAt || !validShare.responseCiphertext) throw new BookRepositoryError('conflict', 'A new audio book requires exactly one inactive replayable share.');
          const inserted = await transaction.query('INSERT @book INTO books RETURN NEW', { book: toArangoDoc(book) });
          await transaction.query('INSERT @context INTO bookContexts', { context: toArangoDoc(bookContextSchema.parse(bookContext)) });
          for (const source of sources) await transaction.query('INSERT @source INTO bookSources', { source: toArangoDoc(bookSourceSchema.parse(source)) });
          const existingShares = await (await transaction.query('FOR item IN shares FILTER item.sourceType == "book" && item.sourceKey == @bookKey LIMIT 1 RETURN 1', { bookKey: book.key })).all();
          if (existingShares.length) throw new BookRepositoryError('conflict', 'An audio book share already exists.');
          await transaction.query('INSERT @share INTO shares', { share: toArangoDoc(validShare) });
          return parse(bookSchema, (await inserted.all())[0]);
        });
      } catch (error) { if (isArangoUniqueConstraintError(error)) throw new BookRepositoryError('conflict'); throw error; }
    },
    replaceChapters(context, bookKey, chapters, contexts, patch) {
      return transact({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['books', 'bookChapters', 'chapterContexts'] }, async (transaction) => {
        await authorize(transaction, context, true);
        if (chapters.length !== contexts.length || chapters.some((chapter, index) => contexts[index]?.chapterKey !== chapter.key)) throw new BookRepositoryError('conflict', 'Chapter contexts must match the outline.');
        const updated = await (await transaction.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && LENGTH(FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey LIMIT 1 RETURN 1) == 0 && (!@fenced || (book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled")) UPDATE book WITH @patch IN books OPTIONS { keepNull: false } RETURN 1', { bookKey, scopeKey: context.scopeKey, fenced: context.generationLeaseToken !== undefined, generationLeaseToken: context.generationLeaseToken ?? null, patch: unsetPatch(patch) })).all();
        if (!updated.length) throw new BookRepositoryError(context.generationLeaseToken ? 'conflict' : 'not_found', context.generationLeaseToken ? 'Audio book generation lease was lost.' : undefined);
        for (const chapter of chapters) await transaction.query('INSERT @chapter INTO bookChapters', { chapter: toArangoDoc(bookChapterSchema.parse(chapter)) });
        for (const chapterContext of contexts) await transaction.query('INSERT @context INTO chapterContexts', { context: toArangoDoc(chapterContextSchema.parse(chapterContext)) });
      });
    },
    appendChapter(context, bookKey, chapter, chapterContext) {
      return transact({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['books', 'bookChapters', 'chapterContexts'] }, async (transaction) => {
        await authorize(transaction, context, true);
        if (chapter.bookKey !== bookKey || chapter.scopeKey !== context.scopeKey || chapterContext.chapterKey !== chapter.key || chapterContext.scopeKey !== context.scopeKey) throw new BookRepositoryError('conflict', 'Extension chapter context does not match the chapter.');
        const inserted = await (await transaction.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled" FILTER LENGTH(FOR existing IN bookChapters FILTER existing.scopeKey == @scopeKey && existing.bookKey == @bookKey && (existing._key == @chapterKey || existing.position == @position) LIMIT 1 RETURN 1) == 0 INSERT @chapter INTO bookChapters INSERT @chapterContext INTO chapterContexts RETURN 1', { bookKey, scopeKey: context.scopeKey, generationLeaseToken: context.generationLeaseToken, chapterKey: chapter.key, position: chapter.position, chapter: toArangoDoc(bookChapterSchema.parse(chapter)), chapterContext: toArangoDoc(chapterContextSchema.parse(chapterContext)) })).all();
        if (inserted[0] !== 1) throw new BookRepositoryError('conflict', 'Extension chapter position changed or the generation lease was lost.');
      });
    },
    async acceptExtension(context, extension, now) {
      try {
        return await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers', 'bookChapters'], write: ['books', 'bookExtensions'] }, async (transaction) => {
          await authorize(transaction, context, true);
          const valid = bookExtensionSchema.parse(extension);
          const replay = (await (await transaction.query('FOR item IN bookExtensions FILTER item.scopeKey == @scopeKey && item.bookKey == @bookKey && item.requestKey == @requestKey LIMIT 1 RETURN item', valid)).all())[0];
          if (replay) {
            const receipt = parse(bookExtensionSchema, replay);
            if (receipt.requestFingerprint !== valid.requestFingerprint) throw new BookRepositoryError('conflict', 'Extension request key was reused with different titles.');
            const bookValue = (await (await transaction.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey RETURN book', valid)).all())[0];
            if (!bookValue) throw new BookRepositoryError('not_found');
            return { extension: receipt, book: parse(bookSchema, bookValue), replayed: true };
          }
          const rows = await (await transaction.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey && book.status == "ready" && book.chapterCount == @baseChapterCount && book.generationLeaseToken == null LET chapters = (FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey SORT chapter.position ASC RETURN chapter) FILTER LENGTH(chapters) == @baseChapterCount && LENGTH(FOR chapter IN chapters FILTER chapter.position < 1 || chapter.position > @baseChapterCount || chapter.status != "audio-ready" || chapter.content == null || chapter.audioStorageKey == null RETURN 1) == 0 LET normalizedExisting = (FOR chapter IN chapters RETURN LOWER(TRIM(chapter.title))) LET normalizedNew = (FOR title IN @titles RETURN LOWER(TRIM(title))) FILTER LENGTH(UNIQUE(APPEND(normalizedExisting, normalizedNew))) == LENGTH(normalizedExisting) + LENGTH(normalizedNew) INSERT @extension INTO bookExtensions UPDATE book WITH { activeExtensionKey: @extensionKey, status: "queued", generationStage: "outline", generationCompletedUnits: 0, generationTotalUnits: @generationTotalUnits, generationError: null, cancelRequestedAt: null, chapterCount: @targetChapterCount, updatedAt: @now } IN books OPTIONS { keepNull: false } RETURN NEW', { ...valid, extension: toArangoDoc(valid), extensionKey: valid.key, generationTotalUnits: valid.titles.length * 3 + 1, now })).all();
          if (!rows[0]) throw new BookRepositoryError('conflict', 'Only a current, fully ready audio book can be extended with unique continuation titles.');
          return { extension: valid, book: parse(bookSchema, rows[0]), replayed: false };
        });
      } catch (error) { if (isArangoUniqueConstraintError(error)) throw new BookRepositoryError('conflict', 'Extension request is already being processed.'); throw error; }
    },
    async pendingExtension(context, bookKey) { await authorize(database, context, false); const value = (await (await database.query('FOR item IN bookExtensions FILTER item.scopeKey == @scopeKey && item.bookKey == @bookKey && item.status IN ["pending", "generating"] SORT item.createdAt ASC LIMIT 1 RETURN item', { scopeKey: context.scopeKey, bookKey })).all())[0]; return value ? parse(bookExtensionSchema, value) : null; },
    async updateExtension(context, extensionKey, status, now) { await authorize(database, context, true); const value = (await (await database.query('LET extension = DOCUMENT(bookExtensions, @extensionKey) LET book = extension == null ? null : DOCUMENT(books, extension.bookKey) FILTER extension != null && extension.scopeKey == @scopeKey && book != null && book.generationLeaseToken == @generationLeaseToken UPDATE extension WITH { status: @status, updatedAt: @now } IN bookExtensions RETURN NEW', { extensionKey, scopeKey: context.scopeKey, generationLeaseToken: context.generationLeaseToken, status, now })).all())[0]; if (!value) throw new BookRepositoryError('conflict', 'Extension generation lease was lost.'); return parse(bookExtensionSchema, value); },
    async updateBook(context, bookKey, patch) { await authorize(database, context, true); const value = (await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && (!@fenced || (book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled")) UPDATE book WITH @patch IN books OPTIONS { keepNull: false } RETURN NEW', { bookKey, scopeKey: context.scopeKey, fenced: context.generationLeaseToken !== undefined, generationLeaseToken: context.generationLeaseToken ?? null, patch: unsetPatch(patch) })).all())[0]; if (!value) throw new BookRepositoryError(context.generationLeaseToken ? 'conflict' : 'not_found', context.generationLeaseToken ? 'Audio book generation lease was lost.' : undefined); return parse(bookSchema, value); },
    async updateChapter(context, chapterKey, patch) { await authorize(database, context, true); const value = (await (await database.query('LET chapter = DOCUMENT(bookChapters, @chapterKey) LET book = chapter == null ? null : DOCUMENT(books, chapter.bookKey) FILTER chapter != null && chapter.scopeKey == @scopeKey && (!@fenced || (book != null && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled")) UPDATE chapter WITH @patch IN bookChapters OPTIONS { keepNull: false } RETURN NEW', { chapterKey, scopeKey: context.scopeKey, fenced: context.generationLeaseToken !== undefined, generationLeaseToken: context.generationLeaseToken ?? null, patch: unsetPatch(patch) })).all())[0]; if (!value) throw new BookRepositoryError(context.generationLeaseToken ? 'conflict' : 'not_found', context.generationLeaseToken ? 'Audio book generation lease was lost.' : undefined); return parse(bookChapterSchema, value); },
    async isCancellationRequested(context, bookKey) { await authorize(database, context, false); const values = await (await database.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey RETURN book.cancelRequestedAt != null || book.status == "cancelled"', { bookKey, scopeKey: context.scopeKey })).all(); if (!values.length) throw new BookRepositoryError('not_found'); return values[0] === true; },
    async retryGeneration(context, bookKey, now) { await authorize(database, context, true); const value = (await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.status IN ["failed", "cancelled"] && book.generationInput != null && book.generationOwnerKey != null FILTER book.generationLeaseToken == null || book.generationLeaseExpiresAt == null || book.generationLeaseExpiresAt <= @now UPDATE book WITH { status: "queued", generationError: null, cancelRequestedAt: null, generationLeaseToken: null, generationLeaseExpiresAt: null, generationAttempt: book.generationAttempt + 1, updatedAt: @now } IN books OPTIONS { keepNull: false } RETURN NEW', { bookKey, scopeKey: context.scopeKey, now })).all())[0]; if (!value) throw new BookRepositoryError('conflict', 'Audio book generation can be retried only when resumable input is available and any active worker lease has expired.'); return parse(bookSchema, value); },
    async cancelGeneration(context, bookKey, now) { await authorize(database, context, true); const value = (await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.status NOT IN ["ready", "cancelled"] UPDATE book WITH { status: "cancelled", cancelRequestedAt: @now, updatedAt: @now } IN books RETURN NEW', { bookKey, scopeKey: context.scopeKey, now })).all())[0]; if (!value) throw new BookRepositoryError('conflict', 'Completed or already cancelled audio books cannot be cancelled.'); return parse(bookSchema, value); },
    async setFavorite(context, bookKey, isFavorite, now) { await authorize(database, context, true); const value = (await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey UPDATE book WITH { isFavorite: @isFavorite, updatedAt: @now } IN books RETURN NEW', { bookKey, scopeKey: context.scopeKey, isFavorite, now })).all())[0]; if (!value) throw new BookRepositoryError('not_found'); return parse(bookSchema, value); },
    async shareDetail(context, bookKey) {
      await authorize(database, context, false);
      const value = (await (await database.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey && book.generationOwnerKey == @userKey FOR share IN shares FILTER share.sourceType == "book" && share.sourceKey == book._key && share.scopeKey == book.scopeKey LIMIT 1 RETURN share', { bookKey, scopeKey: context.scopeKey, userKey: context.userKey })).all())[0];
      if (!value) throw new BookRepositoryError('not_found');
      return parse(replayableShareSchema, value);
    },
    async setShareActive(context, bookKey, active, now) {
      await authorize(database, context, true);
      const row = (await (await database.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey && book.generationOwnerKey == @userKey LET share = FIRST(FOR item IN shares FILTER item.sourceType == "book" && item.sourceKey == book._key && item.scopeKey == book.scopeKey LIMIT 1 RETURN item) FILTER share != null LET updated = !@active || book.status == "ready" ? FIRST(FOR item IN shares FILTER item._key == share._key UPDATE item WITH { revokedAt: @revokedAt, updatedAt: @now } IN shares OPTIONS { keepNull: false } RETURN NEW) : null RETURN { status: book.status, share: updated }', { bookKey, scopeKey: context.scopeKey, userKey: context.userKey, active, revokedAt: active ? null : now, now })).all())[0] as { status: string; share: unknown | null } | undefined;
      if (!row) throw new BookRepositoryError('not_found');
      if (!row.share) throw new BookRepositoryError('conflict', 'Only ready audio books can be shared.');
      return parse(replayableShareSchema, row.share);
    },
    async publicShare(tokenHash, now) {
      const value = (await (await database.query('FOR share IN shares FILTER share.sourceType == "book" && share.tokenHash == @tokenHash && (share.expiresAt == null || share.expiresAt > @now) LET book = DOCUMENT(books, share.sourceKey) FILTER book != null && book.scopeKey == share.scopeKey LET chapters = (FOR chapter IN bookChapters FILTER chapter.scopeKey == share.scopeKey && chapter.bookKey == book._key SORT chapter.position ASC RETURN chapter) LIMIT 1 RETURN { share, book, chapters }', { tokenHash, now })).all())[0] as { share: unknown; book: unknown; chapters: unknown[] } | undefined;
      return value ? { share: parse(shareSchema, value.share), book: parse(bookSchema, value.book), chapters: value.chapters.map((chapter) => parse(bookChapterSchema, chapter)) } : null;
    },
    async deleteBook(context, bookKey, now) {
      const shareTokenHash = await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['books', 'bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'chapterContexts', 'bookProgress', 'bookExtensions', 'generatedDocumentBindings', 'storageDeletionJobs', 'shares'] }, async (transaction) => {
        await authorize(transaction, context, true);
        const row = (await (await transaction.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey LET chapters = (FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey RETURN chapter) RETURN { book, chapters }', { bookKey, scopeKey: context.scopeKey })).all())[0] as { book: Record<string, unknown>; chapters: Array<Record<string, unknown>> } | undefined;
        if (!row) throw new BookRepositoryError('not_found');
        if (row.book.isFavorite === true) throw new BookRepositoryError('favorite', 'Unfavorite the audio book before deleting it.');
        const chapterKeys = row.chapters.map((chapter) => String(chapter._key));
        const storageKeys = [row.book.coverStorageKey, ...row.chapters.map((chapter) => chapter.audioStorageKey)].filter((key): key is string => typeof key === 'string');
        for (const storageKey of storageKeys) await transaction.query('UPSERT { storageKey: @storageKey } INSERT { storageKey: @storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs', { storageKey, now });
        await transaction.query('FOR binding IN generatedDocumentBindings FILTER binding.scopeKey == @scopeKey && binding.subjectType == "chapter" && binding.subjectKey IN @chapterKeys REMOVE binding IN generatedDocumentBindings', { scopeKey: context.scopeKey, chapterKeys });
        await transaction.query('FOR item IN chapterContexts FILTER item.scopeKey == @scopeKey && item.chapterKey IN @chapterKeys REMOVE item IN chapterContexts', { scopeKey: context.scopeKey, chapterKeys });
        for (const collection of ['bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'bookProgress']) await transaction.query(`FOR item IN ${collection} FILTER item.scopeKey == @scopeKey && item.bookKey == @bookKey REMOVE item IN ${collection}`, { scopeKey: context.scopeKey, bookKey });
        await transaction.query('FOR item IN bookExtensions FILTER item.scopeKey == @scopeKey && item.bookKey == @bookKey REMOVE item IN bookExtensions', { scopeKey: context.scopeKey, bookKey });
        const hashes = await (await transaction.query('FOR share IN shares FILTER share.scopeKey == @scopeKey && share.sourceType == "book" && share.sourceKey == @bookKey REMOVE share IN shares RETURN OLD.tokenHash', { scopeKey: context.scopeKey, bookKey })).all();
        const shareTokenHash = hashes[0];
        if (hashes.length > 1 || shareTokenHash !== undefined && typeof shareTokenHash !== 'string') throw new BookRepositoryError('conflict', 'Audio book share invariant was violated.');
        await transaction.query('REMOVE @bookKey IN books', { bookKey });
        return shareTokenHash ?? null;
      });
      return { deleted: true, bookKey, shareTokenHash };
    },
    async publishArchive(context, bookKey, exports, now) {
      const folderKey = stableKey('archive-book-export', context.scopeKey, bookKey);
      const valid = exports.map((item) => ({ chapterKey: z.string().cuid().parse(item.chapterKey), document: documentSchema.parse(item.document), binding: generatedDocumentBindingSchema.parse(item.binding) }));
      if (valid.some(({ chapterKey, document, binding }) => document.scopeKey !== context.scopeKey || document.folderKey !== folderKey || binding.scopeKey !== context.scopeKey || binding.documentKey !== document.key || binding.subjectType !== 'chapter' || binding.subjectKey !== chapterKey || binding.kind !== 'chapter' || binding.createdByKey !== context.userKey)) throw new BookRepositoryError('forbidden');
      await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers', 'books', 'bookChapters'], write: ['books', 'bookChapters', 'folders', 'documents', 'generatedDocumentBindings'] }, async (transaction) => {
        await authorize(transaction, context, true);
        const rows = await (await transaction.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey && (!@fenced || (book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled")) LET chapterKeys = (FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey SORT chapter.position ASC RETURN chapter._key) FILTER chapterKeys == @chapterKeys RETURN book', { bookKey, scopeKey: context.scopeKey, fenced: context.generationLeaseToken !== undefined, generationLeaseToken: context.generationLeaseToken ?? null, chapterKeys: valid.map(({ chapterKey }) => chapterKey) })).all() as Record<string, unknown>[];
        const book = rows[0];
        if (!book) throw new BookRepositoryError('conflict', 'Archive publication prerequisites changed or the generation lease was lost.');
        const rootKey = stableKey('archive-ascend-root', context.scopeKey);
        await transaction.query('UPSERT { _key: @rootKey } INSERT { _key: @rootKey, scopeKey: @scopeKey, name: "Ascend", description: "Generated books", mutationPolicy: "user", embedding: @embedding, isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE { name: "Ascend", description: "Generated books", embedding: @embedding, updatedAt: @now } IN folders', { rootKey, scopeKey: context.scopeKey, embedding: book.embedding, now });
        await transaction.query('UPSERT { _key: @folderKey } INSERT { _key: @folderKey, scopeKey: @scopeKey, parentFolderKey: @rootKey, name: @name, description: @description, mutationPolicy: "user", embedding: @embedding, isFavorite: false, createdAt: @createdAt, updatedAt: @now } UPDATE { parentFolderKey: @rootKey, name: @name, description: @description, embedding: @embedding, updatedAt: @now } IN folders', { folderKey, rootKey, scopeKey: context.scopeKey, name: book.title, description: book.description, embedding: book.embedding, createdAt: book.createdAt, now });
        for (const item of valid) {
          await transaction.query('UPSERT { _key: @documentKey } INSERT @document UPDATE { folderKey: @document.folderKey, name: @document.name, content: @document.content, embedding: @document.embedding, contentChunks: @document.contentChunks, chunkEmbeddings: @document.chunkEmbeddings, semanticChunkCount: @document.semanticChunkCount, semanticContentHash: @document.semanticContentHash, updatedAt: @document.updatedAt } IN documents', { documentKey: item.document.key, document: toArangoDoc(item.document) });
          await transaction.query('UPSERT { _key: @bindingKey } INSERT @binding UPDATE { requestHash: @binding.requestHash, updatedAt: @binding.updatedAt } IN generatedDocumentBindings', { bindingKey: item.binding.key, binding: toArangoDoc(item.binding) });
          const linked = await (await transaction.query('FOR chapter IN bookChapters FILTER chapter._key == @chapterKey && chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey UPDATE chapter WITH { archiveDocumentKey: @documentKey, updatedAt: @now } IN bookChapters RETURN true', { chapterKey: item.chapterKey, scopeKey: context.scopeKey, bookKey, documentKey: item.document.key, now })).all();
          if (linked[0] !== true) throw new BookRepositoryError('conflict', 'A chapter changed during Archive publication.');
        }
        const linkedBook = await (await transaction.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey UPDATE book WITH { archiveFolderKey: @folderKey, updatedAt: @now } IN books RETURN true', { bookKey, scopeKey: context.scopeKey, folderKey, now })).all();
        if (linkedBook[0] !== true) throw new BookRepositoryError('conflict', 'The audio book changed during Archive publication.');
      });
    },
    async publishChapters(context, bookKey, chapterCount, now) {
      await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['books', 'bookExtensions'] }, async (transaction) => {
        await authorize(transaction, context, true);
        const result = await (await transaction.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled" && book.coverStorageKey != null && book.archiveFolderKey != null LET chapters = (FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey SORT chapter.position ASC RETURN chapter) FILTER @chapterCount > 0 && LENGTH(chapters) == @chapterCount && LENGTH(FOR chapter IN chapters FILTER chapter.status != "audio-ready" || chapter.content == null || chapter.audioStorageKey == null || chapter.audioDurationSeconds == null || chapter.archiveDocumentKey == null RETURN 1) == 0 LET activeExtensionKey = book.activeExtensionKey UPDATE book WITH { status: "ready", generationStage: "complete", generationCompletedUnits: book.generationTotalUnits, estimatedMinutes: CEIL(SUM(chapters[*].audioDurationSeconds) / 60), activeExtensionKey: null, updatedAt: @now } IN books OPTIONS { keepNull: false } LET extensionCompleted = activeExtensionKey == null ? null : FIRST(FOR extension IN bookExtensions FILTER extension._key == activeExtensionKey && extension.scopeKey == @scopeKey && extension.bookKey == @bookKey UPDATE extension WITH { status: "complete", updatedAt: @now } IN bookExtensions RETURN true) FILTER activeExtensionKey == null || extensionCompleted == true RETURN LENGTH(chapters)', { bookKey, scopeKey: context.scopeKey, generationLeaseToken: context.generationLeaseToken, chapterCount, now })).all();
        if (result[0] !== chapterCount) throw new BookRepositoryError('conflict', 'Audio book publication prerequisites changed or the generation lease was lost.');
      });
    },
    async ensureGalleryExportCollection(context, bookKey, bookTitle, embedding, now) {
      return transact({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['collections', 'collectionMembers'] }, async (transaction) => {
        await authorize(transaction, context, true);
        const ownerKey = (await (await transaction.query('FOR membership IN userOrganizations FILTER membership.organizationId == @organizationKey && membership.userId == @userKey && membership.status == "active" LIMIT 1 RETURN membership._key', { organizationKey: context.organizationKey, userKey: context.userKey })).all())[0];
        if (typeof ownerKey !== 'string') throw new BookRepositoryError('forbidden');
        const collectionKey = stableKey('gallery-book-export', context.scopeKey, bookKey);
        await transaction.query('UPSERT { _key: @collectionKey } INSERT { _key: @collectionKey, scopeKey: @scopeKey, name: @bookTitle, description: "Artwork generated for this audio book", mutationPolicy: "user", embedding: @embedding, isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE { name: @bookTitle, description: "Artwork generated for this audio book", embedding: @embedding, updatedAt: @now } IN collections', { collectionKey, scopeKey: context.scopeKey, bookTitle, embedding, now });
        await transaction.query('UPSERT { _key: @memberKey } INSERT { _key: @memberKey, scopeKey: @scopeKey, collectionKey: @collectionKey, memberKey: @ownerKey, role: "owner", createdAt: @now, updatedAt: @now } UPDATE { role: "owner", updatedAt: @now } IN collectionMembers', { memberKey: stableKey('gallery-book-export-member', collectionKey, ownerKey), scopeKey: context.scopeKey, collectionKey, ownerKey, now });
        return { collectionKey, ownerKey };
      });
    },
    async linkGalleryExportImages(context, collectionKey, ownerKey, imageKeys, now) {
      if (!imageKeys.length) return;
      await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers', 'collections', 'images'], write: ['collectionImages'] }, async (transaction) => {
        await authorize(transaction, context, true);
        await transaction.query('FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey && relation.imageKey NOT IN @imageKeys REMOVE relation IN collectionImages', { scopeKey: context.scopeKey, collectionKey, imageKeys });
        const linked = await (await transaction.query('LET collection = DOCUMENT(collections, @collectionKey) FILTER collection != null && collection.scopeKey == @scopeKey && collection.mutationPolicy == "user" && collection.purpose == null FOR imageKey IN UNIQUE(@imageKeys) LET image = DOCUMENT(images, imageKey) FILTER image != null && image.scopeKey == @scopeKey && image.createdByKey == @ownerKey LET relationKey = CONCAT("c", SUBSTRING(SHA256(CONCAT("book-gallery-export\\u0000", @collectionKey, "\\u0000", imageKey)), 0, 24)) UPSERT { _key: relationKey } INSERT { _key: relationKey, scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey, addedByKey: @ownerKey, createdAt: @now } UPDATE {} IN collectionImages RETURN imageKey', { collectionKey, scopeKey: context.scopeKey, ownerKey, imageKeys, now })).all();
        if (linked.length !== new Set(imageKeys).size) throw new BookRepositoryError('conflict', 'Gallery images could not all be linked to the audio book collection.');
      });
    },
    async addSources(context, bookKey, sources) {
      await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers'], write: ['books', 'bookSources'] }, async (transaction) => {
        await authorize(transaction, context, true);
        const owned = await (await transaction.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled" RETURN 1', { bookKey, scopeKey: context.scopeKey, generationLeaseToken: context.generationLeaseToken })).all();
        if (!owned.length) throw new BookRepositoryError('conflict', 'Audio book generation lease was lost.');
        for (const source of sources) await transaction.query('UPSERT { _key: @key } INSERT @source UPDATE @source IN bookSources', { key: source.key, source: toArangoDoc(bookSourceSchema.parse(source)) });
      });
    },
    async advanceGeneration(context, bookKey, now) { await authorize(database, context, true); const rows = await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled" UPDATE book WITH { generationCompletedUnits: MIN([book.generationTotalUnits, book.generationCompletedUnits + 1]), updatedAt: @now } IN books RETURN 1', { bookKey, scopeKey: context.scopeKey, generationLeaseToken: context.generationLeaseToken, now })).all(); if (!rows.length) throw new BookRepositoryError('conflict', 'Audio book generation lease was lost.'); },
    async reconcileGeneration(context, bookKey, completedUnits, now) { await authorize(database, context, true); const rows = await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled" UPDATE book WITH { generationCompletedUnits: MAX([book.generationCompletedUnits, MIN([book.generationTotalUnits, @completedUnits])]), updatedAt: @now } IN books RETURN 1', { bookKey, scopeKey: context.scopeKey, generationLeaseToken: context.generationLeaseToken, completedUnits, now })).all(); if (!rows.length) throw new BookRepositoryError('conflict', 'Audio book generation lease was lost.'); },
    async enqueueUnreferencedStorage(context, storageKeys, now) { if (!storageKeys.length) return; await authorize(database, context, true); await database.query('FOR storageKey IN UNIQUE(@storageKeys) LET referenced = LENGTH(FOR book IN books FILTER book.scopeKey == @scopeKey && book.coverStorageKey == storageKey LIMIT 1 RETURN 1) + LENGTH(FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.audioStorageKey == storageKey LIMIT 1 RETURN 1) FILTER referenced == 0 UPSERT { storageKey } INSERT { storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs', { scopeKey: context.scopeKey, storageKeys, now }); },
    async upsertProgress(context, bookKey, chapterKey, progress) { await authorize(database, context, false); const value = (await (await database.query('LET book = DOCUMENT(books, @bookKey) LET chapter = DOCUMENT(bookChapters, @chapterKey) FILTER book != null && book.scopeKey == @scopeKey && chapter != null && chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey UPSERT { scopeKey: @scopeKey, userKey: @userKey, bookKey: @bookKey, chapterKey: @chapterKey } INSERT @progress UPDATE { progressSeconds: MAX([OLD.progressSeconds, @progress.progressSeconds]), isCompleted: OLD.isCompleted || @progress.isCompleted, completedAt: OLD.isCompleted ? OLD.completedAt : @progress.isCompleted ? @progress.completedAt : OLD.completedAt, updatedAt: @progress.updatedAt } IN bookProgress RETURN NEW', { scopeKey: context.scopeKey, userKey: context.userKey, bookKey, chapterKey, progress: toArangoDoc(bookProgressSchema.parse(progress)) })).all())[0]; if (!value) throw new BookRepositoryError('not_found'); return parse(bookProgressSchema, value); },
  };
}

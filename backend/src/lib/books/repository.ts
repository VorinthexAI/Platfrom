import { db, withTransaction } from '@/lib/db/client';
import { z } from 'zod';
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

const accessQuery = (write: boolean) => `
  LET membership = FIRST(FOR candidate IN userOrganizations
    FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
  LET scope = DOCUMENT(scopes, @scopeKey)
  LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers
    FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role)
  FILTER membership != null && scope != null && scope.organizationKey == @organizationKey
  FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"${write ? '' : ', "member", "viewer"'}]
  RETURN membership._key`;

const parse = <T>(schema: { parse(value: unknown): T }, value: unknown) => schema.parse(withArangoKey(value as Record<string, unknown>));
const unsetPatch = (patch: Record<string, unknown>) => Object.fromEntries(Object.entries(patch).map(([field, value]) => [field, value === undefined ? null : value]));
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
  addSources(context: BookAccessContext, bookKey: string, sources: BookSource[]): Promise<void>;
  advanceGeneration(context: BookAccessContext, bookKey: string, now: string): Promise<void>;
  reconcileGeneration(context: BookAccessContext, bookKey: string, completedUnits: number, now: string): Promise<void>;
  enqueueUnreferencedStorage(context: BookAccessContext, storageKeys: string[], now: string): Promise<void>;
  upsertProgress(context: BookAccessContext, bookKey: string, chapterKey: string, progress: BookProgress): Promise<BookProgress>;
}

export function createBookRepository(database: BookDatabase = db, transact: BookTransactionRunner = withTransaction as BookTransactionRunner): BookRepository {
  const readDetail = async (context: BookAccessContext, bookKey?: string) => {
    await authorize(database, context, false);
    const cursor = await database.query(`FOR book IN books
      FILTER book.scopeKey == @scopeKey ${bookKey ? '&& book._key == @bookKey' : ''}
      LET chapters = (FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == book._key
        LET candidateArchiveDocument = chapter.archiveDocumentKey == null ? null : DOCUMENT(documents, chapter.archiveDocumentKey)
        LET archiveDocument = candidateArchiveDocument != null && candidateArchiveDocument.scopeKey == chapter.scopeKey && candidateArchiveDocument.managedPurpose == "audio-chapter" ? candidateArchiveDocument : null
        LET progress = FIRST(FOR item IN bookProgress FILTER item.scopeKey == @scopeKey && item.userKey == @userKey && item.bookKey == book._key && item.chapterKey == chapter._key LIMIT 1 RETURN item)
        LET projectedChapter = archiveDocument == null ? chapter : MERGE(chapter, { content: archiveDocument.content })
        SORT chapter.position ASC RETURN { chapter: projectedChapter, progress })
      SORT book.updatedAt DESC RETURN { book, chapters }`, { organizationKey: context.organizationKey, scopeKey: context.scopeKey, userKey: context.userKey, bookKey });
    return (await cursor.all() as Array<{ book: unknown; chapters: Array<{ chapter: unknown; progress: unknown | null }> }>).map((row) => ({
      book: parse(bookSchema, row.book), chapters: row.chapters.map((item) => ({ chapter: parse(bookChapterSchema, item.chapter), progress: item.progress ? parse(bookProgressSchema, item.progress) : null })),
    }));
  };
  return {
    authorize: (context, write = false) => authorize(database, context, write),
    list: (context) => readDetail(context),
    async detail(context, bookKey) { const row = (await readDetail(context, bookKey))[0]; if (!row) throw new BookRepositoryError('not_found'); return row; },
    async findByGenerationRequest(context, generationRequestKey) { await authorize(database, context, false); const cursor = await database.query('FOR book IN books FILTER book.scopeKey == @scopeKey && book.generationRequestKey == @generationRequestKey LIMIT 1 RETURN book._key', { scopeKey: context.scopeKey, generationRequestKey }); const key = (await cursor.all())[0]; return typeof key === 'string' ? (await readDetail(context, key))[0] ?? null : null; },
    async listRecoverableGenerations(now) {
      const rows = await (await database.query(`FOR book IN books
        FILTER book.status IN ["queued", "planning", "researching", "writing", "finalizing", "narrating"]
        FILTER book.generationInput != null && book.generationOwnerKey != null
        FILTER book.generationLeaseToken == null || book.generationLeaseExpiresAt == null || book.generationLeaseExpiresAt <= @now
        LET scope = DOCUMENT(scopes, book.scopeKey)
        FILTER scope != null
        RETURN { bookKey: book._key, organizationKey: scope.organizationKey, scopeKey: book.scopeKey, userKey: book.generationOwnerKey }`, { now })).all();
      return rows.map((row) => z.object({ bookKey: z.string().cuid(), organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(), userKey: z.string().cuid() }).parse(row));
    },
    async failTerminalGeneration(job, message, now) {
      const cursor = await database.query(`LET scope = DOCUMENT(scopes, @scopeKey)
        FOR book IN books
          FILTER book._key == @bookKey && book.scopeKey == @scopeKey && scope != null && scope.organizationKey == @organizationKey
          FILTER book.generationOwnerKey == @userKey && book.status NOT IN ["ready", "cancelled", "failed"]
          FILTER book.generationLeaseToken == null || book.generationLeaseExpiresAt == null || book.generationLeaseExpiresAt <= @now
          UPDATE book WITH { status: "failed", generationError: @message, updatedAt: @now } IN books RETURN 1`, { ...job, message: message.slice(0, 4_000), now });
      return (await cursor.all()).length === 1;
    },
    async claimGeneration(context, bookKey, leaseToken, now, leaseExpiresAt) {
      await authorize(database, context, true);
      const cursor = await database.query(`FOR book IN books
        FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.status NOT IN ["ready", "cancelled"] && book.cancelRequestedAt == null
        FILTER book.generationLeaseToken == null || book.generationLeaseExpiresAt == null || book.generationLeaseExpiresAt <= @now
        UPDATE book WITH { generationLeaseToken: @leaseToken, generationLeaseExpiresAt: @leaseExpiresAt } IN books RETURN 1`, { bookKey, scopeKey: context.scopeKey, leaseToken, now, leaseExpiresAt });
      return (await cursor.all()).length === 1;
    },
    async renewGeneration(context, bookKey, leaseToken, leaseExpiresAt) {
      await authorize(database, context, true);
      const cursor = await database.query(`FOR book IN books
        FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.generationLeaseToken == @leaseToken && book.cancelRequestedAt == null && book.status != "cancelled"
        UPDATE book WITH { generationLeaseExpiresAt: @leaseExpiresAt } IN books RETURN 1`, { bookKey, scopeKey: context.scopeKey, leaseToken, leaseExpiresAt });
      return (await cursor.all()).length === 1;
    },
    async releaseGeneration(context, bookKey, leaseToken) {
      await authorize(database, context, true);
      const cursor = await database.query(`FOR book IN books
        FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.generationLeaseToken == @leaseToken
        UPDATE book WITH { generationLeaseToken: null, generationLeaseExpiresAt: null } IN books OPTIONS { keepNull: false } RETURN 1`, { bookKey, scopeKey: context.scopeKey, leaseToken });
      return (await cursor.all()).length === 1;
    },
    async sourceDocuments(context, keys) { await authorize(database, context, false); const rows = await (await database.query('FOR document IN documents FILTER document.scopeKey == @scopeKey && document._key IN @keys && document.mutationPolicy != "system-only" && (!HAS(document, "_internalDeletion") || document._internalDeletion == null) RETURN document', { scopeKey: context.scopeKey, keys })).all(); if (rows.length !== new Set(keys).size) throw new BookRepositoryError('forbidden', 'One or more selected source documents are unavailable.'); return rows.map((value) => { const source = value as Record<string, unknown>; return { key: String(source._key), name: String(source.name), content: String(source.content), updatedAt: String(source.updatedAt) }; }); },
    async sources(context, bookKey) { await authorize(database, context, false); return (await (await database.query('FOR source IN bookSources FILTER source.scopeKey == @scopeKey && source.bookKey == @bookKey SORT source.createdAt ASC, source._key ASC RETURN source', { scopeKey: context.scopeKey, bookKey })).all()).map((value) => parse(bookSourceSchema, value)); },
    async create(context, book, bookContext, sources = []) {
      try {
        return await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers', 'scopeScopes'], write: ['books', 'bookContexts', 'bookSources'] }, async (transaction) => {
          await authorize(transaction, context, true);
          const inserted = await transaction.query('INSERT @book INTO books RETURN NEW', { book: toArangoDoc(book) });
          await transaction.query('INSERT @context INTO bookContexts', { context: toArangoDoc(bookContext) });
          for (const source of sources) await transaction.query('INSERT @source INTO bookSources', { source: toArangoDoc(bookSourceSchema.parse(source)) });
          return parse(bookSchema, (await inserted.all())[0]);
        });
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) throw new BookRepositoryError('conflict');
        throw error;
      }
    },
    replaceChapters(context, bookKey, chapters, contexts, patch) {
      return transact({ read: ['userOrganizations', 'scopes', 'scopeMembers', 'scopeScopes'], write: ['books', 'bookChapters', 'chapterContexts'] }, async (transaction) => {
        await authorize(transaction, context, true);
        if (chapters.length !== contexts.length || chapters.some((chapter, index) => contexts[index]?.chapterKey !== chapter.key)) throw new BookRepositoryError('conflict', 'Chapter contexts must match the outline.');
        const updated = await (await transaction.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && LENGTH(FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey LIMIT 1 RETURN 1) == 0 && (!@fenced || (book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled")) UPDATE book WITH @patch IN books OPTIONS { keepNull: false } RETURN 1', { bookKey, scopeKey: context.scopeKey, fenced: context.generationLeaseToken !== undefined, generationLeaseToken: context.generationLeaseToken ?? null, patch: unsetPatch(patch) })).all();
        if (!updated.length) throw new BookRepositoryError(context.generationLeaseToken !== undefined ? 'conflict' : 'not_found', context.generationLeaseToken !== undefined ? 'Book generation lease was lost.' : undefined);
        for (const chapter of chapters) await transaction.query('INSERT @chapter INTO bookChapters', { chapter: toArangoDoc(chapter) });
        for (const chapterContext of contexts) await transaction.query('INSERT @context INTO chapterContexts', { context: toArangoDoc(chapterContextSchema.parse(chapterContext)) });
      });
    },
    async updateBook(context, bookKey, patch) { await authorize(database, context, true); const cursor = await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && (!@fenced || (book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled")) UPDATE book WITH @patch IN books OPTIONS { keepNull: false } RETURN NEW', { bookKey, scopeKey: context.scopeKey, fenced: context.generationLeaseToken !== undefined, generationLeaseToken: context.generationLeaseToken ?? null, patch: unsetPatch(patch) }); const value = (await cursor.all())[0]; if (!value) throw new BookRepositoryError(context.generationLeaseToken !== undefined ? 'conflict' : 'not_found', context.generationLeaseToken !== undefined ? 'Book generation lease was lost.' : undefined); return parse(bookSchema, value); },
    async updateChapter(context, chapterKey, patch) { await authorize(database, context, true); const cursor = await database.query('LET chapter = DOCUMENT(bookChapters, @chapterKey) LET book = chapter == null ? null : DOCUMENT(books, chapter.bookKey) FILTER chapter != null && chapter.scopeKey == @scopeKey && (!@fenced || (book != null && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled")) UPDATE chapter WITH @patch IN bookChapters OPTIONS { keepNull: false } RETURN NEW', { chapterKey, scopeKey: context.scopeKey, fenced: context.generationLeaseToken !== undefined, generationLeaseToken: context.generationLeaseToken ?? null, patch: unsetPatch(patch) }); const value = (await cursor.all())[0]; if (!value) throw new BookRepositoryError(context.generationLeaseToken !== undefined ? 'conflict' : 'not_found', context.generationLeaseToken !== undefined ? 'Book generation lease was lost.' : undefined); return parse(bookChapterSchema, value); },
    async isCancellationRequested(context, bookKey) { await authorize(database, context, false); const values = await (await database.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey RETURN book.cancelRequestedAt != null || book.status == "cancelled"', { bookKey, scopeKey: context.scopeKey })).all(); if (!values.length) throw new BookRepositoryError('not_found'); return values[0] === true; },
    async retryGeneration(context, bookKey, now) { await authorize(database, context, true); const cursor = await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.status IN ["failed", "cancelled"] && book.generationInput != null && book.generationOwnerKey != null FILTER book.generationLeaseToken == null || book.generationLeaseExpiresAt == null || book.generationLeaseExpiresAt <= @now UPDATE book WITH { status: "queued", generationError: null, cancelRequestedAt: null, generationLeaseToken: null, generationLeaseExpiresAt: null, generationAttempt: book.generationAttempt + 1, updatedAt: @now } IN books OPTIONS { keepNull: false } RETURN NEW', { bookKey, scopeKey: context.scopeKey, now }); const value = (await cursor.all())[0]; if (!value) throw new BookRepositoryError('conflict', 'Generation can be retried only when resumable input is available and any active worker lease has expired.'); return parse(bookSchema, value); },
    async cancelGeneration(context, bookKey, now) { await authorize(database, context, true); const cursor = await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.status NOT IN ["ready", "cancelled"] UPDATE book WITH { status: "cancelled", cancelRequestedAt: @now, updatedAt: @now } IN books RETURN NEW', { bookKey, scopeKey: context.scopeKey, now }); const value = (await cursor.all())[0]; if (!value) throw new BookRepositoryError('conflict', 'Completed or already cancelled books cannot be cancelled.'); return parse(bookSchema, value); },
    async deleteBook(context, bookKey, now) {
      const hasLegacyDocumentShares = (await (await database.query('RETURN "documentShares" IN COLLECTIONS()[*].name')).all())[0] === true;
      await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers', 'scopeScopes'], write: ['books', 'bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'chapterContexts', 'bookProgress', 'folders', 'documents', 'generatedDocumentBindings', 'documentVersions', 'documentSummaries', 'documentSummaryAudio', 'documentAudioVersions', 'shares', 'tagAssignments', 'userHiddens', 'tripAttachments', 'trips', 'storageDeletionJobs', ...(hasLegacyDocumentShares ? ['documentShares'] : [])] }, async (transaction) => {
        await authorize(transaction, context, true);
        const rows = await (await transaction.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey LET chapters = (FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey RETURN chapter) RETURN { book, chapters }', { bookKey, scopeKey: context.scopeKey })).all() as Array<{ book: Record<string, unknown>; chapters: Array<Record<string, unknown>> }>;
        const row = rows[0]; if (!row) throw new BookRepositoryError('not_found');
        const documentKeys = row.chapters.map((chapter) => chapter.archiveDocumentKey).filter((key): key is string => typeof key === 'string');
        const chapterKeys = row.chapters.map((chapter) => String(chapter._key));
        const storageKeys = [row.book.coverStorageKey, ...row.chapters.flatMap((chapter) => [chapter.audioStorageKey, chapter.imageStorageKey])].filter((key): key is string => typeof key === 'string');
        const dependentStorageKeys = await (await transaction.query('LET documentStorage = (FOR item IN documents FILTER item.scopeKey == @scopeKey && item._key IN @documentKeys RETURN APPEND(APPEND(IS_STRING(item.storageKey) ? [item.storageKey] : [], IS_ARRAY(item.sourceStorageKeys) ? item.sourceStorageKeys : []), IS_ARRAY(item.speechStorageKeys) ? item.speechStorageKeys : [])) LET versions = (FOR item IN documentVersions FILTER item.scopeKey == @scopeKey && item.documentKey IN @documentKeys RETURN item.storageKey) LET summaryAudio = (FOR item IN documentSummaryAudio FILTER item.scopeKey == @scopeKey && item.documentKey IN @documentKeys RETURN item.storageKey) LET audioVersions = (FOR item IN documentAudioVersions FILTER item.scopeKey == @scopeKey && item.documentKey IN @documentKeys RETURN item.storageKey) RETURN UNIQUE(APPEND(APPEND(APPEND(FLATTEN(documentStorage), versions), summaryAudio), audioVersions))', { scopeKey: context.scopeKey, documentKeys })).all() as string[][];
        storageKeys.push(...(dependentStorageKeys[0] ?? []).filter((key): key is string => typeof key === 'string'));
        for (const storageKey of storageKeys) await transaction.query('UPSERT { storageKey: @storageKey } INSERT { _key: SHA256(@storageKey), storageKey: @storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs', { storageKey, now });
        await transaction.query('FOR item IN chapterContexts FILTER item.scopeKey == @scopeKey && item.chapterKey IN @chapterKeys REMOVE item IN chapterContexts', { scopeKey: context.scopeKey, chapterKeys });
        for (const collection of ['bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'bookProgress']) await transaction.query(`FOR item IN ${collection} FILTER item.scopeKey == @scopeKey && item.bookKey == @bookKey REMOVE item IN ${collection}`, { scopeKey: context.scopeKey, bookKey });
        for (const collection of ['documentVersions', 'documentSummaries', 'documentSummaryAudio', 'documentAudioVersions']) await transaction.query(`FOR item IN ${collection} FILTER item.scopeKey == @scopeKey && item.documentKey IN @documentKeys REMOVE item IN ${collection}`, { scopeKey: context.scopeKey, documentKeys });
        if (hasLegacyDocumentShares) await transaction.query('FOR share IN documentShares FILTER share.scopeKey == @scopeKey && share.documentKey IN @documentKeys REMOVE share IN documentShares', { scopeKey: context.scopeKey, documentKeys });
        await transaction.query('FOR share IN shares FILTER share.scopeKey == @scopeKey && share.sourceType == "document" && share.sourceKey IN @documentKeys REMOVE share IN shares', { scopeKey: context.scopeKey, documentKeys });
        await transaction.query('FOR assignment IN tagAssignments FILTER assignment.scopeKey == @scopeKey && assignment.sourceType == "document" && assignment.sourceKey IN @documentKeys REMOVE assignment IN tagAssignments', { scopeKey: context.scopeKey, documentKeys });
        await transaction.query('FOR hidden IN userHiddens FILTER (hidden.source == "document" && hidden.sourceKey IN @documentKeys) || (hidden.source == "folder" && hidden.sourceKey == @folderKey) REMOVE hidden IN userHiddens', { documentKeys, folderKey: typeof row.book.archiveFolderKey === 'string' ? row.book.archiveFolderKey : null });
        const affectedTripKeys = typeof row.book.archiveFolderKey === 'string' ? await (await transaction.query('FOR attachment IN tripAttachments FILTER attachment.scopeKey == @scopeKey && attachment.targetType == "folder" && attachment.targetKey == @folderKey REMOVE attachment IN tripAttachments RETURN DISTINCT OLD.tripKey', { scopeKey: context.scopeKey, folderKey: row.book.archiveFolderKey })).all() as string[] : [];
        if (affectedTripKeys.length) await transaction.query('FOR trip IN trips FILTER trip.scopeKey == @scopeKey && trip._key IN @tripKeys UPDATE trip WITH { updatedAt: @now } IN trips', { scopeKey: context.scopeKey, tripKeys: affectedTripKeys, now });
        await transaction.query('FOR binding IN generatedDocumentBindings FILTER binding.scopeKey == @scopeKey && binding.documentKey IN @documentKeys REMOVE binding IN generatedDocumentBindings', { scopeKey: context.scopeKey, documentKeys });
        await transaction.query('FOR document IN documents FILTER document.scopeKey == @scopeKey && document._key IN @documentKeys REMOVE document IN documents', { scopeKey: context.scopeKey, documentKeys });
        if (typeof row.book.archiveFolderKey === 'string') await transaction.query('FOR folder IN folders FILTER folder.scopeKey == @scopeKey && folder._key == @folderKey REMOVE folder IN folders', { scopeKey: context.scopeKey, folderKey: row.book.archiveFolderKey });
        await transaction.query('REMOVE @bookKey IN books', { bookKey });
      });
      return { deleted: true, bookKey };
    },
    async publishChapters(context, bookKey, chapterCount, now) {
      await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers', 'scopeScopes'], write: ['books', 'bookChapters', 'folders', 'documents', 'generatedDocumentBindings'] }, async (transaction) => {
        await authorize(transaction, context, true);
        const result = await (await transaction.query(`LET book = DOCUMENT(books, @bookKey)
          FILTER book != null && book.scopeKey == @scopeKey && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled" && book.coverStorageKey != null
          LET chapters = (FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey SORT chapter.position ASC RETURN chapter)
          FILTER LENGTH(chapters) == @chapterCount && LENGTH(FOR chapter IN chapters FILTER chapter.content == null || chapter.audioStorageKey == null || chapter.audioDurationSeconds == null RETURN 1) == 0
          LET rootKey = CONCAT("c", SUBSTRING(SHA256(CONCAT("generated-audio-root\\u0000", @scopeKey)), 0, 24))
          LET folderKey = CONCAT("c", SUBSTRING(SHA256(CONCAT("generated-audio-book\\u0000", @scopeKey, "\\u0000", @bookKey)), 0, 24))
          UPSERT { _key: rootKey } INSERT { _key: rootKey, scopeKey: @scopeKey, name: "Ascend", description: "Generated audiobooks", purpose: "generated-audio-root", mutationPolicy: "system-container", embedding: book.embedding, isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE { updatedAt: @now } IN folders
          UPSERT { _key: folderKey } INSERT { _key: folderKey, scopeKey: @scopeKey, parentFolderKey: rootKey, name: book.title, description: book.description, managedPurpose: "audio-book", managedOwnerKey: @bookKey, mutationPolicy: "system-container", embedding: book.embedding, isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE { name: book.title, description: book.description, updatedAt: @now } IN folders
          LET publications = (FOR chapter IN chapters
            LET documentKey = CONCAT("c", SUBSTRING(SHA256(CONCAT("generated-audio-chapter\\u0000", @bookKey, "\\u0000", TO_STRING(chapter.position))), 0, 24))
            LET requestHash = SHA256(chapter.content)
            UPSERT { _key: documentKey } INSERT { _key: documentKey, scopeKey: @scopeKey, folderKey, name: chapter.title, extension: "txt", mimeType: "text/plain", content: chapter.content, embedding: chapter.embedding, mutationPolicy: "user", managedPurpose: "audio-chapter", isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE { folderKey, name: chapter.title, content: chapter.content, embedding: chapter.embedding, mutationPolicy: "user", managedPurpose: "audio-chapter", updatedAt: @now } IN documents
            UPSERT { _key: documentKey } INSERT { _key: documentKey, scopeKey: @scopeKey, documentKey, subjectType: "chapter", subjectKey: chapter._key, kind: "chapter", provenance: "generated", createdByKey: book.generationOwnerKey, idempotencyKey: CONCAT("chapter-publication:", chapter._key), requestHash, createdAt: @now, updatedAt: @now } UPDATE { requestHash, updatedAt: @now } IN generatedDocumentBindings
            UPDATE chapter WITH { content: null, archiveDocumentKey: documentKey, updatedAt: @now } IN bookChapters OPTIONS { keepNull: false }
            RETURN 1)
          UPDATE book WITH { archiveFolderKey: folderKey, status: "ready", generationStage: "complete", generationCompletedUnits: book.generationTotalUnits, estimatedMinutes: CEIL(SUM(chapters[*].audioDurationSeconds) / 60), updatedAt: @now } IN books RETURN LENGTH(publications)`, { bookKey, scopeKey: context.scopeKey, generationLeaseToken: context.generationLeaseToken, chapterCount, now })).all();
        if (result[0] !== chapterCount) throw new BookRepositoryError('conflict', 'Book publication prerequisites changed or the generation lease was lost.');
      });
    },
    async addSources(context, bookKey, sources) {
      await transact({ read: ['userOrganizations', 'scopes', 'scopeMembers', 'scopeScopes'], write: ['books', 'bookSources'] }, async (transaction) => {
        await authorize(transaction, context, true);
        const owned = await (await transaction.query('LET book = DOCUMENT(books, @bookKey) FILTER book != null && book.scopeKey == @scopeKey && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled" RETURN 1', { bookKey, scopeKey: context.scopeKey, generationLeaseToken: context.generationLeaseToken })).all();
        if (!owned.length) throw new BookRepositoryError('conflict', 'Book generation lease was lost.');
        for (const source of sources) await transaction.query('UPSERT { _key: @key } INSERT @source UPDATE @source IN bookSources', { key: source.key, source: toArangoDoc(bookSourceSchema.parse(source)) });
      });
    },
    async advanceGeneration(context, bookKey, now) { await authorize(database, context, true); const updated = await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled" UPDATE book WITH { generationCompletedUnits: MIN([book.generationTotalUnits, book.generationCompletedUnits + 1]), updatedAt: @now } IN books RETURN 1', { bookKey, scopeKey: context.scopeKey, generationLeaseToken: context.generationLeaseToken, now })).all(); if (!updated.length) throw new BookRepositoryError('conflict', 'Book generation lease was lost.'); },
    async reconcileGeneration(context, bookKey, completedUnits, now) { await authorize(database, context, true); const updated = await (await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.generationLeaseToken == @generationLeaseToken && book.cancelRequestedAt == null && book.status != "cancelled" UPDATE book WITH { generationCompletedUnits: MAX([book.generationCompletedUnits, MIN([book.generationTotalUnits, @completedUnits])]), updatedAt: @now } IN books RETURN 1', { bookKey, scopeKey: context.scopeKey, generationLeaseToken: context.generationLeaseToken, completedUnits, now })).all(); if (!updated.length) throw new BookRepositoryError('conflict', 'Book generation lease was lost.'); },
    async enqueueUnreferencedStorage(context, storageKeys, now) { if (!storageKeys.length) return; await authorize(database, context, true); await database.query('FOR storageKey IN UNIQUE(@storageKeys) LET referenced = LENGTH(FOR book IN books FILTER book.scopeKey == @scopeKey && book.coverStorageKey == storageKey LIMIT 1 RETURN 1) + LENGTH(FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && (chapter.audioStorageKey == storageKey || chapter.imageStorageKey == storageKey) LIMIT 1 RETURN 1) FILTER referenced == 0 UPSERT { storageKey } INSERT { storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs', { scopeKey: context.scopeKey, storageKeys, now }); },
    async upsertProgress(context, bookKey, chapterKey, progress) { await authorize(database, context, false); const cursor = await database.query(`LET book = DOCUMENT(books, @bookKey) LET chapter = DOCUMENT(bookChapters, @chapterKey) FILTER book != null && book.scopeKey == @scopeKey && chapter != null && chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey UPSERT { scopeKey: @scopeKey, userKey: @userKey, bookKey: @bookKey, chapterKey: @chapterKey } INSERT @progress UPDATE { progressSeconds: MAX([OLD.progressSeconds, @progress.progressSeconds]), isCompleted: OLD.isCompleted || @progress.isCompleted, completedAt: OLD.isCompleted ? OLD.completedAt : @progress.isCompleted ? @progress.completedAt : OLD.completedAt, updatedAt: @progress.updatedAt } IN bookProgress RETURN NEW`, { ...context, bookKey, chapterKey, progress: toArangoDoc(progress) }); const value = (await cursor.all())[0]; if (!value) throw new BookRepositoryError('not_found'); return parse(bookProgressSchema, value); },
  };
}

import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { bookSchema, type Book } from '@/lib/db/books.node';
import { bookContextSchema, type BookContext } from '@/lib/db/book-contexts.node';
import { bookChapterSchema, type BookChapter } from '@/lib/db/book-chapters.node';
import { bookProgressSchema, type BookProgress } from '@/lib/db/book-progress.node';

export interface BookAccessContext { organizationKey: string; scopeKey: string; userKey: string }
export interface BookDetailRow { book: Book; chapters: Array<{ chapter: BookChapter; progress: BookProgress | null }> }
export interface BookDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }> }

export class BookRepositoryError extends Error {
  constructor(readonly reason: 'forbidden' | 'not_found') { super(reason); }
}

const accessQuery = (write: boolean) => `
  LET membership = FIRST(FOR candidate IN userOrganizations
    FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
  LET scope = DOCUMENT(scopes, @scopeKey)
  LET scopeRole = membership == null ? null : FIRST(FOR member IN scopeMembers
    FILTER member.scopeKey == @scopeKey && member.userOrganizationKey == membership._key && member.status == "active" LIMIT 1 RETURN member.role)
  FILTER membership != null && scope != null && scope.deletedAt == null && scope.organizationKey == @organizationKey
  FILTER membership.orgRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"${write ? '' : ', "member", "viewer"'}]
  RETURN membership._key`;

const parse = <T>(schema: { parse(value: unknown): T }, value: unknown) => schema.parse(withArangoKey(value as Record<string, unknown>));
async function authorize(database: BookDatabase, context: BookAccessContext, write: boolean) {
  if ((await (await database.query(accessQuery(write), { ...context })).all()).length === 0) throw new BookRepositoryError('forbidden');
}

export interface BookRepository {
  authorize(context: BookAccessContext, write?: boolean): Promise<void>;
  list(context: BookAccessContext): Promise<BookDetailRow[]>;
  detail(context: BookAccessContext, bookKey: string): Promise<BookDetailRow>;
  findByGenerationRequest(context: BookAccessContext, generationRequestKey: string): Promise<BookDetailRow | null>;
  create(context: BookAccessContext, book: Book, bookContext: BookContext): Promise<Book>;
  replaceChapters(context: BookAccessContext, bookKey: string, chapters: BookChapter[], patch: Partial<Book>): Promise<void>;
  updateBook(context: BookAccessContext, bookKey: string, patch: Partial<Book>): Promise<Book>;
  updateChapter(context: BookAccessContext, chapterKey: string, patch: Partial<BookChapter>): Promise<BookChapter>;
  upsertProgress(context: BookAccessContext, bookKey: string, chapterKey: string, progress: BookProgress): Promise<BookProgress>;
}

export function createBookRepository(database: BookDatabase = db): BookRepository {
  const readDetail = async (context: BookAccessContext, bookKey?: string) => {
    await authorize(database, context, false);
    const cursor = await database.query(`FOR book IN books
      FILTER book.scopeKey == @scopeKey && book.deletedAt == null ${bookKey ? '&& book._key == @bookKey' : ''}
      LET chapters = (FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == book._key
        LET progress = FIRST(FOR item IN bookProgress FILTER item.scopeKey == @scopeKey && item.userKey == @userKey && item.bookKey == book._key && item.chapterKey == chapter._key LIMIT 1 RETURN item)
        SORT chapter.position ASC RETURN { chapter, progress })
      SORT book.updatedAt DESC RETURN { book, chapters }`, { ...context, bookKey });
    return (await cursor.all() as Array<{ book: unknown; chapters: Array<{ chapter: unknown; progress: unknown | null }> }>).map((row) => ({
      book: parse(bookSchema, row.book), chapters: row.chapters.map((item) => ({ chapter: parse(bookChapterSchema, item.chapter), progress: item.progress ? parse(bookProgressSchema, item.progress) : null })),
    }));
  };
  return {
    authorize: (context, write = false) => authorize(database, context, write),
    list: (context) => readDetail(context),
    async detail(context, bookKey) { const row = (await readDetail(context, bookKey))[0]; if (!row) throw new BookRepositoryError('not_found'); return row; },
    async findByGenerationRequest(context, generationRequestKey) { await authorize(database, context, false); const cursor = await database.query('FOR book IN books FILTER book.scopeKey == @scopeKey && book.generationRequestKey == @generationRequestKey && book.deletedAt == null LIMIT 1 RETURN book._key', { scopeKey: context.scopeKey, generationRequestKey }); const key = (await cursor.all())[0]; return typeof key === 'string' ? (await readDetail(context, key))[0] ?? null : null; },
    create(context, book, bookContext) {
      return withTransaction({ read: ['userOrganizations', 'scopes', 'scopeMembers', 'scopeScopes'], write: ['books', 'bookContexts'] }, async (transaction) => {
        await authorize(transaction, context, true);
        const inserted = await transaction.query('INSERT @book INTO books RETURN NEW', { book: toArangoDoc(book) });
        await transaction.query('INSERT @context INTO bookContexts', { context: toArangoDoc(bookContext) });
        return parse(bookSchema, (await inserted.all())[0]);
      });
    },
    replaceChapters(context, bookKey, chapters, patch) {
      return withTransaction({ read: ['userOrganizations', 'scopes', 'scopeMembers', 'scopeScopes'], write: ['books', 'bookChapters'] }, async (transaction) => {
        await authorize(transaction, context, true);
        const found = await (await transaction.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.deletedAt == null RETURN 1', { bookKey, scopeKey: context.scopeKey })).all();
        if (!found.length) throw new BookRepositoryError('not_found');
        await transaction.query('FOR chapter IN bookChapters FILTER chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey REMOVE chapter IN bookChapters', { scopeKey: context.scopeKey, bookKey });
        for (const chapter of chapters) await transaction.query('INSERT @chapter INTO bookChapters', { chapter: toArangoDoc(chapter) });
        await transaction.query('UPDATE @bookKey WITH @patch IN books', { bookKey, patch });
      });
    },
    async updateBook(context, bookKey, patch) { await authorize(database, context, true); const cursor = await database.query('FOR book IN books FILTER book._key == @bookKey && book.scopeKey == @scopeKey && book.deletedAt == null UPDATE book WITH @patch IN books RETURN NEW', { bookKey, scopeKey: context.scopeKey, patch }); const value = (await cursor.all())[0]; if (!value) throw new BookRepositoryError('not_found'); return parse(bookSchema, value); },
    async updateChapter(context, chapterKey, patch) { await authorize(database, context, true); const cursor = await database.query('FOR chapter IN bookChapters FILTER chapter._key == @chapterKey && chapter.scopeKey == @scopeKey UPDATE chapter WITH @patch IN bookChapters RETURN NEW', { chapterKey, scopeKey: context.scopeKey, patch }); const value = (await cursor.all())[0]; if (!value) throw new BookRepositoryError('not_found'); return parse(bookChapterSchema, value); },
    async upsertProgress(context, bookKey, chapterKey, progress) { await authorize(database, context, false); const cursor = await database.query(`LET book = DOCUMENT(books, @bookKey) LET chapter = DOCUMENT(bookChapters, @chapterKey) FILTER book != null && book.scopeKey == @scopeKey && book.deletedAt == null && chapter != null && chapter.scopeKey == @scopeKey && chapter.bookKey == @bookKey UPSERT { scopeKey: @scopeKey, userKey: @userKey, bookKey: @bookKey, chapterKey: @chapterKey } INSERT @progress UPDATE @progress IN bookProgress RETURN NEW`, { ...context, bookKey, chapterKey, progress: toArangoDoc(progress) }); const value = (await cursor.all())[0]; if (!value) throw new BookRepositoryError('not_found'); return parse(bookProgressSchema, value); },
  };
}

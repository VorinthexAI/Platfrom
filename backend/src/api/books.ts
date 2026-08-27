import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { defaultBookService } from '@/lib/books/default-service';
import { BookRepositoryError } from '@/lib/books/repository';
import type { BookService } from '@/lib/books/service';
import { getAuthIdentity } from './security';

const pathKeySchema = z.string().cuid();

class BookHttpError extends Error { constructor(readonly status: 401 | 403, readonly code: string, message: string) { super(message); } }

export function createBookHandlers(options: { service?: BookService; getIdentity?: typeof getAuthIdentity } = {}) {
  const service = options.service ?? defaultBookService; const identity = options.getIdentity ?? getAuthIdentity;
  const run = (operation: (c: Context, books: BookService, userKey: string) => Promise<unknown>, status: 200 | 201 | 202 = 200) => async (c: Context) => {
    try {
      const current = await identity(c); if (!current) throw new BookHttpError(401, 'BOOK_UNAUTHORIZED', 'Authentication required.'); if (current.identityType !== 'user') throw new BookHttpError(403, 'BOOK_FORBIDDEN', 'A user session is required.');
      return c.json({ success: true, data: await operation(c, service, current.key) }, status);
    } catch (error) {
      if (error instanceof BookHttpError) return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof BookRepositoryError) { const status = error.reason === 'forbidden' ? 403 : error.reason === 'conflict' ? 409 : 404; const code = error.reason === 'forbidden' ? 'BOOK_FORBIDDEN' : error.reason === 'conflict' ? 'BOOK_CONFLICT' : 'BOOK_NOT_FOUND'; const message = error.reason === 'forbidden' ? 'Book scope access denied.' : error.reason === 'conflict' ? error.message : 'Book not found.'; return c.json({ success: false, error: { code, message } }, status); }
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'BOOK_INVALID_INPUT', message: 'Book request input was invalid.' } }, 400);
      return c.json({ success: false, error: { code: 'BOOK_FAILED', message: 'Book request failed.' } }, 500);
    }
  };
  return {
    overview: run((c, books, userKey) => c.req.json().then((body) => books.overview(body, userKey))),
    topicSuggestions: run((c, books, userKey) => c.req.json().then((body) => books.suggestTopics(body, userKey, { signal: c.req.raw.signal, timeoutMs: 30_000 }))),
    goalSuggestions: run((c, books, userKey) => c.req.json().then((body) => books.suggestGoals(body, userKey, { signal: c.req.raw.signal, timeoutMs: 30_000 }))),
    create: run((c, books, userKey) => c.req.json().then((body) => books.create(body, userKey)), 202),
    detail: run(async (c, books, userKey) => books.detail(pathKeySchema.parse(c.req.param('bookKey')), await c.req.json(), userKey)),
    progress: run(async (c, books, userKey) => books.progress(pathKeySchema.parse(c.req.param('bookKey')), pathKeySchema.parse(c.req.param('chapterKey')), await c.req.json(), userKey)),
    retry: run(async (c, books, userKey) => books.retry(pathKeySchema.parse(c.req.param('bookKey')), await c.req.json(), userKey), 202),
    cancel: run(async (c, books, userKey) => books.cancel(pathKeySchema.parse(c.req.param('bookKey')), await c.req.json(), userKey)),
    delete: run(async (c, books, userKey) => books.delete(pathKeySchema.parse(c.req.param('bookKey')), await c.req.json(), userKey)),
  };
}

export const bookHandlers = createBookHandlers();

import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { defaultBookService } from '@/lib/books/default-service';
import { BookRepositoryError } from '@/lib/books/repository';
import { bookCreateInputSchema, bookExtendInputSchema, bookFavoriteInputSchema, bookGoalSuggestInputSchema, bookShareDetailInputSchema, bookShareUpdateInputSchema, bookTopicSuggestInputSchema, type BookService } from '@/lib/books/service';
import { getAuthIdentity } from './security';
import { sparkErrorResponse } from './errors';
import { authorizeContentExecution, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { observeToolExecution, type ToolBillingDependencies } from '@/lib/ai/events/runtime';
import { toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';
import { createHash } from 'node:crypto';

const pathKeySchema = z.string().cuid();

class BookHttpError extends Error { constructor(readonly status: 401 | 403, readonly code: string, message: string) { super(message); } }

export function createBookHandlers(options: { service?: BookService; getIdentity?: typeof getAuthIdentity; authorize?: (input: { organizationKey: string; scopeKey: string }, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) => Promise<{ context: ToolContext }>; authorizationOptions?: Omit<RunAuthenticatedContentToolOptions, 'authenticatedUserKey' | 'execute'>; recordEvent?: ToolEventRecorder; billing?: ToolBillingDependencies } = {}) {
  const service = options.service ?? defaultBookService; const identity = options.getIdentity ?? getAuthIdentity;
  const run = (operation: (c: Context, books: BookService, userKey: string) => Promise<unknown>, status: 200 | 201 | 202 = 200) => async (c: Context) => {
    try {
      const current = await identity(c); if (!current) throw new BookHttpError(401, 'BOOK_UNAUTHORIZED', 'Authentication required.'); if (current.identityType !== 'user') throw new BookHttpError(403, 'BOOK_FORBIDDEN', 'A user session is required.');
      return c.json({ success: true, data: await operation(c, service, current.key) }, status);
    } catch (error) {
      const billing = sparkErrorResponse(c, error); if (billing) return billing;
      if (error instanceof BookHttpError) return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof BookRepositoryError) { const status = error.reason === 'forbidden' ? 403 : error.reason === 'conflict' || error.reason === 'favorite' ? 409 : 404; const code = error.reason === 'forbidden' ? 'BOOK_FORBIDDEN' : error.reason === 'favorite' ? 'BOOK_FAVORITE' : error.reason === 'conflict' ? 'BOOK_CONFLICT' : 'BOOK_NOT_FOUND'; const message = error.reason === 'forbidden' ? 'Audio book scope access denied.' : error.reason === 'conflict' || error.reason === 'favorite' ? error.message : 'Audio book not found.'; return c.json({ success: false, error: { code, message } }, status); }
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'BOOK_INVALID_INPUT', message: 'Audio book request input was invalid.' } }, 400);
      console.error('audio book request failed', { method: c.req.method, path: c.req.path, error });
      return c.json({ success: false, error: { code: 'BOOK_FAILED', message: 'Audio book request failed.' } }, 500);
    }
  };
  const observed = async <T>(slug: 'book.create' | 'book.extend' | 'book.topic.suggest' | 'book.goal.suggest', input: { organizationKey: string; scopeKey: string }, userKey: string, requestKey: string, execute: () => Promise<T>) => {
    const { context } = await (options.authorize ?? authorizeContentExecution)({ organizationKey: input.organizationKey, scopeKey: input.scopeKey }, { ...options.authorizationOptions, authenticatedUserKey: userKey });
    return observeToolExecution(slug, context, execute, { recorder: options.recordEvent ?? toolEventService.record, idempotencyKey: requestKey, input, ...options.billing });
  };
  const requestKey = (c: Context, input: unknown) => z.string().trim().min(1).max(200).parse(c.req.header('idempotency-key') ?? createHash('sha256').update(JSON.stringify(input)).digest('hex'));
  return {
    overview: run((c, books, userKey) => c.req.json().then((body) => books.overview(body, userKey))),
    topicSuggestions: run(async (c, books, userKey) => { const input = bookTopicSuggestInputSchema.parse(await c.req.json()); return observed('book.topic.suggest', input, userKey, requestKey(c, input), () => books.suggestTopics(input, userKey, { signal: c.req.raw.signal, timeoutMs: 45_000 })); }),
    goalSuggestions: run(async (c, books, userKey) => { const input = bookGoalSuggestInputSchema.parse(await c.req.json()); return observed('book.goal.suggest', input, userKey, requestKey(c, input), () => books.suggestGoals(input, userKey, { signal: c.req.raw.signal, timeoutMs: 45_000 })); }),
    // The paid result is durable acceptance into the idempotent generation queue.
    create: run(async (c, books, userKey) => { const input = bookCreateInputSchema.parse(await c.req.json()); return observed('book.create', input, userKey, input.generationRequestKey, () => books.create(input, userKey)); }, 202),
    detail: run(async (c, books, userKey) => books.detail(pathKeySchema.parse(c.req.param('bookKey')), await c.req.json(), userKey)),
    extensionPreview: run(async (c, books, userKey) => { const input = bookExtendInputSchema.parse({ ...await c.req.json() as Record<string, unknown>, mode: 'preview' }); return observed('book.extend', input, userKey, requestKey(c, input), () => books.extend(pathKeySchema.parse(c.req.param('bookKey')), input, userKey, { signal: c.req.raw.signal, timeoutMs: 30_000 })); }),
    extensionGenerate: run(async (c, books, userKey) => { const input = bookExtendInputSchema.parse({ ...await c.req.json() as Record<string, unknown>, mode: 'generate' }); if (input.mode !== 'generate') throw new Error('unreachable'); return observed('book.extend', input, userKey, input.requestKey, () => books.extend(pathKeySchema.parse(c.req.param('bookKey')), input, userKey)); }, 202),
    shareDetail: run(async (c, books, userKey) => books.shareDetail(pathKeySchema.parse(c.req.param('bookKey')), bookShareDetailInputSchema.parse(await c.req.json()), userKey)),
    shareUpdate: run(async (c, books, userKey) => books.setShareActive(pathKeySchema.parse(c.req.param('bookKey')), bookShareUpdateInputSchema.parse(await c.req.json()), userKey)),
    progress: run(async (c, books, userKey) => books.progress(pathKeySchema.parse(c.req.param('bookKey')), pathKeySchema.parse(c.req.param('chapterKey')), await c.req.json(), userKey)),
    retry: run(async (c, books, userKey) => books.retry(pathKeySchema.parse(c.req.param('bookKey')), await c.req.json(), userKey), 202),
    cancel: run(async (c, books, userKey) => books.cancel(pathKeySchema.parse(c.req.param('bookKey')), await c.req.json(), userKey)),
    setFavorite: run(async (c, books, userKey) => books.setFavorite(pathKeySchema.parse(c.req.param('bookKey')), bookFavoriteInputSchema.parse(await c.req.json()), userKey)),
    delete: run(async (c, books, userKey) => books.delete(pathKeySchema.parse(c.req.param('bookKey')), await c.req.json(), userKey)),
  };
}

export const bookHandlers = createBookHandlers();

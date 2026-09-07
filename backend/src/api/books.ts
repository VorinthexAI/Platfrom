import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { defaultBookService } from '@/lib/books/default-service';
import { BookRepositoryError } from '@/lib/books/repository';
import { bookCreateInputSchema, bookExtendInputSchema, bookFavoriteInputSchema, bookGoalSuggestInputSchema, bookTopicSuggestInputSchema, type BookService } from '@/lib/books/service';
import { getAuthIdentity } from './security';
import { authenticatedTeamContext, type AuthIdentity } from './auth';
import { sparkErrorResponse } from './errors';
import { authorizeContentExecution, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { observeToolExecution, type ToolBillingDependencies } from '@/lib/ai/events/runtime';
import { toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';
import { createHash } from 'node:crypto';

const pathKeySchema = z.string().cuid();

class BookHttpError extends Error { constructor(readonly status: 401 | 403, readonly code: string, message: string) { super(message); } }

export function createBookHandlers(options: { service?: BookService; getIdentity?: typeof getAuthIdentity; authorize?: (input: { teamKey: string; scopeKey: string }, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) => Promise<{ context: ToolContext }>; authorizationOptions?: Omit<RunAuthenticatedContentToolOptions, 'authenticatedUserKey' | 'execute'>; recordEvent?: ToolEventRecorder; appScopeKey?: string; billing?: ToolBillingDependencies } = {}) {
  const service = options.service ?? defaultBookService; const identity = options.getIdentity ?? getAuthIdentity;
  const run = (operation: (c: Context, books: BookService, identity: AuthIdentity) => Promise<unknown>, status: 200 | 201 | 202 = 200) => async (c: Context) => {
    try {
      const current = await identity(c); if (!current) throw new BookHttpError(401, 'BOOK_UNAUTHORIZED', 'Authentication required.'); if (current.identityType !== 'user') throw new BookHttpError(403, 'BOOK_FORBIDDEN', 'A user session is required.');
      return c.json({ success: true, data: await operation(c, service, current) }, status);
    } catch (error) {
      const billing = sparkErrorResponse(c, error); if (billing) return billing;
      if (error instanceof BookHttpError) return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof BookRepositoryError) { const status = error.reason === 'forbidden' ? 403 : error.reason === 'conflict' || error.reason === 'favorite' ? 409 : 404; const code = error.reason === 'forbidden' ? 'BOOK_FORBIDDEN' : error.reason === 'favorite' ? 'BOOK_FAVORITE' : error.reason === 'conflict' ? 'BOOK_CONFLICT' : 'BOOK_NOT_FOUND'; const message = error.reason === 'forbidden' ? 'Audio book scope access denied.' : error.reason === 'conflict' || error.reason === 'favorite' ? error.message : 'Audio book not found.'; return c.json({ success: false, error: { code, message } }, status); }
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'BOOK_INVALID_INPUT', message: 'Audio book request input was invalid.' } }, 400);
      console.error('audio book request failed', { method: c.req.method, path: c.req.path, error });
      return c.json({ success: false, error: { code: 'BOOK_FAILED', message: 'Audio book request failed.' } }, 500);
    }
  };
  const observed = async <T>(slug: 'book.create' | 'book.extend' | 'book.topic.suggest' | 'book.goal.suggest', input: { teamKey: string; scopeKey: string }, identity: AuthIdentity, requestKey: string, execute: () => Promise<T>) => {
    const { context } = await (options.authorize ?? authorizeContentExecution)({ teamKey: input.teamKey, scopeKey: input.scopeKey }, { ...options.authorizationOptions, ...authenticatedTeamContext(identity) });
    return observeToolExecution(slug, context, execute, { recorder: options.recordEvent ?? toolEventService.record, appScopeKey: options.appScopeKey, idempotencyKey: requestKey, input, ...options.billing });
  };
  const requestKey = (c: Context, input: unknown) => z.string().trim().min(1).max(200).parse(c.req.header('idempotency-key') ?? createHash('sha256').update(JSON.stringify(input)).digest('hex'));
  return {
    overview: run((c, books, identity) => c.req.json().then((body) => books.overview(body, identity.key))),
    topicSuggestions: run(async (c, books, identity) => { const input = bookTopicSuggestInputSchema.parse(await c.req.json()); return observed('book.topic.suggest', input, identity, requestKey(c, input), () => books.suggestTopics(input, identity.key, { signal: c.req.raw.signal, timeoutMs: 45_000 })); }),
    goalSuggestions: run(async (c, books, identity) => { const input = bookGoalSuggestInputSchema.parse(await c.req.json()); return observed('book.goal.suggest', input, identity, requestKey(c, input), () => books.suggestGoals(input, identity.key, { signal: c.req.raw.signal, timeoutMs: 45_000 })); }),
    // The paid result is durable acceptance into the idempotent generation queue.
    create: run(async (c, books, identity) => { const input = bookCreateInputSchema.parse(await c.req.json()); return observed('book.create', input, identity, input.generationRequestKey, () => books.create(input, identity.key)); }, 202),
    detail: run(async (c, books, identity) => books.detail(pathKeySchema.parse(c.req.param('bookKey')), await c.req.json(), identity.key)),
    extensionPreview: run(async (c, books, identity) => { const input = bookExtendInputSchema.parse({ ...await c.req.json() as Record<string, unknown>, mode: 'preview' }); return observed('book.extend', input, identity, requestKey(c, input), () => books.extend(pathKeySchema.parse(c.req.param('bookKey')), input, identity.key, { signal: c.req.raw.signal, timeoutMs: 30_000 })); }),
    extensionGenerate: run(async (c, books, identity) => { const input = bookExtendInputSchema.parse({ ...await c.req.json() as Record<string, unknown>, mode: 'generate' }); if (input.mode !== 'generate') throw new Error('unreachable'); return observed('book.extend', input, identity, input.requestKey, () => books.extend(pathKeySchema.parse(c.req.param('bookKey')), input, identity.key)); }, 202),
    progress: run(async (c, books, identity) => books.progress(pathKeySchema.parse(c.req.param('bookKey')), pathKeySchema.parse(c.req.param('chapterKey')), await c.req.json(), identity.key)),
    retry: run(async (c, books, identity) => books.retry(pathKeySchema.parse(c.req.param('bookKey')), await c.req.json(), identity.key), 202),
    cancel: run(async (c, books, identity) => books.cancel(pathKeySchema.parse(c.req.param('bookKey')), await c.req.json(), identity.key)),
    setFavorite: run(async (c, books, identity) => books.setFavorite(pathKeySchema.parse(c.req.param('bookKey')), bookFavoriteInputSchema.parse(await c.req.json()), identity.key)),
    delete: run(async (c, books, identity) => books.delete(pathKeySchema.parse(c.req.param('bookKey')), await c.req.json(), identity.key)),
  };
}

export const bookHandlers = createBookHandlers();

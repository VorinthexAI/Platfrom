import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ZodError } from 'zod';
import { defaultBookService } from '@/lib/books/default-service';
import { BookRepositoryError } from '@/lib/books/repository';
import { bookShareTokenSchema, type BookService } from '@/lib/books/service';
import { subscribeBookShareChanged } from '@/lib/books/share-events';
import { parseJson, strictObject } from './validation';

const bodySchema = strictObject({ token: bookShareTokenSchema });
const HEARTBEAT_MS = 20_000;
const REVALIDATE_MS = 15_000;

export function createPublicBookShareHandlers(options: { service?: BookService; subscribe?: typeof subscribeBookShareChanged; heartbeatMs?: number; revalidateMs?: number } = {}) {
  const service = options.service ?? defaultBookService;
  return {
    read: async (c: Context) => {
      c.header('Cache-Control', 'no-store');
      try { return c.json({ success: true, data: await service.readPublicShare((await parseJson(c, bodySchema)).token) }); }
      catch (error) {
        if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'BOOK_SHARE_INVALID_INPUT', message: 'Share token input was invalid.' } }, 400);
        if (error instanceof BookRepositoryError && error.reason === 'not_found') return c.json({ success: false, error: { code: 'BOOK_SHARE_UNAVAILABLE', message: 'Audio book share is unavailable.' } }, 404);
        return c.json({ success: false, error: { code: 'BOOK_SHARE_FAILED', message: 'Audio book share request failed.' } }, 500);
      }
    },
    stream: async (c: Context) => {
      c.header('Cache-Control', 'no-store');
      const parsed = bodySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
      if (!parsed.success) return c.json({ success: false, error: { code: 'BOOK_SHARE_INVALID_INPUT', message: 'Share token input was invalid.' } }, 400);
      const initial = await service.publicShareStatus(parsed.data.token).catch(() => null);
      if (!initial) return c.json({ success: false, error: { code: 'BOOK_SHARE_FAILED', message: 'Audio book share request failed.' } }, 500);
      const response = streamSSE(c, async (stream) => {
        let open = true; let checking = Promise.resolve(); let lastActive: boolean | undefined;
        let resolveClosed = () => {};
        const closed = new Promise<void>((resolve) => { resolveClosed = resolve; stream.onAbort(resolve); });
        const emit = async (active: boolean) => { if (!open || active === lastActive) return; lastActive = active; await stream.writeSSE({ event: 'access', data: JSON.stringify({ status: active ? 'active' : 'inactive' }) }); if (!active) { open = false; stream.close(); resolveClosed(); } };
        const check = () => { checking = checking.then(async () => { const status = await service.publicShareStatus(parsed.data.token).catch(() => null); if (status) await emit(status.active); }); };
        const unsubscribe = (options.subscribe ?? subscribeBookShareChanged)(initial.tokenHash, check);
        const heartbeat = setInterval(() => { if (open) void stream.write(': heartbeat\n\n').catch(() => undefined); }, options.heartbeatMs ?? HEARTBEAT_MS);
        const revalidate = setInterval(check, options.revalidateMs ?? REVALIDATE_MS);
        try { await emit(initial.active); if (initial.active) { check(); await closed; } }
        finally { open = false; clearInterval(heartbeat); clearInterval(revalidate); unsubscribe(); await checking; }
      });
      response.headers.set('Cache-Control', 'no-store');
      return response;
    },
  };
}

export const publicBookShareHandlers = createPublicBookShareHandlers();

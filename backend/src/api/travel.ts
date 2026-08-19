import type { Context } from 'hono';
import { ZodError } from 'zod';
import { ProviderExecutionError } from '@/lib/ai/router/errors';
import { TravelRepositoryError } from '@/lib/travel/repository';
import { createTravelService, type TravelService } from '@/lib/travel/service';
import { travelPlaceImagesInputSchema } from '@/lib/travel/place-images';
import { getAuthIdentity } from './security';

type IdentityReader = typeof getAuthIdentity;
class TravelHttpError extends Error { constructor(readonly status: 401 | 403, readonly code: string, message: string) { super(message); } }

export function createTravelHandlers(options: { service?: TravelService; getIdentity?: IdentityReader } = {}) {
  const service = options.service ?? createTravelService();
  const getIdentity = options.getIdentity ?? getAuthIdentity;
  const run = (operation: (c: Context, service: TravelService, userKey: string) => Promise<unknown>) => async (c: Context) => {
    try {
      const identity = await getIdentity(c);
      if (!identity) throw new TravelHttpError(401, 'TRAVEL_UNAUTHORIZED', 'Authentication required.');
      if (identity.identityType !== 'user') throw new TravelHttpError(403, 'TRAVEL_FORBIDDEN', 'A user session is required.');
      return c.json({ success: true, data: await operation(c, service, identity.key) });
    } catch (error) {
      if (error instanceof TravelHttpError) return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof TravelRepositoryError) {
        return c.json({ success: false, error: { code: 'TRAVEL_FORBIDDEN', message: 'Travel scope access denied.' } }, 403);
      }
      if (error instanceof ProviderExecutionError) {
        const codes = new Set(error.attempts.map(({ code }) => code));
        if (codes.has('rate_limited')) return c.json({ success: false, error: { code: 'TRAVEL_RATE_LIMITED', message: 'Travel generation is temporarily busy. Try again shortly.' } }, 429);
        if (codes.has('timeout') || codes.has('aborted')) return c.json({ success: false, error: { code: 'TRAVEL_LOOKUP_TIMEOUT', message: 'Travel generation took too long. Try again.' } }, 504);
        return c.json({ success: false, error: { code: 'TRAVEL_PROVIDER_UNAVAILABLE', message: 'Travel generation is temporarily unavailable.' } }, 503);
      }
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'TRAVEL_INVALID_INPUT', message: 'Travel request input was invalid.' } }, 400);
      return c.json({ success: false, error: { code: 'TRAVEL_FAILED', message: 'Travel request failed.' } }, 500);
    }
  };
  return {
    overview: run(async (c, travel, userKey) => travel.overview(await c.req.json(), userKey)),
    findPlace: run(async (c, travel, userKey) => travel.findPlace(await c.req.json(), userKey, { signal: c.req.raw.signal })),
    generatePlaceImages: run(async (c, travel, userKey) => travel.generatePlaceImages(travelPlaceImagesInputSchema.parse(await c.req.json()), userKey, { signal: c.req.raw.signal })),
  };
}

export const travelHandlers = createTravelHandlers();

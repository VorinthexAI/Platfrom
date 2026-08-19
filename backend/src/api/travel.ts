import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { ProviderExecutionError } from '@/lib/ai/router/errors';
import { TravelRepositoryError } from '@/lib/travel/repository';
import { createTravelService, TravelPlaceLookupError, type TravelService } from '@/lib/travel/service';
import { getAuthIdentity } from './security';

type IdentityReader = typeof getAuthIdentity;
const pathKeySchema = z.string().cuid();
class TravelHttpError extends Error { constructor(readonly status: 401 | 403, readonly code: string, message: string) { super(message); } }

export function createTravelHandlers(options: { service?: TravelService; getIdentity?: IdentityReader } = {}) {
  const service = options.service ?? createTravelService();
  const getIdentity = options.getIdentity ?? getAuthIdentity;
  const run = (operation: (c: Context, service: TravelService, userKey: string) => Promise<unknown>, status: 200 | 201 = 200) => async (c: Context) => {
    try {
      const identity = await getIdentity(c);
      if (!identity) throw new TravelHttpError(401, 'TRAVEL_UNAUTHORIZED', 'Authentication required.');
      if (identity.identityType !== 'user') throw new TravelHttpError(403, 'TRAVEL_FORBIDDEN', 'A user session is required.');
      return c.json({ success: true, data: await operation(c, service, identity.key) }, status);
    } catch (error) {
      if (error instanceof TravelHttpError) return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof TravelRepositoryError) {
        const status = error.reason === 'forbidden' ? 403 : error.reason === 'not_found' ? 404 : 409;
        const code = error.reason === 'forbidden' ? 'TRAVEL_FORBIDDEN' : error.reason === 'not_found' ? 'TRAVEL_NOT_FOUND' : 'TRAVEL_CONFLICT';
        return c.json({ success: false, error: { code, message: error.reason === 'duplicate' ? 'Place is already in the trip.' : error.reason === 'not_found' ? 'Travel resource not found.' : 'Travel scope access denied.' } }, status);
      }
      if (error instanceof ProviderExecutionError) {
        const codes = new Set(error.attempts.map(({ code }) => code));
        if (codes.has('rate_limited')) return c.json({ success: false, error: { code: 'TRAVEL_RATE_LIMITED', message: 'Place information is temporarily busy. Try again shortly.' } }, 429);
        if (codes.has('timeout') || codes.has('aborted')) return c.json({ success: false, error: { code: 'TRAVEL_LOOKUP_TIMEOUT', message: 'Place information took too long to load. Try again.' } }, 504);
        return c.json({ success: false, error: { code: 'TRAVEL_PROVIDER_UNAVAILABLE', message: 'Place information is temporarily unavailable.' } }, 503);
      }
      if (error instanceof TravelPlaceLookupError) return c.json({ success: false, error: { code: 'TRAVEL_INVALID_PROVIDER_RESPONSE', message: 'Place information could not be read. Try again.' } }, 502);
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'TRAVEL_INVALID_INPUT', message: 'Travel request input was invalid.' } }, 400);
      return c.json({ success: false, error: { code: 'TRAVEL_FAILED', message: 'Travel request failed.' } }, 500);
    }
  };
  return {
    overview: run(async (c, travel, userKey) => travel.overview(await c.req.json(), userKey)),
    findPlace: run(async (c, travel, userKey) => travel.findPlace(await c.req.json(), userKey, { signal: c.req.raw.signal })),
    createPlace: run(async (c, travel, userKey) => travel.createPlace(await c.req.json(), userKey), 201),
    createVisit: run(async (c, travel, userKey) => travel.createVisit(pathKeySchema.parse(c.req.param('placeKey')), await c.req.json(), userKey), 201),
    createTrip: run(async (c, travel, userKey) => travel.createTrip(await c.req.json(), userKey), 201),
    appendPlace: run(async (c, travel, userKey) => travel.appendPlace(pathKeySchema.parse(c.req.param('tripKey')), await c.req.json(), userKey), 201),
    removePlace: run(async (c, travel, userKey) => travel.removePlace(pathKeySchema.parse(c.req.param('tripKey')), pathKeySchema.parse(c.req.param('placeKey')), await c.req.json(), userKey)),
  };
}

export const travelHandlers = createTravelHandlers();

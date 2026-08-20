import type { Context } from 'hono';
import { ZodError } from 'zod';
import { ProviderExecutionError } from '@/lib/ai/router/errors';
import { TravelRepositoryError } from '@/lib/travel/repository';
import { createTravelService, GuideGenerationError, travelChildrenFindInputSchema, travelCityFindInputSchema, travelPlaceCreateInputSchema, travelPlaceOpenInputSchema, type TravelService } from '@/lib/travel/service';
import { travelPlaceImageInputSchema } from '@/lib/travel/place-images';
import { getAuthIdentity } from './security';

type IdentityReader = typeof getAuthIdentity;
class TravelHttpError extends Error { constructor(readonly status: 401 | 403, readonly code: string, message: string) { super(message); } }

export function createTravelHandlers(options: { service?: TravelService; getIdentity?: IdentityReader } = {}) {
  const service = options.service ?? createTravelService();
  const getIdentity = options.getIdentity ?? getAuthIdentity;
  const run = (operation: (c: Context, service: TravelService, userKey: string) => Promise<unknown>, generationKind: 'country' | 'city' | 'image' | 'destination' = 'destination') => async (c: Context) => {
    try {
      const identity = await getIdentity(c);
      if (!identity) throw new TravelHttpError(401, 'TRAVEL_UNAUTHORIZED', 'Authentication required.');
      if (identity.identityType !== 'user') throw new TravelHttpError(403, 'TRAVEL_FORBIDDEN', 'A user session is required.');
      return c.json({ success: true, data: await operation(c, service, identity.key) });
    } catch (error) {
      if (error instanceof TravelHttpError) return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof TravelRepositoryError) {
        return c.json({ success: false, error: { code: 'TRAVEL_FORBIDDEN', message: 'Compass access denied.' } }, 403);
      }
      if (error instanceof ProviderExecutionError) {
        const label = generationKind[0]!.toUpperCase() + generationKind.slice(1);
        const codes = new Set(error.attempts.map(({ code }) => code));
        if (codes.has('rate_limited')) return c.json({ success: false, error: { code: 'TRAVEL_RATE_LIMITED', message: `${label} generation is temporarily busy. Try again shortly.` } }, 429);
        if (codes.has('timeout') || codes.has('aborted')) return c.json({ success: false, error: { code: 'TRAVEL_LOOKUP_TIMEOUT', message: `${label} generation took too long. Try again.` } }, 504);
        return c.json({ success: false, error: { code: 'TRAVEL_PROVIDER_UNAVAILABLE', message: `${label} generation is temporarily unavailable.` } }, 503);
      }
      if (error instanceof GuideGenerationError) {
        console.error(`${error.guideKind} guide generation returned an invalid provider response`, { message: error.message, cause: error.cause instanceof Error ? error.cause.message : String(error.cause) });
        const label = error.guideKind === 'country' ? 'Country' : 'City';
        return c.json({ success: false, error: { code: `${label.toUpperCase()}_PROVIDER_INVALID_RESPONSE`, message: `${label} generation returned an invalid response. Try again.` } }, 502);
      }
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'TRAVEL_INVALID_INPUT', message: 'Compass request input was invalid.' } }, 400);
      console.error('travel request failed', { error });
      return c.json({ success: false, error: { code: 'TRAVEL_FAILED', message: 'Compass request failed.' } }, 500);
    }
  };
  return {
    overview: run(async (c, travel, userKey) => travel.overview(await c.req.json(), userKey)),
    createPlace: run(async (c, travel, userKey) => travel.createPlace(travelPlaceCreateInputSchema.parse(await c.req.json()), userKey, { signal: c.req.raw.signal })),
    openPlace: run(async (c, travel, userKey) => travel.openPlace(travelPlaceOpenInputSchema.parse(await c.req.json()), userKey)),
    findPlace: run(async (c, travel, userKey) => travel.findPlace(await c.req.json(), userKey, { signal: c.req.raw.signal }), 'country'),
    findCity: run(async (c, travel, userKey) => travel.findCity(travelCityFindInputSchema.parse(await c.req.json()), userKey, { signal: c.req.raw.signal }), 'city'),
    findChildren: run(async (c, travel, userKey) => travel.findChildren(travelChildrenFindInputSchema.parse(await c.req.json()), userKey, { signal: c.req.raw.signal }), 'city'),
    generatePlaceHeroImage: run(async (c, travel, userKey) => travel.generatePlaceHeroImage(travelPlaceImageInputSchema.parse(await c.req.json()), userKey, { signal: c.req.raw.signal }), 'image'),
  };
}

export const travelHandlers = createTravelHandlers();

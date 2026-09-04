import type { Context } from 'hono';
import { ZodError } from 'zod';
import { ProviderExecutionError } from '@/lib/ai/router/errors';
import { TravelRepositoryError } from '@/lib/travel/repository';
import { createTravelService, GuideGenerationError, travelChildrenFindInputSchema, travelCityFindInputSchema, travelPlaceCreateInputSchema, travelPlaceDeleteInputSchema, travelPlaceFindInputSchema, travelPlaceGuideFindInputSchema, travelPlaceOpenInputSchema, travelPlaceReferenceGenerateInputSchema, travelPlaceReferenceListInputSchema, travelPlaceSearchInputSchema, travelPlaceUpdateInputSchema, travelTripAttachmentSetInputSchema, travelTripCreateInputSchema, travelTripDeleteInputSchema, travelTripGuideGenerateInputSchema, travelTripGuideListInputSchema, travelTripListInputSchema, travelTripSearchInputSchema, travelTripUpdateInputSchema, type TravelService } from '@/lib/travel/service';
import { travelPlaceImageInputSchema } from '@/lib/travel/place-images';
import { getAuthIdentity } from './security';
import { sparkErrorResponse } from './errors';
import { authorizeContentExecution, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { observeToolExecution, type ToolBillingDependencies } from '@/lib/ai/events/runtime';
import { toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';
import { z } from 'zod';
import { createHash } from 'node:crypto';

type IdentityReader = typeof getAuthIdentity;
class TravelHttpError extends Error { constructor(readonly status: 401 | 403, readonly code: string, message: string) { super(message); } }

export function createTravelHandlers(options: { service?: TravelService; getIdentity?: IdentityReader; authorize?: (input: { organizationKey: string; scopeKey: string }, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) => Promise<{ context: ToolContext }>; authorizationOptions?: Omit<RunAuthenticatedContentToolOptions, 'authenticatedUserKey' | 'execute'>; recordEvent?: ToolEventRecorder; billing?: ToolBillingDependencies } = {}) {
  const service = options.service ?? createTravelService();
  const getIdentity = options.getIdentity ?? getAuthIdentity;
  const observed = async <T>(slug: 'trip.create' | 'trip.guide.generate' | 'place.create' | 'place.find' | 'place.reference.generate' | 'place.guide.find' | 'place.find-city' | 'place.find-children' | 'image.generate', input: { organizationKey: string; scopeKey: string }, userKey: string, requestKey: string, execute: () => Promise<T>) => {
    const { context } = await (options.authorize ?? authorizeContentExecution)({ organizationKey: input.organizationKey, scopeKey: input.scopeKey }, { ...options.authorizationOptions, authenticatedUserKey: userKey });
    return observeToolExecution(slug, context, execute, { recorder: options.recordEvent ?? toolEventService.record, idempotencyKey: requestKey, input, ...options.billing });
  };
  const requestKey = (c: Context, input: unknown) => z.string().trim().min(1).max(200).parse(c.req.header('idempotency-key') ?? createHash('sha256').update(JSON.stringify(input)).digest('hex'));
  const run = (operation: (c: Context, service: TravelService, userKey: string) => Promise<unknown>, generationKind: 'country' | 'city' | 'image' | 'search' | 'trip' | 'destination' = 'destination') => async (c: Context) => {
    try {
      const identity = await getIdentity(c);
      if (!identity) throw new TravelHttpError(401, 'TRAVEL_UNAUTHORIZED', 'Authentication required.');
      if (identity.identityType !== 'user') throw new TravelHttpError(403, 'TRAVEL_FORBIDDEN', 'A user session is required.');
      return c.json({ success: true, data: await operation(c, service, identity.key) });
    } catch (error) {
      const billing = sparkErrorResponse(c, error); if (billing) return billing;
      if (error instanceof TravelHttpError) return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof TravelRepositoryError) {
        if (error.reason === 'conflict') return c.json({ success: false, error: { code: 'TRAVEL_IDEMPOTENCY_CONFLICT', message: 'This request key was already used for different data.' } }, 409);
        if (error.reason === 'gone') return c.json({ success: false, error: { code: 'TRAVEL_TRIP_DELETED', message: 'This request already created a trip that was deleted.' } }, 409);
        if (error.reason === 'favorite') return c.json({ success: false, error: { code: 'TRAVEL_FAVORITE_TRIP', message: 'Favorite trips must be unfavorited before deletion.' } }, 409);
        return c.json({ success: false, error: { code: 'TRAVEL_FORBIDDEN', message: 'Travel access denied.' } }, 403);
      }
      if (error instanceof ProviderExecutionError) {
        const label = generationKind[0]!.toUpperCase() + generationKind.slice(1);
        const codes = new Set(error.attempts.map(({ code }) => code));
        if (codes.has('authentication_failed') || codes.has('not_configured') || codes.has('adapter_unavailable')) return c.json({ success: false, error: { code: 'TRAVEL_PROVIDER_CONFIGURATION_REQUIRED', message: `${label} generation is unavailable because the AI service is not configured.` } }, 503);
        if (codes.has('rate_limited')) return c.json({ success: false, error: { code: 'TRAVEL_RATE_LIMITED', message: `${label} generation is temporarily busy. Try again shortly.` } }, 429);
        if (codes.has('timeout') || codes.has('aborted')) return c.json({ success: false, error: { code: 'TRAVEL_LOOKUP_TIMEOUT', message: `${label} generation took too long. Try again.` } }, 504);
        return c.json({ success: false, error: { code: 'TRAVEL_PROVIDER_UNAVAILABLE', message: `${label} generation is temporarily unavailable.` } }, 503);
      }
      if (error instanceof GuideGenerationError) {
        console.error(`${error.guideKind} guide generation returned an invalid provider response`, { message: error.message, cause: error.cause instanceof Error ? error.cause.message : String(error.cause) });
        const label = error.guideKind === 'country' ? 'Country' : error.guideKind === 'city' ? 'City' : error.guideKind === 'trip' ? 'Trip' : error.guideKind === 'place-reference' ? 'Place reference' : 'Search';
        const code = error.guideKind === 'place-reference' ? 'PLACE_REFERENCE_PROVIDER_INVALID_RESPONSE' : `${label.toUpperCase()}_PROVIDER_INVALID_RESPONSE`;
        return c.json({ success: false, error: { code, message: `${label} generation returned an invalid response. Try again.` } }, 502);
      }
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'TRAVEL_INVALID_INPUT', message: 'Travel request input was invalid.' } }, 400);
      console.error('travel request failed', { error });
      return c.json({ success: false, error: { code: 'TRAVEL_FAILED', message: 'Travel request failed.' } }, 500);
    }
  };
  return {
    findPlaces: run(async (c, travel, userKey) => { const input = travelPlaceFindInputSchema.parse(await c.req.json()); return observed('place.find', input, userKey, requestKey(c, input), () => travel.findPlaces(input, userKey, { signal: c.req.raw.signal })); }, 'search'),
    searchPlaces: run(async (c, travel, userKey) => travel.searchPlaces(travelPlaceSearchInputSchema.parse(await c.req.json()), userKey, { signal: c.req.raw.signal }), 'search'),
    listTrips: run(async (c, travel, userKey) => travel.listTrips(travelTripListInputSchema.parse(await c.req.json()), userKey)),
    searchTrips: run(async (c, travel, userKey) => travel.searchTrips(travelTripSearchInputSchema.parse(await c.req.json()), userKey, { signal: c.req.raw.signal })),
    generateTripGuide: run(async (c, travel, userKey) => { const input = travelTripGuideGenerateInputSchema.parse(await c.req.json()); return observed('trip.guide.generate', input, userKey, input.idempotencyKey, () => travel.generateTripGuide(input, userKey, { signal: c.req.raw.signal })); }, 'trip'),
    listTripGuides: run(async (c, travel, userKey) => travel.listTripGuides(travelTripGuideListInputSchema.parse(await c.req.json()), userKey)),
    generatePlaceReference: run(async (c, travel, userKey) => { const input = travelPlaceReferenceGenerateInputSchema.parse(await c.req.json()); return observed('place.reference.generate', input, userKey, input.idempotencyKey, () => travel.generatePlaceReference(input, userKey, { signal: c.req.raw.signal })); }, 'destination'),
    listPlaceReferences: run(async (c, travel, userKey) => travel.listPlaceReferences(travelPlaceReferenceListInputSchema.parse(await c.req.json()), userKey)),
    createTrip: run(async (c, travel, userKey) => { const input = travelTripCreateInputSchema.parse(await c.req.json()); return observed('trip.create', input, userKey, input.idempotencyKey, () => travel.createTrip(input, userKey)); }),
    updateTrip: run(async (c, travel, userKey) => travel.updateTrip(travelTripUpdateInputSchema.parse(await c.req.json()), userKey)),
    deleteTrip: run(async (c, travel, userKey) => travel.deleteTrip(travelTripDeleteInputSchema.parse(await c.req.json()), userKey)),
    setTripAttachments: run(async (c, travel, userKey) => travel.setTripAttachments(travelTripAttachmentSetInputSchema.parse(await c.req.json()), userKey)),
    overview: run(async (c, travel, userKey) => travel.overview(await c.req.json(), userKey)),
    createPlace: run(async (c, travel, userKey) => { const input = travelPlaceCreateInputSchema.parse(await c.req.json()); return observed('place.create', input, userKey, requestKey(c, input), () => travel.createPlace(input, userKey, { signal: c.req.raw.signal })); }),
    updatePlace: run(async (c, travel, userKey) => travel.updatePlace(travelPlaceUpdateInputSchema.parse(await c.req.json()), userKey)),
    deletePlace: run(async (c, travel, userKey) => travel.deletePlace(travelPlaceDeleteInputSchema.parse(await c.req.json()), userKey)),
    openPlace: run(async (c, travel, userKey) => travel.openPlace(travelPlaceOpenInputSchema.parse(await c.req.json()), userKey)),
    findPlaceGuide: run(async (c, travel, userKey) => { const input = travelPlaceGuideFindInputSchema.parse(await c.req.json()); return observed('place.guide.find', input, userKey, requestKey(c, input), () => travel.findPlaceGuide(input, userKey, { signal: c.req.raw.signal })); }, 'country'),
    findCity: run(async (c, travel, userKey) => { const input = travelCityFindInputSchema.parse(await c.req.json()); return observed('place.find-city', input, userKey, requestKey(c, input), () => travel.findCity(input, userKey, { signal: c.req.raw.signal })); }, 'city'),
    findChildren: run(async (c, travel, userKey) => { const input = travelChildrenFindInputSchema.parse(await c.req.json()); return observed('place.find-children', input, userKey, requestKey(c, input), () => travel.findChildren(input, userKey, { signal: c.req.raw.signal })); }, 'city'),
    generatePlaceHeroImage: run(async (c, travel, userKey) => { const input = travelPlaceImageInputSchema.parse(await c.req.json()); return observed('image.generate', input, userKey, requestKey(c, input), () => travel.generatePlaceHeroImage(input, userKey, { signal: c.req.raw.signal })); }, 'image'),
  };
}

export const travelHandlers = createTravelHandlers();

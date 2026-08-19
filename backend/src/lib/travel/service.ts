import { z } from 'zod';
import { strictObject } from '@/api/validation';
import type { Place } from '@/lib/db/places.node';
import { createTravelRepository, type TravelAccessContext, type TravelRepository } from './repository';

const requestContextShape = { organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid() };
export const travelOverviewInputSchema = strictObject(requestContextShape);

export function placeDto(place: Place) {
  return {
    key: place.key,
    name: place.name,
    countryCode: place.countryCode,
    latitude: place.latitude,
    longitude: place.longitude,
    createdAt: place.createdAt,
  };
}

export function createTravelService(options: { repository?: TravelRepository } = {}) {
  const repository = options.repository ?? createTravelRepository();
  const access = (input: { organizationKey: string; scopeKey: string }, userKey: string): TravelAccessContext => ({ ...input, userKey });
  return {
    async overview(raw: unknown, userKey: string) {
      const input = travelOverviewInputSchema.parse(raw);
      const places = await repository.overview(access(input, userKey));
      return { places: places.map(placeDto) };
    },
  };
}

export type TravelService = ReturnType<typeof createTravelService>;

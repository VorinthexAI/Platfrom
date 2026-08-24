import { z } from 'zod';

export const TRIP_PLACES_COLLECTION = 'tripPlaces';
export const tripPlaceSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  tripKey: z.string().cuid(),
  placeKey: z.string().cuid(),
  position: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type TripPlace = z.infer<typeof tripPlaceSchema>;

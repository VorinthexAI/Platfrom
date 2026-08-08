import { describe, expect, test } from 'bun:test';
import { buildEmbeddingText } from './base';
import { placeSchema, placesEmbeddingFields } from './places.node';
import { tripSchema, tripsEmbeddingFields } from './trips.node';
import { tripPlaceSchema } from './trip-places.node';
import { placeVisitSchema } from './place-visits.node';
import { sourceTypeSchema } from './tag-assignments.node';
import { shareSourceTypeSchema } from './shares.node';
import { EMBEDDING_DIMENSIONS } from '../embeddings';

const key = 'cmrnlzf650002qc7k4p5zem5w';
const otherKey = 'cmrnlzf640001qc7kazsr96k5';
const timestamp = '2026-08-08T12:00:00.000Z';
const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

describe('travel node contracts', () => {
  test('validates places and builds the exact semantic text', () => {
    const place = placeSchema.parse({ key, scopeKey: otherKey, name: ' Tokyo ', latitude: 35.6762, longitude: 139.6503, countryCode: 'jp', country: 'Japan', region: 'Tokyo', city: 'Tokyo', embedding, createdAt: timestamp, updatedAt: timestamp });
    expect(place).toMatchObject({ name: 'Tokyo', countryCode: 'JP', isWishlist: false, isFavorite: false, deletedAt: null });
    expect(buildEmbeddingText(placesEmbeddingFields, place)).toBe('Tokyo\n\nJapan\n\nTokyo\n\nTokyo');
    expect(placeSchema.safeParse({ ...place, latitude: 91 }).success).toBe(false);
    expect(placeSchema.safeParse({ ...place, longitude: -181 }).success).toBe(false);
  });

  test('validates trips without a persisted status', () => {
    const trip = tripSchema.parse({ key, scopeKey: otherKey, name: 'Japan 2027', startDate: '2027-04-01', endDate: '2027-04-20', embedding, createdAt: timestamp, updatedAt: timestamp });
    expect(trip).toMatchObject({ isFavorite: false, deletedAt: null });
    expect(trip).not.toHaveProperty('status');
    expect(buildEmbeddingText(tripsEmbeddingFields, trip)).toBe('Japan 2027');
    expect(tripSchema.safeParse({ ...trip, startDate: '2027-04-20', endDate: '2027-04-01' }).success).toBe(false);
  });

  test('keeps itinerary and visit records embedding-free', () => {
    const relation = tripPlaceSchema.parse({ key, scopeKey: otherKey, tripKey: key, placeKey: otherKey, position: 1, arrivalDate: '2027-04-01', departureDate: '2027-04-03', createdAt: timestamp });
    const visit = placeVisitSchema.parse({ key, scopeKey: otherKey, placeKey: key, arrivedAt: '2024-04-01', departedAt: '2024-04-03', createdAt: timestamp, updatedAt: timestamp });
    expect(relation).not.toHaveProperty('embedding');
    expect(visit).not.toHaveProperty('embedding');
    expect(tripPlaceSchema.safeParse({ ...relation, position: 0 }).success).toBe(false);
    expect(placeVisitSchema.safeParse({ ...visit, arrivedAt: '2024-04-03', departedAt: '2024-04-01' }).success).toBe(false);
  });

  test('extends global source types to places and trips', () => {
    for (const sourceType of ['document', 'image', 'collection', 'place', 'trip'] as const) {
      expect(sourceTypeSchema.parse(sourceType)).toBe(sourceType);
      expect(shareSourceTypeSchema.parse(sourceType)).toBe(sourceType);
    }
  });
});

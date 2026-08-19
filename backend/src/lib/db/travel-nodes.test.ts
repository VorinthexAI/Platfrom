import { describe, expect, test } from 'bun:test';
import { buildEmbeddingText } from './base';
import { placeSchema, placesEmbeddingFields } from './places.node';
import { EMBEDDING_DIMENSIONS } from '../embeddings';

const key = 'cmrnlzf650002qc7k4p5zem5w';
const otherKey = 'cmrnlzf640001qc7kazsr96k5';
const timestamp = '2026-08-08T12:00:00.000Z';
const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

describe('travel node contracts', () => {
  test('validates places and builds the exact semantic text', () => {
    const place = placeSchema.parse({ key, scopeKey: otherKey, name: ' Tokyo ', latitude: 35.6762, longitude: 139.6503, countryCode: 'jp', embedding, createdAt: timestamp });
    expect(place).toEqual({ key, scopeKey: otherKey, name: 'Tokyo', countryCode: 'JP', latitude: 35.6762, longitude: 139.6503, embedding, createdAt: timestamp });
    expect(buildEmbeddingText(placesEmbeddingFields, place)).toBe('Tokyo');
    expect(placeSchema.safeParse({ ...place, latitude: 91 }).success).toBe(false);
    expect(placeSchema.safeParse({ ...place, longitude: -181 }).success).toBe(false);
    expect(placeSchema.safeParse({ ...place, countryCode: 'ZZ' }).success).toBe(false);
    expect(placeSchema.safeParse({ ...place, embedding: embedding.slice(1) }).success).toBe(false);
  });
});

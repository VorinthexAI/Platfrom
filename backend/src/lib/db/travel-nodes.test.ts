import { describe, expect, test } from 'bun:test';
import { placeSchema, placesEmbeddingFields } from './places.node';
import { EMBEDDING_DIMENSIONS } from '../embeddings';
import { buildPlaceEmbeddingText, buildTripEmbeddingText, TRIP_EMBEDDING_CONTENT_VERSION } from '../travel/semantic-text';
import { tripSchema } from './trips.node';
import { tripPlaceSchema } from './trip-places.node';
import { tripAttachmentSchema } from './trip-attachments.node';
import { tripCreationReceiptSchema } from './trip-creation-receipts.node';
import { generatedDocumentBindingSchema } from './generated-document-bindings.node';

const key = 'cmrnlzf650002qc7k4p5zem5w';
const otherKey = 'cmrnlzf640001qc7kazsr96k5';
const timestamp = '2026-08-08T12:00:00.000Z';
const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

describe('travel node contracts', () => {
  test('validates places and builds the exact semantic text', () => {
    const place = placeSchema.parse({ key, userKey: key, scopeKey: otherKey, saved: false, name: ' Tokyo ', summary: ' Temples and gardens. ', latitude: 35.6762, longitude: 139.6503, countryCode: 'jp', embedding, embeddingContentVersion: 2, openedAt: timestamp, createdAt: timestamp });
    expect(place).toEqual({ key, userKey: key, scopeKey: otherKey, saved: false, status: 'wishlist', isFavorite: false, name: 'Tokyo', summary: ' Temples and gardens. ', countryCode: 'JP', latitude: 35.6762, longitude: 139.6503, embedding, embeddingContentVersion: 2, openedAt: timestamp, createdAt: timestamp });
    expect(placesEmbeddingFields).toEqual(['name', 'summary']);
    expect(buildPlaceEmbeddingText(place)).toBe('Tokyo:  Temples and gardens. ');
    expect(placeSchema.safeParse({ ...place, latitude: 91 }).success).toBe(false);
    expect(placeSchema.safeParse({ ...place, longitude: -181 }).success).toBe(false);
    expect(placeSchema.safeParse({ ...place, countryCode: 'ZZ' }).success).toBe(false);
    expect(placeSchema.safeParse({ ...place, embedding: embedding.slice(1) }).success).toBe(false);
    expect(placeSchema.safeParse({ ...place, openedAt: 'client-owned-garbage' }).success).toBe(false);
  });
  test('validates private trip documents with rollout-compatible semantic fields', () => {
    const trip = tripSchema.parse({ key, userKey: key, scopeKey: otherKey, name: ' Japan ', description: ' Spring route ', createdAt: timestamp, deletedAt: timestamp, embedding, embeddingContentVersion: TRIP_EMBEDDING_CONTENT_VERSION });
    expect(trip).toEqual({ key, userKey: key, scopeKey: otherKey, name: 'Japan', description: 'Spring route', status: 'planned', isFavorite: false, embedding, embeddingContentVersion: 1, createdAt: timestamp });
    expect(buildTripEmbeddingText(trip)).toBe('Japan\n\nSpring route');
    expect(tripSchema.safeParse({ ...trip, embeddingContentVersion: undefined }).success).toBe(false);
    expect(tripSchema.safeParse({ key, userKey: key, scopeKey: otherKey, name: 'Legacy', createdAt: timestamp }).success).toBe(true);
    expect(tripSchema.safeParse({ ...trip, description: ' ' }).success).toBe(false);
    const relation = tripPlaceSchema.parse({ key, scopeKey: otherKey, tripKey: key, placeKey: otherKey, position: 0, createdAt: timestamp, embedding });
    expect(relation).toEqual({ key, scopeKey: otherKey, tripKey: key, placeKey: otherKey, position: 0, createdAt: timestamp });
    expect(tripPlaceSchema.safeParse({ ...relation, position: -1 }).success).toBe(false);
    const attachment = tripAttachmentSchema.parse({ key, scopeKey: otherKey, tripKey: key, targetType: 'collection', targetKey: otherKey, position: 0, createdAt: timestamp, copiedName: 'Do not persist' });
    expect(attachment).toEqual({ key, scopeKey: otherKey, tripKey: key, targetType: 'collection', targetKey: otherKey, position: 0, createdAt: timestamp });
    expect(tripCreationReceiptSchema.parse({ key, scopeKey: otherKey, userKey: key, tripKey: key, requestHash: 'a'.repeat(64), createdAt: timestamp })).toEqual({ key, scopeKey: otherKey, userKey: key, tripKey: key, requestHash: 'a'.repeat(64), createdAt: timestamp });
    expect(tripCreationReceiptSchema.safeParse({ key, scopeKey: otherKey, userKey: key, tripKey: key, requestHash: 'a'.repeat(64), createdAt: timestamp, identity: key }).success).toBe(false);
    expect(tripAttachmentSchema.safeParse({ ...attachment, targetType: 'file' }).success).toBe(false);
    expect(tripAttachmentSchema.safeParse({ ...attachment, position: -1 }).success).toBe(false);
  });
  test('validates the product-neutral generated-document binding', () => {
    const binding = generatedDocumentBindingSchema.parse({ key, scopeKey: otherKey, documentKey: key, subjectType: 'place', subjectKey: key, kind: 'brief', provenance: 'generated', createdByKey: key, idempotencyKey: 'request-1', requestHash: 'a'.repeat(64), createdAt: timestamp, updatedAt: timestamp, _rev: 'ignored' });
    expect(binding).not.toHaveProperty('_rev');
    expect(generatedDocumentBindingSchema.safeParse({ ...binding, kind: 'report' }).success).toBe(false);
    expect(generatedDocumentBindingSchema.safeParse({ ...binding, requestHash: 'invalid' }).success).toBe(false);
  });
  test('hard-deleting a place also removes its trip relations', async () => {
    const source = await Bun.file(new URL('./places.node.ts', import.meta.url)).text();
    expect(source).toContain("write: [PLACES_COLLECTION, 'placeImages', 'tripPlaces', 'generatedDocumentBindings']");
    expect(source).toContain('FOR relation IN tripPlaces FILTER relation.placeKey == @key REMOVE relation IN tripPlaces');
    expect(source).toContain('FOR binding IN generatedDocumentBindings FILTER binding.subjectType == "place" && binding.subjectKey == @key REMOVE binding IN generatedDocumentBindings');
  });
});

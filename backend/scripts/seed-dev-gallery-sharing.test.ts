import { describe, expect, test } from 'bun:test';
import { assertDevLocalArango, buildGallerySharingFixturePlan, buildOwnedCollectionFixturePlan, deterministicGalleryFixtureKey, SHARED_COLLECTION_FIXTURES } from './seed-dev-gallery-sharing-fixtures';

const scopeKey = 'cm12345678901234567890123';

describe('dev Gallery collaboration fixture helpers', () => {
  test('creates stable cuid-shaped keys and tokens', () => {
    expect(deterministicGalleryFixtureKey(scopeKey, 'user', 'avery')).toBe(deterministicGalleryFixtureKey(scopeKey, 'user', 'avery'));
    expect(deterministicGalleryFixtureKey(scopeKey, 'user', 'avery')).toMatch(/^c[a-f0-9]{24}$/);
    const first = buildOwnedCollectionFixturePlan(scopeKey, 'cm23456789012345678901234');
    expect(first).toEqual(buildOwnedCollectionFixturePlan(scopeKey, 'cm23456789012345678901234'));
    expect(first.viewerToken.length).toBeGreaterThanOrEqual(32);
    expect(first.viewerToken).not.toBe(first.collaboratorToken);
  });

  test('allows only non-production loopback ArangoDB endpoints', () => {
    expect(() => assertDevLocalArango({ ARANGO_URL: 'http://localhost:8529', NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertDevLocalArango({ ARANGO_URL: 'http://127.0.0.1:8529' })).not.toThrow();
    expect(() => assertDevLocalArango({ ARANGO_URL: 'https://db.example.com:8529' })).toThrow('local ArangoDB');
    expect(() => assertDevLocalArango({ ARANGO_URL: 'http://localhost:8529', NODE_ENV: 'production' })).toThrow('production');
    expect(() => assertDevLocalArango({})).toThrow('valid local');
  });

  test('plans two fake-owned collections with both Shared tab roles', () => {
    const plan = buildGallerySharingFixturePlan(scopeKey);
    expect(SHARED_COLLECTION_FIXTURES.length).toBeGreaterThanOrEqual(2);
    expect(plan.collections.map(({ oscarRole }) => oscarRole).sort()).toEqual(['collaborator', 'viewer']);
    expect(new Set(plan.identities.map(({ userKey }) => userKey)).size).toBe(plan.identities.length);
    expect(new Set(plan.collections.map(({ collectionKey }) => collectionKey)).size).toBe(plan.collections.length);
  });
});

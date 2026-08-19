import { describe, expect, test } from 'bun:test';
import { assertDevLocalArango, buildGallerySharingFixturePlan, buildOwnedCollectionFixturePlan, buildSharedCollectionPlacementPlan, deterministicGalleryFixtureKey, SHARED_COLLECTION_FIXTURES } from './seed-dev-gallery-sharing-fixtures';

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

  test('deterministically distributes unique placements across sources and Shared collections', () => {
    const fixture = buildGallerySharingFixturePlan(scopeKey);
    const targets = fixture.collections.map(({ collectionKey, ownerMembershipKey }) => ({ collectionKey, ownerMembershipKey }));
    const sourceA = 'cm34567890123456789012345', sourceB = 'cm45678901234567890123456';
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      imageKey: `cm${String(index + 1).padStart(23, '0')}`,
      sourceCollectionKey: index % 2 === 0 ? sourceA : sourceB,
    }));
    const first = buildSharedCollectionPlacementPlan(scopeKey, targets, candidates);
    expect(first).toEqual(buildSharedCollectionPlacementPlan(scopeKey, [...targets].reverse().reverse(), [...candidates].reverse()));
    expect(first.map(({ placements }) => placements.length)).toEqual([4, 4]);
    expect(new Set(first.flatMap(({ placements }) => placements.map(({ imageKey }) => imageKey))).size).toBe(8);
    expect(first.every(({ placements }) => new Set(placements.map(({ sourceCollectionKey }) => sourceCollectionKey)).size === 2)).toBe(true);
    expect(first.flatMap(({ placements }) => placements.map(({ key }) => key)).every((key) => /^c[a-f0-9]{24}$/.test(key))).toBe(true);
  });

  test('safely shares a limited image pool without duplicate placements', () => {
    const fixture = buildGallerySharingFixturePlan(scopeKey);
    const targets = fixture.collections.map(({ collectionKey, ownerMembershipKey }) => ({ collectionKey, ownerMembershipKey }));
    const imageKey = 'cm00000000000000000000001';
    const plan = buildSharedCollectionPlacementPlan(scopeKey, targets, [{ imageKey, sourceCollectionKey: null }, { imageKey, sourceCollectionKey: null }]);
    expect(plan.map(({ placements }) => placements.length)).toEqual([1, 0]);
    expect(plan.flatMap(({ placements }) => placements.map((placement) => placement.imageKey))).toEqual([imageKey]);
  });
});

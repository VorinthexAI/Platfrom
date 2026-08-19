import { describe, expect, test } from 'bun:test';
import {
  assertGalleryLocationFixtureEnvironment, buildGalleryLocationFixturePlan, GALLERY_LOCATION_FIXTURE_EMAIL,
  galleryLocationFixtureKey, parseGalleryLocationFixtureArgs,
} from './seed-dev-gallery-locations-fixtures';

const scopeKey = 'cm12345678901234567890123';

describe('dev Gallery location fixtures', () => {
  test('requires an explicit run id and defaults to dry-run', () => {
    expect(parseGalleryLocationFixtureArgs(['--run-id=map-check'])).toEqual({ runId: 'map-check', mode: 'dry-run', includeDuplicates: false });
    expect(parseGalleryLocationFixtureArgs(['--run-id=map-check', '--execute', '--duplicates'])).toEqual({ runId: 'map-check', mode: 'execute', includeDuplicates: true });
    expect(parseGalleryLocationFixtureArgs(['--run-id=map-check', '--cleanup'])).toEqual({ runId: 'map-check', mode: 'cleanup', includeDuplicates: false });
    expect(() => parseGalleryLocationFixtureArgs([])).toThrow('run-id');
    expect(() => parseGalleryLocationFixtureArgs(['--run-id=map-check', '--execute', '--cleanup'])).toThrow('only one');
    expect(() => parseGalleryLocationFixtureArgs(['--run-id=map-check', '--force'])).toThrow('Unknown');
  });

  test('allows only non-production loopback Arango and S3 with the dev bucket', () => {
    const safe = { NODE_ENV: 'development', ARANGO_URL: 'http://127.0.0.1:8529', S3_ENDPOINT_URL: 'http://localhost:4566', S3_BUCKET: 'vorinthex-dev' };
    expect(() => assertGalleryLocationFixtureEnvironment(safe)).not.toThrow();
    expect(() => assertGalleryLocationFixtureEnvironment({ ...safe, NODE_ENV: 'production' })).toThrow('production');
    expect(() => assertGalleryLocationFixtureEnvironment({ ...safe, ARANGO_URL: 'https://db.example.com' })).toThrow('loopback');
    expect(() => assertGalleryLocationFixtureEnvironment({ ...safe, S3_ENDPOINT_URL: 'https://s3.amazonaws.com' })).toThrow('loopback');
    expect(() => assertGalleryLocationFixtureEnvironment({ ...safe, S3_BUCKET: 'vorinthex-prod' })).toThrow('vorinthex-dev');
  });

  test('builds isolated deterministic ids, locations, scores, and an optional known duplicate', () => {
    const first = buildGalleryLocationFixturePlan(scopeKey, 'map-check', true);
    expect(first).toEqual(buildGalleryLocationFixturePlan(scopeKey, 'map-check', true));
    expect(first.email).toBe(GALLERY_LOCATION_FIXTURE_EMAIL);
    expect(first.collection.description).toContain('Development Gallery location fixture:map-check');
    expect(first.images).toHaveLength(21);
    expect(new Set(first.images.map(({ countryCode }) => countryCode)).size).toBe(20);
    expect(new Set(first.images.map(({ key }) => key)).size).toBe(first.images.length);
    expect(new Set(first.images.map(({ placementKey }) => placementKey)).size).toBe(first.images.length);
    expect(new Set(first.images.map(({ captionScore }) => captionScore)).size).toBeGreaterThan(3);
    expect(first.images.every(({ latitude, longitude, city, country, countryCode }) => Number.isFinite(latitude) && Number.isFinite(longitude) && Boolean(city && country && countryCode))).toBe(true);
    const duplicate = first.images.find(({ duplicateOf }) => duplicateOf);
    expect(duplicate?.duplicateOf).toBe('stockholm-waterfront');
    expect(duplicate?.captionKey).toBe(first.images.find(({ slug }) => slug === duplicate?.duplicateOf)?.captionKey);
    expect(galleryLocationFixtureKey(scopeKey, 'map-check', 'image', 'one')).not.toBe(galleryLocationFixtureKey(scopeKey, 'other-run', 'image', 'one'));
  });

  test('uses canonical image and Gallery deletion paths', async () => {
    const source = await Bun.file(new URL('./seed-dev-gallery-locations.ts', import.meta.url)).text();
    expect(source).toContain('processImage({');
    expect(source).toContain('repository.createCollection(collection, member)');
    expect(source).toContain('repository.addImageToCollection(relation)');
    expect(source).toContain('galleryOperations.deleteImages');
    expect(source).toContain('galleryOperations.deleteCollection');
    expect(source).toContain('Synthetic Gallery QA image');
    expect(source).toContain('Gallery location fixture creation and compensation failed.');
    expect(source).not.toContain('imageCaptionTool');
    expect(source).toContain('createdByKey');
    expect(source).not.toContain('DEV_SEED_EMAIL');
    expect(source).not.toMatch(/REMOVE .* IN images/);
  });
});

import { expect, test } from 'bun:test';
import { canonicalSeedMigration } from './migrations/0018-canonical-seed';

test('preserves the applied canonical seed migration and its checksummed dependencies', async () => {
  // Recorded inputs from successful production release 80363bd1. Changes to
  // runtime response contracts must not silently alter this applied migration.
  expect(await canonicalSeedMigration.checksum()).toBe('1fce316682d3730c35f0ced776c20718ac802a4f9220ff0cb03b505d9cbd451c');
});

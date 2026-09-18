import { expect, test } from 'bun:test';
import { graphMigrations } from '.';
import { seedCountryEmbeddingsMigration } from './0016-country-embeddings';

test('registers country embedding seeding as the latest graph migration', () => {
  expect(graphMigrations.at(-1)).toBe(seedCountryEmbeddingsMigration);
  expect(seedCountryEmbeddingsMigration.id).toBe('0016-country-embeddings');
});

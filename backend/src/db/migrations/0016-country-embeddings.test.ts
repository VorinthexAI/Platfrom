import { expect, test } from 'bun:test';
import { graphMigrations } from '.';
import { seedCountryEmbeddingsMigration } from './0016-country-embeddings';

test('registers country embedding seeding as a graph migration', () => {
  expect(graphMigrations.find(({ id }) => id === seedCountryEmbeddingsMigration.id)).toBe(seedCountryEmbeddingsMigration);
  expect(seedCountryEmbeddingsMigration.id).toBe('0016-country-embeddings');
});

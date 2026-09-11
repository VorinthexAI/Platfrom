import { expect, test } from 'bun:test';
import { graphMigrations } from '.';
import { retireNavigationVisits, retireNavigationVisitsMigration } from './0012-retire-navigation-visits';

test('drops retired navigation visits and registers the migration', async () => {
  let dropped = false;
  const collection = { exists: async () => true, drop: async () => { dropped = true; } };

  await retireNavigationVisits({
    collection: (name: string) => {
      expect(name).toBe('navigationVisits');
      return collection;
    },
  } as never);

  expect(dropped).toBe(true);
  expect(graphMigrations.find(({ id }) => id === retireNavigationVisitsMigration.id)).toBe(retireNavigationVisitsMigration);
});

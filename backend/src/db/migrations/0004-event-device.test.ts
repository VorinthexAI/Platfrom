import { expect, test } from 'bun:test';
import { addEventDevice } from './0004-event-device';

test('backfills legacy events with nullable device attribution', async () => {
  const queries: string[] = [];
  await addEventDevice({ query: async (query: string) => { queries.push(query); } } as never);
  expect(queries).toEqual(['FOR event IN events FILTER !HAS(event, "device") UPDATE event WITH { device: null } IN events']);
});

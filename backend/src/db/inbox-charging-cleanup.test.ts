import { expect, test } from 'bun:test';
import { dropRetiredInboxChargingCollections } from './arango-migrate';

test('drops only retired hourly inbox billing collections and preserves the Spark ledger', async () => {
  const requested: string[] = [];
  const dropped: string[] = [];
  await dropRetiredInboxChargingCollections({
    collection(name: string) {
      requested.push(name);
      return { exists: async () => name !== 'inboxChargingMeters', drop: async () => { dropped.push(name); } };
    },
  } as never);
  expect(requested).toEqual(['inboxBillingPeriods', 'inboxChargingHours', 'inboxChargingMeters']);
  expect(dropped).toEqual(['inboxBillingPeriods', 'inboxChargingHours']);
  expect(requested).not.toContain('sparkTransactions');
});

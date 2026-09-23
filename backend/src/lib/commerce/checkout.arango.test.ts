import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Database } from 'arangojs';
import { newId } from '@/lib/ids';
import { toArangoDoc } from '@/lib/db/base';
import { createArangoCommerceRepository } from './repository';
import { COMMERCE_CATALOG } from './catalog';

const liveArangoSuite = process.env.ARANGO_URL && process.env.ARANGO_USERNAME && process.env.ARANGO_ROOT_PASSWORD !== undefined ? describe : describe.skip;

liveArangoSuite('checkout claims live Arango', () => {
  test('claims, replays, rejects conflicting keys and prevents concurrent subscription checkouts', async () => {
    const name = `checkout_${randomUUID().replaceAll('-', '')}`;
    const root = new Database({ url: process.env.ARANGO_URL!, auth: { username: process.env.ARANGO_USERNAME!, password: process.env.ARANGO_ROOT_PASSWORD! } });
    await root.createDatabase(name);
    const database = root.database(name);
    try {
      for (const collection of ['users', 'products', 'subscriptions', 'paymentCheckouts']) await database.createCollection(collection);
      const userKey = newId();
      await database.collection('users').save(toArangoDoc({ key: userKey }));
      const product = COMMERCE_CATALOG.find(({ type }) => type === 'subscription')!;
      await database.collection('products').save(toArangoDoc(product));
      const repository = createArangoCommerceRepository(database);
      const at = new Date().toISOString();
      const input = { key: newId(), userKey, productKey: product.key, idempotencyKey: randomUUID(), requestHash: 'a'.repeat(64), status: 'pending' as const, providerCheckoutId: null, checkoutUrl: null, failureCode: null, createdAt: at, updatedAt: at };
      expect((await repository.claimCheckout(input)).status).toBe('claimed');
      expect((await repository.claimCheckout(input)).status).toBe('pending');
      expect((await repository.claimCheckout({ ...input, requestHash: 'b'.repeat(64) })).status).toBe('conflict');
      await repository.completeCheckout(input.key, 'diagnostic-checkout', 'https://checkout.polar.sh/diagnostic', at);
      expect((await repository.claimCheckout(input)).status).toBe('replayed');
      expect((await repository.claimCheckout({ ...input, key: newId(), idempotencyKey: randomUUID() })).status).toBe('subscription_exists');
      await repository.failCheckout(input.key, 'diagnostic', at);
      const results = await Promise.all([1, 2].map(() => repository.claimCheckout({ ...input, key: newId(), idempotencyKey: randomUUID() })));
      expect(results.map(({ status }) => status).sort()).toEqual(['claimed', 'subscription_exists']);
      expect((await repository.claimCheckout({ ...input, userKey: newId() })).status).toBe('account_missing');
    } finally {
      await root.dropDatabase(name);
      database.close();
      root.close();
    }
  }, 20_000);
});

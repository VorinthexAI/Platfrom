import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Database } from 'arangojs';
import { withDatabaseTransaction } from '@/lib/db/client';
import { createAppNotificationRepository } from './repository';
import { decryptPushToken, pushTokenHash } from './token-crypto';

const liveArangoSuite = process.env.ARANGO_URL && process.env.ARANGO_USERNAME && process.env.ARANGO_ROOT_PASSWORD !== undefined ? describe : describe.skip;

liveArangoSuite('push registration live Arango', () => {
  test('registers, rotates, transfers, serializes and rolls back token ownership atomically', async () => {
    const name = `push_registration_${randomUUID().replaceAll('-', '')}`;
    const root = new Database({ url: process.env.ARANGO_URL!, auth: { username: process.env.ARANGO_USERNAME!, password: process.env.ARANGO_ROOT_PASSWORD! } });
    const previousKey = process.env.EXPO_PUSH_TOKEN_ENCRYPTION_KEY;
    await root.createDatabase(name);
    const database = root.database(name);
    try {
      process.env.EXPO_PUSH_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
      await database.createCollection('pushSubscriptions');
      await database.collection('pushSubscriptions').ensureIndex({ type: 'persistent', fields: ['tokenHash'], unique: true });
      await database.collection('pushSubscriptions').ensureIndex({ type: 'persistent', fields: ['userKey', 'installationKey'], unique: true });
      const repository = createAppNotificationRepository(database);
      const input = { token: 'ExpoPushToken[first]', projectId: randomUUID(), platform: 'android' as const };
      const rows = async () => (await database.query<{ key: string; userKey: string; installationKey: string; tokenHash: string; tokenCiphertext: string }>('FOR item IN pushSubscriptions RETURN { key: item._key, userKey: item.userKey, installationKey: item.installationKey, tokenHash: item.tokenHash, tokenCiphertext: item.tokenCiphertext }')).all();

      const first = await repository.register('user-one', 'install-one', input);
      expect(await repository.register('user-one', 'install-one', input)).toEqual(first);
      expect(await rows()).toHaveLength(1);
      expect(decryptPushToken((await rows())[0]!.tokenCiphertext)).toBe(input.token);

      const rotated = { ...input, token: 'ExpoPushToken[rotated]' };
      expect(await repository.register('user-one', 'install-one', rotated)).toEqual(first);
      expect((await rows())[0]!.tokenHash).toBe(pushTokenHash(rotated.token));

      // A second account already has its own token; moving the first account's
      // token must replace that token while preserving the destination record.
      const second = await repository.register('user-two', 'install-two', input);
      expect(await repository.register('user-two', 'install-two', rotated)).toEqual(second);
      expect(await rows()).toEqual([expect.objectContaining({ key: second.key, userKey: 'user-two', tokenHash: pushTokenHash(rotated.token) })]);
      const moved = await repository.register('user-three', 'install-three', rotated);
      expect(await rows()).toEqual([expect.objectContaining({ key: moved.key, userKey: 'user-three' })]);

      await Promise.all([
        repository.register('user-four', 'install-four', rotated),
        repository.register('user-five', 'install-five', rotated),
      ]);
      const beforeFailure = await rows();
      expect(beforeFailure).toHaveLength(1);
      expect(beforeFailure[0]!.tokenHash).toBe(pushTokenHash(rotated.token));

      const failing = createAppNotificationRepository(database, (operation) => withDatabaseTransaction(database, { write: ['pushSubscriptions'], exclusive: ['pushSubscriptions'] }, async (transaction) => {
        let calls = 0;
        const query = ((source: string, bindVars?: Record<string, unknown>) => {
          if (++calls === 2) throw new Error('injected failure after token removal');
          return transaction.query(source, bindVars);
        }) as typeof database.query;
        return operation({ query });
      }));
      await expect(failing.register('user-six', 'install-six', rotated)).rejects.toThrow('injected failure');
      expect(await rows()).toEqual(beforeFailure);
      expect(await repository.unregister(beforeFailure[0]!.userKey, beforeFailure[0]!.installationKey)).toEqual({ removed: true });
      expect(await rows()).toEqual([]);
    } finally {
      if (previousKey === undefined) delete process.env.EXPO_PUSH_TOKEN_ENCRYPTION_KEY;
      else process.env.EXPO_PUSH_TOKEN_ENCRYPTION_KEY = previousKey;
      await root.dropDatabase(name);
      database.close();
      root.close();
    }
  }, 20_000);
});

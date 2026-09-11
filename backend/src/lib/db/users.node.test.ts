import { describe, expect, test } from 'bun:test';
import { countryCodeSchema, initializeUserNameIfMissing, userSchema } from './users.node';

const baseUser = {
  key: 'usr_test',
  currentScopeKey: 'cm1234567890123456789012345',
  email: 'user@example.com',
  emailHash: 'a'.repeat(64),
  createdAt: '2026-07-08T00:00:00.000Z',
  updatedAt: '2026-07-08T00:00:00.000Z',
};

describe('user node schema', () => {
  test('defaults the durable account deletion fence to inactive', () => {
    expect(userSchema.parse(baseUser).deletionRequestedAt).toBeNull();
    expect(userSchema.parse({ ...baseUser, deletionRequestedAt: '2026-09-06T10:00:00.000Z' }).deletionRequestedAt).toBe('2026-09-06T10:00:00.000Z');
  });
  test('requires a current scope key', () => {
    expect(() => userSchema.parse({ ...baseUser, currentScopeKey: undefined })).toThrow();
  });

  test('stores balances as safe integer microSparks', () => {
    expect(userSchema.parse(baseUser).microSparkBalance).toBe(0);
    expect(() => userSchema.parse({ ...baseUser, microSparkBalance: 0.5 })).toThrow();
    expect(() => userSchema.parse({ ...baseUser, microSparkBalance: -1 })).toThrow();
    expect(() => userSchema.parse({ ...baseUser, microSparkBalance: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  });

  test('accepts ISO alpha-2 country codes and rejects arbitrary values', () => {
    expect(countryCodeSchema.parse('SE')).toBe('SE');
    expect(() => countryCodeSchema.parse('SWE')).toThrow();
    expect(() => countryCodeSchema.parse('ZZ')).toThrow();
  });

  test('keeps team role and MFA fields off ordinary users', () => {
    const user = userSchema.parse(baseUser);

    expect(user.isOnboarded).toBe(false);
    expect('settings' in user).toBe(false);

    expect('team_role' in user).toBe(false);
    expect('team_title' in user).toBe(false);
    expect('isMfaEnabled' in user).toBe(false);
    expect('has_request_mfa_reset_link' in user).toBe(false);
    expect('totpSecret' in user).toBe(false);
    expect('lastTotpTimeStep' in user).toBe(false);
    expect('requested_mfa_reset_link_at' in user).toBe(false);
  });

  test('strips the retired settings blob', () => {
    expect(userSchema.parse({ ...baseUser, settings: { archive: { showOnlyFavorites: true } } })).not.toHaveProperty('settings');
  });

  test('hard deletion atomically removes user generation and private commerce history', async () => {
    const source = await Bun.file(new URL('./users.node.ts', import.meta.url)).text();
    expect(source).toContain("'checkoutHandoffs', 'paymentCheckouts', 'paymentOrders', 'subscriptions'");
    expect(source).toContain('FOR tag IN tags FILTER tag.userKey == @userKey REMOVE tag IN tags');
    expect(source.indexOf('REMOVE assignment IN tagAssignments')).toBeLessThan(source.indexOf('REMOVE tag IN tags'));
    expect(source).toContain('FOR generation IN userGenerations FILTER generation.userKey == @userKey REMOVE generation IN userGenerations');
    expect(source).toContain('FOR ticket IN tickets FILTER ticket.userKey == @userKey REMOVE ticket IN tickets');
    expect(source).toContain('FOR message IN userInboxMessages FILTER message.userKey == @userKey REMOVE message IN userInboxMessages');
    expect(source).toContain('FOR thread IN userInboxThreads FILTER thread.userKey == @userKey REMOVE thread IN userInboxThreads');
    expect(source).toContain('FOR event IN events FILTER event.userId == @userKey REMOVE event IN events');
    expect(source).toContain('FOR item IN sparkTransactions FILTER item.userKey == @userKey REMOVE item IN sparkTransactions');
    expect(source).toContain('FOR reward IN referralRewards FILTER reward.referrerUserKey == @userKey || reward.referredUserKey == @userKey REMOVE reward IN referralRewards');
    expect(source).toContain('FOR attribution IN referralAttributions FILTER attribution.referrerUserKey == @userKey || attribution.referredUserKey == @userKey REMOVE attribution IN referralAttributions');
    expect(source).toContain('FOR code IN referralCodes FILTER code.ownerUserKey == @userKey REMOVE code IN referralCodes');
    expect(source).toContain('FOR handoff IN checkoutHandoffs FILTER handoff.userKey == @userKey REMOVE handoff IN checkoutHandoffs');
    expect(source).toContain('FOR checkout IN paymentCheckouts FILTER checkout.userKey == @userKey REMOVE checkout IN paymentCheckouts');
    expect(source).toContain('FOR order IN paymentOrders FILTER order.userKey == @userKey REMOVE order IN paymentOrders');
    expect(source).toContain('FOR subscription IN subscriptions FILTER subscription.userKey == @userKey REMOVE subscription IN subscriptions');
    expect(source).toContain('IS_STRING(user.profileStorageKey) UPSERT { storageKey: user.profileStorageKey }');
    expect(source.indexOf('REMOVE generation IN userGenerations')).toBeLessThan(source.indexOf('REMOVE @userKey IN users'));
    expect(source.indexOf('REMOVE message IN userInboxMessages')).toBeLessThan(source.indexOf('REMOVE ticket IN tickets'));
  });
});

describe('OAuth name initialization', () => {
  const timestamp = '2026-09-03T10:00:00.000Z';
  const user = (name: string | null) => userSchema.parse({ ...baseUser, name });

  test('preserves an existing manually edited name without issuing an update', async () => {
    let queried = false;
    const existing = user('Manual Name');
    const result = await initializeUserNameIfMissing(existing.key, 'Provider Name', timestamp, {
      getUser: async () => existing,
      database: { query: async () => { queried = true; throw new Error('must not update'); } } as never,
      embed: async () => { throw new Error('must not embed'); },
    });
    expect(result?.name).toBe('Manual Name');
    expect(queried).toBe(false);
  });

  test('initializes a null name with a conditional database update', async () => {
    const existing = user(null);
    let query = '';
    const result = await initializeUserNameIfMissing(existing.key, '  Provider Name  ', timestamp, {
      getUser: async () => existing,
      embed: async ({ text }) => { expect(text).toContain('Provider Name'); return []; },
      database: { query: async (text: unknown) => {
        query = String(text);
        return { next: async () => ({ ...existing, _key: existing.key, key: undefined, name: 'Provider Name', updatedAt: timestamp }) };
      } } as never,
    });
    expect(query).toContain('user.name == null');
    expect(result?.name).toBe('Provider Name');
  });

  test('returns a concurrent manual edit when the conditional update loses the race', async () => {
    const empty = user(null);
    const edited = user('Manual Name');
    let reads = 0;
    const result = await initializeUserNameIfMissing(empty.key, 'Provider Name', timestamp, {
      getUser: async () => ++reads === 1 ? empty : edited,
      embed: async () => [],
      database: { query: async () => ({ next: async () => undefined }) } as never,
    });
    expect(result?.name).toBe('Manual Name');
    expect(reads).toBe(2);
  });
});

import { describe, expect, test } from 'bun:test';
import { countryCodeSchema, initializeUserNameIfMissing, userSchema } from './users.node';

const baseUser = {
  key: 'usr_test',
  organizationId: 'org_root',
  email: 'user@example.com',
  emailHash: 'a'.repeat(64),
  createdAt: '2026-07-08T00:00:00.000Z',
  updatedAt: '2026-07-08T00:00:00.000Z',
};

describe('user node schema', () => {
  test('accepts ISO alpha-2 country codes and rejects arbitrary values', () => {
    expect(countryCodeSchema.parse('SE')).toBe('SE');
    expect(() => countryCodeSchema.parse('SWE')).toThrow();
    expect(() => countryCodeSchema.parse('ZZ')).toThrow();
  });

  test('keeps organization role and MFA fields off ordinary users', () => {
    const user = userSchema.parse(baseUser);

    expect(user.refreshTokenExpiresAt).toBeNull();
    expect(user.refreshFounderMembershipKey).toBeNull();
    expect(user.refreshFounderMfaVersion).toBeNull();
    expect(user.isOnboarded).toBe(false);
    expect('settings' in user).toBe(false);

    expect('organization_role' in user).toBe(false);
    expect('organization_title' in user).toBe(false);
    expect('isMfaEnabled' in user).toBe(false);
    expect('has_request_mfa_reset_link' in user).toBe(false);
    expect('totpSecret' in user).toBe(false);
    expect('lastTotpTimeStep' in user).toBe(false);
    expect('requested_mfa_reset_link_at' in user).toBe(false);
  });

  test('strips legacy organization and MFA fields', () => {
    const user = userSchema.parse({
      ...baseUser,
      organization_role: 'viewer',
      organization_title: 'Operator',
      isMfaEnabled: true,
      totpSecret: 'secret',
      lastTotpTimeStep: 123,
      is_platform_member: true,
      is_platform_owner: true,
    });

    expect('organization_role' in user).toBe(false);
    expect('organization_title' in user).toBe(false);
    expect('isMfaEnabled' in user).toBe(false);
    expect('totpSecret' in user).toBe(false);
    expect('lastTotpTimeStep' in user).toBe(false);
    expect('is_platform_member' in user).toBe(false);
    expect('is_platform_owner' in user).toBe(false);
  });

  test('strips the retired settings blob', () => {
    expect(userSchema.parse({ ...baseUser, settings: { archive: { showOnlyFavorites: true } } })).not.toHaveProperty('settings');
  });

  test('hard deletion atomically removes user generation history', async () => {
    const source = await Bun.file(new URL('./users.node.ts', import.meta.url)).text();
    expect(source).toContain("withTransaction(['users', 'userHiddens', 'userGenerations', 'conversations', 'conversationMessages', 'ticketVotes', 'tickets', 'events', 'storageDeletionJobs']");
    expect(source).toContain('FOR generation IN userGenerations FILTER generation.userKey == @userKey REMOVE generation IN userGenerations');
    expect(source).toContain('FOR ticket IN tickets FILTER ticket.userKey == @userKey REMOVE ticket IN tickets');
    expect(source).toContain('FILTER vote.userKey == @userKey || vote.ticketKey IN authoredTicketKeys');
    expect(source).toContain('FILTER ticket._key IN MINUS(votedTicketKeys, authoredTicketKeys) && ticket.type == "feedback"');
    expect(source).toContain('upvotes = SUM(vote.vote == "up"');
    expect(source).toContain('FOR event IN events FILTER event.userId == @userKey REMOVE event IN events');
    expect(source).toContain('IS_STRING(user.profileStorageKey) UPSERT { storageKey: user.profileStorageKey }');
    expect(source.indexOf('REMOVE generation IN userGenerations')).toBeLessThan(source.indexOf('REMOVE @userKey IN users'));
    expect(source.indexOf('REMOVE vote IN ticketVotes')).toBeLessThan(source.indexOf('REMOVE ticket IN tickets'));
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

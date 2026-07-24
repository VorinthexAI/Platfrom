import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createScopeMemberRepository, DuplicateScopeMemberError, ScopeMemberOrganizationMismatchError } from './members';
import { SCOPE_MEMBERS_COLLECTION, SCOPES_COLLECTION, SCOPE_MEMBER_ROLES, scopeMemberSchema } from './schema';
import type { ScopesDatabase } from './types';

function createFakeDb() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const store = (name: string) => {
    let docs = stores.get(name);
    if (!docs) {
      docs = new Map();
      stores.set(name, docs);
    }
    return docs;
  };

  const fake: ScopesDatabase = {
    async query(query, bindVars = {}) {
      const members = [...store(SCOPE_MEMBERS_COLLECTION).values()].filter(
        (member) => member.scopeKey === bindVars.scopeKey
          && (!bindVars.userOrganizationKey || member.userOrganizationKey === bindVars.userOrganizationKey),
      );
      if (query.includes('RETURN { member, user }')) {
        const rows = members.flatMap((member) => {
          const membership = store('userOrganizations').get(String(member.userOrganizationKey));
          const user = membership ? store('users').get(String(membership.userId)) : undefined;
          return user ? [{ member, user }] : [];
        });
        return { all: async () => rows, next: async () => rows[0] };
      }
      return { all: async () => members, next: async () => members[0] };
    },
    collection(name) {
      const docs = store(name);
      return {
        async save(doc) {
          const duplicate = name === SCOPE_MEMBERS_COLLECTION && [...docs.values()].some(
            (existing) => existing.scopeKey === doc.scopeKey
              && existing.userOrganizationKey === doc.userOrganizationKey,
          );
          if (duplicate) throw Object.assign(new Error('unique constraint violated'), { errorNum: 1210 });
          docs.set(String(doc._key), doc);
          return { new: doc };
        },
        async update(key, patch) {
          const current = docs.get(key);
          if (!current) throw Object.assign(new Error('document not found'), { errorNum: 1202 });
          const updated = { ...current, ...patch };
          docs.set(key, updated);
          return { new: updated };
        },
        async remove(key) {
          if (!docs.delete(key)) throw Object.assign(new Error('document not found'), { errorNum: 1202 });
          return {};
        },
        async document(key) {
          const doc = docs.get(key);
          if (!doc) throw Object.assign(new Error('document not found'), { errorNum: 1202 });
          return doc;
        },
      };
    },
  };

  return { fake, stores };
}

function userOrganizationDoc(key: string, organizationId: string, userId: string) {
  return {
    _key: key,
    organizationId,
    userId,
    orgRole: 'member',
    orgTitle: null,
    status: 'active',
    joinedAt: '2026-07-16T00:00:00.000Z',
    isMfaEnabled: false,
    totpSecret: null,
    lastTotpTimeStep: null,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    embedding: [],
  };
}

function userDoc(key: string, organizationId: string) {
  return {
    _key: key,
    organizationId,
    email: 'oscar@example.com',
    emailHash: 'hash',
    name: 'Oscar',
    profileUrl: 'https://example.com/avatar.png',
    alias: null,
    alias_slug: null,
    waitlistNumber: null,
    isVerified: true,
    is_subscribed_to_updates: true,
    is_subscribed_to_updates_unsubscribe_token_hash: null,
    is_subscribed_to_updates_unsubscribe_requested_at: null,
    refreshTokenHash: null,
    lastLoginAt: null,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    embedding: [],
  };
}

describe('scope member schema', () => {
  test('contains only the normalized membership fields', () => {
    const member = scopeMemberSchema.parse({
      key: newId(),
      scopeKey: newId(),
      userOrganizationKey: newId(),
      role: 'moderator',
      position: 1,
    });
    expect(member).toEqual({
      key: member.key,
      scopeKey: member.scopeKey,
      userOrganizationKey: member.userOrganizationKey,
      role: 'moderator',
      status: 'active',
      source: 'explicit',
    });
    expect(SCOPE_MEMBER_ROLES).toEqual(['owner', 'admin', 'moderator', 'viewer']);
    expect(() => scopeMemberSchema.parse({ ...member, role: 'member' })).toThrow();
  });
});

describe('scope member repository', () => {
  test('enforces organization ownership and unique membership', async () => {
    const { fake, stores } = createFakeDb();
    const repository = createScopeMemberRepository(fake);
    const organizationKey = newId();
    const scopeKey = newId();
    const membershipKey = newId();
    const userKey = newId();
    stores.set(SCOPES_COLLECTION, new Map([[scopeKey, {
      _key: scopeKey,
      organizationKey,
      slug: 'command',
      name: 'Command',
      summary: 'Command scope.',
      description: 'Command scope.',
      position: 2,
      embedding: [],
    }]]));
    stores.set('userOrganizations', new Map([[membershipKey, userOrganizationDoc(membershipKey, organizationKey, userKey)]]));
    stores.set('users', new Map([[userKey, userDoc(userKey, organizationKey)]]));

    const member = await repository.addMember(scopeKey, membershipKey, 'owner');
    expect(member.role).toBe('owner');
    await expect(repository.addMember(scopeKey, membershipKey, 'viewer')).rejects.toBeInstanceOf(DuplicateScopeMemberError);

    const foreignMembershipKey = newId();
    stores.get('userOrganizations')!.set(
      foreignMembershipKey,
      userOrganizationDoc(foreignMembershipKey, newId(), userKey),
    );
    await expect(repository.addMember(scopeKey, foreignMembershipKey, 'viewer')).rejects.toBeInstanceOf(
      ScopeMemberOrganizationMismatchError,
    );

    expect(await repository.listMemberViews(scopeKey)).toEqual([{
      role: 'owner',
      user: {
        key: userKey,
        name: 'Oscar',
        avatar: 'https://example.com/avatar.png',
        email: 'oscar@example.com',
      },
    }]);

    await repository.removeMember(scopeKey, membershipKey);
    expect(await repository.listMembers(scopeKey)).toEqual([]);
  });
});

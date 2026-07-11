import { describe, expect, test } from 'bun:test';
import { userSchema } from '@/lib/db/users.node';
import { defaultNameFromEmail, hashUserEmail, normalizeEmail } from './users';

describe('user helpers', () => {
  test('normalizes email addresses', () => {
    expect(normalizeEmail('  PERSON@Example.COM ')).toBe('person@example.com');
  });

  test('extracts a default first name before dot or at sign', () => {
    expect(defaultNameFromEmail('john.smith@example.com')).toBe('John');
    expect(defaultNameFromEmail('jane@example.com')).toBe('Jane');
  });

  test('hashes normalized email addresses deterministically', async () => {
    const mixedCaseHash = await hashUserEmail('  PERSON@Example.COM ');
    const normalizedHash = await hashUserEmail('person@example.com');

    expect(mixedCaseHash).toBe(normalizedHash);
    expect(normalizedHash).toMatch(/^[a-f0-9]{64}$/);
  });

  // completeOAuthSignIn (backend/src/api/auth.ts) and the magic-link/waitlist
  // flows all resolve users through this same hashUserEmail, then
  // upsertUserByEmail's getUserByEmailHash-before-insert lookup — so an
  // account created via magic link and later signed into via OAuth (or vice
  // versa) with a differently-cased/whitespaced but otherwise identical
  // provider-supplied email resolves to the SAME user, never a duplicate.
  test('an OAuth-provider email hashes identically to a manually-typed magic-link email', async () => {
    const magicLinkEmail = 'person@example.com';
    const googleProfileEmail = ' Person@Example.com ';

    expect(await hashUserEmail(googleProfileEmail)).toBe(await hashUserEmail(magicLinkEmail));
  });

  test('defaults new users to subscribed to updates', () => {
    const user = userSchema.parse({
      key: 'usr_test',
      organizationId: 'org_root',
      email: 'person@example.com',
      emailHash: 'hash',
      createdAt: '2026-07-03T00:00:00.000Z',
      updatedAt: '2026-07-03T00:00:00.000Z',
    });

    expect(user.is_subscribed_to_updates).toBe(true);
    expect(user.is_subscribed_to_updates_unsubscribe_token_hash).toBeNull();
    expect(user.is_subscribed_to_updates_unsubscribe_requested_at).toBeNull();
  });
});

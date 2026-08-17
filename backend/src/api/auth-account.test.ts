import { describe, expect, test } from 'bun:test';
import { buildAuthAccountResponse, guestBootstrapSchema, patchAuthAccountSchema } from './auth-account';

describe('GET /auth/me response contract', () => {
  test('returns safe user and personal Main context without auth secrets', () => {
    const response = buildAuthAccountResponse({
      key: 'user-1', organizationId: 'root', email: 'person@example.com', emailHash: 'secret-hash', countryCode: 'SE',
      name: 'Person', profileUrl: null, alias: 'Nova', alias_slug: null, isVerified: true, isOnboarded: false, guestBootstrapSecretHash: null,
      is_subscribed_to_updates: true, is_subscribed_to_updates_unsubscribe_token_hash: 'unsubscribe-secret',
      is_subscribed_to_updates_unsubscribe_requested_at: null, refreshTokenHash: 'refresh-secret', refreshTokenExpiresAt: null,
      refreshFounderMembershipKey: null, refreshFounderMfaVersion: null, lastLoginAt: null,
      settings: { archive: { showOnlyFavorites: false }, gallery: { showOnlyFavorites: false } },
      createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z', embedding: [],
    }, {
      organization: { key: 'org-1', name: "Person's Organization", is_root: false, slug: 'personal-user-1', description: null, isActive: true, mfa_enabled: false, metadata: {}, createdAt: '', updatedAt: '', embedding: [] },
      membership: { key: 'membership-1', organizationId: 'org-1', userId: 'user-1', orgRole: 'owner', orgTitle: 'Owner', orchestratorKey: null, status: 'active', joinedAt: '', isMfaEnabled: false, totpSecret: null, lastTotpTimeStep: null, mfaVersion: 0, mfaRecoveryPending: false, createdAt: '', updatedAt: '', embedding: [] },
      scope: { key: 'cmrnlzf640000qc7k4p5zem5w', organizationKey: 'org-1', slug: 'main', name: 'Main', summary: 'Main personal workspace', description: 'Main personal workspace', position: 1, level: 1, deletedAt: null, embedding: [] },
      scopeMembership: { key: 'cmrnlzf640000qc7k4p5zem5x', scopeKey: 'cmrnlzf640000qc7k4p5zem5w', userOrganizationKey: 'membership-1', role: 'owner', status: 'active', source: 'explicit' },
      agent: { key: 'cmrnlzf640000qc7k4p5zem5y', slug: 'personal-content-user-1', name: 'Personal Content Agent', title: 'Personal Content Agent', scopeKey: 'cmrnlzf640000qc7k4p5zem5w', explorationRate: 0, embedding: [] },
    });

    expect(response.organization.role).toBe('owner');
    expect(response.main_scope).toMatchObject({ name: 'Main', slug: 'main', role: 'owner' });
    expect(response.user.is_onboarded).toBe(false);
    expect(response.user.settings).toEqual({ archive: { showOnlyFavorites: false }, gallery: { showOnlyFavorites: false } });
    expect(response.content_execution.agent_key).toBe('cmrnlzf640000qc7k4p5zem5y');
    expect(JSON.stringify(response)).not.toContain('refresh-secret');
    expect(JSON.stringify(response)).not.toContain('emailHash');
    expect(JSON.stringify(response)).not.toContain('unsubscribe-secret');
  });
});

describe('mobile guest and onboarding account contracts', () => {
  test('requires separate installation identity and bootstrap proof', () => {
    const input = {
      distinctId: 'app_12345678-1234-4234-9234-123456789012',
      bootstrapSecret: `guest_${'a'.repeat(64)}`,
    };
    expect(guestBootstrapSchema.parse(input)).toEqual(input);
    expect(() => guestBootstrapSchema.parse({ distinctId: input.distinctId })).toThrow();
    expect(() => guestBootstrapSchema.parse({ ...input, extra: true })).toThrow();
  });

  test('allows only the one-way onboarding completion transition', () => {
    expect(patchAuthAccountSchema.parse({ isOnboarded: true })).toEqual({ isOnboarded: true });
    expect(() => patchAuthAccountSchema.parse({ isOnboarded: false })).toThrow();
    expect(() => patchAuthAccountSchema.parse({ isOnboarded: true, role: 'admin' })).toThrow();
  });
});

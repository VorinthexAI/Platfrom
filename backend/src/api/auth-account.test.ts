import { describe, expect, test } from 'bun:test';
import { buildAuthAccountResponse, guestBootstrapSchema, patchAuthAccountSchema } from './auth-account';

describe('GET /auth/me response contract', () => {
  test('returns safe user and personal Main context without auth secrets', async () => {
    const response = await buildAuthAccountResponse({
      key: 'user-1', currentScopeKey: 'cmrnlzf640000qc7k4p5zem5w', microSparkBalance: 0, microSparkDebt: 0, pendingReferralCode: null, email: 'person@example.com', emailHash: 'secret-hash', countryCode: 'SE',
      name: 'Person', profileUrl: null, profileStorageKey: null, alias: 'Nova', alias_slug: null, isVerified: true, isOnboarded: false, guestBootstrapSecretHash: null,
      is_subscribed_to_updates: true, is_subscribed_to_updates_unsubscribe_token_hash: 'unsubscribe-secret',
      is_subscribed_to_updates_unsubscribe_requested_at: null,
      deletionRequestedAt: null, lastLoginAt: null, lastSeenAt: null,
      createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z', embedding: [],
    }, {
      team: { key: 'team-1', name: "Person's Team", is_root: false, slug: 'personal-user-1', description: null, isActive: true, mfa_enabled: false, metadata: {}, createdAt: '', updatedAt: '', embedding: [] },
      membership: { key: 'membership-1', teamKey: 'team-1', userId: 'user-1', teamRole: 'owner', teamTitle: 'Owner', orchestratorKey: null, status: 'active', environmentSeeded: false, joinedAt: '', isMfaEnabled: false, totpSecret: null, lastTotpTimeStep: null, teamMfaVersion: 0, teamMfaRecoveryPending: false, createdAt: '', updatedAt: '', embedding: [] },
      scope: { key: 'cmrnlzf640000qc7k4p5zem5w', teamKey: 'team-1', slug: 'main', name: 'Main', summary: 'Main personal workspace', description: 'Main personal workspace', position: 1, level: 1, embedding: [] },
      scopeMembership: { key: 'cmrnlzf640000qc7k4p5zem5x', scopeKey: 'cmrnlzf640000qc7k4p5zem5w', userTeamKey: 'membership-1', role: 'owner', status: 'active', source: 'explicit' },
    });

    expect(response.teamMembership.role).toBe('owner');
    expect(response.scope).toMatchObject({ name: 'Main', slug: 'main', role: 'owner' });
    expect(response.user.is_onboarded).toBe(false);
    expect(response.teamSelectionEnabled).toBe(false);
    expect(response.user).not.toHaveProperty('settings');
    expect(response).not.toHaveProperty('content_execution');
    expect(JSON.stringify(response)).not.toContain('refresh-secret');
    expect(JSON.stringify(response)).not.toContain('emailHash');
    expect(JSON.stringify(response)).not.toContain('unsubscribe-secret');
  });

  test('returns the account with a null avatar when signed URL projection fails', async () => {
    const user = {
      key: 'user-1', currentScopeKey: 'cmrnlzf640000qc7k4p5zem5w', microSparkBalance: 0, microSparkDebt: 0, pendingReferralCode: null, email: 'person@example.com', emailHash: 'secret-hash', countryCode: 'SE' as const,
      name: 'Person', profileUrl: null, profileStorageKey: 'profiles/user-1/avatar.png', alias: 'Nova', alias_slug: null, isVerified: true, isOnboarded: false, guestBootstrapSecretHash: null,
      is_subscribed_to_updates: true, is_subscribed_to_updates_unsubscribe_token_hash: null, is_subscribed_to_updates_unsubscribe_requested_at: null,
      deletionRequestedAt: null, lastLoginAt: null, lastSeenAt: null,
      createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z', embedding: [],
    };
    const context = {
      team: { key: 'team-1', name: 'Team', is_root: false, slug: 'personal-user-1', description: null, isActive: true, mfa_enabled: false, metadata: {}, createdAt: '', updatedAt: '', embedding: [] },
      membership: { key: 'membership-1', teamKey: 'team-1', userId: 'user-1', teamRole: 'owner' as const, teamTitle: 'Owner', orchestratorKey: null, status: 'active' as const, environmentSeeded: false, joinedAt: '', isMfaEnabled: false, totpSecret: null, lastTotpTimeStep: null, teamMfaVersion: 0, teamMfaRecoveryPending: false, createdAt: '', updatedAt: '', embedding: [] },
      scope: { key: 'cmrnlzf640000qc7k4p5zem5w', teamKey: 'team-1', slug: 'main', name: 'Main', summary: 'Main personal workspace', description: 'Main personal workspace', position: 1, level: 1, embedding: [] },
      scopeMembership: { key: 'cmrnlzf640000qc7k4p5zem5x', scopeKey: 'cmrnlzf640000qc7k4p5zem5w', userTeamKey: 'membership-1', role: 'owner' as const, status: 'active' as const, source: 'explicit' as const },
    };

    await expect(buildAuthAccountResponse(user, context, async () => { throw new Error('signer unavailable'); })).resolves.toMatchObject({ user: { name: 'Person', avatar_url: null } });
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

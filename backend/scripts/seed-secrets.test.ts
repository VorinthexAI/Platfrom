import { describe, expect, test } from 'bun:test';
import { enforceRootTeamMfa, ensureSeededActiveRootMembersVerified, type SeedVerificationDataSource } from './seed-verification';

describe('secret seed roster reconciliation', () => {
  test('only deactivates non-seeded memberships when explicitly enabled', async () => {
    const source = await Bun.file(new URL('./seed-secrets.ts', import.meta.url)).text();
    expect(source).toContain("process.env.SYNC_SEEDED_TEAM_ROSTER === 'true'");
    expect(source).toContain('membership.userId NOT IN @userKeys');
    expect(source).toContain('status: "inactive"');
    expect(source).toContain('environmentSeeded: true');
    expect(source).toContain('environmentSeeded: false');
    expect(source).toContain('mainScopeKey: existing ? undefined : String(resolved.currentScopeKey)');
  });

  test('defers only normalized retryable provider outages', async () => {
    const source = await Bun.file(new URL('./seed-secrets.ts', import.meta.url)).text();
    expect(source).toContain("import { isProviderError } from '@/lib/ai/providers/errors';");
    expect(source).toContain('if (!isProviderError(error) || !error.retryable) throw error;');
    expect(source).toContain('Secret seed deferred because');
  });

  test('reuses built-in tone identity after personal workspace provisioning', async () => {
    const source = await Bun.file(new URL('./seed-secrets.ts', import.meta.url)).text();
    expect(source).toContain("nodeName !== 'emailTones'");
    expect(source).toContain('document.scopeKey == @scopeKey && document.slug == @slug');
    expect(source).toContain('key: scopedIdentity.key');
  });
});

describe('secret seed founder verification', () => {
  test('forces MFA on root team documents without changing ordinary teams', () => {
    expect(enforceRootTeamMfa({ is_root: true, mfa_enabled: false })).toEqual({ is_root: true, mfa_enabled: true });
    expect(enforceRootTeamMfa({ is_root: false, mfa_enabled: false })).toEqual({ is_root: false, mfa_enabled: false });
  });

  test('verifies seeded active root members without changing unrelated seed users or account state', async () => {
    const users = new Map([
      ['seeded-founder', { isVerified: false, refreshTokenHash: 'keep-session' }],
      ['seeded-ordinary', { isVerified: false, refreshTokenHash: 'keep-ordinary-session' }],
      ['unseeded-founder', { isVerified: false, refreshTokenHash: 'keep-unseeded-session' }],
    ]);
    const memberships = [
      { userId: 'seeded-founder', root: true, status: 'active' },
      { userId: 'seeded-ordinary', root: false, status: 'active' },
      { userId: 'unseeded-founder', root: true, status: 'active' },
    ];
    const source: SeedVerificationDataSource = {
      async listActiveRootMemberUserKeys(seededUserKeys) {
        return memberships
          .filter((membership) => seededUserKeys.includes(membership.userId) && membership.root && membership.status === 'active')
          .map((membership) => membership.userId);
      },
      async markUsersVerified(userKeys) {
        for (const key of userKeys) users.get(key)!.isVerified = true;
      },
    };

    expect(await ensureSeededActiveRootMembersVerified(
      ['seeded-founder', 'seeded-ordinary'],
      '2026-09-06T00:00:00.000Z',
      source,
    )).toEqual(['seeded-founder']);
    expect(users.get('seeded-founder')).toEqual({ isVerified: true, refreshTokenHash: 'keep-session' });
    expect(users.get('seeded-ordinary')).toEqual({ isVerified: false, refreshTokenHash: 'keep-ordinary-session' });
    expect(users.get('unseeded-founder')).toEqual({ isVerified: false, refreshTokenHash: 'keep-unseeded-session' });
  });

  test('does not verify a seeded founder whose root membership is inactive', async () => {
    let marked: readonly string[] = ['not-called'];
    const source: SeedVerificationDataSource = {
      async listActiveRootMemberUserKeys() { return []; },
      async markUsersVerified(userKeys) { marked = userKeys; },
    };

    expect(await ensureSeededActiveRootMembersVerified(['suspended-founder'], new Date().toISOString(), source)).toEqual([]);
    expect(marked).toEqual(['not-called']);
  });
});

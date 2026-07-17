import { describe, expect, test } from 'bun:test';
import { highestRole, resolveEffectiveScopeRole, roleAtLeast, roleRank, scopeAuthorityForOrgRole } from './roles';

describe('canonical role ranking', () => {
  test('owner > admin > moderator > viewer', () => {
    expect(roleRank.owner).toBeGreaterThan(roleRank.admin);
    expect(roleRank.admin).toBeGreaterThan(roleRank.moderator);
    expect(roleRank.moderator).toBeGreaterThan(roleRank.viewer);
  });

  test('roleAtLeast compares along the single hierarchy', () => {
    expect(roleAtLeast('owner', 'viewer')).toBe(true);
    expect(roleAtLeast('admin', 'admin')).toBe(true);
    expect(roleAtLeast('moderator', 'admin')).toBe(false);
    expect(roleAtLeast('viewer', 'moderator')).toBe(false);
  });

  test('highestRole picks the strongest defined role and ignores gaps', () => {
    expect(highestRole('moderator', 'admin')).toBe('admin');
    expect(highestRole(null, 'viewer', undefined)).toBe('viewer');
    expect(highestRole(null, undefined)).toBeNull();
  });

  test('organization stewardship maps to scope authority only for owner and admin', () => {
    expect(scopeAuthorityForOrgRole('owner')).toBe('owner');
    expect(scopeAuthorityForOrgRole('admin')).toBe('admin');
    expect(scopeAuthorityForOrgRole('member')).toBeNull();
    expect(scopeAuthorityForOrgRole('viewer')).toBeNull();
  });
});

describe('resolveEffectiveScopeRole', () => {
  test('organization owner remains owner in every scope', () => {
    expect(resolveEffectiveScopeRole({ userOrganization: { orgRole: 'owner', status: 'active' }, scopeMember: null })).toBe('owner');
    expect(resolveEffectiveScopeRole({ userOrganization: { orgRole: 'owner', status: 'active' }, scopeMember: { role: 'viewer' } })).toBe('owner');
  });

  test('the effective role is the highest applicable role', () => {
    expect(resolveEffectiveScopeRole({ userOrganization: { orgRole: 'admin', status: 'active' }, scopeMember: { role: 'owner' } })).toBe('owner');
    expect(resolveEffectiveScopeRole({ userOrganization: { orgRole: 'member', status: 'active' }, scopeMember: { role: 'moderator' } })).toBe('moderator');
  });

  test('no applicable scope relationship means no effective role', () => {
    expect(resolveEffectiveScopeRole({ userOrganization: { orgRole: 'member', status: 'active' }, scopeMember: null })).toBeNull();
    expect(resolveEffectiveScopeRole({ userOrganization: { orgRole: 'viewer', status: 'active' }, scopeMember: null })).toBeNull();
  });

  test('suspended memberships never resolve to a role', () => {
    expect(resolveEffectiveScopeRole({ userOrganization: { orgRole: 'owner', status: 'suspended' }, scopeMember: { role: 'owner' } })).toBeNull();
  });
});

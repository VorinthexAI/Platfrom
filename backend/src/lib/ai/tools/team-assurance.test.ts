import { describe, expect, test } from 'bun:test';
import { hasExactTeamAssurance } from './domain-access-engine';

describe('team MFA authorization boundary', () => {
  const team = { mfa_enabled: true };
  const membership = { key: 'membership-1', isMfaEnabled: true, teamMfaVersion: 4 };

  test('rejects base, wrong-membership, stale-version, and unenrolled sessions', () => {
    expect(hasExactTeamAssurance({}, team, membership)).toBe(false);
    expect(hasExactTeamAssurance({ teamAssurance: { teamMembershipKey: 'membership-2', teamMfaVersion: 4 } }, team, membership)).toBe(false);
    expect(hasExactTeamAssurance({ teamAssurance: { teamMembershipKey: 'membership-1', teamMfaVersion: 3 } }, team, membership)).toBe(false);
    expect(hasExactTeamAssurance({ teamAssurance: { teamMembershipKey: 'membership-1', teamMfaVersion: 4 } }, team, { ...membership, isMfaEnabled: false })).toBe(false);
  });

  test('accepts exact assurance and does not require assurance when DB MFA is disabled', () => {
    expect(hasExactTeamAssurance({ teamAssurance: { teamMembershipKey: 'membership-1', teamMfaVersion: 4 } }, team, membership)).toBe(true);
    expect(hasExactTeamAssurance({}, { mfa_enabled: false }, membership)).toBe(true);
  });
});

import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { foundersTeamKeyParamSchema, hasFounderAssurance } from './founders';

describe('founders request schemas', () => {
  test('accepts legacy team keys', () => {
    const teamKey = 'vorinthex-root';
    expect(foundersTeamKeyParamSchema.parse(teamKey)).toBe(teamKey);
  });

  test('rejects empty team keys', () => {
    expect(foundersTeamKeyParamSchema.safeParse('   ').success).toBe(false);
  });

  test('requires MFA assurance in addition to root membership', () => {
    const membership = { key: 'uteam_root', isMfaEnabled: true, teamMfaVersion: 2 };
    expect(hasFounderAssurance({ founderAssured: true, teamMembershipKey: 'uteam_root', teamMfaVersion: 2 }, membership)).toBe(true);
    expect(hasFounderAssurance({ founderAssured: true, teamMembershipKey: 'uteam_other', teamMfaVersion: 2 }, membership)).toBe(false);
    expect(hasFounderAssurance({ founderAssured: true, teamMembershipKey: 'uteam_root', teamMfaVersion: 1 }, membership)).toBe(false);
    expect(hasFounderAssurance({ founderAssured: true, teamMembershipKey: 'uteam_root', teamMfaVersion: 2 }, { ...membership, isMfaEnabled: false })).toBe(false);
    expect(hasFounderAssurance({ founderAssured: false })).toBe(false);
    expect(hasFounderAssurance({})).toBe(false);
    expect(hasFounderAssurance(null)).toBe(false);
  });
});

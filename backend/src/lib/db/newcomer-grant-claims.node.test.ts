import { describe, expect, test } from 'bun:test';
import { newcomerGrantClaimSchema, newcomerGrantClaimKey } from './newcomer-grant-claims.node';

describe('newcomer grant claims', () => {
  const installationIdentifier = 'a'.repeat(128);

  test('keys claims by the installation identifier hash', async () => {
    expect(await newcomerGrantClaimKey(installationIdentifier)).toMatch(/^[a-f0-9]{64}$/);
    expect(await newcomerGrantClaimKey(installationIdentifier)).toBe(await newcomerGrantClaimKey(installationIdentifier));
  });

  test('rejects unknown fields and invalid identifiers', () => {
    const claim = {
      key: 'b'.repeat(64),
      userKey: 'user-1',
      grantVersion: 'v2' as const,
      createdAt: '2026-09-20T12:00:00.000Z',
    };
    expect(newcomerGrantClaimSchema.parse(claim)).toEqual(claim);
    expect(() => newcomerGrantClaimSchema.parse({ ...claim, extra: true })).toThrow();
    expect(() => newcomerGrantClaimSchema.parse({ ...claim, grantVersion: 'v1' })).toThrow();
  });
});

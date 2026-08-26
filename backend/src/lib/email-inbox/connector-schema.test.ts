import { describe, expect, test } from 'bun:test';
import { emailConnectorCredentialsSchema, organizationConnectorSchema } from './connector-schema';

const now = '2026-08-20T09:00:00.000Z';

describe('organization connector mail projection', () => {
  test('owns sync, lease, and watch state under a strict schema', () => {
    const connector = organizationConnectorSchema.parse({
      key: 'cmrnlzf650002qc7k4p5zem5w', organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', provider: 'gmail', providerAccountId: 'google-1', email: 'person@example.com', encryptedCredentials: 'cipher', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: 'cmrnlzf640001qc7kazsr96k5', status: 'active', historyId: '123', syncLeaseToken: '123e4567-e89b-12d3-a456-426614174000', syncLeaseExpiresAt: now, watchExpiresAt: now, createdAt: now, updatedAt: now,
    });
    expect(connector).toMatchObject({ syncEnabled: true, syncStatus: 'idle', historyId: '123', watchExpiresAt: now });
    expect(() => organizationConnectorSchema.parse({ ...connector, accessToken: 'secret' })).toThrow();
  });

  test('accepts only strict Gmail OAuth credentials', () => {
    expect(emailConnectorCredentialsSchema.parse({ accessToken: 'token', tokenType: 'Bearer', expiresAt: now })).toMatchObject({ accessToken: 'token' });
    expect(() => emailConnectorCredentialsSchema.parse({ username: 'person@example.com', appPassword: 'secret' })).toThrow();
    expect(() => organizationConnectorSchema.parse({ key: 'cmrnlzf650002qc7k4p5zem5w', organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', provider: 'unsupported', providerAccountId: 'unsupported-1', email: 'person@example.com', encryptedCredentials: 'cipher', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: 'cmrnlzf640001qc7kazsr96k5', status: 'active', createdAt: now, updatedAt: now })).toThrow();
  });
});

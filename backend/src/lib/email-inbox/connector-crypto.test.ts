import { describe, expect, test } from 'bun:test';
import { connectorPublic } from './connector-repository';
import { decryptEmailConnectorCredentials, encryptEmailConnectorCredentials, resolveEmailConnectorKeyring, tokenFingerprint } from './connector-crypto';
import { organizationConnectorSchema } from './connector-schema';

const binding = { organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', providerAccountId: 'google-1' };
const keyring = resolveEmailConnectorKeyring({
  EMAIL_CONNECTOR_ACTIVE_KEY_ID: 'current',
  EMAIL_CONNECTOR_CREDENTIAL_KEYS: JSON.stringify({ current: Buffer.alloc(32, 7).toString('base64'), previous: Buffer.alloc(32, 3).toString('base64') }),
});

describe('email connector credential security', () => {
  test('round-trips credentials with authenticated tenant binding', () => {
    const credentials = { accessToken: 'access-secret', refreshToken: 'refresh-secret', tokenType: 'Bearer', expiresAt: '2026-08-11T12:00:00.000Z' };
    const encrypted = encryptEmailConnectorCredentials(credentials, binding, keyring);
    expect(encrypted.encryptedCredentials).not.toContain('secret');
    expect(decryptEmailConnectorCredentials(encrypted.encryptedCredentials, encrypted.encryptionKeyId, binding, keyring)).toEqual(credentials);
    expect(() => decryptEmailConnectorCredentials(encrypted.encryptedCredentials, encrypted.encryptionKeyId, { ...binding, scopeKey: 'cmrnlzf650002qc7k4p5zem5w' }, keyring)).toThrow();
  });

  test('keeps legacy Gmail AAD stable', () => {
    const gmail = encryptEmailConnectorCredentials({ accessToken: 'gmail', tokenType: 'Bearer', expiresAt: '2026-08-11T12:00:00.000Z' }, binding, keyring);
    expect(decryptEmailConnectorCredentials(gmail.encryptedCredentials, gmail.encryptionKeyId, { ...binding, provider: 'gmail' }, keyring)).toMatchObject({ accessToken: 'gmail' });
  });

  test('fingerprints tokens and strips all credential fields from DTOs', () => {
    const now = '2026-08-11T12:00:00.000Z';
    const connector = organizationConnectorSchema.parse({
      key: 'cmrnlzf650002qc7k4p5zem5w', ...binding, provider: 'gmail', email: 'person@example.com', encryptedCredentials: 'ciphertext', encryptionKeyId: 'current',
      accessTokenFingerprint: tokenFingerprint('access-secret'), scopes: ['email'], createdByMembershipKey: 'cmrnlzf640001qc7kazsr96k5', status: 'active', syncLeaseToken: '123e4567-e89b-42d3-a456-426614174000', syncLeaseExpiresAt: now, syncPendingHistoryId: '123', syncPendingThreadIds: ['thread'], createdAt: now, updatedAt: now,
    });
    expect(tokenFingerprint('access-secret')).toMatch(/^[a-f0-9]{64}$/);
    expect(connectorPublic(connector)).not.toHaveProperty('encryptedCredentials');
    expect(connectorPublic(connector)).not.toHaveProperty('encryptionKeyId');
    expect(connectorPublic(connector)).not.toHaveProperty('accessTokenFingerprint');
    expect(connectorPublic(connector)).not.toHaveProperty('syncLeaseToken');
    expect(connectorPublic(connector)).not.toHaveProperty('syncLeaseExpiresAt');
    expect(connectorPublic(connector)).not.toHaveProperty('createdByMembershipKey');
    expect(connectorPublic(connector)).not.toHaveProperty('syncPendingHistoryId');
    expect(connectorPublic(connector)).not.toHaveProperty('syncPendingThreadIds');
    expect(connectorPublic(connector)).not.toHaveProperty('providerAccountId');
    expect(connectorPublic(connector)).not.toHaveProperty('historyId');
    expect(connectorPublic(connector)).not.toHaveProperty('watchExpiresAt');
    expect(connectorPublic(connector)).not.toHaveProperty('scopes');
    expect(connectorPublic(connector)).not.toHaveProperty('lastError');
  });
});

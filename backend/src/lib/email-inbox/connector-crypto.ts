import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { emailConnectorCredentialsSchema, type EmailConnectorCredentials } from './connector-schema';

const keyringSchema = z.record(z.string().min(1), z.string().min(1));

function decodeKey(value: string, name: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw new Error(`${name} must contain base64-encoded 32-byte keys`);
  return key;
}

export function resolveEmailConnectorKeyring(environment: NodeJS.ProcessEnv = process.env) {
  const activeKeyId = environment.EMAIL_CONNECTOR_ACTIVE_KEY_ID ?? 'v1';
  if (environment.EMAIL_CONNECTOR_CREDENTIAL_KEYS) {
    const encoded = keyringSchema.parse(JSON.parse(environment.EMAIL_CONNECTOR_CREDENTIAL_KEYS));
    const keys = new Map(Object.entries(encoded).map(([id, value]) => [id, decodeKey(value, 'EMAIL_CONNECTOR_CREDENTIAL_KEYS')]));
    if (!keys.has(activeKeyId)) throw new Error('EMAIL_CONNECTOR_ACTIVE_KEY_ID is absent from EMAIL_CONNECTOR_CREDENTIAL_KEYS');
    return { activeKeyId, keys };
  }
  const fallback = environment.ORCHESTRATION_CREDENTIALS_MASTER_KEY;
  if (!fallback) throw new Error('EMAIL_CONNECTOR_CREDENTIAL_KEYS must be configured');
  return { activeKeyId: 'v1', keys: new Map([['v1', decodeKey(fallback, 'ORCHESTRATION_CREDENTIALS_MASTER_KEY')]]) };
}

function aad(organizationKey: string, scopeKey: string, providerAccountId: string) {
  return Buffer.from(`${organizationKey}\0${scopeKey}\0gmail\0${providerAccountId}`, 'utf8');
}

export function encryptEmailConnectorCredentials(
  credentials: EmailConnectorCredentials,
  binding: { organizationKey: string; scopeKey: string; providerAccountId: string },
  keyring = resolveEmailConnectorKeyring(),
) {
  const parsed = emailConnectorCredentialsSchema.parse(credentials);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyring.keys.get(keyring.activeKeyId)!, iv);
  cipher.setAAD(aad(binding.organizationKey, binding.scopeKey, binding.providerAccountId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(parsed), 'utf8'), cipher.final()]);
  return {
    encryptionKeyId: keyring.activeKeyId,
    encryptedCredentials: `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`,
  };
}

export function decryptEmailConnectorCredentials(
  encryptedCredentials: string,
  encryptionKeyId: string,
  binding: { organizationKey: string; scopeKey: string; providerAccountId: string },
  keyring = resolveEmailConnectorKeyring(),
) {
  const match = /^v1:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/.exec(encryptedCredentials);
  const key = keyring.keys.get(encryptionKeyId);
  if (!match || !key) throw new Error('Email connector credentials cannot be decrypted');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(match[1]!, 'base64url'));
  decipher.setAAD(aad(binding.organizationKey, binding.scopeKey, binding.providerAccountId));
  decipher.setAuthTag(Buffer.from(match[2]!, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(match[3]!, 'base64url')), decipher.final()]);
  return emailConnectorCredentialsSchema.parse(JSON.parse(plaintext.toString('utf8')));
}

export function tokenFingerprint(accessToken: string) {
  return createHash('sha256').update(accessToken).digest('hex');
}

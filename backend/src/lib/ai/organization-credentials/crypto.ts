import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { organizationCredentialsSchema, type OrganizationCredentials } from './schema';

const MASTER_KEY_ENV = 'ORCHESTRATION_CREDENTIALS_MASTER_KEY';

export function organizationCredentialsMasterKey(value: string | undefined = process.env[MASTER_KEY_ENV]): Buffer {
  if (!value) throw new Error(`${MASTER_KEY_ENV} must be a base64-encoded 32-byte key`);
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error(`${MASTER_KEY_ENV} must be a base64-encoded 32-byte key`);
  }
  return key;
}

export function encryptOrganizationCredentials(credentials: OrganizationCredentials, masterKey = organizationCredentialsMasterKey()): string {
  const plaintext = Buffer.from(JSON.stringify(organizationCredentialsSchema.parse(credentials)), 'utf8');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptOrganizationCredentials(value: string, masterKey = organizationCredentialsMasterKey()): OrganizationCredentials {
  const match = /^v1:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/.exec(value);
  if (!match) throw new Error('Invalid organization credential ciphertext');
  try {
    const [, iv, tag, ciphertext] = match;
    const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]);
    return organizationCredentialsSchema.parse(JSON.parse(plaintext.toString('utf8')));
  } catch {
    throw new Error('Unable to decrypt organization credentials');
  }
}

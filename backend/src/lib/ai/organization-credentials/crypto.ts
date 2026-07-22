import { organizationCredentialsSchema, type OrganizationCredentials } from './schema';
import { decryptAuthenticatedJson, encryptAuthenticatedJson, orchestrationMasterKey } from '@/lib/authenticated-encryption';

export function organizationCredentialsMasterKey(value: string | undefined = process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY): Buffer {
  return orchestrationMasterKey(value);
}

export function encryptOrganizationCredentials(credentials: OrganizationCredentials, masterKey = organizationCredentialsMasterKey()): string {
  return encryptAuthenticatedJson(organizationCredentialsSchema.parse(credentials), masterKey);
}

export function decryptOrganizationCredentials(value: string, masterKey = organizationCredentialsMasterKey()): OrganizationCredentials {
  const match = /^v1:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/.exec(value);
  if (!match) throw new Error('Invalid organization credential ciphertext');
  try {
    return organizationCredentialsSchema.parse(decryptAuthenticatedJson(value, masterKey));
  } catch {
    throw new Error('Unable to decrypt organization credentials');
  }
}

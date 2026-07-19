import { db } from '@/lib/db/client';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { decryptOrganizationCredentials, encryptOrganizationCredentials } from './crypto';
import { ORGANIZATION_CREDENTIALS_COLLECTION, organizationCredentialSchema, organizationCredentialsSchema } from './schema';
import type { OrganizationCredentialsDatabase, OrganizationCredentialsRepository } from './types';

export function createOrganizationCredentialsRepository(database: OrganizationCredentialsDatabase = db): OrganizationCredentialsRepository {
  const references = organizationCredentialSchema.pick({ organizationKey: true, providerKey: true });
  return {
    async setCredentials(organizationKey, providerKey, credentials) {
      const validReferences = references.parse({ organizationKey, providerKey });
      const validCredentials = organizationCredentialsSchema.parse(credentials);
      const timestamp = new Date().toISOString();
      const encryptedCredentials = encryptOrganizationCredentials(validCredentials);
      const cursor = await database.query(
        'FOR credential IN @@collection FILTER credential.organizationKey == @organizationKey && credential.providerKey == @providerKey LIMIT 1 RETURN credential._key',
        { '@collection': ORGANIZATION_CREDENTIALS_COLLECTION, ...validReferences },
      );
      const existingKey = await cursor.next();
      if (typeof existingKey === 'string') {
        const result = await database.collection(ORGANIZATION_CREDENTIALS_COLLECTION).update(existingKey, { encryptedCredentials, updatedAt: timestamp }, { returnNew: true });
        return organizationCredentialSchema.parse(withArangoKey((result as { new: Record<string, unknown> }).new));
      }
      const document = organizationCredentialSchema.parse({
        key: newId(), ...validReferences, encryptedCredentials, createdAt: timestamp, updatedAt: timestamp, embedding: [],
      });
      try {
        const result = await database.collection(ORGANIZATION_CREDENTIALS_COLLECTION).save(toArangoDoc(document), { returnNew: true });
        return organizationCredentialSchema.parse(withArangoKey((result as { new: Record<string, unknown> }).new));
      } catch (error) {
        // A concurrent write may create the unique pair after the lookup.
        if (!isArangoUniqueConstraintError(error)) throw error;
        return this.setCredentials(validReferences.organizationKey, validReferences.providerKey, validCredentials);
      }
    },
    async getCredentials(organizationKey, providerKey) {
      const validReferences = references.parse({ organizationKey, providerKey });
      const cursor = await database.query(
        'FOR credential IN @@collection FILTER credential.organizationKey == @organizationKey && credential.providerKey == @providerKey LIMIT 1 RETURN credential',
        { '@collection': ORGANIZATION_CREDENTIALS_COLLECTION, ...validReferences },
      );
      const document = await cursor.next();
      if (!document || typeof document !== 'object') return null;
      const credential = organizationCredentialSchema.parse(withArangoKey(document as Record<string, unknown>));
      return decryptOrganizationCredentials(credential.encryptedCredentials);
    },
    async hasCredentials(organizationKey, providerKey) {
      const validReferences = references.parse({ organizationKey, providerKey });
      const cursor = await database.query(
        'FOR credential IN @@collection FILTER credential.organizationKey == @organizationKey && credential.providerKey == @providerKey LIMIT 1 RETURN true',
        { '@collection': ORGANIZATION_CREDENTIALS_COLLECTION, ...validReferences },
      );
      return (await cursor.next()) === true;
    },
  };
}

let cachedDefaultRepository: OrganizationCredentialsRepository | null = null;
export function getDefaultOrganizationCredentialsRepository() {
  return cachedDefaultRepository ??= createOrganizationCredentialsRepository();
}

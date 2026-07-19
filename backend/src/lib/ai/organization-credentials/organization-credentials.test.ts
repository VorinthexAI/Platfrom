import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { decryptOrganizationCredentials, encryptOrganizationCredentials, organizationCredentialsMasterKey } from './crypto';
import { ensureOrganizationCredentialsCollection } from './indexes';
import { createOrganizationCredentialsRepository } from './repository';
import { ORGANIZATION_CREDENTIALS_COLLECTION } from './schema';
import type { OrganizationCredentialsDatabase } from './types';

const masterKey = Buffer.alloc(32, 7);

function memoryDatabase(): OrganizationCredentialsDatabase & { docs: Map<string, Record<string, unknown>> } {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    docs,
    async query(query, vars = {}) {
      const document = [...docs.values()].find((candidate) => candidate.organizationKey === vars.organizationKey && candidate.providerKey === vars.providerKey);
      return { async next() { return query.includes('RETURN credential._key') ? document?._key : document; } };
    },
    collection() {
      return {
        async save(document) { docs.set(String(document._key), document); return { new: document }; },
        async update(key, patch) {
          const document = { ...docs.get(key), ...patch };
          docs.set(key, document);
          return { new: document };
        },
      };
    },
  };
}

describe('organization credentials', () => {
  test('encrypts JSON with AES-256-GCM and rejects tampering', () => {
    const encrypted = encryptOrganizationCredentials({ apiKey: 'secret', region: 'us-east-1' }, masterKey);
    expect(encrypted).not.toContain('secret');
    expect(decryptOrganizationCredentials(encrypted, masterKey)).toEqual({ apiKey: 'secret', region: 'us-east-1' });
    expect(() => decryptOrganizationCredentials(`${encrypted}x`, masterKey)).toThrow('Unable to decrypt organization credentials');
  });

  test('validates the explicit base64 32-byte master key', () => {
    expect(organizationCredentialsMasterKey(masterKey.toString('base64'))).toEqual(masterKey);
    expect(() => organizationCredentialsMasterKey(Buffer.alloc(31).toString('base64'))).toThrow('ORCHESTRATION_CREDENTIALS_MASTER_KEY');
    expect(() => organizationCredentialsMasterKey('not-base64')).toThrow('ORCHESTRATION_CREDENTIALS_MASTER_KEY');
  });

  test('stores one encrypted credential blob per organization and provider', async () => {
    const database = memoryDatabase();
    const repository = createOrganizationCredentialsRepository(database);
    const original = process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY;
    process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY = masterKey.toString('base64');
    try {
      const organizationKey = newId();
      const providerKey = newId();
      const first = await repository.setCredentials(organizationKey, providerKey, { apiKey: 'first' });
      const second = await repository.setCredentials(organizationKey, providerKey, { apiKey: 'second' });
      expect(first.key).toBe(second.key);
      expect(database.docs.size).toBe(1);
      expect([...database.docs.values()][0]?.encryptedCredentials).not.toContain('second');
      expect(await repository.getCredentials(organizationKey, providerKey)).toEqual({ apiKey: 'second' });
    } finally {
      if (original === undefined) delete process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY;
      else process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY = original;
    }
  });

  test('creates the credential collection with a unique organization/provider index', async () => {
    const indexes: string[][] = [];
    let exists = false;
    const database = { collection(name: string) { expect(name).toBe(ORGANIZATION_CREDENTIALS_COLLECTION); return { async exists() { return exists; }, async create() { exists = true; }, async ensureIndex(index: { fields: string[] }) { indexes.push(index.fields); } }; } };
    await ensureOrganizationCredentialsCollection(database);
    expect(indexes).toEqual([['organizationKey', 'providerKey']]);
  });
});

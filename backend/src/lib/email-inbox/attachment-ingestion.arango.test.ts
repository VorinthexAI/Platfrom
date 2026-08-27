import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { newId } from '@/lib/ids';
import { createEmailAttachmentRepository, EmailAttachmentIngestionError } from './attachment-ingestion';

const liveArangoSuite = process.env.ARANGO_URL && process.env.ARANGO_USERNAME && process.env.ARANGO_ROOT_PASSWORD !== undefined ? describe : describe.skip;

liveArangoSuite('canonical email attachment repository live Arango', () => {
  test('fences claims and completes only after canonical storage is persisted', async () => {
    const { Database } = await import('arangojs');
    const temporaryName = `email_attachments_${randomUUID().replaceAll('-', '')}`;
    const root = new Database({ url: process.env.ARANGO_URL!, auth: { username: process.env.ARANGO_USERNAME!, password: process.env.ARANGO_ROOT_PASSWORD! } });
    await root.createDatabase(temporaryName);
    const database = root.database(temporaryName);
    try {
      for (const name of ['organizations', 'userOrganizations', 'scopes', 'scopeMembers', 'organizationConnectors', 'emailAttachments']) await database.createCollection(name);
      const organizationKey = 'organization-live';
      const membershipKey = newId();
      const scopeKey = newId();
      const connectorKey = newId();
      await database.collection('organizations').save({ _key: organizationKey });
      await database.collection('userOrganizations').save({ _key: membershipKey, organizationId: organizationKey, status: 'active', orgRole: 'owner' });
      await database.collection('scopes').save({ _key: scopeKey, organizationKey });
      await database.collection('organizationConnectors').save({ _key: connectorKey, syncLeaseToken: randomUUID(), syncLeaseExpiresAt: '2099-01-01T00:00:00.000Z' });

      const repository = createEmailAttachmentRepository(database);
      const key = newId();
      const input = { key, organizationKey, scopeKey, connectorKey, providerMessageId: 'message', partPath: '0.1', contentHash: 'a'.repeat(64), sourceMimeType: 'text/plain', sourceFilename: 'notes.txt', sourceSize: 5, targetType: 'document' as const, targetKey: key };
      const firstToken = randomUUID();
      const secondToken = randomUUID();
      const now = '2026-08-25T12:00:00.000Z';
      const expires = '2099-01-01T00:00:00.000Z';
      await repository.claim(input, membershipKey, firstToken, now, expires);
      await expect(repository.claim(input, membershipKey, secondToken, now, expires)).rejects.toBeInstanceOf(EmailAttachmentIngestionError);
      expect(await repository.complete(key, firstToken, 'document', key, undefined, membershipKey, now)).toBe(false);
      expect(await repository.persistStorage(key, firstToken, 'email/object', now)).toBe(true);
      expect(await repository.complete(key, firstToken, 'document', key, undefined, membershipKey, now)).toBe(true);
      expect((await database.collection('emailAttachments').document(key) as { status: string; storageKey: string })).toMatchObject({ status: 'completed', storageKey: 'email/object' });
    } finally {
      database.close();
      await root.dropDatabase(temporaryName);
      root.close();
    }
  }, 60_000);
});

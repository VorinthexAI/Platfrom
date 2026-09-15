import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { newId } from '@/lib/ids';
import { createEmailAttachmentIngestionService, createEmailAttachmentRepository, EmailAttachmentIngestionError } from './attachment-ingestion';
import { createEmailRepository, emailMessageKey } from './repository';
import { createEmailService } from './service';
import { toArangoDoc } from '@/lib/db/base';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { recoverAttachmentExports } from './attachment-export-queue';
import { createConnectorRepository } from './connector-repository';
import { createInboxRepository } from './inbox-repository';
import { imageSchema } from '@/lib/db/images.node';
import { imageCaptionRecordSchema } from '@/lib/db/image-captions.node';

const liveArangoSuite = process.env.ARANGO_URL && process.env.ARANGO_USERNAME && process.env.ARANGO_ROOT_PASSWORD !== undefined ? describe : describe.skip;

liveArangoSuite('canonical email persistence live Arango', () => {
  test('connects inboxes, fences attachment storage, recovers exports, and persists owner-aware drafts', async () => {
    const { Database } = await import('arangojs');
    const temporaryName = `email_attachments_${randomUUID().replaceAll('-', '')}`;
    const root = new Database({ url: process.env.ARANGO_URL!, auth: { username: process.env.ARANGO_USERNAME!, password: process.env.ARANGO_ROOT_PASSWORD! } });
    await root.createDatabase(temporaryName);
    const database = root.database(temporaryName);
    try {
      for (const name of ['teams', 'userTeams', 'scopes', 'scopeMembers', 'userConnectors', 'emailAttachments', 'emailInboxes', 'emailThreads', 'emailMessages', 'emailDrafts', 'emailTones', 'emailReplyContext', 'tagAssignments', 'folders', 'collections', 'collectionImages', 'documents', 'images', 'imageCaptions']) await database.createCollection(name);
      const teamKey = 'team-live';
      const teamMembershipKey = newId();
      const userKey = newId();
      const scopeKey = newId();
      const connectorKey = newId();
      const previousKeys = process.env.EMAIL_CONNECTOR_CREDENTIAL_KEYS;
      const previousActiveKey = process.env.EMAIL_CONNECTOR_ACTIVE_KEY_ID;
      try {
        process.env.EMAIL_CONNECTOR_ACTIVE_KEY_ID = 'integration-test';
        process.env.EMAIL_CONNECTOR_CREDENTIAL_KEYS = JSON.stringify({ 'integration-test': Buffer.alloc(32, 7).toString('base64') });
        const connectors = createConnectorRepository(database);
        const connected = await connectors.upsert({ userKey, teamKey, scopeKey, providerAccountId: 'test-google-account', email: 'test@example.com', scopes: ['email'], credentials: { accessToken: 'test-access', refreshToken: 'test-refresh', tokenType: 'Bearer', expiresAt: '2099-01-01T00:00:00.000Z' }, expectedRevision: null });
        expect(connectors.credentials(connected).accessToken).toBe('test-access');
        const inbox = await createInboxRepository(database).ensure(connected, { name: 'Connected inbox' }, Array(EMBEDDING_DIMENSIONS).fill(0), false, null);
        expect(inbox?.connectorKey).toBe(connected.key);
        expect(inbox?.name).toBe('Connected inbox');
      } finally {
        if (previousKeys === undefined) delete process.env.EMAIL_CONNECTOR_CREDENTIAL_KEYS; else process.env.EMAIL_CONNECTOR_CREDENTIAL_KEYS = previousKeys;
        if (previousActiveKey === undefined) delete process.env.EMAIL_CONNECTOR_ACTIVE_KEY_ID; else process.env.EMAIL_CONNECTOR_ACTIVE_KEY_ID = previousActiveKey;
      }
      await database.collection('teams').save({ _key: teamKey });
      await database.collection('userTeams').save({ _key: teamMembershipKey, userId: userKey, teamKey: teamKey, status: 'active', teamRole: 'owner' });
      await database.collection('scopes').save({ _key: scopeKey, teamKey });
      await database.collection('userConnectors').save({ _key: connectorKey, userKey, syncLeaseToken: randomUUID(), syncLeaseExpiresAt: '2099-01-01T00:00:00.000Z', status: 'active' });

      const repository = createEmailAttachmentRepository(database);
      const key = newId();
      const input = { key, userKey, teamKey, scopeKey, connectorKey, providerMessageId: 'message', partPath: '0.1', contentHash: 'a'.repeat(64), sourceMimeType: 'text/plain', sourceFilename: 'notes.txt', sourceSize: 5, targetType: 'document' as const, targetKey: key };
      const firstToken = randomUUID();
      const secondToken = randomUUID();
      const now = '2026-08-25T12:00:00.000Z';
      const expires = '2099-01-01T00:00:00.000Z';
      await repository.claim(input, teamMembershipKey, firstToken, now, expires);
      await expect(repository.claim(input, teamMembershipKey, secondToken, now, expires)).rejects.toBeInstanceOf(EmailAttachmentIngestionError);
      expect(await repository.complete(key, firstToken, 'document', key, undefined, userKey, now)).toBe(false);
      expect(await repository.persistStorage(key, firstToken, 'email/object', now)).toBe(true);
      expect(await repository.complete(key, firstToken, 'document', key, undefined, userKey, now)).toBe(true);
      expect((await database.collection('emailAttachments').document(key) as { status: string; storageKey: string })).toMatchObject({ status: 'completed', storageKey: 'email/object' });
      const mail = createEmailRepository(database);
      const documentKey = newId(), imageKey = newId(), foreignKey = newId(), privateKey = newId();
      for (const document of [
        { key: documentKey, scopeKey, name: 'Proposal', extension: 'pdf', mimeType: 'application/pdf', storageKey: 'proposal.pdf' },
        { key: foreignKey, scopeKey: newId(), name: 'Other workspace', content: 'private' },
        { key: privateKey, scopeKey, name: 'Other owner', privateOwnerUserKey: newId(), content: 'private' },
      ]) await database.collection('documents').save(toArangoDoc(document));
      await database.collection('images').save(toArangoDoc({ key: imageKey, scopeKey, filename: 'photo.png', mimeType: 'image/png', storageKey: 'photo.png' }));
      expect(await mail.attachmentResources(userKey, [{ type: 'document', key: documentKey }, { type: 'image', key: imageKey }, { type: 'document', key }], scopeKey)).toMatchObject([
        { name: 'Proposal.pdf', storageKey: 'proposal.pdf' }, { name: 'photo.png', storageKey: 'photo.png' }, { name: 'notes.txt', storageKey: 'email/object' },
      ]);
      for (const deniedKey of [foreignKey, privateKey]) await expect(mail.resolveAttachments(userKey, [{ type: 'document', key: deniedKey }], scopeKey)).rejects.toMatchObject({ reason: 'forbidden' });
      await expect(mail.resolveAttachments(newId(), [{ type: 'document', key }], scopeKey)).rejects.toMatchObject({ reason: 'forbidden' });
      await expect(mail.resolveAttachments(userKey, [{ type: 'document', key: documentKey }])).rejects.toMatchObject({ reason: 'forbidden' });
      await repository.markExported(key, userKey);
      expect((await database.collection('emailAttachments').document(key) as { exportPending: boolean }).exportPending).toBe(false);

      await database.collection('emailInboxes').save(toArangoDoc({ key: newId(), scopeKey, connectorKey, name: 'Inbox' }));
      let attempts = 0;
      const ingestion = createEmailAttachmentIngestionService({
        repository, exportDatabase: database,
        storage: { upload: async ({ key }) => ({ storageKey: key }), download: async () => ({ bytes: new TextEncoder().encode('hello') }), delete: async () => undefined, copy: async ({ destinationKey }) => ({ storageKey: destinationKey }) },
        publishScopeEvent: async () => undefined,
        parse: async (_input, dependencies) => {
          if (++attempts === 1) throw new Error('temporary parser outage');
          const document = await dependencies!.insert!({ key: newId(), scopeKey, name: 'received.txt', content: 'hello', extension: 'txt', mimeType: 'text/plain', storageKey: 'export/bytes', embedding: Array(EMBEDDING_DIMENSIONS).fill(0), mutationPolicy: 'user', isFavorite: false, createdAt: now, updatedAt: now });
          return { document };
        },
      });
      const received = await ingestion.ingest({ userKey, teamKey, scopeKey, connectorKey, teamMembershipKey, providerMessageId: 'received', part: { path: '0.1', type: 'document', filename: 'received.txt', mimeType: 'text/plain', size: 5 }, bytes: new TextEncoder().encode('hello') });
      expect((await database.collection('emailAttachments').document(received.key) as { exportPending: boolean })).toMatchObject({ exportPending: true });
      const jobs: any[] = [];
      await recoverAttachmentExports({ add: async (_name: string, input: unknown) => { jobs.push(input); } } as never, database);
      expect(jobs).toEqual([{ attachmentKey: received.key }]);
      await ingestion.retryExport(received.key);
      const refs = await mail.attachmentReferencesForRead(userKey, [received]);
      expect(refs[0]!.key).not.toBe(received.key);
      expect((await database.collection('documents').document(refs[0]!.key) as { content: string }).content).toBe('hello');
      expect((await database.collection('emailAttachments').document(received.key) as { exportPending: boolean })).toMatchObject({ exportPending: false });
      expect(attempts).toBe(2);
      const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
      const imageIngestion = createEmailAttachmentIngestionService({
        repository, exportDatabase: database, publishScopeEvent: async () => undefined,
        storage: { upload: async ({ key }) => ({ storageKey: key }), download: async () => ({ bytes: new Uint8Array([1]) }), delete: async () => undefined, copy: async ({ destinationKey }) => ({ storageKey: destinationKey }) },
        sanitizeImage: async (bytes) => ({ bytes: Uint8Array.from(bytes), coordinates: undefined }),
        processImage: async (input, dependencies) => {
          const captionKey = newId();
          return dependencies!.persistImage!({ actorKey: teamMembershipKey,
            image: imageSchema.parse({ key: input.imageKey, scopeKey, filename: 'photo.png', caption: 'A photo', imageCaptionKey: captionKey, storageKey: 'export/photo.png', mimeType: 'image/png', sizeBytes: 1, width: 1, height: 1, embedding, origin: 'uploaded', createdAt: now, updatedAt: now }),
            caption: imageCaptionRecordSchema.parse({ key: captionKey, scopeKey, sourceImageKey: input.imageKey, caption: 'A photo', embedding, perceptualHash: null, hashAlgorithm: null, hashSegment0: null, hashSegment1: null, hashSegment2: null, hashSegment3: null, createdAt: now, updatedAt: now }),
          });
        },
      });
      const photo = await imageIngestion.ingest({ userKey, teamKey, scopeKey, connectorKey, teamMembershipKey, providerMessageId: 'photo', part: { path: '0.1', type: 'image', filename: 'photo.png', mimeType: 'image/png', size: 1 }, bytes: new Uint8Array([1]) });
      const photoRefs = await mail.attachmentReferencesForRead(userKey, [photo]);
      expect((await database.collection('images').document(photoRefs[0]!.key) as { caption: string }).caption).toBe('A photo');
      expect((await database.collection('emailAttachments').document(photo.key) as { exportPending: boolean }).exportPending).toBe(false);
      const thread = await mail.syncThread({
        thread: { userKey, scopeKey: userKey, accountKey: connectorKey, providerThreadId: 'draft-thread', subject: 'Review', summary: 'Please review', intent: 'Review', priority: 'normal', state: 'needs_action', lastMessageAt: now, unread: true, isFavorite: false, inboxCategory: 'Important', inInbox: true, embedding },
        messages: [{ userKey, scopeKey: userKey, accountKey: connectorKey, providerMessageId: 'inbound', from: 'sender@example.com', to: ['owner@example.com'], subject: 'Review', body: 'Can you review this?', summary: 'Review', direction: 'inbound', sentAt: now, hasAttachments: false, replyDepth: 0, unread: true, inboxCategory: 'Important', embedding }],
      });
      await mail.initializeTones(userKey, userKey);
      const note = await mail.createReplyContext(userKey, userKey, { name: 'Availability', text: 'Available on Monday.', embedding });
      const currentNote = await mail.getReplyContext(userKey, note.key);
      expect(await mail.updateReplyContext(userKey, note.key, note.updatedAt, currentNote!.revision, { name: 'Availability', text: 'Available on weekdays.', embedding })).toMatchObject({ text: 'Available on weekdays.' });
      const email = createEmailService({ repository: mail, authorize: async () => ({ teamMembershipKey: 'system', role: 'owner' }),
        connectors: { getExact: async () => ({ key: connectorKey, userKey, teamKey, scopeKey, email: 'owner@example.com', status: 'active' }) } as never,
        getUser: async () => ({ name: 'Mailbox Owner', alias: 'Owner' }), embed: async () => embedding, publishInboxChanged: async () => undefined,
        ask: async (_team, input) => {
          const prompt = JSON.stringify(input);
          expect(prompt).toContain('Available on weekdays.');
          expect(prompt).toContain('Casual');
          return { output: { text: '{"decision":"draft","body":"I can review this on a weekday."}' } } as never;
        },
      });
      const result = await email.createDraftIfNeeded({ userKey: 'system', teamKey, scopeKey }, { connectorKey, threadKey: thread.key, messageKey: emailMessageKey(userKey, connectorKey, 'inbound') });
      expect(result.decision).toBe('draft');
      expect(await mail.listDrafts(userKey, connectorKey)).toMatchObject([{ userKey, scopeKey: userKey, tone: 'Casual' }]);
    } finally {
      database.close();
      await root.dropDatabase(temporaryName);
      root.close();
    }
  }, 60_000);
});

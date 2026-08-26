import { describe, expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import type { Database } from 'arangojs';
import { collections as migrationCollections } from '@/db/arango-migrate';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { createScopeRepository } from '@/lib/ai/scopes/repository';
import { documentKeyForRequest } from '@/lib/ai/document-processing';
import { mailFolderKeys, mailInboxFilesFolderKey, mailInboxFolderKey } from './folders';
import { createEmailRepository } from './repository';
import { createEmailAttachmentRepository, EmailAttachmentIngestionError } from './attachment-ingestion';
import { encodeEmailToneContent } from './archive-payloads';

const liveArangoSuite = process.env.ARANGO_URL && process.env.ARANGO_USERNAME && process.env.ARANGO_ROOT_PASSWORD !== undefined ? describe : describe.skip;
const at = '2026-08-25T12:00:00.000Z';
const before = '2026-08-25T11:59:59.999Z';
const after = '2026-08-25T12:30:00.000Z';
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
const stableKey = (kind: string, ...values: string[]) => `c${createHash('sha256').update([kind, ...values].join('\0')).digest('hex').slice(0, 24)}`;

const requiredCollections = [
  'organizations', 'userOrganizations', 'scopes', 'scopeMembers', 'scopeScopes', 'organizationConnectors',
  'folders', 'documents', 'documentVersions', 'documentSummaries', 'documentSummaryAudio', 'documentAudioVersions',
  'documentShares', 'emailAttachmentBindings', 'images', 'imageCaptions', 'collectionImages', 'imageIdentities',
  'imageCollectionMemories', 'imageCollecitionHightlights', 'placeImages', 'collections', 'collectionMembers',
  'collectionInvites', 'trips', 'tripPlaces', 'tripAttachments', 'tripCreationReceipts', 'tagAssignments',
  'shares', 'userHiddens', 'storageDeletionJobs', 'generatedDocumentBindings', 'places',
] as const;

type Fixture = {
  organizationKey: string;
  membershipKey: string;
  scopeKey: string;
  connectorKey: string;
  leaseToken: string;
};

async function createTemporaryDatabase() {
  const { Database } = await import('arangojs');
  const temporaryName = `gmail_attachments_${randomUUID().replaceAll('-', '')}`;
  const root = new Database({
    url: process.env.ARANGO_URL!,
    auth: { username: process.env.ARANGO_USERNAME!, password: process.env.ARANGO_ROOT_PASSWORD! },
  });
  await root.createDatabase(temporaryName);
  const temporary = root.database(temporaryName);
  try {
    for (const name of requiredCollections) await temporary.createCollection(name);
    const bindingSpec = migrationCollections.find(({ name }) => name === 'emailAttachmentBindings');
    if (!bindingSpec) throw new Error('emailAttachmentBindings migration spec is missing');
    for (const index of bindingSpec.indexes ?? []) {
      await temporary.collection('emailAttachmentBindings').ensureIndex({
        type: 'persistent', fields: index.fields, unique: index.unique ?? false, sparse: index.sparse ?? false,
      });
    }
    return { root, temporary, temporaryName };
  } catch (error) {
    temporary.close();
    await root.dropDatabase(temporaryName).catch(() => undefined);
    root.close();
    throw error;
  }
}

async function seedFixture(database: Database, suffix: string): Promise<Fixture> {
  const organizationKey = `organization-${suffix}`;
  const membershipKey = newId();
  const scopeKey = newId();
  const connectorKey = newId();
  const leaseToken = randomUUID();
  await database.collection('organizations').save({ _key: organizationKey, name: `Organization ${suffix}` });
  await database.collection('userOrganizations').save({ _key: membershipKey, organizationId: organizationKey, userId: newId(), status: 'active', orgRole: 'owner' });
  await database.collection('scopes').save({ _key: scopeKey, organizationKey, slug: `scope-${suffix}`, name: `Scope ${suffix}`, summary: 'Live Gmail attachment scope', description: null, position: 1, level: 1, embedding });
  await database.collection('scopeMembers').save({ _key: newId(), scopeKey, userOrganizationKey: membershipKey, role: 'owner', status: 'active', source: 'explicit' });
  await database.collection('organizationConnectors').save({ _key: connectorKey, organizationKey, scopeKey, provider: 'gmail', status: 'active', syncEnabled: true, syncLeaseToken: leaseToken, syncLeaseExpiresAt: '2099-01-01T00:00:00.000Z' });
  const folders = mailFolderKeys(scopeKey);
  await database.collection('folders').import(Object.entries(folders).map(([kind, key]) => ({
    _key: key, scopeKey, ...(kind === 'root' ? {} : { parentFolderKey: folders.root }), name: kind,
    purpose: `communication-mail-${kind === 'root' ? 'root' : kind === 'replyContext' ? 'reply-context' : kind}`,
    mutationPolicy: 'system-container', embedding, isFavorite: false, createdAt: at, updatedAt: at,
  })));
  await database.collection('folders').save({ _key: mailInboxFolderKey(scopeKey, connectorKey), scopeKey, parentFolderKey: folders.inboxes, name: `Inbox ${suffix}`, managedPurpose: 'mail-inbox', managedOwnerKey: connectorKey, mutationPolicy: 'system-container', archiveVisibility: 'visible', embedding, isFavorite: false, createdAt: at, updatedAt: at });
  return { organizationKey, membershipKey, scopeKey, connectorKey, leaseToken };
}

function claimInput(fixture: Fixture, partPath: string, targetType: 'document' | 'image' = 'document') {
  const key = stableKey('email-attachment-binding', fixture.scopeKey, fixture.connectorKey, `message-${partPath}`, partPath);
  const folderKey = mailInboxFilesFolderKey(fixture.scopeKey, fixture.connectorKey);
  const targetKey = targetType === 'document' ? documentKeyForRequest(fixture.scopeKey, folderKey, key) : stableKey('email-attachment-target', key);
  return {
    key, organizationKey: fixture.organizationKey, scopeKey: fixture.scopeKey, connectorKey: fixture.connectorKey,
    providerMessageId: `message-${partPath}`, partPath, contentHash: 'a'.repeat(64), sourceMimeType: targetType === 'document' ? 'text/plain' : 'image/png',
    sourceFilename: targetType === 'document' ? 'notes.txt' : 'photo.png', sourceSize: 5, targetType, targetKey,
  };
}

function mailDocument(key: string, scopeKey: string, folderKey: string, kind: string, data: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return { _key: key, scopeKey, folderKey, name: kind, content: JSON.stringify({ version: 1, kind, data }), embedding, isFavorite: false, mutationPolicy: 'system-only', createdAt: before, updatedAt: before, ...overrides };
}

function mailPlacement(fixture: Fixture) {
  return { threadFolderKey: mailFolderKeys(fixture.scopeKey).threads, messageFolderKey: mailInboxFolderKey(fixture.scopeKey, fixture.connectorKey) };
}

async function seedAttachmentGraph(database: Database, fixture: Fixture, prefix: string, providerMessageId: string, threadKey: string) {
  const documentBindingKey = newId();
  const imageBindingKey = newId();
  const documentKey = newId();
  const imageKey = stableKey('email-attachment-target', imageBindingKey);
  const captionKey = newId();
  const unrelatedImageKey = newId();
  const userCollectionKey = newId();
  const draftKey = newId();
  const folders = mailFolderKeys(fixture.scopeKey);
  const attachmentFolderKey = mailInboxFilesFolderKey(fixture.scopeKey, fixture.connectorKey);
  await database.query('UPSERT { _key: @key } INSERT { _key: @key, scopeKey: @scopeKey, parentFolderKey: @inboxFolderKey, name: "Files", managedPurpose: "mail-inbox-files", managedOwnerKey: @connectorKey, mutationPolicy: "system-container", archiveVisibility: "visible", createdAt: @at, updatedAt: @at } UPDATE {} IN folders', { key: attachmentFolderKey, scopeKey: fixture.scopeKey, inboxFolderKey: mailInboxFolderKey(fixture.scopeKey, fixture.connectorKey), connectorKey: fixture.connectorKey, at });
  const bindingBase = { organizationKey: fixture.organizationKey, scopeKey: fixture.scopeKey, connectorKey: fixture.connectorKey, providerMessageId, contentHash: 'b'.repeat(64), status: 'completed', sourceSize: 5, createdAt: before, updatedAt: before };
  await database.collection('emailAttachmentBindings').import([
    { _key: documentBindingKey, ...bindingBase, partPath: '0.1', sourceMimeType: 'text/plain', sourceFilename: `${prefix}.txt`, targetType: 'document', targetKey: documentKey },
    { _key: imageBindingKey, ...bindingBase, partPath: '0.2', sourceMimeType: 'image/png', sourceFilename: `${prefix}.png`, targetType: 'image', targetKey: imageKey },
  ]);
  await database.collection('documents').import([
    { _key: documentKey, scopeKey: fixture.scopeKey, folderKey: attachmentFolderKey, name: `${prefix}.txt`, content: prefix, embedding, isFavorite: false, mutationPolicy: 'user', managedPurpose: 'mail-attachment', managedOwnerKey: documentBindingKey, storageKey: `storage/${prefix}.txt`, sourceStorageKeys: [`storage/${prefix}-source`, `storage/${prefix}-shared`], speechStorageKeys: [`storage/${prefix}-speech`], createdAt: before, updatedAt: before },
    { _key: newId(), scopeKey: fixture.scopeKey, folderKey: folders.root, name: `${prefix}-retained`, content: prefix, embedding, isFavorite: false, mutationPolicy: 'user', sourceStorageKeys: [`storage/${prefix}-shared`], createdAt: before, updatedAt: before },
    mailDocument(draftKey, fixture.scopeKey, folders.drafts, 'mail-new-draft', { variant: 'new', accountKey: fixture.connectorKey, to: ['to@example.com'], subject: prefix, generatedContent: prefix, status: 'edited', attachments: [{ type: 'document', key: documentKey }, { type: 'image', key: imageKey }, { type: 'document', key: newId() }] }),
    mailDocument(newId(), fixture.scopeKey, folders.threads, 'mail-contact', { name: 'cover' }, { coverImageKey: imageKey }),
  ]);
  const summaryKey = newId();
  await database.collection('documentVersions').save({ _key: newId(), scopeKey: fixture.scopeKey, documentKey, version: 1, storageKey: `storage/${prefix}-version` });
  await database.collection('documentSummaries').save({ _key: summaryKey, scopeKey: fixture.scopeKey, documentKey, version: 1 });
  await database.collection('documentSummaryAudio').save({ _key: newId(), scopeKey: fixture.scopeKey, documentKey, summaryKey, storageKey: `storage/${prefix}-summary-audio` });
  await database.collection('documentAudioVersions').save({ _key: newId(), scopeKey: fixture.scopeKey, documentKey, version: 1, storageKey: `storage/${prefix}-audio` });
  await database.collection('imageCaptions').save({ _key: captionKey, scopeKey: fixture.scopeKey, caption: prefix });
  await database.collection('images').import([
    { _key: imageKey, scopeKey: fixture.scopeKey, filename: `${prefix}.jpg`, caption: prefix, storageKey: `storage/${prefix}.jpg`, mimeType: 'image/jpeg', sizeBytes: 5, width: 1, height: 1, embedding, imageCaptionKey: captionKey, createdByKey: fixture.membershipKey, mutationPolicy: 'system-only', isFavorite: false, createdAt: before, updatedAt: before },
    { _key: unrelatedImageKey, scopeKey: fixture.scopeKey, filename: 'retained.jpg', caption: prefix, storageKey: `storage/${prefix}-retained.jpg`, mimeType: 'image/jpeg', sizeBytes: 5, width: 1, height: 1, embedding, imageCaptionKey: captionKey, createdByKey: fixture.membershipKey, mutationPolicy: 'user', isFavorite: false, createdAt: before, updatedAt: before },
  ]);
  await database.collection('collections').save({ _key: userCollectionKey, scopeKey: fixture.scopeKey, name: prefix, mutationPolicy: 'user', coverImageKey: imageKey });
  await database.collection('collectionImages').save({ _key: newId(), scopeKey: fixture.scopeKey, collectionKey: userCollectionKey, imageKey, createdAt: before });
  await database.collection('imageIdentities').save({ _key: newId(), scopeKey: fixture.scopeKey, identityKey: newId(), imageKey });
  await database.collection('imageCollectionMemories').save({ _key: newId(), scopeKey: fixture.scopeKey, collectionKey: userCollectionKey, imageKey, createdAt: before });
  await database.collection('imageCollecitionHightlights').save({ _key: newId(), scopeKey: fixture.scopeKey, collectionKey: userCollectionKey, imageKeys: [imageKey, unrelatedImageKey], createdByKey: fixture.membershipKey, createdAt: before, updatedAt: before });
  await database.collection('placeImages').save({ _key: newId(), scopeKey: fixture.scopeKey, placeKey: newId(), imageKey });
  await database.collection('tagAssignments').save({ _key: newId(), scopeKey: fixture.scopeKey, sourceType: 'image', sourceKey: imageKey });
  await database.collection('shares').save({ _key: newId(), scopeKey: fixture.scopeKey, sourceType: 'image', sourceKey: imageKey });
  await database.collection('userHiddens').save({ _key: newId(), source: 'image', sourceKey: imageKey });
  return { documentBindingKey, imageBindingKey, documentKey, imageKey, captionKey, unrelatedImageKey, userCollectionKey, draftKey, threadKey };
}

async function assertAttachmentGraphDeleted(database: Database, graph: Awaited<ReturnType<typeof seedAttachmentGraph>>) {
  for (const [collection, key] of [
    ['emailAttachmentBindings', graph.documentBindingKey], ['emailAttachmentBindings', graph.imageBindingKey],
    ['documents', graph.documentKey], ['images', graph.imageKey],
  ] as const) expect(await (await database.query('RETURN DOCUMENT(@@collection, @key) == null', { '@collection': collection, key })).next()).toBe(true);
  expect(await database.collection('images').document(graph.unrelatedImageKey)).toBeDefined();
  expect(await database.collection('imageCaptions').document(graph.captionKey)).toBeDefined();
  const collection = await database.collection('collections').document(graph.userCollectionKey) as Record<string, unknown>;
  expect(collection.coverImageKey).toBeUndefined();
  for (const [collectionName, field] of [['collectionImages', 'imageKey'], ['imageIdentities', 'imageKey'], ['imageCollectionMemories', 'imageKey'], ['placeImages', 'imageKey'], ['tagAssignments', 'sourceKey'], ['shares', 'sourceKey'], ['userHiddens', 'sourceKey']] as const) {
    expect(await (await database.query('RETURN LENGTH(FOR row IN @@collection FILTER row[@field] == @imageKey RETURN 1)', { '@collection': collectionName, field, imageKey: graph.imageKey })).next()).toBe(0);
  }
  expect(await (await database.query('RETURN LENGTH(FOR document IN documents FILTER document.coverImageKey == @imageKey RETURN 1)', { imageKey: graph.imageKey })).next()).toBe(0);
  const draft = await database.collection('documents').document(graph.draftKey) as { content: string };
  expect(JSON.parse(draft.content).data.attachments).toHaveLength(1);
  const highlights = await (await database.query<{ imageKeys: string[] }>('FOR row IN imageCollecitionHightlights FILTER @key IN row.imageKeys RETURN row', { key: graph.unrelatedImageKey })).all();
  expect(highlights).toHaveLength(1);
  expect(highlights[0]!.imageKeys).toEqual([graph.unrelatedImageKey]);
  for (const collectionName of ['documentVersions', 'documentSummaries', 'documentSummaryAudio', 'documentAudioVersions'] as const) {
    expect(await (await database.query('RETURN LENGTH(FOR row IN @@collection FILTER row.documentKey == @documentKey RETURN 1)', { '@collection': collectionName, documentKey: graph.documentKey })).next()).toBe(0);
  }
  const jobs = await (await database.query<string>('FOR job IN storageDeletionJobs FILTER STARTS_WITH(job.storageKey, "storage/") RETURN job.storageKey')).all();
  const prefix = JSON.parse(draft.content).data.subject;
  expect(jobs).toEqual(expect.arrayContaining([`storage/${prefix}.txt`, `storage/${prefix}.jpg`, `storage/${prefix}-source`, `storage/${prefix}-speech`, `storage/${prefix}-version`, `storage/${prefix}-summary-audio`, `storage/${prefix}-audio`]));
  expect(jobs).not.toContain(`storage/${prefix}-shared`);
}

liveArangoSuite('Gmail attachment ingestion and lifecycle live Arango', () => {
  test('rolls back every attachment reference mutation when the tone revision fence changes', async () => {
    const { root, temporary, temporaryName } = await createTemporaryDatabase();
    try {
      const fixture = await seedFixture(temporary, 'tone-fence');
      const threadKey = stableKey('mail-thread', fixture.scopeKey, fixture.connectorKey, 'tone-fence-thread');
      const graph = await seedAttachmentGraph(temporary, fixture, 'tone-fence', 'tone-fence-message', threadKey);
      const toneKey = newId();
      await temporary.collection('documents').save({ _key: toneKey, scopeKey: fixture.scopeKey, folderKey: mailFolderKeys(fixture.scopeKey).tones, name: 'Measured', content: encodeEmailToneContent({ identifier: newId(), name: 'Measured', instruction: 'Be precise.' }), embedding, isFavorite: false, mutationPolicy: 'user', createdAt: before, updatedAt: before });
      const selected = [
        ['emailAttachmentBindings', graph.documentBindingKey], ['emailAttachmentBindings', graph.imageBindingKey],
        ['documents', graph.draftKey], ['images', graph.imageKey], ['collections', graph.userCollectionKey],
      ] as const;
      const highlight = await (await temporary.query<Record<string, unknown>>('FOR row IN imageCollecitionHightlights FILTER @imageKey IN row.imageKeys LIMIT 1 RETURN row', { imageKey: graph.imageKey })).next();
      const beforeRows = await Promise.all(selected.map(([collection, key]) => temporary.collection(collection).document(key)));
      let changed = false;
      const database = {
        beginTransaction: temporary.beginTransaction.bind(temporary),
        collection: temporary.collection.bind(temporary),
        query: async (query: string, bindVars?: Record<string, unknown>) => {
          const cursor = await temporary.query(query, bindVars);
          if (!changed && query.trim().startsWith('FOR document') && query.includes('@toneFolderKey')) {
            return { next: cursor.next.bind(cursor), all: async () => {
              const rows = await cursor.all();
              await temporary.query('UPDATE @key WITH { updatedAt: @updatedAt } IN documents', { key: toneKey, updatedAt: at });
              changed = true;
              return rows;
            } };
          }
          return cursor;
        },
      };
      await expect(createScopeRepository(database as never, async () => embedding).removeScope(fixture.scopeKey)).rejects.toThrow('Scope contents changed during deletion');
      expect(changed).toBe(true);
      for (const [index, [collection, key]] of selected.entries()) expect(await temporary.collection(collection).document(key)).toEqual(beforeRows[index]);
      expect(await (await temporary.query('FOR row IN imageCollecitionHightlights FILTER @imageKey IN row.imageKeys LIMIT 1 RETURN row', { imageKey: graph.imageKey })).next()).toEqual(highlight);
      expect(await (await temporary.query('RETURN LENGTH(FOR job IN storageDeletionJobs RETURN 1)')).next()).toBe(0);

      await createScopeRepository(temporary as never, async () => embedding).removeScope(fixture.scopeKey);
      expect(await (await temporary.query('RETURN DOCUMENT(images, @key) == null', { key: graph.imageKey })).next()).toBe(true);
      expect(await (await temporary.query('RETURN LENGTH(FOR binding IN emailAttachmentBindings FILTER binding.scopeKey == @scopeKey RETURN 1)', { scopeKey: fixture.scopeKey })).next()).toBe(0);
      await temporary.collection('documents').save({ _key: graph.documentKey, scopeKey: fixture.scopeKey, managedPurpose: 'mail-attachment', managedOwnerKey: graph.documentBindingKey, mutationPolicy: 'user', storageKey: 'storage/late-after-scope-delete' });
      await createEmailAttachmentRepository(temporary).compensateTarget(graph.documentBindingKey, randomUUID(), 'document', graph.documentKey, fixture.scopeKey, at);
      expect(await (await temporary.query('RETURN DOCUMENT(documents, @key) == null', { key: graph.documentKey })).next()).toBe(true);
      expect(await (await temporary.query('RETURN LENGTH(FOR job IN storageDeletionJobs FILTER job.storageKey == "storage/late-after-scope-delete" RETURN 1)')).next()).toBe(1);
    } finally {
      temporary.close();
      await root.dropDatabase(temporaryName);
      root.close();
    }
  }, 60_000);

  test('authorizes owner/admin elevation or active scope membership and fences revocation before completion', async () => {
    const { root, temporary, temporaryName } = await createTemporaryDatabase();
    try {
      const fixture = await seedFixture(temporary, 'authorization');
      const repository = createEmailAttachmentRepository(temporary);
      await temporary.query('FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey REMOVE member IN scopeMembers', { scopeKey: fixture.scopeKey });
      await expect(repository.activeMembership({ organizationKey: fixture.organizationKey, scopeKey: fixture.scopeKey, preferredMembershipKey: fixture.membershipKey })).resolves.toBe(fixture.membershipKey);
      await temporary.query('UPDATE @key WITH { orgRole: "admin" } IN userOrganizations', { key: fixture.membershipKey });
      await expect(repository.activeMembership({ organizationKey: fixture.organizationKey, scopeKey: fixture.scopeKey, preferredMembershipKey: fixture.membershipKey })).resolves.toBe(fixture.membershipKey);

      await temporary.query('UPDATE @key WITH { orgRole: "member" } IN userOrganizations', { key: fixture.membershipKey });
      await expect(repository.activeMembership({ organizationKey: fixture.organizationKey, scopeKey: fixture.scopeKey, preferredMembershipKey: fixture.membershipKey })).rejects.toMatchObject({ code: 'ATTACHMENT_ACCESS_REVOKED' });
      const scopeMembershipKey = newId();
      await temporary.collection('scopeMembers').save({ _key: scopeMembershipKey, scopeKey: fixture.scopeKey, userOrganizationKey: fixture.membershipKey, role: 'member', status: 'active', source: 'explicit' });
      await expect(repository.activeMembership({ organizationKey: fixture.organizationKey, scopeKey: fixture.scopeKey, preferredMembershipKey: fixture.membershipKey })).resolves.toBe(fixture.membershipKey);
      await temporary.query('UPDATE @key WITH { status: "inactive" } IN scopeMembers', { key: scopeMembershipKey });
      await expect(repository.activeMembership({ organizationKey: fixture.organizationKey, scopeKey: fixture.scopeKey, preferredMembershipKey: fixture.membershipKey })).rejects.toMatchObject({ code: 'ATTACHMENT_ACCESS_REVOKED' });
      await temporary.query('UPDATE @key WITH { status: "active" } IN scopeMembers', { key: scopeMembershipKey });
      await temporary.query('UPDATE @key WITH { organizationId: @wrong } IN userOrganizations', { key: fixture.membershipKey, wrong: 'wrong-organization' });
      await expect(repository.activeMembership({ organizationKey: fixture.organizationKey, scopeKey: fixture.scopeKey, preferredMembershipKey: fixture.membershipKey })).rejects.toMatchObject({ code: 'ATTACHMENT_ACCESS_REVOKED' });

      await temporary.query('UPDATE @key WITH { organizationId: @organizationKey } IN userOrganizations', { key: fixture.membershipKey, organizationKey: fixture.organizationKey });
      const input = claimInput(fixture, '0.9');
      const token = randomUUID();
      await repository.claim(input, fixture.membershipKey, token, at, after);
      const folderKey = mailInboxFilesFolderKey(fixture.scopeKey, fixture.connectorKey);
      await temporary.collection('documents').save({ _key: input.targetKey, scopeKey: fixture.scopeKey, folderKey, managedPurpose: 'mail-attachment', managedOwnerKey: input.key, mutationPolicy: 'user' });
      await temporary.query('UPDATE @key WITH { status: "inactive" } IN userOrganizations', { key: fixture.membershipKey });
      expect(await repository.complete(input.key, token, 'document', input.targetKey, undefined, fixture.membershipKey, at)).toBe(false);
    } finally {
      temporary.close();
      await root.dropDatabase(temporaryName);
      root.close();
    }
  }, 60_000);

  test('fences claims, validates deterministic ownership, recovers receipts, and enforces completion contracts', async () => {
    const { root, temporary, temporaryName } = await createTemporaryDatabase();
    try {
      const fixture = await seedFixture(temporary, 'claims');
      const repository = createEmailAttachmentRepository(temporary);
      const input = claimInput(fixture, '0.1');
      const firstToken = randomUUID();
      const secondToken = randomUUID();
      const settled = await Promise.allSettled([
        repository.claim(input, fixture.membershipKey, firstToken, at, after),
        repository.claim(input, fixture.membershipKey, secondToken, at, after),
      ]);
      expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((result) => result.status === 'rejected' && result.reason instanceof EmailAttachmentIngestionError && result.reason.code === 'ATTACHMENT_BUSY')).toHaveLength(1);
      const winner = (settled.find(({ status }) => status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof repository.claim>>>).value.binding.leaseToken!;
      await expect(repository.claim(input, fixture.membershipKey, randomUUID(), before, after)).rejects.toMatchObject({ code: 'ATTACHMENT_BUSY' });
      const takeoverToken = randomUUID();
      expect((await repository.claim(input, fixture.membershipKey, takeoverToken, after, '2026-08-25T13:00:00.000Z')).binding.leaseToken).toBe(takeoverToken);

      await temporary.collection('documents').save({ _key: input.targetKey, scopeKey: fixture.scopeKey, folderKey: mailInboxFilesFolderKey(fixture.scopeKey, fixture.connectorKey), managedPurpose: 'mail-attachment', managedOwnerKey: input.key, mutationPolicy: 'user', name: 'target', content: 'target', extension: 'txt', mimeType: 'text/plain', sizeBytes: 5, embedding, isFavorite: false, createdAt: before, updatedAt: before });
      expect(await repository.complete(input.key, winner, 'document', input.targetKey, undefined, fixture.membershipKey, at)).toBe(false);
      await repository.release(input.key, winner);
      await repository.compensateTarget(input.key, winner, 'document', input.targetKey, fixture.scopeKey, at);
      expect(await temporary.collection('documents').document(input.targetKey)).toBeDefined();

      const recovered = await repository.recoverDocumentTarget({ bindingKey: input.key, leaseToken: takeoverToken, targetKey: input.targetKey, scopeKey: fixture.scopeKey, folderKey: mailInboxFilesFolderKey(fixture.scopeKey, fixture.connectorKey), membershipKey: fixture.membershipKey, now: at });
      expect(recovered?.key).toBe(input.targetKey);
      expect((await temporary.collection('emailAttachmentBindings').document(input.key) as { status: string }).status).toBe('processing');
      expect(await repository.complete(input.key, takeoverToken, 'document', input.targetKey, undefined, fixture.membershipKey, at)).toBe(true);
      expect((await temporary.collection('emailAttachmentBindings').document(input.key) as { status: string }).status).toBe('completed');

      const transactionalInput = claimInput(fixture, '0.2');
      const transactionalToken = randomUUID();
      await repository.claim(transactionalInput, fixture.membershipKey, transactionalToken, at, '2099-01-01T00:00:00.000Z');
      await temporary.collection('documents').save({ _key: transactionalInput.targetKey, scopeKey: fixture.scopeKey, folderKey: mailInboxFilesFolderKey(fixture.scopeKey, fixture.connectorKey), managedPurpose: 'mail-attachment', managedOwnerKey: transactionalInput.key, mutationPolicy: 'user', name: 'transactional.txt', content: 'transactional', extension: 'txt', mimeType: 'text/plain', sizeBytes: 13, embedding, isFavorite: false, createdAt: before, updatedAt: before });
      await createEmailRepository(temporary).syncThread({
        thread: { scopeKey: fixture.scopeKey, accountKey: fixture.connectorKey, providerThreadId: 'transactional-thread', subject: 'Transactional', summary: 'Transactional', intent: 'Review', priority: 'normal', state: 'done', lastMessageAt: at, unread: false, inboxCategory: 'Important', isFavorite: false, embedding },
        messages: [{ scopeKey: fixture.scopeKey, accountKey: fixture.connectorKey, providerMessageId: 'transactional-message', from: 'from@example.com', to: ['to@example.com'], subject: 'Transactional', body: 'Transactional', summary: 'Transactional', direction: 'inbound', sentAt: at, hasAttachments: true, attachments: [{ type: 'document', key: transactionalInput.targetKey }], unread: false, replyDepth: 0, inboxCategory: 'Important', embedding }],
        reconcileMessages: true,
        lease: { kind: 'sync', connectorKey: fixture.connectorKey, token: fixture.leaseToken },
        attachmentCommits: [{ bindingKey: transactionalInput.key, leaseToken: transactionalToken, targetType: 'document', targetKey: transactionalInput.targetKey, membershipKey: fixture.membershipKey }],
      });
      expect((await temporary.collection('emailAttachmentBindings').document(transactionalInput.key) as { status: string }).status).toBe('completed');
      expect(await (await temporary.query('FOR document IN documents FILTER document.scopeKey == @scopeKey LET payload = JSON_PARSE(document.content) FILTER payload.kind == "mail-message" && payload.data.providerMessageId == "transactional-message" RETURN payload.data.attachments', { scopeKey: fixture.scopeKey })).next()).toEqual([{ type: 'document', key: transactionalInput.targetKey }]);

      const folderKey = mailInboxFilesFolderKey(fixture.scopeKey, fixture.connectorKey);
      await temporary.collection('folders').save({ _key: folderKey, scopeKey: newId(), managedPurpose: 'other', mutationPolicy: 'user' });
      await expect(repository.ensureDocumentFolder(fixture.scopeKey, fixture.connectorKey, at)).rejects.toMatchObject({ code: 'ATTACHMENT_PERSIST_FAILED' });
      await temporary.collection('folders').remove(folderKey);
      const collectionKey = stableKey('email-media-collection', fixture.scopeKey);
      await temporary.collection('collections').save({ _key: collectionKey, scopeKey: newId(), purpose: 'other', mutationPolicy: 'user' });
      await expect(repository.ensureImageCollection(fixture.scopeKey, at)).rejects.toMatchObject({ code: 'ATTACHMENT_CONFLICT' });
      await temporary.collection('collections').remove(collectionKey);

      const invalidCases = [
        { part: '1.0', targetType: 'document' as const, target: { scopeKey: newId(), managedPurpose: 'mail-attachment' }, callType: 'document' as const },
        { part: '1.1', targetType: 'document' as const, target: { scopeKey: fixture.scopeKey, managedPurpose: 'other' }, callType: 'document' as const },
        { part: '1.2', targetType: 'document' as const, target: { scopeKey: fixture.scopeKey, managedPurpose: 'mail-attachment' }, callType: 'image' as const },
      ];
      for (const item of invalidCases) {
        const candidate = claimInput(fixture, item.part, item.targetType);
        const token = randomUUID();
        await repository.claim(candidate, fixture.membershipKey, token, at, after);
        await temporary.collection('documents').save({ _key: candidate.targetKey, ...item.target, folderKey, managedOwnerKey: item.target.managedPurpose === 'mail-attachment' ? newId() : candidate.key, mutationPolicy: 'user' });
        expect(await repository.complete(candidate.key, token, item.callType, candidate.targetKey, undefined, fixture.membershipKey, at)).toBe(false);
      }
      const wrongKeyInput = claimInput(fixture, '1.3');
      const wrongKeyToken = randomUUID();
      await repository.claim(wrongKeyInput, fixture.membershipKey, wrongKeyToken, at, after);
      expect(await repository.complete(wrongKeyInput.key, wrongKeyToken, 'document', newId(), undefined, fixture.membershipKey, at)).toBe(false);
      const imageInput = claimInput(fixture, '2.0', 'image');
      const imageToken = randomUUID();
      await repository.claim(imageInput, fixture.membershipKey, imageToken, at, after);
      await temporary.collection('images').save({ _key: imageInput.targetKey, scopeKey: fixture.scopeKey, mutationPolicy: 'system-only', createdByKey: newId() });
      const malformedCollection = newId();
      await temporary.collection('collections').save({ _key: malformedCollection, scopeKey: fixture.scopeKey, purpose: 'user-media', mutationPolicy: 'user' });
      expect(await repository.complete(imageInput.key, imageToken, 'image', imageInput.targetKey, malformedCollection, fixture.membershipKey, at)).toBe(false);

      const staleImageInput = claimInput(fixture, '2.1', 'image');
      const staleImageToken = randomUUID();
      await repository.claim(staleImageInput, fixture.membershipKey, staleImageToken, at, after);
      await repository.claim(staleImageInput, fixture.membershipKey, randomUUID(), after, '2026-08-25T13:00:00.000Z');
      await temporary.collection('images').save({ _key: staleImageInput.targetKey, scopeKey: fixture.scopeKey, mutationPolicy: 'system-only', createdByKey: fixture.membershipKey });
      await repository.compensateTarget(staleImageInput.key, staleImageToken, 'image', staleImageInput.targetKey, fixture.scopeKey, after);
      expect(await temporary.collection('images').document(staleImageInput.targetKey)).toBeDefined();

      const indexes = await temporary.collection('emailAttachmentBindings').indexes();
      const signatures = indexes.map((index) => `${index.fields?.join(',')}|${Boolean(index.unique)}|${Boolean(index.sparse)}`);
      expect(signatures).toContain('scopeKey,connectorKey,providerMessageId,partPath|true|false');
      expect(signatures).toContain('targetType,targetKey|true|false');
      expect(signatures).toContain('scopeKey|false|false');
      expect(signatures).toContain('leaseExpiresAt|false|true');
    } finally {
      temporary.close();
      await root.dropDatabase(temporaryName);
      root.close();
    }
  }, 60_000);

  test('executes reconciliation, provider deletion, clear-trash, and scope teardown cleanup AQL', async () => {
    const { root, temporary, temporaryName } = await createTemporaryDatabase();
    try {
      const fixture = await seedFixture(temporary, 'lifecycle');
      const repository = createEmailRepository(temporary);

      const reconcileThreadKey = stableKey('mail-thread', fixture.scopeKey, fixture.connectorKey, 'reconcile-thread');
      const staleMessageKey = stableKey('mail-message', fixture.scopeKey, fixture.connectorKey, 'reconcile-stale');
      const reconcilePlacement = mailPlacement(fixture);
      await temporary.collection('documents').import([
        mailDocument(reconcileThreadKey, fixture.scopeKey, reconcilePlacement.threadFolderKey, 'mail-thread', { accountKey: fixture.connectorKey, providerThreadId: 'reconcile-thread', subject: 'Reconcile', summary: 'Summary', intent: 'Review', priority: 'normal', state: 'done', lastMessageAt: before, isFavorite: false }),
        mailDocument(staleMessageKey, fixture.scopeKey, reconcilePlacement.messageFolderKey, 'mail-message', { accountKey: fixture.connectorKey, threadKey: reconcileThreadKey, providerMessageId: 'reconcile-stale', from: 'from@example.com', to: ['to@example.com'], subject: 'Stale', body: 'Body', summary: 'Body', direction: 'inbound', sentAt: before, hasAttachments: true }),
      ]);
      const reconcileGraph = await seedAttachmentGraph(temporary, fixture, 'reconcile', 'reconcile-stale', reconcileThreadKey);
      await repository.syncThread({
        thread: { scopeKey: fixture.scopeKey, accountKey: fixture.connectorKey, providerThreadId: 'reconcile-thread', subject: 'Reconcile', summary: 'Summary', intent: 'Review', priority: 'normal', state: 'done', lastMessageAt: at, unread: false, inboxCategory: 'Important', isFavorite: false, embedding },
        messages: [{ scopeKey: fixture.scopeKey, accountKey: fixture.connectorKey, providerMessageId: 'reconcile-keep', from: 'from@example.com', to: ['to@example.com'], subject: 'Keep', body: 'Body', summary: 'Body', direction: 'inbound', sentAt: at, hasAttachments: false, unread: false, replyDepth: 0, inboxCategory: 'Important', embedding }],
        reconcileMessages: true,
      });
      await assertAttachmentGraphDeleted(temporary, reconcileGraph);
      expect(await (await temporary.query('RETURN DOCUMENT(documents, @key) == null', { key: staleMessageKey })).next()).toBe(true);

      const deleteThreadKey = stableKey('mail-thread', fixture.scopeKey, fixture.connectorKey, 'delete-thread');
      const deleteMessageKey = stableKey('mail-message', fixture.scopeKey, fixture.connectorKey, 'delete-message');
      const deletePlacement = mailPlacement(fixture);
      await temporary.collection('documents').import([
        mailDocument(deleteThreadKey, fixture.scopeKey, deletePlacement.threadFolderKey, 'mail-thread', { accountKey: fixture.connectorKey, providerThreadId: 'delete-thread', subject: 'Delete', summary: 'Summary', intent: 'Delete', priority: 'normal', state: 'done', lastMessageAt: at, isFavorite: false }),
        mailDocument(deleteMessageKey, fixture.scopeKey, deletePlacement.messageFolderKey, 'mail-message', { accountKey: fixture.connectorKey, threadKey: deleteThreadKey, providerMessageId: 'delete-message', from: 'from@example.com', to: ['to@example.com'], subject: 'Delete', body: 'Body', summary: 'Body', direction: 'inbound', sentAt: at, hasAttachments: true }),
      ]);
      const deleteGraph = await seedAttachmentGraph(temporary, fixture, 'delete', 'delete-message', deleteThreadKey);
      await repository.deleteProviderThread(fixture.scopeKey, fixture.connectorKey, 'delete-thread', { connectorKey: fixture.connectorKey, token: fixture.leaseToken });
      await assertAttachmentGraphDeleted(temporary, deleteGraph);
      expect(await (await temporary.query('RETURN DOCUMENT(documents, @key) == null', { key: deleteThreadKey })).next()).toBe(true);

      const trashThreadKey = stableKey('mail-thread', fixture.scopeKey, fixture.connectorKey, 'trash-thread');
      const trashMessageKey = stableKey('mail-message', fixture.scopeKey, fixture.connectorKey, 'trash-message');
      const trashPlacement = mailPlacement(fixture);
      await temporary.collection('documents').import([
        mailDocument(trashThreadKey, fixture.scopeKey, trashPlacement.threadFolderKey, 'mail-thread', { accountKey: fixture.connectorKey, providerThreadId: 'trash-thread', subject: 'Trash', summary: 'Summary', intent: 'Delete', priority: 'normal', state: 'done', lastMessageAt: before, labels: ['TRASH'], isFavorite: false }),
        mailDocument(trashMessageKey, fixture.scopeKey, trashPlacement.messageFolderKey, 'mail-message', { accountKey: fixture.connectorKey, threadKey: trashThreadKey, providerMessageId: 'trash-message', from: 'from@example.com', to: ['to@example.com'], subject: 'Trash', body: 'Body', summary: 'Body', direction: 'inbound', sentAt: before, labels: ['TRASH'], hasAttachments: true }),
      ]);
      const trashGraph = await seedAttachmentGraph(temporary, fixture, 'trash', 'trash-message', trashThreadKey);
      const cleared = await repository.clearTrash({ scopeKey: fixture.scopeKey, accountKey: fixture.connectorKey, providerMessageIds: ['trash-message'], trashSnapshotAt: at, lease: { connectorKey: fixture.connectorKey, token: fixture.leaseToken } });
      expect(cleared.documentsDeleted).toBeGreaterThanOrEqual(2);
      await assertAttachmentGraphDeleted(temporary, trashGraph);

      const teardown = await seedFixture(temporary, 'teardown');
      const teardownThreadKey = stableKey('mail-thread', teardown.scopeKey, teardown.connectorKey, 'scope-thread');
      const teardownMessageKey = stableKey('mail-message', teardown.scopeKey, teardown.connectorKey, 'scope-message');
      const teardownPlacement = mailPlacement(teardown);
      await temporary.collection('documents').import([
        mailDocument(teardownThreadKey, teardown.scopeKey, teardownPlacement.threadFolderKey, 'mail-thread', { accountKey: teardown.connectorKey, providerThreadId: 'scope-thread', subject: 'Scope', summary: 'Summary', intent: 'Delete', priority: 'normal', state: 'done', lastMessageAt: at, isFavorite: false }),
        mailDocument(teardownMessageKey, teardown.scopeKey, teardownPlacement.messageFolderKey, 'mail-message', { accountKey: teardown.connectorKey, threadKey: teardownThreadKey, providerMessageId: 'scope-message', from: 'from@example.com', to: ['to@example.com'], subject: 'Scope', body: 'Body', summary: 'Body', direction: 'inbound', sentAt: at, hasAttachments: true }, { storageKey: 'storage/scope-message' }),
      ]);
      const teardownGraph = await seedAttachmentGraph(temporary, teardown, 'scope', 'scope-message', teardownThreadKey);
      const managedCollectionKey = stableKey('email-media-collection', teardown.scopeKey);
      await temporary.collection('collections').save({ _key: managedCollectionKey, scopeKey: teardown.scopeKey, name: 'Managed', purpose: 'email-media', mutationPolicy: 'system-only' });
      await temporary.collection('collectionImages').save({ _key: newId(), scopeKey: teardown.scopeKey, collectionKey: managedCollectionKey, imageKey: teardownGraph.imageKey });
      await createScopeRepository(temporary as never, async () => embedding).removeScope(teardown.scopeKey);
      for (const collection of ['scopes', 'scopeMembers', 'organizationConnectors', 'emailAttachmentBindings'] as const) {
        expect(await (await temporary.query('RETURN LENGTH(FOR row IN @@collection FILTER row.scopeKey == @scopeKey || row._key == @scopeKey RETURN 1)', { '@collection': collection, scopeKey: teardown.scopeKey })).next()).toBe(0);
      }
      expect(await (await temporary.query('RETURN DOCUMENT(images, @key) == null', { key: teardownGraph.imageKey })).next()).toBe(true);
      expect(await temporary.collection('images').document(teardownGraph.unrelatedImageKey)).toBeDefined();
      expect(await temporary.collection('imageCaptions').document(teardownGraph.captionKey)).toBeDefined();
      const teardownJobs = await (await temporary.query<string>('FOR job IN storageDeletionJobs RETURN job.storageKey')).all();
      expect(teardownJobs).toContain('storage/scope.jpg');
      expect(teardownJobs).toContain('storage/scope.txt');
      expect(teardownJobs).toContain('storage/scope-message');
    } finally {
      temporary.close();
      await root.dropDatabase(temporaryName);
      root.close();
    }
  }, 120_000);
});

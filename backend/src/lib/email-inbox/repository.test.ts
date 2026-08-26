import { describe, expect, test } from 'bun:test';
import { createEmailRepository, draftKeyFromOutboundMessageId, emailThreadKey } from './repository';
import { archiveDocument, decodeEmailTone, emailDraftPayloadSchema, emailMessagePayloadSchema, emailMessageSemanticText, emailThreadPayloadSchema, emailTonePayloadSchema, encodeEmailToneContent, emailToneSemanticText } from './archive-payloads';
import { DOCUMENT_CHUNK_MAX_CHARACTERS, DOCUMENT_CHUNK_MAX_WORDS, documentSemanticHash } from '@/lib/ai/document-processing/chunking';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { newId } from '@/lib/ids';
import { mailFolderKeys, mailInboxFolderKey } from './folders';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const documentKey = 'cmrnlzf650002qc7k4p5zem5w';

describe('mail provider mutations', () => {
  test('recognizes only deterministic outbound draft Message-IDs for sync recovery', () => {
    expect(draftKeyFromOutboundMessageId(`<vorinthex-${documentKey}@vorinthex.com>`)).toBe(documentKey);
    expect(draftKeyFromOutboundMessageId('<other@example.com>')).toBeNull();
    expect(draftKeyFromOutboundMessageId('<vorinthex-not-a-key@vorinthex.com>')).toBeNull();
  });
  test('matches provider threads only when message locators, normalized labels, and timestamps are exact', async () => {
    let query = '', bindVars: Record<string, unknown> = {};
    const stored = [
      { providerThreadId: 'same', messages: [{ providerMessageId: 'same-1', labels: ['STARRED', 'INBOX'], sentAt: '2026-08-23T12:00:00.000Z' }] },
      { providerThreadId: 'flags', messages: [{ providerMessageId: 'flags-1', labels: ['INBOX'], sentAt: '2026-08-23T12:00:00.000Z' }] },
      { providerThreadId: 'timestamp', messages: [{ providerMessageId: 'timestamp-1', labels: ['INBOX'], sentAt: '2026-08-23T12:00:00.000Z' }] },
      { providerThreadId: 'locator', messages: [{ providerMessageId: 'old-locator', labels: ['INBOX'], sentAt: '2026-08-23T12:00:00.000Z' }] },
      { providerThreadId: 'addition', messages: [{ providerMessageId: 'addition-1', labels: ['INBOX'], sentAt: '2026-08-23T12:00:00.000Z' }] },
      { providerThreadId: 'deletion', messages: [{ providerMessageId: 'deletion-1', labels: ['INBOX'], sentAt: '2026-08-23T12:00:00.000Z' }, { providerMessageId: 'deletion-2', labels: ['INBOX'], sentAt: '2026-08-23T12:01:00.000Z' }] },
    ];
    const database = { collection: () => ({}), query: async (value: string, values: Record<string, unknown>) => { query = value; bindVars = values; return { next: async () => ({ providerThreadIds: stored.map(({ providerThreadId }) => providerThreadId), messages: stored.flatMap(({ providerThreadId, messages }) => messages.map((message) => ({ providerThreadId, ...message }))) }) }; } };
    const state = (providerThreadId: string, providerMessageId: string, labels = ['INBOX'], sentAt = '2026-08-23T12:00:00.000Z') => ({ providerThreadId, messages: [{ providerMessageId, labels, sentAt }] });
    const unchanged = await createEmailRepository(database as never).unchangedProviderThreadIds(scopeKey, documentKey, [
      state('same', 'same-1', ['INBOX', 'STARRED', 'INBOX']),
      state('flags', 'flags-1', ['INBOX', 'STARRED']),
      state('timestamp', 'timestamp-1', ['INBOX'], '2026-08-23T12:00:01.000Z'),
      state('locator', 'new-locator'),
      { providerThreadId: 'addition', messages: [state('addition', 'addition-1').messages[0]!, state('addition', 'addition-2').messages[0]!] },
      state('deletion', 'deletion-1'),
      state('missing', 'missing-1'),
    ]);
    expect([...unchanged]).toEqual(['same']);
    expect(query).toContain('"managed-mail-folder", @scopeKey, "communication-mail-threads"');
    expect(query).toContain('CONCAT("mail-inbox\\u0000", @accountKey)');
    expect(query).toContain('payload.data.providerThreadId IN @providerThreadIds');
    expect(query).toContain('payload.data.threadKey IN threadKeys');
    expect(query).toContain('providerThreadIdsByKey[payload.data.threadKey]');
    expect(bindVars).toMatchObject({ scopeKey, accountKey: documentKey, providerThreadIds: ['same', 'flags', 'timestamp', 'locator', 'addition', 'deletion', 'missing'] });
  });
  test('atomically rejects stale sync and send owners before any thread or message write', async () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
    for (const kind of ['sync', 'send'] as const) {
      const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
      let declaration: any;
      const database = {
        collection: () => ({}),
        query: async (query: string, bindVars?: Record<string, unknown>) => { queries.push({ query, bindVars }); if (query.includes('RETURN inbox.name')) return { next: async () => 'Inbox' }; if (query.includes('RETURN folder._key')) return { next: async () => bindVars?.key }; if (query.includes('IN folders')) return {}; return { next: async () => undefined }; },
        beginTransaction: async (input: unknown) => { declaration = input; return { step: async <T>(operation: () => Promise<T>) => operation(), commit: async () => undefined, abort: async () => undefined }; },
      };
      await expect(createEmailRepository(database as never).syncThread({
        thread: { scopeKey, accountKey: documentKey, providerThreadId: 'thread', subject: 'Subject', summary: 'Body', intent: 'Review', priority: 'normal', state: 'needs_action', unread: false, lastMessageAt: '2026-08-23T12:00:00.000Z', isFavorite: false, inboxCategory: 'Important', embedding },
        messages: [{ scopeKey, accountKey: documentKey, providerMessageId: 'message', from: 'sender@example.com', to: ['me@example.com'], subject: 'Subject', body: 'Body', summary: 'Body', direction: 'inbound', unread: false, sentAt: '2026-08-23T12:00:00.000Z', hasAttachments: false, replyDepth: 0, inboxCategory: 'Important', embedding }],
        lease: { kind, connectorKey: documentKey, token: 'stale-token' },
      })).rejects.toThrow('lease was lost before persistence');
      expect(declaration.write).toContain('organizationConnectors');
      expect(queries.find(({ query }) => query.includes('connector[@tokenField]'))?.bindVars).toMatchObject({ tokenField: `${kind}LeaseToken`, expiryField: `${kind}LeaseExpiresAt` });
      expect(queries.some(({ query }) => query.includes('UPSERT { _key: @key } INSERT @document'))).toBe(false);
    }
  });

  test('UPSERTs repeated provider syncs to the same deterministic thread and message identities', async () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
    const documents = new Map<string, Record<string, unknown>>();
    const upsertedKeys: string[] = [];
    let declaration: { write: string[] } | undefined;
    const queries: string[] = [];
    const database = { collection: () => ({}), query: async (query: string, bindVars: Record<string, any> = {}) => {
      queries.push(query);
      if (query.includes('RETURN inbox.name')) return { next: async () => 'Inbox' };
      if (query.includes('RETURN folder._key')) return { next: async () => bindVars.key };
      if (query.includes('UPSERT { scopeKey: @scopeKey, purpose: @purpose }')) return {};
      if (query.includes('LET existing = DOCUMENT')) return { next: async () => true };
      if (query.includes('UPSERT { _key: @key } INSERT @document')) {
        documents.set(bindVars.key, bindVars.document);
        upsertedKeys.push(bindVars.key);
        return { next: async () => bindVars.document };
      }
      return { next: async () => undefined };
    }, beginTransaction: async (input: { write: string[] }) => { declaration = input; return { step: async <T>(operation: () => Promise<T>) => operation(), commit: async () => undefined, abort: async () => undefined }; } };
    const repository = createEmailRepository(database as never);
    const threadData = { accountKey: documentKey, providerThreadId: 'provider-thread', subject: 'Subject', summary: 'Body', intent: 'Review', priority: 'normal' as const, state: 'needs_action' as const, unread: false, lastMessageAt: '2026-08-23T12:00:00.000Z', isFavorite: false, inboxCategory: 'Important' as const };
    const messageData = { accountKey: documentKey, threadKey: emailThreadKey(scopeKey, documentKey, 'provider-thread'), providerMessageId: 'provider-message', from: 'sender@example.com', to: ['me@example.com'], subject: 'Subject', body: 'Body', summary: 'Body', direction: 'inbound' as const, unread: false, sentAt: '2026-08-23T12:00:00.000Z', hasAttachments: false, replyDepth: 0, inboxCategory: 'Important' as const };
    const representation = (content: string) => ({ content, embedding, contentChunks: ['semantic email'], chunkEmbeddings: [embedding], semanticChunkCount: 1, semanticContentHash: 'a'.repeat(64) });
    const input = {
      thread: { scopeKey, ...threadData, embedding, archiveRepresentation: representation(JSON.stringify(emailThreadPayloadSchema.parse({ version: 1, kind: 'mail-thread', data: threadData }))) },
      messages: [{ scopeKey, ...messageData, embedding, archiveRepresentation: representation(JSON.stringify(emailMessagePayloadSchema.parse({ version: 1, kind: 'mail-message', data: messageData }))) }],
    };
    await repository.syncThread(input);
    await repository.syncThread(input);
    expect(documents.size).toBe(2);
    expect(new Set(upsertedKeys).size).toBe(2);
    expect([...documents.values()].every((document) => Array.isArray(document.contentChunks) && Array.isArray(document.chunkEmbeddings) && document.semanticChunkCount === 1)).toBe(true);
    expect(upsertedKeys[0]).toBe(upsertedKeys[2]);
    expect(upsertedKeys[1]).toBe(upsertedKeys[3]);
    const persisted = [...documents.values()];
    expect(persisted.find((document) => JSON.parse(String(document.content)).kind === 'mail-thread')).toMatchObject({ folderKey: mailFolderKeys(scopeKey).threads, name: 'Subject', archiveVisibility: 'domain-only' });
    expect(persisted.find((document) => JSON.parse(String(document.content)).kind === 'mail-message')).toMatchObject({ folderKey: mailInboxFolderKey(scopeKey, documentKey), name: 'Subject', archiveVisibility: 'visible' });
    expect(JSON.parse(String(persisted.find((document) => JSON.parse(String(document.content)).kind === 'mail-message')?.content))).toMatchObject({ kind: 'mail-message', data: { body: 'Body', providerMessageId: 'provider-message' } });
    const cleanup = queries.find((query) => query.includes('LET staleProviderMessageIds'))!;
    expect(cleanup).toContain('REMOVE memory IN imageCollectionMemories');
    expect(cleanup).toContain('UPDATE highlight WITH { imageKeys: MINUS(');
    expect(cleanup).toContain('FOR folder IN folders FILTER folder.scopeKey == @scopeKey && folder.coverImageKey IN attachmentImages[*]._key');
    expect(cleanup.indexOf('LET cleanedAttachmentFolders')).toBeLessThan(cleanup.indexOf('LET removedAttachmentImages'));
    expect(declaration?.write).toEqual(['folders', 'documents', 'documentVersions', 'documentSummaries', 'documentSummaryAudio', 'documentAudioVersions', 'emailAttachmentBindings', 'images', 'imageCaptions', 'collectionImages', 'imageIdentities', 'imageCollectionMemories', 'imageCollecitionHightlights', 'placeImages', 'collections', 'trips', 'tagAssignments', 'shares', 'userHiddens', 'storageDeletionJobs']);
    expect((declaration as { exclusive?: string[] } | undefined)?.exclusive).toEqual(declaration?.write);
  });

  test('aborts before UPSERT when a deterministic key belongs to another provider identity', async () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
    const queries: string[] = [];
    const database = { collection: () => ({}), query: async (query: string, bindVars?: Record<string, unknown>) => { queries.push(query); if (query.includes('RETURN inbox.name')) return { next: async () => 'Inbox' }; if (query.includes('RETURN folder._key')) return { next: async () => bindVars?.key }; if (query.includes('IN folders')) return {}; return { next: async () => undefined }; } };
    await expect(createEmailRepository(database as never).syncThread({
      thread: { scopeKey, accountKey: documentKey, providerThreadId: 'provider-thread', subject: 'Subject', summary: 'Body', intent: 'Review', priority: 'normal', state: 'needs_action', unread: false, lastMessageAt: '2026-08-23T12:00:00.000Z', isFavorite: false, inboxCategory: 'Important', embedding },
      messages: [{ scopeKey, accountKey: documentKey, providerMessageId: 'provider-message', from: 'sender@example.com', to: ['me@example.com'], subject: 'Subject', body: 'Body', summary: 'Body', direction: 'inbound', unread: false, sentAt: '2026-08-23T12:00:00.000Z', hasAttachments: false, replyDepth: 0, inboxCategory: 'Important', embedding }],
    })).rejects.toThrow('another provider identity');
    expect(queries.some((query) => query.includes('UPSERT { _key: @key } INSERT @document'))).toBe(false);
  });

  test('fences thread/message favorite, read-state, and Trash writes by the live connector lease', async () => {
    const queries: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
    const database = {
      collection: () => ({}),
      query: async (query: string, bindVars: Record<string, unknown>) => { queries.push({ query, bindVars }); return { next: async () => undefined }; },
      beginTransaction: async () => ({ step: async <T>(operation: () => Promise<T>) => operation(), commit: async () => undefined, abort: async () => undefined }),
    };
    const repository = createEmailRepository(database as never);
    for (const mutation of [{ kind: 'favorite', isFavorite: true }, { kind: 'read-state', isRead: false }, { kind: 'trash' }] as const) {
      await expect(repository.mutateThreadState({ scopeKey, accountKey: documentKey, threadKey: documentKey, mutation, lease: { connectorKey: documentKey, token: '11111111-1111-4111-8111-111111111111' } })).rejects.toThrow('lease or selected thread changed');
    }
    const mutationQueries = queries.filter(({ query }) => query.includes('connector.syncLeaseToken'));
    expect(mutationQueries).toHaveLength(3);
    expect(mutationQueries.every(({ query }) => query.includes('payload.kind == "mail-message"') && query.includes('payload.data.threadKey == @threadKey'))).toBe(true);
    expect(mutationQueries.map(({ bindVars }) => bindVars.mutation)).toEqual(['favorite', 'read-state', 'trash']);
    expect(mutationQueries[0]!.query).toContain('isFavorite: @enabled, starred: @enabled');
    expect(mutationQueries[1]!.query).toContain('unread: !@enabled');
    expect(mutationQueries[1]!.query).toContain('starred: "STARRED" IN threadLabels, isFavorite: "STARRED" IN threadLabels');
    expect(mutationQueries[2]!.query).toContain('MERGE(threadPayload.data, { inInbox: true, labels: threadLabels })');
    expect(mutationQueries[2]!.query).not.toContain('inboxCategory: "Filtered"');
    expect(mutationQueries[2]!.query).not.toContain('priority: "low"');
    expect(mutationQueries[2]!.query).not.toContain('state: "filtered"');
  });

  test('hard-deletes local Trash threads, messages, reply drafts, and generated dependents under the connector fence', async () => {
    const queries: string[] = [];
    let declaration: { write: string[] } | undefined;
    const database = {
      collection: () => ({}),
      query: async (value: string) => { queries.push(value); return { next: async () => ({ threadsDeleted: 2, documentsDeleted: 6, emptyThreadKeys: [], survivingThreadKeys: [] }) }; },
      beginTransaction: async (input: { write: string[] }) => { declaration = input; return { step: async <T>(operation: () => Promise<T>) => operation(), commit: async () => undefined, abort: async () => undefined }; },
    };
    expect(await createEmailRepository(database as never).clearTrash({ scopeKey, accountKey: documentKey, providerMessageIds: ['provider-message'], trashSnapshotAt: '2026-08-23T12:00:00.000Z', lease: { connectorKey: documentKey, token: '11111111-1111-4111-8111-111111111111' } })).toMatchObject({ threadsDeleted: 2, documentsDeleted: 6 });
    const query = queries[0]!;
    expect(query).toContain('connector.syncLeaseToken == @leaseToken');
    expect(query).toContain('payload.kind == "mail-reply-draft"');
    expect(query).toContain('document.updatedAt <= @trashSnapshotAt');
    for (const collection of ['documentVersions', 'documentSummaries', 'documentSummaryAudio', 'documentAudioVersions', 'storageDeletionJobs']) expect(query).toContain(collection);
    expect(query).toContain('REMOVE memory IN imageCollectionMemories');
    expect(query).toContain('UPDATE highlight WITH { imageKeys: MINUS(');
    expect(query).toContain('FOR folder IN folders FILTER folder.scopeKey == @scopeKey && folder.coverImageKey IN attachmentImages[*]._key');
    expect(query.indexOf('LET cleanedAttachmentFolders')).toBeLessThan(query.indexOf('LET removedAttachmentImages'));
    expect(query).not.toContain('\0');
    expect(query).toContain('CONCAT_SEPARATOR("\\u0000", "email-attachment-target"');
    expect(queries).toHaveLength(1);
    expect(declaration?.write).toEqual(['folders', 'documents', 'documentVersions', 'documentSummaries', 'documentSummaryAudio', 'documentAudioVersions', 'emailAttachmentBindings', 'images', 'imageCaptions', 'collectionImages', 'imageIdentities', 'imageCollectionMemories', 'imageCollecitionHightlights', 'placeImages', 'collections', 'trips', 'tagAssignments', 'shares', 'userHiddens', 'storageDeletionJobs', 'organizationConnectors']);
    expect((declaration as { exclusive?: string[] } | undefined)?.exclusive).toEqual(declaration?.write);
    expect(query.indexOf('IN storageDeletionJobs')).toBeLessThan(query.indexOf('REMOVE audio IN documentSummaryAudio'));
  });

  test('hard provider-thread deletion transaction removes managed image memories and highlight references', async () => {
    const queries: string[] = [];
    let declaration: { write: string[] } | undefined;
    const database = {
      collection: () => ({}),
      query: async (query: string) => { queries.push(query); return { next: async () => ({ count: 4, attachmentTargetKeys: [], attachmentCaptionKeys: [] }) }; },
      beginTransaction: async (input: { write: string[] }) => { declaration = input; return { step: async <T>(operation: () => Promise<T>) => operation(), commit: async () => undefined, abort: async () => undefined }; },
    };
    await expect(createEmailRepository(database as never).deleteProviderThread(scopeKey, documentKey, 'provider-thread', { connectorKey: documentKey, token: '11111111-1111-4111-8111-111111111111' })).resolves.toMatchObject({ documentsDeleted: 4, attachmentMutation: { documentKeys: [], imageKeys: [], collectionKeys: [] } });
    const deletionQuery = queries[0]!;
    expect(deletionQuery).toContain('REMOVE memory IN imageCollectionMemories');
    expect(deletionQuery).toContain('UPDATE highlight WITH { imageKeys: MINUS(');
    expect(deletionQuery).toContain('FOR folder IN folders FILTER folder.scopeKey == @scopeKey && folder.coverImageKey IN attachmentImages[*]._key');
    expect(deletionQuery.indexOf('LET cleanedAttachmentFolders')).toBeLessThan(deletionQuery.indexOf('LET removedAttachmentImages'));
    expect(queries).toHaveLength(1);
    expect(declaration?.write).toEqual(expect.arrayContaining(['folders', 'imageCollectionMemories', 'imageCollecitionHightlights']));
  });

  test('authoritative reconciliation returns every stale provider thread under the lease without soft-hiding it', async () => {
    let query = '';
    const database = {
      collection: () => ({}),
      query: async (value: string) => { query = value; return { next: async () => ['stale-a', 'stale-b'] }; },
      beginTransaction: async () => ({ step: async <T>(operation: () => Promise<T>) => operation(), commit: async () => undefined, abort: async () => undefined }),
    };
    await expect(createEmailRepository(database as never).reconcileInbox(scopeKey, documentKey, ['kept'], { connectorKey: documentKey, token: '11111111-1111-4111-8111-111111111111' })).resolves.toEqual(['stale-a', 'stale-b']);
    expect(query).toContain('connector.syncLeaseToken == @leaseToken');
    expect(query).toContain('RETURN payload.data.providerThreadId');
    expect(query).not.toContain('inInbox: false');
    expect(query).not.toContain('UPDATE document');
  });
});

describe('mail draft and tone deletion', () => {
  test('hard-deletes only inactive drafts with all generated dependents and durable storage cleanup', async () => {
    let query = '';
    let declaration: { write: string[] } | undefined;
    const database = {
      collection: () => ({}),
      query: async (value: string) => { query = value; return { next: async () => ({ deletedKey: documentKey, storageKeys: ['draft-object'] }) }; },
      beginTransaction: async (input: { write: string[] }) => { declaration = input; return { step: async <T>(operation: () => Promise<T>) => operation(), commit: async () => undefined, abort: async () => undefined }; },
    };
    expect(await createEmailRepository(database as never).deleteDraft(scopeKey, documentKey)).toEqual({ deletedKey: documentKey, storageKeys: ['draft-object'] });
    expect(query).toContain('payload.data.status IN ["generated", "edited", "discarded"]');
    expect(query).toContain('document.folderKey == @folderKey');
    expect(query).toContain('document.mutationPolicy == "system-only"');
    expect(query).toContain('document.speechStorageKeys');
    expect(query).toContain('UNIQUE(');
    expect(query).not.toContain('"sending", "sent"');
    for (const collection of ['documents', 'documentVersions', 'documentSummaries', 'documentSummaryAudio', 'documentAudioVersions', 'storageDeletionJobs']) expect(declaration?.write).toContain(collection);
  });

  test('protects built-in tones and shared Gallery covers while deleting tone-owned dependents', async () => {
    let query = '';
    const tone = { name: 'Calm', instruction: 'Write calmly.' };
    const document = archiveDocument({ key: documentKey, scopeKey, folderKey: scopeKey, name: tone.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    document.content = encodeEmailToneContent(tone);
    const database = {
      collection: () => ({}),
      query: async (value: string) => { query = value; return { next: async () => value.includes('FOR document IN documents FILTER document._key == @key') ? { ...document, key: undefined, _key: document.key } : ({ deletedKey: documentKey, storageKeys: ['cover-object'] }) }; },
      beginTransaction: async () => ({ step: async <T>(operation: () => Promise<T>) => operation(), commit: async () => undefined, abort: async () => undefined }),
    };
    expect(await createEmailRepository(database as never).deleteTone(scopeKey, documentKey)).toEqual({ deletedKey: documentKey, storageKeys: ['cover-object'] });
    expect(query).toContain('document.folderKey == @folderKey');
    expect(query).toContain('document.mutationPolicy == "user"');
    expect(query).toContain('document.content == @expectedContent');
    expect(query).toContain('document.speechStorageKeys');
    expect(query).toContain('UNIQUE(');
    expect(query).not.toContain('DOCUMENT(images');
    expect(query).not.toContain('REMOVE image IN images');
    expect(query).not.toContain('cover.storageKey');
    for (const collection of ['documentVersions', 'documentSummaries', 'documentSummaryAudio', 'documentAudioVersions', 'storageDeletionJobs']) expect(query).toContain(collection);
  });

  test('requires canonical managed boundaries for every direct draft and tone operation', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    const draftSection = source.slice(source.indexOf('async createDraft'), source.indexOf('async resolveAttachments'));
    for (const marker of ['async getDraft', 'async assignDraftConnector', 'async searchDrafts', 'async updateDraft', 'async deleteDraft', 'async claimDraft']) {
      const start = draftSection.indexOf(marker);
      const end = draftSection.indexOf('\n    },', start);
      const operation = draftSection.slice(start, end);
      expect(operation).toContain('mailFolderKeys(scopeKey).drafts');
      expect(operation).toContain('system-only');
    }
    for (const marker of ['async renewDraftLease', 'async finishDraft']) {
      const start = draftSection.indexOf(marker);
      const end = draftSection.indexOf('\n    },', start);
      const operation = draftSection.slice(start, end);
      expect(operation).toContain('communication-mail-drafts');
      expect(operation).toContain('system-only');
      expect(operation).toContain('payload.version == 1');
      expect(operation).toContain('payload.kind IN ["mail-reply-draft", "mail-new-draft"]');
    }
    const toneSection = source.slice(source.indexOf('async listTones'));
    for (const marker of ['async listTones', 'async getTone', 'async updateTone', 'async deleteTone']) {
      const start = toneSection.indexOf(marker);
      const end = toneSection.indexOf('\n    },', start);
      const operation = toneSection.slice(start, end);
      expect(operation).toContain("'user'");
      expect(operation).toContain('mailFolderKeys(scopeKey).tones');
    }
  });

  test('does not read crafted ordinary Archive documents as drafts or tones', async () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
    const draft = archiveDocument({ key: documentKey, scopeKey, folderKey: newId(), name: 'Draft', payload: emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-new-draft', data: { variant: 'new', accountKey: scopeKey, to: ['person@example.com'], subject: 'Subject', generatedContent: 'Body', status: 'generated' } }), embedding, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', mutationPolicy: 'user' });
    const calls: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { calls.push({ query, bindVars }); return { next: async () => undefined, all: async () => [] }; }, collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    await expect(repository.getDraft(scopeKey, draft.key)).rejects.toThrow('not_found');
    expect(await repository.getTone(scopeKey, draft.key)).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls[0]?.bindVars).toMatchObject({ scopeKey, mutationPolicy: 'system-only' });
    expect(calls[1]?.bindVars).toMatchObject({ scopeKey, mutationPolicy: 'user' });
    expect(calls[0]?.bindVars.folderKey).not.toBe(draft.folderKey);
    expect(calls[1]?.bindVars.folderKey).not.toBe(draft.folderKey);
  });
});

test('listing tones performs no initialization or persistence writes', async () => {
  const queries: string[] = [];
  const database = {
    collection: () => ({}),
    query: async (query: string) => { queries.push(query); return { all: async () => [] }; },
  };
  expect(await createEmailRepository(database as never).listTones(scopeKey)).toEqual([]);
  expect(queries.some((query) => /\b(INSERT|UPDATE|REMOVE|UPSERT|REPLACE)\b/.test(query))).toBe(false);
});

test('listing drafts and reply context performs no initialization or persistence writes', async () => {
  const queries: string[] = [];
  const database = {
    collection: () => ({}),
    query: async (query: string) => { queries.push(query); return { all: async () => [] }; },
  };
  const repository = createEmailRepository(database as never);
  expect(await repository.listDrafts(scopeKey, newId())).toEqual([]);
  expect(await repository.listUnassignedDrafts(scopeKey)).toEqual([]);
  expect(await repository.listReplyContext(scopeKey)).toEqual([]);
  expect(queries.some((query) => /\b(INSERT|UPDATE|REMOVE|UPSERT|REPLACE)\b/.test(query))).toBe(false);
});

test('lists only subscription-created reply drafts in the Drafts surface', async () => {
  const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
  const folderKey = mailFolderKeys(scopeKey).drafts;
  const reply = (key: string, creationSource: 'manual' | 'subscription') => archiveDocument({ key, scopeKey, folderKey, name: 'Reply', payload: emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-reply-draft', data: { variant: 'reply', creationSource, replyMode: 'reply', threadKey: documentKey, messageKey: newId(), to: ['person@example.com'], cc: [], generatedContent: 'Body', status: 'generated' } }), embedding, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' });
  const automatic = reply(newId(), 'subscription');
  const manual = reply(newId(), 'manual');
  const composed = archiveDocument({ key: newId(), scopeKey, folderKey, name: 'New', payload: emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-new-draft', data: { variant: 'new', accountKey: documentKey, to: ['person@example.com'], subject: 'New', generatedContent: 'Body', status: 'generated' } }), embedding, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' });
  const stored = [manual, composed, automatic].map(({ key, ...document }) => ({ ...document, _key: key }));
  const database = { collection: () => ({}), query: async () => ({ all: async () => stored }) };
  expect((await createEmailRepository(database as never).listDrafts(scopeKey)).map(({ key }) => key)).toEqual([automatic.key]);
});

test('semantic tone search stays inside the protected tone folder and user mutation policy', async () => {
  let call: { query: string; bindVars: Record<string, unknown> } | undefined;
  const database = {
    collection: () => ({}),
    query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return { all: async () => [] }; },
  };
  expect(await createEmailRepository(database as never).searchTones(scopeKey, Array(EMBEDDING_DIMENSIONS).fill(0), '  Measured  ', 0.55, 12)).toEqual([]);
  expect(call?.query).toContain('document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "user"');
  expect(call?.query).toContain('COSINE_SIMILARITY(document.embedding, @embedding)');
  expect(call?.query).toContain('SORT direct DESC, score DESC');
  expect(call?.bindVars).toMatchObject({ scopeKey, query: 'measured', minimumScore: 0.55, limit: 12 });
});

describe('mail Archive repository attachments', () => {
  test('accepts only references resolved inside the authorized scope', async () => {
    let bindVars: Record<string, unknown> | undefined;
    const database = { query: async (_query: string, values: Record<string, unknown>) => { bindVars = values; return { all: async () => [{ type: 'document', key: documentKey, name: 'Plan' }] }; }, collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    const refs = [{ type: 'document' as const, key: documentKey }];
    expect(await repository.resolveAttachments(scopeKey, refs)).toEqual(refs);
    expect(bindVars).toMatchObject({ scopeKey, refs });
  });

  test('rejects missing, cross-scope, and duplicate references', async () => {
    const database = { query: async () => ({ all: async () => [] }), collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    await expect(repository.resolveAttachments(scopeKey, [{ type: 'image', key: documentKey }])).rejects.toThrow('authorized scope');
    await expect(repository.resolveAttachments(scopeKey, [{ type: 'document', key: documentKey }, { type: 'document', key: documentKey }])).rejects.toThrow('distinct');
  });

  test('atomically patches only requested draft fields after canonical authorization', async () => {
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return { next: async () => undefined }; }, collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    await expect(repository.updateDraft(scopeKey, { draftKey: documentKey, attachments: [] })).rejects.toThrow('already sending or finalized');
    expect(call?.query).toContain('payload.data.status IN ["generated", "edited"]');
    expect(call?.query).toContain('MERGE(payload.data, contentPatch, attachmentPatch');
    expect(call?.query).toContain('@hasFinalContent ? { embedding: @embedding } : {}');
    expect(call?.bindVars).toMatchObject({ hasFinalContent: false, hasAttachments: true, attachments: [] });
  });

  test('loads outbound refs only through same-scope and same-connector draft ownership', async () => {
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const refs = [{ type: 'document' as const, key: documentKey }];
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return { next: async () => refs }; }, collection: () => ({}) };
    expect(await createEmailRepository(database as never).outboundDraftAttachments(scopeKey, documentKey, documentKey)).toEqual(refs);
    expect(call?.query).toContain('draft.scopeKey == @scopeKey');
    expect(call?.query).toContain('payload.data.accountKey == @connectorKey');
    expect(call?.query).toContain('threadPayload.data.accountKey == @connectorKey');
    expect(call?.query).toContain('payload.data.status IN ["sending", "sent"]');
    expect(call?.bindVars).toMatchObject({ scopeKey, connectorKey: documentKey, draftKey: documentKey });
  });
});

describe('mail overview cursor pagination', () => {
  test('builds deterministic normalized sender, subject, and body semantic text', () => {
    expect(emailMessageSemanticText({ from: ' Sender@Example.COM ', subject: '  Project   update ', body: 'Line one\r\nLine two  ' } as never)).toBe('sender@example.com\n\nProject update\n\nLine one\nLine two');
  });

  test('returns fifty rows and binds cursors to scope, filter, and normalized search', async () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
    const documents = Array.from({ length: 51 }, (_, index) => {
      const key = newId();
      const lastMessageAt = new Date(Date.parse('2026-08-23T12:00:00.000Z') - index * 1000).toISOString();
      const payload = emailThreadPayloadSchema.parse({ version: 1, kind: 'mail-thread', data: { accountKey: documentKey, providerThreadId: `thread-${index}`, subject: `Thread ${index}`, summary: 'Summary', intent: 'Review', priority: 'normal', state: 'needs_action', lastMessageAt, inInbox: true, isFavorite: false } });
      return archiveDocument({ key, scopeKey, folderKey: scopeKey, name: `Thread ${index}`, payload, embedding, createdAt: lastMessageAt, updatedAt: lastMessageAt });
    });
    const calls: Array<{ query: string; bindVars: Record<string, any> }> = [];
    const database = { query: async (query: string, bindVars: Record<string, any>) => { calls.push({ query, bindVars }); return { next: async () => ({ documents: calls.length === 1 ? documents.map(({ key, ...document }) => ({ ...document, _key: key })) : [], counts: { all: 51, important: 0, urgent: 0, needsAction: 51, filtered: 0, unread: 0, favorite: 0, trash: 2 } }) }; }, collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    const first = await repository.overview(scopeKey, documentKey, { filter: 'all', search: '  PLAN  ' });
    expect(first.threads).toHaveLength(50);
    expect(first.nextCursor).toBeString();
    expect(first.counts).toMatchObject({ all: 51, needsAction: 51, trash: 2 });
    expect(calls[0]?.bindVars).toMatchObject({ scopeKey, connectorKey: documentKey, filter: 'all', search: 'plan', pageSize: 51 });
    expect(calls[0]?.query).toContain('LIMIT @pageSize');
    await repository.overview(scopeKey, documentKey, { filter: 'all', search: 'plan', cursor: first.nextCursor! });
    expect(calls[1]?.bindVars.after).toMatchObject({ key: first.threads.at(-1)!.key });
    await repository.overview(scopeKey, documentKey, { filter: 'trash', search: 'deleted' });
    expect(calls[2]?.bindVars).toMatchObject({ filter: 'trash', search: 'deleted' });
    expect(calls[2]?.query).toContain('@filter == "trash" && isTrash');
    expect(calls[2]?.query).toContain('"TRASH" NOT IN (row.data.labels || [])');
    await expect(repository.overview(scopeKey, documentKey, { filter: 'urgent', search: 'plan', cursor: first.nextCursor! })).rejects.toThrow('another connector, scope, or query');
    await expect(repository.overview(newId(), documentKey, { filter: 'all', search: 'plan', cursor: first.nextCursor! })).rejects.toThrow('another connector, scope, or query');
    await expect(repository.overview(scopeKey, newId(), { filter: 'all', search: 'plan', cursor: first.nextCursor! })).rejects.toThrow('another connector, scope, or query');
    await expect(repository.overview(scopeKey, documentKey, { filter: 'all', search: 'different', cursor: first.nextCursor! })).rejects.toThrow('another connector, scope, or query');
  });

  test('owns composite filtering, ordering, empty facets, sender search, and cursor fingerprints', async () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
    const documents = Array.from({ length: 2 }, (_, index) => {
      const key = newId();
      const lastMessageAt = new Date(Date.parse('2026-08-23T12:00:00.000Z') - index * 1000).toISOString();
      const payload = emailThreadPayloadSchema.parse({ version: 1, kind: 'mail-thread', data: { accountKey: documentKey, providerThreadId: `composite-${index}`, subject: `Thread ${index}`, summary: 'Summary', intent: 'Review', priority: 'normal', state: 'done', lastMessageAt, latestFrom: 'sender@example.com', unread: false, inboxCategory: 'Important', inInbox: true, isFavorite: index === 0 } });
      return archiveDocument({ key, scopeKey, folderKey: scopeKey, name: `Thread ${index}`, payload, embedding, createdAt: lastMessageAt, updatedAt: lastMessageAt });
    });
    const calls: Array<{ query: string; bindVars: Record<string, any> }> = [];
    const database = { query: async (query: string, bindVars: Record<string, any>) => { calls.push({ query, bindVars }); return { next: async () => ({ documents: documents.map(({ key, ...document }) => ({ ...document, _key: key })), counts: {} }) }; }, collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    const first = await repository.overview(scopeKey, documentKey, { readState: 'read', facets: ['favorite', 'urgent', 'favorite', 'important'], search: ' Sender@Example.COM ', limit: 1 });
    expect(first.threads).toHaveLength(1);
    expect(first.nextCursor).toBeString();
    expect(calls[0]?.bindVars).toMatchObject({ filter: null, readState: 'read', facets: ['urgent', 'important', 'favorite'], search: 'sender@example.com', pageSize: 2 });
    expect(calls[0]?.query).toContain('row.data.unread == (@readState == "unread")');
    expect(calls[0]?.query).toContain('LENGTH(@facets) > 0');
    expect(calls[0]?.query).toContain('messagePayload.data.from, messagePayload.data.subject, messagePayload.data.body');
    expect(calls[0]?.query).not.toContain('row.data.latestFrom');
    expect(calls[0]?.query).toContain('SORT row.data.lastMessageAt DESC, row.document._key ASC LIMIT @pageSize');
    await repository.overview(scopeKey, documentKey, { readState: 'read', facets: ['important', 'urgent', 'favorite'], search: 'sender@example.com', cursor: first.nextCursor!, limit: 1 });
    await expect(repository.overview(scopeKey, documentKey, { readState: 'unread', facets: ['urgent', 'important', 'favorite'], search: 'sender@example.com', cursor: first.nextCursor!, limit: 1 })).rejects.toThrow('another connector, scope, or query');
    await expect(repository.overview(scopeKey, documentKey, { readState: 'read', facets: ['urgent'], search: 'sender@example.com', cursor: first.nextCursor!, limit: 1 })).rejects.toThrow('another connector, scope, or query');
    await repository.overview(scopeKey, documentKey, { readState: 'unread', facets: [], limit: 10 });
    expect(calls.at(-1)?.bindVars).toMatchObject({ readState: 'unread', facets: [] });
  });
});

describe('similar mail repository', () => {
  test('searches sender, subject, and body embeddings across every message and returns one owning thread', async () => {
    const vector = Array(EMBEDDING_DIMENSIONS).fill(0.5);
    const threadKey = newId();
    const thread = archiveDocument({ key: threadKey, scopeKey, folderKey: scopeKey, name: 'Roadmap', embedding: vector, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', payload: emailThreadPayloadSchema.parse({ version: 1, kind: 'mail-thread', data: { accountKey: documentKey, providerThreadId: 'roadmap', subject: 'Roadmap', summary: 'Review', intent: 'Review', priority: 'high', state: 'needs_action', lastMessageAt: '2026-08-23T00:00:00.000Z', latestFrom: 'sender@example.com', unread: true, inboxCategory: 'Important', inInbox: true, isFavorite: true } }) });
    let call: { query: string; bindVars: Record<string, any> } | undefined;
    const database = { query: async (query: string, bindVars: Record<string, any>) => { call = { query, bindVars }; return { all: async () => [{ document: { ...thread, key: undefined, _key: thread.key }, score: 0.8 }] }; }, collection: () => ({}) };
    const result = await createEmailRepository(database as never).searchThreads(scopeKey, documentKey, vector, ' Roadmap ', 0.55, 10, { readState: 'unread', facets: ['favorite', 'important', 'favorite'] });
    expect(call?.bindVars).toMatchObject({ connectorKey: documentKey, query: 'roadmap', minimumScore: 0.55, limit: 10, readState: 'unread', facets: ['important', 'favorite'] });
    expect(call?.query).toContain('payload.data.accountKey == @connectorKey');
    expect(call?.query).toContain('payload.kind == "mail-message"');
    expect(call?.query).toContain('payload.data.embeddingContentVersion == 4');
    expect(call?.query).toContain('payload.data.from, payload.data.subject, payload.data.body');
    expect(call?.query).toContain('COLLECT threadKey = payload.data.threadKey INTO candidates = { document: document, payload: payload, thread: thread, threadPayload: threadPayload, score: score }');
    expect(call?.query).toContain('RETURN { document: selected.thread, score: selected.score }');
    expect(call?.query).toContain('"TRASH" NOT IN');
    expect(call?.query).toContain('threadPayload.data.unread == (@readState == "unread")');
    expect(call?.query).toContain('similarity >= @minimumScore');
    expect(result).toMatchObject([{ thread: { key: threadKey }, score: 0.8 }]);
  });

  test('uses the inclusive cosine threshold, exact categories, current embeddings, thread exclusion, and one owner result', async () => {
    const vector = Array(EMBEDDING_DIMENSIONS).fill(0.5);
    const ownerThreadKey = newId(), resultThreadKey = newId(), resultKey = newId();
    const source = archiveDocument({ key: documentKey, scopeKey, folderKey: scopeKey, name: 'Source', embedding: vector, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', payload: emailMessagePayloadSchema.parse({ version: 1, kind: 'mail-message', data: { accountKey: scopeKey, threadKey: ownerThreadKey, providerMessageId: 'source', from: 'a@example.com', to: ['b@example.com'], subject: 'Source', body: 'Body', summary: 'Body', direction: 'inbound', sentAt: '2026-08-23T00:00:00.000Z', hasAttachments: false, inboxCategory: 'Important', embeddingContentVersion: 3 } }) });
    const result = archiveDocument({ key: resultKey, scopeKey, folderKey: scopeKey, name: 'Result', embedding: vector, createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z', payload: emailMessagePayloadSchema.parse({ version: 1, kind: 'mail-message', data: { accountKey: scopeKey, threadKey: resultThreadKey, providerMessageId: 'result', from: 'c@example.com', to: ['b@example.com'], subject: 'Result', body: 'Related', summary: 'Related', direction: 'inbound', sentAt: '2026-08-22T00:00:00.000Z', hasAttachments: false, inboxCategory: 'Urgent', embeddingContentVersion: 3 } }) });
    let semanticQuery = '', semanticVars: Record<string, any> = {};
    const raw = ({ key, ...document }: Record<string, any>) => ({ ...document, _key: key });
    const database = { query: async (query: string, bindVars: Record<string, any>) => {
      if (query.startsWith('LET document = DOCUMENT')) return { next: async () => raw(source) };
      semanticQuery = query; semanticVars = bindVars; return { all: async () => [{ document: raw(result), similarity: 0.70 }] };
    }, collection: () => ({}) };
    const items = await createEmailRepository(database as never).similarMessages(scopeKey, documentKey, vector, 5);
    expect(semanticQuery).not.toContain('similarity >=');
    expect(semanticQuery).not.toContain('inboxCategory IN');
    expect(semanticQuery).toContain('payload.data.threadKey != @currentThreadKey');
    expect(semanticQuery).toContain('payload.data.embeddingContentVersion == 4');
    expect(semanticQuery).toContain('payload.data.accountKey == @accountKey');
    expect(semanticQuery).toContain('COLLECT threadKey = payload.data.threadKey');
    expect(semanticQuery.indexOf('COLLECT threadKey')).toBeLessThan(semanticQuery.indexOf('LIMIT @limit'));
    expect(semanticVars).toMatchObject({ currentThreadKey: ownerThreadKey, accountKey: scopeKey, embedding: vector, limit: 5 });
    expect(semanticVars).not.toHaveProperty('categories');
    expect(items).toMatchObject([{ similarity: 0.70, message: { key: resultKey, threadKey: resultThreadKey } }]);
  });
});

describe('reply context repository', () => {
  test('retrieves current-embedding mail context at the inclusive threshold with deterministic ranking, exclusions, and identity dedupe', async () => {
    let call: { query: string; bindVars: Record<string, any> } | undefined;
    const vector = Array(EMBEDDING_DIMENSIONS).fill(0.4);
    const currentThreadKey = newId();
    const currentMessageKey = newId();
    const duplicateProviderKey = newId();
    const outboundKey = newId();
    const threadKey = newId();
    const bestThreadMessageKey = newId();
    const duplicateOwnerThreadKey = newId();
    const raw = (document: ReturnType<typeof archiveDocument>) => ({ ...document, key: undefined, _key: document.key });
    const messageDocument = (key: string, providerMessageId: string, ownerThreadKey: string, direction: 'inbound' | 'outbound' = 'inbound') => archiveDocument({
      key, scopeKey, folderKey: scopeKey, name: 'Relevant reply', embedding: vector, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z',
      payload: emailMessagePayloadSchema.parse({ version: 1, kind: 'mail-message', data: { accountKey: documentKey, threadKey: ownerThreadKey, providerMessageId, from: direction === 'outbound' ? 'me@example.com' : 'you@example.com', to: [direction === 'outbound' ? 'you@example.com' : 'me@example.com'], subject: 'Relevant reply', body: 'A useful example.', summary: 'Useful', direction, sentAt: '2026-08-22T00:00:00.000Z', hasAttachments: false, replyDepth: direction === 'outbound' ? 1 : 0, embeddingContentVersion: 3 } }),
    });
    const threadDocument = archiveDocument({ key: threadKey, scopeKey, folderKey: scopeKey, name: 'Related thread', embedding: vector, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', payload: emailThreadPayloadSchema.parse({ version: 1, kind: 'mail-thread', data: { accountKey: documentKey, providerThreadId: 'provider-thread', subject: 'Related thread', summary: 'Related facts', intent: 'Coordinate', priority: 'normal', state: 'done', lastMessageAt: '2026-08-20T00:00:00.000Z', isFavorite: false, embeddingContentVersion: 3 } }) });
    const rows = [
      { document: raw(messageDocument(currentMessageKey, 'current-message', currentThreadKey)), similarity: 0.99 },
      { document: raw(messageDocument(newId(), 'current-thread-other', currentThreadKey)), similarity: 0.98 },
      { document: raw(messageDocument(duplicateProviderKey, 'duplicate-provider', duplicateOwnerThreadKey)), similarity: 0.70 },
      { document: raw(messageDocument(newId(), 'duplicate-provider', duplicateOwnerThreadKey)), similarity: 0.70 },
      { document: raw(messageDocument(outboundKey, 'outbound-reply', newId(), 'outbound')), similarity: 0.85 },
      { document: raw(messageDocument(bestThreadMessageKey, 'best-thread-message', threadKey)), similarity: 0.86 },
      { document: raw(threadDocument), similarity: 0.85 },
      { document: raw(messageDocument(newId(), 'below', newId())), similarity: 0.699999 },
      { document: raw(messageDocument(newId(), 'invalid', newId())), similarity: Number.NaN },
    ];
    const database = { query: async (query: string, bindVars: Record<string, any>) => { call = { query, bindVars }; return { all: async () => rows }; }, collection: () => ({}) };
    const items = await createEmailRepository(database as never).semanticReplyContext(scopeKey, vector, currentThreadKey, [currentMessageKey]);
    expect(call?.query).toContain('document.scopeKey == @scopeKey');
    expect(call?.query).toContain('"managed-mail-folder", @scopeKey, "communication-mail-threads"');
    expect(call?.query).toContain('CONCAT("mail-inbox\\u0000", payload.data.accountKey)');
    expect(call?.query).toContain('payload.data.embeddingContentVersion == 4');
    expect(call?.query).toContain('similarity >= @minimumSimilarity');
    expect(call?.query).toContain('SORT similarity DESC, document._key ASC');
    expect(call?.bindVars).toMatchObject({ scopeKey, currentThreadKey, currentMessageKeys: [currentMessageKey], minimumSimilarity: 0.70 });
    expect(items.slice(0, 2).map(({ key }) => key)).toEqual([bestThreadMessageKey, outboundKey]);
    expect(items.some(({ key }) => key === threadKey)).toBe(false);
    expect(items.filter((item) => item.kind === 'message' && item.threadKey === threadKey)).toHaveLength(1);
    expect(items.filter((item) => item.kind === 'message' && item.providerMessageId === 'duplicate-provider')).toHaveLength(1);
    expect(items.filter(({ similarity }) => similarity === 0.70)).toHaveLength(1);
    expect(items.some(({ key }) => key === currentMessageKey)).toBe(false);
    expect(items.some((item) => item.kind === 'message' && item.providerMessageId === 'current-thread-other')).toBe(false);
    expect(items.find(({ key }) => key === outboundKey)).toMatchObject({ kind: 'message', direction: 'outbound', trueOutboundReply: true });
  });

  test('persists canonical protected notes with semantic fields and transactional count and aggregate guards', async () => {
    let mutationQuery = '', persisted: Record<string, any> | undefined;
    const database = { query: async (query: string, bindVars?: Record<string, any>) => {
      if (query.includes('LET notes =')) { mutationQuery = query; persisted = bindVars?.document; return { next: async () => persisted }; }
      return {};
    }, collection: () => ({}) };
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.4);
    const note = await createEmailRepository(database as never).createReplyContext(scopeKey, { name: 'Availability', text: 'Never promise Friday meetings.', embedding });
    expect(note).toMatchObject({ name: 'Availability', text: 'Never promise Friday meetings.' });
    expect(mutationQuery).toContain('replyContextRevision');
    expect(mutationQuery).toContain('LENGTH(notes) < @maximumNotes');
    expect(mutationQuery).toContain('SUM(notes[* RETURN LENGTH(CURRENT.text)]) + LENGTH(@text) <= @maximumCharacters');
    expect(persisted).toMatchObject({ mutationPolicy: 'system-only', emailReplyContextEmbeddingVersion: 1, semanticChunkCount: 1, contentChunks: ['Availability\n\nNever promise Friday meetings.'], chunkEmbeddings: [embedding] });
    expect(persisted?.semanticContentHash).toBe(documentSemanticHash('Availability\n\nNever promise Friday meetings.'));
    expect(JSON.parse(persisted!.content)).toEqual({ version: 1, kind: 'mail-reply-context', data: { name: 'Availability', text: 'Never promise Friday meetings.' } });
  });

  test('uses an updatedAt and Arango revision fence and keeps bulk deletion atomic across scope and kind', async () => {
    const calls: string[] = [];
    const database = { query: async (query: string) => { calls.push(query); return query.includes('REMOVE document') ? { all: async () => [] } : { next: async () => null }; }, collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    await expect(repository.deleteReplyContext(scopeKey, [documentKey])).rejects.toThrow('authorized workspace');
    const deletion = calls.at(-1)!;
    expect(deletion).toContain('LENGTH(matches) == LENGTH(@noteKeys)');
    expect(deletion).toContain('document.scopeKey == @scopeKey');
    expect(deletion).toContain('payload.kind == "mail-reply-context"');
    expect(deletion).toContain('REMOVE document IN documents');

    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source).toContain("withDatabaseTransaction<T>(database as typeof db, { read: [], write: ['folders', 'documents'] }");
    const list = source.slice(source.indexOf('async listReplyContext'), source.indexOf('async getReplyContext'));
    expect(list).toContain('LIMIT 21 RETURN document');
    expect(list).toContain('notes.length > REPLY_CONTEXT_MAX_NOTES');
    expect(list).toContain('> REPLY_CONTEXT_MAX_CHARACTERS');
    const create = source.slice(source.indexOf('async createReplyContext'), source.indexOf('async updateReplyContext'));
    const update = source.slice(source.indexOf('async updateReplyContext'), source.indexOf('/** Atomic:', source.indexOf('async updateReplyContext')));
    const conflictTarget = 'folder._key == @folderKey && folder.scopeKey == @scopeKey';
    expect(create).toContain(conflictTarget);
    expect(update).toContain(conflictTarget);
    expect(source).toContain("error.errorNum === 1200");
    expect(update).toContain('current.updatedAt == @expectedUpdatedAt');
    expect(update).toContain('current._rev == @expectedRevision');
    expect(update).toContain('otherTextLength + LENGTH(@text) <= @maximumCharacters');
    expect(update).toContain('replyContextRevision');
    expect(deletion).not.toContain('_internalDeletion');
    expect(deletion).not.toContain('UPDATE document');
  });
});

describe('legacy draft assignment', () => {
  test('idempotently updates only editable unassigned new drafts', async () => {
    let query = '';
    const database = { query: async (value: string) => { query = value; return { next: async () => null }; }, collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    await expect(repository.assignDraftConnector(scopeKey, documentKey, newId())).rejects.toThrow('could not be assigned');
    expect(query).toContain('payload.kind == "mail-new-draft"');
    expect(query).toContain('payload.data.accountKey IN [@scopeKey, @connectorKey]');
    expect(query).toContain('payload.data.status IN ["generated", "edited"]');
  });
});

describe('mail dependent persistence', () => {
  test('deletes message derivatives in the same exclusive transaction as provider threads', async () => {
    let declaration: Record<string, string[]> | undefined;
    const queries: string[] = [];
    const database = {
      async beginTransaction(value: Record<string, string[]>) {
        declaration = value;
        return { async step(run: () => Promise<unknown>) { return run(); }, async commit() {}, async abort() {} };
      },
      async query(query: string) { queries.push(query); return { next: async () => ({ count: 1, attachmentTargetKeys: [], attachmentCaptionKeys: [] }) }; },
      collection: () => ({}),
    };
    await createEmailRepository(database as never).deleteProviderThread(scopeKey, documentKey, 'provider-thread', { connectorKey: documentKey, token: '11111111-1111-4111-8111-111111111111' });
    const deletion = queries[0]!;
    const collections = ['folders', 'documents', 'documentVersions', 'documentSummaries', 'documentSummaryAudio', 'documentAudioVersions', 'emailAttachmentBindings', 'images', 'imageCaptions', 'collectionImages', 'imageIdentities', 'imageCollectionMemories', 'imageCollecitionHightlights', 'placeImages', 'collections', 'trips', 'tagAssignments', 'shares', 'userHiddens', 'storageDeletionJobs', 'organizationConnectors'];
    expect(declaration?.write).toEqual(collections);
    expect(declaration?.exclusive).toEqual(collections);
    for (const collection of collections.filter((name) => !['organizationConnectors', 'imageCaptions'].includes(name))) expect(deletion).toContain(`IN ${collection}`);
    expect(await Bun.file(new URL('./repository.ts', import.meta.url)).text()).toContain('REMOVE caption IN imageCaptions');
    expect(deletion).toContain('DOCUMENT(@@connectors, @connectorKey)');
    expect(deletion.indexOf('REMOVE audio IN documentSummaryAudio')).toBeLessThan(deletion.indexOf('REMOVE summary IN documentSummaries'));
    expect(deletion.indexOf('IN storageDeletionJobs')).toBeLessThan(deletion.indexOf('REMOVE audio IN documentSummaryAudio'));
  });

  test('atomically bulk-deletes only generated rows owned by one mail-message and queues summary audio', async () => {
    const translationKeys = [newId(), newId()], summaryKeys = [newId(), newId()];
    const calls: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
    let declaration: Record<string, string[]> | undefined;
    const database = {
      beginTransaction: async (value: Record<string, string[]>) => { declaration = value; return { step: async <T>(run: () => Promise<T>) => run(), commit: async () => undefined, abort: async () => undefined }; },
      query: async (query: string, bindVars: Record<string, unknown>) => { calls.push({ query, bindVars }); return { next: async () => query.includes('documentVersions') ? { messageKey: documentKey, deletedKeys: translationKeys } : { messageKey: documentKey, deletedKeys: summaryKeys, storageKeys: ['summary.mp3'] } }; },
      collection: () => ({}),
    };
    const repository = createEmailRepository(database as never);
    expect(await repository.deleteMessageTranslations(scopeKey, documentKey, translationKeys)).toEqual({ messageKey: documentKey, deletedKeys: translationKeys });
    expect(await repository.deleteMessageSummaries(scopeKey, documentKey, summaryKeys)).toEqual({ messageKey: documentKey, deletedKeys: summaryKeys, storageKeys: ['summary.mp3'] });
    const translation = calls[0]!.query, summary = calls[1]!.query;
    for (const query of [translation, summary]) {
      expect(query).toContain('document.mutationPolicy == "system-only"');
      expect(query).toContain('payload.kind == "mail-message"');
      expect(query).toContain('LENGTH(selected) == LENGTH');
    }
    expect(translation).toContain('version.type == "translation"');
    expect(summary.indexOf('IN storageDeletionJobs')).toBeLessThan(summary.indexOf('REMOVE audio IN documentSummaryAudio'));
    expect(summary.indexOf('REMOVE audio IN documentSummaryAudio')).toBeLessThan(summary.indexOf('REMOVE summary IN documentSummaries'));
    expect(declaration?.write).toEqual(expect.arrayContaining(['documents', 'documentVersions', 'documentSummaries', 'documentSummaryAudio', 'storageDeletionJobs']));
  });

  test('queues summary-audio storage before every stale mail message deletion path', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    for (const marker of ['if (input.reconcileMessages !== false)', 'async clearTrash', 'async deleteProviderThread']) {
      const start = source.indexOf(marker);
      const section = source.slice(start, source.indexOf('\n    },', start));
      expect(section).toContain('documentSummaryAudio');
      expect(section).toContain('candidateStorageKeys');
      expect(section).toContain('IN storageDeletionJobs');
      expect(section.indexOf('IN storageDeletionJobs')).toBeLessThan(section.indexOf('REMOVE audio IN documentSummaryAudio'));
    }
  });

  test('allocates distinct generated versions through exclusive collection transactions', async () => {
    const declarations: Array<Record<string, string[]>> = [];
    let version = 0;
    const database = {
      async beginTransaction(value: Record<string, string[]>) {
        declarations.push(value);
        return { async step(run: () => Promise<unknown>) { return run(); }, async commit() {}, async abort() {} };
      },
      async query(_query: string, bindVars: Record<string, any>) {
        const nextVersion = ++version;
        return { async next() { return { ...bindVars.snapshot, _key: bindVars.key, version: nextVersion, createdAt: bindVars.createdAt }; } };
      },
      collection: () => ({}),
    };
    const repository = createEmailRepository(database as never);
    const input = { scopeKey, documentKey, type: 'translation' as const, language: 'French', label: 'French translation', content: 'Bonjour.', embedding: Array(EMBEDDING_DIMENSIONS).fill(0.2), chunkEmbeddings: [Array(EMBEDDING_DIMENSIONS).fill(0.2)], semanticChunkCount: 1, semanticContentHash: documentSemanticHash('Bonjour.') };
    const results = await Promise.all([repository.createMessageTranslation(input), repository.createMessageTranslation(input)]);
    expect(results.map(({ version }) => version)).toEqual([1, 2]);
    expect(declarations).toHaveLength(2);
    expect(declarations.every(({ read, write, exclusive }) => read?.includes('documents') && write?.includes('documentVersions') && exclusive?.includes('documentVersions'))).toBe(true);
  });
});

describe('mail tone persistence', () => {
  test('strips legacy tone cover keys while decoding editable Archive content', () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.5);
    const tone = { name: 'Calm', instruction: 'Write calmly.' };
    const document = archiveDocument({ key: documentKey, scopeKey, folderKey: scopeKey, name: tone.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), embedding, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    document.content = encodeEmailToneContent(tone);
    expect(decodeEmailTone({ ...document, coverImageKey: documentKey })).toMatchObject({ key: documentKey, name: tone.name });
    expect(decodeEmailTone({ ...document, coverImageKey: documentKey })).not.toHaveProperty('coverImageKey');
  });

  test('embeds placeholder edited content, skips populated tones, and seeds missing defaults without overwriting', async () => {
    const warmKey = 'c243153d93fec022e17d04bc4';
    const conciseKey = 'c8557168cd0ddd166ee24e569';
    const placeholder = Array(EMBEDDING_DIMENSIONS).fill(0);
    const populatedEmbedding = Array(EMBEDDING_DIMENSIONS).fill(0.9);
    const warm = { slug: 'warm' as const, name: 'Warm' as const, instruction: 'Use my edited voice.' };
    const concise = { slug: 'concise' as const, name: 'Concise' as const, instruction: 'Keep this existing tone.' };
    const edited = archiveDocument({ key: warmKey, scopeKey, folderKey: scopeKey, name: warm.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: warm }), embedding: placeholder, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    edited.content = encodeEmailToneContent(warm);
    const populated = archiveDocument({ key: conciseKey, scopeKey, folderKey: scopeKey, name: concise.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: concise }), embedding: populatedEmbedding, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    populated.content = encodeEmailToneContent(concise);
    populated.emailToneEmbeddingVersion = 1;
    populated.contentChunks = [emailToneSemanticText(concise)];
    populated.chunkEmbeddings = [populatedEmbedding];
    populated.semanticChunkCount = 1;
    populated.semanticContentHash = documentSemanticHash(emailToneSemanticText(concise));
    const raw = ({ key, ...document }: Record<string, any>): Record<string, any> => ({ ...document, _key: key });
    const documents = [raw(edited), raw(populated)];
    const seeds: Record<string, any>[] = [];
    const updates: Array<{ key: string; patch: Record<string, any> }> = [];
    const embeddedContent: string[] = [];
    const database = { query: async (query: string, bindVars?: Record<string, any>) => {
      if (bindVars?.document) { seeds.push(bindVars.document); documents.push(bindVars.document); }
      if (bindVars?.patch) {
        updates.push({ key: bindVars.key, patch: bindVars.patch });
        Object.assign(documents.find((document) => document._key === bindVars.key)!, bindVars.patch);
      }
      return { all: async () => query.includes('FOR document IN documents') ? documents : [] };
    }, collection: () => ({}) };
    const tones = await createEmailRepository(database as never).initializeTones(scopeKey, async (content) => {
      embeddedContent.push(content);
      return Array(EMBEDDING_DIMENSIONS).fill(content === warm.name ? 0.1 : 0.2);
    });
    expect(embeddedContent).toContain(warm.name);
    expect(embeddedContent).not.toContain(populated.content);
    expect(embeddedContent).toHaveLength(4);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ key: warmKey, patch: { embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1), contentChunks: [emailToneSemanticText(warm)], chunkEmbeddings: [Array(EMBEDDING_DIMENSIONS).fill(0.1)], semanticChunkCount: 1, emailToneEmbeddingVersion: 1 } });
    expect(updates[0]!.patch.semanticContentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(seeds).toHaveLength(3);
    expect(seeds.map(({ name }) => name)).toEqual(['Casual', 'Formal', 'Direct']);
    expect(seeds.some(({ name }) => name === 'Warm' || name === 'Concise')).toBe(false);
    expect(seeds.every(({ mutationPolicy, content }) => mutationPolicy === 'user' && content.includes('vorinthex-mail-tone'))).toBe(true);
    expect(seeds.map(({ _key }) => _key)).not.toContain(warmKey);
    expect(documents.find(({ _key }) => _key === warmKey)?.content).toBe(edited.content);
    expect(tones).toContainEqual(expect.objectContaining({ key: warmKey, slug: 'warm', instruction: warm.instruction }));
    expect(tones.find(({ key }) => key === warmKey)).not.toHaveProperty('description');
  });

  test('repairs an Archive-edited tone whose generic embedding covered the full document', async () => {
    const tone = { name: 'Archive Calm', instruction: 'Avoid exclamation marks.' };
    const fullContent = encodeEmailToneContent(tone);
    const document = archiveDocument({ key: documentKey, scopeKey, folderKey: scopeKey, name: tone.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), embedding: Array(EMBEDDING_DIMENSIONS).fill(0.8), createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    Object.assign(document, { content: fullContent, contentChunks: [fullContent], chunkEmbeddings: [document.embedding], semanticChunkCount: 1, semanticContentHash: documentSemanticHash(fullContent) });
    let repair: Record<string, any> | undefined;
    const database = { query: async (query: string, bindVars?: Record<string, any>) => {
      if (bindVars?.patch) repair = bindVars.patch;
      return { all: async () => query.includes('FOR document IN documents') ? [{ ...document, key: undefined, _key: document.key }] : [] };
    }, collection: () => ({}) };
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.3);
    await createEmailRepository(database as never).initializeTones(scopeKey, async (text) => {
      if (text === tone.name) return embedding;
      return Array(EMBEDDING_DIMENSIONS).fill(0.1);
    });
    expect(repair).toMatchObject({ embedding, contentChunks: [tone.name], chunkEmbeddings: [embedding], semanticChunkCount: 1, semanticContentHash: documentSemanticHash(tone.name), emailToneEmbeddingVersion: 1 });
  });

  test('persists max-boundary tone inputs with name-only semantics', async () => {
    const instruction = 'i'.repeat(20_000);
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.25);
    let persisted: Record<string, any> | undefined, updateVars: Record<string, any> | undefined;
    const database = { query: async (query: string, bindVars?: Record<string, any>) => {
      if (query.includes('INSERT @document')) persisted = bindVars?.document;
      if (query.includes('UPDATE document WITH MERGE')) updateVars = bindVars;
      return { all: async () => [], next: async () => {
        if (!persisted) return null;
        if (query.includes('INSERT @document')) return persisted;
        if (query.includes('UPDATE document WITH MERGE')) {
          persisted = { ...persisted, name: bindVars?.name, content: bindVars?.content, embedding: bindVars?.embedding, contentChunks: bindVars?.contentChunks, chunkEmbeddings: bindVars?.chunkEmbeddings, semanticChunkCount: bindVars?.semanticChunkCount, semanticContentHash: bindVars?.semanticContentHash, updatedAt: bindVars?.updatedAt };
          return persisted;
        }
        return persisted;
      } };
    }, collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    const result = await repository.createTone(scopeKey, { name: 'n'.repeat(255), instruction, isFavorite: false, embedding });
    expect(result.instruction).toBe(instruction);
    expect(persisted?.contentChunks).toEqual(['n'.repeat(255)]);
    expect(persisted?.contentChunks.every((chunk: string) => chunk.length <= DOCUMENT_CHUNK_MAX_CHARACTERS && (chunk.match(/\S+/g)?.length ?? 0) <= DOCUMENT_CHUNK_MAX_WORDS)).toBe(true);
    expect(persisted?.chunkEmbeddings.every((value: number[]) => value === persisted?.embedding || value.every((item, index) => item === embedding[index]))).toBe(true);
    expect(persisted?.semanticContentHash).toBe(documentSemanticHash('n'.repeat(255)));
    expect(persisted?.contentChunks.join('')).not.toContain(instruction);
    const updated = await repository.updateTone(scopeKey, result.key, result.updatedAt, { name: 'u'.repeat(255), instruction, embedding });
    expect(updated).toMatchObject({ name: 'u'.repeat(255), instruction });
    expect(updateVars?.contentChunks).toEqual(['u'.repeat(255)]);
    expect(updateVars?.contentChunks.every((chunk: string) => chunk.length <= DOCUMENT_CHUNK_MAX_CHARACTERS && (chunk.match(/\S+/g)?.length ?? 0) <= DOCUMENT_CHUNK_MAX_WORDS)).toBe(true);
  });

  test('selects an edited tone by slug through writingProfile', async () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.5);
    const tone = { slug: 'warm' as const, name: 'Warm' as const, instruction: 'Use my edited voice.' };
    const edited = archiveDocument({ key: 'c243153d93fec022e17d04bc4', scopeKey, folderKey: scopeKey, name: tone.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), embedding, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    edited.content = encodeEmailToneContent(tone);
    const database = { query: async (query: string) => ({ all: async () => query.includes('FOR document IN documents') ? [{ ...edited, key: undefined, _key: edited.key }] : [] }), collection: () => ({ update: async () => undefined }) };
    const profile = await createEmailRepository(database as never).writingProfile(scopeKey, undefined, 'warm');
    expect(profile).toMatchObject({ slug: 'warm', tone: tone.instruction, style: '', structure: '', vocabulary: tone.instruction });
  });

  test('rejects unknown selectors instead of falling back to the first scoped tone', async () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.5);
    const tone = { slug: 'warm' as const, name: 'Warm' as const, instruction: 'Write warmly.' };
    const document = archiveDocument({ key: documentKey, scopeKey, folderKey: scopeKey, name: tone.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), embedding, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    document.content = encodeEmailToneContent(tone);
    const database = { query: async (query: string) => ({ all: async () => query.includes('FOR document IN documents') ? [{ ...document, key: undefined, _key: document.key }] : [] }), collection: () => ({ update: async () => undefined }) };
    const repository = createEmailRepository(database as never);
    expect(await repository.writingProfile(scopeKey, undefined, 'unknown')).toBeNull();
    expect(await repository.writingProfile(scopeKey, newId())).toBeNull();
  });

  test('lists valid tones when unrelated and malformed tone-folder documents are present', async () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.5);
    const tone = { name: 'Calm', instruction: 'Write calmly.' };
    const valid = archiveDocument({ key: documentKey, scopeKey, folderKey: scopeKey, name: tone.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), embedding, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    valid.content = encodeEmailToneContent(tone);
    const malformed = { ...valid, key: undefined, _key: 'c243153d93fec022e17d04bc4', content: '# Not a valid tone', embedding: Array(EMBEDDING_DIMENSIONS).fill(0) };
    const unrelated = { _key: newId(), scopeKey, folderKey: scopeKey, name: '', content: '', embedding: [], createdAt: 'invalid', updatedAt: 'invalid' };
    const documents = [{ ...valid, key: undefined, _key: valid.key }, malformed, unrelated];
    const database = { query: async (query: string, bindVars?: Record<string, any>) => ({ all: async () => query.includes('FOR document IN documents') ? documents : [], next: async () => bindVars?.document ?? null }), collection: () => ({ update: async () => undefined }) };
    await expect(createEmailRepository(database as never).initializeTones(scopeKey, async () => embedding)).resolves.toContainEqual(expect.objectContaining({ key: documentKey, name: tone.name }));
  });
});

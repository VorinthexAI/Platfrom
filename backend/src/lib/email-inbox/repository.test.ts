import { describe, expect, test } from 'bun:test';
import { createEmailRepository } from './repository';
import { archiveDocument, decodeEmailTone, emailMessagePayloadSchema, emailMessageSemanticText, emailThreadPayloadSchema, emailTonePayloadSchema, encodeEmailToneContent, emailToneSemanticText } from './archive-payloads';
import { DOCUMENT_CHUNK_MAX_CHARACTERS, DOCUMENT_CHUNK_MAX_WORDS, documentSemanticHash } from '@/lib/ai/document-processing/chunking';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { newId } from '@/lib/ids';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const documentKey = 'cmrnlzf650002qc7k4p5zem5w';

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
    await expect(repository.resolveAttachments(scopeKey, [{ type: 'document', key: documentKey }, { type: 'document', key: documentKey }])).rejects.toThrow('unique');
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
    const database = { query: async (query: string, bindVars: Record<string, any>) => { calls.push({ query, bindVars }); return { next: async () => ({ documents: calls.length === 1 ? documents.map(({ key, ...document }) => ({ ...document, _key: key })) : [], counts: { all: 51, important: 0, urgent: 0, needsAction: 51, filtered: 0, unread: 0, favorite: 0 } }) }; }, collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    const first = await repository.overview(scopeKey, documentKey, 'all', '  PLAN  ');
    expect(first.threads).toHaveLength(50);
    expect(first.nextCursor).toBeString();
    expect(first.counts).toMatchObject({ all: 51, needsAction: 51 });
    expect(calls[0]?.bindVars).toMatchObject({ scopeKey, connectorKey: documentKey, filter: 'all', search: 'plan', pageSize: 51 });
    expect(calls[0]?.query).toContain('LIMIT @pageSize');
    await repository.overview(scopeKey, documentKey, 'all', 'plan', first.nextCursor!);
    expect(calls[1]?.bindVars.after).toMatchObject({ scopeKey, connectorKey: documentKey, filter: 'all', search: 'plan', key: first.threads.at(-1)!.key });
    await expect(repository.overview(scopeKey, documentKey, 'urgent', 'plan', first.nextCursor!)).rejects.toThrow('another connector, scope, or query');
    await expect(repository.overview(newId(), documentKey, 'all', 'plan', first.nextCursor!)).rejects.toThrow('another connector, scope, or query');
    await expect(repository.overview(scopeKey, newId(), 'all', 'plan', first.nextCursor!)).rejects.toThrow('another connector, scope, or query');
    await expect(repository.overview(scopeKey, documentKey, 'all', 'different', first.nextCursor!)).rejects.toThrow('another connector, scope, or query');
  });
});

describe('similar mail repository', () => {
  test('uses the inclusive cosine threshold, exact categories, current embeddings, thread exclusion, and one owner result', async () => {
    const vector = Array(EMBEDDING_DIMENSIONS).fill(0.5);
    const ownerThreadKey = newId(), resultThreadKey = newId(), resultKey = newId();
    const source = archiveDocument({ key: documentKey, scopeKey, folderKey: scopeKey, name: 'Source', embedding: vector, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', payload: emailMessagePayloadSchema.parse({ version: 1, kind: 'mail-message', data: { accountKey: scopeKey, threadKey: ownerThreadKey, providerMessageId: 'source', from: 'a@example.com', to: ['b@example.com'], subject: 'Source', body: 'Body', summary: 'Body', direction: 'inbound', sentAt: '2026-08-23T00:00:00.000Z', hasAttachments: false, inboxCategory: 'Important', embeddingContentVersion: 3 } }) });
    const result = archiveDocument({ key: resultKey, scopeKey, folderKey: scopeKey, name: 'Result', embedding: vector, createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z', payload: emailMessagePayloadSchema.parse({ version: 1, kind: 'mail-message', data: { accountKey: scopeKey, threadKey: resultThreadKey, providerMessageId: 'result', from: 'c@example.com', to: ['b@example.com'], subject: 'Result', body: 'Related', summary: 'Related', direction: 'inbound', sentAt: '2026-08-22T00:00:00.000Z', hasAttachments: false, inboxCategory: 'Urgent', embeddingContentVersion: 3 } }) });
    let semanticQuery = '', semanticVars: Record<string, any> = {};
    const raw = ({ key, ...document }: Record<string, any>) => ({ ...document, _key: key });
    const database = { query: async (query: string, bindVars: Record<string, any>) => {
      if (query.includes('document._key == @key')) return { next: async () => raw(source) };
      semanticQuery = query; semanticVars = bindVars; return { all: async () => [{ document: raw(result), similarity: 0.70 }] };
    }, collection: () => ({}) };
    const items = await createEmailRepository(database as never).similarMessages(scopeKey, documentKey, vector, ['Urgent'], 5);
    expect(semanticQuery).toContain('similarity >= 0.70');
    expect(semanticQuery).toContain('payload.data.threadKey != @currentThreadKey');
    expect(semanticQuery).toContain('payload.data.embeddingContentVersion == 3');
    expect(semanticQuery).toContain('payload.data.accountKey == @accountKey');
    expect(semanticQuery).toContain('COLLECT threadKey = payload.data.threadKey');
    expect(semanticQuery.indexOf('COLLECT threadKey')).toBeLessThan(semanticQuery.indexOf('LIMIT @limit'));
    expect(semanticVars).toMatchObject({ currentThreadKey: ownerThreadKey, accountKey: scopeKey, embedding: vector, categories: ['Urgent'], limit: 5 });
    expect(items).toMatchObject([{ similarity: 0.70, message: { key: resultKey, threadKey: resultThreadKey } }]);
  });
});

describe('mail thread mutation concurrency', () => {
  test('binds mark-read to the observed thread update timestamp', async () => {
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return { next: async () => null }; }, collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    await expect(repository.markThreadRead(scopeKey, documentKey, '2026-08-23T12:00:00.000Z')).rejects.toThrow('changed while marking it read');
    expect(call?.query).toContain('document.updatedAt == @expectedUpdatedAt');
    expect(call?.query).toContain('payload.data.unread == true');
    expect(call?.bindVars).toMatchObject({ scopeKey, threadKey: documentKey, expectedUpdatedAt: '2026-08-23T12:00:00.000Z' });
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
    expect(call?.query).toContain('document.folderKey == @folderKey');
    expect(call?.query).toContain('payload.data.embeddingContentVersion == 3');
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
    let declaration: Record<string, string[]> | undefined, deletion = '';
    const database = {
      async beginTransaction(value: Record<string, string[]>) {
        declaration = value;
        return { async step(run: () => Promise<unknown>) { return run(); }, async commit() {}, async abort() {} };
      },
      async query(query: string) { deletion = query; return {}; },
      collection: () => ({}),
    };
    await createEmailRepository(database as never).deleteProviderThread(scopeKey, documentKey, 'provider-thread');
    const collections = ['documents', 'documentVersions', 'documentSummaries', 'documentSummaryAudio', 'documentAudioVersions'];
    expect(declaration?.write).toEqual(collections);
    expect(declaration?.exclusive).toEqual(collections);
    for (const collection of collections) expect(deletion).toContain(`IN ${collection}`);
    expect(deletion.indexOf('REMOVE audio IN documentSummaryAudio')).toBeLessThan(deletion.indexOf('REMOVE summary IN documentSummaries'));
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
  test('preserves a tone cover key while decoding editable Archive content', () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.5);
    const tone = { name: 'Calm', description: 'Friendly.', instruction: 'Write calmly.' };
    const document = archiveDocument({ key: documentKey, scopeKey, folderKey: scopeKey, name: tone.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), embedding, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    document.content = encodeEmailToneContent(tone);
    expect(decodeEmailTone({ ...document, coverImageKey: documentKey })).toMatchObject({ key: documentKey, coverImageKey: documentKey, name: tone.name });
  });

  test('embeds placeholder edited content, skips populated tones, and seeds missing defaults without overwriting', async () => {
    const warmKey = 'c243153d93fec022e17d04bc4';
    const conciseKey = 'c8557168cd0ddd166ee24e569';
    const placeholder = Array(EMBEDDING_DIMENSIONS).fill(0);
    const populatedEmbedding = Array(EMBEDDING_DIMENSIONS).fill(0.9);
    const warm = { slug: 'warm' as const, name: 'Warm' as const, description: 'My calmer description.', instruction: 'Use my edited voice.' };
    const concise = { slug: 'concise' as const, name: 'Concise' as const, description: 'Already embedded.', instruction: 'Keep this existing tone.' };
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
      return { all: async () => query.includes('FOR document IN documents') ? documents : [] };
    }, collection: () => ({ update: async (key: string, patch: Record<string, any>) => {
      updates.push({ key, patch });
      Object.assign(documents.find((document) => document._key === key)!, patch);
    } }) };
    const tones = await createEmailRepository(database as never).listTones(scopeKey, async (content) => {
      embeddedContent.push(content);
      return Array(EMBEDDING_DIMENSIONS).fill(content === `${warm.name}\n\n${warm.description}` ? 0.1 : 0.2);
    });
    expect(embeddedContent).toContain(`${warm.name}\n\n${warm.description}`);
    expect(embeddedContent).not.toContain(populated.content);
    expect(embeddedContent).toHaveLength(3);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ key: warmKey, patch: { embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1), contentChunks: [emailToneSemanticText(warm)], chunkEmbeddings: [Array(EMBEDDING_DIMENSIONS).fill(0.1)], semanticChunkCount: 1, emailToneEmbeddingVersion: 1 } });
    expect(updates[0]!.patch.semanticContentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(seeds).toHaveLength(2);
    expect(seeds.map(({ name }) => name)).toEqual(['Casual', 'Formal']);
    expect(seeds.some(({ name }) => name === 'Warm' || name === 'Direct')).toBe(false);
    expect(seeds.every(({ mutationPolicy, content }) => mutationPolicy === 'user' && content.includes('vorinthex-mail-tone'))).toBe(true);
    expect(seeds.map(({ _key }) => _key)).not.toContain(warmKey);
    expect(documents.find(({ _key }) => _key === warmKey)?.content).toBe(edited.content);
    expect(tones).toContainEqual(expect.objectContaining({ key: warmKey, slug: 'warm', description: warm.description, instruction: warm.instruction }));
  });

  test('repairs an Archive-edited tone whose generic embedding covered the full document', async () => {
    const tone = { name: 'Archive Calm', description: 'Use an even cadence.', instruction: 'Avoid exclamation marks.' };
    const fullContent = encodeEmailToneContent(tone);
    const document = archiveDocument({ key: documentKey, scopeKey, folderKey: scopeKey, name: tone.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), embedding: Array(EMBEDDING_DIMENSIONS).fill(0.8), createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    Object.assign(document, { content: fullContent, contentChunks: [fullContent], chunkEmbeddings: [document.embedding], semanticChunkCount: 1, semanticContentHash: documentSemanticHash(fullContent) });
    let repair: Record<string, any> | undefined;
    const database = { query: async (query: string) => ({ all: async () => query.includes('FOR document IN documents') ? [{ ...document, key: undefined, _key: document.key }] : [] }), collection: () => ({ update: async (_key: string, patch: Record<string, any>) => { repair = patch; } }) };
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.3);
    await createEmailRepository(database as never).listTones(scopeKey, async (text) => {
      if (text === `${tone.name}\n\n${tone.description}`) return embedding;
      return Array(EMBEDDING_DIMENSIONS).fill(0.1);
    });
    expect(repair).toMatchObject({ embedding, contentChunks: [`${tone.name}\n\n${tone.description}`], chunkEmbeddings: [embedding], semanticChunkCount: 1, semanticContentHash: documentSemanticHash(`${tone.name}\n\n${tone.description}`), emailToneEmbeddingVersion: 1 });
  });

  test('persists max-boundary tone inputs as valid bounded semantic chunks without instruction text', async () => {
    const description = `${'x '.repeat(4_999)}xy`;
    const instruction = 'i'.repeat(20_000);
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.25);
    let persisted: Record<string, any> | undefined, updateVars: Record<string, any> | undefined;
    const database = { query: async (query: string, bindVars?: Record<string, any>) => {
      if (query.includes('INSERT @document')) persisted = bindVars?.document;
      if (query.includes('UPDATE document WITH MERGE')) updateVars = bindVars;
      return { all: async () => [], next: async () => {
        if (!persisted) return null;
        if (query.includes('INSERT @document')) return { document: persisted };
        if (query.includes('UPDATE document WITH MERGE')) {
          persisted = { ...persisted, name: bindVars?.name, content: bindVars?.content, embedding: bindVars?.embedding, contentChunks: bindVars?.contentChunks, chunkEmbeddings: bindVars?.chunkEmbeddings, semanticChunkCount: bindVars?.semanticChunkCount, semanticContentHash: bindVars?.semanticContentHash, updatedAt: bindVars?.updatedAt };
          return { document: persisted };
        }
        return persisted;
      } };
    }, collection: () => ({}) };
    const repository = createEmailRepository(database as never);
    const result = await repository.createTone(scopeKey, { name: 'n'.repeat(255), description, instruction, isFavorite: false, embedding });
    expect(result.tone.instruction).toBe(instruction);
    expect(persisted?.contentChunks.length).toBeGreaterThan(1);
    expect(persisted?.contentChunks.join('')).toBe(`${'n'.repeat(255)}\n\n${description}`);
    expect(persisted?.contentChunks.every((chunk: string) => chunk.length <= DOCUMENT_CHUNK_MAX_CHARACTERS && (chunk.match(/\S+/g)?.length ?? 0) <= DOCUMENT_CHUNK_MAX_WORDS)).toBe(true);
    expect(persisted?.chunkEmbeddings.every((value: number[]) => value === persisted?.embedding || value.every((item, index) => item === embedding[index]))).toBe(true);
    expect(persisted?.semanticContentHash).toBe(documentSemanticHash(`${'n'.repeat(255)}\n\n${description}`));
    expect(persisted?.contentChunks.join('')).not.toContain(instruction);
    const updated = await repository.updateTone(scopeKey, result.tone.key, result.tone.updatedAt, { name: 'u'.repeat(255), description, instruction, embedding });
    expect(updated?.tone).toMatchObject({ name: 'u'.repeat(255), description, instruction });
    expect(updateVars?.contentChunks.join('')).toBe(`${'u'.repeat(255)}\n\n${description}`);
    expect(updateVars?.contentChunks.every((chunk: string) => chunk.length <= DOCUMENT_CHUNK_MAX_CHARACTERS && (chunk.match(/\S+/g)?.length ?? 0) <= DOCUMENT_CHUNK_MAX_WORDS)).toBe(true);
  });

  test('selects an edited tone by slug through writingProfile', async () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.5);
    const tone = { slug: 'warm' as const, name: 'Warm' as const, description: 'My calmer description.', instruction: 'Use my edited voice.' };
    const edited = archiveDocument({ key: 'c243153d93fec022e17d04bc4', scopeKey, folderKey: scopeKey, name: tone.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), embedding, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    edited.content = encodeEmailToneContent(tone);
    const database = { query: async (query: string) => ({ all: async () => query.includes('FOR document IN documents') ? [{ ...edited, key: undefined, _key: edited.key }] : [] }), collection: () => ({ update: async () => undefined }) };
    const profile = await createEmailRepository(database as never).writingProfile(scopeKey, undefined, 'warm', async () => embedding);
    expect(profile).toMatchObject({ slug: 'warm', tone: tone.instruction, style: tone.description, vocabulary: tone.instruction });
  });

  test('rejects unknown selectors instead of falling back to the first scoped tone', async () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.5);
    const tone = { slug: 'warm' as const, name: 'Warm' as const, description: 'Friendly.', instruction: 'Write warmly.' };
    const document = archiveDocument({ key: documentKey, scopeKey, folderKey: scopeKey, name: tone.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), embedding, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    document.content = encodeEmailToneContent(tone);
    const database = { query: async (query: string) => ({ all: async () => query.includes('FOR document IN documents') ? [{ ...document, key: undefined, _key: document.key }] : [] }), collection: () => ({ update: async () => undefined }) };
    const repository = createEmailRepository(database as never);
    expect(await repository.writingProfile(scopeKey, undefined, 'unknown', async () => embedding)).toBeNull();
    expect(await repository.writingProfile(scopeKey, newId(), undefined, async () => embedding)).toBeNull();
  });

  test('lists valid tones when unrelated and malformed tone-folder documents are present', async () => {
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.5);
    const tone = { name: 'Calm', description: 'Friendly.', instruction: 'Write calmly.' };
    const valid = archiveDocument({ key: documentKey, scopeKey, folderKey: scopeKey, name: tone.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), embedding, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T01:00:00.000Z', mutationPolicy: 'user' });
    valid.content = encodeEmailToneContent(tone);
    const malformed = { ...valid, key: undefined, _key: 'c243153d93fec022e17d04bc4', content: '# Not a valid tone', embedding: Array(EMBEDDING_DIMENSIONS).fill(0) };
    const unrelated = { _key: newId(), scopeKey, folderKey: scopeKey, name: '', content: '', embedding: [], createdAt: 'invalid', updatedAt: 'invalid' };
    const documents = [{ ...valid, key: undefined, _key: valid.key }, malformed, unrelated];
    const database = { query: async (query: string, bindVars?: Record<string, any>) => ({ all: async () => query.includes('FOR document IN documents') ? documents : [], next: async () => bindVars?.document ?? null }), collection: () => ({ update: async () => undefined }) };
    await expect(createEmailRepository(database as never).listTones(scopeKey, async () => embedding)).resolves.toContainEqual(expect.objectContaining({ key: documentKey, name: tone.name }));
  });
});

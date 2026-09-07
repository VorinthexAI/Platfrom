import { describe, expect, test } from 'bun:test';
import { createContentPersistence, type ContentQueryExecutor } from './content-persistence.node';
import { EMBEDDING_DIMENSIONS } from '../embeddings';

const scopeKey = 'cm00000000000000000000001';
const folderKey = 'cm00000000000000000000002';
const timestamp = '2026-07-22T10:00:00.000Z';
const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);

describe('scoped Content persistence', () => {
  test('ranks each semantic-neighbor category independently without a score threshold', async () => {
    let call: { query: string; bindVars?: Record<string, unknown> } | undefined;
    const executor: ContentQueryExecutor = {
      async query(query, bindVars) {
        call = { query, bindVars };
        return { async next() { return { folders: [], documents: [], files: [] }; } };
      },
    };
    const result = await createContentPersistence(executor).semanticNeighbors({ embedding, scopeKey, activeFolderKeys: [folderKey], sourceFolderKey: folderKey, limit: 20 });
    expect(result).toEqual({ folders: [], documents: [], files: [] });
    expect(call?.query.match(/LIMIT @limit/g)).toHaveLength(3);
    expect(call?.query.match(/SORT score DESC/g)).toHaveLength(3);
    expect(call?.query).toContain('document.folderKey IN @activeFolderKeys');
    expect(call?.query).toContain('document.extension == null');
    expect(call?.query).toContain('document.extension != null');
    expect(call?.query).not.toMatch(/score\s*>=/);
    expect(call?.bindVars).toMatchObject({ scopeKey, activeFolderKeys: [folderKey], sourceFolderKey: folderKey, sourceDocumentKey: null, limit: 10 });
  });

  test('updates by key and scope and explicitly unsets optional fields', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const executor: ContentQueryExecutor = {
      async query(query, bindVars) {
        calls.push({ query, bindVars });
        return { async next() { return { _key: folderKey, scopeKey, name: 'Root', embedding, createdAt: timestamp, updatedAt: timestamp }; } };
      },
    };
    const result = await createContentPersistence(executor).updateFolder(scopeKey, folderKey, {
      parentFolderKey: undefined,
      description: undefined,
      coverImageKey: undefined,
      embedding,
      updatedAt: timestamp,
    });
    expect(result).toMatchObject({ key: folderKey, scopeKey, name: 'Root' });
    expect(calls[0]?.query).toContain('current._key == @key && current.scopeKey == @scopeKey');
    expect(calls[0]?.query).toContain('current._internalDeletion');
    expect(calls[0]?.query).toContain('DOCUMENT(folders, destinationKey)');
    expect(calls[0]?.query).toContain('REPLACE current WITH UNSET');
    expect(calls[0]?.bindVars).toMatchObject({ key: folderKey, scopeKey, unset: ['parentFolderKey', 'description', 'coverImageKey'], patch: { embedding, updatedAt: timestamp } });
    expect(calls[0]?.bindVars).toMatchObject({ changesLocation: true, destinationKey: null });
    expect(() => createContentPersistence(executor).updateFolder(scopeKey, folderKey, { name: 'Renamed' })).toThrow('Folder semantic updates require a fresh embedding.');
  });

  test('returns false when a scope-bounded delete matches nothing', async () => {
    const executor: ContentQueryExecutor = { async query() { return { async next() { return undefined; } }; } };
    expect(await createContentPersistence(executor).deleteDocument(scopeKey, folderKey)).toBe(false);
  });

  test('cleans every user overlay only on permanent folder and document deletion', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const executor: ContentQueryExecutor = { async query(query, bindVars) { calls.push({ query, bindVars }); return { async next() { return folderKey; } }; } };
    expect(await createContentPersistence(executor).deleteFolder(scopeKey, folderKey)).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.bindVars).toMatchObject({ sourceType: 'folder', removedKey: folderKey });
    expect(calls[0]?.query).toContain('RETURN OLD._key');
    expect(calls[0]?.query).toContain('attachment.targetType == @attachmentType');
    expect(calls[0]?.query).toContain('LET affectedTripKeys');
    expect(calls[0]?.query).toContain('UPDATE trip WITH { updatedAt: @now } IN trips');
    expect(calls[0]!.query.indexOf('LET affectedTripKeys')).toBeLessThan(calls[0]!.query.indexOf('REMOVE attachment IN tripAttachments'));
    expect(calls[0]?.bindVars).toMatchObject({ attachmentType: 'folder' });
    expect(calls[1]?.query).toContain('FOR hidden IN userHiddens');
    expect(calls[1]?.query).toContain('hidden.sourceKey == @removedKey');
    expect(calls[1]?.bindVars).toEqual({ hiddenSource: 'folder', removedKey: folderKey });
  });

  test('cleans typed document overlays and tag assignments after source removal', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const executor: ContentQueryExecutor = { async query(query, bindVars) { calls.push({ query, bindVars }); return { async next() { return folderKey; } }; } };
    expect(await createContentPersistence(executor).deleteDocument(scopeKey, folderKey)).toBe(true);
    expect(calls).toHaveLength(4);
    expect(calls.some(({ query }) => query.includes('generatedDocumentBindings'))).toBe(true);
    expect(calls[1]?.query).toContain('hidden.source == @hiddenSource');
    expect(calls[1]?.bindVars).toEqual({ hiddenSource: 'document', removedKey: folderKey });
    expect(calls[2]?.query).toContain('assignment.scopeKey == @scopeKey');
    expect(calls[2]?.query).toContain('assignment.sourceType == @sourceType');
    expect(calls[2]?.bindVars).toMatchObject({ sourceType: 'document' });
    expect(calls[2]?.bindVars).toEqual({ scopeKey, sourceType: 'document', removedKey: folderKey });
    expect(calls[0]?.bindVars).toMatchObject({ attachmentType: null });
  });

  test('does not clean hidden overlays when permanent source deletion matches nothing', async () => {
    const calls: string[] = [];
    const executor: ContentQueryExecutor = { async query(query) { calls.push(query); return { async next() { return undefined; } }; } };
    expect(await createContentPersistence(executor).deleteFolder(scopeKey, folderKey)).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('userHiddens');
  });

  test('binds a null folder for root document inserts', async () => {
    let bindVars: Record<string, unknown> | undefined;
    const executor: ContentQueryExecutor = {
      async query(_query, values) {
        bindVars = values;
        return { async next() { return values?.document; } };
      },
    };
    const documentKey = 'cm00000000000000000000003';
    const document = await createContentPersistence(executor).insertDocument({
      key: documentKey,
      scopeKey,
      name: 'Root note',
      content: 'Body',
      embedding,
      mutationPolicy: 'user',
      isFavorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(document.key).toBe(documentKey);
    expect(bindVars).toMatchObject({ folderKey: null, scopeKey });
  });

  test('derives semantic fields at the plain-text document write boundary', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const executor: ContentQueryExecutor = {
      async query(query, bindVars) {
        calls.push({ query, bindVars });
        return { async next() { return undefined; } };
      },
    };
    await createContentPersistence(executor).updateDocument(scopeKey, folderKey, {
      content: 'Hello Core',
      embedding: Array(EMBEDDING_DIMENSIONS).fill(1),
    });
    expect(calls[0]?.bindVars?.patch).toMatchObject({ content: 'Hello Core' });
    expect(calls[0]?.bindVars?.unset).toContain('emailToneEmbeddingVersion');
    expect(calls[0]?.bindVars).toMatchObject({ changesLocation: false });
    expect(calls[0]?.bindVars).not.toHaveProperty('allowSystemContainerUpdate');
    expect(calls[0]?.query).toContain('current.updatedAt == @expectedUpdatedAt');
    expect(() => createContentPersistence(executor).updateDocument(scopeKey, folderKey, { content: 'detached' })).toThrow('Document content updates require a fresh embedding.');
  });

  test('persists favorite-only document patches without representation fields', async () => {
    const calls: Array<{ bindVars?: Record<string, unknown> }> = [];
    const executor: ContentQueryExecutor = {
      async query(_query, bindVars) {
        calls.push({ bindVars });
        return { async next() { return undefined; } };
      },
    };
    const persistence = createContentPersistence(executor);
    await persistence.updateDocument(scopeKey, folderKey, { isFavorite: true, updatedAt: timestamp });
    expect(calls.map(({ bindVars }) => bindVars?.patch)).toEqual([{ isFavorite: true, updatedAt: timestamp }]);
    expect(calls[0]?.bindVars?.unset).toEqual([]);
    expect(calls[0]?.bindVars?.allowManagedUpdate).toBe(true);
  });

  test('rejects generic document inserts into every managed folder at the persistence boundary', async () => {
    let query = '';
    const executor: ContentQueryExecutor = { async query(value) { query = value; return { async next() { return undefined; } }; } };
    await expect(createContentPersistence(executor).insertDocument({ key: 'cm00000000000000000000003', scopeKey, folderKey, name: 'Blocked', content: 'Body', embedding, mutationPolicy: 'user', isFavorite: false, createdAt: timestamp, updatedAt: timestamp })).rejects.toThrow('Document destination is pending deletion.');
    expect(query).toContain('folder.mutationPolicy != "system-container" && folder.managedPurpose == null');
  });

  test('only the marker owner can unfreeze a pending deletion', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const executor: ContentQueryExecutor = { async query(query, bindVars) { calls.push({ query, bindVars }); return { async next() { return undefined; } }; } };
    await createContentPersistence(executor).setFolderDeletion(scopeKey, folderKey, undefined, 'invocation-owner');
    expect(calls[0]?.query).toContain('current._internalDeletion.owner == @owner');
    expect(calls[0]?.bindVars).toMatchObject({ owner: 'invocation-owner', unset: ['_internalDeletion'] });
  });

  test('guards every Content insert with its folder or document owner', async () => {
    const source = await Bun.file(new URL('./content-persistence.node.ts', import.meta.url)).text();
    expect(source).toContain('Folder destination is pending deletion.');
    expect(source).toContain('Document destination is pending deletion.');
    expect(source).toContain('Version owner is pending deletion.');
    expect(source).toContain('Summary owner is pending deletion.');
    expect(source.match(/DOCUMENT\(folders,/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source.match(/DOCUMENT\(documents,/g)?.length).toBeGreaterThanOrEqual(3);
  });

  test('allocates monotonic summary versions and supports scoped history reads', async () => {
    const summaryKey = 'cm00000000000000000000005';
    const documentKey = 'cm00000000000000000000003';
    const createdByKey = 'cm00000000000000000000004';
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const executor: ContentQueryExecutor = {
      async query(query, bindVars) {
        calls.push({ query, bindVars });
        if (query.includes('INSERT MERGE(@summary')) return { async next() { return { ...(bindVars?.summary as object), _key: summaryKey, version: 2 }; } };
        return { async next() { return undefined; }, async all() { return []; } };
      },
    };
    const persistence = createContentPersistence(executor);
    const created = await persistence.createSummary({ key: summaryKey, scopeKey, documentKey, summary: 'Saved summary', style: 'brief', sourceContentHash: 'a'.repeat(64), sourceTitle: 'Notes', sourceDocumentUpdatedAt: timestamp, createdByKey, createdAt: timestamp });
    expect(created.version).toBe(2);
    expect(calls[0]?.query).toContain('MAX(existing.version)');
    expect(calls[0]?.query).toContain('documentSummaries');
    await persistence.listSummaries(scopeKey, [documentKey]);
    expect(calls[1]?.query).toContain('summary.scopeKey == @scopeKey && summary.documentKey IN @documentKeys');
    expect(calls[1]?.query).toContain('SORT summary.version DESC');
  });

  test('creates one race-safe audio record per summary and lists by summary keys', async () => {
    const summaryKey = 'cm00000000000000000000005';
    const documentKey = 'cm00000000000000000000003';
    const audioKey = 'cm00000000000000000000006';
    const createdByKey = 'cm00000000000000000000004';
    const audio = { key: audioKey, scopeKey, documentKey, summaryKey, storageKey: 'private/summary.mp3', mimeType: 'audio/mpeg' as const, sizeBytes: 10, durationMs: 100, createdByKey, createdAt: timestamp };
    const calls: string[] = [];
    let insertAttempts = 0;
    const executor: ContentQueryExecutor = { async query(query, bindVars) {
      calls.push(query);
      if (query.includes('INSERT @audio')) {
        insertAttempts += 1;
        if (insertAttempts === 2) throw Object.assign(new Error('unique'), { errorNum: 1210 });
        return { async next() { return { ...(bindVars?.audio as object), _key: audioKey }; } };
      }
      if (query.includes('summaryKey == @summaryKey')) return { async next() { return { ...audio, _key: audioKey, key: undefined }; } };
      return { async next() { return undefined; }, async all() { return []; } };
    } };
    const persistence = createContentPersistence(executor);
    expect(await persistence.createSummaryAudio(audio)).toMatchObject({ created: true, audio: { summaryKey } });
    expect(await persistence.createSummaryAudio({ ...audio, key: 'cm00000000000000000000007', storageKey: 'private/loser.mp3' })).toMatchObject({ created: false, audio: { key: audioKey } });
    await persistence.listSummaryAudio(scopeKey, [summaryKey]);
    expect(calls.some((query) => query.includes('audio.summaryKey IN @summaryKeys'))).toBe(true);
  });

  test('atomically selects one document audio version, saves progress, and clears selection', async () => {
    const audioKey = 'cm00000000000000000000006';
    const documentKey = 'cm00000000000000000000003';
    const createdByKey = 'cm00000000000000000000004';
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const executor: ContentQueryExecutor = { async query(query, bindVars) {
      calls.push({ query, bindVars });
      if (query.includes('playbackPositionMs: @playbackPositionMs')) return { async next() { return { _key: audioKey, scopeKey, documentKey, version: 2, sourceContentHash: 'a'.repeat(64), sourceTitle: 'Notes', sourceDocumentUpdatedAt: timestamp, storageKey: 'audio/two.mp3', mimeType: 'audio/mpeg', sizeBytes: 10, durationMs: 60_000, isCurrent: true, playbackPositionMs: 12_345, includeTitle: true, includeCode: false, createdByKey, createdAt: timestamp }; } };
      return { async next() { return 1; } };
    } };
    const persistence = createContentPersistence(executor);
    expect(await persistence.updateAudioPlayback(scopeKey, audioKey, 12_345)).toMatchObject({ key: audioKey, isCurrent: true, playbackPositionMs: 12_345 });
    expect(calls[0]?.query).toContain('audio._key == target._key || audio.isCurrent == true');
    expect(calls[0]?.query).toContain('{ isCurrent: audio._key == target._key }');
    expect(calls[0]?.bindVars).toEqual({ key: audioKey, scopeKey, playbackPositionMs: 12_345 });
    expect(await persistence.clearCurrentAudioVersion(scopeKey, documentKey)).toBe(true);
    expect(calls[1]?.query).toContain('audio.documentKey == @documentKey && audio.isCurrent == true');
    expect(calls[1]?.query).toContain('{ isCurrent: false }');
  });

});

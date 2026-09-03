import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { authorizeDocumentParseLocation, runContentTool, type ContentIdempotencyStore, type ContentRepository } from './content-runtime';
import { CONTENT_TOOL_NAMES } from './content-registry';
import { ContentError } from './content-errors';
import { documentKeyForRequest, DocumentProcessingError } from '@/lib/ai/document-processing';
import { documentEmbed } from '@/lib/ai/document-processing';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { chatInputSchema } from '@/lib/ai/providers/types';

const now = '2026-07-22T12:00:00.000Z';
const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
const mailEnvelopeKinds = ['mail-thread', 'mail-message', 'mail-reply-draft', 'mail-new-draft', 'mail-tone', 'mail-reply-context', 'mail-writing-profile', 'mail-contact', 'mail-rule'];
const mailContent = (kind: string) => JSON.stringify({ version: 1, kind, data: {} });

function fixture(role: 'viewer' | 'moderator' | 'admin' | 'owner' = 'owner') {
  const organizationKey = newId(), scopeKey = newId(), membershipKey = newId(), userKey = newId();
  const folders = new Map<string, any>(), documents = new Map<string, any>(), shares = new Map<string, any>(), versions = new Map<string, any>(), audioVersions = new Map<string, any>(), summaries = new Map<string, any>(), summaryAudio = new Map<string, any>();
  const patches: Array<Record<string, unknown>> = [];
  const repository: ContentRepository = {
    async getScope(key) { return key === scopeKey ? { key, organizationKey } : null; },
    async role(key) { return key === scopeKey ? role : null; },
    async allowedScopeKeys() { return [scopeKey]; },
    async getFolder(key) { return folders.get(key) ?? null; },
    async listFolders(key) { return [...folders.values()].filter((value) => value.scopeKey === key); },
    async insertFolder(value) { const folder = { ...value, embedding: value.embedding ?? embedding }; folders.set(folder.key, folder); return folder; },
    async updateFolder(key, patch) { patches.push(patch); const value = { ...folders.get(key), ...patch }; folders.set(key, value); return value; },
    async setFolderDeletion(key, marker, owner) { const current = folders.get(key); if (!current || (owner && current._internalDeletion?.owner !== owner)) return null; const value = { ...current, _internalDeletion: marker }; if (!marker) delete value._internalDeletion; folders.set(key, value); return value; },
    async deleteFolder(key) { folders.delete(key); },
    async getDocument(key) { return documents.get(key) ?? null; },
    async listDocuments(key) { return [...documents.values()].filter((value) => value.scopeKey === key); },
    async insertDocument(value) { documents.set(value.key, value); return value; },
    async updateDocument(key, patch, options) { const current = documents.get(key); if (options?.expectedUpdatedAt && current.updatedAt !== options.expectedUpdatedAt) throw new Error('Document update conflict.'); patches.push(patch); const value = { ...current, ...patch }; documents.set(key, value); return value; },
    async setDocumentDeletion(key, marker, owner) { const current = documents.get(key); if (!current || (owner && current._internalDeletion?.owner !== owner)) return null; const value = { ...current, _internalDeletion: marker }; if (!marker) delete value._internalDeletion; documents.set(key, value); return value; },
    async deleteDocument(key) { documents.delete(key); },
    async getShare(key) { return shares.get(key) ?? null; },
    async listShares(_scopeKey, keys, options = {}) {
      const at = options.at ?? new Date().toISOString();
      return [...shares.values()].filter((value) => keys.includes(value.documentKey)
        && (options.includeRevoked || !value.revokedAt)
        && (options.includeExpired || !value.expiresAt || value.expiresAt > at));
    },
    async insertShare(value) { shares.set(value.key, value); return value; },
    async updateShare(key, patch) { const value = { ...shares.get(key), ...patch }; shares.set(key, value); return value; },
    async deleteShare(key) { shares.delete(key); },
    async getVersion(key) { return versions.get(key) ?? null; },
    async listVersions(_scopeKey, keys) { return [...versions.values()].filter((value) => keys.includes(value.documentKey)).sort((a, b) => b.version - a.version); },
    async createVersion(value) { const version = { ...value, key: newId(), version: [...versions.values()].filter((item) => item.documentKey === value.documentKey).length + 1, createdAt: now }; versions.set(version.key, version); return version; },
    async deleteVersion(key) { versions.delete(key); },
    async listAudioVersions(_scopeKey, keys) { return [...audioVersions.values()].filter((value) => keys.includes(value.documentKey)).sort((a, b) => b.version - a.version); },
    async getAudioVersion(key) { return audioVersions.get(key) ?? null; },
    async createAudioVersion(value) { const version = { isCurrent: false, playbackPositionMs: 0, ...value, version: [...audioVersions.values()].filter((item) => item.documentKey === value.documentKey).length + 1 }; audioVersions.set(version.key, version); return version; },
    async updateAudioPlayback(_scopeKey, key, playbackPositionMs) { const target = audioVersions.get(key); if (!target || playbackPositionMs > target.durationMs) return null; for (const audio of audioVersions.values()) if (audio.documentKey === target.documentKey) audio.isCurrent = audio.key === key; target.playbackPositionMs = playbackPositionMs; return target; },
    async clearCurrentAudioVersion(_scopeKey, documentKey) { let cleared = false; for (const audio of audioVersions.values()) if (audio.documentKey === documentKey && audio.isCurrent) { audio.isCurrent = false; cleared = true; } return cleared; },
    async deleteAudioVersion(key) { audioVersions.delete(key); },
    async getSummary(key) { return summaries.get(key) ?? null; },
    async listSummaries(_scopeKey, keys) { return [...summaries.values()].filter((value) => keys.includes(value.documentKey)).sort((a, b) => b.version - a.version); },
    async createSummary(value) { const summary = { ...value, version: [...summaries.values()].filter((item) => item.documentKey === value.documentKey).length + 1 }; summaries.set(summary.key, summary); return summary; },
    async deleteSummary(key) { summaries.delete(key); },
    async getSummaryAudio(summaryKey) { return [...summaryAudio.values()].find((value) => value.summaryKey === summaryKey) ?? null; },
    async listSummaryAudio(_scopeKey, keys) { return [...summaryAudio.values()].filter((value) => keys.includes(value.summaryKey)); },
    async createSummaryAudio(value) { const existing = [...summaryAudio.values()].find((item) => item.summaryKey === value.summaryKey); if (existing) return { audio: existing, created: false }; summaryAudio.set(value.key, value); return { audio: value, created: true }; },
    async deleteSummaryAudio(summaryKey) { const value = [...summaryAudio.values()].find((item) => item.summaryKey === summaryKey); if (value) summaryAudio.delete(value.key); },
    async semanticSearch() { return [...documents.values()].map((document) => ({ score: 0.8, document })); },
    async semanticSearchFolders() { return [...folders.values()].map((folder) => ({ score: 0.8, folder })); },
    async semanticNeighbors(input) {
      const candidates = [...documents.values()].filter((document) => document.scopeKey === input.scopeKey && document.key !== input.sourceDocumentKey && (!document.folderKey || input.activeFolderKeys.includes(document.folderKey)));
      return {
        folders: [...folders.values()].filter((folder) => folder.scopeKey === input.scopeKey && folder.key !== input.sourceFolderKey && input.activeFolderKeys.includes(folder.key)).map((folder) => ({ score: 0.8, folder })),
        documents: candidates.filter((document) => !document.extension).map((document) => ({ score: 0.8, document })),
        files: candidates.filter((document) => document.extension).map((document) => ({ score: 0.8, document })),
      };
    },
    async transaction(operation) { return operation(repository); },
  };
  const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: membershipKey, organizationId: organizationKey, status: 'active', orgRole: role } } } as any;
  const folderKey = newId(); folders.set(folderKey, { key: folderKey, scopeKey, name: 'Root', embedding, createdAt: now, updatedAt: now });
  const addDocument = (content = 'First sentence. Second sentence.') => { const key = newId(); documents.set(key, { key, scopeKey, folderKey, name: 'Notes', extension: 'txt', mimeType: 'text/plain', sizeBytes: content.length, storageKey: `docs/${key}`, content, embedding, isFavorite: false, createdAt: now, updatedAt: now }); return key; };
  return { repository, context, folders, documents, shares, versions, audioVersions, summaries, summaryAudio, patches, scopeKey, folderKey, addDocument };
}

describe('Content runtime', () => {
  test('preflights document ingestion scope role and folder hierarchy', async () => {
    const allowed = fixture('moderator');
    await expect(authorizeDocumentParseLocation({ scopeKey: allowed.scopeKey, folderKey: allowed.folderKey }, allowed.context, allowed.repository)).resolves.toBeUndefined();
    const denied = fixture('viewer');
    await expect(authorizeDocumentParseLocation({ scopeKey: denied.scopeKey, folderKey: denied.folderKey }, denied.context, denied.repository)).rejects.toMatchObject({ code: 'CONTENT_FORBIDDEN' });
  });

  test('creates one editable document from scanned pages, retains sources, and replays idempotently', async () => {
    const f = fixture('moderator');
    let scanCalls = 0;
    const input = {
      scopeKey: f.scopeKey,
      folderKey: f.folderKey,
      name: 'Scanned receipt',
      idempotencyKey: 'device-scan-1',
      pages: [1, 2].map((index) => ({ filename: `${index}.jpg`, mimeType: 'image/jpeg' as const, sizeBytes: 4, bytes: new Uint8Array([0xff, 0xd8, 0xff, index]) })),
    };
    const idempotencyRecords = new Map<string, { hash: string; response?: unknown }>();
    const dependencies: any = {
      repository: f.repository,
      idempotency: {
        async claim(identity: any, hash: string) {
          const record = idempotencyRecords.get(identity.idempotencyKey);
          if (!record) { idempotencyRecords.set(identity.idempotencyKey, { hash }); return { status: 'claimed' }; }
          return record.hash === hash && record.response ? { status: 'replay', response: record.response } : { status: 'conflict' };
        },
        async start() { return true; },
        async complete(identity: any, hash: string, _leaseOwner: string, response: unknown) { idempotencyRecords.set(identity.idempotencyKey, { hash, response }); },
        async release(identity: any) { idempotencyRecords.delete(identity.idempotencyKey); },
      },
      storage: { async upload() { return { storageKey: '' }; }, async delete() {}, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } },
      signDocumentSourceUrl: async (storageKey: string) => `https://images.example/${storageKey}`,
      clock: () => new Date(now),
      scanDocument: async (scanInput: any) => {
        scanCalls += 1;
        return { documentKey: documentKeyForRequest(scanInput.scopeKey, scanInput.folderKey, scanInput.idempotencyKey), content: '## Page 1\n\nStore receipt\n\n## Page 2\n\nTotal: $42.00', storageKeys: ['scan/page-01.jpg', 'scan/page-02.jpg'] };
      },
      runAction: async (action: string, actionInput: any) => {
        if (action === 'document-cleanup') return { content: actionInput.text.replace('## Page 1', 'Page 1').replace('## Page 2', 'Page 2') };
        if (action === 'document-embed') return documentEmbed(actionInput, { embed: async () => embedding, dimensions: EMBEDDING_DIMENSIONS });
        throw new Error(`Unexpected action ${action}`);
      },
    };

    const first = await runContentTool('document.scan', input, f.context, dependencies);
    const replay = await runContentTool('document.scan', input, f.context, dependencies);

    expect(scanCalls).toBe(1);
    expect(replay.document.key).toBe(first.document.key);
    expect(first.document).toMatchObject({ name: 'Scanned receipt', folderKey: f.folderKey });
    const stored = f.documents.get(first.document.key);
    expect(stored.content).toContain('Store receipt');
    expect(stored.content).toContain('Total: $42.00');
    expect(stored.sourceStorageKeys).toEqual(['scan/page-01.jpg', 'scan/page-02.jpg']);
    expect(stored.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(first.document.sourceImageCount).toBe(2);
    expect(first.document.originalAvailable).toBe(false);
    const sources = await runContentTool('document.find', { documentKeys: [first.document.key], include: ['sourceImages'] }, f.context, dependencies);
    expect(sources.results[0]).toMatchObject({ success: true, data: { document: { sourceImageCount: 2, sourceImages: [
      { page: 1, url: 'https://images.example/scan/page-01.jpg' },
      { page: 2, url: 'https://images.example/scan/page-02.jpg' },
    ] } } });
    expect(sources.results[0]?.data?.document).not.toHaveProperty('sourceStorageKeys');
  });

  test('reports a retryable cleanup failure when scan processing and source deletion both fail', async () => {
    const f = fixture('moderator');
    const documentKey = newId();
    const deleted: string[] = [];
    await expect(runContentTool('document.scan', {
      scopeKey: f.scopeKey,
      folderKey: f.folderKey,
      pages: [{ filename: 'page.jpg', mimeType: 'image/jpeg', sizeBytes: 4, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }],
    }, f.context, {
      repository: f.repository,
      storage: {
        async upload() { return { storageKey: '' }; },
        async delete(key: string) { deleted.push(key); throw new Error('storage unavailable'); },
        async download() { return { bytes: new Uint8Array() }; },
        async copy() { return { storageKey: '' }; },
      },
      scanDocument: async () => ({ documentKey, content: 'Scanned body', storageKeys: ['scan/page-01.jpg'] }),
      runAction: async (action: string) => { if (action === 'document-cleanup') throw new Error('cleanup unavailable'); throw new Error(`Unexpected action ${action}`); },
    })).rejects.toMatchObject({ code: 'CONTENT_CONFLICT', action: 'cleanup', resourceKey: documentKey, retryable: true });
    expect(deleted).toEqual(['scan/page-01.jpg']);
  });

  test('retains scan sources when ownership cannot be verified after processing fails', async () => {
    const f = fixture('moderator');
    const documentKey = newId();
    const deleted: string[] = [];
    const repository = { ...f.repository, async getDocument(key: string) { if (key === documentKey) throw new Error('database unavailable'); return f.repository.getDocument(key); } };
    await expect(runContentTool('document.scan', {
      scopeKey: f.scopeKey,
      folderKey: f.folderKey,
      pages: [{ filename: 'page.jpg', mimeType: 'image/jpeg', sizeBytes: 4, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }],
    }, f.context, {
      repository,
      storage: {
        async upload() { return { storageKey: '' }; },
        async delete(key: string) { deleted.push(key); },
        async download() { return { bytes: new Uint8Array() }; },
        async copy() { return { storageKey: '' }; },
      },
      scanDocument: async () => ({ documentKey, content: 'Scanned body', storageKeys: ['scan/page-01.jpg'] }),
      runAction: async (action: string) => { if (action === 'document-cleanup') throw new Error('cleanup unavailable'); throw new Error(`Unexpected action ${action}`); },
    })).rejects.toMatchObject({ code: 'CONTENT_CONFLICT', action: 'cleanup', resourceKey: documentKey, retryable: true });
    expect(deleted).toEqual([]);
  });

  test('requires a resolved human principal for every registered tool', async () => {
    const f = fixture();
    for (const name of CONTENT_TOOL_NAMES) {
      await expect(runContentTool(name, {}, { ...f.context, principal: { kind: 'system' } }, { repository: f.repository })).rejects.toMatchObject({
        code: 'CONTENT_UNAUTHORIZED',
        tool: name,
      });
    }
  });

  test('rejects system principals and enforces write roles', async () => {
    const f = fixture('viewer');
    await expect(runContentTool('folder.create', { folders: [{ scopeKey: f.scopeKey, name: 'Denied' }] }, { ...f.context, principal: { kind: 'system' } }, { repository: f.repository })).rejects.toMatchObject({ code: 'CONTENT_UNAUTHORIZED' });
    const denied = await runContentTool('folder.create', { folders: [{ scopeKey: f.scopeKey, name: 'Denied' }] }, f.context, { repository: f.repository });
    expect(denied.results[0]).toMatchObject({ success: false, error: { code: 'CONTENT_FORBIDDEN' } });
  });

  test('preserves batch order, continues partial failures, and preflights atomic batches', async () => {
    const f = fixture('moderator'); const missing = newId();
    const result = await runContentTool('folder.rename', { renames: [{ folderKey: f.folderKey, name: 'Renamed' }, { folderKey: missing, name: 'Missing' }] }, f.context, { repository: f.repository, embed: async () => embedding });
    expect(result.results.map((item) => [item.key, item.success])).toEqual([[f.folderKey, true], [missing, false]]);
    expect(result.summary).toEqual({ requested: 2, succeeded: 1, failed: 1 });
    const before = f.folders.get(f.folderKey).name;
    await expect(runContentTool('folder.rename', { renames: [{ folderKey: f.folderKey, name: 'Atomic' }, { folderKey: missing, name: 'Missing' }], atomic: true }, f.context, { repository: f.repository, embed: async () => embedding })).rejects.toBeInstanceOf(ContentError);
    expect(f.folders.get(f.folderKey).name).toBe(before);
  });

  test('detects folder cycles and document moves do not re-embed', async () => {
    const f = fixture('admin'); const child = newId();
    f.folders.set(child, { key: child, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding, createdAt: now, updatedAt: now });
    const cycle = await runContentTool('folder.move', { moves: [{ folderKey: f.folderKey, targetParentFolderKey: child }] }, f.context, { repository: f.repository });
    expect(cycle.results[0]).toMatchObject({ success: false, error: { code: 'FOLDER_CYCLE_DETECTED' } });
    const documentKey = f.addDocument();
    await runContentTool('document.move', { moves: [{ documentKey, targetScopeKey: f.scopeKey, targetFolderKey: child }] }, f.context, { repository: f.repository });
    expect(f.patches.at(-1)).toMatchObject({ folderKey: child });
    expect(f.patches.at(-1)).not.toHaveProperty('embedding');
  });

  test('lists the complete active folder tree when descendants are requested', async () => {
    const f = fixture('viewer');
    const child = newId(), leaf = newId(), pending = newId(), hidden = newId();
    f.folders.set(child, { key: child, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding, createdAt: now, updatedAt: now });
    f.folders.set(leaf, { key: leaf, scopeKey: f.scopeKey, parentFolderKey: child, name: 'Leaf', embedding, createdAt: now, updatedAt: now });
    f.folders.set(pending, { key: pending, scopeKey: f.scopeKey, name: 'Pending', embedding, _internalDeletion: { kind: 'folder', owner: newId(), startedAt: now }, createdAt: now, updatedAt: now });
    f.folders.set(hidden, { key: hidden, scopeKey: f.scopeKey, parentFolderKey: pending, name: 'Hidden', embedding, createdAt: now, updatedAt: now });

    const direct = await runContentTool('folder.list', { scopeKey: f.scopeKey }, f.context, { repository: f.repository });
    const tree = await runContentTool('folder.list', { scopeKey: f.scopeKey, includeDescendants: true }, f.context, { repository: f.repository });

    expect(direct.folders.map((folder: any) => folder.key)).toEqual([f.folderKey]);
    expect(tree.folders.map((folder: any) => folder.key).sort()).toEqual([f.folderKey, child, leaf].sort());
  });

  test('filters folder and document lists inclusively before pagination', async () => {
    const f = fixture('viewer');
    const boundary = '2026-07-22T10:00:00.000Z';
    const folderKeys = ['Older', 'Boundary', 'Newer'].map((name, index) => {
      const key = newId();
      const createdAt = index === 0 ? '2026-07-22T09:59:59.999Z' : index === 1 ? boundary : '2026-07-22T10:00:00.001Z';
      f.folders.set(key, { key, scopeKey: f.scopeKey, name, embedding, createdAt, updatedAt: createdAt });
      return key;
    });
    const documentKeys = ['Older', 'Boundary', 'Newer'].map((name, index) => {
      const key = f.addDocument(`${name} content`);
      const document = f.documents.get(key);
      document.name = name;
      document.createdAt = index === 0 ? '2026-07-22T09:59:59.999Z' : index === 1 ? boundary : '2026-07-22T10:00:00.001Z';
      delete document.folderKey;
      return key;
    });

    const folders = await runContentTool('folder.list', { scopeKey: f.scopeKey, createdFrom: boundary, createdTo: boundary, limit: 1 }, f.context, { repository: f.repository });
    const documents = await runContentTool('document.list', { scopeKey: f.scopeKey, createdFrom: boundary, createdTo: boundary, limit: 1 }, f.context, { repository: f.repository });

    expect(folders).toEqual({ folders: [expect.objectContaining({ key: folderKeys[1], createdAt: boundary })] });
    expect(documents).toEqual({ documents: [expect.objectContaining({ key: documentKeys[1], createdAt: boundary })] });
  });

  test('lists documents in the selected folder hierarchy before pagination', async () => {
    const f = fixture('viewer'); const child = newId();
    f.folders.set(child, { key: child, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding, createdAt: now, updatedAt: now });
    const directKey = f.addDocument('Direct'); const nestedKey = f.addDocument('Nested');
    f.documents.get(directKey).folderKey = f.folderKey;
    f.documents.get(nestedKey).folderKey = child;
    const direct = await runContentTool('document.list', { scopeKey: f.scopeKey, folderKey: f.folderKey }, f.context, { repository: f.repository });
    const tree = await runContentTool('document.list', { scopeKey: f.scopeKey, folderKey: f.folderKey, includeDescendants: true }, f.context, { repository: f.repository });
    expect(direct.documents.map((document: any) => document.key)).toEqual([directKey]);
    expect(tree.documents.map((document: any) => document.key).sort()).toEqual([directKey, nestedKey].sort());
  });

  test('projects only plain document content when requested', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument();
    const projected = await runContentTool('document.find', { documentKeys: [documentKey], include: ['content'] }, f.context, { repository: f.repository });
    expect(projected.results[0]).toMatchObject({ success: true, data: { document: { content: 'First sentence. Second sentence.' } } });
    const summary = await runContentTool('document.find', { documentKeys: [documentKey] }, f.context, { repository: f.repository });
    expect(summary.results[0]?.data?.document).not.toHaveProperty('content');
    expect(projected.results[0]?.data?.document).not.toHaveProperty('html');
  });

  test('projects strict email message payloads as body-only Archive content', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument();
    const payload = JSON.stringify({
      version: 1,
      kind: 'mail-message',
      data: {
        accountKey: newId(), threadKey: newId(), providerMessageId: 'provider-message', from: 'sender@example.com', to: ['reader@example.com'],
        subject: 'Quarterly plan', body: 'The public message body.', summary: 'A summary that must stay private.', direction: 'inbound',
        sentAt: now, hasAttachments: false,
      },
    });
    Object.assign(f.documents.get(documentKey), { name: 'Quarterly plan', content: payload, mutationPolicy: 'system-only', archiveVisibility: 'visible' });

    const found = await runContentTool('document.find', { documentKeys: [documentKey], include: ['content'] }, f.context, { repository: f.repository });
    const read = await runContentTool('document.read', { documentKeys: [documentKey] }, f.context, { repository: f.repository });

    expect(found.results[0]).toMatchObject({ success: true, data: { document: { name: 'Quarterly plan', content: 'The public message body.' } } });
    expect(read.results[0]).toMatchObject({ success: true, data: { title: 'Quarterly plan', content: 'The public message body.' } });
    expect(JSON.parse(f.documents.get(documentKey).content)).toMatchObject({ kind: 'mail-message', data: { summary: 'A summary that must stay private.' } });
    expect(JSON.stringify(found)).not.toContain('provider-message');
    expect(JSON.stringify(read)).not.toContain('provider-message');

    f.documents.get(documentKey).content = JSON.stringify({ ...JSON.parse(payload), unexpected: 'must not leak' });
    const malformed = await runContentTool('document.find', { documentKeys: [documentKey], include: ['content'] }, f.context, { repository: f.repository });
    expect(malformed.results[0]).toMatchObject({ success: false, error: { code: 'CONTENT_INVALID_INPUT' } });
    expect(JSON.stringify(malformed)).not.toContain('must not leak');
  });

  test('sets, projects, clears, and scope-validates folder covers', async () => {
    const f = fixture('moderator');
    const imageKey = newId();
    const dependencies = {
      repository: f.repository,
      embed: async () => embedding,
      getFolderCoverImage: async (candidateScopeKey: string, candidateImageKey: string) => candidateScopeKey === f.scopeKey && candidateImageKey === imageKey ? { storageKey: 'gallery/cover.jpg' } : null,
      signFolderCoverUrl: async (storageKey: string) => `https://images.example/${storageKey}`,
    };
    const set = await runContentTool('folder.update', { updates: [{ folderKey: f.folderKey, coverImageKey: imageKey }] }, f.context, dependencies);
    expect(set.results[0]).toMatchObject({ success: true, data: { folder: { key: f.folderKey, coverUrl: 'https://images.example/gallery/cover.jpg' } } });
    const setResult = set.results[0];
    if (!setResult?.success || !setResult.data) throw new Error('Folder cover update failed.');
    expect(setResult.data.folder).not.toHaveProperty('coverImageKey');
    expect(f.patches.at(-1)).toMatchObject({ coverImageKey: imageKey });

    const cleared = await runContentTool('folder.update', { updates: [{ folderKey: f.folderKey, coverImageKey: null }] }, f.context, dependencies);
    expect(cleared.results[0]).toMatchObject({ success: true, data: { folder: { key: f.folderKey } } });
    const clearedResult = cleared.results[0];
    if (!clearedResult?.success || !clearedResult.data) throw new Error('Folder cover clear failed.');
    expect(clearedResult.data.folder).not.toHaveProperty('coverUrl');
    expect(f.patches.at(-1)).toHaveProperty('coverImageKey', undefined);

    const rejected = await runContentTool('folder.update', { updates: [{ folderKey: f.folderKey, coverImageKey: newId() }] }, f.context, dependencies);
    expect(rejected.results[0]).toMatchObject({ success: false, error: { code: 'CONTENT_NOT_FOUND' } });
  });

  test('supports root documents as an explicit scoped location', async () => {
    const f = fixture('owner');
    const rootKey = f.addDocument('Root content');
    delete f.documents.get(rootKey).folderKey;

    const listed = await runContentTool('document.list', { scopeKey: f.scopeKey }, f.context, { repository: f.repository });
    expect(listed.documents.map((document) => document.key)).toContain(rootKey);

    const moved = await runContentTool('document.move', { moves: [{ documentKey: rootKey, targetScopeKey: f.scopeKey, targetFolderKey: f.folderKey }] }, f.context, { repository: f.repository });
    expect(moved.results[0]?.success).toBe(true);
    await runContentTool('document.move', { moves: [{ documentKey: rootKey, targetScopeKey: f.scopeKey }] }, f.context, { repository: f.repository });
    expect(f.documents.get(rootKey).folderKey).toBeUndefined();

    const shared = await runContentTool('document.share', { shares: [{ documentKey: rootKey, permission: 'read' }] }, f.context, { repository: f.repository, random: (size) => new Uint8Array(size).fill(3) });
    expect(shared.results[0]?.success).toBe(true);
    const versioned = await runContentTool('document.create-version', { documentKeys: [rootKey], contents: { [rootKey]: 'Generated version' }, types: { [rootKey]: 'enhancement' } }, f.context, { repository: f.repository, embed: async () => embedding });
    expect(versioned.results[0]?.success).toBe(true);
    expect([...f.versions.values()].at(-1)?.content).toBe('Generated version');
    expect([...f.versions.values()].at(-1)?.type).toBe('enhancement');
    expect(f.documents.get(rootKey).currentVersionKey).toBeUndefined();

    const currentVersion = await runContentTool('document.create-version', { documentKeys: [rootKey] }, f.context, { repository: f.repository, embed: async () => embedding });
    expect(f.documents.get(rootKey).currentVersionKey).toBe(currentVersion.results[0]?.data?.version.key);
    const getVersion = f.repository.getVersion.bind(f.repository);
    let transactionActive = false;
    f.repository.getVersion = async (key) => {
      if (transactionActive) throw new Error('outer version reads are unavailable during a transaction');
      return getVersion(key);
    };
    f.repository.transaction = async (operation) => {
      transactionActive = true;
      try { return await operation({ ...f.repository, getVersion }); }
      finally { transactionActive = false; }
    };
    await runContentTool('document.restore-version', { restores: [{ documentKey: rootKey, versionKey: versioned.results[0]?.data?.version.key, createBackupVersion: false }] }, f.context, { repository: f.repository, embed: async () => { throw new Error('restore should reuse version semantics'); } });
    expect(f.documents.get(rootKey).currentVersionKey).toBe(versioned.results[0]?.data?.version.key);
    expect(f.documents.get(rootKey).content).toBe('Generated version');
  });

  test('projects visible root mail support documents without persistence embedding markers', async () => {
    const f = fixture('viewer');
    const toneKey = f.addDocument('Concise and direct.');
    const contextKey = f.addDocument('Never schedule on Friday.');
    const ordinaryKey = f.addDocument('Ordinary Archive content.');
    for (const key of [toneKey, contextKey, ordinaryKey]) delete f.documents.get(key).folderKey;
    Object.assign(f.documents.get(toneKey), { mutationPolicy: 'system-only', emailToneEmbeddingVersion: 1 });
    Object.assign(f.documents.get(contextKey), { mutationPolicy: 'system-only', emailReplyContextEmbeddingVersion: 1 });

    const listed = await runContentTool('document.list', { scopeKey: f.scopeKey }, f.context, { repository: f.repository });
    expect(listed.documents.map((document) => document.key).sort()).toEqual([toneKey, contextKey, ordinaryKey].sort());
    for (const document of listed.documents) {
      expect(document).not.toHaveProperty('emailToneEmbeddingVersion');
      expect(document).not.toHaveProperty('emailReplyContextEmbeddingVersion');
    }

    const found = await runContentTool('document.find', { documentKeys: [toneKey, contextKey, ordinaryKey] }, f.context, { repository: f.repository });
    expect(found.summary).toMatchObject({ succeeded: 3, failed: 0 });
    for (const item of found.results) {
      expect(item.success).toBe(true);
      expect(item.data?.document).not.toHaveProperty('emailToneEmbeddingVersion');
      expect(item.data?.document).not.toHaveProperty('emailReplyContextEmbeddingVersion');
    }
    expect(found.results.find((item) => item.key === ordinaryKey)).toMatchObject({ success: true, data: { document: { key: ordinaryKey, name: 'Notes' } } });
  });

  test('rejects cross-scope document moves instead of performing a partial transfer', async () => {
    const f = fixture('admin');
    const foreignScopeKey = newId();
    const targetFolderKey = newId();
    f.folders.set(targetFolderKey, { key: targetFolderKey, scopeKey: foreignScopeKey, name: 'Foreign', embedding, createdAt: now, updatedAt: now });
    const originalGetScope = f.repository.getScope;
    f.repository.getScope = async (key) => key === foreignScopeKey ? { key, organizationKey: f.context.organizationKey } : originalGetScope(key);
    const output = await runContentTool('document.move', { moves: [{ documentKey: f.addDocument(), targetScopeKey: foreignScopeKey, targetFolderKey }] }, f.context, { repository: f.repository });
    expect(output.results[0]).toMatchObject({ success: false, error: { code: 'FOLDER_MOVE_FORBIDDEN' } });
  });

  test('returns a creation-only share token and persists only hashes', async () => {
    const f = fixture('moderator'); const documentKey = f.addDocument();
    const output = await runContentTool('document.share', { shares: [{ documentKey, permission: 'read', password: 'correct horse battery staple' }] }, f.context, { repository: f.repository, random: (size) => new Uint8Array(size).fill(7), clock: () => new Date(now) });
    expect(output.results[0]?.data?.token).toHaveLength(43);
    const persisted = [...f.shares.values()][0];
    expect(persisted.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.passwordHash).toMatch(/^scrypt:/);
    expect(JSON.stringify(output)).not.toContain(persisted.tokenHash);
    const listed = await runContentTool('document.list-shares', { documentKeys: [documentKey] }, f.context, { repository: f.repository, clock: () => new Date(now) });
    expect(JSON.stringify(listed)).not.toContain('Hash');
    expect(JSON.stringify(listed)).not.toContain(output.results[0]?.data?.token ?? 'token');
  });

  test('rejects already expired shares', async () => {
    const f = fixture('moderator');
    const output = await runContentTool('document.share', { shares: [{ documentKey: f.addDocument(), permission: 'read', expiresAt: '2026-07-21T00:00:00.000Z' }] }, f.context, { repository: f.repository, clock: () => new Date(now) });
    expect(output.results[0]).toMatchObject({ success: false, error: { code: 'DOCUMENT_SHARE_INVALID' } });
    expect(f.shares.size).toBe(0);
  });

  test('lists revoked and expired shares only when explicitly requested', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument();
    const base = { documentKey, scopeKey: f.scopeKey, permission: 'read', tokenHash: 'a'.repeat(64), createdAt: now, updatedAt: now };
    const activeKey = newId(), revokedKey = newId(), expiredKey = newId();
    f.shares.set(activeKey, { ...base, key: activeKey, expiresAt: '2027-07-22T12:00:00.000Z' });
    f.shares.set(revokedKey, { ...base, key: revokedKey, revokedAt: now });
    f.shares.set(expiredKey, { ...base, key: expiredKey, expiresAt: '2026-07-21T12:00:00.000Z' });

    const active = await runContentTool('document.list-shares', { documentKeys: [documentKey] }, f.context, { repository: f.repository, clock: () => new Date(now) });
    expect(active.results[0]?.data?.shares.map((share: any) => share.key)).toEqual([activeKey]);
    const all = await runContentTool('document.list-shares', { documentKeys: [documentKey], includeRevoked: true, includeExpired: true }, f.context, { repository: f.repository, clock: () => new Date(now) });
    expect(all.results[0]?.data?.shares.map((share: any) => share.key).sort()).toEqual([activeKey, revokedKey, expiredKey].sort());
  });

  test('maps document processing failures into Content taxonomy and retryability', async () => {
    const f = fixture('moderator');
    const file = { filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 4, bytes: new TextEncoder().encode('text') };
    await expect(runContentTool('document.parse', { file, scopeKey: f.scopeKey, folderKey: f.folderKey }, f.context, {
      repository: f.repository,
      parseDocument: async () => { throw new DocumentProcessingError('DOCUMENT_EMBEDDING_FAILED', 'Embedding failed.', 'document-embed', { retryable: true }); },
    })).rejects.toMatchObject({ code: 'DOCUMENT_EMBEDDING_FAILED', action: 'document-embed', retryable: true });
  });

  test('persists one current audio version, its resume position, and explicit dismissal', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Stable source text.');
    const first = await f.repository.createAudioVersion!({ key: newId(), scopeKey: f.scopeKey, documentKey, sourceContentHash: 'a'.repeat(64), sourceTitle: 'Notes', sourceDocumentUpdatedAt: now, storageKey: 'audio/one.mp3', mimeType: 'audio/mpeg', sizeBytes: 10, durationMs: 60_000, includeTitle: true, includeCode: false, createdByKey: newId(), createdAt: now });
    const second = await f.repository.createAudioVersion!({ key: newId(), scopeKey: f.scopeKey, documentKey, sourceContentHash: 'a'.repeat(64), sourceTitle: 'Notes', sourceDocumentUpdatedAt: now, storageKey: 'audio/two.mp3', mimeType: 'audio/mpeg', sizeBytes: 10, durationMs: 90_000, includeTitle: true, includeCode: false, createdByKey: newId(), createdAt: now });

    await runContentTool('document.audio.playback.update', { audioVersionKey: first.key, playbackPositionMs: 12_345 }, f.context, { repository: f.repository });
    await runContentTool('document.audio.playback.update', { audioVersionKey: second.key, playbackPositionMs: 23_456 }, f.context, { repository: f.repository });
    expect([...f.audioVersions.values()].map(({ key, isCurrent, playbackPositionMs }) => ({ key, isCurrent, playbackPositionMs }))).toEqual([
      { key: first.key, isCurrent: false, playbackPositionMs: 12_345 },
      { key: second.key, isCurrent: true, playbackPositionMs: 23_456 },
    ]);
    await expect(runContentTool('document.audio.playback.update', { audioVersionKey: second.key, playbackPositionMs: 90_001 }, f.context, { repository: f.repository })).rejects.toMatchObject({ code: 'CONTENT_INVALID_INPUT' });
    await runContentTool('document.audio.playback.clear', { documentKey }, f.context, { repository: f.repository });
    expect([...f.audioVersions.values()].every(({ isCurrent }) => !isCurrent)).toBe(true);
    expect(f.audioVersions.get(second.key).playbackPositionMs).toBe(23_456);
  });

  test('returns a specific error when audio history storage is unavailable', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument('Document body.');
    f.repository.listAudioVersions = async () => { throw new Error('collection missing'); };
    const output = await runContentTool('document.list-audio-versions', { documentKeys: [documentKey] }, f.context, { repository: f.repository });
    expect(output.results[0]).toMatchObject({ success: false, error: { code: 'DOCUMENT_SPEECH_FAILED', message: 'Audio version history could not be loaded.', action: 'audio-history' } });
  });

  test('filters semantic search to authorized scopes', async () => {
    const f = fixture('viewer'); f.addDocument('Roadmap launch'); let authorized: string[] = [];
    f.repository.semanticSearch = async (input) => { authorized = input.authorizedScopeKeys; return [...f.documents.values()].map((document) => ({ score: 0.8, document, matchedContent: 'Matched passage later in the document.' })); };
    const output = await runContentTool('document.search', { scopeKey: f.scopeKey, query: 'roadmap', include: ['snippet'] }, f.context, { repository: f.repository, embed: async () => embedding });
    expect(authorized).toEqual([f.scopeKey]); expect(output.results[0]).toMatchObject({ score: 0.8, snippet: 'Matched passage later in the document.' });
  });

  test('returns exact lexical folder matches without waiting for query embedding', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument('Quasar timeline velocity roadmap');
    let embedCalls = 0;
    f.repository.semanticSearch = async () => { throw new Error('semantic search should not run'); };
    const output = await runContentTool('document.search', {
      scopeKey: f.scopeKey,
      query: 'quasar',
      sources: [{ type: 'folder', folderKeys: [f.folderKey], includeDescendants: true }],
    }, f.context, { repository: f.repository, embed: async () => { embedCalls += 1; throw new Error('provider unavailable'); } });
    expect(embedCalls).toBe(0);
    expect(output.results).toHaveLength(1);
    expect(output.results[0]).toMatchObject({ documentKey, extension: 'txt', matchedSource: { type: 'folder', key: f.folderKey } });
  });

  test('embeds plain content before document update', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Old body');
    const actions: string[] = [];
    const output = await runContentTool('document.update', {
      updates: [{ documentKey, content: 'New body' }],
    }, f.context, {
      repository: f.repository,
      embed: async () => embedding,
      ingestion: { embeddingDimensions: EMBEDDING_DIMENSIONS },
      observer(event) {
        if (event.type === 'action' && event.status === 'started' && event.action?.startsWith('document-')) actions.push(event.action);
      },
    });
    expect(output.results[0]?.success).toBe(true);
    expect(actions).toEqual(['document-embed']);
    expect(f.documents.get(documentKey)).toMatchObject({ content: 'New body', embedding });
    expect(f.documents.get(documentKey)).not.toHaveProperty('html');
  });

  test('creates and autosaves live documents without versions', async () => {
    const f = fixture('moderator');
    const dependencies = { repository: f.repository, embed: async () => embedding, ingestion: { embeddingDimensions: EMBEDDING_DIMENSIONS } };
    const created = await runContentTool('document.create', { scopeKey: f.scopeKey, folderKey: f.folderKey, name: 'Plan', content: 'Initial plan' }, f.context, dependencies);
    expect(created.document.name).toBe('Plan');
    expect(f.versions.size).toBe(0);
    const autosaved = await runContentTool('document.update', { updates: [{ documentKey: created.document.key, content: 'Autosaved plan', createVersion: false, expectedUpdatedAt: created.document.updatedAt }] }, f.context, dependencies);
    expect(f.versions.size).toBe(0);
    const autosavedAt = autosaved.results[0]?.data?.document.updatedAt;
    expect(autosavedAt).toBeDefined();
    expect(Date.parse(autosavedAt!)).toBeGreaterThan(Date.parse(created.document.updatedAt));
    const conflict = await runContentTool('document.update', { updates: [{ documentKey: created.document.key, content: 'Stale save', expectedUpdatedAt: created.document.updatedAt }] }, f.context, dependencies);
    expect(conflict.results[0]).toMatchObject({ success: false, error: { code: 'DOCUMENT_VERSION_CONFLICT' } });
  });

  test('routes Archive generation and embeddings through registered actions', async () => {
    const f = fixture('moderator');
    const calls: Array<{ actionSlug: string; input: unknown }> = [];
    let activeEmbeddings = 0;
    let maximumActiveEmbeddings = 0;
    let nextEmbedding = 0;
    const executeAction: any = async (request: { actionSlug: string; mode: string }, input: unknown) => {
      expect(request.mode).toBe('auto');
      calls.push({ actionSlug: request.actionSlug, input });
      let output: { embedding: number[] } | { text: string } = { text: 'generated text' };
      if (request.actionSlug === 'embed') {
        const index = nextEmbedding++;
        activeEmbeddings += 1;
        maximumActiveEmbeddings = Math.max(maximumActiveEmbeddings, activeEmbeddings);
        await Bun.sleep(2);
        activeEmbeddings -= 1;
        output = { embedding: [index, ...embedding.slice(1)] };
      }
      return {
        output,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        providerId: 'openrouter',
        modelId: request.actionSlug === 'embed' ? 'openai.text-embedding-3-small' : 'google.gemini-3.1-flash-lite',
        externalModelId: request.actionSlug === 'embed' ? 'openai/text-embedding-3-small' : 'google/gemini-3.1-flash-lite',
      };
    };
    const dependencies = { repository: f.repository, executeAction };
    expect((await runContentTool('folder.create', { folders: [{ scopeKey: f.scopeKey, name: 'Routed folder' }] }, f.context, dependencies)).summary.failed).toBe(0);
    expect((await runContentTool('document.create', { scopeKey: f.scopeKey, name: 'Routed note', content: 'Routed body' }, f.context, dependencies)).document.name).toBe('Routed note');
    expect(calls.map(({ actionSlug }) => actionSlug)).toEqual(['embed', 'embed']);
    expect(calls.filter(({ actionSlug }) => actionSlug === 'embed').every(({ input }) => typeof (input as { text?: unknown }).text === 'string')).toBe(true);

    calls.length = 0;
    nextEmbedding = 0;
    maximumActiveEmbeddings = 0;
    const longContent = Array.from({ length: 10_500 }, () => 'word').join(' ');
    const created = await runContentTool('document.create', { scopeKey: f.scopeKey, name: 'Chunked note', content: longContent }, f.context, dependencies);
    const chunkEmbeddings = f.documents.get(created.document.key).chunkEmbeddings as number[][];
    expect(chunkEmbeddings.length).toBeGreaterThan(8);
    expect(maximumActiveEmbeddings).toBe(8);
    expect(chunkEmbeddings.map((value) => value[0])).toEqual([...chunkEmbeddings.keys()]);
  });

  test('finds independently capped semantic neighbors and excludes pending deletion hierarchy and the source', async () => {
    const f = fixture('viewer');
    const activeFolderKey = newId();
    const pendingParentKey = newId();
    const inactiveChildKey = newId();
    f.folders.set(activeFolderKey, { key: activeFolderKey, scopeKey: f.scopeKey, name: 'Related', embedding, createdAt: now, updatedAt: now });
    f.folders.set(pendingParentKey, { key: pendingParentKey, scopeKey: f.scopeKey, name: 'Pending', embedding, _internalDeletion: { kind: 'folder', owner: newId(), startedAt: now }, createdAt: now, updatedAt: now });
    f.folders.set(inactiveChildKey, { key: inactiveChildKey, scopeKey: f.scopeKey, parentFolderKey: pendingParentKey, name: 'Hidden child', embedding, createdAt: now, updatedAt: now });
    const documentKey = f.addDocument('Related note');
    delete f.documents.get(documentKey).extension;
    const fileKey = f.addDocument('Related file');
    const inactiveDocumentKey = f.addDocument('Hidden file');
    f.documents.get(inactiveDocumentKey).folderKey = inactiveChildKey;
    let semanticInput: any;
    f.repository.semanticNeighbors = async (input) => {
      semanticInput = input;
      return {
        folders: [...f.folders.values()].map((folder) => ({ score: 0.8, folder })),
        documents: [{ score: 0.8, document: f.documents.get(documentKey) }],
        files: [fileKey, inactiveDocumentKey].map((key) => ({ score: 0.8, document: f.documents.get(key) })),
      };
    };

    const result = await runContentTool('content.neighbors', { folderKey: f.folderKey }, f.context, { repository: f.repository });
    expect(result.folders.map((folder) => folder.key)).toEqual([activeFolderKey]);
    expect(result.documents.map((document) => document.key)).toEqual([documentKey]);
    expect(result.files.map((document) => document.key)).toEqual([fileKey]);
    expect(semanticInput).toMatchObject({ scopeKey: f.scopeKey, sourceFolderKey: f.folderKey, limit: 10 });
    expect(semanticInput.activeFolderKeys).toContain(activeFolderKey);
    expect(semanticInput.activeFolderKeys).not.toContain(pendingParentKey);
    expect(semanticInput.activeFolderKeys).not.toContain(inactiveChildKey);

    f.documents.get(fileKey).embedding = undefined;
    await expect(runContentTool('content.neighbors', { documentKey: fileKey }, f.context, { repository: f.repository })).rejects.toMatchObject({ code: 'CONTENT_CONFLICT' });
    f.folders.get(f.folderKey)._internalDeletion = { kind: 'folder', owner: newId(), startedAt: now };
    await expect(runContentTool('content.neighbors', { folderKey: f.folderKey }, f.context, { repository: f.repository })).rejects.toMatchObject({ code: 'CONTENT_NOT_FOUND' });
  });

  test('searches folders and chunk-aware documents with caps, summaries, cache, auth, and global user history', async () => {
    const f = fixture('viewer');
    for (let index = 0; index < 6; index += 1) {
      const key = newId();
      f.folders.set(key, { key, scopeKey: f.scopeKey, name: `Folder ${index}`, embedding, createdAt: now, updatedAt: now });
    }
    for (let index = 0; index < 12; index += 1) f.addDocument(`Roadmap content ${index}`);
    let embeddingCalls = 0;
    let summaryCalls = 0;
    let allowed = true;
    let clock = new Date(now);
    const rows = new Map<string, any>();
    const historyRows = new Map<string, any>();
    f.repository.allowedScopeKeys = async () => allowed ? [f.scopeKey] : [];
    f.repository.semanticSearchFolders = async (input) => [...f.folders.values()].filter((folder) => !input.folderKeys || input.folderKeys.includes(folder.key)).map((folder, index) => ({ score: index === 0 ? 0.54 : 0.9, folder }));
    f.repository.semanticSearch = async (input) => [...f.documents.values()].filter((document) => !input.folderKeys || input.folderKeys.includes(document.folderKey)).map((document, index) => ({ score: index === 0 ? 0.54 : 0.9, document }));
    const searchQueries = {
      async get({ actorKey, scopeKey, normalizedQuery, folderKey, includeDescendants }: any) { return rows.get(`${actorKey}:${scopeKey}:${normalizedQuery}:${folderKey ?? 'root'}:${includeDescendants}`) ?? null; },
      async record(value: any) { const identity = `${value.actorKey}:${value.scopeKey}:${value.normalizedQuery}:${value.folderKey ?? 'root'}:${value.includeDescendants}`; rows.set(identity, { output: value.output }); },
    };
    const userSearches = {
      async record(userKey: string, query: string) { const normalizedQuery = query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); const identity = `${userKey}:${normalizedQuery}`; const old = historyRows.get(identity); const value = { query: query.trim(), normalizedQuery, searchedAt: clock.toISOString(), usageCount: (old?.usageCount ?? 0) + 1 }; historyRows.set(identity, value); return value; },
      async list(userKey: string, limit: number) { return [...historyRows.entries()].filter(([identity]) => identity.startsWith(`${userKey}:`)).map(([, value]) => value).slice(0, limit); },
      async remove(userKey: string, query: string) { const normalizedQuery = query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); return { normalizedQuery, deleted: historyRows.delete(`${userKey}:${normalizedQuery}`) }; },
    };
    const dependencies: any = {
      repository: f.repository,
      searchQueries,
      userSearches,
      clock: () => clock,
      embed: async () => { embeddingCalls += 1; return embedding; },
      runAction: async (action: string, input: any) => { summaryCalls += 1; expect(action).toBe('text.search-summary'); const parsed = chatInputSchema.parse(input); const text = parsed.messages[0]?.content[0]?.type === 'text' ? parsed.messages[0].content[0].text : ''; expect(text).toContain('Launch Roadmap'); return { text: 'Relevant to Launch Roadmap' }; },
    };
    await runContentTool('content.search', { scopeKey: f.scopeKey, query: 'Roadmap content', includeSummaries: false, recordHistory: false }, f.context, dependencies);
    expect(rows).toHaveLength(1);
    expect(historyRows).toHaveLength(0);
    const first = await runContentTool('content.search', { scopeKey: f.scopeKey, query: 'Launch Roadmap' }, f.context, dependencies);
    expect(first.folders).toHaveLength(4);
    expect(first.folders.every((item) => item.score >= 0.55)).toBe(true);
    expect(first.documents).toHaveLength(10);
    expect(first.documents.every((item) => item.score >= 0.55 && item.summary?.includes('Launch Roadmap') === true)).toBe(true);
    expect(embeddingCalls).toBe(1);
    expect(summaryCalls).toBe(10);
    clock = new Date(Date.parse(now) + 2 * 60 * 60 * 1000);
    const replay = await runContentTool('content.search', { scopeKey: f.scopeKey, query: '  launch   roadmap  ' }, f.context, dependencies);
    expect(replay.cached).toBe(true);
    expect(embeddingCalls).toBe(1);
    expect(summaryCalls).toBe(10);
    const favoriteOnlyDocument = f.documents.get(first.documents[0]!.documentKey);
    favoriteOnlyDocument.isFavorite = true;
    favoriteOnlyDocument.updatedAt = '2026-07-23T11:00:00.000Z';
    const metadataReplay = await runContentTool('content.search', { scopeKey: f.scopeKey, query: 'launch roadmap' }, f.context, dependencies);
    expect(metadataReplay.cached).toBe(false);
    expect(metadataReplay.documents.find((document) => document.documentKey === favoriteOnlyDocument.key)?.isFavorite).toBe(true);
    expect(embeddingCalls).toBe(2);
    expect(summaryCalls).toBe(20);
    const history = await runContentTool('content.search-history.list', { scopeKey: f.scopeKey }, f.context, dependencies);
    expect(history.history).toEqual([{ query: 'launch roadmap', normalizedQuery: 'launch roadmap', searchedAt: clock.toISOString(), usageCount: 3 }]);
    const childKey = newId();
    f.folders.set(childKey, { key: childKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding, createdAt: now, updatedAt: now });
    const nestedDocumentKey = [...f.documents.keys()][1]!;
    f.documents.get(nestedDocumentKey).folderKey = childKey;
    const folderReplay = await runContentTool('content.search', { scopeKey: f.scopeKey, folderKey: f.folderKey, query: 'launch roadmap' }, f.context, dependencies);
    expect(folderReplay.folders).toEqual([{ key: childKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', isFavorite: false, managed: false, createdAt: now, updatedAt: now, score: 0.9 }]);
    expect(folderReplay.cached).toBe(false);
    expect(rows).toHaveLength(3);
    expect(folderReplay.documents.some((document) => document.documentKey === nestedDocumentKey)).toBe(true);
    const directFolderSearch = await runContentTool('content.search', { scopeKey: f.scopeKey, folderKey: f.folderKey, includeDescendants: false, query: 'launch roadmap' }, f.context, dependencies);
    expect(directFolderSearch.documents.some((document) => document.documentKey === nestedDocumentKey)).toBe(false);
    expect(rows).toHaveLength(4);
    const folderHistory = await runContentTool('content.search-history.list', { scopeKey: f.scopeKey, folderKey: f.folderKey }, f.context, dependencies);
    expect(folderHistory.history[0]).not.toHaveProperty('folderKey');
    const globalHistory = await runContentTool('content.search-history.list', { scopeKey: f.scopeKey, allLocations: true }, f.context, dependencies);
    expect(globalHistory.history).toMatchObject([{ normalizedQuery: 'launch roadmap', usageCount: 5 }]);
    f.documents.get(first.documents[0]!.documentKey).semanticContentHash = 'a'.repeat(64);
    const invalidated = await runContentTool('content.search', { scopeKey: f.scopeKey, query: 'launch roadmap' }, f.context, dependencies);
    expect(invalidated.cached).toBe(false);
    expect(embeddingCalls).toBe(5);
    const otherContext = { ...f.context, principal: { ...f.context.principal, user: { key: newId() } } };
    const isolated = await runContentTool('content.search-history.list', { scopeKey: f.scopeKey }, otherContext, dependencies);
    expect(isolated.history).toEqual([]);
    expect(await runContentTool('content.search-history.delete', { scopeKey: f.scopeKey, normalizedQuery: 'launch roadmap', allLocations: true }, f.context, dependencies)).toEqual({ normalizedQuery: 'launch roadmap', deleted: true });
    expect((await runContentTool('content.search-history.list', { scopeKey: f.scopeKey, allLocations: true }, f.context, dependencies)).history).toEqual([]);
    allowed = false;
    await expect(runContentTool('content.search', { scopeKey: f.scopeKey, query: 'launch roadmap' }, f.context, dependencies)).rejects.toMatchObject({ code: 'CONTENT_FORBIDDEN' });
  });

  test('returns fast recursive folder and document matches without generating summaries', async () => {
    const f = fixture('viewer');
    f.folders.get(f.folderKey).name = 'Launch plans';
    f.folders.get(f.folderKey).description = 'Release coordination and launch readiness.';
    const childKey = newId();
    f.folders.set(childKey, { key: childKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Operations', description: 'Deployment procedures and rollback checks.', embedding, createdAt: now, updatedAt: now });
    const noteKey = f.addDocument('Launch positioning and audience notes.');
    const fileKey = f.addDocument('Deployment procedures for launch day.');
    f.documents.get(noteKey).name = 'Launch narrative';
    delete f.documents.get(noteKey).extension;
    f.documents.get(fileKey).name = 'Deployment runbook';
    f.documents.get(fileKey).folderKey = childKey;
    f.documents.get(fileKey).extension = 'pdf';
    let embeddingCalls = 0;
    const cachedSearches = new Map<string, unknown>();
    const cacheKey = (input: any) => `${input.normalizedQuery}:${input.folderKey ?? 'root'}:${input.includeDescendants}`;
    const dependencies: any = {
      repository: f.repository,
      embed: async () => { embeddingCalls += 1; return embedding; },
      searchQueries: {
        async get(input: any) { const output = cachedSearches.get(cacheKey(input)); return output ? { output } : null; },
        async record(input: any) { cachedSearches.set(cacheKey(input), input.output); },
      },
      userSearches: { async record() { return {} as any; }, async list() { return []; }, async remove(_userKey: string, query: string) { return { normalizedQuery: query, deleted: false }; } },
    };

    const root = await runContentTool('content.search', { scopeKey: f.scopeKey, query: 'launch', includeSummaries: false }, f.context, dependencies);
    expect(root.folders).toMatchObject([{ key: f.folderKey, name: 'Launch plans' }]);
    expect(root.documents).toContainEqual(expect.objectContaining({ documentKey: noteKey, name: 'Launch narrative' }));
    expect(root.documents.find((item) => item.documentKey === noteKey)).not.toHaveProperty('summary');
    expect(embeddingCalls).toBe(0);

    const nested = await runContentTool('content.search', { scopeKey: f.scopeKey, folderKey: f.folderKey, query: 'deployment', includeSummaries: false }, f.context, dependencies);
    expect(nested.documents).toContainEqual(expect.objectContaining({ documentKey: fileKey, folderKey: childKey, extension: 'pdf' }));
    expect(embeddingCalls).toBe(0);

    await runContentTool('content.search', { scopeKey: f.scopeKey, folderKey: f.folderKey, query: 'semantically related', includeSummaries: false }, f.context, dependencies);
    const replay = await runContentTool('content.search', { scopeKey: f.scopeKey, folderKey: f.folderKey, query: 'semantically related', includeSummaries: false }, f.context, dependencies);
    expect(embeddingCalls).toBe(1);
    expect(replay.cached).toBe(true);
  });

  test('filters lexical and semantic content candidates by creation date and isolates cache reuse', async () => {
    const f = fixture('viewer');
    const boundary = '2026-07-22T10:00:00.000Z';
    f.folders.get(f.folderKey).createdAt = boundary;
    f.folders.get(f.folderKey).updatedAt = boundary;
    f.folders.get(f.folderKey).name = 'Boundary launch folder';
    const oldFolderKey = newId();
    f.folders.set(oldFolderKey, { key: oldFolderKey, scopeKey: f.scopeKey, name: 'Old launch folder', embedding, createdAt: '2026-07-22T09:59:59.999Z', updatedAt: boundary });
    const boundaryDocumentKey = f.addDocument('Boundary launch document');
    f.documents.get(boundaryDocumentKey).createdAt = boundary;
    const oldDocumentKey = f.addDocument('Old launch document');
    f.documents.get(oldDocumentKey).createdAt = '2026-07-22T09:59:59.999Z';
    let documentSemanticInput: any;
    let folderSemanticInput: any;
    f.repository.semanticSearch = async (input) => { documentSemanticInput = input; return [...f.documents.values()].map((document) => ({ score: 0.9, document })); };
    f.repository.semanticSearchFolders = async (input) => { folderSemanticInput = input; return [...f.folders.values()].map((folder) => ({ score: 0.9, folder })); };
    let cachedOutput: unknown;
    const searchQueries = {
      async get() { return cachedOutput ? { output: cachedOutput } : null; },
      async record(input: any) { cachedOutput = input.output; },
    };
    const dependencies: any = {
      repository: f.repository,
      queryEmbedding: embedding,
      searchQueries,
      userSearches: { async record() { return {} as any; }, async list() { return []; }, async remove(_userKey: string, query: string) { return { normalizedQuery: query, deleted: false }; } },
    };

    const lexical = await runContentTool('content.search', { scopeKey: f.scopeKey, query: 'launch', includeSummaries: false, createdFrom: boundary, createdTo: boundary, recordHistory: false }, f.context, dependencies);
    expect(lexical.folders.map((folder) => folder.key)).toEqual([f.folderKey]);
    expect(lexical.documents.map((document) => document.documentKey)).toEqual([boundaryDocumentKey]);
    expect(lexical.folders[0]).toMatchObject({ createdAt: boundary, updatedAt: boundary });
    expect(lexical.documents[0]).toMatchObject({ createdAt: boundary, updatedAt: now });

    const semantic = await runContentTool('content.search', { scopeKey: f.scopeKey, query: 'semantic-only', includeSummaries: false, minimumScore: -1, createdFrom: boundary, createdTo: boundary, recordHistory: false }, f.context, dependencies);
    expect(documentSemanticInput).toMatchObject({ createdFrom: boundary, createdTo: boundary });
    expect(folderSemanticInput).toMatchObject({ createdFrom: boundary, createdTo: boundary });
    expect(semantic.documents.map((document) => document.documentKey)).toEqual([boundaryDocumentKey]);
    expect(semantic.folders.map((folder) => folder.key)).toEqual([f.folderKey]);

    const differentRange = await runContentTool('content.search', { scopeKey: f.scopeKey, query: 'semantic-only', includeSummaries: false, minimumScore: -1, createdTo: '2026-07-22T09:59:59.999Z', recordHistory: false }, f.context, dependencies);
    expect(differentRange.cached).toBe(false);
    expect(differentRange.documents.map((document) => document.documentKey)).toContain(oldDocumentKey);
    expect(differentRange.folders.map((folder) => folder.key)).toContain(oldFolderKey);
  });

  test('semantically enriches exact lexical matches when the caller disables the cutoff', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument('Orange launch plan');
    f.documents.get(documentKey).name = 'Orange launch plan';
    let semanticCalls = 0;
    f.repository.semanticSearch = async () => { semanticCalls += 1; return [{ document: f.documents.get(documentKey), score: 0.91 }]; };
    const result = await runContentTool('content.search', { scopeKey: f.scopeKey, query: 'orange', includeSummaries: false, minimumScore: -1, limit: 1, recordHistory: false }, f.context, {
      repository: f.repository,
      queryEmbedding: embedding,
      userSearches: { async record() { return {} as any; }, async list() { return []; }, async remove(_userKey: string, query: string) { return { normalizedQuery: query, deleted: false }; } },
    });
    expect(semanticCalls).toBe(1);
    expect(result.documents).toEqual([expect.objectContaining({ documentKey, score: 0.91 })]);
  });

  test('ranks a whole-token document title mention ahead of a stronger semantic distractor', async () => {
    const f = fixture('viewer');
    const namedKey = f.addDocument('The requested research findings.');
    const distractorKey = f.addDocument('General notes with semantically similar material.');
    f.documents.get(namedKey).name = 'Research Note';
    f.documents.get(distractorKey).name = 'Quarterly Analysis';
    f.repository.semanticSearch = async () => [
      { document: f.documents.get(distractorKey), score: 0.99 },
      { document: f.documents.get(namedKey), score: 0.2 },
    ];
    const result = await runContentTool('content.search', { scopeKey: f.scopeKey, query: 'What can you tell me about the Research-Note document?', includeSummaries: false, minimumScore: -1, limit: 1, recordHistory: false }, f.context, {
      repository: f.repository,
      queryEmbedding: embedding,
      userSearches: { async record() { return {} as any; }, async list() { return []; }, async remove(_userKey: string, query: string) { return { normalizedQuery: query, deleted: false }; } },
    });
    expect(result.documents).toEqual([expect.objectContaining({ documentKey: namedKey, name: 'Research Note' })]);
  });

  test('does not treat a partial title token as a named-resource match', async () => {
    const f = fixture('viewer');
    const partialKey = f.addDocument('Unrelated body.');
    const semanticKey = f.addDocument('Researcher background and profile.');
    f.documents.get(partialKey).name = 'Research';
    f.documents.get(semanticKey).name = 'Profile';
    f.repository.semanticSearch = async () => [{ document: f.documents.get(semanticKey), score: 0.99 }];
    const result = await runContentTool('content.search', { scopeKey: f.scopeKey, query: 'Tell me about the researcher profile', includeSummaries: false, minimumScore: -1, limit: 1, recordHistory: false }, f.context, {
      repository: f.repository,
      queryEmbedding: embedding,
      userSearches: { async record() { return {} as any; }, async list() { return []; }, async remove(_userKey: string, query: string) { return { normalizedQuery: query, deleted: false }; } },
    });
    expect(result.documents[0]?.documentKey).toBe(semanticKey);
    expect(result.documents[0]?.documentKey).not.toBe(partialKey);
  });

  test('returns search results when cache and history persistence are unavailable', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument('Launch notes');
    f.documents.get(documentKey).name = 'Launch plan';
    const result = await runContentTool('content.search', { scopeKey: f.scopeKey, query: 'launch', includeSummaries: false }, f.context, {
      repository: f.repository,
      searchQueries: { async get() { throw new Error('cache unavailable'); }, async record() { throw new Error('cache unavailable'); } },
      userSearches: { async record() { throw new Error('history unavailable'); }, async list() { return []; }, async remove(_userKey: string, query: string) { return { normalizedQuery: query, deleted: false }; } },
    });
    expect(result.documents).toContainEqual(expect.objectContaining({ documentKey, name: 'Launch plan' }));
  });

  test('excludes semantic matches below pending deletion folder ancestors before summary generation', async () => {
    const f = fixture('viewer');
    const pendingParentKey = newId();
    const childKey = newId();
    f.folders.set(pendingParentKey, { key: pendingParentKey, scopeKey: f.scopeKey, name: 'Pending', embedding, _internalDeletion: { kind: 'folder', owner: newId(), startedAt: now }, createdAt: now, updatedAt: now });
    f.folders.set(childKey, { key: childKey, scopeKey: f.scopeKey, parentFolderKey: pendingParentKey, name: 'Hidden child', embedding, createdAt: now, updatedAt: now });
    const documentKey = f.addDocument('Hidden content');
    f.documents.get(documentKey).folderKey = childKey;
    f.repository.semanticSearchFolders = async () => [{ score: 0.9, folder: f.folders.get(childKey) }];
    f.repository.semanticSearch = async () => [{ score: 0.9, document: f.documents.get(documentKey), matchedContent: 'Hidden content' }];
    let summaryCalls = 0;
    const result = await runContentTool('content.search', { scopeKey: f.scopeKey, query: 'hidden' }, f.context, {
      repository: f.repository,
      embed: async () => embedding,
      runAction: async () => { summaryCalls += 1; return { text: 'Should not run' }; },
      searchQueries: { async get() { return null; }, async record() {} },
      userSearches: { async record() { return {} as any; }, async list() { return []; }, async remove(_userKey: string, query: string) { return { normalizedQuery: query, deleted: false }; } },
    });
    expect(result.folders).toEqual([]);
    expect(result.documents).toEqual([]);
    expect(summaryCalls).toBe(0);
  });

  test('re-embeds legacy vectors for every new document and version rollout path', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Legacy body');
    const legacy = Array(1_536).fill(0.1);
    f.documents.get(documentKey).embedding = legacy;
    const embeddedTexts: string[] = [];
    const dependencies: any = {
      repository: f.repository,
      embeddingDimensions: EMBEDDING_DIMENSIONS,
      ingestion: { embeddingDimensions: EMBEDDING_DIMENSIONS },
      embed: async (text: string) => { embeddedTexts.push(text); return embedding; },
      storage: { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy(input: any) { return { storageKey: input.destinationKey }; }, async delete() {} },
    };

    const created = await runContentTool('document.create-version', { documentKeys: [documentKey] }, f.context, dependencies);
    expect(created.results[0]?.success).toBe(true);
    expect([...f.versions.values()].at(-1)?.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(embeddedTexts).toContain('Notes\n\nLegacy body');

    f.documents.get(documentKey).embedding = legacy;
    const updated = await runContentTool('document.update', { updates: [{ documentKey, content: 'Updated body', createVersion: true }] }, f.context, dependencies);
    expect(updated.results[0]?.success).toBe(true);
    expect([...f.versions.values()].at(-1)?.embedding).toHaveLength(EMBEDDING_DIMENSIONS);

    const legacyVersion = await f.repository.createVersion({ scopeKey: f.scopeKey, documentKey, content: 'Historical exact body', embedding });
    f.documents.get(documentKey).embedding = embedding;
    const copied = await runContentTool('document.copy', { copies: [{ documentKey, targetScopeKey: f.scopeKey, targetFolderKey: f.folderKey, includeVersions: true }] }, f.context, dependencies);
    expect(copied.results[0]?.success).toBe(true);
    const copiedKey = copied.results[0]?.data?.document.key;
    expect(copiedKey).toBeDefined();
    expect(f.documents.get(copiedKey!)?.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect([...f.versions.values()].filter((version) => version.documentKey === copiedKey!).every((version) => version.embedding.length === EMBEDDING_DIMENSIONS)).toBe(true);

    f.documents.get(documentKey).embedding = legacy;
    const restored = await runContentTool('document.restore-version', { restores: [{ documentKey, versionKey: legacyVersion.key, createBackupVersion: true }] }, f.context, dependencies);
    expect(restored.results[0]?.success).toBe(true);
    expect(f.documents.get(documentKey)?.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(embeddedTexts).toContain('Notes\n\nHistorical exact body');

    f.documents.get(documentKey).embedding = legacy;
    const generated = await runContentTool('document.translate', { documentKeys: [documentKey], targetLanguage: 'engleksa', instruction: 'Use concise headings.', mode: 'replace' }, f.context, {
      ...dependencies,
      runAction: async (action: string, input: any) => {
        if (action === 'text.translate') {
          expect(input.systemPrompt).toContain('collapse excessive blank lines');
          expect(input.systemPrompt).toContain('readable sections');
          expect(input.systemPrompt).toContain('into engleksa');
          expect(input.systemPrompt).toContain('native name or endonym');
          expect(input.systemPrompt).toContain('mildly misspelled');
          expect(input.systemPrompt).toContain('Additional direction: Use concise headings.');
          return { text: '  Titre  \r\n\r\n\r\nCorps traduit  \r\n ' };
        }
        if (action === 'document-embed') return documentEmbed(input, { embed: async ({ text }) => { embeddedTexts.push(text); return embedding; }, dimensions: EMBEDDING_DIMENSIONS });
        throw new Error(`Unexpected action ${action}`);
      },
    });
    expect(generated.results[0]?.success).toBe(true);
    expect(generated.results[0]?.data?.text).toBe('Titre\n\nCorps traduit');
    expect([...f.versions.values()].at(-1)?.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  test('defaults folder favorites, batch-updates them, and resets copied document favorites', async () => {
    const f = fixture('moderator');
    const created = await runContentTool('folder.create', { folders: [{ scopeKey: f.scopeKey, name: 'Default' }] }, f.context, { repository: f.repository, embed: async () => embedding });
    expect(created.results[0]?.data?.folder.isFavorite).toBe(false);
    const secondFolderKey = created.results[0]?.data?.folder.key;
    const favorites = await runContentTool('folder.update', { updates: [{ folderKey: f.folderKey, isFavorite: true }, { folderKey: secondFolderKey!, isFavorite: true }], atomic: true }, f.context, { repository: f.repository });
    expect(favorites.summary).toEqual({ requested: 2, succeeded: 2, failed: 0 });
    expect(favorites.results.every((result) => result.data?.folder.isFavorite === true)).toBe(true);

    const documentKey = f.addDocument('Source');
    f.documents.get(documentKey).isFavorite = true;
    const copied = await runContentTool('document.copy', {
      copies: [{ documentKey, targetScopeKey: f.scopeKey, targetFolderKey: f.folderKey }],
    }, f.context, { repository: f.repository, embed: async () => embedding, storage: { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy(input) { return { storageKey: input.destinationKey }; }, async delete() {} } });
    expect(copied.results[0]?.data?.document.isFavorite).toBe(false);
  });

  test('copies scanned pages and speech objects into independent document storage', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Scanned content');
    const source = f.documents.get(documentKey);
    source.extension = undefined;
    source.mimeType = undefined;
    source.storageKey = undefined;
    source.sourceStorageKeys = ['scans/page-01.png', 'scans/page-02.png'];
    source.speechStorageKeys = ['speech/current.mp3'];
    const copiedObjects: Array<{ sourceKey: string; destinationKey: string }> = [];
    const copied = await runContentTool('document.copy', { copies: [{ documentKey, targetScopeKey: f.scopeKey, targetFolderKey: f.folderKey }] }, f.context, {
      repository: f.repository,
      embed: async () => embedding,
      storage: {
        async upload() { return { storageKey: '' }; },
        async download() { return { bytes: new Uint8Array() }; },
        async copy(input) { copiedObjects.push(input); return { storageKey: input.destinationKey }; },
        async delete() {},
      },
    });
    const copiedKey = copied.results[0]?.data?.document.key;
    if (!copiedKey) throw new Error('Document copy did not return a key.');
    const copy = f.documents.get(copiedKey);
    expect(copiedObjects.map(({ sourceKey }) => sourceKey)).toEqual([...source.sourceStorageKeys, ...source.speechStorageKeys]);
    expect(copy.sourceStorageKeys).toHaveLength(2);
    expect(copy.sourceStorageKeys).not.toEqual(source.sourceStorageKeys);
    expect(copy.speechStorageKeys).toHaveLength(1);
    expect(copied.results[0]?.data?.document.sourceImageCount).toBe(2);
  });

  test('deletes copied scan sources when document copy persistence fails', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Scanned content');
    const source = f.documents.get(documentKey);
    source.sourceStorageKeys = ['scans/page-01.png', 'scans/page-02.png'];
    const insertDocument = f.repository.insertDocument.bind(f.repository);
    f.repository.insertDocument = async (document) => document.key === documentKey ? insertDocument(document) : Promise.reject(new Error('insert failed'));
    const copiedObjects: string[] = [];
    const deletedObjects: string[] = [];
    const failed = await runContentTool('document.copy', { copies: [{ documentKey, targetScopeKey: f.scopeKey, targetFolderKey: f.folderKey }] }, f.context, {
      repository: f.repository,
      embed: async () => embedding,
      storage: {
        async upload() { return { storageKey: '' }; },
        async download() { return { bytes: new Uint8Array() }; },
        async copy(input) { copiedObjects.push(input.destinationKey); return { storageKey: input.destinationKey }; },
        async delete(key) { deletedObjects.push(key); },
      },
    });
    expect(failed.results[0]?.success).toBe(false);
    expect(copiedObjects).toHaveLength(3);
    expect(deletedObjects.sort()).toEqual(copiedObjects.sort());
  });

  test('copies complete folder subtrees with independent storage and compensates failed copies', async () => {
    const f = fixture('moderator');
    const childKey = newId(), nestedKey = newId(), targetKey = newId();
    f.folders.set(childKey, { key: childKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding, isFavorite: true, createdAt: now, updatedAt: now });
    f.folders.set(nestedKey, { key: nestedKey, scopeKey: f.scopeKey, parentFolderKey: childKey, name: 'Nested', embedding, isFavorite: true, createdAt: now, updatedAt: now });
    f.folders.set(targetKey, { key: targetKey, scopeKey: f.scopeKey, name: 'Target', embedding, isFavorite: false, createdAt: now, updatedAt: now });
    const firstDocumentKey = f.addDocument('Root file');
    const secondDocumentKey = f.addDocument('Child file');
    f.documents.get(firstDocumentKey).folderKey = childKey;
    f.documents.get(firstDocumentKey).sourceStorageKeys = ['docs/source-1.png'];
    f.documents.get(firstDocumentKey).speechStorageKeys = ['docs/speech-1.mp3'];
    f.documents.get(firstDocumentKey).isFavorite = true;
    f.documents.get(secondDocumentKey).folderKey = nestedKey;
    const copiedObjects: string[] = [], deletedObjects: string[] = [];
    const renamedEmbedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.3);
    const embeddedTexts: string[] = [];
    const storage: any = {
      async upload() { return { storageKey: '' }; },
      async download() { return { bytes: new Uint8Array() }; },
      async copy(input: any) { copiedObjects.push(input.destinationKey); return { storageKey: input.destinationKey }; },
      async delete(key: string) { deletedObjects.push(key); },
    };

    const copied = await runContentTool('folder.copy', { copies: [{ folderKey: childKey, targetScopeKey: f.scopeKey, targetParentFolderKey: targetKey, newName: 'Child copy' }] }, f.context, { repository: f.repository, storage, embed: async (text) => { embeddedTexts.push(text); return renamedEmbedding; } });
    expect(copied.results[0]).toMatchObject({ success: true, data: { folder: { name: 'Child copy', parentFolderKey: targetKey, isFavorite: false }, folderCount: 2, documentCount: 2 } });
    const copiedRootKey = copied.results[0]?.data?.folder.key;
    if (!copiedRootKey) throw new Error('Folder copy did not return its root.');
    const copiedNested = [...f.folders.values()].find((candidate) => candidate.parentFolderKey === copiedRootKey);
    expect(copiedNested).toMatchObject({ name: 'Nested', isFavorite: false });
    expect(f.folders.get(copiedRootKey)?.embedding).toEqual(renamedEmbedding);
    expect(embeddedTexts).toEqual(['Child copy']);
    const copiedFolderKeys = new Set([copiedRootKey, copiedNested?.key]);
    const copiedDocuments = [...f.documents.values()].filter((document) => copiedFolderKeys.has(document.folderKey));
    expect(copiedDocuments).toHaveLength(2);
    expect(copiedDocuments.every((document) => document.isFavorite === false && ![firstDocumentKey, secondDocumentKey].includes(document.key))).toBe(true);
    expect(copiedDocuments.find((document) => document.sourceStorageKeys)?.sourceStorageKeys[0]).not.toBe('docs/source-1.png');
    expect(copiedObjects).toHaveLength(4);

    const insertDocument = f.repository.insertDocument.bind(f.repository);
    let inserts = 0;
    f.repository.insertDocument = async (document) => { inserts += 1; if (inserts === 2) throw new Error('insert failed'); return insertDocument(document); };
    const beforeFolders = f.folders.size, beforeDocuments = f.documents.size;
    const failed = await runContentTool('folder.copy', { copies: [{ folderKey: childKey, targetScopeKey: f.scopeKey, targetParentFolderKey: targetKey }] }, f.context, { repository: f.repository, storage });
    expect(failed.results[0]).toMatchObject({ success: false });
    expect(f.folders.size).toBe(beforeFolders);
    expect(f.documents.size).toBe(beforeDocuments);
    expect(deletedObjects.length).toBeGreaterThan(0);
  });

  test('preserves copied root names when sibling names match', async () => {
    const f = fixture('moderator');
    const targetKey = newId(), firstParentKey = newId(), secondParentKey = newId(), firstKey = newId(), secondKey = newId();
    f.folders.set(targetKey, { key: targetKey, scopeKey: f.scopeKey, name: 'Target', embedding, isFavorite: false, createdAt: now, updatedAt: now });
    f.folders.set(firstParentKey, { key: firstParentKey, scopeKey: f.scopeKey, name: 'First parent', embedding, isFavorite: false, createdAt: now, updatedAt: now });
    f.folders.set(secondParentKey, { key: secondParentKey, scopeKey: f.scopeKey, name: 'Second parent', embedding, isFavorite: false, createdAt: now, updatedAt: now });
    f.folders.set(firstKey, { key: firstKey, scopeKey: f.scopeKey, parentFolderKey: firstParentKey, name: 'Report', embedding, isFavorite: false, createdAt: now, updatedAt: now });
    f.folders.set(secondKey, { key: secondKey, scopeKey: f.scopeKey, parentFolderKey: secondParentKey, name: 'Report', embedding, isFavorite: false, createdAt: now, updatedAt: now });
    const dependencies = { repository: f.repository, embed: async () => embedding };

    const sameParent = await runContentTool('folder.copy', { copies: [{ folderKey: f.folderKey, targetScopeKey: f.scopeKey }] }, f.context, dependencies);
    expect(sameParent.results[0]?.data?.folder.name).toBe('Root');

    const sameNames = await runContentTool('folder.copy', { copies: [{ folderKey: firstKey, targetScopeKey: f.scopeKey, targetParentFolderKey: targetKey }, { folderKey: secondKey, targetScopeKey: f.scopeKey, targetParentFolderKey: targetKey }] }, f.context, dependencies);
    expect(sameNames.results.map((result) => result.data?.folder.name)).toEqual(['Report', 'Report']);
  });

  test('retains copied folders and referenced storage when document compensation deletion fails', async () => {
    const f = fixture('moderator');
    const childKey = newId(), targetKey = newId();
    f.folders.set(childKey, { key: childKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding, isFavorite: false, createdAt: now, updatedAt: now });
    f.folders.set(targetKey, { key: targetKey, scopeKey: f.scopeKey, name: 'Target', embedding, isFavorite: false, createdAt: now, updatedAt: now });
    const sourceKeys = [f.addDocument('First'), f.addDocument('Second')];
    for (const key of sourceKeys) f.documents.get(key).folderKey = childKey;
    const insertDocument = f.repository.insertDocument.bind(f.repository);
    const deleteDocument = f.repository.deleteDocument.bind(f.repository);
    const deleteFolder = f.repository.deleteFolder.bind(f.repository);
    let inserts = 0;
    let folderDeletes = 0;
    f.repository.insertDocument = async (document) => { inserts += 1; if (inserts === 2) throw new Error('insert failed'); return insertDocument(document); };
    f.repository.deleteDocument = async (key) => { if (!sourceKeys.includes(key)) throw new Error('delete failed'); return deleteDocument(key); };
    f.repository.deleteFolder = async (key) => { folderDeletes += 1; return deleteFolder(key); };
    const deletedStorage: string[] = [];
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy(input: any) { return { storageKey: input.destinationKey }; }, async delete(key: string) { deletedStorage.push(key); } };

    const failed = await runContentTool('folder.copy', { copies: [{ folderKey: childKey, targetScopeKey: f.scopeKey, targetParentFolderKey: targetKey }] }, f.context, { repository: f.repository, storage });
    expect(failed.results[0]).toMatchObject({ success: false, error: { retryable: true } });
    const retainedDocument = [...f.documents.values()].find((document) => !sourceKeys.includes(document.key));
    expect(retainedDocument?._internalDeletion).toMatchObject({ kind: 'document', objectKeys: [retainedDocument?.storageKey] });
    expect(deletedStorage).not.toContain(retainedDocument?.storageKey);
    const retainedFolders = [...f.folders.values()].filter((folder) => folder._internalDeletion?.owner);
    expect(folderDeletes).toBe(0);
    expect(retainedFolders).not.toHaveLength(0);
    expect(failed.results[0]?.error?.resourceKey).toBe(retainedFolders[0]?.key);
    expect(retainedFolders.every((folder) => folder._internalDeletion.documentKeys.includes(retainedDocument?.key))).toBe(true);
  });

  test('retains the folder cleanup manifest when copied storage deletion fails', async () => {
    const f = fixture('moderator');
    const childKey = newId(), targetKey = newId();
    f.folders.set(childKey, { key: childKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding, isFavorite: false, createdAt: now, updatedAt: now });
    f.folders.set(targetKey, { key: targetKey, scopeKey: f.scopeKey, name: 'Target', embedding, isFavorite: false, createdAt: now, updatedAt: now });
    const sourceKeys = [f.addDocument('First'), f.addDocument('Second')];
    for (const key of sourceKeys) f.documents.get(key).folderKey = childKey;
    const insertDocument = f.repository.insertDocument.bind(f.repository);
    let inserts = 0;
    f.repository.insertDocument = async (document) => { inserts += 1; if (inserts === 2) throw new Error('insert failed'); return insertDocument(document); };
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy(input: any) { return { storageKey: input.destinationKey }; }, async delete() { throw new Error('storage offline'); } };

    const failed = await runContentTool('folder.copy', { copies: [{ folderKey: childKey, targetScopeKey: f.scopeKey, targetParentFolderKey: targetKey }] }, f.context, { repository: f.repository, storage });
    expect(failed.results[0]).toMatchObject({ success: false, error: { retryable: true } });
    expect([...f.documents.values()].filter((document) => !sourceKeys.includes(document.key))).toHaveLength(0);
    const retainedFolders = [...f.folders.values()].filter((folder) => folder._internalDeletion?.owner);
    expect(retainedFolders).not.toHaveLength(0);
    expect(retainedFolders[0]?._internalDeletion.objectKeys).not.toHaveLength(0);
  });

  test('preserves the extension while bounding download filenames', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument('Download body');
    f.documents.get(documentKey).name = 'n'.repeat(255);
    const downloaded = await runContentTool('document.download', { documentKeys: [documentKey], format: 'original' }, f.context, {
      repository: f.repository,
      storage: {
        async download() { return { bytes: new TextEncoder().encode('Download body'), mimeType: 'text/plain' }; },
        async copy(input) { return { storageKey: input.destinationKey }; },
        async upload(input) { return { storageKey: input.key }; },
        async delete() {},
      },
    });
    const fileName = downloaded.results[0]?.data?.fileName;
    expect(fileName).toHaveLength(255);
    expect(fileName?.endsWith('.txt')).toBe(true);
    const found = await runContentTool('document.find', { documentKeys: [documentKey] }, f.context, { repository: f.repository });
    expect(found.results[0]?.data?.document.originalAvailable).toBe(true);
  });

  test('generates an HTML preview from authorized original bytes', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument('Preview body');
    const output = await runContentTool('document.download', { documentKeys: [documentKey], format: 'html' }, f.context, {
      repository: f.repository,
      storage: {
        async download() { return { bytes: new TextEncoder().encode('Original body'), mimeType: 'text/plain' }; },
        async copy(input) { return { storageKey: input.destinationKey }; },
        async upload(input) { return { storageKey: input.key }; },
        async delete() {},
      },
      generatePreview: async () => ({ bytes: new TextEncoder().encode('<html>Original body</html>'), mimeType: 'text/html; charset=utf-8', extension: 'html' }),
    });
    expect(output.results[0]?.data).toMatchObject({ format: 'html', fileName: 'Notes.html', mimeType: 'text/html; charset=utf-8' });
    expect(Buffer.from(output.results[0]?.data?.content ?? '', 'base64').toString()).toBe('<html>Original body</html>');
  });

  test('sanitizes plain-text updates', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Old body');
    const output = await runContentTool('document.update', {
      updates: [{ documentKey, content: 'Safe text\r\n\r\n\r\ndrop\u0000', isFavorite: true }],
    }, f.context, { repository: f.repository, embed: async () => embedding, ingestion: { embeddingDimensions: EMBEDDING_DIMENSIONS } });
    expect(output.results[0]?.success).toBe(true);
    const stored = f.documents.get(documentKey);
    expect(stored.content).toBe('Safe text\n\ndrop');
    expect(stored.isFavorite).toBe(true);
    expect(stored).not.toHaveProperty('json');
    expect(stored).not.toHaveProperty('html');

    const favoriteOnly = await runContentTool('document.update', { updates: [{ documentKey, isFavorite: false }] }, f.context, { repository: f.repository });
    expect(favoriteOnly.results[0]?.data?.document.isFavorite).toBe(false);
    expect(f.documents.get(documentKey).content).toBe('Safe text\n\ndrop');
  });

  test('embeds the final derived name for persisted AI copies', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Source body');
    const embeddedNames: string[] = [];
    const storage: any = { async upload(input: any) { return { storageKey: input.key }; }, async delete() {}, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } };
    const output = await runContentTool('document.translate', { documentKeys: [documentKey], targetLanguage: 'French', mode: 'copy' }, f.context, {
      repository: f.repository,
      storage,
      runAction: async (action, input) => {
        if (action === 'text.translate') return { text: 'Texte traduit' };
        if (action === 'document-embed') {
          embeddedNames.push(String(input.name));
          return documentEmbed(input as never, { embed: async () => embedding, dimensions: EMBEDDING_DIMENSIONS });
        }
        throw new Error(`Unexpected action ${action}`);
      },
    });
    expect(output.results[0]?.success).toBe(true);
    expect(embeddedNames).toEqual(['Notes (translate)']);
    const persistedDocumentKey = output.results[0]?.data?.persistedDocumentKey;
    expect(persistedDocumentKey && f.documents.get(persistedDocumentKey)?.isFavorite).toBe(false);
  });

  test('routes summaries and topics through dedicated actions and persists summary history', async () => {
    const f = fixture('moderator');
    const first = f.addDocument('First source body');
    const second = f.addDocument('Second source body');
    const actions: string[] = [];
    const runAction = async (action: string, input: Record<string, unknown>) => {
      actions.push(action);
      const parsed = chatInputSchema.parse(input);
      expect(parsed.systemPrompt).toBeString();
      expect(parsed.messages[0]?.content[0]).toMatchObject({ type: 'text' });
      return { text: action === 'text.topics' ? '```json\n{"topics":["Launch","Launch","Risk"]}\n```' : action === 'text.summarize' ? '<thinking>Private model planning.</thinking>\nHere is the requested summary.\n```json\n{"sections":[{"heading":"Overview","body":"Generated text"},{"heading":"Details","body":"Additional context"}]}\n```\nNo further commentary.' : 'Generated text' };
    };
    const dependencies = { repository: f.repository, runAction };
    expect((await runContentTool('document.summarize', { documentKeys: [first] }, f.context, dependencies)).results[0]?.success).toBe(true);
    expect((await runContentTool('document.summarize', { documentKeys: [first, second], combine: true }, f.context, dependencies)).summary.failed).toBe(0);
    const persisted = await runContentTool('document.summarize', { documentKeys: [first], topic: 'Launch', style: 'executive', persist: true }, f.context, dependencies);
    const summaryKey = persisted.results[0]?.data?.summary?.key;
    expect(persisted.results[0]?.data).toMatchObject({ text: 'Overview\nGenerated text\n\nDetails\nAdditional context', summary: { version: 1, topic: 'Launch', style: 'executive', summary: 'Overview\nGenerated text\n\nDetails\nAdditional context' } });
    expect(f.documents.size).toBe(2);
    expect((await runContentTool('document.list-summaries', { documentKeys: [first] }, f.context, dependencies)).results[0]?.data?.summaries).toHaveLength(1);
    expect((await runContentTool('document.find-summary', { summaryKeys: [summaryKey] }, f.context, dependencies)).results[0]?.data?.summary.key).toBe(summaryKey);
    expect(await runContentTool('document.topics', { documentKey: first }, f.context, dependencies)).toEqual({ documentKey: first, topics: ['Launch', 'Risk'] });
    expect(actions).toEqual(['text.summarize', 'text.summarize', 'text.summarize', 'text.topics']);
  });

  test('projects already persisted summary audio without exposing storage keys', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Source body');
    const summary = await f.repository.createSummary!({ key: newId(), scopeKey: f.scopeKey, documentKey, summary: 'A durable spoken summary.', style: 'brief', sourceContentHash: 'a'.repeat(64), sourceTitle: 'Notes', sourceDocumentUpdatedAt: now, createdByKey: newId(), createdAt: now });
    const audio = { key: newId(), scopeKey: f.scopeKey, documentKey, summaryKey: summary.key, storageKey: 'summary.mp3', mimeType: 'audio/mpeg' as const, sizeBytes: 2, durationMs: 800, createdByKey: newId(), createdAt: now };
    f.summaryAudio.set(audio.key, audio);
    const dependencies = { repository: f.repository, signAudioUrl: async (key: string) => `https://audio.example/${key}` };
    const listed = await runContentTool('document.list-summaries', { documentKeys: [documentKey] }, f.context, dependencies);
    const found = await runContentTool('document.find-summary', { summaryKeys: [summary.key] }, f.context, dependencies);
    expect(listed.results[0]?.data?.summaries[0].audio?.url).toStartWith('https://audio.example/');
    expect(found.results[0]?.data?.summary.audio?.summaryKey).toBe(summary.key);
    expect(JSON.stringify(found)).not.toContain('storageKey');
  });

  test('rejects non-JSON and over-limit topic model output', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument();
    for (const text of ['topics: launch', JSON.stringify({ topics: Array.from({ length: 11 }, (_, index) => `Topic ${index}`) }), JSON.stringify({ topics: ['Launch'], extra: true })]) {
      await expect(runContentTool('document.topics', { documentKey }, f.context, { repository: f.repository, runAction: async () => ({ text }) })).rejects.toMatchObject({ code: 'CONTENT_INVALID_INPUT' });
    }
  });

  test('precomputes atomic exports and throws without returning partial success', async () => {
    const f = fixture('viewer');
    const first = f.addDocument('First');
    const second = f.addDocument('Second');
    let calls = 0;
    const generateExport: any = async () => {
      calls += 1;
      if (calls === 2) throw new Error('renderer failed');
      return { bytes: new TextEncoder().encode('ok'), mimeType: 'text/plain', extension: 'txt' };
    };
    await expect(runContentTool('document.export', { exports: [{ documentKey: first, format: 'txt' }, { documentKey: second, format: 'txt' }], atomic: true }, f.context, { repository: f.repository, generateExport })).rejects.toMatchObject({ action: 'export', resourceKey: second });
    calls = 0;
    const output = await runContentTool('document.export', { exports: [{ documentKey: first, format: 'txt' }, { documentKey: second, format: 'txt' }], atomic: true }, f.context, { repository: f.repository, generateExport: async () => ({ bytes: new Uint8Array([1]), mimeType: 'text/plain', extension: 'txt' }) });
    expect(output.summary).toEqual({ requested: 2, succeeded: 2, failed: 0 });
  });

  test('hard deletes active resources immediately while protecting favorites', async () => {
    const favoriteDocument = fixture('owner');
    const favoriteDocumentKey = favoriteDocument.addDocument();
    favoriteDocument.documents.get(favoriteDocumentKey).isFavorite = true;
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; }, async delete() {} };
    const blockedDocument = await runContentTool('document.delete', { documentKeys: [favoriteDocumentKey] }, favoriteDocument.context, { repository: favoriteDocument.repository, storage });
    expect(blockedDocument.results[0]).toMatchObject({ success: false, error: { code: 'CONTENT_CONFLICT' } });

    const activeDocument = fixture('owner');
    const activeDocumentKey = activeDocument.addDocument();
    const deletedDocument = await runContentTool('document.delete', { documentKeys: [activeDocumentKey] }, activeDocument.context, { repository: activeDocument.repository, storage });
    expect(deletedDocument.results[0]).toMatchObject({ success: true });
    expect(activeDocument.documents.has(activeDocumentKey)).toBe(false);

    const favoriteFolder = fixture('owner');
    favoriteFolder.folders.get(favoriteFolder.folderKey).isFavorite = true;
    const blockedFolder = await runContentTool('folder.delete', { folderKeys: [favoriteFolder.folderKey] }, favoriteFolder.context, { repository: favoriteFolder.repository, storage });
    expect(blockedFolder.results[0]).toMatchObject({ success: false, error: { code: 'CONTENT_CONFLICT' } });
  });

  test('allows a moderator to delete their own generated document binding', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument();
    f.repository.generatedDocumentBindings = async () => [{ key: documentKey, scopeKey: f.scopeKey, documentKey, subjectType: 'trip', subjectKey: newId(), kind: 'guide', provenance: 'generated', createdByKey: f.context.principal.user.key, idempotencyKey: 'guide-request', requestHash: 'a'.repeat(64), createdAt: now, updatedAt: now }];
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; }, async delete() {} };
    const deleted = await runContentTool('document.delete', { documentKeys: [documentKey] }, f.context, { repository: f.repository, storage });
    expect(deleted.results[0]).toMatchObject({ success: true });
    expect(f.documents.has(documentKey)).toBe(false);

    const otherDocumentKey = f.addDocument();
    f.repository.generatedDocumentBindings = async () => [{ key: otherDocumentKey, scopeKey: f.scopeKey, documentKey: otherDocumentKey, subjectType: 'trip', subjectKey: newId(), kind: 'guide', provenance: 'generated', createdByKey: newId(), idempotencyKey: 'other-guide-request', requestHash: 'b'.repeat(64), createdAt: now, updatedAt: now }];
    const blocked = await runContentTool('document.delete', { documentKeys: [otherDocumentKey] }, f.context, { repository: f.repository, storage });
    expect(blocked.results[0]).toMatchObject({ success: false, error: { code: 'CONTENT_FORBIDDEN' } });
    expect(f.documents.has(otherDocumentKey)).toBe(true);
  });

  test('rejects generic mutations of published audiobook chapters', async () => {
    const f = fixture('owner'); const documentKey = f.addDocument();
    f.repository.generatedDocumentBindings = async () => [{ key: documentKey, scopeKey: f.scopeKey, documentKey, subjectType: 'chapter', subjectKey: newId(), kind: 'chapter', provenance: 'generated', createdByKey: f.context.principal.user.key, idempotencyKey: 'chapter-publication', requestHash: 'c'.repeat(64), createdAt: now, updatedAt: now }];
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; }, async delete() {} };
    await expect(runContentTool('document.delete', { documentKeys: [documentKey] }, f.context, { repository: f.repository, storage })).rejects.toMatchObject({ code: 'CONTENT_FORBIDDEN', resourceKey: documentKey });
    expect(f.documents.has(documentKey)).toBe(true);
  });

  test('keeps managed mail attachments readable and favoritable but rejects destructive generic mutations', async () => {
    const f = fixture('owner');
    const documentKey = f.addDocument();
    f.documents.set(documentKey, { ...f.documents.get(documentKey), managedPurpose: 'mail-attachment', mutationPolicy: 'user' });
    await expect(runContentTool('document.read', { documentKeys: [documentKey] }, f.context, { repository: f.repository })).resolves.toMatchObject({ summary: { succeeded: 1 } });
    await expect(runContentTool('document.update', { updates: [{ documentKey, isFavorite: true }] }, f.context, { repository: f.repository })).resolves.toMatchObject({ summary: { succeeded: 1 }, results: [{ success: true, data: { document: { managed: true, isFavorite: true } } }] });
    await expect(runContentTool('document.delete', { documentKeys: [documentKey] }, f.context, { repository: f.repository, storage: { delete: async () => undefined } as never })).resolves.toMatchObject({ summary: { failed: 1 }, results: [{ success: false, error: { code: 'CONTENT_FORBIDDEN', resourceKey: documentKey } }] });
    expect(f.documents.has(documentKey)).toBe(true);
  });

  test('projects visible managed resources and hides domain-only hierarchies from generic reads and search', async () => {
    const f = fixture('owner');
    const managedFolderKey = newId();
    f.folders.set(managedFolderKey, { key: managedFolderKey, scopeKey: f.scopeKey, name: 'Managed library', mutationPolicy: 'system-container', archiveVisibility: 'visible', embedding, isFavorite: false, createdAt: now, updatedAt: now });
    const managedDocumentKey = f.addDocument('Visible managed reference');
    Object.assign(f.documents.get(managedDocumentKey), { folderKey: managedFolderKey, mutationPolicy: 'system-only', archiveVisibility: 'visible' });
    const hiddenFolderKey = newId(), hiddenChildKey = newId();
    f.folders.set(hiddenFolderKey, { key: hiddenFolderKey, scopeKey: f.scopeKey, name: 'Domain records', archiveVisibility: 'domain-only', embedding, isFavorite: false, createdAt: now, updatedAt: now });
    f.folders.set(hiddenChildKey, { key: hiddenChildKey, scopeKey: f.scopeKey, parentFolderKey: hiddenFolderKey, name: 'Hidden child', embedding, isFavorite: false, createdAt: now, updatedAt: now });
    const hiddenDocumentKey = f.addDocument('Hidden domain reference');
    f.documents.get(hiddenDocumentKey).folderKey = hiddenChildKey;

    const folders = await runContentTool('folder.list', { scopeKey: f.scopeKey, includeDescendants: true }, f.context, { repository: f.repository });
    expect(folders.folders).toContainEqual(expect.objectContaining({ key: managedFolderKey, managed: true }));
    expect(folders.folders.map(({ key }) => key)).not.toContain(hiddenFolderKey);
    expect(folders.folders.map(({ key }) => key)).not.toContain(hiddenChildKey);
    const found = await runContentTool('document.find', { documentKeys: [managedDocumentKey] }, f.context, { repository: f.repository });
    expect(found.results[0]).toMatchObject({ success: true, data: { document: { key: managedDocumentKey, managed: true } } });
    expect(found.results[0]?.data?.document).not.toHaveProperty('mutationPolicy');
    expect(found.results[0]?.data?.document).not.toHaveProperty('managedPurpose');
    expect(found.results[0]?.data?.document).not.toHaveProperty('archiveVisibility');
    await expect(runContentTool('document.find', { documentKeys: [hiddenDocumentKey] }, f.context, { repository: f.repository })).resolves.toMatchObject({ summary: { failed: 1 }, results: [{ error: { code: 'CONTENT_NOT_FOUND' } }] });
    const search = await runContentTool('document.search', { scopeKey: f.scopeKey, query: 'reference' }, f.context, { repository: f.repository, embed: async () => embedding });
    expect(search.results).toContainEqual(expect.objectContaining({ documentKey: managedDocumentKey, managed: true }));
    expect(search.results.map(({ documentKey }) => documentKey)).not.toContain(hiddenDocumentKey);
  });

  test('rejects generic creation in managed folders and every generated-content path for managed documents', async () => {
    const f = fixture('owner');
    f.folders.get(f.folderKey).mutationPolicy = 'system-container';
    await expect(runContentTool('document.create', { scopeKey: f.scopeKey, folderKey: f.folderKey, name: 'Blocked', content: 'Blocked body' }, f.context, { repository: f.repository, embed: async () => embedding })).rejects.toMatchObject({ code: 'CONTENT_FORBIDDEN' });
    const documentKey = f.addDocument('Managed source');
    f.documents.get(documentKey).mutationPolicy = 'system-only';
    const generated = await runContentTool('document.enhance', { documentKeys: [documentKey], mode: 'preview' }, f.context, { repository: f.repository, runAction: async () => ({ text: 'Generated' }) });
    expect(generated).toMatchObject({ summary: { failed: 1 }, results: [{ error: { code: 'CONTENT_FORBIDDEN' } }] });
  });

  test('deletes storage before transaction-bound document metadata and retains pointers on failure', async () => {
    const f = fixture('owner');
    const documentKey = f.addDocument();
    f.documents.get(documentKey).speechStorageKeys = ['speech/shared', 'speech/second'];
    const version = await f.repository.createVersion({
      scopeKey: f.scopeKey, documentKey, content: 'old', embedding,
    });
    const audio = await f.repository.createAudioVersion!({ key: newId(), scopeKey: f.scopeKey, documentKey, sourceContentHash: 'a'.repeat(64), sourceTitle: 'Notes', sourceDocumentUpdatedAt: now, storageKey: 'audio/version.mp3', mimeType: 'audio/mpeg', sizeBytes: 10, durationMs: 100, includeTitle: false, includeCode: false, createdByKey: newId(), createdAt: now });
    const summary = await f.repository.createSummary!({ key: newId(), scopeKey: f.scopeKey, documentKey, summary: 'Saved summary', style: 'brief', sourceContentHash: 'a'.repeat(64), sourceTitle: 'Notes', sourceDocumentUpdatedAt: now, createdByKey: newId(), createdAt: now });
    const summaryAudio = { key: newId(), scopeKey: f.scopeKey, documentKey, summaryKey: summary.key, storageKey: 'audio/summary.mp3', mimeType: 'audio/mpeg' as const, sizeBytes: 10, durationMs: 100, createdByKey: newId(), createdAt: now };
    f.summaryAudio.set(summaryAudio.key, summaryAudio);
    const calls: string[] = [];
    const originalDelete = f.repository.deleteDocument;
    f.repository.deleteDocument = async (key) => { calls.push('metadata'); await originalDelete(key); };
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; }, async delete() { calls.push('storage'); throw new Error('offline'); } };
    const failed = await runContentTool('document.delete', { documentKeys: [documentKey] }, f.context, { repository: f.repository, storage });
    expect(failed.results[0]?.success).toBe(false);
    expect(calls).toEqual(['storage']);
    expect(f.documents.has(documentKey)).toBe(true);
    expect(f.versions.has(version.key)).toBe(true);
    storage.delete = async () => { calls.push('storage'); };
    const deleted = await runContentTool('document.delete', { documentKeys: [documentKey] }, f.context, { repository: f.repository, storage });
    expect(deleted.results[0]?.success).toBe(true);
    expect(calls.filter((call) => call === 'storage').length).toBe(6);
    expect(calls.at(-1)).toBe('metadata');
    expect(f.versions.has(version.key)).toBe(false);
    expect(f.audioVersions.has(audio.key)).toBe(false);
    expect(f.summaries.has(summary.key)).toBe(false);
    expect(f.summaryAudio.has(summaryAudio.key)).toBe(false);
  });

  test('hides a pending document deletion after metadata commit failure and finishes on retry', async () => {
    const f = fixture('owner');
    const documentKey = f.addDocument();
    const deleted: string[] = [];
    const storage: any = {
      async upload() { return { storageKey: '' }; },
      async download() { return { bytes: new Uint8Array() }; },
      async copy() { return { storageKey: '' }; },
      async delete(key: string) { deleted.push(key); },
    };
    const normalTransaction = f.repository.transaction!;
    let transactions = 0;
    f.repository.transaction = async (operation) => {
      transactions += 1;
      if (transactions === 3) throw new Error('metadata commit failed');
      return normalTransaction(operation);
    };

    const failed = await runContentTool('document.delete', { documentKeys: [documentKey] }, f.context, { repository: f.repository, storage });
    expect(failed.results[0]?.success).toBe(false);
    expect(f.documents.get(documentKey)._internalDeletion).toMatchObject({ kind: 'document', objectKeys: [`docs/${documentKey}`] });
    const inaccessible = await runContentTool('document.find', { documentKeys: [documentKey] }, f.context, { repository: f.repository });
    expect(inaccessible.results[0]).toMatchObject({ success: false, error: { code: 'CONTENT_NOT_FOUND' } });

    f.repository.transaction = normalTransaction;
    const retried = await runContentTool('document.delete', { documentKeys: [documentKey] }, f.context, { repository: f.repository, storage });
    expect(retried.results[0]?.success).toBe(true);
    expect(f.documents.has(documentKey)).toBe(false);
    expect(deleted).toEqual([`docs/${documentKey}`, `docs/${documentKey}`]);
  });

  test('deletes logical version snapshots without storage side effects', async () => {
    const f = fixture('owner');
    const documentKey = f.addDocument();
    const version = await f.repository.createVersion({ scopeKey: f.scopeKey, documentKey, content: 'old', embedding });
    let storageDeletes = 0;
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; }, async delete() { storageDeletes += 1; } };
    const deleted = await runContentTool('document.delete-version', { versionKeys: [version.key] }, f.context, { repository: f.repository, storage });
    expect(deleted.results[0]?.success).toBe(true);
    expect(f.versions.has(version.key)).toBe(false);
    expect(f.documents.get(documentKey)._internalDeletion).toBeUndefined();
    expect(storageDeletes).toBe(0);
  });

  test('rejects descendant creation, sharing, versioning, move, and copy after a subtree freeze', async () => {
    const f = fixture('owner');
    const childKey = newId();
    f.folders.set(childKey, { key: childKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding, createdAt: now, updatedAt: now });
    const doomedKey = f.addDocument('Doomed');
    f.documents.get(doomedKey).folderKey = childKey;
    const deletionOwner = newId();
    f.folders.get(f.folderKey)._internalDeletion = { kind: 'folder', owner: deletionOwner, folderKeys: [f.folderKey, childKey], documentKeys: [doomedKey], objectKeys: [], startedAt: now };
    f.folders.get(childKey)._internalDeletion = { kind: 'folder', owner: deletionOwner, startedAt: now };
    f.documents.get(doomedKey)._internalDeletion = { kind: 'document', owner: deletionOwner, objectKeys: [], startedAt: now };
    const doomedSummary = await f.repository.createSummary!({ key: newId(), scopeKey: f.scopeKey, documentKey: doomedKey, summary: 'Doomed summary', style: 'brief', sourceContentHash: 'a'.repeat(64), sourceTitle: 'Doomed', sourceDocumentUpdatedAt: now, createdByKey: newId(), createdAt: now });
    const doomedAudio = { key: newId(), scopeKey: f.scopeKey, documentKey: doomedKey, summaryKey: doomedSummary.key, storageKey: 'audio/doomed-summary.mp3', mimeType: 'audio/mpeg' as const, sizeBytes: 10, durationMs: 100, createdByKey: newId(), createdAt: now };
    f.summaryAudio.set(doomedAudio.key, doomedAudio);
    const outsideKey = newId();
    f.folders.set(outsideKey, { key: outsideKey, scopeKey: f.scopeKey, name: 'Outside', embedding, createdAt: now, updatedAt: now });
    const movableKey = f.addDocument('Movable');
    f.documents.get(movableKey).folderKey = outsideKey;
    const originalListVersions = f.repository.listVersions;
    const attempted: Array<{ success: boolean }> = [];
    let raced = false;
    f.repository.listVersions = async (...args) => {
      if (!raced) {
        raced = true;
        const calls = await Promise.all([
          runContentTool('document.share', { shares: [{ documentKey: doomedKey, permission: 'read' }] }, f.context, { repository: f.repository }),
          runContentTool('document.create-version', { documentKeys: [doomedKey] }, f.context, { repository: f.repository }),
          runContentTool('document.move', { moves: [{ documentKey: movableKey, targetScopeKey: f.scopeKey, targetFolderKey: childKey }] }, f.context, { repository: f.repository }),
          runContentTool('document.copy', { copies: [{ documentKey: movableKey, targetScopeKey: f.scopeKey, targetFolderKey: childKey }] }, f.context, { repository: f.repository }),
        ]);
        for (const call of calls) attempted.push(call.results[0] as { success: boolean });
      }
      return originalListVersions(...args);
    };
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy() { throw new Error('copy must not reach storage'); }, async delete() {} };
    const tripChanges: string[] = [];
    const deleted = await runContentTool('folder.delete', { folderKeys: [f.folderKey], recursive: true }, f.context, { repository: f.repository, storage, publishTripChange: async (scopeKey) => { tripChanges.push(scopeKey); } });
    expect(deleted.results[0]?.success).toBe(true);
    expect(attempted).toHaveLength(4);
    expect(attempted.every((item) => item.success === false)).toBe(true);
    expect(f.shares.size).toBe(0);
    expect(f.versions.size).toBe(0);
    expect(f.summaries.has(doomedSummary.key)).toBe(false);
    expect(f.summaryAudio.has(doomedAudio.key)).toBe(false);
    expect(f.documents.get(movableKey).folderKey).toBe(outsideKey);
    expect(tripChanges).toEqual([f.scopeKey]);
  });

  test('resumes the persisted recursive folder deletion intent regardless of retry flags', async () => {
    const f = fixture('owner');
    const childKey = newId();
    f.folders.set(childKey, { key: childKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding, createdAt: now, updatedAt: now });
    const normalTransaction = f.repository.transaction!;
    let transactions = 0;
    f.repository.transaction = async (operation) => {
      transactions += 1;
      if (transactions === 3) throw new Error('metadata commit failed');
      return normalTransaction(operation);
    };
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; }, async delete() {} };

    const failed = await runContentTool('folder.delete', { folderKeys: [f.folderKey], recursive: true }, f.context, { repository: f.repository, storage });
    expect(failed.results[0]?.success).toBe(false);
    expect(f.folders.get(f.folderKey)._internalDeletion.folderKeys).toEqual([f.folderKey, childKey]);

    f.repository.transaction = normalTransaction;
    const retried = await runContentTool('folder.delete', { folderKeys: [f.folderKey], recursive: false }, f.context, { repository: f.repository, storage });
    expect(retried.results[0]).toMatchObject({ success: true });
    expect(f.folders.has(f.folderKey)).toBe(false);
    expect(f.folders.has(childKey)).toBe(false);
  });

  test('resumes a copy-compensation deletion manifest', async () => {
    const f = fixture('owner');
    const documentKey = f.addDocument('Compensating copy');
    const owner = 'copy-compensation-owner';
    const objectKeys = [`docs/${documentKey}`];
    f.folders.get(f.folderKey)._internalDeletion = { kind: 'folder', owner, folderKeys: [f.folderKey], documentKeys: [documentKey], objectKeys, startedAt: now };
    f.documents.get(documentKey)._internalDeletion = { kind: 'document', owner, objectKeys, startedAt: now };
    const storageDeletes: string[] = [];
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; }, async delete(key: string) { storageDeletes.push(key); } };
    const dependencies = { repository: f.repository, storage };

    await expect(runContentTool('folder.delete', { folderKeys: [f.folderKey], recursive: true, atomic: true }, f.context, dependencies)).rejects.toMatchObject({ code: 'CONTENT_CONFLICT', action: 'transaction', resourceKey: f.folderKey });
    expect(f.folders.has(f.folderKey)).toBe(true);
    expect(f.documents.has(documentKey)).toBe(true);
    expect(storageDeletes).toEqual([]);

    const resumed = await runContentTool('folder.delete', { folderKeys: [f.folderKey], recursive: true }, f.context, dependencies);
    expect(resumed.results[0]).toMatchObject({ success: true });
    expect(storageDeletes).toEqual(objectKeys);
    expect(f.documents.has(documentKey)).toBe(false);
    expect(f.folders.has(f.folderKey)).toBe(false);
  });

  test('replays completed idempotent mutations and rejects changed or pending requests', async () => {
    const f = fixture('moderator');
    const records = new Map<string, { hash: string; status: 'pending' | 'completed'; response?: unknown }>();
    const store: ContentIdempotencyStore = {
      async claim(identity, hash) {
        const key = identity.idempotencyKey;
        const record = records.get(key);
        if (!record) { records.set(key, { hash, status: 'pending' }); return { status: 'claimed' }; }
        if (record.hash !== hash) return { status: 'conflict' };
        return record.status === 'completed' ? { status: 'replay', response: record.response } : { status: 'pending' };
      },
      async start() { return true; },
      async complete(identity, hash, _leaseOwner, response) { records.set(identity.idempotencyKey, { hash, status: 'completed', response }); },
      async fail() {},
      async release(identity) { records.delete(identity.idempotencyKey); },
    };
    const request = { folders: [{ scopeKey: f.scopeKey, name: 'Idempotent' }], idempotencyKey: 'same-key' };
    const dependencies = { repository: f.repository, idempotency: store, embed: async () => embedding };
    const first = await runContentTool('folder.create', request, f.context, dependencies);
    expect(records.get('same-key')?.response).toEqual(first);
    const replay = await runContentTool('folder.create', request, f.context, dependencies);
    expect(replay).toEqual(first);
    expect([...f.folders.values()].filter((folder) => folder.name === 'Idempotent')).toHaveLength(1);
    await expect(runContentTool('folder.create', { ...request, folders: [{ scopeKey: f.scopeKey, name: 'Changed' }] }, f.context, dependencies)).rejects.toMatchObject({ code: 'CONTENT_IDEMPOTENCY_CONFLICT', retryable: false });
    records.set('pending-key', { hash: 'unused', status: 'pending' });
    const pendingStore: ContentIdempotencyStore = { ...store, async claim() { return { status: 'pending' }; } };
    await expect(runContentTool('folder.create', { folders: [{ scopeKey: f.scopeKey, name: 'Pending' }], idempotencyKey: 'pending-key' }, f.context, { ...dependencies, idempotency: pendingStore })).rejects.toMatchObject({ code: 'CONTENT_IDEMPOTENCY_PENDING', retryable: true });
  });

  test('terminalizes sanitized post-start failures and replays them without executing again', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument();
    let state: 'new' | 'started' | 'failed' = 'new', executions = 0;
    let storedFailure: { code: string; message: string; retryable: boolean } | undefined;
    const store: ContentIdempotencyStore = {
      async claim() { return state === 'failed' ? { status: 'failed', failure: storedFailure! } : { status: 'claimed' }; },
      async start() { state = 'started'; return true; },
      async complete() {},
      async fail(_identity, _hash, _owner, failure) { storedFailure = failure; state = 'failed'; },
      async release() {},
    };
    f.repository.generatedDocumentBindings = async () => { executions += 1; throw new Error('database secret token and stack'); };
    const request = { updates: [{ documentKey, isFavorite: true }], idempotencyKey: 'business-failure' };
    const dependencies = { repository: f.repository, idempotency: store };
    await expect(runContentTool('document.update', request, f.context, dependencies)).rejects.toMatchObject({ code: 'CONTENT_IDEMPOTENCY_FAILED' });
    await expect(runContentTool('document.update', request, f.context, dependencies)).rejects.toMatchObject({ code: 'CONTENT_IDEMPOTENCY_FAILED' });
    expect(executions).toBe(1);
    expect(storedFailure).toEqual({ code: 'CONTENT_CONFLICT', message: 'Content operation failed.', retryable: true });
    expect(JSON.stringify(storedFailure)).not.toContain('secret');
  });

  test('leaves started work indeterminate when terminal failure persistence fails', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument();
    let state: 'new' | 'started' = 'new', executions = 0;
    const store: ContentIdempotencyStore = {
      async claim() { return state === 'started' ? { status: 'indeterminate' } : { status: 'claimed' }; },
      async start() { state = 'started'; return true; },
      async complete() {},
      async fail() { throw new Error('ledger unavailable'); },
      async release() {},
    };
    f.repository.generatedDocumentBindings = async () => { executions += 1; throw new Error('business unavailable'); };
    const request = { updates: [{ documentKey, isFavorite: true }], idempotencyKey: 'failure-write' };
    const dependencies = { repository: f.repository, idempotency: store };
    await expect(runContentTool('document.update', request, f.context, dependencies)).rejects.toMatchObject({ code: 'CONTENT_CONFLICT' });
    await expect(runContentTool('document.update', request, f.context, dependencies)).rejects.toMatchObject({ code: 'CONTENT_IDEMPOTENCY_INDETERMINATE', retryable: false });
    expect(executions).toBe(1);
  });

  test('does not release or duplicate committed work when ledger completion fails', async () => {
    const f = fixture('moderator');
    let claimed = false, releases = 0;
    const store: ContentIdempotencyStore = {
      async claim() { if (claimed) return { status: 'pending' }; claimed = true; return { status: 'claimed' }; },
      async start() { return true; },
      async complete() { throw new Error('ledger unavailable'); },
      async fail() {},
      async release() { releases += 1; },
    };
    const request = { folders: [{ scopeKey: f.scopeKey, name: 'Committed once' }], idempotencyKey: 'completion-failure' };
    const dependencies = { repository: f.repository, idempotency: store, embed: async () => embedding };
    await expect(runContentTool('folder.create', request, f.context, dependencies)).rejects.toMatchObject({ retryable: true });
    await expect(runContentTool('folder.create', request, f.context, dependencies)).rejects.toMatchObject({ retryable: true });
    expect(releases).toBe(0);
    expect([...f.folders.values()].filter((folder) => folder.name === 'Committed once')).toHaveLength(1);
  });

  test('releases an owned claim when execution cannot start', async () => {
    const f = fixture('moderator');
    let releases = 0, executions = 0;
    const store: ContentIdempotencyStore = {
      async claim() { return { status: 'claimed' }; },
      async start() { return false; },
      async complete() {},
      async fail() {},
      async release() { releases += 1; },
    };
    await expect(runContentTool('folder.create', { folders: [{ scopeKey: f.scopeKey, name: 'Not started' }], idempotencyKey: 'start-lost' }, f.context, { repository: f.repository, idempotency: store, embed: async () => { executions += 1; return embedding; } })).rejects.toMatchObject({ code: 'CONTENT_IDEMPOTENCY_PENDING', retryable: true });
    expect({ releases, executions }).toEqual({ releases: 1, executions: 0 });
  });

  test('fences direct system-managed mail update, rename, move, copy, delete, and share mutations', async () => {
    const cases: Array<[string, (f: ReturnType<typeof fixture>, key: string) => [any, any]]> = [
      ['document.update', (_f, key) => ['document.update', { updates: [{ documentKey: key, content: 'Changed' }] }]],
      ['document.rename', (_f, key) => ['document.rename', { renames: [{ documentKey: key, name: 'Renamed' }] }]],
      ['document.move', (f, key) => ['document.move', { moves: [{ documentKey: key, targetScopeKey: f.scopeKey }] }]],
      ['document.copy', (f, key) => ['document.copy', { copies: [{ documentKey: key, targetScopeKey: f.scopeKey }] }]],
      ['document.delete', (_f, key) => ['document.delete', { documentKeys: [key] }]],
      ['document.share', (_f, key) => ['document.share', { shares: [{ documentKey: key, permission: 'read' }] }]],
      ['document.unshare', (_f, key) => ['document.unshare', { documentKeys: [key] }]],
    ];
    for (const [label, request] of cases) {
      const f = fixture('owner');
      const documentKey = f.addDocument(mailContent('mail-thread'));
      f.documents.get(documentKey).mutationPolicy = 'system-only';
      const [tool, input] = request(f, documentKey);
      const output: any = await runContentTool(tool, input, f.context, { repository: f.repository, embed: async () => embedding });
      expect(output.results[0], label).toMatchObject({ success: false, error: { code: 'CONTENT_FORBIDDEN' } });
      expect(f.documents.has(documentKey), label).toBe(true);
    }
  });

  test('fences system-managed mail linked mutations while leaving all linked reads available', async () => {
    const f = fixture('owner');
    const documentKey = f.addDocument(mailContent('mail-new-draft'));
    f.documents.get(documentKey).mutationPolicy = 'system-only';
    const version = await f.repository.createVersion({ scopeKey: f.scopeKey, documentKey, content: 'Translation', type: 'translation', embedding, createdAt: now } as never);
    const summary = await f.repository.createSummary!({ key: newId(), scopeKey: f.scopeKey, documentKey, summary: 'Summary', style: 'brief', sourceContentHash: 'a'.repeat(64), sourceTitle: 'Mail', sourceDocumentUpdatedAt: now, createdByKey: newId(), createdAt: now });
    const audio = await f.repository.createAudioVersion!({ key: newId(), scopeKey: f.scopeKey, documentKey, sourceContentHash: 'a'.repeat(64), sourceTitle: 'Mail', sourceDocumentUpdatedAt: now, storageKey: 'audio/mail.mp3', mimeType: 'audio/mpeg', sizeBytes: 10, durationMs: 60_000, includeTitle: true, includeCode: false, createdByKey: newId(), createdAt: now });
    const dependencies = { repository: f.repository, runAction: async () => ({ text: 'Generated' }), embed: async () => embedding, signAudioUrl: async () => 'https://audio.example/mail.mp3' };

    for (const [tool, input] of [
      ['document.find-version', { versionKeys: [version.key] }],
      ['document.list-versions', { documentKeys: [documentKey] }],
      ['document.list-summaries', { documentKeys: [documentKey] }],
      ['document.find-summary', { summaryKeys: [summary.key] }],
      ['document.list-audio-versions', { documentKeys: [documentKey] }],
    ] as Array<[any, any]>) {
      const output: any = await runContentTool(tool, input, f.context, dependencies);
      expect(output.summary, tool).toMatchObject({ succeeded: 1, failed: 0 });
    }
    await expect(runContentTool('document.read', { documentKeys: [documentKey] }, f.context, dependencies)).resolves.toMatchObject({ summary: { succeeded: 1, failed: 0 } });

    for (const [tool, input] of [
      ['document.create-version', { documentKeys: [documentKey] }],
      ['document.restore-version', { restores: [{ documentKey, versionKey: version.key }] }],
      ['document.delete-version', { versionKeys: [version.key] }],
      ['document.enhance', { documentKeys: [documentKey], mode: 'replace' }],
      ['document.translate', { documentKeys: [documentKey], targetLanguage: 'French', mode: 'copy' }],
      ['document.rewrite', { rewrites: [{ documentKey, instruction: 'Shorten', mode: 'replace' }] }],
    ] as Array<[any, any]>) {
      const output: any = await runContentTool(tool, input, f.context, dependencies);
      expect(output.results[0], tool).toMatchObject({ success: false, error: { code: 'CONTENT_FORBIDDEN' } });
    }
    await expect(runContentTool('document.summarize', { documentKeys: [documentKey], persist: true }, f.context, dependencies)).rejects.toMatchObject({ code: 'CONTENT_FORBIDDEN' });
    await expect(runContentTool('document.audio.playback.update', { audioVersionKey: audio.key, playbackPositionMs: 1000 }, f.context, dependencies)).rejects.toMatchObject({ code: 'CONTENT_FORBIDDEN' });
    await expect(runContentTool('document.audio.playback.clear', { documentKey }, f.context, dependencies)).rejects.toMatchObject({ code: 'CONTENT_FORBIDDEN' });
    await expect(runContentTool('document.translate', { documentKeys: [documentKey], targetLanguage: 'French', mode: 'preview' }, f.context, dependencies)).resolves.toMatchObject({ summary: { succeeded: 0, failed: 1 }, results: [{ error: { code: 'CONTENT_FORBIDDEN' } }] });
  });

  test('fences folder subtree move, copy, and delete when they contain system-managed mail', async () => {
    for (const tool of ['folder.move', 'folder.copy', 'folder.delete'] as const) {
      const f = fixture('owner');
      const documentKey = f.addDocument(mailContent('mail-rule'));
      f.documents.get(documentKey).mutationPolicy = 'system-only';
      const input = tool === 'folder.move'
        ? { moves: [{ folderKey: f.folderKey }] }
        : tool === 'folder.copy'
          ? { copies: [{ folderKey: f.folderKey, targetScopeKey: f.scopeKey }] }
          : { folderKeys: [f.folderKey], recursive: true };
      const output: any = await runContentTool(tool, input, f.context, { repository: f.repository });
      expect(output.results[0], tool).toMatchObject({ success: false, error: { code: 'CONTENT_FORBIDDEN' } });
      expect(f.documents.has(documentKey), tool).toBe(true);
    }
  });

  test('does not fence ordinary Archive document mutation families', async () => {
    const f = fixture('owner');
    const documentKey = f.addDocument('Ordinary body');
    const dependencies = { repository: f.repository, embed: async () => embedding, random: (size: number) => new Uint8Array(size).fill(4) };
    await expect(runContentTool('document.update', { updates: [{ documentKey, isFavorite: true }] }, f.context, dependencies)).resolves.toMatchObject({ summary: { succeeded: 1 } });
    await expect(runContentTool('document.rename', { renames: [{ documentKey, name: 'Renamed' }] }, f.context, dependencies)).resolves.toMatchObject({ summary: { succeeded: 1 } });
    await expect(runContentTool('document.move', { moves: [{ documentKey, targetScopeKey: f.scopeKey }] }, f.context, dependencies)).resolves.toMatchObject({ summary: { succeeded: 1 } });
    const shared = await runContentTool('document.share', { shares: [{ documentKey, permission: 'read' }] }, f.context, dependencies);
    expect(shared).toMatchObject({ summary: { succeeded: 1 } });
    await expect(runContentTool('document.unshare', { documentKeys: [documentKey] }, f.context, dependencies)).resolves.toMatchObject({ summary: { succeeded: 1 } });
  });

  test('allows favorites for every recognized system-managed mail kind', async () => {
    for (const kind of mailEnvelopeKinds) {
      const f = fixture('owner');
      const documentKey = f.addDocument(mailContent(kind));
      f.documents.get(documentKey).mutationPolicy = 'system-only';
      const output = await runContentTool('document.update', { updates: [{ documentKey, isFavorite: true }] }, f.context, { repository: f.repository });
      expect(output.results[0], kind).toMatchObject({ success: true, data: { document: { managed: true, isFavorite: true } } });
      expect(f.documents.get(documentKey).isFavorite, kind).toBe(true);
    }

    for (const [content, mutationPolicy] of [[mailContent('mail-thread'), 'user'], [JSON.stringify({ version: 1, kind: 'non-mail-system-record', data: {} }), 'system-only']] as const) {
      const f = fixture('owner');
      const documentKey = f.addDocument(content);
      f.documents.get(documentKey).mutationPolicy = mutationPolicy;
      await expect(runContentTool('document.update', { updates: [{ documentKey, isFavorite: true }] }, f.context, { repository: f.repository })).resolves.toMatchObject({ summary: { succeeded: 1, failed: 0 } });
      expect(f.documents.get(documentKey).isFavorite).toBe(true);
    }
  });

  test('scopes delegated processing idempotency to the actor', async () => {
    const f = fixture('moderator');
    const seen: string[] = [];
    const file = { filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 4, bytes: new TextEncoder().encode('text') };
    const parseDocument = async (input: any) => {
      seen.push(input.idempotencyKey);
      return { document: f.documents.get(f.addDocument()) };
    };
    const ledger: ContentIdempotencyStore = {
      async claim() { return { status: 'claimed' }; },
      async start() { return true; },
      async complete() {},
      async fail() {},
      async release() {},
    };
    await runContentTool('document.parse', { file, scopeKey: f.scopeKey, folderKey: f.folderKey, idempotencyKey: 'caller-key' }, f.context, { repository: f.repository, parseDocument, idempotency: ledger });
    const otherActor = { ...f.context, principal: { ...f.context.principal, user: { key: newId() } } };
    await runContentTool('document.parse', { file, scopeKey: f.scopeKey, folderKey: f.folderKey, idempotencyKey: 'caller-key' }, otherActor, { repository: f.repository, parseDocument, idempotency: ledger });
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen.every((key) => key !== 'caller-key')).toBe(true);
  });

  test('keeps generated content out of observer payloads', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument('Private source text');
    const events: unknown[] = [];
    await runContentTool('document.summarize', { documentKeys: [documentKey] }, f.context, {
      repository: f.repository,
      runAction: async () => ({ text: 'Private generated summary' }),
      observer: (event) => { events.push(event); },
    });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('Private source text');
    expect(serialized).not.toContain('Private generated summary');
    expect(events.every((event: any) => typeof event.invocationKey === 'string')).toBe(true);
  });

  test('enhances a document through the configured model and persists replacement content', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('This are teh text.');
    let call: { action?: string; input?: any } = {};
    const output = await runContentTool('document.enhance', { documentKeys: [documentKey], mode: 'replace' }, f.context, {
      repository: f.repository,
      runAction: async (action, input) => {
        if (action === 'document-embed') return documentEmbed(input as { name: string; content: string }, { embed: async () => embedding, dimensions: EMBEDDING_DIMENSIONS });
        call = { action, input };
        return { text: '```text\nThis is the text.\n```' };
      },
    });
    expect(output.results[0]).toMatchObject({ success: true, data: { documentKey, text: 'This is the text.', persistedDocumentKey: documentKey } });
    expect(call.action).toBe('text.enhance');
    expect(call.input.systemPrompt).toContain('collapse excessive blank lines');
    expect(call.input.systemPrompt).toContain('readable sections');
    expect(call.input.systemPrompt).toContain('nonsensical words');
    expect(call.input.systemPrompt).toContain('only a few characters per line');
    expect(call.input.systemPrompt).toContain('normal line width');
    expect(call.input.options).toMatchObject({ temperature: 0.1, maxTokens: 256 });
    expect(f.documents.get(documentKey).content).toBe('This is the text.');
  });

  test('routes preview transformations through the provider-neutral ask fallback chain', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument('Translate this text.');
    let request: any;
    const output = await runContentTool('document.translate', { documentKeys: [documentKey], targetLanguage: 'French', mode: 'preview' }, f.context, {
      repository: f.repository,
      executeAction: (async (candidate: any, input: any) => { request = candidate; expect(input).toMatchObject({ messages: [{ role: 'user' }] }); return { output: { text: 'Traduisez ce texte.' } }; }) as any,
    });
    expect(request).toMatchObject({ mode: 'auto', organizationKey: f.context.organizationKey, actionSlug: 'text' });
    expect(request).not.toHaveProperty('modelSlug');
    expect(output.results[0]).toMatchObject({ success: true, data: { documentKey, text: 'Traduisez ce texte.', language: 'French' } });
  });

  test('executes one authorized valid behavior path for every registered tool', async () => {
    for (const name of CONTENT_TOOL_NAMES) {
      const f = fixture('owner');
      const documentKey = f.addDocument('Source body');
      const childKey = newId();
      const siblingKey = newId();
      f.folders.set(childKey, { key: childKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding, createdAt: now, updatedAt: now });
      f.folders.set(siblingKey, { key: siblingKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Sibling', embedding, createdAt: now, updatedAt: now });
      const storage: any = {
        async upload(input: any) { return { storageKey: input.key }; },
        async delete() {},
        async download() { return { bytes: new TextEncoder().encode('original'), mimeType: 'text/plain' }; },
        async copy(input: any) { return { storageKey: input.destinationKey }; },
      };
      const searchRows = new Map<string, any>();
      const dependencies: any = {
        repository: f.repository,
        storage,
        embed: async () => embedding,
        ingestion: { embeddingDimensions: EMBEDDING_DIMENSIONS },
        clock: () => new Date(now),
        generateExport: async (input: any) => ({ bytes: new TextEncoder().encode(input.format), mimeType: 'text/plain', extension: input.format }),
        parseDocument: async () => ({ document: f.documents.get(documentKey) }),
        scanDocument: async () => ({ documentKey: newId(), content: 'Scanned body', storageKeys: ['scan/page-01.jpg'] }),
        runAction: async (action: string, input: any) => {
          if (action.startsWith('text.')) return { text: action === 'text.topics' ? '{"topics":["Source"]}' : 'Generated text' };
          if (action === 'document-cleanup') return { content: input.text };
          if (action === 'document-embed') return documentEmbed(input, { embed: async () => embedding, dimensions: EMBEDDING_DIMENSIONS });
          throw new Error(`Unexpected action ${action}`);
        },
        searchQueries: {
          async get({ actorKey, scopeKey, normalizedQuery }: any) { return searchRows.get(`${actorKey}:${scopeKey}:${normalizedQuery}`) ?? null; },
          async record(value: any) { const identity = `${value.actorKey}:${value.scopeKey}:${value.normalizedQuery}`; searchRows.set(identity, { output: value.output }); },
        },
        userSearches: {
          async record(_userKey: string, query: string) { return { query, normalizedQuery: query.toLowerCase(), searchedAt: now, usageCount: 1 }; },
          async list() { return []; },
          async remove(_userKey: string, query: string) { return { normalizedQuery: query.toLowerCase(), deleted: true }; },
        },
        signAudioUrl: async (key: string) => `https://audio.example/${key}`,
      };
      let input: any;
      if (name === 'folder.create') input = { folders: [{ scopeKey: f.scopeKey, name: 'Created' }] };
      else if (name === 'folder.find') input = { folderKeys: [f.folderKey] };
      else if (name === 'folder.list') input = { scopeKey: f.scopeKey, parentFolderKey: f.folderKey };
      else if (name === 'folder.update') input = { updates: [{ folderKey: childKey, description: 'Updated' }] };
      else if (name === 'folder.rename') input = { renames: [{ folderKey: childKey, name: 'Renamed' }] };
      else if (name === 'folder.move') input = { moves: [{ folderKey: childKey, targetParentFolderKey: siblingKey }] };
      else if (name === 'folder.copy') input = { copies: [{ folderKey: childKey, targetScopeKey: f.scopeKey, targetParentFolderKey: siblingKey }] };
      else if (name === 'folder.delete') input = { folderKeys: [childKey] };
      else if (name === 'document.parse') input = { file: { filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 4, bytes: new Uint8Array([1, 2, 3, 4]) }, scopeKey: f.scopeKey, folderKey: f.folderKey };
      else if (name === 'document.scan') input = { pages: [{ filename: 'page.jpg', mimeType: 'image/jpeg', sizeBytes: 4, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }], scopeKey: f.scopeKey, folderKey: f.folderKey };
      else if (name === 'document.create') input = { scopeKey: f.scopeKey, folderKey: f.folderKey, name: 'Created document', content: 'Created body' };
      else if (name === 'document.find') input = { documentKeys: [documentKey], include: ['content'] };
      else if (name === 'document.list') input = { scopeKey: f.scopeKey, folderKey: f.folderKey };
       else if (name === 'document.read') input = { documentKeys: [documentKey] };
       else if (name === 'document.list-audio-versions') input = { documentKeys: [documentKey] };
       else if (name === 'document.audio.playback.update' || name === 'document.audio.playback.clear') {
         const audio = await f.repository.createAudioVersion!({ key: newId(), scopeKey: f.scopeKey, documentKey, sourceContentHash: 'a'.repeat(64), sourceTitle: 'Notes', sourceDocumentUpdatedAt: now, storageKey: `audio/${name}.mp3`, mimeType: 'audio/mpeg', sizeBytes: 10, durationMs: 60_000, includeTitle: true, includeCode: false, createdByKey: newId(), createdAt: now });
         input = name === 'document.audio.playback.update' ? { audioVersionKey: audio.key, playbackPositionMs: 10_000 } : { documentKey };
       }
       else if (name === 'document.list-summaries') input = { documentKeys: [documentKey] };
        else if (name === 'document.find-summary') {
         const summary = await f.repository.createSummary!({ key: newId(), scopeKey: f.scopeKey, documentKey, summary: 'Saved', style: 'brief', sourceContentHash: 'a'.repeat(64), sourceTitle: 'Notes', sourceDocumentUpdatedAt: now, createdByKey: newId(), createdAt: now });
          input = { summaryKeys: [summary.key] };
        }
      else if (name === 'document.update') input = { updates: [{ documentKey, content: 'Updated body' }] };
      else if (name === 'document.rename') input = { renames: [{ documentKey, name: 'Renamed' }] };
      else if (name === 'document.move') input = { moves: [{ documentKey, targetScopeKey: f.scopeKey, targetFolderKey: siblingKey }] };
      else if (name === 'document.copy') input = { copies: [{ documentKey, targetScopeKey: f.scopeKey, targetFolderKey: siblingKey }] };
      else if (name === 'document.delete') input = { documentKeys: [documentKey] };
      else if (name === 'document.download') input = { documentKeys: [documentKey], format: 'original' };
      else if (name === 'document.export') input = { exports: [{ documentKey, format: 'txt' }] };
      else if (name === 'document.share') input = { shares: [{ documentKey, permission: 'read' }] };
      else if (name === 'document.unshare') {
        const shareKey = newId();
        f.shares.set(shareKey, { key: shareKey, scopeKey: f.scopeKey, documentKey, permission: 'read', tokenHash: 'a'.repeat(64), createdAt: now, updatedAt: now });
        input = { shareKeys: [shareKey] };
      } else if (name === 'document.list-shares') input = { documentKeys: [documentKey] };
      else if (name === 'document.create-version') input = { documentKeys: [documentKey], labels: { [documentKey]: 'Release' } };
      else if (name === 'document.find-version' || name === 'document.list-versions' || name === 'document.restore-version' || name === 'document.delete-version') {
        const current = f.documents.get(documentKey);
        const version = await f.repository.createVersion({ scopeKey: f.scopeKey, documentKey, content: current.content, embedding: current.embedding });
        if (name === 'document.find-version') input = { versionKeys: [version.key] };
        else if (name === 'document.list-versions') input = { documentKeys: [documentKey] };
        else if (name === 'document.restore-version') input = { restores: [{ documentKey, versionKey: version.key }] };
        else input = { versionKeys: [version.key] };
      } else if (name === 'document.summarize') input = { documentKeys: [documentKey] };
      else if (name === 'document.topics') input = { documentKey };
      else if (name === 'document.enhance') input = { documentKeys: [documentKey] };
      else if (name === 'document.translate') input = { documentKeys: [documentKey], targetLanguage: 'French' };
      else if (name === 'document.rewrite') input = { rewrites: [{ documentKey, instruction: 'Improve clarity' }] };
      else if (name === 'document.search') input = { scopeKey: f.scopeKey, query: 'source' };
      else if (name === 'content.search') input = { scopeKey: f.scopeKey, query: 'source' };
      else if (name === 'content.search-history.list') input = { scopeKey: f.scopeKey };
      else if (name === 'content.search-history.delete') input = { scopeKey: f.scopeKey, normalizedQuery: 'source' };
      else if (name === 'content.neighbors') input = { documentKey };
      else input = { organizationKey: f.context.organizationKey, query: 'source' };
      const output: any = await runContentTool(name, input, f.context, dependencies);
      if (output.summary) expect(output.summary.failed, name).toBe(0);
      else expect(output, name).toBeTruthy();
    }
  });

  test('reports invalid, authorization, archived hierarchy, and partial batch cases deterministically', async () => {
    const cases = [
      {
        label: 'authorization',
        run: async () => {
          const f = fixture('viewer');
          return runContentTool('folder.create', { folders: [{ scopeKey: f.scopeKey, name: 'Denied' }] }, f.context, { repository: f.repository, embed: async () => embedding });
        },
        codes: ['CONTENT_FORBIDDEN'],
      },
      {
        label: 'missing resource',
        run: async () => {
          const f = fixture('viewer');
          return runContentTool('document.read', { documentKeys: [newId()] }, f.context, { repository: f.repository });
        },
        codes: ['CONTENT_NOT_FOUND'],
      },
      {
        label: 'partial ordered batch',
        run: async () => {
          const f = fixture('moderator');
          return runContentTool('folder.rename', { renames: [{ folderKey: f.folderKey, name: 'Renamed' }, { folderKey: newId(), name: 'Missing' }] }, f.context, { repository: f.repository, embed: async () => embedding });
        },
        codes: [undefined, 'CONTENT_NOT_FOUND'],
      },
    ];
    for (const item of cases) {
      const output: any = await item.run();
      expect(output.results.map((result: any) => result.error?.code), item.label).toEqual(item.codes);
    }
  });
});

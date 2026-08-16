import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ContentRepository } from './content-runtime';
import { authorizeDocumentParseLocation, CONTENT_TOOL_NAMES, ContentError, runContentTool, type ContentIdempotencyStore } from '.';
import { documentKeyForRequest, DocumentProcessingError } from '@/lib/ai/document-processing';
import { documentEmbed } from '@/lib/ai/document-processing';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { chatInputSchema, speechInputSchema } from '@/lib/ai/providers/types';
import { ProviderExecutionError } from '@/lib/ai/router/errors';

const now = '2026-07-22T12:00:00.000Z';
const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

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
        && (options.includeArchived || !value.deletedAt)
        && (options.includeRevoked || !value.revokedAt)
        && (options.includeExpired || !value.expiresAt || value.expiresAt > at));
    },
    async insertShare(value) { const share = { ...value, deletedAt: null }; shares.set(share.key, share); return share; },
    async updateShare(key, patch) { const value = { ...shares.get(key), ...patch }; shares.set(key, value); return value; },
    async deleteShare(key) { shares.delete(key); },
    async getVersion(key) { return versions.get(key) ?? null; },
    async listVersions(_scopeKey, keys) { return [...versions.values()].filter((value) => keys.includes(value.documentKey)).sort((a, b) => b.version - a.version); },
    async createVersion(value) { const version = { ...value, key: newId(), version: [...versions.values()].filter((item) => item.documentKey === value.documentKey).length + 1, deletedAt: null, createdAt: now }; versions.set(version.key, version); return version; },
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
    async transaction(operation) { return operation(repository); },
  };
  const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: membershipKey, organizationId: organizationKey, status: 'active', orgRole: role } } } as any;
  const folderKey = newId(); folders.set(folderKey, { key: folderKey, scopeKey, name: 'Root', embedding, createdAt: now, updatedAt: now });
  const addDocument = (content = 'First sentence. Second sentence.') => { const key = newId(); documents.set(key, { key, scopeKey, folderKey, name: 'Notes', extension: 'txt', mimeType: 'text/plain', sizeBytes: content.length, storageKey: `docs/${key}`, content, embedding, isFavorite: false, createdAt: now, updatedAt: now }); return key; };
  return { repository, context, folders, documents, shares, versions, audioVersions, summaries, summaryAudio, patches, scopeKey, folderKey, addDocument };
}

describe('Content runtime', () => {
  test('preflights document ingestion scope role and active folder hierarchy', async () => {
    const allowed = fixture('moderator');
    await expect(authorizeDocumentParseLocation({ scopeKey: allowed.scopeKey, folderKey: allowed.folderKey }, allowed.context, allowed.repository)).resolves.toBeUndefined();
    const denied = fixture('viewer');
    await expect(authorizeDocumentParseLocation({ scopeKey: denied.scopeKey, folderKey: denied.folderKey }, denied.context, denied.repository)).rejects.toMatchObject({ code: 'CONTENT_FORBIDDEN' });
    const archived = fixture('moderator');
    archived.folders.get(archived.folderKey).deletedAt = now;
    await expect(authorizeDocumentParseLocation({ scopeKey: archived.scopeKey, folderKey: archived.folderKey }, archived.context, archived.repository)).rejects.toMatchObject({ code: 'FOLDER_ARCHIVED' });
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
    const child = newId(), leaf = newId(), archived = newId(), hidden = newId();
    f.folders.set(child, { key: child, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding, createdAt: now, updatedAt: now });
    f.folders.set(leaf, { key: leaf, scopeKey: f.scopeKey, parentFolderKey: child, name: 'Leaf', embedding, createdAt: now, updatedAt: now });
    f.folders.set(archived, { key: archived, scopeKey: f.scopeKey, name: 'Archived', embedding, deletedAt: now, createdAt: now, updatedAt: now });
    f.folders.set(hidden, { key: hidden, scopeKey: f.scopeKey, parentFolderKey: archived, name: 'Hidden', embedding, createdAt: now, updatedAt: now });

    const direct = await runContentTool('folder.list', { scopeKey: f.scopeKey }, f.context, { repository: f.repository });
    const tree = await runContentTool('folder.list', { scopeKey: f.scopeKey, includeDescendants: true }, f.context, { repository: f.repository });

    expect(direct.folders.map((folder: any) => folder.key)).toEqual([f.folderKey]);
    expect(tree.folders.map((folder: any) => folder.key).sort()).toEqual([f.folderKey, child, leaf].sort());
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
    const versioned = await runContentTool('document.create-version', { documentKeys: [rootKey] }, f.context, { repository: f.repository, embed: async () => embedding });
    expect(versioned.results[0]?.success).toBe(true);
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
    const base = { documentKey, scopeKey: f.scopeKey, permission: 'read', tokenHash: 'a'.repeat(64), deletedAt: null, createdAt: now, updatedAt: now };
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

  test('returns playable audio with conservative document offsets and MIME-matched persistence', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument(`0123456789Visible sentence. ${'More words. '.repeat(30)} \`secret code\``);
    const spoken: string[] = [], actions: string[] = [], uploaded: string[] = [], speechInputs: any[] = [];
    const dependencies: any = { repository: f.repository, maxSpeechChunkCharacters: 200, runAction: async (action: string, input: any) => { actions.push(action); const parsed = speechInputSchema.parse(input); speechInputs.push(parsed); spoken.push(parsed.text); return { audioBase64: Buffer.from([spoken.length]).toString('base64'), mimeType: parsed.format === 'mp3' ? 'audio/mpeg' : 'audio/ogg', durationMs: 10 }; }, mergeAudio: async () => new Uint8Array([1, 2, 3]), audioDuration: () => 900, storage: { async upload(input: any) { uploaded.push(input.key); return { storageKey: input.key }; }, async delete() {}, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } } };
    const ephemeral = await runContentTool('document.read', { documentKeys: [documentKey], mode: 'audio', startOffset: 10, includeTitle: true, language: 'English', speakingRate: 1.25 }, f.context, dependencies);
    const audio = (ephemeral.results[0]?.data as { audio: Array<{ index: number; url: string; startCharacter: number; endCharacter: number }> }).audio;
    expect(audio.map((item) => item.index)).toEqual([...spoken.keys()]);
    expect(audio.every((item) => item.url.startsWith('data:audio/ogg;base64,'))).toBe(true);
    expect(audio.every((item) => item.startCharacter >= 10 && item.endCharacter > item.startCharacter)).toBe(true);
    expect(spoken[0]).toStartWith('Notes. Visible sentence.');
    expect(spoken.join(' ')).not.toContain('secret code');
    expect(actions).toEqual(Array(spoken.length).fill('speak'));
    expect(speechInputs.every(({ voice }) => voice === 'Matthew')).toBe(true);
    expect(uploaded).toHaveLength(0);
    const ephemeralChunkCount = spoken.length;
    const persisted = await runContentTool('document.read', { documentKeys: [documentKey], mode: 'audio', includeCode: false, persistAudio: true, language: 'en-US' }, f.context, dependencies);
    expect(actions.slice(ephemeralChunkCount)).toEqual(['generate-speech']);
    expect(persisted.results[0]).toMatchObject({ success: true });
    expect(speechInputs.at(-1)).not.toHaveProperty('speakingRate');
    expect(speechInputs.at(-1)?.language).toBe('en-US');
    expect(speechInputs.at(-1)?.voice).toBe('Matthew');
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toEndWith('.mp3');
    expect(persisted.results[0]?.data).toMatchObject({ audioVersion: { version: 1, durationMs: 900 } });
    expect((persisted.results[0]?.data as any)?.audioVersion).not.toHaveProperty('speakingRate');
    expect((persisted.results[0]?.data as any)?.audioVersion).toMatchObject({ language: 'en-US', voice: 'Matthew' });
    expect(f.audioVersions.size).toBe(1);
    expect(f.documents.get(documentKey).speechStorageKeys).toBeUndefined();
    expect(f.documents.get(documentKey).updatedAt).toBe(now);
  });

  test('cleans a persisted full-audio object when version metadata fails', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Long sentence. '.repeat(80));
    const uploaded: string[] = [], deleted: string[] = [];
    f.repository.createAudioVersion = async () => { throw new Error('metadata failed'); };
    const output = await runContentTool('document.read', { documentKeys: [documentKey], mode: 'audio', persistAudio: true }, f.context, {
      repository: f.repository,
      maxSpeechChunkCharacters: 200,
      runAction: async () => ({ audio: new Uint8Array([1]), mimeType: 'audio/mpeg' }),
      mergeAudio: async () => new Uint8Array([1]),
      audioDuration: () => 100,
      storage: {
        async upload(input) { uploaded.push(input.key); return { storageKey: input.key }; },
        async delete(key) { deleted.push(key); },
        async download() { return { bytes: new Uint8Array() }; },
        async copy() { return { storageKey: '' }; },
      },
    });
    expect(output.results[0]?.success).toBe(false);
    expect(output.results[0]?.error).toMatchObject({ code: 'DOCUMENT_SPEECH_FAILED', message: 'The generated audio version could not be saved.', action: 'audio-version' });
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toEndWith('.mp3');
    expect(deleted).toEqual(uploaded);
  });

  test('returns a specific error when persisted audio merging fails', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Narrate this document.');
    const output = await runContentTool('document.read', { documentKeys: [documentKey], mode: 'audio', persistAudio: true }, f.context, {
      repository: f.repository,
      runAction: async () => ({ audio: new Uint8Array([1]), mimeType: 'audio/mpeg' }),
      mergeAudio: async () => { throw new Error('ffmpeg unavailable'); },
      audioDuration: () => 100,
    });
    expect(output.results[0]).toMatchObject({ success: false, error: { code: 'DOCUMENT_SPEECH_FAILED', message: 'Generated audio segments could not be finalized.', action: 'audio-merge' } });
  });

  test('stops persisted audio generation when its request is aborted', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Long sentence. '.repeat(80));
    const controller = new AbortController();
    let uploads = 0;
    const output = await runContentTool('document.read', { documentKeys: [documentKey], mode: 'audio', persistAudio: true }, f.context, {
      repository: f.repository,
      signal: controller.signal,
      maxSpeechChunkCharacters: 200,
      runAction: async () => { controller.abort(); return { audio: new Uint8Array([1]), mimeType: 'audio/mpeg' }; },
      mergeAudio: async () => { throw new Error('merge should not run'); },
      audioDuration: () => 100,
      storage: { async upload({ key }) { uploads += 1; return { storageKey: key }; }, async delete() {}, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } },
    });
    expect(output.results[0]?.success).toBe(false);
    expect(uploads).toBe(0);
    expect(f.audioVersions.size).toBe(0);
  });

  test('cleans uploaded audio when its request is aborted after storage succeeds', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Narrate this document.');
    const controller = new AbortController();
    const uploaded: string[] = [], deleted: string[] = [];
    const output = await runContentTool('document.read', { documentKeys: [documentKey], mode: 'audio', persistAudio: true }, f.context, {
      repository: f.repository,
      signal: controller.signal,
      runAction: async () => ({ audio: new Uint8Array([1]), mimeType: 'audio/mpeg' }),
      mergeAudio: async () => new Uint8Array([1]),
      audioDuration: () => 100,
      storage: {
        async upload({ key }) { uploaded.push(key); controller.abort(); return { storageKey: key }; },
        async delete(key) { deleted.push(key); },
        async download() { return { bytes: new Uint8Array() }; },
        async copy() { return { storageKey: '' }; },
      },
    });
    expect(output.results[0]?.success).toBe(false);
    expect(uploaded).toHaveLength(1);
    expect(deleted).toEqual(uploaded);
    expect(f.audioVersions.size).toBe(0);
  });

  test('rejects oversized persisted narration before spending speech capacity', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('x'.repeat(120_001));
    let speechCalls = 0;
    const output = await runContentTool('document.read', { documentKeys: [documentKey], mode: 'audio', persistAudio: true }, f.context, {
      repository: f.repository,
      runAction: async () => { speechCalls += 1; return { audio: new Uint8Array([1]), mimeType: 'audio/mpeg' }; },
    });
    expect(output.results[0]).toMatchObject({ success: false, error: { code: 'DOCUMENT_TOO_LARGE' } });
    expect(speechCalls).toBe(0);
  });

  test('returns a specific error when persisted speech credentials are rejected', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Narrate this document.');
    const output = await runContentTool('document.read', { documentKeys: [documentKey], mode: 'audio', persistAudio: true }, f.context, {
      repository: f.repository,
      runAction: async () => { throw new ProviderExecutionError('generate-speech', [{ modelId: 'amazon.polly-generative', providerId: 'aws-polly', externalModelId: 'generative', code: 'authentication_failed', message: 'rejected' }]); },
    });
    expect(output.results[0]).toMatchObject({ success: false, error: { code: 'DOCUMENT_SPEECH_FAILED', message: 'Audio generation is unavailable because the speech provider is not configured.', action: 'generate-speech' } });
  });

  test('versions audio independently from document snapshots and marks stale content', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Stable source text.');
    const dependencies: any = {
      repository: f.repository,
      runAction: async () => ({ audio: new Uint8Array([1]), mimeType: 'audio/mpeg' }),
      mergeAudio: async () => new Uint8Array([1, 2]),
      audioDuration: () => 1_200,
      signAudioUrl: async (key: string) => `https://audio.example/${key}`,
      storage: { async upload({ key }: any) { return { storageKey: key }; }, async delete() {}, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } },
      clock: () => new Date(now),
    };
    await runContentTool('document.read', { documentKeys: [documentKey], mode: 'audio', persistAudio: true }, f.context, dependencies);
    await runContentTool('document.read', { documentKeys: [documentKey], mode: 'audio', persistAudio: true }, f.context, dependencies);
    expect(f.versions.size).toBe(0);
    expect([...f.audioVersions.values()].map(({ version }) => version)).toEqual([1, 2]);

    const current = f.documents.get(documentKey);
    current.content = 'Changed source text.';
    const listed = await runContentTool('document.list-audio-versions', { documentKeys: [documentKey] }, f.context, dependencies);
    expect(listed.results[0]?.data?.audioVersions).toMatchObject([{ version: 2, current: false }, { version: 1, current: false }]);
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

  test('filters semantic search to authorized scopes and rejects unresolved projects', async () => {
    const f = fixture('viewer'); f.addDocument('Roadmap launch'); let authorized: string[] = [];
    f.repository.semanticSearch = async (input) => { authorized = input.authorizedScopeKeys; return [...f.documents.values()].map((document) => ({ score: 0.8, document, matchedContent: 'Matched passage later in the document.' })); };
    const output = await runContentTool('scope.document.search', { scopeKey: f.scopeKey, query: 'roadmap', include: ['snippet'] }, f.context, { repository: f.repository, embed: async () => embedding });
    expect(authorized).toEqual([f.scopeKey]); expect(output.results[0]).toMatchObject({ score: 0.8, snippet: 'Matched passage later in the document.' });
    await expect(runContentTool('scope.document.search', { scopeKey: f.scopeKey, query: 'roadmap', sources: [{ type: 'project', projectKeys: [newId()] }] }, f.context, { repository: f.repository, embed: async () => embedding })).rejects.toMatchObject({ code: 'CONTENT_SEARCH_INVALID_SOURCE' });
  });

  test('returns exact lexical folder matches without waiting for query embedding', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument('Quasar timeline velocity roadmap');
    let embedCalls = 0;
    f.repository.semanticSearch = async () => { throw new Error('semantic search should not run'); };
    const output = await runContentTool('scope.document.search', {
      scopeKey: f.scopeKey,
      query: 'quasar',
      sources: [{ type: 'folder', folderKeys: [f.folderKey], includeDescendants: true }],
    }, f.context, { repository: f.repository, embed: async () => { embedCalls += 1; throw new Error('provider unavailable'); } });
    expect(embedCalls).toBe(0);
    expect(output.results).toHaveLength(1);
    expect(output.results[0]).toMatchObject({ documentKey, extension: 'txt', matchedSource: { type: 'folder', key: f.folderKey } });
  });

  test('search includes archived folder hierarchies only when explicitly requested', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument('Archived roadmap');
    f.folders.get(f.folderKey).deletedAt = now;
    f.documents.get(documentKey).deletedAt = now;
    f.repository.semanticSearch = async () => [{ score: 0.9, document: f.documents.get(documentKey) }];
    const activeOnly = await runContentTool('scope.document.search', { scopeKey: f.scopeKey, query: 'roadmap' }, f.context, { repository: f.repository, embed: async () => embedding });
    expect(activeOnly.results).toEqual([]);
    const archived = await runContentTool('scope.document.search', { scopeKey: f.scopeKey, query: 'roadmap', filters: { includeArchived: true } }, f.context, { repository: f.repository, embed: async () => embedding });
    expect(archived.results.map((item) => item.documentKey)).toEqual([documentKey]);
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
        providerId: request.actionSlug === 'embed' ? 'openrouter' : 'aws-bedrock',
        modelId: request.actionSlug === 'embed' ? 'qwen.qwen3-embedding-8b' : 'amazon.nova-lite',
        externalModelId: request.actionSlug === 'embed' ? 'qwen/qwen3-embedding-8b' : 'us.amazon.nova-lite-v1:0',
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

  test('searches folders and chunk-aware documents with caps, summaries, cache, auth, and isolated history', async () => {
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
    f.repository.allowedScopeKeys = async () => allowed ? [f.scopeKey] : [];
    f.repository.semanticSearchFolders = async (input) => [...f.folders.values()].filter((folder) => !input.folderKeys || input.folderKeys.includes(folder.key)).map((folder, index) => ({ score: index === 0 ? 0.54 : 0.9, folder }));
    f.repository.semanticSearch = async (input) => [...f.documents.values()].filter((document) => !input.folderKeys || input.folderKeys.includes(document.folderKey)).map((document, index) => ({ score: index === 0 ? 0.54 : 0.9, document }));
    const searchQueries = {
      async get({ actorKey, scopeKey, normalizedQuery, folderKey, includeDescendants }: any) { return rows.get(`${actorKey}:${scopeKey}:${normalizedQuery}:${folderKey ?? 'root'}:${includeDescendants}`) ?? null; },
      async record(value: any) { const identity = `${value.actorKey}:${value.scopeKey}:${value.normalizedQuery}:${value.folderKey ?? 'root'}:${value.includeDescendants}`; const old = rows.get(identity); rows.set(identity, { output: value.output, query: value.query, normalizedQuery: value.normalizedQuery, contextDomain: value.contextDomain, folderKey: value.folderKey, includeDescendants: value.includeDescendants, searchedAt: value.now, usageCount: (old?.usageCount ?? 0) + 1 }); },
      async list({ actorKey, scopeKey, folderKey, includeDescendants, limit }: any) { return [...rows.entries()].filter(([key]) => key.startsWith(`${actorKey}:${scopeKey}:`)).map(([, value]) => value).filter((value) => value.folderKey === folderKey && value.includeDescendants === includeDescendants).map((value) => ({ query: value.query, normalizedQuery: value.normalizedQuery, contextDomain: value.contextDomain, searchedAt: value.searchedAt, usageCount: value.usageCount, ...(value.folderKey ? { folderKey: value.folderKey, includeDescendants: value.includeDescendants } : {}), documents: value.output.result.documents })).slice(0, limit); },
      async remove({ actorKey, scopeKey, normalizedQuery, folderKey, includeDescendants }: any) { return rows.delete(`${actorKey}:${scopeKey}:${normalizedQuery}:${folderKey ?? 'root'}:${includeDescendants}`); },
    };
    const dependencies: any = {
      repository: f.repository,
      searchQueries,
      clock: () => clock,
      embed: async () => { embeddingCalls += 1; return embedding; },
      runAction: async (action: string, input: any) => { summaryCalls += 1; expect(action).toBe('reason'); const parsed = chatInputSchema.parse(input); const text = parsed.messages[0]?.content[0]?.type === 'text' ? parsed.messages[0].content[0].text : ''; expect(text).toContain('Launch Roadmap'); return { text: 'Relevant to Launch Roadmap' }; },
    };
    const first = await runContentTool('scope.content.search', { scopeKey: f.scopeKey, query: 'Launch Roadmap' }, f.context, dependencies);
    expect(first.folders).toHaveLength(4);
    expect(first.folders.every((item) => item.score >= 0.55)).toBe(true);
    expect(first.documents).toHaveLength(10);
    expect(first.documents.every((item) => item.score >= 0.55 && item.summary?.includes('Launch Roadmap') === true)).toBe(true);
    expect(embeddingCalls).toBe(1);
    expect(summaryCalls).toBe(10);
    clock = new Date(Date.parse(now) + 2 * 60 * 60 * 1000);
    const replay = await runContentTool('scope.content.search', { scopeKey: f.scopeKey, query: '  launch   roadmap  ' }, f.context, dependencies);
    expect(replay.cached).toBe(true);
    expect(embeddingCalls).toBe(1);
    expect(summaryCalls).toBe(10);
    const favoriteOnlyDocument = f.documents.get(first.documents[0]!.documentKey);
    favoriteOnlyDocument.isFavorite = true;
    favoriteOnlyDocument.updatedAt = '2026-07-23T11:00:00.000Z';
    const metadataReplay = await runContentTool('scope.content.search', { scopeKey: f.scopeKey, query: 'launch roadmap' }, f.context, dependencies);
    expect(metadataReplay.cached).toBe(true);
    expect(embeddingCalls).toBe(1);
    expect(summaryCalls).toBe(10);
    const history = await runContentTool('scope.content.search-history', { scopeKey: f.scopeKey }, f.context, dependencies);
    expect(history.history).toMatchObject([{ normalizedQuery: 'launch roadmap', contextDomain: 'content', usageCount: 3 }]);
    expect(history.history[0]?.documents).toEqual(first.documents);
    const archivedDocument = f.documents.get(first.documents[0]!.documentKey);
    archivedDocument.deletedAt = now;
    const prunedHistory = await runContentTool('scope.content.search-history', { scopeKey: f.scopeKey }, f.context, dependencies);
    expect(prunedHistory.history[0]?.documents.some((item) => item.documentKey === archivedDocument.key)).toBe(false);
    archivedDocument.deletedAt = null;
    const childKey = newId();
    f.folders.set(childKey, { key: childKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding, createdAt: now, updatedAt: now });
    const nestedDocumentKey = [...f.documents.keys()][1]!;
    f.documents.get(nestedDocumentKey).folderKey = childKey;
    const folderReplay = await runContentTool('scope.content.search', { scopeKey: f.scopeKey, folderKey: f.folderKey, query: 'launch roadmap' }, f.context, dependencies);
    expect(folderReplay.folders).toEqual([{ key: childKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', score: 0.9 }]);
    expect(folderReplay.cached).toBe(false);
    expect(rows).toHaveLength(2);
    expect(folderReplay.documents.some((document) => document.documentKey === nestedDocumentKey)).toBe(true);
    const directFolderSearch = await runContentTool('scope.content.search', { scopeKey: f.scopeKey, folderKey: f.folderKey, includeDescendants: false, query: 'launch roadmap' }, f.context, dependencies);
    expect(directFolderSearch.documents.some((document) => document.documentKey === nestedDocumentKey)).toBe(false);
    expect(rows).toHaveLength(3);
    const folderHistory = await runContentTool('scope.content.search-history', { scopeKey: f.scopeKey, folderKey: f.folderKey }, f.context, dependencies);
    expect(folderHistory.history[0]).toMatchObject({ folderKey: f.folderKey, includeDescendants: true, documents: folderReplay.documents });
    f.documents.get(first.documents[0]!.documentKey).semanticContentHash = 'a'.repeat(64);
    const invalidated = await runContentTool('scope.content.search', { scopeKey: f.scopeKey, query: 'launch roadmap' }, f.context, dependencies);
    expect(invalidated.cached).toBe(false);
    expect(embeddingCalls).toBe(4);
    const otherContext = { ...f.context, principal: { ...f.context.principal, user: { key: newId() } } };
    const isolated = await runContentTool('scope.content.search-history', { scopeKey: f.scopeKey }, otherContext, dependencies);
    expect(isolated.history).toEqual([]);
    expect(await runContentTool('scope.content.search-history.delete', { scopeKey: f.scopeKey, normalizedQuery: 'launch roadmap' }, f.context, dependencies)).toEqual({ normalizedQuery: 'launch roadmap', deleted: true });
    expect((await runContentTool('scope.content.search-history', { scopeKey: f.scopeKey }, f.context, dependencies)).history).toEqual([]);
    allowed = false;
    await expect(runContentTool('scope.content.search', { scopeKey: f.scopeKey, query: 'launch roadmap' }, f.context, dependencies)).rejects.toMatchObject({ code: 'CONTENT_FORBIDDEN' });
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
        async list() { return []; },
      },
    };

    const root = await runContentTool('scope.content.search', { scopeKey: f.scopeKey, query: 'launch', includeSummaries: false }, f.context, dependencies);
    expect(root.folders).toMatchObject([{ key: f.folderKey, name: 'Launch plans' }]);
    expect(root.documents).toContainEqual(expect.objectContaining({ documentKey: noteKey, name: 'Launch narrative' }));
    expect(root.documents.find((item) => item.documentKey === noteKey)).not.toHaveProperty('summary');
    expect(embeddingCalls).toBe(0);

    const nested = await runContentTool('scope.content.search', { scopeKey: f.scopeKey, folderKey: f.folderKey, query: 'deployment', includeSummaries: false }, f.context, dependencies);
    expect(nested.documents).toContainEqual(expect.objectContaining({ documentKey: fileKey, folderKey: childKey, extension: 'pdf' }));
    expect(embeddingCalls).toBe(0);

    await runContentTool('scope.content.search', { scopeKey: f.scopeKey, folderKey: f.folderKey, query: 'semantically related', includeSummaries: false }, f.context, dependencies);
    const replay = await runContentTool('scope.content.search', { scopeKey: f.scopeKey, folderKey: f.folderKey, query: 'semantically related', includeSummaries: false }, f.context, dependencies);
    expect(embeddingCalls).toBe(1);
    expect(replay.cached).toBe(true);
  });

  test('excludes semantic matches below archived folder ancestors before summary generation', async () => {
    const f = fixture('viewer');
    const archivedParentKey = newId();
    const childKey = newId();
    f.folders.set(archivedParentKey, { key: archivedParentKey, scopeKey: f.scopeKey, name: 'Archived', embedding, deletedAt: now, createdAt: now, updatedAt: now });
    f.folders.set(childKey, { key: childKey, scopeKey: f.scopeKey, parentFolderKey: archivedParentKey, name: 'Hidden child', embedding, createdAt: now, updatedAt: now });
    const documentKey = f.addDocument('Hidden content');
    f.documents.get(documentKey).folderKey = childKey;
    f.repository.semanticSearchFolders = async () => [{ score: 0.9, folder: f.folders.get(childKey) }];
    f.repository.semanticSearch = async () => [{ score: 0.9, document: f.documents.get(documentKey), matchedContent: 'Hidden content' }];
    let summaryCalls = 0;
    const result = await runContentTool('scope.content.search', { scopeKey: f.scopeKey, query: 'hidden' }, f.context, {
      repository: f.repository,
      embed: async () => embedding,
      runAction: async () => { summaryCalls += 1; return { text: 'Should not run' }; },
      searchQueries: { async get() { return null; }, async record() {}, async list() { return []; } },
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
    expect(embeddedTexts).toContain('Legacy body');

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
    const generated = await runContentTool('document.translate', { documentKeys: [documentKey], targetLanguage: 'French', mode: 'replace' }, f.context, {
      ...dependencies,
      runAction: async (action: string, input: any) => {
        if (action === 'translate') return { text: 'Corps traduit' };
        if (action === 'document-embed') return documentEmbed(input, { embed: async ({ text }) => { embeddedTexts.push(text); return embedding; }, dimensions: EMBEDDING_DIMENSIONS });
        throw new Error(`Unexpected action ${action}`);
      },
    });
    expect(generated.results[0]?.success).toBe(true);
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
        if (action === 'translate') return { text: 'Texte traduit' };
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
      return { text: action === 'document-topics' ? '```json\n{"topics":["Launch","Launch","Risk"]}\n```' : action === 'document-summarize' ? '```json\n{"sections":[{"heading":"Overview","body":"Generated text"},{"heading":"Details","body":"Additional context"}]}\n```' : 'Generated text' };
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
    expect(actions).toEqual(['document-summarize', 'document-summarize', 'document-summarize', 'document-topics']);
  });

  test('generates, projects, and reuses durable summary audio without exposing storage keys', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Source body');
    const summary = await f.repository.createSummary!({ key: newId(), scopeKey: f.scopeKey, documentKey, summary: 'A durable spoken summary.', style: 'brief', sourceContentHash: 'a'.repeat(64), sourceTitle: 'Notes', sourceDocumentUpdatedAt: now, createdByKey: newId(), createdAt: now });
    const uploaded: string[] = [];
    let generated = 0;
    const dependencies: any = {
      repository: f.repository,
      generateAudioChunks: async function* (input: any) { generated += 1; expect(input).toMatchObject({ text: summary.summary, voice: 'Matthew', language: 'en-US' }); yield { index: 0, startWord: 0, endWord: 4, startCharacter: 0, endCharacter: summary.summary.length, audioBase64: 'AQ==', mimeType: 'audio/mpeg', durationMs: 100 }; },
      mergeAudio: async () => new Uint8Array([1, 2]),
      audioDuration: () => 800,
      signAudioUrl: async (key: string) => `https://audio.example/${key}`,
      storage: { async upload({ key }: any) { uploaded.push(key); return { storageKey: key }; }, async delete() {}, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } },
      clock: () => new Date(now),
    };
    const first = await runContentTool('document.summary.audio.generate', { summaryKeys: [summary.key], language: 'en-US' }, f.context, dependencies);
    const second = await runContentTool('document.summary.audio.generate', { summaryKeys: [summary.key] }, f.context, dependencies);
    expect(first.results[0]).toMatchObject({ success: true, data: { audio: { summaryKey: summary.key, mimeType: 'audio/mpeg', durationMs: 800, url: expect.stringContaining('https://audio.example/') } } });
    expect(JSON.stringify(first)).not.toContain('storageKey');
    expect(generated).toBe(1);
    expect(uploaded).toHaveLength(1);
    expect(second.results[0]?.data?.audio.key).toBe(first.results[0]?.data?.audio.key);
    const listed = await runContentTool('document.list-summaries', { documentKeys: [documentKey] }, f.context, dependencies);
    const found = await runContentTool('document.find-summary', { summaryKeys: [summary.key] }, f.context, dependencies);
    expect(listed.results[0]?.data?.summaries[0].audio?.url).toStartWith('https://audio.example/');
    expect(found.results[0]?.data?.summary.audio?.summaryKey).toBe(summary.key);
  });

  test('deletes a concurrent summary-audio loser upload and returns the winner', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument();
    const summary = await f.repository.createSummary!({ key: newId(), scopeKey: f.scopeKey, documentKey, summary: 'Concurrent summary.', style: 'brief', sourceContentHash: 'a'.repeat(64), sourceTitle: 'Notes', sourceDocumentUpdatedAt: now, createdByKey: newId(), createdAt: now });
    const winner = { key: newId(), scopeKey: f.scopeKey, documentKey, summaryKey: summary.key, storageKey: 'winner.mp3', mimeType: 'audio/mpeg' as const, sizeBytes: 2, durationMs: 500, createdByKey: newId(), createdAt: now };
    f.repository.createSummaryAudio = async () => { f.summaryAudio.set(winner.key, winner); return { audio: winner, created: false }; };
    const deleted: string[] = [];
    const output = await runContentTool('document.summary.audio.generate', { summaryKeys: [summary.key] }, f.context, {
      repository: f.repository,
      generateAudioChunks: async function* () { yield { index: 0, startWord: 0, endWord: 2, startCharacter: 0, endCharacter: 10, audioBase64: 'AQ==', mimeType: 'audio/mpeg', durationMs: 100 }; },
      mergeAudio: async () => new Uint8Array([1, 2]), audioDuration: () => 500,
      signAudioUrl: async (key) => `https://audio.example/${key}`,
      storage: { async upload({ key }) { return { storageKey: key }; }, async delete(key) { deleted.push(key); }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } },
    });
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).not.toBe(winner.storageKey);
    expect(output.results[0]?.data?.audio).toMatchObject({ key: winner.key, url: 'https://audio.example/winner.mp3' });
  });

  test('cleans summary audio when metadata persistence fails', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument();
    const summary = await f.repository.createSummary!({ key: newId(), scopeKey: f.scopeKey, documentKey, summary: 'Summary audio cleanup.', style: 'brief', sourceContentHash: 'a'.repeat(64), sourceTitle: 'Notes', sourceDocumentUpdatedAt: now, createdByKey: newId(), createdAt: now });
    f.repository.createSummaryAudio = async () => { throw new Error('metadata unavailable'); };
    const uploaded: string[] = [], deleted: string[] = [];
    const output = await runContentTool('document.summary.audio.generate', { summaryKeys: [summary.key] }, f.context, {
      repository: f.repository,
      generateAudioChunks: async function* () { yield { index: 0, startWord: 0, endWord: 2, startCharacter: 0, endCharacter: 10, audioBase64: 'AQ==', mimeType: 'audio/mpeg', durationMs: 100 }; },
      mergeAudio: async () => new Uint8Array([1, 2]), audioDuration: () => 500,
      storage: { async upload({ key }) { uploaded.push(key); return { storageKey: key }; }, async delete(key) { deleted.push(key); }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } },
    });
    expect(output.results[0]).toMatchObject({ success: false, error: { code: 'DOCUMENT_SPEECH_FAILED', action: 'summary-audio' } });
    expect(uploaded).toHaveLength(1);
    expect(deleted).toEqual(uploaded);
  });

  test('retains committed summary audio when URL signing temporarily fails', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument();
    const summary = await f.repository.createSummary!({ key: newId(), scopeKey: f.scopeKey, documentKey, summary: 'Summary audio signing.', style: 'brief', sourceContentHash: 'a'.repeat(64), sourceTitle: 'Notes', sourceDocumentUpdatedAt: now, createdByKey: newId(), createdAt: now });
    const deleted: string[] = [];
    const dependencies: any = {
      repository: f.repository,
      generateAudioChunks: async function* () { yield { index: 0, startWord: 0, endWord: 2, startCharacter: 0, endCharacter: 10, audioBase64: 'AQ==', mimeType: 'audio/mpeg', durationMs: 100 }; },
      mergeAudio: async () => new Uint8Array([1, 2]), audioDuration: () => 500,
      signAudioUrl: async () => { throw new Error('signing unavailable'); },
      storage: { async upload({ key }: any) { return { storageKey: key }; }, async delete(key: string) { deleted.push(key); }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } },
    };
    const failed = await runContentTool('document.summary.audio.generate', { summaryKeys: [summary.key] }, f.context, dependencies);
    expect(failed.results[0]?.success).toBe(false);
    expect(f.summaryAudio.size).toBe(1);
    expect(deleted).toHaveLength(0);
    dependencies.signAudioUrl = async (key: string) => `https://audio.example/${key}`;
    const retried = await runContentTool('document.summary.audio.generate', { summaryKeys: [summary.key] }, f.context, dependencies);
    expect(retried.results[0]?.data?.audio.url).toStartWith('https://audio.example/');
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

  test('orders subtree document and folder lifecycle updates around active destination guards', async () => {
    const f = fixture('moderator');
    const child = newId();
    f.folders.set(child, { key: child, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding, createdAt: now, updatedAt: now });
    const documentKey = f.addDocument();
    f.documents.get(documentKey).folderKey = child;
    const updates: string[] = [];
    const updateFolder = f.repository.updateFolder.bind(f.repository);
    const updateDocument = f.repository.updateDocument.bind(f.repository);
    f.repository.updateFolder = async (key, patch) => { updates.push(`folder:${key}`); return updateFolder(key, patch); };
    f.repository.updateDocument = async (key, patch) => {
      const document = f.documents.get(key);
      if (document?.folderKey && f.folders.get(document.folderKey)?.deletedAt) throw new Error('document destination folder is archived');
      updates.push(`document:${key}`);
      return updateDocument(key, patch);
    };
    await runContentTool('folder.archive', { folderKeys: [f.folderKey], includeDescendants: true }, f.context, { repository: f.repository, clock: () => new Date(now) });
    expect(f.folders.get(child).deletedAt).toBe(now);
    expect(f.documents.get(documentKey).deletedAt).toBe(now);
    expect(updates).toEqual([`document:${documentKey}`, `folder:${f.folderKey}`, `folder:${child}`]);
    updates.length = 0;
    await runContentTool('folder.restore', { folderKeys: [f.folderKey], includeDescendants: true }, f.context, { repository: f.repository, clock: () => new Date(now) });
    expect(f.folders.get(child).deletedAt).toBeNull();
    expect(f.documents.get(documentKey).deletedAt).toBeNull();
    expect(updates).toEqual([`folder:${f.folderKey}`, `folder:${child}`, `document:${documentKey}`]);
  });

  test('deletes storage before transaction-bound document metadata and retains pointers on failure', async () => {
    const f = fixture('owner');
    const documentKey = f.addDocument();
    f.documents.get(documentKey).deletedAt = now;
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
    const failed = await runContentTool('document.delete', { documentKeys: [documentKey], deleteVersions: true, deleteShares: true }, f.context, { repository: f.repository, storage, canPermanentlyDelete: () => true });
    expect(failed.results[0]?.success).toBe(false);
    expect(calls).toEqual(['storage']);
    expect(f.documents.has(documentKey)).toBe(true);
    expect(f.versions.has(version.key)).toBe(true);
    storage.delete = async () => { calls.push('storage'); };
    const deleted = await runContentTool('document.delete', { documentKeys: [documentKey], deleteVersions: true, deleteShares: true }, f.context, { repository: f.repository, storage, canPermanentlyDelete: () => true });
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
    f.documents.get(documentKey).deletedAt = now;
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

    const failed = await runContentTool('document.delete', { documentKeys: [documentKey], deleteVersions: true, deleteShares: true }, f.context, { repository: f.repository, storage, canPermanentlyDelete: () => true });
    expect(failed.results[0]?.success).toBe(false);
    expect(f.documents.get(documentKey)._internalDeletion).toMatchObject({ kind: 'document', objectKeys: [`docs/${documentKey}`] });
    const inaccessible = await runContentTool('document.find', { documentKeys: [documentKey], includeArchived: true }, f.context, { repository: f.repository });
    expect(inaccessible.results[0]).toMatchObject({ success: false, error: { code: 'CONTENT_NOT_FOUND' } });

    f.repository.transaction = normalTransaction;
    const retried = await runContentTool('document.delete', { documentKeys: [documentKey], deleteVersions: true, deleteShares: true }, f.context, { repository: f.repository, storage, canPermanentlyDelete: () => true });
    expect(retried.results[0]?.success).toBe(true);
    expect(f.documents.has(documentKey)).toBe(false);
    expect(deleted).toEqual([`docs/${documentKey}`, `docs/${documentKey}`]);
  });

  test('deletes logical version snapshots without storage side effects', async () => {
    const f = fixture('owner');
    const documentKey = f.addDocument();
    f.documents.get(documentKey).deletedAt = now;
    const version = await f.repository.createVersion({ scopeKey: f.scopeKey, documentKey, content: 'old', embedding });
    let storageDeletes = 0;
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; }, async delete() { storageDeletes += 1; } };
    const deleted = await runContentTool('document.delete-version', { versionKeys: [version.key] }, f.context, { repository: f.repository, storage, canPermanentlyDelete: () => true });
    expect(deleted.results[0]?.success).toBe(true);
    expect(f.versions.has(version.key)).toBe(false);
    expect(f.documents.get(documentKey)._internalDeletion).toBeUndefined();
    expect(storageDeletes).toBe(0);
  });

  test('rejects descendant creation, sharing, versioning, move, and copy after a subtree freeze', async () => {
    const f = fixture('owner');
    const childKey = newId();
    f.folders.set(childKey, { key: childKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding, deletedAt: now, createdAt: now, updatedAt: now });
    f.folders.get(f.folderKey).deletedAt = now;
    const doomedKey = f.addDocument('Doomed');
    f.documents.get(doomedKey).folderKey = childKey;
    f.documents.get(doomedKey).deletedAt = now;
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
    const deleted = await runContentTool('folder.delete', { folderKeys: [f.folderKey], recursive: true }, f.context, { repository: f.repository, storage, canPermanentlyDelete: () => true });
    expect(deleted.results[0]?.success).toBe(true);
    expect(attempted).toHaveLength(4);
    expect(attempted.every((item) => item.success === false)).toBe(true);
    expect(f.shares.size).toBe(0);
    expect(f.versions.size).toBe(0);
    expect(f.summaries.has(doomedSummary.key)).toBe(false);
    expect(f.summaryAudio.has(doomedAudio.key)).toBe(false);
    expect(f.documents.get(movableKey).folderKey).toBe(outsideKey);
  });

  test('resumes the persisted recursive folder deletion intent regardless of retry flags', async () => {
    const f = fixture('owner');
    const childKey = newId();
    f.folders.set(childKey, { key: childKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding, deletedAt: now, createdAt: now, updatedAt: now });
    f.folders.get(f.folderKey).deletedAt = now;
    const normalTransaction = f.repository.transaction!;
    let transactions = 0;
    f.repository.transaction = async (operation) => {
      transactions += 1;
      if (transactions === 3) throw new Error('metadata commit failed');
      return normalTransaction(operation);
    };
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; }, async delete() {} };

    const failed = await runContentTool('folder.delete', { folderKeys: [f.folderKey], recursive: true }, f.context, { repository: f.repository, storage, canPermanentlyDelete: () => true });
    expect(failed.results[0]?.success).toBe(false);
    expect(f.folders.get(f.folderKey)._internalDeletion.folderKeys).toEqual([f.folderKey, childKey]);

    f.repository.transaction = normalTransaction;
    const retried = await runContentTool('folder.delete', { folderKeys: [f.folderKey], recursive: false }, f.context, { repository: f.repository, storage, canPermanentlyDelete: () => true });
    expect(retried.results[0]).toMatchObject({ success: true });
    expect(f.folders.has(f.folderKey)).toBe(false);
    expect(f.folders.has(childKey)).toBe(false);
  });

  test('resumes an unarchived copy-compensation manifest without retention bypass for normal deletes', async () => {
    const f = fixture('owner');
    const documentKey = f.addDocument('Compensating copy');
    const owner = 'copy-compensation-owner';
    const objectKeys = [`docs/${documentKey}`];
    f.folders.get(f.folderKey)._internalDeletion = { kind: 'folder', owner, folderKeys: [f.folderKey], documentKeys: [documentKey], objectKeys, startedAt: now };
    f.documents.get(documentKey)._internalDeletion = { kind: 'document', owner, objectKeys, startedAt: now };
    const storageDeletes: string[] = [];
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; }, async delete(key: string) { storageDeletes.push(key); } };
    let retentionChecks = 0;
    const dependencies = { repository: f.repository, storage, canPermanentlyDelete: () => { retentionChecks += 1; return false; } };

    await expect(runContentTool('folder.delete', { folderKeys: [f.folderKey], recursive: true, atomic: true }, f.context, dependencies)).rejects.toMatchObject({ code: 'CONTENT_CONFLICT', action: 'transaction', resourceKey: f.folderKey });
    expect(f.folders.has(f.folderKey)).toBe(true);
    expect(f.documents.has(documentKey)).toBe(true);
    expect(storageDeletes).toEqual([]);

    const resumed = await runContentTool('folder.delete', { folderKeys: [f.folderKey], recursive: true }, f.context, dependencies);
    expect(resumed.results[0]).toMatchObject({ success: true });
    expect(retentionChecks).toBe(0);
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
      async complete(identity, hash, _leaseOwner, response) { records.set(identity.idempotencyKey, { hash, status: 'completed', response }); },
      async release(identity) { records.delete(identity.idempotencyKey); },
    };
    const request = { folders: [{ scopeKey: f.scopeKey, name: 'Idempotent' }], idempotencyKey: 'same-key' };
    const dependencies = { repository: f.repository, idempotency: store, embed: async () => embedding };
    const first = await runContentTool('folder.create', request, f.context, dependencies);
    expect(records.get('same-key')?.response).toEqual(first);
    const replay = await runContentTool('folder.create', request, f.context, dependencies);
    expect(replay).toEqual(first);
    expect([...f.folders.values()].filter((folder) => folder.name === 'Idempotent')).toHaveLength(1);
    await expect(runContentTool('folder.create', { ...request, folders: [{ scopeKey: f.scopeKey, name: 'Changed' }] }, f.context, dependencies)).rejects.toMatchObject({ code: 'CONTENT_CONFLICT', retryable: false });
    records.set('pending-key', { hash: 'unused', status: 'pending' });
    const pendingStore: ContentIdempotencyStore = { ...store, async claim() { return { status: 'pending' }; } };
    await expect(runContentTool('folder.create', { folders: [{ scopeKey: f.scopeKey, name: 'Pending' }], idempotencyKey: 'pending-key' }, f.context, { ...dependencies, idempotency: pendingStore })).rejects.toMatchObject({ code: 'CONTENT_CONFLICT', retryable: true });
  });

  test('does not release or duplicate committed work when ledger completion fails', async () => {
    const f = fixture('moderator');
    let claimed = false, releases = 0;
    const store: ContentIdempotencyStore = {
      async claim() { if (claimed) return { status: 'pending' }; claimed = true; return { status: 'claimed' }; },
      async complete() { throw new Error('ledger unavailable'); },
      async release() { releases += 1; },
    };
    const request = { folders: [{ scopeKey: f.scopeKey, name: 'Committed once' }], idempotencyKey: 'completion-failure' };
    const dependencies = { repository: f.repository, idempotency: store, embed: async () => embedding };
    await expect(runContentTool('folder.create', request, f.context, dependencies)).rejects.toMatchObject({ retryable: true });
    await expect(runContentTool('folder.create', request, f.context, dependencies)).rejects.toMatchObject({ retryable: true });
    expect(releases).toBe(0);
    expect([...f.folders.values()].filter((folder) => folder.name === 'Committed once')).toHaveLength(1);
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
      async complete() {},
      async release() {},
    };
    await runContentTool('document.parse', { file, scopeKey: f.scopeKey, folderKey: f.folderKey, idempotencyKey: 'caller-key' }, f.context, { repository: f.repository, parseDocument, idempotency: ledger });
    const otherActor = { ...f.context, principal: { ...f.context.principal, user: { key: newId() } } };
    await runContentTool('document.parse', { file, scopeKey: f.scopeKey, folderKey: f.folderKey, idempotencyKey: 'caller-key' }, otherActor, { repository: f.repository, parseDocument, idempotency: ledger });
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen.every((key) => key !== 'caller-key')).toBe(true);
  });

  test('validates the full restore ancestor chain and rejects corrupt cycles before mutation', async () => {
    const f = fixture('moderator');
    const middle = newId(), leaf = newId(), documentKey = f.addDocument();
    f.folders.set(middle, { key: middle, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Middle', deletedAt: now, embedding, createdAt: now, updatedAt: now });
    f.folders.set(leaf, { key: leaf, scopeKey: f.scopeKey, parentFolderKey: middle, name: 'Leaf', embedding, createdAt: now, updatedAt: now });
    f.documents.get(documentKey).folderKey = leaf;
    f.documents.get(documentKey).deletedAt = now;
    const blocked = await runContentTool('document.restore', { documentKeys: [documentKey] }, f.context, { repository: f.repository });
    expect(blocked.results[0]).toMatchObject({ success: false, error: { code: 'FOLDER_ARCHIVED' } });
    expect(f.documents.get(documentKey).deletedAt).toBe(now);
    f.folders.get(f.folderKey).parentFolderKey = leaf;
    const cycle = await runContentTool('document.restore', { documentKeys: [documentKey], restoreAncestors: true }, f.context, { repository: f.repository });
    expect(cycle.results[0]).toMatchObject({ success: false, error: { code: 'FOLDER_CYCLE_DETECTED' } });
    expect(f.documents.get(documentKey).deletedAt).toBe(now);
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

  test('enhances supplied text without persistence', async () => {
    const f = fixture('viewer');
    let call: { action?: string; input?: any } = {};
    const output = await runContentTool('enhance', { content: 'This are teh text.' }, f.context, {
      repository: f.repository,
      runAction: async (action, input) => {
        call = { action, input };
        return { text: '```text\nThis is the text.\n```' };
      },
    });
    expect(output).toEqual({ content: 'This is the text.' });
    expect(call.action).toBe('enhance');
    expect(call.input.options).toMatchObject({ temperature: 0.1, maxTokens: 256 });
    expect(f.patches).toHaveLength(0);
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
        canPermanentlyDelete: () => true,
        generateExport: async (input: any) => ({ bytes: new TextEncoder().encode(input.format), mimeType: 'text/plain', extension: input.format }),
        parseDocument: async () => ({ document: f.documents.get(documentKey) }),
        scanDocument: async () => ({ documentKey: newId(), content: 'Scanned body', storageKeys: ['scan/page-01.jpg'] }),
        bookRuntime: { create: async () => newId(), write: async () => {} },
        runAction: async (action: string, input: any) => {
          if (action === 'ask' || action === 'enhance' || action === 'translate' || action === 'reason' || action === 'deep-reason' || action === 'document-summarize') return { text: 'Generated text' };
          if (action === 'document-topics') return { text: '{"topics":["Source"]}' };
          if (action === 'speak' || action === 'generate-speech') return { audio: new Uint8Array([1]), mimeType: 'audio/mpeg' };
          if (action === 'document-cleanup') return { content: input.text };
          if (action === 'document-embed') return documentEmbed(input, { embed: async () => embedding, dimensions: EMBEDDING_DIMENSIONS });
          throw new Error(`Unexpected action ${action}`);
        },
        searchQueries: {
          async get({ actorKey, scopeKey, normalizedQuery }: any) { return searchRows.get(`${actorKey}:${scopeKey}:${normalizedQuery}`) ?? null; },
          async record(value: any) { const identity = `${value.actorKey}:${value.scopeKey}:${value.normalizedQuery}`; const old = searchRows.get(identity); searchRows.set(identity, { output: value.output, query: value.query, normalizedQuery: value.normalizedQuery, contextDomain: value.contextDomain, searchedAt: value.now, usageCount: (old?.usageCount ?? 0) + 1 }); },
          async list({ actorKey, scopeKey, limit }: any) { return [...searchRows.entries()].filter(([key]) => key.startsWith(`${actorKey}:${scopeKey}:`)).map(([, value]) => ({ query: value.query, normalizedQuery: value.normalizedQuery, contextDomain: value.contextDomain, searchedAt: value.searchedAt, usageCount: value.usageCount, documents: value.output?.result?.documents ?? [] })).slice(0, limit); },
          async remove({ actorKey, scopeKey, normalizedQuery }: any) { return searchRows.delete(`${actorKey}:${scopeKey}:${normalizedQuery}`); },
        },
        mergeAudio: async () => new Uint8Array([1]),
        audioDuration: () => 100,
        signAudioUrl: async (key: string) => `https://audio.example/${key}`,
      };
      let input: any;
       if (name === 'enhance') input = { content: 'Improve teh wording.' };
       else if (name === 'book.create-context') input = { scopeKey: f.scopeKey, topic: 'Useful systems', goal: 'Build a durable practice', audience: 'Curious beginners', tone: 'Warm and direct', length: 'short', language: 'English' };
       else if (name === 'book.write') input = { bookKey: newId(), scopeKey: f.scopeKey, topic: 'Useful systems', goal: 'Build a durable practice', audience: 'Curious beginners', tone: 'Warm and direct', length: 'short', language: 'English' };
      else if (name === 'folder.create') input = { folders: [{ scopeKey: f.scopeKey, name: 'Created' }] };
      else if (name === 'folder.find') input = { folderKeys: [f.folderKey] };
      else if (name === 'folder.list') input = { scopeKey: f.scopeKey, parentFolderKey: f.folderKey };
      else if (name === 'folder.update') input = { updates: [{ folderKey: childKey, description: 'Updated' }] };
      else if (name === 'folder.rename') input = { renames: [{ folderKey: childKey, name: 'Renamed' }] };
      else if (name === 'folder.move') input = { moves: [{ folderKey: childKey, targetParentFolderKey: siblingKey }] };
      else if (name === 'folder.copy') input = { copies: [{ folderKey: childKey, targetScopeKey: f.scopeKey, targetParentFolderKey: siblingKey }] };
      else if (name === 'folder.archive') input = { folderKeys: [childKey] };
      else if (name === 'folder.restore') { f.folders.get(childKey).deletedAt = now; input = { folderKeys: [childKey] }; }
      else if (name === 'folder.delete') { f.folders.get(childKey).deletedAt = now; input = { folderKeys: [childKey] }; }
      else if (name === 'document.parse') input = { file: { filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 4, bytes: new Uint8Array([1, 2, 3, 4]) }, scopeKey: f.scopeKey, folderKey: f.folderKey };
      else if (name === 'document.scan') input = { pages: [{ filename: 'page.jpg', mimeType: 'image/jpeg', sizeBytes: 4, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }], scopeKey: f.scopeKey, folderKey: f.folderKey };
      else if (name === 'document.create') input = { scopeKey: f.scopeKey, folderKey: f.folderKey, name: 'Created document', content: 'Created body' };
      else if (name === 'document.find') input = { documentKeys: [documentKey], include: ['content'] };
      else if (name === 'document.list') input = { scopeKey: f.scopeKey, folderKey: f.folderKey };
       else if (name === 'document.read') input = { documentKeys: [documentKey], mode: 'content' };
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
        else if (name === 'document.summary.audio.generate') {
          const summary = await f.repository.createSummary!({ key: newId(), scopeKey: f.scopeKey, documentKey, summary: 'Saved audio summary', style: 'brief', sourceContentHash: 'a'.repeat(64), sourceTitle: 'Notes', sourceDocumentUpdatedAt: now, createdByKey: newId(), createdAt: now });
          input = { summaryKeys: [summary.key], language: 'en-US' };
        }
      else if (name === 'document.update') input = { updates: [{ documentKey, content: 'Updated body' }] };
      else if (name === 'document.rename') input = { renames: [{ documentKey, name: 'Renamed' }] };
      else if (name === 'document.move') input = { moves: [{ documentKey, targetScopeKey: f.scopeKey, targetFolderKey: siblingKey }] };
      else if (name === 'document.copy') input = { copies: [{ documentKey, targetScopeKey: f.scopeKey, targetFolderKey: siblingKey }] };
      else if (name === 'document.archive') input = { documentKeys: [documentKey] };
      else if (name === 'document.restore') { f.documents.get(documentKey).deletedAt = now; input = { documentKeys: [documentKey] }; }
      else if (name === 'document.delete') { f.documents.get(documentKey).deletedAt = now; input = { documentKeys: [documentKey], deleteVersions: true, deleteShares: true }; }
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
        else { current.deletedAt = now; input = { versionKeys: [version.key] }; }
      } else if (name === 'document.summarize') input = { documentKeys: [documentKey] };
      else if (name === 'document.topics') input = { documentKey };
      else if (name === 'document.translate') input = { documentKeys: [documentKey], targetLanguage: 'French' };
      else if (name === 'document.rewrite') input = { rewrites: [{ documentKey, instruction: 'Improve clarity' }] };
      else if (name === 'scope.document.search') input = { scopeKey: f.scopeKey, query: 'source' };
      else if (name === 'scope.content.search') input = { scopeKey: f.scopeKey, query: 'source' };
      else if (name === 'scope.content.search-history') input = { scopeKey: f.scopeKey };
      else if (name === 'scope.content.search-history.delete') input = { scopeKey: f.scopeKey, normalizedQuery: 'source' };
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
        label: 'archived ancestor',
        run: async () => {
          const f = fixture('viewer');
          const documentKey = f.addDocument();
          f.folders.get(f.folderKey).deletedAt = now;
          return runContentTool('document.read', { documentKeys: [documentKey] }, f.context, { repository: f.repository });
        },
        codes: ['FOLDER_ARCHIVED'],
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

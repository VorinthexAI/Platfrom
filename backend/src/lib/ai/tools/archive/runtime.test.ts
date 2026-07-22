import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ArchiveRepository } from './runtime';
import { ARCHIVE_TOOL_NAMES, ArchiveError, runArchiveTool, type ArchiveIdempotencyStore } from '.';
import { DocumentProcessingError } from '@/lib/ai/document-processing';
import { documentEmbed, documentGenerateContent, documentGenerateHtml, documentGenerateJson } from '@/lib/ai/document-processing';

const now = '2026-07-22T12:00:00.000Z';
const json = { type: 'doc' as const, content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Body' }] }] };

function fixture(role: 'viewer' | 'moderator' | 'admin' | 'owner' = 'owner') {
  const organizationKey = newId(), scopeKey = newId(), membershipKey = newId(), userKey = newId();
  const folders = new Map<string, any>(), documents = new Map<string, any>(), shares = new Map<string, any>(), versions = new Map<string, any>();
  const patches: Array<Record<string, unknown>> = [];
  const repository: ArchiveRepository = {
    async getScope(key) { return key === scopeKey ? { key, organizationKey } : null; },
    async role(key) { return key === scopeKey ? role : null; },
    async allowedScopeKeys() { return [scopeKey]; },
    async getFolder(key) { return folders.get(key) ?? null; },
    async listFolders(key) { return [...folders.values()].filter((value) => value.scopeKey === key); },
    async insertFolder(value) { const folder = { ...value, embedding: [1] }; folders.set(folder.key, folder); return folder; },
    async updateFolder(key, patch) { patches.push(patch); const value = { ...folders.get(key), ...patch }; folders.set(key, value); return value; },
    async setFolderDeletion(key, marker, owner) { const current = folders.get(key); if (!current || (owner && current._internalDeletion?.owner !== owner)) return null; const value = { ...current, _internalDeletion: marker }; if (!marker) delete value._internalDeletion; folders.set(key, value); return value; },
    async deleteFolder(key) { folders.delete(key); },
    async getDocument(key) { return documents.get(key) ?? null; },
    async listDocuments(key) { return [...documents.values()].filter((value) => value.scopeKey === key); },
    async insertDocument(value) { documents.set(value.key, value); return value; },
    async updateDocument(key, patch) { patches.push(patch); const value = { ...documents.get(key), ...patch }; documents.set(key, value); return value; },
    async setDocumentDeletion(key, marker, owner) { const current = documents.get(key); if (!current || (owner && current._internalDeletion?.owner !== owner)) return null; const value = { ...current, _internalDeletion: marker }; if (!marker) delete value._internalDeletion; documents.set(key, value); return value; },
    async deleteDocument(key) { documents.delete(key); },
    async getShare(key) { return shares.get(key) ?? null; },
    async listShares(_scopeKey, keys) { return [...shares.values()].filter((value) => keys.includes(value.documentKey)); },
    async insertShare(value) { const share = { ...value, embedding: [], deletedAt: null }; shares.set(share.key, share); return share; },
    async updateShare(key, patch) { const value = { ...shares.get(key), ...patch }; shares.set(key, value); return value; },
    async deleteShare(key) { shares.delete(key); },
    async getVersion(key) { return versions.get(key) ?? null; },
    async listVersions(_scopeKey, keys) { return [...versions.values()].filter((value) => keys.includes(value.documentKey)).sort((a, b) => b.version - a.version); },
    async createVersion(value) { const version = { ...value, key: newId(), version: [...versions.values()].filter((item) => item.documentKey === value.documentKey).length + 1, deletedAt: null, createdAt: now }; versions.set(version.key, version); return version; },
    async deleteVersion(key) { versions.delete(key); },
    async semanticSearch() { return [...documents.values()].map((document) => ({ score: 0.8, document })); },
    async transaction(operation) { return operation(repository); },
  };
  const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: membershipKey, organizationId: organizationKey, status: 'active', orgRole: role } } } as any;
  const folderKey = newId(); folders.set(folderKey, { key: folderKey, scopeKey, name: 'Root', embedding: [1], createdAt: now, updatedAt: now });
  const addDocument = (content = 'First sentence. Second sentence.') => { const key = newId(); documents.set(key, { key, scopeKey, folderKey, name: 'Notes', extension: 'txt', mimeType: 'text/plain', sizeBytes: content.length, storageKey: `docs/${key}`, html: `<p>${content}</p>`, json, content, embedding: [1], createdAt: now, updatedAt: now }); return key; };
  return { repository, context, folders, documents, shares, versions, patches, scopeKey, folderKey, addDocument };
}

describe('Archive runtime', () => {
  test('requires a resolved human principal for every registered tool', async () => {
    const f = fixture();
    for (const name of ARCHIVE_TOOL_NAMES) {
      await expect(runArchiveTool(name, {}, { ...f.context, principal: { kind: 'system' } }, { repository: f.repository })).rejects.toMatchObject({
        code: 'ARCHIVE_UNAUTHORIZED',
        tool: name,
      });
    }
  });

  test('rejects system principals and enforces write roles', async () => {
    const f = fixture('viewer');
    await expect(runArchiveTool('folder.create', { folders: [{ scopeKey: f.scopeKey, name: 'Denied' }] }, { ...f.context, principal: { kind: 'system' } }, { repository: f.repository })).rejects.toMatchObject({ code: 'ARCHIVE_UNAUTHORIZED' });
    const denied = await runArchiveTool('folder.create', { folders: [{ scopeKey: f.scopeKey, name: 'Denied' }] }, f.context, { repository: f.repository });
    expect(denied.results[0]).toMatchObject({ success: false, error: { code: 'ARCHIVE_FORBIDDEN' } });
  });

  test('preserves batch order, continues partial failures, and preflights atomic batches', async () => {
    const f = fixture('moderator'); const missing = newId();
    const result = await runArchiveTool('folder.rename', { renames: [{ folderKey: f.folderKey, name: 'Renamed' }, { folderKey: missing, name: 'Missing' }] }, f.context, { repository: f.repository, embed: async () => [1] });
    expect(result.results.map((item) => [item.key, item.success])).toEqual([[f.folderKey, true], [missing, false]]);
    expect(result.summary).toEqual({ requested: 2, succeeded: 1, failed: 1 });
    const before = f.folders.get(f.folderKey).name;
    await expect(runArchiveTool('folder.rename', { renames: [{ folderKey: f.folderKey, name: 'Atomic' }, { folderKey: missing, name: 'Missing' }], atomic: true }, f.context, { repository: f.repository, embed: async () => [1] })).rejects.toBeInstanceOf(ArchiveError);
    expect(f.folders.get(f.folderKey).name).toBe(before);
  });

  test('detects folder cycles and document moves do not re-embed', async () => {
    const f = fixture('admin'); const child = newId();
    f.folders.set(child, { key: child, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding: [1], createdAt: now, updatedAt: now });
    const cycle = await runArchiveTool('folder.move', { moves: [{ folderKey: f.folderKey, targetParentFolderKey: child }] }, f.context, { repository: f.repository });
    expect(cycle.results[0]).toMatchObject({ success: false, error: { code: 'FOLDER_CYCLE_DETECTED' } });
    const documentKey = f.addDocument();
    await runArchiveTool('document.move', { moves: [{ documentKey, targetFolderKey: child }] }, f.context, { repository: f.repository });
    expect(f.patches.at(-1)).toMatchObject({ folderKey: child });
    expect(f.patches.at(-1)).not.toHaveProperty('embedding');
  });

  test('rejects cross-scope document moves instead of performing a partial transfer', async () => {
    const f = fixture('admin');
    const foreignScopeKey = newId();
    const targetFolderKey = newId();
    f.folders.set(targetFolderKey, { key: targetFolderKey, scopeKey: foreignScopeKey, name: 'Foreign', embedding: [1], createdAt: now, updatedAt: now });
    const originalGetScope = f.repository.getScope;
    f.repository.getScope = async (key) => key === foreignScopeKey ? { key, organizationKey: f.context.organizationKey } : originalGetScope(key);
    const output = await runArchiveTool('document.move', { moves: [{ documentKey: f.addDocument(), targetFolderKey }] }, f.context, { repository: f.repository });
    expect(output.results[0]).toMatchObject({ success: false, error: { code: 'FOLDER_MOVE_FORBIDDEN' } });
  });

  test('returns a creation-only share token and persists only hashes', async () => {
    const f = fixture('moderator'); const documentKey = f.addDocument();
    const output = await runArchiveTool('document.share', { shares: [{ documentKey, permission: 'read', password: 'correct horse battery staple' }] }, f.context, { repository: f.repository, random: (size) => new Uint8Array(size).fill(7), clock: () => new Date(now) });
    expect(output.results[0]?.data?.token).toHaveLength(43);
    const persisted = [...f.shares.values()][0];
    expect(persisted.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.passwordHash).toMatch(/^scrypt:/);
    expect(JSON.stringify(output)).not.toContain(persisted.tokenHash);
    const listed = await runArchiveTool('document.list-shares', { documentKeys: [documentKey] }, f.context, { repository: f.repository, clock: () => new Date(now) });
    expect(JSON.stringify(listed)).not.toContain('Hash');
    expect(JSON.stringify(listed)).not.toContain(output.results[0]?.data?.token ?? 'token');
  });

  test('rejects already expired shares', async () => {
    const f = fixture('moderator');
    const output = await runArchiveTool('document.share', { shares: [{ documentKey: f.addDocument(), permission: 'read', expiresAt: '2026-07-21T00:00:00.000Z' }] }, f.context, { repository: f.repository, clock: () => new Date(now) });
    expect(output.results[0]).toMatchObject({ success: false, error: { code: 'DOCUMENT_SHARE_INVALID' } });
    expect(f.shares.size).toBe(0);
  });

  test('maps document processing failures into Archive taxonomy and retryability', async () => {
    const f = fixture('moderator');
    const file = { filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 4, bytes: new TextEncoder().encode('text') };
    await expect(runArchiveTool('document.processing', { file, scopeKey: f.scopeKey, folderKey: f.folderKey }, f.context, {
      repository: f.repository,
      processDocument: async () => { throw new DocumentProcessingError('DOCUMENT_EMBEDDING_FAILED', 'Embedding failed.', 'document-embed', { retryable: true }); },
    })).rejects.toMatchObject({ code: 'DOCUMENT_EMBEDDING_FAILED', action: 'document-embed', retryable: true });
  });

  test('returns playable audio with conservative document offsets and MIME-matched persistence', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument(`0123456789Visible sentence. ${'More words. '.repeat(30)} \`secret code\``);
    const spoken: string[] = [], uploaded: string[] = [];
    const dependencies: any = { repository: f.repository, maxSpeechChunkCharacters: 200, runAction: async (action: string, input: any) => { expect(action).toBe('speak'); spoken.push(input.text); return { audio: new Uint8Array([spoken.length]), mimeType: 'audio/ogg', durationMs: 10 }; }, storage: { async upload(input: any) { uploaded.push(input.key); return { storageKey: input.key }; }, async delete() {}, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } } };
    const ephemeral = await runArchiveTool('document.read', { documentKeys: [documentKey], mode: 'audio', startOffset: 10, includeTitle: true }, f.context, dependencies);
    const audio = (ephemeral.results[0]?.data as { audio: Array<{ index: number; url: string; startCharacter: number; endCharacter: number }> }).audio;
    expect(audio.map((item) => item.index)).toEqual([...spoken.keys()]);
    expect(audio.every((item) => item.url.startsWith('data:audio/ogg;base64,'))).toBe(true);
    expect(audio.every((item) => item.startCharacter >= 10 && item.endCharacter > item.startCharacter)).toBe(true);
    expect(spoken[0]).toStartWith('Notes. Visible sentence.');
    expect(spoken.join(' ')).not.toContain('secret code');
    expect(uploaded).toHaveLength(0);
    await runArchiveTool('document.read', { documentKeys: [documentKey], mode: 'audio', startOffset: 10, includeCode: false, persistAudio: true }, f.context, dependencies);
    expect(uploaded.length).toBeGreaterThan(0);
    expect(uploaded.every((key) => key.endsWith('.ogg'))).toBe(true);
    expect(f.documents.get(documentKey).speechStorageKeys).toEqual(uploaded);
  });

  test('cleans persisted audio chunks when a later speech chunk fails', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument('Long sentence. '.repeat(80));
    const uploaded: string[] = [], deleted: string[] = [];
    let calls = 0;
    const output = await runArchiveTool('document.read', { documentKeys: [documentKey], mode: 'audio', persistAudio: true }, f.context, {
      repository: f.repository,
      maxSpeechChunkCharacters: 200,
      runAction: async () => {
        calls += 1;
        if (calls === 2) throw new Error('speech failed');
        return { audio: new Uint8Array([1]), mimeType: 'audio/wav' };
      },
      storage: {
        async upload(input) { uploaded.push(input.key); return { storageKey: input.key }; },
        async delete(key) { deleted.push(key); },
        async download() { return { bytes: new Uint8Array() }; },
        async copy() { return { storageKey: '' }; },
      },
    });
    expect(output.results[0]?.success).toBe(false);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toEndWith('.wav');
    expect(deleted).toEqual(uploaded);
  });

  test('filters semantic search to authorized scopes and rejects unresolved projects', async () => {
    const f = fixture('viewer'); f.addDocument('Roadmap launch'); let authorized: string[] = [];
    f.repository.semanticSearch = async (input) => { authorized = input.authorizedScopeKeys; return [...f.documents.values()].map((document) => ({ score: 0.8, document })); };
    const output = await runArchiveTool('scope.document.search', { scopeKey: f.scopeKey, query: 'roadmap' }, f.context, { repository: f.repository, embed: async () => [1] });
    expect(authorized).toEqual([f.scopeKey]); expect(output.results[0]?.score).toBe(0.8);
    await expect(runArchiveTool('scope.document.search', { scopeKey: f.scopeKey, query: 'roadmap', sources: [{ type: 'project', projectKeys: [newId()] }] }, f.context, { repository: f.repository, embed: async () => [1] })).rejects.toMatchObject({ code: 'ARCHIVE_SEARCH_INVALID_SOURCE' });
  });

  test('search includes archived folder hierarchies only when explicitly requested', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument('Archived roadmap');
    f.folders.get(f.folderKey).deletedAt = now;
    f.documents.get(documentKey).deletedAt = now;
    f.repository.semanticSearch = async () => [{ score: 0.9, document: f.documents.get(documentKey) }];
    const activeOnly = await runArchiveTool('scope.document.search', { scopeKey: f.scopeKey, query: 'roadmap' }, f.context, { repository: f.repository, embed: async () => [1] });
    expect(activeOnly.results).toEqual([]);
    const archived = await runArchiveTool('scope.document.search', { scopeKey: f.scopeKey, query: 'roadmap', filters: { includeArchived: true } }, f.context, { repository: f.repository, embed: async () => [1] });
    expect(archived.results.map((item) => item.documentKey)).toEqual([documentKey]);
  });

  test('runs real representation actions in canonical order before document update', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Old body');
    const actions: string[] = [];
    const output = await runArchiveTool('document.update', {
      updates: [{ documentKey, content: 'New body' }],
    }, f.context, {
      repository: f.repository,
      embed: async () => [0.5],
      ingestion: { embeddingDimensions: 1 },
      observer(event) {
        if (event.type === 'action' && event.status === 'started' && event.action?.startsWith('document-')) actions.push(event.action);
      },
    });
    expect(output.results[0]?.success).toBe(true);
    expect(actions).toEqual(['document-generate-html', 'document-generate-json', 'document-generate-html', 'document-generate-content', 'document-embed']);
    expect(f.documents.get(documentKey)).toMatchObject({ html: '<p>New body</p>', content: 'New body', embedding: [0.5] });
  });

  test('sanitizes HTML updates and persists canonical agreeing representations', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Old body');
    const output = await runArchiveTool('document.update', {
      updates: [{ documentKey, html: '<p onclick="steal()">Safe <span>text</span></p><script>alert(1)</script><custom>drop</custom>' }],
    }, f.context, { repository: f.repository, embed: async () => [1], ingestion: { embeddingDimensions: 1 } });
    expect(output.results[0]?.success).toBe(true);
    const stored = f.documents.get(documentKey);
    expect(stored.html).toBe('<p>Safe text</p>');
    expect(stored.content).toBe('Safe text');
    expect(JSON.stringify(stored.json)).not.toContain('script');
    expect(stored.html).not.toContain('onclick');
    expect(stored.html).not.toContain('custom');
  });

  test('embeds the final derived name for persisted AI copies', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Source body');
    const embeddedNames: string[] = [];
    const storage: any = { async upload(input: any) { return { storageKey: input.key }; }, async delete() {}, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } };
    const output = await runArchiveTool('document.translate', { documentKeys: [documentKey], targetLanguage: 'French', mode: 'copy' }, f.context, {
      repository: f.repository,
      storage,
      runAction: async (action, input) => {
        if (action === 'reason') return { text: 'Texte traduit' };
        if (action === 'document-generate-html') return documentGenerateHtml(input as never);
        if (action === 'document-generate-json') return documentGenerateJson(input as never);
        if (action === 'document-generate-content') return documentGenerateContent(input as never);
        if (action === 'document-embed') {
          embeddedNames.push(String(input.name));
          return documentEmbed(input as never, { embed: async () => [1], dimensions: 1 });
        }
        throw new Error(`Unexpected action ${action}`);
      },
    });
    expect(output.results[0]?.success).toBe(true);
    expect(embeddedNames).toEqual(['Notes (translate)']);
  });

  test('precomputes atomic exports and throws without returning partial success', async () => {
    const f = fixture('viewer');
    const first = f.addDocument('First');
    const second = f.addDocument('Second');
    let calls = 0;
    const generateExport: any = async () => {
      calls += 1;
      if (calls === 2) throw new Error('renderer failed');
      return { bytes: new TextEncoder().encode('<p>ok</p>'), mimeType: 'text/html', extension: 'html' };
    };
    await expect(runArchiveTool('document.export', { exports: [{ documentKey: first, format: 'html' }, { documentKey: second, format: 'html' }], atomic: true }, f.context, { repository: f.repository, generateExport })).rejects.toMatchObject({ action: 'export', resourceKey: second });
    calls = 0;
    const output = await runArchiveTool('document.export', { exports: [{ documentKey: first, format: 'html' }, { documentKey: second, format: 'html' }], atomic: true }, f.context, { repository: f.repository, generateExport: async () => ({ bytes: new Uint8Array([1]), mimeType: 'text/html', extension: 'html' }) });
    expect(output.summary).toEqual({ requested: 2, succeeded: 2, failed: 0 });
  });

  test('archives and restores documents with a selected folder subtree', async () => {
    const f = fixture('moderator');
    const child = newId();
    f.folders.set(child, { key: child, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding: [1], createdAt: now, updatedAt: now });
    const documentKey = f.addDocument();
    f.documents.get(documentKey).folderKey = child;
    await runArchiveTool('folder.archive', { folderKeys: [f.folderKey], includeDescendants: true }, f.context, { repository: f.repository, clock: () => new Date(now) });
    expect(f.folders.get(child).deletedAt).toBe(now);
    expect(f.documents.get(documentKey).deletedAt).toBe(now);
    await runArchiveTool('folder.restore', { folderKeys: [f.folderKey], includeDescendants: true }, f.context, { repository: f.repository, clock: () => new Date(now) });
    expect(f.folders.get(child).deletedAt).toBeNull();
    expect(f.documents.get(documentKey).deletedAt).toBeNull();
  });

  test('deletes storage before transaction-bound document metadata and retains pointers on failure', async () => {
    const f = fixture('owner');
    const documentKey = f.addDocument();
    f.documents.get(documentKey).deletedAt = now;
    f.documents.get(documentKey).speechStorageKeys = ['speech/shared', 'speech/second'];
    const version = await f.repository.createVersion({
      scopeKey: f.scopeKey, documentKey, html: '<p>old</p>', json, content: 'old', embedding: [1], storageKey: 'speech/shared',
    });
    const calls: string[] = [];
    const originalDelete = f.repository.deleteDocument;
    f.repository.deleteDocument = async (key) => { calls.push('metadata'); await originalDelete(key); };
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; }, async delete() { calls.push('storage'); throw new Error('offline'); } };
    const failed = await runArchiveTool('document.delete', { documentKeys: [documentKey], deleteVersions: true, deleteShares: true }, f.context, { repository: f.repository, storage, canPermanentlyDelete: () => true });
    expect(failed.results[0]?.success).toBe(false);
    expect(calls).toEqual(['storage']);
    expect(f.documents.has(documentKey)).toBe(true);
    expect(f.versions.has(version.key)).toBe(true);
    storage.delete = async () => { calls.push('storage'); };
    const deleted = await runArchiveTool('document.delete', { documentKeys: [documentKey], deleteVersions: true, deleteShares: true }, f.context, { repository: f.repository, storage, canPermanentlyDelete: () => true });
    expect(deleted.results[0]?.success).toBe(true);
    expect(calls.filter((call) => call === 'storage').length).toBe(4);
    expect(calls.at(-1)).toBe('metadata');
    expect(f.versions.has(version.key)).toBe(false);
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

    const failed = await runArchiveTool('document.delete', { documentKeys: [documentKey], deleteVersions: true, deleteShares: true }, f.context, { repository: f.repository, storage, canPermanentlyDelete: () => true });
    expect(failed.results[0]?.success).toBe(false);
    expect(f.documents.get(documentKey)._internalDeletion).toMatchObject({ kind: 'document', objectKeys: [`docs/${documentKey}`] });
    const inaccessible = await runArchiveTool('document.find', { documentKeys: [documentKey], includeArchived: true }, f.context, { repository: f.repository });
    expect(inaccessible.results[0]).toMatchObject({ success: false, error: { code: 'ARCHIVE_NOT_FOUND' } });

    f.repository.transaction = normalTransaction;
    const retried = await runArchiveTool('document.delete', { documentKeys: [documentKey], deleteVersions: true, deleteShares: true }, f.context, { repository: f.repository, storage, canPermanentlyDelete: () => true });
    expect(retried.results[0]?.success).toBe(true);
    expect(f.documents.has(documentKey)).toBe(false);
    expect(deleted).toEqual([`docs/${documentKey}`, `docs/${documentKey}`]);
  });

  test('keeps a version cleanup manifest on its document until metadata deletion commits', async () => {
    const f = fixture('owner');
    const documentKey = f.addDocument();
    f.documents.get(documentKey).deletedAt = now;
    const version = await f.repository.createVersion({ scopeKey: f.scopeKey, documentKey, html: '<p>old</p>', json, content: 'old', embedding: [1], storageKey: 'versions/old' });
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; }, async delete() {} };
    const normalTransaction = f.repository.transaction!;
    let transactions = 0;
    f.repository.transaction = async (operation) => {
      transactions += 1;
      if (transactions === 2) throw new Error('metadata commit failed');
      return normalTransaction(operation);
    };
    const failed = await runArchiveTool('document.delete-version', { versionKeys: [version.key] }, f.context, { repository: f.repository, storage, canPermanentlyDelete: () => true });
    expect(failed.results[0]?.success).toBe(false);
    expect(f.documents.get(documentKey)._internalDeletion).toMatchObject({ kind: 'version', versionKey: version.key, objectKeys: ['versions/old'] });
    expect(f.versions.has(version.key)).toBe(true);
    f.repository.transaction = normalTransaction;
    const retried = await runArchiveTool('document.delete-version', { versionKeys: [version.key] }, f.context, { repository: f.repository, storage, canPermanentlyDelete: () => true });
    expect(retried.results[0]?.success).toBe(true);
    expect(f.versions.has(version.key)).toBe(false);
    expect(f.documents.get(documentKey)._internalDeletion).toBeUndefined();
  });

  test('rejects descendant creation, sharing, versioning, move, and copy after a subtree freeze', async () => {
    const f = fixture('owner');
    const childKey = newId();
    f.folders.set(childKey, { key: childKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding: [1], deletedAt: now, createdAt: now, updatedAt: now });
    f.folders.get(f.folderKey).deletedAt = now;
    const doomedKey = f.addDocument('Doomed');
    f.documents.get(doomedKey).folderKey = childKey;
    f.documents.get(doomedKey).deletedAt = now;
    const outsideKey = newId();
    f.folders.set(outsideKey, { key: outsideKey, scopeKey: f.scopeKey, name: 'Outside', embedding: [1], createdAt: now, updatedAt: now });
    const movableKey = f.addDocument('Movable');
    f.documents.get(movableKey).folderKey = outsideKey;
    const originalListVersions = f.repository.listVersions;
    const attempted: Array<{ success: boolean }> = [];
    let raced = false;
    f.repository.listVersions = async (...args) => {
      if (!raced) {
        raced = true;
        const calls = await Promise.all([
          runArchiveTool('document.share', { shares: [{ documentKey: doomedKey, permission: 'read' }] }, f.context, { repository: f.repository }),
          runArchiveTool('document.create-version', { documentKeys: [doomedKey] }, f.context, { repository: f.repository }),
          runArchiveTool('document.move', { moves: [{ documentKey: movableKey, targetFolderKey: childKey }] }, f.context, { repository: f.repository }),
          runArchiveTool('document.copy', { copies: [{ documentKey: movableKey, targetFolderKey: childKey }] }, f.context, { repository: f.repository }),
        ]);
        for (const call of calls) attempted.push(call.results[0] as { success: boolean });
      }
      return originalListVersions(...args);
    };
    const storage: any = { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy() { throw new Error('copy must not reach storage'); }, async delete() {} };
    const deleted = await runArchiveTool('folder.delete', { folderKeys: [f.folderKey], recursive: true }, f.context, { repository: f.repository, storage, canPermanentlyDelete: () => true });
    expect(deleted.results[0]?.success).toBe(true);
    expect(attempted).toHaveLength(4);
    expect(attempted.every((item) => item.success === false)).toBe(true);
    expect(f.shares.size).toBe(0);
    expect(f.versions.size).toBe(0);
    expect(f.documents.get(movableKey).folderKey).toBe(outsideKey);
  });

  test('replays completed idempotent mutations and rejects changed or pending requests', async () => {
    const f = fixture('moderator');
    const records = new Map<string, { hash: string; status: 'pending' | 'completed'; response?: unknown }>();
    const store: ArchiveIdempotencyStore = {
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
    const dependencies = { repository: f.repository, idempotency: store, embed: async () => [1] };
    const first = await runArchiveTool('folder.create', request, f.context, dependencies);
    expect(records.get('same-key')?.response).toEqual(first);
    const replay = await runArchiveTool('folder.create', request, f.context, dependencies);
    expect(replay).toEqual(first);
    expect([...f.folders.values()].filter((folder) => folder.name === 'Idempotent')).toHaveLength(1);
    await expect(runArchiveTool('folder.create', { ...request, folders: [{ scopeKey: f.scopeKey, name: 'Changed' }] }, f.context, dependencies)).rejects.toMatchObject({ code: 'ARCHIVE_CONFLICT', retryable: false });
    records.set('pending-key', { hash: 'unused', status: 'pending' });
    const pendingStore: ArchiveIdempotencyStore = { ...store, async claim() { return { status: 'pending' }; } };
    await expect(runArchiveTool('folder.create', { folders: [{ scopeKey: f.scopeKey, name: 'Pending' }], idempotencyKey: 'pending-key' }, f.context, { ...dependencies, idempotency: pendingStore })).rejects.toMatchObject({ code: 'ARCHIVE_CONFLICT', retryable: true });
  });

  test('does not release or duplicate committed work when ledger completion fails', async () => {
    const f = fixture('moderator');
    let claimed = false, releases = 0;
    const store: ArchiveIdempotencyStore = {
      async claim() { if (claimed) return { status: 'pending' }; claimed = true; return { status: 'claimed' }; },
      async complete() { throw new Error('ledger unavailable'); },
      async release() { releases += 1; },
    };
    const request = { folders: [{ scopeKey: f.scopeKey, name: 'Committed once' }], idempotencyKey: 'completion-failure' };
    const dependencies = { repository: f.repository, idempotency: store, embed: async () => [1] };
    await expect(runArchiveTool('folder.create', request, f.context, dependencies)).rejects.toMatchObject({ retryable: true });
    await expect(runArchiveTool('folder.create', request, f.context, dependencies)).rejects.toMatchObject({ retryable: true });
    expect(releases).toBe(0);
    expect([...f.folders.values()].filter((folder) => folder.name === 'Committed once')).toHaveLength(1);
  });

  test('scopes delegated processing idempotency to the actor', async () => {
    const f = fixture('moderator');
    const seen: string[] = [];
    const file = { filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 4, bytes: new TextEncoder().encode('text') };
    const processDocument = async (input: any) => {
      seen.push(input.idempotencyKey);
      return { document: f.documents.get(f.addDocument()) };
    };
    const ledger: ArchiveIdempotencyStore = {
      async claim() { return { status: 'claimed' }; },
      async complete() {},
      async release() {},
    };
    await runArchiveTool('document.processing', { file, scopeKey: f.scopeKey, folderKey: f.folderKey, idempotencyKey: 'caller-key' }, f.context, { repository: f.repository, processDocument, idempotency: ledger });
    const otherActor = { ...f.context, principal: { ...f.context.principal, user: { key: newId() } } };
    await runArchiveTool('document.processing', { file, scopeKey: f.scopeKey, folderKey: f.folderKey, idempotencyKey: 'caller-key' }, otherActor, { repository: f.repository, processDocument, idempotency: ledger });
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen.every((key) => key !== 'caller-key')).toBe(true);
  });

  test('validates the full restore ancestor chain and rejects corrupt cycles before mutation', async () => {
    const f = fixture('moderator');
    const middle = newId(), leaf = newId(), documentKey = f.addDocument();
    f.folders.set(middle, { key: middle, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Middle', deletedAt: now, embedding: [1], createdAt: now, updatedAt: now });
    f.folders.set(leaf, { key: leaf, scopeKey: f.scopeKey, parentFolderKey: middle, name: 'Leaf', embedding: [1], createdAt: now, updatedAt: now });
    f.documents.get(documentKey).folderKey = leaf;
    f.documents.get(documentKey).deletedAt = now;
    const blocked = await runArchiveTool('document.restore', { documentKeys: [documentKey] }, f.context, { repository: f.repository });
    expect(blocked.results[0]).toMatchObject({ success: false, error: { code: 'FOLDER_ARCHIVED' } });
    expect(f.documents.get(documentKey).deletedAt).toBe(now);
    f.folders.get(f.folderKey).parentFolderKey = leaf;
    const cycle = await runArchiveTool('document.restore', { documentKeys: [documentKey], restoreAncestors: true }, f.context, { repository: f.repository });
    expect(cycle.results[0]).toMatchObject({ success: false, error: { code: 'FOLDER_CYCLE_DETECTED' } });
    expect(f.documents.get(documentKey).deletedAt).toBe(now);
  });

  test('does not audit preview-only AI and observer payloads contain no generated content', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument('Private source text');
    const audits: unknown[] = [];
    const events: unknown[] = [];
    await runArchiveTool('document.summarize', { documentKeys: [documentKey] }, f.context, {
      repository: f.repository,
      runAction: async () => ({ text: 'Private generated summary' }),
      audit: async (event) => { audits.push(event); },
      observer: (event) => { events.push(event); },
    });
    expect(audits).toHaveLength(0);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('Private source text');
    expect(serialized).not.toContain('Private generated summary');
    expect(events.every((event: any) => typeof event.invocationKey === 'string')).toBe(true);
  });

  test('executes one authorized valid behavior path for every registered tool', async () => {
    for (const name of ARCHIVE_TOOL_NAMES) {
      const f = fixture('owner');
      const documentKey = f.addDocument('Source body');
      const childKey = newId();
      const siblingKey = newId();
      f.folders.set(childKey, { key: childKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Child', embedding: [1], createdAt: now, updatedAt: now });
      f.folders.set(siblingKey, { key: siblingKey, scopeKey: f.scopeKey, parentFolderKey: f.folderKey, name: 'Sibling', embedding: [1], createdAt: now, updatedAt: now });
      const storage: any = {
        async upload(input: any) { return { storageKey: input.key }; },
        async delete() {},
        async download() { return { bytes: new TextEncoder().encode('original'), mimeType: 'text/plain' }; },
        async copy(input: any) { return { storageKey: input.destinationKey }; },
      };
      const dependencies: any = {
        repository: f.repository,
        storage,
        embed: async () => [1],
        ingestion: { embeddingDimensions: 1 },
        clock: () => new Date(now),
        canPermanentlyDelete: () => true,
        audit: async () => {},
        generateExport: async (input: any) => ({ bytes: new TextEncoder().encode(input.format), mimeType: 'text/plain', extension: input.format }),
        processDocument: async () => ({ document: f.documents.get(documentKey) }),
        runAction: async (action: string, input: any) => {
          if (action === 'reason' || action === 'deep-reason') return { text: 'Generated text' };
          if (action === 'speak') return { audio: new Uint8Array([1]), mimeType: 'audio/mpeg' };
          if (action === 'document-generate-html') return documentGenerateHtml(input);
          if (action === 'document-generate-json') return documentGenerateJson(input);
          if (action === 'document-generate-content') return documentGenerateContent(input);
          if (action === 'document-embed') return documentEmbed(input, { embed: async () => [1], dimensions: 1 });
          throw new Error(`Unexpected action ${action}`);
        },
      };
      let input: any;
      if (name === 'folder.create') input = { folders: [{ scopeKey: f.scopeKey, name: 'Created' }] };
      else if (name === 'folder.find') input = { folderKeys: [f.folderKey] };
      else if (name === 'folder.list') input = { scopeKey: f.scopeKey, parentFolderKey: f.folderKey };
      else if (name === 'folder.update') input = { updates: [{ folderKey: childKey, description: 'Updated' }] };
      else if (name === 'folder.rename') input = { renames: [{ folderKey: childKey, name: 'Renamed' }] };
      else if (name === 'folder.move') input = { moves: [{ folderKey: childKey, targetParentFolderKey: siblingKey }] };
      else if (name === 'folder.archive') input = { folderKeys: [childKey] };
      else if (name === 'folder.restore') { f.folders.get(childKey).deletedAt = now; input = { folderKeys: [childKey] }; }
      else if (name === 'folder.delete') { f.folders.get(childKey).deletedAt = now; input = { folderKeys: [childKey] }; }
      else if (name === 'document.processing') input = { file: { filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 4, bytes: new Uint8Array([1, 2, 3, 4]) }, scopeKey: f.scopeKey, folderKey: f.folderKey };
      else if (name === 'document.find') input = { documentKeys: [documentKey], include: ['content'] };
      else if (name === 'document.list') input = { folderKey: f.folderKey };
      else if (name === 'document.read') input = { documentKeys: [documentKey], mode: 'content' };
      else if (name === 'document.update') input = { updates: [{ documentKey, content: 'Updated body' }] };
      else if (name === 'document.rename') input = { renames: [{ documentKey, name: 'Renamed' }] };
      else if (name === 'document.move') input = { moves: [{ documentKey, targetFolderKey: siblingKey }] };
      else if (name === 'document.copy') input = { copies: [{ documentKey, targetFolderKey: siblingKey }] };
      else if (name === 'document.archive') input = { documentKeys: [documentKey] };
      else if (name === 'document.restore') { f.documents.get(documentKey).deletedAt = now; input = { documentKeys: [documentKey] }; }
      else if (name === 'document.delete') { f.documents.get(documentKey).deletedAt = now; input = { documentKeys: [documentKey], deleteVersions: true, deleteShares: true }; }
      else if (name === 'document.download') input = { documentKeys: [documentKey], format: 'original' };
      else if (name === 'document.export') input = { exports: [{ documentKey, format: 'txt' }] };
      else if (name === 'document.share') input = { shares: [{ documentKey, permission: 'read' }] };
      else if (name === 'document.unshare') {
        const shareKey = newId();
        f.shares.set(shareKey, { key: shareKey, scopeKey: f.scopeKey, documentKey, permission: 'read', tokenHash: 'a'.repeat(64), embedding: [], createdAt: now, updatedAt: now });
        input = { shareKeys: [shareKey] };
      } else if (name === 'document.list-shares') input = { documentKeys: [documentKey] };
      else if (name === 'document.create-version') input = { documentKeys: [documentKey], labels: { [documentKey]: 'Release' } };
      else if (name === 'document.find-version' || name === 'document.list-versions' || name === 'document.restore-version' || name === 'document.delete-version') {
        const current = f.documents.get(documentKey);
        const version = await f.repository.createVersion({ scopeKey: f.scopeKey, documentKey, html: current.html, json: current.json, content: current.content, embedding: current.embedding });
        if (name === 'document.find-version') input = { versionKeys: [version.key] };
        else if (name === 'document.list-versions') input = { documentKeys: [documentKey] };
        else if (name === 'document.restore-version') input = { restores: [{ documentKey, versionKey: version.key }] };
        else { current.deletedAt = now; input = { versionKeys: [version.key] }; }
      } else if (name === 'document.summarize') input = { documentKeys: [documentKey] };
      else if (name === 'document.translate') input = { documentKeys: [documentKey], targetLanguage: 'French' };
      else if (name === 'document.rewrite') input = { rewrites: [{ documentKey, instruction: 'Improve clarity' }] };
      else if (name === 'scope.document.search') input = { scopeKey: f.scopeKey, query: 'source' };
      else input = { organizationKey: f.context.organizationKey, query: 'source' };
      const output: any = await runArchiveTool(name, input, f.context, dependencies);
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
          return runArchiveTool('folder.create', { folders: [{ scopeKey: f.scopeKey, name: 'Denied' }] }, f.context, { repository: f.repository, embed: async () => [1] });
        },
        codes: ['ARCHIVE_FORBIDDEN'],
      },
      {
        label: 'missing resource',
        run: async () => {
          const f = fixture('viewer');
          return runArchiveTool('document.read', { documentKeys: [newId()] }, f.context, { repository: f.repository });
        },
        codes: ['ARCHIVE_NOT_FOUND'],
      },
      {
        label: 'archived ancestor',
        run: async () => {
          const f = fixture('viewer');
          const documentKey = f.addDocument();
          f.folders.get(f.folderKey).deletedAt = now;
          return runArchiveTool('document.read', { documentKeys: [documentKey] }, f.context, { repository: f.repository });
        },
        codes: ['FOLDER_ARCHIVED'],
      },
      {
        label: 'partial ordered batch',
        run: async () => {
          const f = fixture('moderator');
          return runArchiveTool('folder.rename', { renames: [{ folderKey: f.folderKey, name: 'Renamed' }, { folderKey: newId(), name: 'Missing' }] }, f.context, { repository: f.repository, embed: async () => [1] });
        },
        codes: [undefined, 'ARCHIVE_NOT_FOUND'],
      },
    ];
    for (const item of cases) {
      const output: any = await item.run();
      expect(output.results.map((result: any) => result.error?.code), item.label).toEqual(item.codes);
    }
  });
});

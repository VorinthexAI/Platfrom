import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ContentRepository } from './content-runtime';
import { authorizeDocumentParseLocation, CONTENT_TOOL_NAMES, ContentError, runContentTool, type ContentIdempotencyStore } from '.';
import { documentKeyForRequest, DocumentProcessingError } from '@/lib/ai/document-processing';
import { documentEmbed, documentGenerateContent, documentGenerateHtml } from '@/lib/ai/document-processing';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { chatInputSchema, speechInputSchema } from '@/lib/ai/providers/types';

const now = '2026-07-22T12:00:00.000Z';
const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

function fixture(role: 'viewer' | 'moderator' | 'admin' | 'owner' = 'owner') {
  const organizationKey = newId(), scopeKey = newId(), membershipKey = newId(), userKey = newId();
  const folders = new Map<string, any>(), documents = new Map<string, any>(), shares = new Map<string, any>(), versions = new Map<string, any>();
  const patches: Array<Record<string, unknown>> = [];
  const repository: ContentRepository = {
    async getScope(key) { return key === scopeKey ? { key, organizationKey } : null; },
    async role(key) { return key === scopeKey ? role : null; },
    async allowedScopeKeys() { return [scopeKey]; },
    async getFolder(key) { return folders.get(key) ?? null; },
    async listFolders(key) { return [...folders.values()].filter((value) => value.scopeKey === key); },
    async insertFolder(value) { const folder = { ...value, embedding }; folders.set(folder.key, folder); return folder; },
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
    async semanticSearch() { return [...documents.values()].map((document) => ({ score: 0.8, document })); },
    async semanticSearchFolders() { return [...folders.values()].map((folder) => ({ score: 0.8, folder })); },
    async transaction(operation) { return operation(repository); },
  };
  const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: membershipKey, organizationId: organizationKey, status: 'active', orgRole: role } } } as any;
  const folderKey = newId(); folders.set(folderKey, { key: folderKey, scopeKey, name: 'Root', embedding, createdAt: now, updatedAt: now });
  const addDocument = (content = 'First sentence. Second sentence.') => { const key = newId(); documents.set(key, { key, scopeKey, folderKey, name: 'Notes', extension: 'txt', mimeType: 'text/plain', sizeBytes: content.length, storageKey: `docs/${key}`, html: `<p>${content}</p>`, content, embedding, isFavorite: false, createdAt: now, updatedAt: now }); return key; };
  return { repository, context, folders, documents, shares, versions, patches, scopeKey, folderKey, addDocument };
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
        if (action === 'document-generate-html') return documentGenerateHtml(actionInput);
        if (action === 'document-generate-content') return documentGenerateContent(actionInput);
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
    expect(stored.html).toContain('Total: $42.00');
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

  test('projects native document blocks only when requested', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument();
    f.documents.get(documentKey).html = '<h1><strong>Preview</strong></h1><p>Native body</p>';
    const projected = await runContentTool('document.find', { documentKeys: [documentKey], include: ['blocks'] }, f.context, { repository: f.repository });
    expect(projected.results[0]).toMatchObject({ success: true, data: { document: { blocks: [
      { type: 'heading', level: 1, content: [{ text: 'Preview', bold: true }] },
      { type: 'paragraph', content: [{ text: 'Native body' }] },
    ] } } });
    const summary = await runContentTool('document.find', { documentKeys: [documentKey] }, f.context, { repository: f.repository });
    expect(summary.results[0]?.data?.document).not.toHaveProperty('blocks');
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
    const f = fixture('viewer');
    const documentKey = f.addDocument(`0123456789Visible sentence. ${'More words. '.repeat(30)} \`secret code\``);
    const spoken: string[] = [], uploaded: string[] = [];
    const dependencies: any = { repository: f.repository, maxSpeechChunkCharacters: 200, runAction: async (action: string, input: any) => { expect(action).toBe('speak'); const parsed = speechInputSchema.parse(input); expect(parsed).toMatchObject({ language: 'English', speakingRate: 1.25, format: 'wav' }); spoken.push(parsed.text); return { audioBase64: Buffer.from([spoken.length]).toString('base64'), mimeType: 'audio/ogg', durationMs: 10 }; }, storage: { async upload(input: any) { uploaded.push(input.key); return { storageKey: input.key }; }, async delete() {}, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } } };
    const ephemeral = await runContentTool('document.read', { documentKeys: [documentKey], mode: 'audio', startOffset: 10, includeTitle: true, language: 'English', speakingRate: 1.25 }, f.context, dependencies);
    const audio = (ephemeral.results[0]?.data as { audio: Array<{ index: number; url: string; startCharacter: number; endCharacter: number }> }).audio;
    expect(audio.map((item) => item.index)).toEqual([...spoken.keys()]);
    expect(audio.every((item) => item.url.startsWith('data:audio/ogg;base64,'))).toBe(true);
    expect(audio.every((item) => item.startCharacter >= 10 && item.endCharacter > item.startCharacter)).toBe(true);
    expect(spoken[0]).toStartWith('Notes. Visible sentence.');
    expect(spoken.join(' ')).not.toContain('secret code');
    expect(uploaded).toHaveLength(0);
    await runContentTool('document.read', { documentKeys: [documentKey], mode: 'audio', startOffset: 10, includeCode: false, persistAudio: true, language: 'English', speakingRate: 1.25 }, f.context, dependencies);
    expect(uploaded.length).toBeGreaterThan(0);
    expect(uploaded.every((key) => key.endsWith('.ogg'))).toBe(true);
    expect(f.documents.get(documentKey).speechStorageKeys).toEqual(uploaded);
  });

  test('cleans persisted audio chunks when a later speech chunk fails', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument('Long sentence. '.repeat(80));
    const uploaded: string[] = [], deleted: string[] = [];
    let calls = 0;
    const output = await runContentTool('document.read', { documentKeys: [documentKey], mode: 'audio', persistAudio: true }, f.context, {
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
    f.repository.semanticSearch = async (input) => { authorized = input.authorizedScopeKeys; return [...f.documents.values()].map((document) => ({ score: 0.8, document, matchedContent: 'Matched passage later in the document.' })); };
    const output = await runContentTool('scope.document.search', { scopeKey: f.scopeKey, query: 'roadmap', include: ['snippet'] }, f.context, { repository: f.repository, embed: async () => embedding });
    expect(authorized).toEqual([f.scopeKey]); expect(output.results[0]).toMatchObject({ score: 0.8, snippet: 'Matched passage later in the document.' });
    await expect(runContentTool('scope.document.search', { scopeKey: f.scopeKey, query: 'roadmap', sources: [{ type: 'project', projectKeys: [newId()] }] }, f.context, { repository: f.repository, embed: async () => embedding })).rejects.toMatchObject({ code: 'CONTENT_SEARCH_INVALID_SOURCE' });
  });

  test('returns fast lexical folder matches when query embedding is unavailable', async () => {
    const f = fixture('viewer');
    const documentKey = f.addDocument('Quasar timeline velocity roadmap');
    f.repository.semanticSearch = async () => { throw new Error('semantic search should not run'); };
    const output = await runContentTool('scope.document.search', {
      scopeKey: f.scopeKey,
      query: 'quasar',
      sources: [{ type: 'folder', folderKeys: [f.folderKey], includeDescendants: true }],
    }, f.context, { repository: f.repository, embed: async () => { throw new Error('provider unavailable'); } });
    expect(output.results).toHaveLength(1);
    expect(output.results[0]).toMatchObject({ documentKey, matchedSource: { type: 'folder', key: f.folderKey } });
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

  test('runs real representation actions in canonical order before document update', async () => {
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
    expect(actions).toEqual(['document-generate-html', 'document-generate-content', 'document-embed']);
    expect(f.documents.get(documentKey)).toMatchObject({ html: '<p>New body</p>', content: 'New body', embedding });
  });

  test('creates and autosaves live documents without versions', async () => {
    const f = fixture('moderator');
    const dependencies = { repository: f.repository, embed: async () => embedding, ingestion: { embeddingDimensions: EMBEDDING_DIMENSIONS } };
    const created = await runContentTool('document.create', { scopeKey: f.scopeKey, folderKey: f.folderKey, name: 'Plan', representation: { content: 'Initial plan' } }, f.context, dependencies);
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
      let output: { embedding: number[] } | { text: string } = { text: 'continued words' };
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
    expect((await runContentTool('document.create', { scopeKey: f.scopeKey, name: 'Routed note', representation: { content: 'Routed body' } }, f.context, dependencies)).document.name).toBe('Routed note');
    expect((await runContentTool('autocomplete', { context: 'Continue this', wordCount: 3 }, f.context, dependencies)).completion).toBe('continued words');
    expect(calls.map(({ actionSlug }) => actionSlug)).toEqual(['embed', 'embed', 'ask']);
    expect(calls.filter(({ actionSlug }) => actionSlug === 'embed').every(({ input }) => typeof (input as { text?: unknown }).text === 'string')).toBe(true);
    expect(() => chatInputSchema.parse(calls.at(-1)?.input)).not.toThrow();

    calls.length = 0;
    nextEmbedding = 0;
    maximumActiveEmbeddings = 0;
    const longContent = Array.from({ length: 10_500 }, () => 'word').join(' ');
    const created = await runContentTool('document.create', { scopeKey: f.scopeKey, name: 'Chunked note', representation: { content: longContent } }, f.context, dependencies);
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
    f.repository.semanticSearchFolders = async () => [...f.folders.values()].map((folder, index) => ({ score: index === 0 ? 0.54 : 0.9, folder }));
    f.repository.semanticSearch = async (input) => [...f.documents.values()].filter((document) => !input.folderKeys || input.folderKeys.includes(document.folderKey)).map((document, index) => ({ score: index === 0 ? 0.54 : 0.9, document }));
    const searchQueries = {
      async get({ actorKey, scopeKey, normalizedQuery, folderKey, includeDescendants }: any) { return rows.get(`${actorKey}:${scopeKey}:${normalizedQuery}:${folderKey ?? 'root'}:${includeDescendants}`) ?? null; },
      async record(value: any) { const identity = `${value.actorKey}:${value.scopeKey}:${value.normalizedQuery}:${value.folderKey ?? 'root'}:${value.includeDescendants}`; const old = rows.get(identity); rows.set(identity, { output: value.output, query: value.query, normalizedQuery: value.normalizedQuery, folderKey: value.folderKey, includeDescendants: value.includeDescendants, searchedAt: value.now, count: (old?.count ?? 0) + 1 }); },
      async list({ actorKey, scopeKey, folderKey, includeDescendants, limit }: any) { return [...rows.entries()].filter(([key]) => key.startsWith(`${actorKey}:${scopeKey}:`)).map(([, value]) => value).filter((value) => value.folderKey === folderKey && value.includeDescendants === includeDescendants).map((value) => ({ query: value.query, normalizedQuery: value.normalizedQuery, searchedAt: value.searchedAt, count: value.count, ...(value.folderKey ? { folderKey: value.folderKey, includeDescendants: value.includeDescendants } : {}), documents: value.output.result.documents })).slice(0, limit); },
    };
    const dependencies: any = {
      repository: f.repository,
      searchQueries,
      clock: () => clock,
      embed: async () => { embeddingCalls += 1; return embedding; },
      runAction: async (action: string, input: any) => { summaryCalls += 1; expect(action).toBe('reason'); const parsed = chatInputSchema.parse(input); const text = parsed.messages[0]?.content[0]?.type === 'text' ? parsed.messages[0].content[0].text : ''; expect(text).toContain('Launch Roadmap'); return { text: 'Relevant to Launch Roadmap' }; },
    };
    const first = await runContentTool('scope.content.search', { scopeKey: f.scopeKey, query: 'Launch Roadmap' }, f.context, dependencies);
    expect(first.folders).toEqual([]);
    expect(first.documents).toHaveLength(10);
    expect(first.documents.every((item) => item.score >= 0.55 && item.summary.includes('Launch Roadmap'))).toBe(true);
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
    expect(history.history).toMatchObject([{ normalizedQuery: 'launch roadmap', count: 3 }]);
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
    expect(folderReplay.folders).toEqual([]);
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
    allowed = false;
    await expect(runContentTool('scope.content.search', { scopeKey: f.scopeKey, query: 'launch roadmap' }, f.context, dependencies)).rejects.toMatchObject({ code: 'CONTENT_FORBIDDEN' });
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

    const legacyVersion = await f.repository.createVersion({ scopeKey: f.scopeKey, documentKey, html: '<p>Historical exact body</p>', content: 'Historical exact body', embedding });
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
        if (action === 'document-generate-html') return documentGenerateHtml(input);
        if (action === 'document-generate-content') return documentGenerateContent(input);
        if (action === 'document-embed') return documentEmbed(input, { embed: async ({ text }) => { embeddedTexts.push(text); return embedding; }, dimensions: EMBEDDING_DIMENSIONS });
        throw new Error(`Unexpected action ${action}`);
      },
    });
    expect(generated.results[0]?.success).toBe(true);
    expect([...f.versions.values()].at(-1)?.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  test('keeps folders without favorites and resets copied documents to not favorite', async () => {
    const f = fixture('moderator');
    const created = await runContentTool('folder.create', { folders: [{ scopeKey: f.scopeKey, name: 'Default' }] }, f.context, { repository: f.repository, embed: async () => embedding });
    expect(created.results[0]?.data?.folder).not.toHaveProperty('isFavorite');

    const documentKey = f.addDocument('Source');
    f.documents.get(documentKey).isFavorite = true;
    const copied = await runContentTool('document.copy', {
      copies: [{ documentKey, targetScopeKey: f.scopeKey, targetFolderKey: f.folderKey }],
    }, f.context, { repository: f.repository, embed: async () => embedding, storage: { async upload() { return { storageKey: '' }; }, async download() { return { bytes: new Uint8Array() }; }, async copy(input) { return { storageKey: input.destinationKey }; }, async delete() {} } });
    expect(copied.results[0]?.data?.document.isFavorite).toBe(false);
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

  test('sanitizes HTML updates and persists canonical agreeing representations', async () => {
    const f = fixture('moderator');
    const documentKey = f.addDocument('Old body');
    const output = await runContentTool('document.update', {
      updates: [{ documentKey, html: '<p onclick="steal()">Safe <span>text</span></p><script>alert(1)</script><custom>drop</custom>', isFavorite: true }],
    }, f.context, { repository: f.repository, embed: async () => embedding, ingestion: { embeddingDimensions: EMBEDDING_DIMENSIONS } });
    expect(output.results[0]?.success).toBe(true);
    const stored = f.documents.get(documentKey);
    expect(stored.html).toBe('<p>Safe text</p>drop');
    expect(stored.content).toBe('Safe text\n\ndrop');
    expect(stored.isFavorite).toBe(true);
    expect(stored).not.toHaveProperty('json');
    expect(stored.html).not.toContain('onclick');
    expect(stored.html).not.toContain('custom');

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
        if (action === 'document-generate-html') return documentGenerateHtml(input as never);
        if (action === 'document-generate-content') return documentGenerateContent(input as never);
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

  test('sends summaries and rewrites through provider-valid chat action inputs', async () => {
    const f = fixture('viewer');
    const first = f.addDocument('First source body');
    const second = f.addDocument('Second source body');
    const actions: string[] = [];
    const runAction = async (action: string, input: Record<string, unknown>) => {
      actions.push(action);
      const parsed = chatInputSchema.parse(input);
      expect(parsed.systemPrompt).toBeString();
      expect(parsed.messages[0]?.content[0]).toMatchObject({ type: 'text' });
      return { text: 'Generated text' };
    };
    const dependencies = { repository: f.repository, runAction };
    expect((await runContentTool('document.summarize', { documentKeys: [first] }, f.context, dependencies)).results[0]?.success).toBe(true);
    expect((await runContentTool('document.summarize', { documentKeys: [first, second], combine: true }, f.context, dependencies)).summary.failed).toBe(0);
    expect((await runContentTool('document.rewrite', { rewrites: [{ documentKey: first, instruction: 'Improve clarity' }] }, f.context, dependencies)).results[0]?.success).toBe(true);
    expect(actions).toEqual(['reason', 'deep-reason', 'deep-reason']);
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
    await expect(runContentTool('document.export', { exports: [{ documentKey: first, format: 'html' }, { documentKey: second, format: 'html' }], atomic: true }, f.context, { repository: f.repository, generateExport })).rejects.toMatchObject({ action: 'export', resourceKey: second });
    calls = 0;
    const output = await runContentTool('document.export', { exports: [{ documentKey: first, format: 'html' }, { documentKey: second, format: 'html' }], atomic: true }, f.context, { repository: f.repository, generateExport: async () => ({ bytes: new Uint8Array([1]), mimeType: 'text/html', extension: 'html' }) });
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
      scopeKey: f.scopeKey, documentKey, html: '<p>old</p>', content: 'old', embedding,
    });
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
    const version = await f.repository.createVersion({ scopeKey: f.scopeKey, documentKey, html: '<p>old</p>', content: 'old', embedding });
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

  test('generates a bounded autocomplete continuation', async () => {
    const f = fixture('viewer');
    let call: { action?: string; input?: any } = {};
    const output = await runContentTool('autocomplete', { context: 'A private opening thought', wordCount: 3 }, f.context, {
      repository: f.repository,
      runAction: async (action, input) => {
        call = { action, input };
        return { text: 'continues with useful detail beyond limit' };
      },
    });
    expect(output).toEqual({ completion: 'continues with useful' });
    expect(call.action).toBe('ask');
    expect(call.input.systemPrompt).toContain('vivid, specific, or subtly unexpected');
    expect(call.input.options).toMatchObject({ temperature: 0.7, maxTokens: 16 });
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
          if (action === 'ask' || action === 'enhance' || action === 'translate' || action === 'reason' || action === 'deep-reason') return { text: 'Generated text' };
          if (action === 'speak') return { audio: new Uint8Array([1]), mimeType: 'audio/mpeg' };
          if (action === 'document-generate-html') return documentGenerateHtml(input);
          if (action === 'document-generate-content') return documentGenerateContent(input);
          if (action === 'document-embed') return documentEmbed(input, { embed: async () => embedding, dimensions: EMBEDDING_DIMENSIONS });
          throw new Error(`Unexpected action ${action}`);
        },
        searchQueries: {
          async get({ actorKey, scopeKey, normalizedQuery }: any) { return searchRows.get(`${actorKey}:${scopeKey}:${normalizedQuery}`) ?? null; },
          async record(value: any) { const identity = `${value.actorKey}:${value.scopeKey}:${value.normalizedQuery}`; const old = searchRows.get(identity); searchRows.set(identity, { output: value.output, query: value.query, normalizedQuery: value.normalizedQuery, searchedAt: value.now, count: (old?.count ?? 0) + 1 }); },
          async list({ actorKey, scopeKey, limit }: any) { return [...searchRows.entries()].filter(([key]) => key.startsWith(`${actorKey}:${scopeKey}:`)).map(([, value]) => ({ query: value.query, normalizedQuery: value.normalizedQuery, searchedAt: value.searchedAt, count: value.count })).slice(0, limit); },
        },
      };
      let input: any;
       if (name === 'autocomplete') input = { context: 'Continue this note', wordCount: 4 };
       else if (name === 'enhance') input = { content: 'Improve teh wording.' };
       else if (name === 'book.create-context') input = { scopeKey: f.scopeKey, topic: 'Useful systems', goal: 'Build a durable practice', audience: 'Curious beginners', tone: 'Warm and direct', length: 'short', language: 'English' };
       else if (name === 'book.write') input = { bookKey: newId(), scopeKey: f.scopeKey, topic: 'Useful systems', goal: 'Build a durable practice', audience: 'Curious beginners', tone: 'Warm and direct', length: 'short', language: 'English' };
      else if (name === 'folder.create') input = { folders: [{ scopeKey: f.scopeKey, name: 'Created' }] };
      else if (name === 'folder.find') input = { folderKeys: [f.folderKey] };
      else if (name === 'folder.list') input = { scopeKey: f.scopeKey, parentFolderKey: f.folderKey };
      else if (name === 'folder.update') input = { updates: [{ folderKey: childKey, description: 'Updated' }] };
      else if (name === 'folder.rename') input = { renames: [{ folderKey: childKey, name: 'Renamed' }] };
      else if (name === 'folder.move') input = { moves: [{ folderKey: childKey, targetParentFolderKey: siblingKey }] };
      else if (name === 'folder.archive') input = { folderKeys: [childKey] };
      else if (name === 'folder.restore') { f.folders.get(childKey).deletedAt = now; input = { folderKeys: [childKey] }; }
      else if (name === 'folder.delete') { f.folders.get(childKey).deletedAt = now; input = { folderKeys: [childKey] }; }
      else if (name === 'document.parse') input = { file: { filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 4, bytes: new Uint8Array([1, 2, 3, 4]) }, scopeKey: f.scopeKey, folderKey: f.folderKey };
      else if (name === 'document.scan') input = { pages: [{ filename: 'page.jpg', mimeType: 'image/jpeg', sizeBytes: 4, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }], scopeKey: f.scopeKey, folderKey: f.folderKey };
      else if (name === 'document.create') input = { scopeKey: f.scopeKey, folderKey: f.folderKey, name: 'Created document', representation: { content: 'Created body' } };
      else if (name === 'document.find') input = { documentKeys: [documentKey], include: ['content'] };
      else if (name === 'document.list') input = { scopeKey: f.scopeKey, folderKey: f.folderKey };
      else if (name === 'document.read') input = { documentKeys: [documentKey], mode: 'content' };
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
        const version = await f.repository.createVersion({ scopeKey: f.scopeKey, documentKey, html: current.html, content: current.content, embedding: current.embedding });
        if (name === 'document.find-version') input = { versionKeys: [version.key] };
        else if (name === 'document.list-versions') input = { documentKeys: [documentKey] };
        else if (name === 'document.restore-version') input = { restores: [{ documentKey, versionKey: version.key }] };
        else { current.deletedAt = now; input = { versionKeys: [version.key] }; }
      } else if (name === 'document.summarize') input = { documentKeys: [documentKey] };
      else if (name === 'document.translate') input = { documentKeys: [documentKey], targetLanguage: 'French' };
      else if (name === 'document.rewrite') input = { rewrites: [{ documentKey, instruction: 'Improve clarity' }] };
      else if (name === 'scope.document.search') input = { scopeKey: f.scopeKey, query: 'source' };
      else if (name === 'scope.content.search') input = { scopeKey: f.scopeKey, query: 'source' };
      else if (name === 'scope.content.search-history') input = { scopeKey: f.scopeKey };
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

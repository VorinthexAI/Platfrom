import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { createInitialWorkspaceContentService, initialWorkspaceBookRecords, INITIAL_WORKSPACE_CONTENT_VERSION, INITIAL_WORKSPACE_DOCUMENTS, INITIAL_WORKSPACE_FOLDERS } from './initial-workspace-content';
import { INITIAL_WORKSPACE_DOCUMENT_IDS, INITIAL_WORKSPACE_FOLDER_IDS, initialWorkspaceBookKey, isInitialWorkspaceDocumentKey, isInitialWorkspaceFolderKey } from './initial-workspace-content-identifiers';
import { INITIAL_AUDIOBOOK_CHAPTER_GUIDE_IDS } from './initial-audiobook-assets';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';

describe('initial workspace content', () => {
  test('defines one connected guide tree with concise documents', () => {
    expect(INITIAL_WORKSPACE_FOLDERS.map(({ name }) => name)).toEqual(['Vorinthex AI', 'Core', 'Archive', 'Gallery', 'Signal', 'Compass', 'Ascend']);
    expect(INITIAL_WORKSPACE_FOLDERS.map(({ presentation }) => presentation)).toEqual(['platform', 'assistant', 'knowledge', 'media', 'communication', 'travel', 'learning']);
    expect(INITIAL_WORKSPACE_FOLDERS.map(({ id }) => id)).toEqual([...INITIAL_WORKSPACE_FOLDER_IDS]);
    expect(INITIAL_WORKSPACE_DOCUMENTS).toHaveLength(21);
    expect(INITIAL_WORKSPACE_DOCUMENTS.map(({ id }) => id)).toEqual([...INITIAL_WORKSPACE_DOCUMENT_IDS]);
    for (const document of INITIAL_WORKSPACE_DOCUMENTS) {
      const words = document.content.trim().split(/\s+/).length;
      expect(words).toBeGreaterThanOrEqual(80);
      expect(words).toBeLessThanOrEqual(125);
      expect(document.content.split('\n\n')).toHaveLength(3);
      expect(document.content).not.toMatch(/[-\u2010-\u2015\u2212]/u);
      expect(document.content).not.toMatch(/\bVorinthex\b(?!\s+AI\b)/i);
      expect(document.content).not.toMatch(/Core can (?:change|create|draft|manage|move|organize|prepare|send|write)/i);
    }
    const welcome = INITIAL_WORKSPACE_DOCUMENTS.find(({ id }) => id === 'platform-welcome')?.content ?? '';
    expect(welcome).toContain('Sparks are your prepaid balance');
    expect(welcome.match(/Sparks?[^\n]*/g)?.join(' ')).not.toMatch(/\d/);
    expect(INITIAL_WORKSPACE_DOCUMENTS.find(({ id }) => id === 'platform-connections')?.content).toContain('Core does not replace each app or make changes on your behalf.');
    expect(INITIAL_WORKSPACE_DOCUMENTS.find(({ id }) => id === 'learning-start')?.content).toContain('using the documents in this guide tree as sources');
    const signalFolder = INITIAL_WORKSPACE_FOLDERS.find(({ id }) => id === 'communication');
    const signalDocuments = INITIAL_WORKSPACE_DOCUMENTS.filter(({ folderId }) => folderId === 'communication');
    expect(INITIAL_WORKSPACE_CONTENT_VERSION).toBe(7);
    expect(signalFolder?.introducedInVersion).toBe(7);
    expect(signalFolder?.description).toContain('private inbox');
    expect(signalDocuments).toHaveLength(3);
    expect(signalDocuments.every(({ introducedInVersion }) => introducedInVersion === 7)).toBe(true);
    expect(signalDocuments.map(({ content }) => content).join(' ')).toContain('communication from Vorinthex AI apps and support');
    expect(signalDocuments.map(({ content }) => content).join(' ')).not.toMatch(/Gmail/i);
  });

  test('prepares the complete immutable file tree once and preserves it after initialization', async () => {
    let initialized = false;
    let embeddingCalls = 0;
    let persisted: { folders: Array<{ value: { key: string; name: string; presentation?: string } & Record<string, unknown> }>; documents: Array<{ value: { key: string } & Record<string, unknown> }>; books: Array<{ introducedInVersion: number; value: { key: string; chapterCount: number } }>; bookChapters: Array<{ value: { title: string; content?: string; audioStorageKey?: string } }> } | undefined;
    const service = createInitialWorkspaceContentService({
      repository: {
        currentVersion: async () => initialized ? 7 : 0,
        publish: async (input) => { persisted = input; initialized = true; return true; },
      },
      embed: async ({ texts }) => { embeddingCalls += 1; return texts.map(() => Array(EMBEDDING_DIMENSIONS).fill(0)); },
      now: () => new Date('2026-09-09T00:00:00.000Z'),
    });

    expect(await service.ensure(scopeKey)).toBe(true);
    expect(await service.ensure(scopeKey)).toBe(false);
    expect(embeddingCalls).toBe(1);
    expect(persisted?.folders).toHaveLength(7);
    expect(persisted?.documents).toHaveLength(21);
    expect(persisted?.folders[0]?.value.name).toBe('Vorinthex AI');
    expect(persisted?.folders.map(({ value }) => value.presentation)).toEqual(['platform', 'assistant', 'knowledge', 'media', 'communication', 'travel', 'learning']);
    expect(new Set(persisted?.folders.map(({ value }) => value.key))).toHaveLength(7);
    expect(new Set(persisted?.documents.map(({ value }) => value.key))).toHaveLength(21);
    expect(persisted?.folders.every(({ value }) => isInitialWorkspaceFolderKey(scopeKey, value.key))).toBe(true);
    expect(persisted?.documents.every(({ value }) => isInitialWorkspaceDocumentKey(scopeKey, value.key))).toBe(true);
    expect(persisted?.folders.every(({ value }) => value.mutationPolicy === 'system-container')).toBe(true);
    expect(persisted?.documents.every(({ value }) => value.extension === 'txt' && value.mimeType === 'text/plain' && value.mutationPolicy === 'system-only')).toBe(true);
    expect(persisted?.documents.every(({ value }) => value.storageKey == null && value.sizeBytes == null)).toBe(true);
    expect(persisted?.books).toEqual([{ introducedInVersion: 6, value: expect.objectContaining({ key: initialWorkspaceBookKey(scopeKey), chapterCount: 6 }) }]);
    expect(persisted?.bookChapters).toHaveLength(6);
    const sourceGuides = INITIAL_AUDIOBOOK_CHAPTER_GUIDE_IDS.map((id) => INITIAL_WORKSPACE_DOCUMENTS.find((guide) => guide.id === id)!);
    expect(persisted?.bookChapters.map(({ value }) => [value.title, value.content])).toEqual(sourceGuides.map(({ name, content }) => [name, content]));
    expect(persisted?.bookChapters.every(({ value }) => value.audioStorageKey?.endsWith('.mp3'))).toBe(true);
  });

  test('adds the canonical audio book and refreshed Signal guides when upgrading version 3', async () => {
    let persisted: { folders: unknown[]; documents: unknown[]; books: unknown[]; bookChapters: unknown[] } | undefined;
    let embedded = false;
    const service = createInitialWorkspaceContentService({
      repository: { currentVersion: async () => 3, publish: async (input) => { persisted = input; return true; } },
      embed: async ({ texts }) => { embedded = true; return texts.map(() => Array(EMBEDDING_DIMENSIONS).fill(0)); },
    });
    expect(await service.ensure(scopeKey)).toBe(true);
    expect(embedded).toBe(true);
    expect(persisted?.folders).toHaveLength(1);
    expect(persisted?.documents).toHaveLength(3);
    expect(persisted?.books).toHaveLength(1);
    expect(persisted?.bookChapters).toHaveLength(6);
  });

  test('publishes only refreshed Signal guides when upgrading version 6', async () => {
    let persisted: { folders: Array<{ value: { name: string } }>; documents: Array<{ value: { name: string; content?: string } }>; books: unknown[]; bookChapters: unknown[] } | undefined;
    const service = createInitialWorkspaceContentService({
      repository: { currentVersion: async () => 6, publish: async (input) => { persisted = input; return true; } },
      embed: async ({ texts }) => texts.map(() => Array(EMBEDDING_DIMENSIONS).fill(0)),
    });

    expect(await service.ensure(scopeKey)).toBe(true);
    expect(persisted?.folders.map(({ value }) => value.name)).toEqual(['Signal']);
    expect(persisted?.documents.map(({ value }) => value.name)).toEqual(['What Signal Is', 'Why We Built Signal', 'Your First Steps in Signal']);
    expect(persisted?.documents[0]?.value.content).toContain('communication from Vorinthex AI apps and support');
    expect(persisted?.books).toEqual([]);
    expect(persisted?.bookChapters).toEqual([]);
  });

  test('builds six deterministic chapters from the exact overview guide text', () => {
    const first = initialWorkspaceBookRecords(scopeKey, '2026-09-09T00:00:00.000Z');
    const second = initialWorkspaceBookRecords(scopeKey, '2026-09-09T00:00:00.000Z');
    expect(second).toEqual(first);
    expect(first.book).toMatchObject({ title: 'Vorinthex AI', chapterCount: 6, status: 'ready', generationStage: 'complete' });
    expect(first.bookChapters.map(({ content }) => content)).toEqual(INITIAL_AUDIOBOOK_CHAPTER_GUIDE_IDS.map((id) => INITIAL_WORKSPACE_DOCUMENTS.find((guide) => guide.id === id)!.content));
    expect(first.bookChapters[3]?.content).toContain('communication from Vorinthex AI apps and support');
  });

  test('reconciles every definition when upgrading editable guides to immutable files', async () => {
    let persisted: { folders: Array<{ value: { name: string } }>; documents: Array<{ value: { name: string } }> } | undefined;
    const service = createInitialWorkspaceContentService({
      repository: { currentVersion: async () => 1, publish: async (input) => { persisted = input; return true; } },
      embed: async ({ texts }) => texts.map(() => Array(EMBEDDING_DIMENSIONS).fill(0)),
    });

    expect(await service.ensure(scopeKey)).toBe(true);
    expect(persisted?.folders).toHaveLength(7);
    expect(persisted?.documents).toHaveLength(21);
    const repositorySource = await Bun.file(new URL('./initial-workspace-content-repository.ts', import.meta.url)).text();
    expect(repositorySource).toContain('FILTER item.introducedInVersion > previousVersion');
    expect(repositorySource).toContain('UPDATE MERGE(UNSET(item.value');
    expect(repositorySource).toContain('currentVersionKey: null');
  });

  test('does not publish when the current guide version is present', async () => {
    let embedded = false;
    const service = createInitialWorkspaceContentService({
      repository: { currentVersion: async () => 7, publish: async () => { throw new Error('current content must not publish'); } },
      embed: async () => { embedded = true; return []; },
    });
    await expect(service.ensure(scopeKey)).resolves.toBe(false);
    expect(embedded).toBe(false);
  });
});

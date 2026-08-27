import { describe, expect, test } from 'bun:test';
import { generatedDocumentBindingSchema } from '@/lib/db/generated-document-bindings.node';
import { createContentPersistence, type ContentQueryExecutor } from '@/lib/db/content-persistence.node';
import { ensureGeneratedDocumentFolders, generatedDocumentFolderKeys } from './folders';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const key = 'cmrnlzf650002qc7k4p5zem5w';
const now = '2026-08-22T12:00:00.000Z';

describe('generated Archive documents', () => {
  test('recreates the ordinary hierarchy idempotently with stable keys', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database = { async query(query: string, bindVars?: Record<string, unknown>) { calls.push({ query, bindVars }); return { async all() { return []; } }; } };
    const first = await ensureGeneratedDocumentFolders(database, scopeKey, now);
    const second = await ensureGeneratedDocumentFolders(database, scopeKey, now);
    expect(first).toEqual(second);
    expect(first).toEqual({ rootKey: expect.stringMatching(/^c[a-f0-9]{24}$/), ...generatedDocumentFolderKeys(scopeKey) });
    expect(calls).toHaveLength(12);
    expect(calls.map(({ bindVars }) => bindVars?.name).slice(0, 6)).toEqual(['Compass', 'Guides', 'Briefs', 'Accommodations', 'Restaurants', 'Activities']);
    expect(calls.every(({ query }) => query.includes('UPSERT { _key: @key }') && query.includes('UPDATE {} IN folders'))).toBe(true);
    expect(calls.every(({ query }) => query.includes('@parentFolderKey == null ? {} : { parentFolderKey: @parentFolderKey }'))).toBe(true);
    expect(calls.every(({ query, bindVars }) => !query.includes('purpose') && !query.includes('managedPurpose') && !query.includes('mutationPolicy') && !Object.prototype.hasOwnProperty.call(bindVars ?? {}, 'purpose'))).toBe(true);
    expect(calls.every(({ bindVars }) => !Object.prototype.hasOwnProperty.call(bindVars ?? {}, 'legacyFields'))).toBe(true);
  });

  test('keeps the binding strict and product-neutral', () => {
    const binding = generatedDocumentBindingSchema.parse({ key, scopeKey, documentKey: 'cmrnlzf650002qc7k4p5zem5x', subjectType: 'place', subjectKey: key, kind: 'restaurants', provenance: 'generated', createdByKey: key, idempotencyKey: 'request-1', requestHash: 'a'.repeat(64), createdAt: now, updatedAt: now, userKey: key });
    expect(binding.kind).toBe('restaurants');
    expect(generatedDocumentBindingSchema.safeParse({ ...binding, kind: 'report' }).success).toBe(false);
    expect(binding).not.toHaveProperty('userKey');
    expect(binding.documentKey).not.toBe(binding.key);
  });

  test('enforces managed-folder policy in persistence while preserving favorite updates', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const executor: ContentQueryExecutor = { async query(query, bindVars) { calls.push({ query, bindVars }); return { async next() { return undefined; } }; } };
    const persistence = createContentPersistence(executor);
    await persistence.updateFolder(scopeKey, key, { name: 'Renamed', embedding: [] });
    await persistence.updateFolder(scopeKey, key, { isFavorite: true, updatedAt: now });
    await persistence.deleteFolder(scopeKey, key);
    expect(calls[0]?.query).toContain('(current.mutationPolicy != "system-container" && current.managedPurpose == null) || @allowManagedUpdate');
    expect(calls[0]?.bindVars).toMatchObject({ allowManagedUpdate: false });
    expect(calls[1]?.bindVars).toMatchObject({ allowManagedUpdate: true });
    expect(calls[2]?.bindVars).toMatchObject({ protectSystemContainer: true });
  });

  test('keeps Archive placement as a one-way copy while preserving migration and events', async () => {
    const [repository, content, migration, events] = await Promise.all([
      Bun.file(new URL('../travel/repository.ts', import.meta.url)).text(),
      Bun.file(new URL('../ai/tools/content-runtime.ts', import.meta.url)).text(),
      Bun.file(new URL('../../db/arango-migrate.ts', import.meta.url)).text(),
      Bun.file(new URL('../../api/event-contract.ts', import.meta.url)).text(),
    ]);
    expect(repository).toContain('valid.document.folderKey !== expectedFolderKey');
    expect(repository).toContain('copyGeneratedDocument');
    expect(repository).toContain('await ensureGeneratedDocumentFolders(executor');
    expect(repository).toContain("write: ['folders', 'documents', 'generatedDocumentBindings']");
    expect(repository).toContain('INSERT @document UPDATE {} IN documents');
    expect(repository).not.toContain('REMOVE binding IN generatedDocumentBindings');
    expect(repository).not.toContain('REMOVE document IN documents');
    expect(repository).toContain('FOR guide IN tripGuides');
    expect(repository).toContain('FOR reference IN placeReferences');
    expect(content).toContain('await bound.deleteDocument(key)');
    expect(content).toContain('publishPlaceReferenceChange');
    const copySection = content.slice(content.indexOf("tool === 'document.copy'"), content.indexOf("tool === 'document.delete'"));
    expect(copySection).not.toContain('generatedDocumentBindings');
    expect(migration).toContain('content: document.content');
    expect(migration).toContain('IN tripGuides');
    expect(migration).toContain('IN placeReferences');
    expect(migration).not.toContain('await source.drop()');
    expect(events).toContain("'content.changed'");
    expect(events).toContain("'place.reference.changed'");
  });
});

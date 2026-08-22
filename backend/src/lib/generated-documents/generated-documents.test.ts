import { describe, expect, test } from 'bun:test';
import { generatedDocumentBindingSchema } from '@/lib/db/generated-document-bindings.node';
import { createContentPersistence, type ContentQueryExecutor } from '@/lib/db/content-persistence.node';
import { ensureGeneratedDocumentFolders, generatedDocumentFolderKeys } from './folders';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const key = 'cmrnlzf650002qc7k4p5zem5w';
const now = '2026-08-22T12:00:00.000Z';

describe('generated Archive documents', () => {
  test('reconciles the visible managed hierarchy idempotently with stable keys', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database = { async query(query: string, bindVars?: Record<string, unknown>) { calls.push({ query, bindVars }); return { async all() { return []; } }; } };
    const first = await ensureGeneratedDocumentFolders(database, scopeKey, now);
    const second = await ensureGeneratedDocumentFolders(database, scopeKey, now);
    expect(first).toEqual(second);
    expect(first).toEqual({ rootKey: expect.stringMatching(/^c[a-f0-9]{24}$/), ...generatedDocumentFolderKeys(scopeKey) });
    expect(calls).toHaveLength(12);
    expect(calls.map(({ bindVars }) => bindVars?.name).slice(0, 6)).toEqual(['Compass', 'Guides', 'Briefs', 'Accommodations', 'Restaurants', 'Activities']);
    expect(calls.every(({ query }) => query.includes('UPSERT') && query.includes('mutationPolicy: "system-container"'))).toBe(true);
    expect(calls.every(({ query }) => query.includes('@parentFolderKey == null ? {} : { parentFolderKey: @parentFolderKey }'))).toBe(true);
  });

  test('keeps the binding strict and product-neutral', () => {
    const binding = generatedDocumentBindingSchema.parse({ key, scopeKey, documentKey: key, subjectType: 'place', subjectKey: key, kind: 'restaurants', provenance: 'generated', createdByKey: key, idempotencyKey: 'request-1', requestHash: 'a'.repeat(64), createdAt: now, updatedAt: now, userKey: key });
    expect(binding.kind).toBe('restaurants');
    expect(generatedDocumentBindingSchema.safeParse({ ...binding, kind: 'report' }).success).toBe(false);
    expect(binding).not.toHaveProperty('userKey');
  });

  test('enforces managed-folder policy in persistence while preserving favorite updates', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const executor: ContentQueryExecutor = { async query(query, bindVars) { calls.push({ query, bindVars }); return { async next() { return undefined; } }; } };
    const persistence = createContentPersistence(executor);
    await persistence.updateFolder(scopeKey, key, { name: 'Renamed', embedding: [] });
    await persistence.updateFolder(scopeKey, key, { isFavorite: true, updatedAt: now });
    await persistence.deleteFolder(scopeKey, key);
    expect(calls[0]?.query).toContain('current.mutationPolicy != "system-container" || @allowSystemContainerUpdate');
    expect(calls[0]?.bindVars).toMatchObject({ allowSystemContainerUpdate: false });
    expect(calls[1]?.bindVars).toMatchObject({ allowSystemContainerUpdate: true });
    expect(calls[2]?.bindVars).toMatchObject({ protectSystemContainer: true });
  });

  test('keeps placement, cleanup, parent preservation, migration, and events canonical', async () => {
    const [repository, content, migration, events] = await Promise.all([
      Bun.file(new URL('../travel/repository.ts', import.meta.url)).text(),
      Bun.file(new URL('../ai/tools/content-runtime.ts', import.meta.url)).text(),
      Bun.file(new URL('../../db/arango-migrate.ts', import.meta.url)).text(),
      Bun.file(new URL('../../api/event-contract.ts', import.meta.url)).text(),
    ]);
    expect(repository).toContain('document.folderKey == expectedFolderKey');
    expect(repository).toContain('REMOVE binding IN generatedDocumentBindings');
    expect(repository).not.toContain('REMOVE document IN documents');
    expect(content).toContain('await bound.deleteDocument(key)');
    expect(content).toContain('publishPlaceReferenceChange');
    const copySection = content.slice(content.indexOf("tool === 'document.copy'"), content.indexOf("tool === 'document.delete'"));
    expect(copySection).not.toContain('generatedDocumentBindings');
    expect(migration).toContain('content: legacy.summary');
    expect(migration).toContain('createdAt: legacy.createdAt, updatedAt: legacy.createdAt');
    expect(migration).toContain('await source.drop()');
    expect(migration.indexOf('await migrateContentDocuments(targetDb);', migration.indexOf('export async function migrateGeneratedTravelDocuments'))).toBeLessThan(migration.indexOf('\n}', migration.indexOf('export async function migrateGeneratedTravelDocuments')));
    expect(events).toContain("'content.changed'");
    expect(events).toContain("'place.reference.changed'");
  });
});

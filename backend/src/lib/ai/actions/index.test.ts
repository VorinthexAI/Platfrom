import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTION_DEFINITIONS, ACTION_SLUGS, assertActionRegistryIntegrity, createDataActions, isValidActionIdFormat } from './index';

describe('action registry', () => {
  test('passes the full integrity check', () => {
    expect(() => assertActionRegistryIntegrity()).not.toThrow();
  });

  test('has no duplicate action ids', () => {
    expect(new Set(ACTION_SLUGS).size).toBe(ACTION_SLUGS.length);
    expect(ACTION_DEFINITIONS.map(({ id }) => id)).toEqual([...ACTION_SLUGS]);
    expect(ACTION_DEFINITIONS.filter(({ modelPolicy, models }) => modelPolicy === 'none' && models.length > 0)).toEqual([]);
    expect(ACTION_DEFINITIONS.filter(({ modelPolicy, models }) => modelPolicy === 'required' && models.length === 0)).toEqual([]);
  });

  test('contains only generic runtime primitives with explicit model policies', () => {
    expect(ACTION_SLUGS).toEqual([
      'ask', 'embed', 'web-search',
      'traverse', 'read', 'insert', 'upsert', 'update', 'delete',
      'generate-image', 'edit-image', 'generate-video', 'edit-video', 'extend-video', 'analyze-video',
      'analyze-audio', 'generate-music',
      'document-validate', 'storage-upload', 'document-extract', 'document-embed', 'document-insert', 'caption-image', 'describe-visual-identity',
    ]);
    expect(ACTION_DEFINITIONS.filter((action) => action.modelPolicy === 'none').map((action) => action.id))
      .toEqual([
        'traverse', 'read', 'insert', 'upsert', 'update', 'delete',
        'document-validate', 'storage-upload', 'document-extract', 'document-embed', 'document-insert',
      ]);
    expect(ACTION_DEFINITIONS.find((action) => action.id === 'ask')?.models)
      .toEqual([
        { provider: 'openrouter', model: 'google.gemini-2.5-flash-lite', priority: 100 },
        { provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 90 },
      ]);
    expect(ACTION_DEFINITIONS.find((action) => action.id === 'caption-image')?.models)
      .toEqual([{ provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 100 }]);
    expect(ACTION_DEFINITIONS.find((action) => action.id === 'describe-visual-identity')?.models)
      .toEqual([{ provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 100 }]);
    expect(ACTION_DEFINITIONS.find((action) => action.id === 'generate-image')?.models)
      .toEqual([
        { provider: 'openrouter', model: 'bfl.flux-2-klein-4b', priority: 100 },
        { provider: 'openai', model: 'openai.gpt-image-2', priority: 90 },
        { provider: 'openrouter', model: 'xai.grok-imagine-image-quality', priority: 80 },
      ]);
    expect(ACTION_DEFINITIONS.find((action) => action.id === 'embed')?.models)
      .toEqual([{ provider: 'openai', model: 'openai.text-embedding-3-small', priority: 100 }]);
  });

  test('delegates generic data primitives to the node helper implementation', async () => {
    const calls: string[] = [];
    const actions = createDataActions<{ key: string; name: string }, { key: string; name: string }, Partial<{ name: string }>>({
      async insert(input) { calls.push('insert'); return input; },
      async getById(key) { calls.push('read'); return { key, name: 'before' }; },
      async updateById(key, patch) { calls.push('update'); return { key, name: patch.name ?? 'before' }; },
      async upsertByKey(input) { calls.push('upsert'); return input; },
      async deleteById() { calls.push('delete'); },
      async *getAllChunked() { calls.push('traverse'); yield [{ key: 'one', name: 'one' }]; },
    });
    await actions.insert({ key: 'one', name: 'one' });
    await actions.read('one');
    await actions.update('one', { name: 'after' });
    await actions.upsert({ key: 'one', name: 'one' });
    await actions.delete('one');
    for await (const _chunk of actions.traverse()) { /* consume */ }
    expect(calls).toEqual(['insert', 'read', 'update', 'upsert', 'delete', 'traverse']);
  });

  test('every id follows lowercase dot notation', () => {
    for (const id of ACTION_SLUGS) {
      expect(isValidActionIdFormat(id)).toBe(true);
    }
  });

  test('rejects malformed ids', () => {
    for (const bad of ['Core', 'Core-chat', 'core.chat', 'core--chat', '-core-chat', 'core_chat!']) {
      expect(isValidActionIdFormat(bad)).toBe(false);
    }
  });

  test('contains no retired core.ask references in production source', () => {
    const sourceRoot = join(import.meta.dir, '..', '..');
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(path);
      }
    };
    visit(sourceRoot);
    // The seed migration is the sole historical-data exception; all runtime
    // paths must stay free of the retired action ID.
    const historicalMigration = join(sourceRoot, 'db', 'seed.ts');
    expect(files.filter((path) => path !== historicalMigration && readFileSync(path, 'utf8').includes('core.ask'))).toEqual([]);
  });

});

import { describe, expect, test } from 'bun:test';
import { createToolEventService, toolEventInputSchema } from './service';
import { addToolTokenUsage, observeToolExecution, runWithEventApp } from './runtime';
import { APP_KEYS } from '@/lib/apps/registry';

describe('tool events', () => {
  test('persists the normalized event fields without an embedding or payload', async () => {
    const inserted: Record<string, unknown>[] = [];
    const service = createToolEventService({
      id: () => 'event-1',
      now: () => '2026-09-02T12:00:00.000Z',
      insert: async (event) => { inserted.push(event); return event as never; },
      appExists: async () => true,
    });
    await service.record({ userId: 'user-1', scopeId: 'scope-1', slug: 'document.summarize', appKey: APP_KEYS.ARCHIVE, sparks: 2, inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(inserted[0]).toEqual({ key: 'event-1', userId: 'user-1', scopeId: 'scope-1', slug: 'document.summarize', appKey: APP_KEYS.ARCHIVE, createdAt: '2026-09-02T12:00:00.000Z', sparks: 2, inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  test('accepts registry-style slugs without maintaining an event allowlist', () => {
    expect(toolEventInputSchema.parse({ userId: null, scopeId: null, slug: 'future-capability.execute', appKey: APP_KEYS.CORE }).slug).toBe('future-capability.execute');
    expect(() => toolEventInputSchema.parse({ userId: null, scopeId: null, slug: 'not dotted', appKey: APP_KEYS.CORE })).toThrow();
    expect(() => toolEventInputSchema.parse({ userId: null, scopeId: null, slug: 'folder.create', appKey: 'unknown' })).toThrow();
  });

  test('records request app and accumulated provider usage after execution', async () => {
    const events: Record<string, unknown>[] = [];
    const recorder = async (event: Record<string, unknown>) => { events.push(event); };
    await runWithEventApp(APP_KEYS.GALLERY, async () => {
      await observeToolExecution('image.generate', undefined, async () => {
        addToolTokenUsage({ inputTokens: 4, outputTokens: 6, totalTokens: 10 });
        return 'ok';
      });
    }, recorder);
    await Promise.resolve();
    expect(events).toEqual([{ userId: null, scopeId: null, slug: 'image.generate', appKey: APP_KEYS.GALLERY, inputTokens: 4, outputTokens: 6, totalTokens: 10 }]);
  });

  test('rejects an unknown app before inserting', async () => {
    let inserts = 0;
    const service = createToolEventService({ appExists: async () => false, insert: async () => { inserts += 1; return {} as never; } });
    await expect(service.record({ userId: null, scopeId: null, slug: 'folder.create', appKey: APP_KEYS.CORE })).rejects.toThrow('was not found');
    expect(inserts).toBe(0);
  });
});

import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { DomainToolContext } from './domain-execute';
import { CONTENT_TOOL_NAMES, domainToolInputSchemas, runTool, TOOL_DEFINITIONS, TOOL_NAMES, toolInputSchemas } from './index';

describe('unified tool registry', () => {
  test('has one unique definition for every public tool name', () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
    expect(new Set(TOOL_DEFINITIONS.map(({ name }) => name)).size).toBe(TOOL_DEFINITIONS.length);
    expect(TOOL_NAMES).toHaveLength(189);
    expect(TOOL_DEFINITIONS).toHaveLength(189);
    expect(TOOL_DEFINITIONS).toHaveLength(CONTENT_TOOL_NAMES.length + 137);
    expect(TOOL_DEFINITIONS.map(({ name }) => name)).toEqual([...TOOL_NAMES]);
    expect(TOOL_NAMES.filter((name) => name === 'chat')).toHaveLength(1);
    expect(TOOL_NAMES).not.toContain('orchestrator.chat');
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'chat')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'transcribe')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'audio.generate')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'document.summary.audio.generate')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.caption')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.create-visual-identity')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.search')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.delete')).toHaveLength(1);
    expect(TOOL_NAMES).not.toContain('collection.duplicates.find');
    expect(TOOL_DEFINITIONS.some(({ name }) => name === 'orchestrator.chat')).toBe(false);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'folder.archive')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'document.restore')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'email.read')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.find(({ name }) => name === 'email.read')?.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(TOOL_NAMES).toContain('folder.create');
    expect(TOOL_NAMES).toContain('folder.copy');
    expect(TOOL_NAMES).toContain('collection.create');
    expect(TOOL_NAMES).toContain('trip.create');
    expect(TOOL_NAMES).toContain('email.draft.send');
    expect(TOOL_NAMES).toContain('book.chapter.progress');
    expect(TOOL_NAMES).toContain('user.settings.read');
    expect(TOOL_NAMES).toContain('user.settings.update');
    expect(TOOL_NAMES.every((name) => !name.includes('_'))).toBe(true);
  });

  test('retains the historical lifecycle batch input for colliding names', () => {
    expect(domainToolInputSchemas['folder.archive'].parse({ items: [{ folderKey: newId() }], atomic: true })).toMatchObject({ atomic: true });
    expect(domainToolInputSchemas['document.restore'].parse({ items: [{ documentKey: newId() }] })).toMatchObject({ atomic: true });
  });

  test('bounds deep email reads across unique threads', () => {
    const first = newId(); const second = newId();
    expect(domainToolInputSchemas['email.read'].parse({ threads: [{ threadKey: first }, { threadKey: second, limit: 30 }] })).toEqual({ threads: [{ threadKey: first, limit: 20 }, { threadKey: second, limit: 30 }] });
    expect(() => domainToolInputSchemas['email.read'].parse({ threads: [{ threadKey: first }, { threadKey: first }] })).toThrow();
    expect(() => domainToolInputSchemas['email.read'].parse({ threads: [{ threadKey: first, limit: 50 }, { threadKey: second, limit: 50 }, { threadKey: newId(), limit: 1 }] })).toThrow();
  });

  test('executes workspace tools with strict input and trusted context', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const membership = { key: newId(), organizationId: organizationKey, userId: newId(), status: 'active' };
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: membership } } as unknown as DomainToolContext;
    const calls: unknown[][] = [];
    const travelService = { createTrip: async (...args: unknown[]) => { calls.push(args); return { key: newId() }; } } as any;

    await expect(runTool('trip.create', '', { name: 'Portugal', scopeKey: newId() }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('trip.create', '', { name: 'Portugal' }, { contentContext, travelService });
    expect(calls).toEqual([[{ organizationKey, scopeKey, name: 'Portugal' }, userKey]]);
    expect(() => toolInputSchemas['collection.create'].parse({ name: 'Favorites', organizationKey })).toThrow('Unrecognized key');
  });

  test('keeps canonical Content mutations in dot notation', async () => {
    expect(TOOL_NAMES.filter((name) => name === 'folder.create')).toHaveLength(1);
    expect(TOOL_NAMES).not.toContain('archive_folder_create');
  });

  test('executes user settings through the injected canonical service', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, status: 'active' } } } as unknown as DomainToolContext;
    const calls: unknown[] = [];
    const userSettingsService = { read: async (key: string) => { calls.push(key); return { archive: { showOnlyFavorites: false } }; } } as any;
    await runTool('user.settings.read', '', {}, { contentContext, userSettingsService });
    expect(calls).toEqual([userKey]);
  });
});

import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { DomainToolContext } from './domain-execute';
import { CONTENT_TOOL_NAMES, domainToolInputSchemas, runTool, TOOL_DEFINITIONS, TOOL_NAMES, toolInputSchemas } from './index';

describe('unified tool registry', () => {
  test('has one unique definition for every public tool name', () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
    expect(new Set(TOOL_DEFINITIONS.map(({ name }) => name)).size).toBe(TOOL_DEFINITIONS.length);
    expect(TOOL_NAMES).toHaveLength(193);
    expect(TOOL_DEFINITIONS).toHaveLength(193);
    expect(TOOL_DEFINITIONS).toHaveLength(CONTENT_TOOL_NAMES.length + 151);
    expect(TOOL_DEFINITIONS.map(({ name }) => name)).toEqual([...TOOL_NAMES]);
    expect(TOOL_NAMES.filter((name) => name === 'chat')).toHaveLength(1);
    expect(TOOL_NAMES).not.toContain('orchestrator.chat');
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'chat')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'transcribe')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.caption')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.create-visual-identity')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.search')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.some(({ name }) => name === 'orchestrator.chat')).toBe(false);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'folder.archive')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'document.restore')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'email.read')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.find(({ name }) => name === 'email.read')?.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(TOOL_NAMES).toContain('archive_folder_create');
    expect(TOOL_NAMES).toContain('gallery_collection_create');
    expect(TOOL_NAMES).toContain('compass_trip_create');
    expect(TOOL_NAMES).toContain('signal_draft_send');
    expect(TOOL_NAMES).toContain('ascend_progress');
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

    await expect(runTool('compass_trip_create', '', { name: 'Portugal', scopeKey: newId() }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('compass_trip_create', '', { name: 'Portugal' }, { contentContext, travelService });
    expect(calls).toEqual([[{ organizationKey, scopeKey, name: 'Portugal' }, userKey]]);
    expect(() => toolInputSchemas.gallery_collection_create.parse({ name: 'Favorites', organizationKey })).toThrow('Unrecognized key');
  });

  test('derives deterministic Archive idempotency for direct registry execution', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: newId(), status: 'active' } } } as unknown as DomainToolContext;
    const calls: unknown[][] = [];
    const executeContent = async (...args: unknown[]) => { calls.push(args); return {}; };
    await runTool('archive_folder_create', '', { name: 'Plans' }, { contentContext, executeWorkspaceContent: executeContent as any });
    await runTool('archive_folder_create', '', { name: 'Plans' }, { contentContext, executeWorkspaceContent: executeContent as any });
    await runTool('archive_folder_create', '', { name: 'Plans' }, { contentContext, requestKey: 'server-request', executeWorkspaceContent: executeContent as any });
    const firstKey = (calls[0]![1] as { idempotencyKey: string }).idempotencyKey;
    expect(firstKey).toMatch(/^[a-f0-9]{64}:archive_folder_create$/);
    expect((calls[1]![1] as { idempotencyKey: string }).idempotencyKey).toBe(firstKey);
    expect(firstKey).not.toContain('undefined:');
    expect((calls[2]![1] as { idempotencyKey: string }).idempotencyKey).toBe('server-request:archive_folder_create');
  });
});

import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { DomainToolContext } from './domain-execute';
import { CONTENT_TOOL_NAMES, domainToolInputSchemas, runTool, TOOL_DEFINITIONS, TOOL_NAMES, toolInputSchemas } from './index';

describe('unified tool registry', () => {
  test('has one unique definition for every public tool name', () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
    expect(new Set(TOOL_DEFINITIONS.map(({ name }) => name)).size).toBe(TOOL_DEFINITIONS.length);
    expect(TOOL_NAMES).toHaveLength(117);
    expect(TOOL_DEFINITIONS).toHaveLength(117);
    expect(TOOL_DEFINITIONS).toHaveLength(CONTENT_TOOL_NAMES.length + 65);
    expect(TOOL_DEFINITIONS.map(({ name }) => name)).toEqual([...TOOL_NAMES]);
    expect(TOOL_NAMES.filter((name) => name === 'chat')).toHaveLength(1);
    expect(TOOL_NAMES).not.toContain('orchestrator.chat');
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'chat')).toHaveLength(1);
    expect(TOOL_NAMES).not.toContain('transcribe');
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
    expect(TOOL_NAMES).not.toContain('email.read');
    expect(TOOL_NAMES).toContain('folder.create');
    expect(TOOL_NAMES).toContain('folder.copy');
    expect(TOOL_NAMES).toContain('collection.create');
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['highlight.create', 'highlight.list', 'highlight.read', 'highlight.delete']));
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['organization.document.search', 'scope.document.search', 'scope.content.search', 'scope.content.search-history', 'scope.content.search-history.delete']));
    expect(TOOL_NAMES).toContain('trip.create');
    expect(TOOL_NAMES).toContain('email.draft.send');
    expect(TOOL_NAMES).toContain('book.chapter.progress');
    expect(TOOL_NAMES).toContain('user.settings.read');
    expect(TOOL_NAMES).toContain('user.settings.update');
    for (const name of ['access.agent.evaluate', 'agent.member.list', 'artifact.create', 'project.create', 'milestone.create', 'task.create', 'organization.member.list', 'scope.list']) expect(TOOL_NAMES).not.toContain(name);
    expect(TOOL_NAMES.every((name) => !name.includes('_'))).toBe(true);
  });

  test('does not expose any removed outside-domain tool', () => {
    const removed = [
      'transcribe', 'email.read',
      'access.agent.evaluate', 'access.agent.explain', 'access.organization.evaluate', 'access.organization.explain', 'access.scope.evaluate', 'access.scope.explain',
      'agent.member.grant', 'agent.member.list', 'agent.member.read', 'agent.member.revoke', 'agent.member.sync',
      'artifact.create',
      'project.archive', 'project.create', 'project.delete', 'project.find', 'project.list', 'project.move', 'project.rename', 'project.restore', 'project.update',
      'milestone.archive', 'milestone.change-status', 'milestone.complete', 'milestone.create', 'milestone.delete', 'milestone.find', 'milestone.list', 'milestone.move', 'milestone.rename', 'milestone.reopen', 'milestone.restore', 'milestone.schedule', 'milestone.update',
      'task.archive', 'task.change-status', 'task.complete', 'task.create', 'task.delete', 'task.find', 'task.list', 'task.move', 'task.reopen', 'task.reorder', 'task.rename', 'task.restore', 'task.rewrite', 'task.summarize', 'task.translate', 'task.update',
      'organization.archive', 'organization.member.activate', 'organization.member.add', 'organization.member.list', 'organization.member.read', 'organization.member.remove', 'organization.member.role.update', 'organization.member.suspend', 'organization.project.search', 'organization.provider.disable', 'organization.provider.enable', 'organization.provider.list', 'organization.provider.read', 'organization.provider.test', 'organization.read', 'organization.restore', 'organization.update',
      'scope.agent.access-threshold.update', 'scope.agent.add', 'scope.agent.archive', 'scope.agent.list', 'scope.agent.move', 'scope.agent.read', 'scope.agent.remove', 'scope.agent.restore', 'scope.archive', 'scope.create', 'scope.list', 'scope.member.activate', 'scope.member.add', 'scope.member.list', 'scope.member.read', 'scope.member.remove', 'scope.member.role.update', 'scope.member.suspend', 'scope.move', 'scope.project.search', 'scope.read', 'scope.remove', 'scope.restore', 'scope.update',
    ];
    expect(removed).toHaveLength(93);
    for (const name of removed) {
      expect(TOOL_NAMES).not.toContain(name);
      expect(toolInputSchemas).not.toHaveProperty(name);
    }
  });

  test('retains the historical lifecycle batch input for colliding names', () => {
    expect(domainToolInputSchemas['folder.archive'].parse({ items: [{ folderKey: newId() }], atomic: true })).toMatchObject({ atomic: true });
    expect(domainToolInputSchemas['document.restore'].parse({ items: [{ documentKey: newId() }] })).toMatchObject({ atomic: true });
  });

  test('omits removed domain schemas', () => {
    for (const name of ['email.read', 'access.scope.explain', 'agent.member.sync', 'artifact.create', 'project.list', 'milestone.list', 'task.list', 'organization.read', 'scope.list']) {
      expect(domainToolInputSchemas).not.toHaveProperty(name);
    }
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

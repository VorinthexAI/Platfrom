import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from './tool-context';
import { CONTENT_TOOL_NAMES, runTool, TOOL_DEFINITIONS, TOOL_NAMES, toolInputSchemas } from './index';

describe('unified tool registry', () => {
  test('has one unique definition for every public tool name', () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
    expect(new Set(TOOL_DEFINITIONS.map(({ name }) => name)).size).toBe(TOOL_DEFINITIONS.length);
    expect(TOOL_NAMES).toHaveLength(110);
    expect(TOOL_DEFINITIONS).toHaveLength(110);
    expect(TOOL_DEFINITIONS).toHaveLength(CONTENT_TOOL_NAMES.length + 65);
    expect(TOOL_DEFINITIONS.map(({ name }) => name)).toEqual([...TOOL_NAMES]);
    expect(TOOL_NAMES).not.toContain('chat');
    expect(TOOL_NAMES).not.toContain('orchestrator.chat');
    expect(TOOL_DEFINITIONS.some(({ name }) => name === 'chat')).toBe(false);
    expect(TOOL_NAMES).not.toContain('transcribe');
    expect(TOOL_NAMES).not.toContain('audio.generate');
    expect(TOOL_NAMES).not.toContain('document.summary.audio.generate');
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.caption')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.create-visual-identity')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.search')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.ideas.create')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.generate')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.delete')).toHaveLength(1);
    expect(TOOL_NAMES).not.toContain('collection.duplicates.find');
    expect(TOOL_DEFINITIONS.some(({ name }) => name === 'orchestrator.chat')).toBe(false);
    expect(TOOL_NAMES).not.toContain('email.read');
    expect(TOOL_NAMES).not.toContain('email.thread.list');
    expect(TOOL_NAMES).not.toContain('email.reply.draft');
    expect(TOOL_NAMES).toContain('folder.create');
    expect(TOOL_NAMES).toContain('folder.copy');
    expect(TOOL_NAMES).toContain('collection.create');
    for (const name of ['image.upload.reserve', 'image.upload.status', 'image.upload.complete']) {
      expect(TOOL_NAMES).not.toContain(name);
      expect(TOOL_DEFINITIONS.some((definition) => definition.name === name)).toBe(false);
      expect(toolInputSchemas).not.toHaveProperty(name);
    }
    expect(TOOL_NAMES.filter((name) => name.startsWith('image.upload.'))).toEqual([]);
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['highlight.create', 'highlight.list', 'highlight.read', 'highlight.delete']));
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['document.search-all', 'document.search', 'content.search', 'content.search-history.list', 'content.search-history.delete']));
    for (const name of ['organization.document.search', 'scope.document.search', 'scope.content.search', 'scope.content.search-history', 'scope.content.search-history.delete']) {
      expect(TOOL_NAMES).not.toContain(name);
      expect(toolInputSchemas).not.toHaveProperty(name);
    }
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['place.list', 'place.find', 'place.create']));
    expect(TOOL_NAMES).not.toContain('place.images.generate');
    for (const name of ['place.visit.create', 'trip.create', 'trip.place.add', 'trip.place.remove']) expect(TOOL_NAMES).not.toContain(name);
    expect(TOOL_NAMES).toContain('email.draft.send');
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['content.hidden.list', 'book.create', 'email.thread.read', 'email.thread.mark-read']));
    expect(TOOL_NAMES).not.toContain('book.create-context');
    expect(TOOL_NAMES).not.toContain('book.write');
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'email.thread.read')).toHaveLength(1);
    expect(TOOL_NAMES).toContain('book.chapter.progress');
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['folder.hide', 'folder.reveal', 'document.hide', 'document.reveal', 'collection.hide', 'collection.reveal', 'image.hide', 'image.reveal']));
    expect(TOOL_NAMES).not.toContain('user.settings.read');
    expect(TOOL_NAMES).not.toContain('user.settings.update');
    for (const name of ['access.agent.evaluate', 'agent.member.list', 'artifact.create', 'project.create', 'milestone.create', 'task.create', 'organization.member.list', 'scope.list']) expect(TOOL_NAMES).not.toContain(name);
    expect(TOOL_NAMES.every((name) => !name.includes('_'))).toBe(true);
  });

  test('does not expose any removed outside-domain tool', () => {
    const removed = [
      'chat', 'transcribe', 'email.read',
      'access.agent.evaluate', 'access.agent.explain', 'access.organization.evaluate', 'access.organization.explain', 'access.scope.evaluate', 'access.scope.explain',
      'agent.member.grant', 'agent.member.list', 'agent.member.read', 'agent.member.revoke', 'agent.member.sync',
      'artifact.create',
      'project.archive', 'project.create', 'project.delete', 'project.find', 'project.list', 'project.move', 'project.rename', 'project.restore', 'project.update',
      'milestone.archive', 'milestone.change-status', 'milestone.complete', 'milestone.create', 'milestone.delete', 'milestone.find', 'milestone.list', 'milestone.move', 'milestone.rename', 'milestone.reopen', 'milestone.restore', 'milestone.schedule', 'milestone.update',
      'task.archive', 'task.change-status', 'task.complete', 'task.create', 'task.delete', 'task.find', 'task.list', 'task.move', 'task.reopen', 'task.reorder', 'task.rename', 'task.restore', 'task.rewrite', 'task.summarize', 'task.translate', 'task.update',
      'organization.archive', 'organization.member.activate', 'organization.member.add', 'organization.member.list', 'organization.member.read', 'organization.member.remove', 'organization.member.role.update', 'organization.member.suspend', 'organization.project.search', 'organization.provider.disable', 'organization.provider.enable', 'organization.provider.list', 'organization.provider.read', 'organization.provider.test', 'organization.read', 'organization.restore', 'organization.update',
      'scope.agent.access-threshold.update', 'scope.agent.add', 'scope.agent.archive', 'scope.agent.list', 'scope.agent.move', 'scope.agent.read', 'scope.agent.remove', 'scope.agent.restore', 'scope.archive', 'scope.create', 'scope.list', 'scope.member.activate', 'scope.member.add', 'scope.member.list', 'scope.member.read', 'scope.member.remove', 'scope.member.role.update', 'scope.member.suspend', 'scope.move', 'scope.project.search', 'scope.read', 'scope.remove', 'scope.restore', 'scope.update',
    ];
    expect(removed).toHaveLength(94);
    for (const name of removed) {
      expect(TOOL_NAMES).not.toContain(name);
      expect(toolInputSchemas).not.toHaveProperty(name);
    }
  });

  test('executes workspace tools with strict input and trusted context', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const membership = { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' };
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: membership } } as unknown as ToolContext;
    const calls: unknown[][] = [];
    const travelService = {
      overview: async (...args: unknown[]) => { calls.push(['overview', ...args]); return { places: [] }; },
      findPlace: async (...args: unknown[]) => { calls.push(['findPlace', ...args]); return {}; },
      createPlace: async (...args: unknown[]) => { calls.push(['createPlace', ...args]); return {}; },
    } as any;

    await expect(runTool('place.list', '', { scopeKey: newId() }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('place.list', '', {}, { contentContext, travelService });
    await runTool('place.find', '', { query: 'Reykjavik' }, { contentContext, travelService });
    await expect(runTool('place.create', '', { name: 'Iceland', countryCode: 'IS', latitude: 65, longitude: -18, scopeKey }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('place.create', '', { name: 'Iceland', countryCode: 'IS', latitude: 65, longitude: -18 }, { contentContext, travelService });
    expect(calls).toEqual([
      ['overview', { organizationKey, scopeKey }, userKey],
      ['findPlace', { organizationKey, scopeKey, query: 'Reykjavik' }, userKey, { signal: undefined }],
      ['createPlace', { organizationKey, scopeKey, name: 'Iceland', countryCode: 'IS', latitude: 65, longitude: -18 }, userKey, { signal: undefined, timeoutMs: undefined }],
    ]);
    expect(() => toolInputSchemas['collection.create'].parse({ name: 'Favorites', organizationKey })).toThrow('Unrecognized key');
  });

  test('injects trusted Content scope and organization into public tools', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const calls: unknown[][] = [];
    const executeWorkspaceContent = async (...args: unknown[]) => { calls.push(args); return {}; };

    await expect(runTool('folder.list', '', { scopeKey: newId() }, { contentContext, executeWorkspaceContent: executeWorkspaceContent as any })).rejects.toThrow('Unrecognized key');
    await expect(runTool('document.search-all', '', { organizationKey: newId(), query: 'roadmap' }, { contentContext, executeWorkspaceContent: executeWorkspaceContent as any })).rejects.toThrow('Unrecognized key');
    await runTool('folder.list', '', {}, { contentContext, executeWorkspaceContent: executeWorkspaceContent as any });
    await runTool('folder.create', '', { folders: [{ name: 'Plans' }] }, { contentContext, executeWorkspaceContent: executeWorkspaceContent as any });
    await runTool('document.search-all', '', { query: 'roadmap' }, { contentContext, executeWorkspaceContent: executeWorkspaceContent as any });

    expect(calls).toEqual([
      ['folder.list', { scopeKey }, contentContext, expect.any(Object)],
      ['folder.create', { folders: [{ scopeKey, name: 'Plans' }] }, contentContext, expect.any(Object)],
      ['document.search-all', { organizationKey, query: 'roadmap' }, contentContext, expect.any(Object)],
    ]);
  });

  test('executes the one public image.search through the canonical Gallery operation', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const membership = { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' };
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: membership } } as unknown as ToolContext;
    const calls: unknown[][] = [];
    const images = [{ key: newId(), url: 'https://images.example/safe.jpg' }];

    const result = await runTool('image.search', '', { query: 'red dog' }, {
      contentContext,
      gallery: { search: async (...args: unknown[]) => { calls.push(args); return { images }; } },
    });

    expect(calls).toEqual([[
      { query: 'red dog', recordHistory: true, limit: 50 },
      { organizationKey, scopeKey, membership, modelVisible: true },
    ]]);
    expect(result).toEqual({ images });
    await expect(runTool('image.search', '', { query: 'red dog', organizationKey }, { contentContext, gallery: {} })).rejects.toThrow('Unrecognized key');
  });

  test('executes canonical image tools with trusted context and request idempotency', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const calls: unknown[][] = [];
    const images = {
      createIdeas: async (...args: unknown[]) => { calls.push(['ideas', ...args]); return { concepts: [] }; },
      generate: async (...args: unknown[]) => { calls.push(['generate', ...args]); return { images: [], provider: {} }; },
    } as any;
    await runTool('image.ideas.create', '', { prompt: 'Earth', requestedCount: 2 }, { contentContext, images });
    await runTool('image.generate', '', { prompt: 'Earth', count: 1, size: '1024x1024', quality: 'high' }, { contentContext, requestKey: 'request-1', images });
    expect(calls).toEqual([
      ['ideas', { prompt: 'Earth', requestedCount: 2 }, contentContext],
      ['generate', { prompt: 'Earth', count: 1, size: '1024x1024', quality: 'high' }, contentContext, 'request-1'],
    ]);
    await expect(runTool('image.generate', '', { prompt: 'Earth', count: 1, size: '1024x1024', quality: 'high', scopeKey }, { contentContext, images })).rejects.toThrow('Unrecognized key');
  });

  test('keeps canonical Content mutations in dot notation', async () => {
    expect(TOOL_NAMES.filter((name) => name === 'folder.create')).toHaveLength(1);
    expect(TOOL_NAMES).not.toContain('archive_folder_create');
  });

  test('executes hidden-content tools through the injected canonical service', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), userId: userKey, organizationId: organizationKey, status: 'active' } } } as unknown as ToolContext;
    const calls: unknown[] = [];
    const sourceKey = newId();
    const hiddenKey = newId();
    const userHiddenService = {
      hide: async (...args: unknown[]) => { calls.push(args); return {}; },
      list: async (...args: unknown[]) => { calls.push(args); return [{ key: hiddenKey, userKey, source: 'document', sourceKey, createdAt: '2026-08-19T00:00:00.000Z' }]; },
    } as any;
    await runTool('document.hide', '', { sourceKey }, { contentContext, userHiddenService });
    await expect(runTool('content.hidden.list', '', { userKey }, { contentContext, userHiddenService })).rejects.toThrow('Unrecognized key');
    const listed = await runTool('content.hidden.list', '', {}, { contentContext, userHiddenService });
    const actor = { userKey, organizationKey, membershipKey: (contentContext.principal as any).userOrganization.key, service: userHiddenService };
    expect(calls).toEqual([[actor, { source: 'document', sourceKey }], [actor]]);
    expect(listed).toEqual({ items: [{ key: hiddenKey, source: 'document', sourceKey, createdAt: '2026-08-19T00:00:00.000Z' }] });
    expect(JSON.stringify(listed)).not.toContain(userKey);
  });

  test('executes book creation and Signal read-state tools through injected services', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId(), threadKey = newId();
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const calls: unknown[][] = [];
    const emailService = {
      threadForTool: async (...args: unknown[]) => { calls.push(['threadForTool', ...args]); return {}; },
      markRead: async (...args: unknown[]) => { calls.push(['markRead', ...args]); return {}; },
    } as any;
    const bookService = { create: async (...args: unknown[]) => { calls.push(['create', ...args]); return {}; } } as any;
    const brief = { topic: 'Decision making', goal: 'Decide well', audience: 'Leaders', tone: 'Clear', length: 'short', language: 'English' };
    await expect(runTool('book.create', '', { ...brief, scopeKey }, { contentContext, bookService })).rejects.toThrow('Unrecognized key');
    await runTool('book.create', '', brief, { contentContext, bookService, requestKey: 'request-1' });
    await runTool('email.thread.read', '', { threadKey }, { contentContext, emailService });
    await runTool('email.thread.mark-read', '', { threadKey }, { contentContext, emailService });
    const actor = { userKey, organizationKey, scopeKey };
    expect(calls).toEqual([
      ['create', { organizationKey, scopeKey, generationRequestKey: 'request-1', ...brief }, userKey],
      ['threadForTool', actor, threadKey, undefined],
      ['markRead', actor, threadKey],
    ]);
  });
});

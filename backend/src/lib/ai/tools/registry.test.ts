import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from './tool-context';
import { CONTENT_TOOL_NAMES, runTool, TOOL_DEFINITIONS, TOOL_NAMES, toolInputSchemas } from './index';
import { signalCapabilities } from '@/lib/ai/personal-assistant/service-capabilities';

describe('unified tool registry', () => {
  test('has one unique definition for every public tool name', () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
    expect(new Set(TOOL_DEFINITIONS.map(({ name }) => name)).size).toBe(TOOL_DEFINITIONS.length);
    expect(TOOL_NAMES).toHaveLength(150);
    expect(TOOL_DEFINITIONS).toHaveLength(150);
    expect(TOOL_DEFINITIONS).toHaveLength(CONTENT_TOOL_NAMES.length + 105);
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
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'app.search')).toHaveLength(1);
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['app.enhance', 'app.translate']));
    expect(TOOL_NAMES).not.toContain('document.enhance');
    expect(TOOL_NAMES).not.toContain('document.translate');
    expect(TOOL_NAMES).not.toContain('email.message.translate');
    expect(toolInputSchemas['app.search'].parse({ query: 'roadmap', collectionSlugs: ['folders', 'images'] })).toEqual({ query: 'roadmap', collectionSlugs: ['folders', 'images'], recordHistory: true, limit: 10, minimumScore: 0.55 });
    expect(() => toolInputSchemas['app.search'].parse({ query: 'roadmap', collectionSlugs: ['folders'], scopeKey: newId() })).toThrow('Unrecognized key');
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
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['country.search', 'place.find', 'place.search', 'place.list', 'place.reference.generate', 'place.reference.list', 'place.guide.find', 'place.find-city', 'place.find-children', 'place.create', 'place.update', 'place.delete', 'place.open', 'trip.list', 'trip.search', 'trip.guide.generate', 'trip.guide.list', 'trip.create', 'trip.update', 'trip.delete', 'trip.attachment.set']));
    expect(TOOL_NAMES).not.toContain('place.images.generate');
    for (const name of ['place.visit.create', 'trip.place.add', 'trip.place.remove']) expect(TOOL_NAMES).not.toContain(name);
    expect(TOOL_NAMES).toContain('email.draft.send');
    expect(TOOL_NAMES).toContain('email.draft.assign');
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['email.draft.delete', 'email.tone.delete']));
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['email.reply-context.list', 'email.reply-context.create', 'email.reply-context.update', 'email.reply-context.delete']));
    expect(TOOL_NAMES.filter((name) => name === 'email.draft.create')).toHaveLength(1);
    expect(toolInputSchemas['email.draft.create'].parse({ threadKey: newId(), tone: 'warm' })).toMatchObject({ replyMode: 'reply' });
    expect(toolInputSchemas['email.draft.create'].parse({ threadKey: newId(), tone: 'warm', replyMode: 'reply_all' })).toMatchObject({ replyMode: 'reply_all' });
    expect(() => toolInputSchemas['email.draft.create'].parse({ threadKey: newId(), tone: 'warm', replyMode: 'all' })).toThrow();
    expect(() => toolInputSchemas['email.draft.create'].parse({ threadKey: newId(), tone: 'warm', contextKeys: [newId()] })).toThrow('Unrecognized key');
    expect(() => toolInputSchemas['email.reply-context.list'].parse({ scopeKey: newId() })).toThrow('Unrecognized key');
    expect(() => toolInputSchemas['email.reply-context.create'].parse({ name: 'x', text: 'y', userKey: newId() })).toThrow('Unrecognized key');
    const replyContextKey = newId();
    expect(() => toolInputSchemas['email.reply-context.delete'].parse({ noteKeys: [replyContextKey, replyContextKey] })).toThrow();
    expect(TOOL_NAMES).toContain('inbox.sync');
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['inbox.search', 'email.tone.search']));
    expect(toolInputSchemas['inbox.search'].parse({ query: 'leadership' })).toEqual({ query: 'leadership', minimumScore: 0.55, limit: 50, recordHistory: true });
    expect(toolInputSchemas['email.tone.search'].parse({ query: 'measured', recordHistory: false })).toMatchObject({ query: 'measured', recordHistory: false });
    expect(() => toolInputSchemas['inbox.search'].parse({ query: 'leadership', scopeKey: newId() })).toThrow('Unrecognized key');
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['email.similar.find', 'email.thread.trash', 'email.message.translation.list', 'email.message.translation.delete', 'email.message.summarize', 'email.message.summary.list', 'email.message.summary.delete']));
    expect(TOOL_NAMES).not.toContain('inbox.sort');
    expect(() => toolInputSchemas['email.similar.find'].parse({ messageKey: newId(), categories: ['Other'] })).toThrow();
    expect(TOOL_NAMES).not.toContain('inbox.subscribe');
    expect(TOOL_NAMES).not.toContain('email.disconnect');
    expect(TOOL_NAMES).not.toContain('email.sync');
    expect(() => toolInputSchemas['inbox.sync'].parse({ scopeKey: newId() })).toThrow('Unrecognized key');
    expect(() => toolInputSchemas['inbox.sync'].parse({})).toThrow();
    expect(toolInputSchemas['inbox.sync'].parse({ connectorKey: newId() })).toHaveProperty('connectorKey');
    expect(() => toolInputSchemas['email.draft.assign'].parse({ draftKey: newId(), connectorKey: newId(), scopeKey: newId() })).toThrow('Unrecognized key');
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['content.hidden.list', 'book.create', 'email.thread.read', 'email.thread.read-state', 'email.trash.clear']));
    expect(TOOL_NAMES).not.toContain('email.thread.mark-read');
    for (const tool of ['email.thread.favorite', 'email.thread.read-state', 'email.thread.trash']) {
      expect(() => toolInputSchemas[tool].parse({ threadKey: newId(), threadKeys: [newId()], ...(tool === 'email.thread.favorite' ? { isFavorite: true } : tool === 'email.thread.read-state' ? { isRead: true } : {}) })).toThrow();
      const key = newId();
      expect(() => toolInputSchemas[tool].parse({ threadKeys: [key, key], ...(tool === 'email.thread.favorite' ? { isFavorite: true } : tool === 'email.thread.read-state' ? { isRead: true } : {}) })).toThrow();
    }
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
      findPlaces: async (...args: unknown[]) => { calls.push(['findPlaces', ...args]); return { results: [] }; },
      searchPlaces: async (...args: unknown[]) => { calls.push(['searchPlaces', ...args]); return { results: [] }; },
      listTrips: async (...args: unknown[]) => { calls.push(['listTrips', ...args]); return { trips: [] }; },
      searchTrips: async (...args: unknown[]) => { calls.push(['searchTrips', ...args]); return { trips: [] }; },
      createTrip: async (...args: unknown[]) => { calls.push(['createTrip', ...args]); return {}; },
      updateTrip: async (...args: unknown[]) => { calls.push(['updateTrip', ...args]); return {}; },
      deleteTrip: async (...args: unknown[]) => { calls.push(['deleteTrip', ...args]); return {}; },
      setTripAttachments: async (...args: unknown[]) => { calls.push(['setTripAttachments', ...args]); return {}; },
      findPlaceGuide: async (...args: unknown[]) => { calls.push(['findPlaceGuide', ...args]); return {}; },
      findCity: async (...args: unknown[]) => { calls.push(['findCity', ...args]); return {}; },
      findChildren: async (...args: unknown[]) => { calls.push(['findChildren', ...args]); return {}; },
      createPlace: async (...args: unknown[]) => { calls.push(['createPlace', ...args]); return {}; },
      updatePlace: async (...args: unknown[]) => { calls.push(['updatePlace', ...args]); return {}; },
      deletePlace: async (...args: unknown[]) => { calls.push(['deletePlace', ...args]); return {}; },
      openPlace: async (...args: unknown[]) => { calls.push(['openPlace', ...args]); return {}; },
    } as any;

    await expect(runTool('place.list', '', { scopeKey: newId() }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('place.list', '', {}, { contentContext, travelService });
    await expect(runTool('place.search', '', { query: 'x', scopeKey }, { contentContext, travelService })).rejects.toThrow();
    await runTool('place.search', '', { query: 'warm coast' }, { contentContext, travelService });
    await runTool('place.find', '', { query: 'Reykjavik' }, { contentContext, travelService });
    await runTool('trip.list', '', {}, { contentContext, travelService });
    await runTool('trip.search', '', { query: 'Iceland route' }, { contentContext, travelService });
    await expect(runTool('trip.create', '', { name: 'Route', placeKeys: [scopeKey], userKey }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('trip.create', '', { name: 'Route', placeKeys: [scopeKey] }, { contentContext, travelService, requestKey: 'request-1' });
    await expect(runTool('trip.update', '', { tripKey: scopeKey, isFavorite: true, position: 0 }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('trip.update', '', { tripKey: scopeKey, isFavorite: true }, { contentContext, travelService });
    await runTool('trip.delete', '', { tripKey: scopeKey }, { contentContext, travelService });
    await expect(runTool('trip.attachment.set', '', { tripKey: scopeKey, attachments: [{ type: 'file', key: scopeKey }] }, { contentContext, travelService })).rejects.toThrow();
    await runTool('trip.attachment.set', '', { tripKey: scopeKey, attachments: [{ type: 'collection', key: scopeKey }] }, { contentContext, travelService });
    await runTool('place.guide.find', '', { query: 'Reykjavik' }, { contentContext, travelService });
    const cityInput = { city: 'Reykjavik', country: { name: 'Iceland', code: 'IS', continent: 'Europe', lat: 65, lon: -18 } };
    await expect(runTool('place.find-city', '', { ...cityInput, userKey }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('place.find-city', '', cityInput, { contentContext, travelService });
    await expect(runTool('place.find-children', '', { childrenRequestToken: 'token', scopeKey }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('place.find-children', '', { childrenRequestToken: 'token' }, { contentContext, travelService });
    const createInput = { name: 'Iceland', summary: 'Volcanic island.', countryCode: 'IS', latitude: 65, longitude: -18, imageRequestToken: 'token' };
    await expect(runTool('place.create', '', { ...createInput, scopeKey }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('place.create', '', createInput, { contentContext, travelService });
    await expect(runTool('place.update', '', { placeKey: scopeKey, status: 'visited', userKey }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('place.update', '', { placeKey: scopeKey, status: 'visited' }, { contentContext, travelService });
    await runTool('place.delete', '', { placeKey: scopeKey }, { contentContext, travelService });
    const openInput = { name: 'Iceland', countryCode: 'IS' };
    await expect(runTool('place.open', '', { ...openInput, openedAt: new Date().toISOString() }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('place.open', '', openInput, { contentContext, travelService });
    expect(calls).toEqual([
      ['overview', { organizationKey, scopeKey }, userKey],
      ['searchPlaces', { organizationKey, scopeKey, query: 'warm coast', recordHistory: true }, userKey, { signal: undefined, timeoutMs: undefined }],
      ['findPlaces', { organizationKey, scopeKey, query: 'Reykjavik' }, userKey, { signal: undefined, timeoutMs: undefined }],
      ['listTrips', { organizationKey, scopeKey }, userKey],
      ['searchTrips', { organizationKey, scopeKey, query: 'Iceland route', recordHistory: true }, userKey, { signal: undefined, timeoutMs: undefined }],
      ['createTrip', { organizationKey, scopeKey, name: 'Route', placeKeys: [scopeKey], idempotencyKey: 'request-1:trip.create' }, userKey],
      ['updateTrip', { organizationKey, scopeKey, tripKey: scopeKey, isFavorite: true }, userKey],
      ['deleteTrip', { organizationKey, scopeKey, tripKey: scopeKey }, userKey],
      ['setTripAttachments', { organizationKey, scopeKey, tripKey: scopeKey, attachments: [{ type: 'collection', key: scopeKey }] }, userKey],
      ['findPlaceGuide', { organizationKey, scopeKey, query: 'Reykjavik' }, userKey, { signal: undefined, timeoutMs: undefined }],
      ['findCity', { organizationKey, scopeKey, ...cityInput }, userKey, { signal: undefined, timeoutMs: undefined }],
      ['findChildren', { organizationKey, scopeKey, childrenRequestToken: 'token' }, userKey, { signal: undefined, timeoutMs: undefined }],
      ['createPlace', { organizationKey, scopeKey, ...createInput }, userKey, { signal: undefined, timeoutMs: undefined }],
      ['updatePlace', { organizationKey, scopeKey, placeKey: scopeKey, status: 'visited' }, userKey],
      ['deletePlace', { organizationKey, scopeKey, placeKey: scopeKey }, userKey],
      ['openPlace', { organizationKey, scopeKey, ...openInput }, userKey],
    ]);
    expect(() => toolInputSchemas['collection.create'].parse({ name: 'Favorites', organizationKey })).toThrow('Unrecognized key');
  });

  test('executes country.search through the canonical read-only service with trusted identity', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const calls: unknown[][] = [];
    await runTool('country.search', '', { query: 'Portugal' }, { contentContext, countrySearchService: { search: async (...args: unknown[]) => { calls.push(args); return { country: null }; } } as any });
    expect(calls).toEqual([[{ organizationKey, query: 'Portugal' }, userKey, { signal: undefined, timeoutMs: undefined }]]);
    await expect(runTool('country.search', '', { query: 'Portugal', organizationKey }, { contentContext })).rejects.toThrow('Unrecognized key');
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

  test('executes non-text image.search through the canonical Gallery operation', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const membership = { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' };
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: membership } } as unknown as ToolContext;
    const calls: unknown[][] = [];
    const imageKey = newId();
    const images = [{ key: newId(), url: 'https://images.example/safe.jpg' }];

    const result = await runTool('image.search', '', { imageKey }, {
      contentContext,
      gallery: { search: async (...args: unknown[]) => { calls.push(args); return { images }; } },
    });

    expect(calls).toEqual([[
      { imageKey, limit: 50 },
      { organizationKey, scopeKey, membership, modelVisible: true },
    ]]);
    expect(result).toEqual({ images });
    await expect(runTool('image.search', '', { query: 'red dog' }, { contentContext, gallery: {} })).rejects.toThrow();
    await expect(runTool('image.search', '', { imageKey, organizationKey }, { contentContext, gallery: {} })).rejects.toThrow('Unrecognized key');
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
      ['generate', { prompt: 'Earth', count: 1, size: '1024x1024', quality: 'high', mode: 'default' }, contentContext, 'request-1'],
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
      setReadState: async (...args: unknown[]) => { calls.push(['setReadState', ...args]); return {}; },
      findSimilar: async (...args: unknown[]) => { calls.push(['findSimilar', ...args]); return {}; },
    } as any;
    const bookService = { create: async (...args: unknown[]) => { calls.push(['create', ...args]); return {}; } } as any;
    const brief = { topic: 'Decision making', goal: 'Decide well', audience: 'Leaders', tone: 'Clear', length: 'short', language: 'English' };
    await expect(runTool('book.create', '', { ...brief, scopeKey }, { contentContext, bookService })).rejects.toThrow('Unrecognized key');
    await runTool('book.create', '', brief, { contentContext, bookService, requestKey: 'request-1' });
    await runTool('email.thread.read', '', { threadKey }, { contentContext, emailService });
    await runTool('email.thread.read-state', '', { threadKey, isRead: true }, { contentContext, emailService });
    await runTool('email.similar.find', '', { messageKey: threadKey }, { contentContext, emailService });
    const actor = { userKey, organizationKey, scopeKey };
    expect(calls).toEqual([
      ['create', { organizationKey, scopeKey, generationRequestKey: 'request-1', ...brief }, userKey],
      ['threadForTool', actor, threadKey, undefined],
      ['setReadState', actor, { threadKey, isRead: true }, false, undefined],
      ['findSimilar', actor, { messageKey: threadKey, limit: 10 }],
    ]);
  });

  test('dispatches all 30 Signal-specific tools through runTool with strict trusted contracts', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId(), key = newId();
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const cases = [
      ['email.overview', 'overview', {}],
      ['inbox.search', 'searchInboxes', { query: 'leadership', recordHistory: false }],
      ['email.tone.search', 'searchTones', { query: 'measured', recordHistory: false }],
      ['inbox.sync', 'sync', { connectorKey: key }],
      ['inbox.update', 'updateInbox', { connectorKey: key, isFavorite: true }],
      ['email.thread.read', 'threadForTool', { threadKey: key }],
      ['email.thread.read-state', 'setReadState', { threadKey: key, isRead: true }],
      ['email.thread.favorite', 'setFavorite', { threadKey: key, isFavorite: true }],
      ['email.thread.trash', 'trashThread', { threadKey: key }],
      ['email.trash.clear', 'clearTrash', { connectorKey: key }],
      ['email.similar.find', 'findSimilar', { messageKey: key }],
      ['email.message.translation.list', 'listMessageTranslations', { messageKey: key }],
      ['email.message.translation.delete', 'deleteMessageTranslations', { messageKey: key, translationKeys: [key] }],
      ['email.message.summarize', 'summarizeMessage', { messageKey: key }],
      ['email.message.summary.list', 'listMessageSummaries', { messageKey: key }],
      ['email.message.summary.delete', 'deleteMessageSummaries', { messageKey: key, summaryKeys: [key] }],
      ['email.draft.create', 'draft', { threadKey: key, tone: 'warm' }],
      ['email.draft.compose', 'draftNew', { to: ['person@example.com'], generationMode: 'preserve', subject: '', authoredBody: '' }],
      ['email.tone.list', 'tones', {}],
      ['email.tone.create', 'createTone', { name: 'Calm', instruction: 'Write calmly.' }],
      ['email.tone.update', 'updateTone', { toneKey: key, instruction: 'Write clearly.' }],
      ['email.tone.delete', 'deleteTone', { toneKey: key }],
      ['email.reply-context.list', 'listReplyContext', {}],
      ['email.reply-context.create', 'createReplyContext', { name: 'Availability', text: 'No Friday meetings.' }],
      ['email.reply-context.update', 'updateReplyContext', { noteKey: key, text: 'No Monday meetings.' }],
      ['email.reply-context.delete', 'deleteReplyContext', { noteKeys: [key] }],
      ['email.draft.update', 'updateDraft', { draftKey: key, finalContent: 'Thanks.', attachments: [{ type: 'document', key }] }],
      ['email.draft.assign', 'assignDraft', { draftKey: key, connectorKey: key }],
      ['email.draft.send', 'sendDraft', { draftKey: key }],
      ['email.draft.delete', 'deleteDraft', { draftKey: key }],
    ] as const;
    const receiptMethods = new Set(['updateInbox', 'setReadState', 'setFavorite', 'trashThread', 'clearTrash', 'translateMessage', 'deleteMessageTranslations', 'summarizeMessage', 'deleteMessageSummaries', 'draft', 'draftNew', 'createTone', 'updateTone', 'deleteTone', 'createReplyContext', 'updateReplyContext', 'deleteReplyContext', 'updateDraft', 'assignDraft', 'sendDraft', 'deleteDraft']);
    const calls: Array<[string, ...unknown[]]> = [];
    const timestamp = '2026-08-23T12:00:00.000Z';
    const generatedVersion = { key, documentKey: key, version: 1, content: 'Bonjour.', summary: 'Summary.', style: 'brief', sourceTitle: 'Subject', sourceDocumentUpdatedAt: timestamp, createdAt: timestamp, embedding: [1], scopeKey };
    const draftOutput = { key, variant: 'new' as const, connectorKey: key, to: ['person@example.com'], bcc: ['hidden@example.com'], subject: 'Subject', generatedContent: 'Body', status: 'generated' as const, createdAt: timestamp, updatedAt: timestamp };
    const emailService = new Proxy({}, { get: (_target, property) => async (...args: unknown[]) => {
      const method = String(property);
      calls.push([method, ...args]);
      if (method === 'translateMessage') return { messageKey: key, language: 'French', version: generatedVersion };
      if (method === 'listMessageTranslations') return { messageKey: key, versions: [generatedVersion] };
      if (method === 'deleteMessageTranslations') return { messageKey: key, deletedKeys: (args[1] as { translationKeys: string[] }).translationKeys };
      if (method === 'summarizeMessage') return { messageKey: key, text: 'Summary.', summary: generatedVersion };
      if (method === 'listMessageSummaries') return { messageKey: key, summaries: [generatedVersion] };
      if (method === 'deleteMessageSummaries') return { messageKey: key, deletedKeys: (args[1] as { summaryKeys: string[] }).summaryKeys };
      if (method === 'threadForTool') return { thread: { key, unread: false, isRead: true }, messages: [], nextCursor: null, truncated: false };
      if (['draft', 'draftNew', 'updateDraft', 'assignDraft'].includes(method)) return draftOutput;
      return { key, safe: true };
    } }) as any;
    const actor = { userKey, organizationKey, scopeKey };
    const mutationNames = new Set([
      'inbox.sync', 'inbox.update', 'email.thread.read-state', 'email.thread.favorite', 'email.thread.trash', 'email.trash.clear',
      'email.message.translation.delete', 'email.message.summarize', 'email.message.summary.delete', 'email.draft.create', 'email.draft.compose', 'email.draft.update', 'email.draft.assign',
      'email.draft.send', 'email.draft.delete', 'email.tone.create', 'email.tone.update', 'email.tone.delete', 'email.reply-context.create',
      'email.reply-context.update', 'email.reply-context.delete',
    ]);
    expect(cases.map(([name]): string => name)).toEqual(signalCapabilities.map(({ definition }) => definition.name));
    expect(cases).toHaveLength(30);
    for (const [name, method, input] of cases) {
      await expect(runTool(name, '', { ...input, unexpected: true }, { contentContext, emailService, requestKey: 'signal-request' })).rejects.toThrow('Unrecognized key');
      const output = await runTool(name, '', input, { contentContext, emailService, requestKey: 'signal-request' });
      const call = calls.at(-1)!;
      expect(call[0]).toBe(method);
      expect(call[1]).toEqual(actor);
      expect(call.includes('signal-request')).toBe(receiptMethods.has(method));
      expect(signalCapabilities.find(({ definition }) => definition.name === name)?.mutationWorkspace === 'signal').toBe(mutationNames.has(name));
      expect(JSON.stringify(output)).not.toMatch(/embedding|scopeKey|accountKey|providerThreadId|providerMessageId|encryptedCredentials|sendLeaseToken/);
      expect(JSON.stringify(output)).not.toMatch(/bcc|hidden@example.com/i);
    }
  });
});

import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { defaultAssistantCapabilityRegistry, type AssistantSurface } from './capabilities';

const organizationKey = newId();
const scopeKey = newId();
const userKey = newId();
const assetConcepts = [
  { title: 'Overview', prompt: 'Role: hero. Complete country hero.' },
  { title: 'Coast', prompt: 'Role: scene-1. Complete coastal scene.' },
  { title: 'City', prompt: 'Role: scene-2. Complete urban scene.' },
  { title: 'Garden', prompt: 'Role: scene-3. Complete garden scene.' },
] as const;
const domain = {
  organizationKey,
  runtimeScopeKey: scopeKey,
  principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } },
} as unknown as ToolContext;

const expected: Array<[AssistantSurface, string[]]> = [
  ['knowledge-workspace', ['content.hidden.list', 'folder.hide', 'folder.reveal', 'document.hide', 'document.reveal', 'folder.list', 'folder.create', 'folder.update', 'folder.move', 'folder.copy', 'document.list', 'document.find', 'document.create', 'document.update', 'document.rename', 'document.move', 'document.copy', 'document.summarize', 'document.topics', 'document.list-summaries', 'document.find-summary', 'document.summary.audio.generate', 'document.audio.playback.update', 'document.audio.playback.clear', 'document.enhance', 'document.translate', 'document.list-versions', 'document.restore-version', 'document.download', 'content.neighbors', 'content.search-history.delete', 'knowledge.search', 'note.write']],
  ['travel-workspace', ['place.list', 'place.find', 'place.create', 'place.visit.create', 'trip.create', 'trip.place.add', 'trip.place.remove']],
  ['signal-workspace', ['email.overview', 'email.sync', 'email.thread.read', 'email.thread.mark-read', 'email.thread.favorite', 'email.draft.create', 'email.draft.update', 'email.draft.send', 'email.disconnect']],
  ['book-workspace', ['book.list', 'book.detail', 'book.chapter.progress', 'book.create']],
];

describe('personal assistant service capabilities', () => {
  test.each(expected)('registers the model-safe %s tool table', (surface, names) => {
    const capabilities = defaultAssistantCapabilityRegistry.resolve(surface);
    expect(capabilities.map(({ definition }) => definition.name)).toEqual(names);
    for (const { definition } of capabilities) {
      const properties = definition.inputSchema.properties as Record<string, unknown> | undefined;
      expect(properties).not.toHaveProperty('scopeKey');
      expect(properties).not.toHaveProperty('organizationKey');
      expect(properties).not.toHaveProperty('userKey');
      expect(properties).not.toHaveProperty('idempotencyKey');
    }
  });

  test('keeps country selection server-side and excludes transient image transfer from models', () => {
    const capabilities = defaultAssistantCapabilityRegistry.resolve('travel-workspace');
    expect(Object.keys(capabilities.find(({ definition }) => definition.name === 'place.find')!.definition.inputSchema.properties ?? {})).toEqual(['query']);
    expect(capabilities.some(({ definition }) => definition.name === 'place.images.generate')).toBe(false);
  });

  test('executes canonical services with identity derived only from the member principal', async () => {
    const placeKey = newId();
    const tripKey = newId();
    const threadKey = newId();
    const draftKey = newId();
    const bookKey = newId();
    const chapterKey = newId();
    const calls: unknown[] = [];
    const travel: any = {
      overview: async (...args: unknown[]) => { calls.push(['travel.overview', ...args]); return {}; },
      findPlace: async (...args: unknown[]) => { calls.push(['travel.findPlace', ...args]); return {}; },
      createPlace: async (...args: unknown[]) => { calls.push(['travel.createPlace', ...args]); return {}; },
      createVisit: async (...args: unknown[]) => { calls.push(['travel.createVisit', ...args]); return {}; },
      createTrip: async (...args: unknown[]) => { calls.push(['travel.createTrip', ...args]); return {}; },
      appendPlace: async (...args: unknown[]) => { calls.push(['travel.appendPlace', ...args]); return {}; },
      removePlace: async (...args: unknown[]) => { calls.push(['travel.removePlace', ...args]); return {}; },
    };
    const email: any = {
      overview: async (...args: unknown[]) => { calls.push(['email.overview', ...args]); return {}; },
      sync: async (...args: unknown[]) => { calls.push(['email.sync', ...args]); return {}; },
      threadForTool: async (...args: unknown[]) => { calls.push(['email.threadForTool', ...args]); return {}; },
      markRead: async (...args: unknown[]) => { calls.push(['email.markRead', ...args]); return {}; },
      setFavorite: async (...args: unknown[]) => { calls.push(['email.setFavorite', ...args]); return {}; },
      draft: async (...args: unknown[]) => { calls.push(['email.draft', ...args]); return {}; },
      updateDraft: async (...args: unknown[]) => { calls.push(['email.updateDraft', ...args]); return {}; },
      sendDraft: async (...args: unknown[]) => { calls.push(['email.sendDraft', ...args]); return {}; },
      disconnect: async (...args: unknown[]) => { calls.push(['email.disconnect', ...args]); return {}; },
    };
    const books: any = {
      overview: async (...args: unknown[]) => { calls.push(['books.overview', ...args]); return {}; },
      detail: async (...args: unknown[]) => { calls.push(['books.detail', ...args]); return {}; },
      progress: async (...args: unknown[]) => { calls.push(['books.progress', ...args]); return {}; },
      create: async (...args: unknown[]) => { calls.push(['books.create', ...args]); return {}; },
    };
    const context: any = { domain, requestKey: 'request-1', travel, email, books };
    const cases: Array<[AssistantSurface, string, unknown]> = [
      ['travel-workspace', 'place.list', {}],
      ['travel-workspace', 'place.find', { query: 'Lisbon' }],
      ['travel-workspace', 'place.create', { name: 'Lisbon', latitude: 38.72, longitude: -9.14, countryCode: 'PT' }],
      ['travel-workspace', 'place.visit.create', { placeKey }],
      ['travel-workspace', 'trip.create', { name: 'Portugal' }],
      ['travel-workspace', 'trip.place.add', { tripKey, placeKey }],
      ['travel-workspace', 'trip.place.remove', { tripKey, placeKey }],
      ['signal-workspace', 'email.overview', {}],
      ['signal-workspace', 'email.sync', {}],
      ['signal-workspace', 'email.thread.read', { threadKey }],
      ['signal-workspace', 'email.thread.mark-read', { threadKey }],
      ['signal-workspace', 'email.thread.favorite', { threadKey, isFavorite: true }],
      ['signal-workspace', 'email.draft.create', { threadKey, tone: 'warm' }],
      ['signal-workspace', 'email.draft.update', { draftKey, finalContent: 'Thanks.' }],
      ['signal-workspace', 'email.draft.send', { draftKey }],
      ['signal-workspace', 'email.disconnect', {}],
      ['book-workspace', 'book.list', {}],
      ['book-workspace', 'book.detail', { bookKey }],
      ['book-workspace', 'book.chapter.progress', { bookKey, chapterKey, progressSeconds: 30, isCompleted: false }],
      ['book-workspace', 'book.create', { topic: 'Decision making', goal: 'Decide well', audience: 'Leaders', tone: 'Clear', length: 'short', language: 'English' }],
    ];
    for (const [surface, capabilityName, input] of cases) await defaultAssistantCapabilityRegistry.resolve(surface).find(({ definition }) => definition.name === capabilityName)!.execute(input, context);
    const serviceContext = { organizationKey, scopeKey };
    const actor = { userKey, ...serviceContext };
    expect(calls).toContainEqual(['travel.overview', serviceContext, userKey]);
    expect(calls).toContainEqual(['travel.findPlace', { ...serviceContext, query: 'Lisbon' }, userKey, { signal: undefined, timeoutMs: undefined }]);
    expect(calls).toContainEqual(['email.overview', actor, {}]);
    expect(calls).toContainEqual(['email.threadForTool', actor, threadKey, undefined]);
    expect(calls).toContainEqual(['email.markRead', actor, threadKey]);
    expect(calls).toContainEqual(['books.progress', bookKey, chapterKey, { ...serviceContext, progressSeconds: 30, isCompleted: false }, userKey]);
    expect(calls).toContainEqual(['books.create', { ...serviceContext, generationRequestKey: 'request-1', topic: 'Decision making', goal: 'Decide well', audience: 'Leaders', tone: 'Clear', length: 'short', language: 'English' }, userKey]);
    expect(JSON.stringify(calls)).not.toContain((domain.principal as Extract<ToolContext['principal'], { kind: 'member' }>).userOrganization.key);
  });

  test('injects runtime scope and stable request idempotency into Archive mutations', async () => {
    const calls: unknown[] = [];
    const executeContent = async (...args: unknown[]) => { calls.push(args); return {}; };
    const create = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'folder.create')!;
    const copy = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'folder.copy')!;
    const playback = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'document.audio.playback.update')!;
    const folderKey = newId(), targetParentFolderKey = newId();
    const context: any = { domain, requestKey: 'stable-request', executeContent };
    await expect(create.execute({ name: 'xyz', scopeKey: newId() }, context)).rejects.toThrow('Unrecognized key');
    await expect(copy.execute({ copies: [{ folderKey, targetParentFolderKey, targetScopeKey: newId() }] }, context)).rejects.toThrow('Unrecognized key');
    await create.execute({ name: 'xyz' }, context);
    await create.execute({ name: 'xyz' }, context);
    await copy.execute({ copies: [{ folderKey, targetParentFolderKey }] }, context);
    const audioVersionKey = newId();
    await playback.execute({ audioVersionKey, playbackPositionMs: 12_345 }, context);
    expect(calls).toEqual([
      ['folder.create', { folders: [{ scopeKey, name: 'xyz' }], idempotencyKey: 'stable-request:folder.create' }, domain, undefined],
      ['folder.create', { folders: [{ scopeKey, name: 'xyz' }], idempotencyKey: 'stable-request:folder.create' }, domain, undefined],
      ['folder.copy', { copies: [{ folderKey, targetParentFolderKey, targetScopeKey: scopeKey }], idempotencyKey: 'stable-request:folder.copy' }, domain, undefined],
      ['document.audio.playback.update', { audioVersionKey, playbackPositionMs: 12_345, idempotencyKey: 'stable-request:document.audio.playback.update' }, domain, undefined],
    ]);
    expect(copy.mutationWorkspace).toBe('archive');
    expect(playback.mutationWorkspace).toBe('archive');
  });

  test('injects trusted identity into Archive hidden-content tools', async () => {
    const calls: unknown[] = [];
    const userHiddens: any = {
      hide: async (...args: unknown[]) => { calls.push(args); return {}; },
    };
    const capabilities = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace');
    const hide = capabilities.find(({ definition }) => definition.name === 'folder.hide')!;
    const sourceKey = newId();
    await expect(hide.execute({ sourceKey, userKey }, { domain, userHiddens } as any)).rejects.toThrow('Unrecognized key');
    await hide.execute({ sourceKey }, { domain, userHiddens } as any);
    expect(calls).toEqual([[{ userKey, organizationKey, membershipKey: (domain.principal as any).userOrganization.key, service: userHiddens }, { source: 'folder', sourceKey }]]);
    expect(hide.mutationWorkspace).toBe('archive');
  });

  test('lists hidden content on Archive and Gallery with an empty schema and no user key', async () => {
    const hiddenKey = newId(), sourceKey = newId();
    const userHiddens: any = { list: async () => [{ key: hiddenKey, userKey, source: 'image', sourceKey, createdAt: '2026-08-19T00:00:00.000Z' }] };
    const archive = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'content.hidden.list')!;
    const gallery = defaultAssistantCapabilityRegistry.resolve('media-workspace').find(({ definition }) => definition.name === 'content.hidden.list')!;
    expect(archive).toBe(gallery);
    await expect(archive.execute({ userKey }, { domain, userHiddens } as any)).rejects.toThrow('Unrecognized key');
    const result = await archive.execute({}, { domain, userHiddens } as any);
    expect(result).toEqual({ kind: 'continue', result: { items: [{ key: hiddenKey, source: 'image', sourceKey, createdAt: '2026-08-19T00:00:00.000Z' }] } });
    expect(JSON.stringify(result)).not.toContain(userKey);
  });

  test('rejects inactive and mismatched memberships before hidden-content execution', async () => {
    let calls = 0;
    const userHiddens: any = { list: async () => { calls += 1; return []; } };
    const list = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'content.hidden.list')!;
    const principal = domain.principal as Extract<ToolContext['principal'], { kind: 'member' }>;
    await expect(list.execute({}, { domain: { ...domain, principal: { ...principal, userOrganization: { ...principal.userOrganization, status: 'inactive' } } }, userHiddens } as any)).rejects.toThrow('active matching');
    await expect(list.execute({}, { domain: { ...domain, principal: { ...principal, userOrganization: { ...principal.userOrganization, organizationId: newId() } } }, userHiddens } as any)).rejects.toThrow('active matching');
    await expect(list.execute({}, { domain: { ...domain, principal: { ...principal, userOrganization: { ...principal.userOrganization, userId: newId() } } }, userHiddens } as any)).rejects.toThrow('active matching');
    expect(calls).toBe(0);
  });

  test('uses fresh fallback book generation keys and hashes only overlong supplied keys', async () => {
    const calls: unknown[] = [];
    const books: any = { create: async (...args: unknown[]) => { calls.push(args); return {}; } };
    const create = defaultAssistantCapabilityRegistry.resolve('book-workspace').find(({ definition }) => definition.name === 'book.create')!;
    const brief = { topic: 'Decision making', goal: 'Decide well', audience: 'Leaders', tone: 'Clear', length: 'short', language: 'English' };
    await create.execute(brief, { domain, books } as any);
    await create.execute(brief, { domain, books } as any);
    await create.execute(brief, { domain, books, requestKey: 'derived-invocation-key', clientRequestKey: null } as any);
    await create.execute(brief, { domain, books, requestKey: 'x'.repeat(201) } as any);
    const generationRequestKey = (calls[0] as any)[0].generationRequestKey;
    expect(generationRequestKey).toMatch(/^c/);
    expect((calls[1] as any)[0].generationRequestKey).toMatch(/^c/);
    expect((calls[1] as any)[0].generationRequestKey).not.toBe(generationRequestKey);
    expect((calls[2] as any)[0].generationRequestKey).toMatch(/^c/);
    expect((calls[2] as any)[0].generationRequestKey).not.toBe('derived-invocation-key');
    expect((calls[3] as any)[0].generationRequestKey).toMatch(/^[a-f0-9]{64}$/);
    expect((calls[3] as any)[0].generationRequestKey).not.toBe('x'.repeat(201));
    expect(() => create.inputSchema.parse({ ...brief, generationRequestKey })).toThrow('Unrecognized key');
    expect(create.mutationWorkspace).toBe('ascend');
  });

  test('injects the trusted open document into document-specific Core actions', async () => {
    const calls: unknown[] = [];
    const currentDocumentKey = newId();
    const executeContent = async (...args: unknown[]) => { calls.push(args); return {}; };
    const translate = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'document.translate')!;
    await translate.execute({ targetLanguage: 'Spanish' }, { domain, currentDocumentKey, requestKey: 'translate-request', executeContent: executeContent as any });
    expect(calls).toEqual([
      ['document.translate', { documentKeys: [currentDocumentKey], targetLanguage: 'Spanish', preserveFormatting: true, mode: 'replace', idempotencyKey: 'translate-request:document.translate' }, domain, undefined],
    ]);
  });

  test('passes any requested target language through unchanged', async () => {
    const calls: unknown[] = [];
    const currentDocumentKey = newId();
    const translate = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'document.translate')!;
    await translate.execute({ targetLanguage: 'Welsh' }, { domain, currentDocumentKey, requestKey: 'welsh-request', executeContent: (async (...args: unknown[]) => { calls.push(args); return {}; }) as any });
    expect(calls[0]).toEqual(['document.translate', { documentKeys: [currentDocumentKey], targetLanguage: 'Welsh', preserveFormatting: true, mode: 'replace', idempotencyKey: 'welsh-request:document.translate' }, domain, undefined]);
  });
});

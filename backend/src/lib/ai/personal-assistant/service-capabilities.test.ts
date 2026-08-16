import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { DomainToolContext } from '@/lib/ai/tools/domain-execute';
import { defaultAssistantCapabilityRegistry, type AssistantSurface } from './capabilities';

const organizationKey = newId();
const scopeKey = newId();
const userKey = newId();
const domain = {
  organizationKey,
  runtimeScopeKey: scopeKey,
  principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: newId(), status: 'active' } },
} as unknown as DomainToolContext;

const expected: Array<[AssistantSurface, string[]]> = [
  ['knowledge-workspace', ['folder.list', 'folder.create', 'folder.update', 'folder.move', 'folder.copy', 'document.list', 'document.find', 'document.create', 'document.update', 'document.rename', 'document.move', 'document.copy', 'document.summarize', 'document.topics', 'document.list-summaries', 'document.find-summary', 'document.summary.audio.generate', 'document.audio.playback.update', 'document.audio.playback.clear', 'document.translate', 'document.list-versions', 'document.restore-version', 'document.download', 'content.neighbors', 'scope.content.search-history.delete', 'knowledge.search', 'note.write', 'note.enhance']],
  ['travel-workspace', ['place.list', 'place.create', 'place.visit.create', 'trip.create', 'trip.place.add', 'trip.place.remove']],
  ['signal-workspace', ['email.overview', 'email.sync', 'email.thread.read', 'email.thread.favorite', 'email.draft.create', 'email.draft.update', 'email.draft.send', 'email.disconnect']],
  ['book-workspace', ['book.list', 'book.detail', 'book.chapter.progress', 'book.create-context', 'book.write']],
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
      createPlace: async (...args: unknown[]) => { calls.push(['travel.createPlace', ...args]); return {}; },
      createVisit: async (...args: unknown[]) => { calls.push(['travel.createVisit', ...args]); return {}; },
      createTrip: async (...args: unknown[]) => { calls.push(['travel.createTrip', ...args]); return {}; },
      appendPlace: async (...args: unknown[]) => { calls.push(['travel.appendPlace', ...args]); return {}; },
      removePlace: async (...args: unknown[]) => { calls.push(['travel.removePlace', ...args]); return {}; },
    };
    const email: any = {
      overview: async (...args: unknown[]) => { calls.push(['email.overview', ...args]); return {}; },
      sync: async (...args: unknown[]) => { calls.push(['email.sync', ...args]); return {}; },
      thread: async (...args: unknown[]) => { calls.push(['email.thread', ...args]); return {}; },
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
    };
    const context: any = { domain, requestKey: 'request-1', travel, email, books };
    const cases: Array<[AssistantSurface, string, unknown]> = [
      ['travel-workspace', 'place.list', {}],
      ['travel-workspace', 'place.create', { name: 'Lisbon', latitude: 38.72, longitude: -9.14, countryCode: 'PT' }],
      ['travel-workspace', 'place.visit.create', { placeKey }],
      ['travel-workspace', 'trip.create', { name: 'Portugal' }],
      ['travel-workspace', 'trip.place.add', { tripKey, placeKey }],
      ['travel-workspace', 'trip.place.remove', { tripKey, placeKey }],
      ['signal-workspace', 'email.overview', {}],
      ['signal-workspace', 'email.sync', {}],
      ['signal-workspace', 'email.thread.read', { threadKey }],
      ['signal-workspace', 'email.thread.favorite', { threadKey, isFavorite: true }],
      ['signal-workspace', 'email.draft.create', { threadKey, tone: 'warm' }],
      ['signal-workspace', 'email.draft.update', { draftKey, finalContent: 'Thanks.' }],
      ['signal-workspace', 'email.draft.send', { draftKey }],
      ['signal-workspace', 'email.disconnect', {}],
      ['book-workspace', 'book.list', {}],
      ['book-workspace', 'book.detail', { bookKey }],
      ['book-workspace', 'book.chapter.progress', { bookKey, chapterKey, progressSeconds: 30, isCompleted: false }],
    ];
    for (const [surface, capabilityName, input] of cases) await defaultAssistantCapabilityRegistry.resolve(surface).find(({ definition }) => definition.name === capabilityName)!.execute(input, context);
    const serviceContext = { organizationKey, scopeKey };
    const actor = { userKey, ...serviceContext };
    expect(calls).toContainEqual(['travel.overview', serviceContext, userKey]);
    expect(calls).toContainEqual(['email.overview', actor, {}]);
    expect(calls).toContainEqual(['books.progress', bookKey, chapterKey, { ...serviceContext, progressSeconds: 30, isCompleted: false }, userKey]);
    expect(JSON.stringify(calls)).not.toContain((domain.principal as Extract<DomainToolContext['principal'], { kind: 'member' }>).userOrganization.userId);
  });

  test('injects runtime scope and stable request idempotency into Archive mutations', async () => {
    const calls: unknown[] = [];
    const executeContent = async (...args: unknown[]) => { calls.push(args); return {}; };
    const create = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'folder.create')!;
    const copy = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'folder.copy')!;
    const playback = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'document.audio.playback.update')!;
    const folderKey = newId(), targetParentFolderKey = newId();
    const context: any = { domain, requestKey: 'stable-request', executeContent };
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

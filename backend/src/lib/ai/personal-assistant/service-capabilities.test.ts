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
  ['knowledge-workspace', ['archive_folder_list', 'archive_folder_create', 'archive_folder_update', 'archive_folder_move', 'archive_document_list', 'archive_document_find', 'archive_document_create', 'archive_document_update', 'archive_document_rename', 'archive_document_move', 'archive_document_copy', 'archive_document_translate', 'archive_document_versions', 'archive_document_version_restore', 'archive_document_download', 'search_knowledge', 'write_note']],
  ['travel-workspace', ['compass_overview', 'compass_place_create', 'compass_visit_create', 'compass_trip_create', 'compass_trip_place_add', 'compass_trip_place_remove']],
  ['signal-workspace', ['signal_overview', 'signal_sync', 'signal_thread', 'signal_favorite', 'signal_draft', 'signal_draft_update', 'signal_draft_send', 'signal_disconnect']],
  ['book-workspace', ['ascend_overview', 'ascend_detail', 'ascend_progress', 'book_create_context', 'book_write']],
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
      ['travel-workspace', 'compass_overview', {}],
      ['travel-workspace', 'compass_place_create', { name: 'Lisbon', latitude: 38.72, longitude: -9.14, countryCode: 'PT' }],
      ['travel-workspace', 'compass_visit_create', { placeKey }],
      ['travel-workspace', 'compass_trip_create', { name: 'Portugal' }],
      ['travel-workspace', 'compass_trip_place_add', { tripKey, placeKey }],
      ['travel-workspace', 'compass_trip_place_remove', { tripKey, placeKey }],
      ['signal-workspace', 'signal_overview', {}],
      ['signal-workspace', 'signal_sync', {}],
      ['signal-workspace', 'signal_thread', { threadKey }],
      ['signal-workspace', 'signal_favorite', { threadKey, isFavorite: true }],
      ['signal-workspace', 'signal_draft', { threadKey, tone: 'warm' }],
      ['signal-workspace', 'signal_draft_update', { draftKey, finalContent: 'Thanks.' }],
      ['signal-workspace', 'signal_draft_send', { draftKey }],
      ['signal-workspace', 'signal_disconnect', {}],
      ['book-workspace', 'ascend_overview', {}],
      ['book-workspace', 'ascend_detail', { bookKey }],
      ['book-workspace', 'ascend_progress', { bookKey, chapterKey, progressSeconds: 30, isCompleted: false }],
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
    const create = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'archive_folder_create')!;
    const context: any = { domain, requestKey: 'stable-request', executeContent };
    await create.execute({ name: 'xyz' }, context);
    await create.execute({ name: 'xyz' }, context);
    expect(calls).toEqual([
      ['folder.create', { folders: [{ scopeKey, name: 'xyz' }], idempotencyKey: 'stable-request:archive_folder_create' }, domain, undefined],
      ['folder.create', { folders: [{ scopeKey, name: 'xyz' }], idempotencyKey: 'stable-request:archive_folder_create' }, domain, undefined],
    ]);
  });
});

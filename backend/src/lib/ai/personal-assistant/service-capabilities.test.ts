import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { defaultAssistantCapabilityRegistry, type AssistantSurface } from './capabilities';

const organizationKey = newId();
const scopeKey = newId();
const userKey = newId();
const domain = {
  organizationKey,
  runtimeScopeKey: scopeKey,
  principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } },
} as unknown as ToolContext;

const expected: Array<[AssistantSurface, string[]]> = [
  ['knowledge-workspace', ['app.enhance', 'app.translate', 'app.speech', 'content.hidden.list', 'folder.hide', 'folder.reveal', 'document.hide', 'document.reveal', 'folder.list', 'folder.create', 'folder.update', 'folder.move', 'folder.copy', 'document.list', 'document.find', 'document.create', 'document.update', 'document.rename', 'document.move', 'document.copy', 'document.summarize', 'document.topics', 'document.list-summaries', 'document.find-summary', 'document.audio.playback.update', 'document.audio.playback.clear', 'document.list-versions', 'document.restore-version', 'document.download', 'content.neighbors', 'content.search-history.delete', 'note.write']],
  ['travel-workspace', ['place.find', 'place.list', 'place.reference.generate', 'place.reference.list', 'trip.list', 'trip.guide.generate', 'trip.guide.list', 'trip.create', 'trip.update', 'trip.delete', 'trip.attachment.set', 'place.guide.find', 'place.find-city', 'place.find-children', 'place.create', 'place.update', 'place.delete', 'place.open']],
  ['signal-workspace', ['app.enhance', 'app.translate', 'email.overview', 'inbox.refresh', 'inbox.sort', 'inbox.update', 'email.thread.read', 'email.thread.read-state', 'email.thread.favorite', 'email.thread.trash', 'email.trash.clear', 'email.similar.find', 'email.message.translation.list', 'email.message.translation.delete', 'email.message.summarize', 'email.message.summary.list', 'email.message.summary.delete', 'email.draft.create', 'email.draft.compose', 'email.tone.list', 'email.tone.create', 'email.tone.update', 'email.tone.delete', 'email.reply-context.list', 'email.reply-context.create', 'email.reply-context.update', 'email.reply-context.delete', 'email.draft.update', 'email.draft.assign', 'email.draft.send', 'email.draft.delete']],
  ['book-workspace', ['book.list', 'book.topic.suggest', 'book.goal.suggest', 'book.detail', 'book.extend', 'book.share.detail', 'book.share.update', 'book.chapter.progress', 'book.create', 'book.generation.retry', 'book.generation.cancel', 'book.favorite', 'book.delete']],
];

describe('personal assistant service capabilities', () => {
  test.each(expected)('registers the model-safe %s tool table', (surface, names) => {
    const capabilities = defaultAssistantCapabilityRegistry.resolve(surface);
    expect(capabilities.map(({ definition }) => definition.name)).toEqual(['app.search', ...names]);
    for (const { definition } of capabilities) {
      const properties = definition.inputSchema.properties as Record<string, unknown> | undefined;
      expect(properties).not.toHaveProperty('scopeKey');
      expect(properties).not.toHaveProperty('organizationKey');
      expect(properties).not.toHaveProperty('userKey');
      expect(properties).not.toHaveProperty('idempotencyKey');
    }
  });

  test('does not expose transient travel hero generation as a model tool', () => {
    const capabilities = defaultAssistantCapabilityRegistry.resolve('travel-workspace');
    expect(capabilities.some(({ definition }) => definition.name === 'place.images.generate')).toBe(false);
    expect(capabilities.find(({ definition }) => definition.name === 'place.list')?.definition.description).toBe('List saved and recently opened places.');
  });

  test('keeps inbox and tone mutation model inputs strict and non-empty', () => {
    const signal = defaultAssistantCapabilityRegistry.resolve('signal-workspace');
    for (const name of ['inbox.refresh', 'inbox.sort', 'inbox.update', 'email.thread.favorite', 'email.thread.read-state', 'email.thread.trash', 'email.trash.clear', 'email.tone.create', 'email.tone.update', 'email.tone.delete', 'email.reply-context.list', 'email.reply-context.create', 'email.reply-context.update', 'email.reply-context.delete', 'email.draft.delete']) {
      const schema = signal.find(({ definition }) => definition.name === name)!.inputSchema;
      expect(() => schema.parse({ forged: true })).toThrow();
    }
    expect(() => signal.find(({ definition }) => definition.name === 'inbox.update')!.inputSchema.parse({ connectorKey: newId() })).toThrow();
    expect(() => signal.find(({ definition }) => definition.name === 'email.tone.update')!.inputSchema.parse({ toneKey: newId() })).toThrow();
    expect(() => signal.find(({ definition }) => definition.name === 'email.reply-context.update')!.inputSchema.parse({ noteKey: newId() })).toThrow();
    const noteKey = newId();
    expect(() => signal.find(({ definition }) => definition.name === 'email.reply-context.delete')!.inputSchema.parse({ noteKeys: [noteKey, noteKey] })).toThrow();
  });

  test('keeps the unified email overview tool strict and unambiguous', () => {
    const schema = defaultAssistantCapabilityRegistry.resolve('signal-workspace').find(({ definition }) => definition.name === 'email.overview')!.inputSchema;
    const connectorKey = newId();
    expect(schema.parse({ connectorKey, readState: 'read', facets: ['urgent', 'favorite'] })).toEqual({ connectorKey, readState: 'read', facets: ['urgent', 'favorite'] });
    expect(() => schema.parse({ connectorKey, filter: 'all', readState: 'read', facets: ['urgent'] })).toThrow();
    expect(() => schema.parse({ connectorKey, readState: 'read', facets: ['invalid'] })).toThrow();
    expect(() => schema.parse({ connectorKey, readState: 'read', facets: [], unknown: true })).toThrow();
  });

  test('rejects untrusted city context and inactive membership before canonical city lookup', async () => {
    let calls = 0;
    const travel: any = { findCity: async () => { calls += 1; return {}; } };
    const capability = defaultAssistantCapabilityRegistry.resolve('travel-workspace').find(({ definition }) => definition.name === 'place.find-city')!;
    const input = { city: 'Tokyo', country: { name: 'Japan', code: 'JP', continent: 'Asia', lat: 36.2, lon: 138.2 } };
    await expect(capability.execute({ ...input, organizationKey }, { domain, travel } as any)).rejects.toThrow('Unrecognized key');
    const principal = domain.principal as Extract<ToolContext['principal'], { kind: 'member' }>;
    await expect(capability.execute(input, { domain: { ...domain, principal: { ...principal, userOrganization: { ...principal.userOrganization, status: 'inactive' } } }, travel } as any)).rejects.toThrow('Active matching');
    expect(calls).toBe(0);
  });

  test('rejects non-contract draft fields from a Core service result', async () => {
    const draftKey = newId();
    const capability = defaultAssistantCapabilityRegistry.resolve('signal-workspace').find(({ definition }) => definition.name === 'email.draft.compose')!;
    const email = { draftNew: async () => ({ key: draftKey, variant: 'new', to: ['person@example.com'], subject: 'Subject', generatedContent: 'Body', status: 'generated', createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', scopeKey }) };
    await expect(capability.execute({ to: ['person@example.com'], generationMode: 'preserve', subject: 'Subject', authoredBody: 'Body' }, { domain, email } as any)).rejects.toThrow('Unrecognized key');
  });

  test('routes every built-in Swedish tone draft through the canonical compose service', async () => {
    const capability = defaultAssistantCapabilityRegistry.resolve('signal-workspace').find(({ definition }) => definition.name === 'email.draft.compose')!;
    const calls: unknown[] = [];
    const email = { draftNew: async (...args: unknown[]) => {
      calls.push(args);
      const input = args[1] as { tone: string };
      return { key: newId(), variant: 'new', to: ['john@example.com'], subject: 'Mötet', generatedContent: 'Hej John,\n\nVi hörs om mötet.', tone: input.tone, status: 'generated', createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' };
    } };
    const tones = ['casual', 'formal', 'direct'] as const;

    await Promise.all(tones.map((tone) => capability.execute({
      to: ['john@example.com'], generationMode: 'generate', subject: 'medelande', authoredBody: 'möte', tone,
    }, { domain, email, requestKey: `swedish-${tone}` } as any)));

    expect(calls).toEqual(tones.map((tone) => [{ userKey, organizationKey, scopeKey }, {
      to: ['john@example.com'], generationMode: 'generate', subject: 'medelande', authoredBody: 'möte', tone,
    }, `swedish-${tone}`]));
  });

  test('executes canonical services with identity derived only from the member principal', async () => {
    const threadKey = newId();
    const draftKey = newId();
    const bookKey = newId();
    const chapterKey = newId();
    const calls: unknown[] = [];
    const generated = { key: newId(), documentKey: threadKey, version: 1, content: 'Bonjour.', summary: 'Summary.', style: 'brief', sourceTitle: 'Subject', sourceDocumentUpdatedAt: '2026-08-23T00:00:00.000Z', createdAt: '2026-08-23T00:00:00.000Z', embedding: [1], chunkEmbeddings: [[1]], scopeKey, createdByKey: userKey };
    const draftOutput = { key: draftKey, variant: 'new' as const, connectorKey: threadKey, to: ['person@example.com'], bcc: ['hidden@example.com'], subject: 'Subject', generatedContent: 'Body', status: 'generated' as const, createdAt: generated.createdAt, updatedAt: generated.createdAt };
    const travel: any = {
      overview: async (...args: unknown[]) => { calls.push(['travel.overview', ...args]); return {}; },
      findPlaces: async (...args: unknown[]) => { calls.push(['travel.findPlaces', ...args]); return {}; },
      searchPlaces: async (...args: unknown[]) => { calls.push(['travel.searchPlaces', ...args]); return {}; },
      listTrips: async (...args: unknown[]) => { calls.push(['travel.listTrips', ...args]); return {}; },
      searchTrips: async (...args: unknown[]) => { calls.push(['travel.searchTrips', ...args]); return {}; },
      createTrip: async (...args: unknown[]) => { calls.push(['travel.createTrip', ...args]); return {}; },
      updateTrip: async (...args: unknown[]) => { calls.push(['travel.updateTrip', ...args]); return {}; },
      deleteTrip: async (...args: unknown[]) => { calls.push(['travel.deleteTrip', ...args]); return {}; },
      setTripAttachments: async (...args: unknown[]) => { calls.push(['travel.setTripAttachments', ...args]); return {}; },
      findPlaceGuide: async (...args: unknown[]) => { calls.push(['travel.findPlaceGuide', ...args]); return {}; },
      findCity: async (...args: unknown[]) => { calls.push(['travel.findCity', ...args]); return {}; },
      createPlace: async (...args: unknown[]) => { calls.push(['travel.createPlace', ...args]); return {}; },
      updatePlace: async (...args: unknown[]) => { calls.push(['travel.updatePlace', ...args]); return {}; },
      deletePlace: async (...args: unknown[]) => { calls.push(['travel.deletePlace', ...args]); return {}; },
      findChildren: async (...args: unknown[]) => { calls.push(['travel.findChildren', ...args]); return {}; },
      openPlace: async (...args: unknown[]) => { calls.push(['travel.openPlace', ...args]); return {}; },
    };
    const countries: any = { search: async (...args: unknown[]) => { calls.push(['countries.search', ...args]); return {}; } };
    const email: any = {
      overview: async (...args: unknown[]) => { calls.push(['email.overview', ...args]); return { messages: [{ bcc: ['overview-hidden@example.com'], body: 'safe' }] }; },
      sync: async (...args: unknown[]) => { calls.push(['email.sync', ...args]); return {}; },
      searchInboxes: async (...args: unknown[]) => { calls.push(['email.searchInboxes', ...args]); return {}; },
      searchTones: async (...args: unknown[]) => { calls.push(['email.searchTones', ...args]); return {}; },
      sort: async (...args: unknown[]) => { calls.push(['email.sort', ...args]); return {}; },
      updateInbox: async (...args: unknown[]) => { calls.push(['email.updateInbox', ...args]); return {}; },
      threadForTool: async (...args: unknown[]) => { calls.push(['email.threadForTool', ...args]); return {}; },
      setReadState: async (...args: unknown[]) => { calls.push(['email.setReadState', ...args]); return {}; },
      setFavorite: async (...args: unknown[]) => { calls.push(['email.setFavorite', ...args]); return {}; },
      trashThread: async (...args: unknown[]) => { calls.push(['email.trashThread', ...args]); return {}; },
      clearTrash: async (...args: unknown[]) => { calls.push(['email.clearTrash', ...args]); return {}; },
      findSimilar: async (...args: unknown[]) => { calls.push(['email.findSimilar', ...args]); return {}; },
      translateMessage: async (...args: unknown[]) => { calls.push(['email.translateMessage', ...args]); return { messageKey: threadKey, language: 'French', version: generated }; },
      listMessageTranslations: async (...args: unknown[]) => { calls.push(['email.listMessageTranslations', ...args]); return { messageKey: threadKey, versions: [generated] }; },
      deleteMessageTranslations: async (...args: unknown[]) => { calls.push(['email.deleteMessageTranslations', ...args]); return { messageKey: threadKey, deletedKeys: [generated.key] }; },
      summarizeMessage: async (...args: unknown[]) => { calls.push(['email.summarizeMessage', ...args]); return { messageKey: threadKey, text: 'Summary.', summary: generated }; },
      listMessageSummaries: async (...args: unknown[]) => { calls.push(['email.listMessageSummaries', ...args]); return { messageKey: threadKey, summaries: [generated] }; },
      deleteMessageSummaries: async (...args: unknown[]) => { calls.push(['email.deleteMessageSummaries', ...args]); return { messageKey: threadKey, deletedKeys: [generated.key] }; },
      draft: async (...args: unknown[]) => { calls.push(['email.draft', ...args]); return draftOutput; },
      draftNew: async (...args: unknown[]) => { calls.push(['email.draftNew', ...args]); return draftOutput; },
      tones: async (...args: unknown[]) => { calls.push(['email.tones', ...args]); return {}; },
      createTone: async (...args: unknown[]) => { calls.push(['email.createTone', ...args]); return {}; },
      updateTone: async (...args: unknown[]) => { calls.push(['email.updateTone', ...args]); return {}; },
      deleteTone: async (...args: unknown[]) => { calls.push(['email.deleteTone', ...args]); return {}; },
      listReplyContext: async (...args: unknown[]) => { calls.push(['email.listReplyContext', ...args]); return {}; },
      createReplyContext: async (...args: unknown[]) => { calls.push(['email.createReplyContext', ...args]); return {}; },
      updateReplyContext: async (...args: unknown[]) => { calls.push(['email.updateReplyContext', ...args]); return {}; },
      deleteReplyContext: async (...args: unknown[]) => { calls.push(['email.deleteReplyContext', ...args]); return {}; },
      updateDraft: async (...args: unknown[]) => { calls.push(['email.updateDraft', ...args]); return draftOutput; },
      assignDraft: async (...args: unknown[]) => { calls.push(['email.assignDraft', ...args]); return draftOutput; },
      sendDraft: async (...args: unknown[]) => { calls.push(['email.sendDraft', ...args]); return {}; },
      deleteDraft: async (...args: unknown[]) => { calls.push(['email.deleteDraft', ...args]); return {}; },
    };
    const books: any = {
      overview: async (...args: unknown[]) => { calls.push(['books.overview', ...args]); return {}; },
      suggestTopics: async (...args: unknown[]) => { calls.push(['books.suggestTopics', ...args]); return { topics: [] }; },
      suggestGoals: async (...args: unknown[]) => { calls.push(['books.suggestGoals', ...args]); return { goals: [] }; },
      detail: async (...args: unknown[]) => { calls.push(['books.detail', ...args]); return {}; },
      progress: async (...args: unknown[]) => { calls.push(['books.progress', ...args]); return {}; },
      create: async (...args: unknown[]) => { calls.push(['books.create', ...args]); return {}; },
      setFavorite: async (...args: unknown[]) => { calls.push(['books.setFavorite', ...args]); return {}; },
    };
    const context: any = { domain, requestKey: 'request-1', travel, countries, email, books };
    const cases: Array<[AssistantSurface, string, unknown]> = [
      ['travel-workspace', 'place.list', {}],
      ['travel-workspace', 'place.find', { query: 'Japan' }],
      ['travel-workspace', 'trip.list', {}],
      ['travel-workspace', 'trip.create', { name: 'Japan', placeKeys: [scopeKey] }],
      ['travel-workspace', 'trip.update', { tripKey: scopeKey, isFavorite: true }],
      ['travel-workspace', 'trip.delete', { tripKey: scopeKey }],
      ['travel-workspace', 'trip.attachment.set', { tripKey: scopeKey, attachments: [{ type: 'collection', key: scopeKey }] }],
      ['travel-workspace', 'place.guide.find', { query: 'Japan' }],
      ['travel-workspace', 'place.find-city', { city: 'Tokyo', country: { name: 'Japan', code: 'JP', continent: 'Asia', lat: 36.2, lon: 138.2 } }],
      ['travel-workspace', 'place.create', { name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2, longitude: 138.2, imageRequestToken: 'token' }],
      ['travel-workspace', 'place.update', { placeKey: scopeKey, status: 'visited', isFavorite: true }],
      ['travel-workspace', 'place.delete', { placeKey: scopeKey }],
      ['travel-workspace', 'place.find-children', { childrenRequestToken: 'children-token' }],
      ['travel-workspace', 'place.open', { name: 'Japan', countryCode: 'JP' }],
      ['signal-workspace', 'email.overview', { connectorKey: threadKey, readState: 'unread', facets: ['urgent', 'favorite'] }],
      ['signal-workspace', 'inbox.refresh', { connectorKey: threadKey }],
      ['signal-workspace', 'inbox.sort', { connectorKey: threadKey }],
      ['signal-workspace', 'inbox.update', { connectorKey: threadKey, isFavorite: true }],
      ['signal-workspace', 'email.thread.read', { threadKey }],
      ['signal-workspace', 'email.thread.read-state', { threadKey, isRead: true }],
      ['signal-workspace', 'email.thread.favorite', { threadKey, isFavorite: true }],
      ['signal-workspace', 'email.thread.trash', { threadKey }],
      ['signal-workspace', 'email.trash.clear', { connectorKey: threadKey }],
      ['signal-workspace', 'email.similar.find', { messageKey: threadKey }],
      ['signal-workspace', 'app.translate', { messageKey: threadKey, targetLanguage: 'French' }],
      ['signal-workspace', 'email.message.translation.list', { messageKey: threadKey }],
      ['signal-workspace', 'email.message.translation.delete', { messageKey: threadKey, translationKeys: [generated.key] }],
      ['signal-workspace', 'email.message.summarize', { messageKey: threadKey }],
      ['signal-workspace', 'email.message.summary.list', { messageKey: threadKey }],
      ['signal-workspace', 'email.message.summary.delete', { messageKey: threadKey, summaryKeys: [generated.key] }],
      ['signal-workspace', 'email.draft.create', { threadKey, tone: 'warm' }],
      ['signal-workspace', 'email.draft.compose', { to: ['person@example.com'], generationMode: 'preserve', subject: '', authoredBody: '' }],
      ['signal-workspace', 'email.tone.list', {}],
      ['signal-workspace', 'email.tone.create', { name: 'Calm', instruction: 'Write calmly.' }],
      ['signal-workspace', 'email.tone.update', { toneKey: threadKey, instruction: 'Write very calmly.' }],
      ['signal-workspace', 'email.tone.delete', { toneKey: threadKey }],
      ['signal-workspace', 'email.reply-context.list', {}],
      ['signal-workspace', 'email.reply-context.create', { name: 'Availability', text: 'Never promise Friday meetings.' }],
      ['signal-workspace', 'email.reply-context.update', { noteKey: threadKey, text: 'Never promise Monday meetings.' }],
      ['signal-workspace', 'email.reply-context.delete', { noteKeys: [threadKey] }],
      ['signal-workspace', 'email.draft.update', { draftKey, finalContent: 'Thanks.', attachments: [{ type: 'document', key: threadKey }] }],
      ['signal-workspace', 'email.draft.assign', { draftKey, connectorKey: threadKey }],
      ['signal-workspace', 'email.draft.send', { draftKey }],
      ['signal-workspace', 'email.draft.delete', { draftKey }],
      ['book-workspace', 'book.list', {}],
      ['book-workspace', 'book.topic.suggest', { excludeTopics: ['Old idea'] }],
      ['book-workspace', 'book.goal.suggest', { topic: 'Decision making', excludeGoals: ['Old goal'] }],
      ['book-workspace', 'book.detail', { bookKey }],
      ['book-workspace', 'book.chapter.progress', { bookKey, chapterKey, progressSeconds: 30, isCompleted: false }],
      ['book-workspace', 'book.create', { topic: 'Decision making', goal: 'Decide well', currentKnowledge: 'Basic familiarity', writingTone: 'Clear', language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear', narrationPace: 1 }],
      ['book-workspace', 'book.favorite', { bookKey, isFavorite: true }],
    ];
    const outputs = new Map<string, unknown>();
    for (const [surface, capabilityName, input] of cases) outputs.set(capabilityName, await defaultAssistantCapabilityRegistry.resolve(surface).find(({ definition }) => definition.name === capabilityName)!.execute(input, context));
    for (const name of ['app.translate', 'email.message.translation.list', 'email.message.translation.delete', 'email.message.summarize', 'email.message.summary.list', 'email.message.summary.delete']) expect(JSON.stringify(outputs.get(name))).not.toMatch(/embedding|chunkEmbeddings|scopeKey|createdByKey/);
    for (const name of ['email.overview', 'email.draft.create', 'email.draft.compose', 'email.draft.update', 'email.draft.assign']) expect(JSON.stringify(outputs.get(name))).not.toMatch(/bcc|hidden@example.com/i);
    const serviceContext = { organizationKey, scopeKey };
    const actor = { userKey, ...serviceContext };
    expect(calls).toContainEqual(['travel.overview', serviceContext, userKey]);
    expect(calls).toContainEqual(['travel.findPlaces', { ...serviceContext, query: 'Japan' }, userKey, { signal: undefined, timeoutMs: undefined }]);
    expect(calls).toContainEqual(['travel.listTrips', serviceContext, userKey]);
    expect(calls).toContainEqual(['travel.createTrip', { ...serviceContext, name: 'Japan', placeKeys: [scopeKey], idempotencyKey: 'request-1:trip.create' }, userKey]);
    expect(calls).toContainEqual(['travel.updateTrip', { ...serviceContext, tripKey: scopeKey, isFavorite: true }, userKey]);
    expect(calls).toContainEqual(['travel.deleteTrip', { ...serviceContext, tripKey: scopeKey }, userKey]);
    expect(calls).toContainEqual(['travel.setTripAttachments', { ...serviceContext, tripKey: scopeKey, attachments: [{ type: 'collection', key: scopeKey }] }, userKey]);
    expect(calls).toContainEqual(['travel.findPlaceGuide', { ...serviceContext, query: 'Japan' }, userKey, { signal: undefined, timeoutMs: undefined }]);
    expect(calls).toContainEqual(['travel.findCity', { ...serviceContext, city: 'Tokyo', country: { name: 'Japan', code: 'JP', continent: 'Asia', lat: 36.2, lon: 138.2 } }, userKey, { signal: undefined, timeoutMs: undefined }]);
    expect(calls).toContainEqual(['travel.createPlace', { ...serviceContext, name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2, longitude: 138.2, imageRequestToken: 'token' }, userKey, { signal: undefined, timeoutMs: undefined }]);
    expect(calls).toContainEqual(['travel.updatePlace', { ...serviceContext, placeKey: scopeKey, status: 'visited', isFavorite: true }, userKey]);
    expect(calls).toContainEqual(['travel.deletePlace', { ...serviceContext, placeKey: scopeKey }, userKey]);
    expect(calls).toContainEqual(['travel.findChildren', { ...serviceContext, childrenRequestToken: 'children-token' }, userKey, { signal: undefined, timeoutMs: undefined }]);
    expect(calls).toContainEqual(['travel.openPlace', { ...serviceContext, name: 'Japan', countryCode: 'JP' }, userKey]);
    expect(calls).toContainEqual(['email.overview', actor, { connectorKey: threadKey, readState: 'unread', facets: ['urgent', 'favorite'] }]);
    expect(calls).toContainEqual(['email.sync', actor, threadKey]);
    expect(calls).toContainEqual(['email.sort', actor, { connectorKey: threadKey }]);
    expect(calls).toContainEqual(['email.threadForTool', actor, threadKey, undefined]);
    expect(calls).toContainEqual(['email.setReadState', actor, { threadKey, isRead: true }, false, 'request-1']);
    expect(calls).toContainEqual(['email.clearTrash', actor, { connectorKey: threadKey }, false, undefined, 'request-1']);
    expect(calls).toContainEqual(['email.assignDraft', actor, { draftKey, connectorKey: threadKey }, 'request-1']);
    expect(calls).toContainEqual(['email.deleteTone', actor, { toneKey: threadKey }, 'request-1']);
    expect(calls).toContainEqual(['email.deleteDraft', actor, { draftKey }, 'request-1']);
    expect(calls).toContainEqual(['email.listReplyContext', actor]);
    expect(calls).toContainEqual(['email.createReplyContext', actor, { name: 'Availability', text: 'Never promise Friday meetings.' }, 'request-1']);
    expect(calls).toContainEqual(['email.updateReplyContext', actor, { noteKey: threadKey, text: 'Never promise Monday meetings.' }, 'request-1']);
    expect(calls).toContainEqual(['email.deleteReplyContext', actor, { noteKeys: [threadKey] }, 'request-1']);
    expect(calls).toContainEqual(['email.updateDraft', actor, { draftKey, finalContent: 'Thanks.', attachments: [{ type: 'document', key: threadKey }] }, 'request-1']);
    expect(calls).toContainEqual(['books.progress', bookKey, chapterKey, { ...serviceContext, progressSeconds: 30, isCompleted: false }, userKey]);
    expect(calls).toContainEqual(['books.suggestTopics', { ...serviceContext, excludeTopics: ['Old idea'] }, userKey, { signal: undefined, timeoutMs: undefined }]);
    expect(calls).toContainEqual(['books.suggestGoals', { ...serviceContext, topic: 'Decision making', excludeGoals: ['Old goal'] }, userKey, { signal: undefined, timeoutMs: undefined }]);
    expect(calls).toContainEqual(['books.create', { ...serviceContext, generationRequestKey: 'request-1', topic: 'Decision making', goal: 'Decide well', currentKnowledge: 'Basic familiarity', writingTone: 'Clear', language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear', narrationPace: 1 }, userKey]);
    expect(calls).toContainEqual(['books.setFavorite', bookKey, { ...serviceContext, isFavorite: true }, userKey]);
    expect(JSON.stringify(calls)).not.toContain((domain.principal as Extract<ToolContext['principal'], { kind: 'member' }>).userOrganization.key);
  });

  test('marks durable place generation and creation as Compass mutations', () => {
    const capabilities = defaultAssistantCapabilityRegistry.resolve('travel-workspace');
    expect(capabilities.find(({ definition }) => definition.name === 'place.guide.find')?.mutationWorkspace).toBe('compass');
    expect(capabilities.find(({ definition }) => definition.name === 'place.find-city')?.mutationWorkspace).toBe('compass');
    expect(capabilities.find(({ definition }) => definition.name === 'place.find-children')?.mutationWorkspace).toBe('compass');
    expect(capabilities.find(({ definition }) => definition.name === 'place.create')?.mutationWorkspace).toBe('compass');
    expect(capabilities.find(({ definition }) => definition.name === 'place.update')?.mutationWorkspace).toBe('compass');
    expect(capabilities.find(({ definition }) => definition.name === 'place.delete')?.mutationWorkspace).toBe('compass');
    expect(capabilities.find(({ definition }) => definition.name === 'place.open')?.mutationWorkspace).toBe('compass');
    expect(capabilities.find(({ definition }) => definition.name === 'trip.create')?.mutationWorkspace).toBe('compass');
    expect(capabilities.find(({ definition }) => definition.name === 'trip.guide.generate')?.mutationWorkspace).toBe('compass');
    expect(capabilities.find(({ definition }) => definition.name === 'place.reference.generate')?.mutationWorkspace).toBe('compass');
    expect(capabilities.find(({ definition }) => definition.name === 'trip.update')?.mutationWorkspace).toBe('compass');
    expect(capabilities.find(({ definition }) => definition.name === 'trip.delete')?.mutationWorkspace).toBe('compass');
    expect(capabilities.find(({ definition }) => definition.name === 'trip.attachment.set')?.mutationWorkspace).toBe('compass');
    expect(capabilities.find(({ definition }) => definition.name === 'trip.list')?.mutationWorkspace).toBeUndefined();
    expect(capabilities.find(({ definition }) => definition.name === 'trip.guide.list')?.mutationWorkspace).toBeUndefined();
    expect(capabilities.find(({ definition }) => definition.name === 'place.reference.list')?.mutationWorkspace).toBeUndefined();
    expect(capabilities.find(({ definition }) => definition.name === 'place.search')).toBeUndefined();
    expect(capabilities.find(({ definition }) => definition.name === 'place.find')?.mutationWorkspace).toBeUndefined();
    expect(capabilities.find(({ definition }) => definition.name === 'trip.search')).toBeUndefined();
  });

  test('marks Signal mutations, including permanent Trash clearing, as workspace changes', () => {
    const capabilities = defaultAssistantCapabilityRegistry.resolve('signal-workspace');
    expect(capabilities).toHaveLength(32);
    expect(capabilities.find(({ definition }) => definition.name === 'email.reply-context.list')?.mutationWorkspace).toBeUndefined();
    for (const name of ['inbox.refresh', 'inbox.sort', 'inbox.update', 'email.thread.read-state', 'email.thread.favorite', 'email.thread.trash', 'email.trash.clear', 'email.message.translation.delete', 'email.message.summarize', 'email.message.summary.delete', 'email.draft.create', 'email.draft.compose', 'email.draft.update', 'email.draft.assign', 'email.draft.send', 'email.draft.delete', 'email.tone.create', 'email.tone.update', 'email.tone.delete', 'email.reply-context.create', 'email.reply-context.update', 'email.reply-context.delete']) expect(capabilities.find(({ definition }) => definition.name === name)?.mutationWorkspace).toBe('signal');
    const translateMutation = capabilities.find(({ definition }) => definition.name === 'app.translate')?.mutationWorkspace;
    expect(typeof translateMutation === 'function' ? translateMutation({ messageKey: newId(), targetLanguage: 'French' }) : undefined).toBe('signal');
  });

  test('marks favorite changes as Ascend mutations with strict model input', () => {
    const capability = defaultAssistantCapabilityRegistry.resolve('book-workspace').find(({ definition }) => definition.name === 'book.favorite')!;
    expect(capability.mutationWorkspace).toBe('ascend');
    expect(() => capability.inputSchema.parse({ bookKey: newId(), isFavorite: true, organizationKey })).toThrow('Unrecognized key');
  });

  test('injects runtime scope and stable request idempotency into Archive mutations', async () => {
    const calls: unknown[] = [];
    const executeContent = async (...args: unknown[]) => { calls.push(args); return {}; };
    const create = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'folder.create')!;
    const copy = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'folder.copy')!;
    const playback = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'document.audio.playback.update')!;
    const generateAudio = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'app.speech')!;
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
    expect(generateAudio.mutationWorkspace).toBe('archive');
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
    const brief = { topic: 'Decision making', goal: 'Decide well', currentKnowledge: 'Basic familiarity', writingTone: 'Clear', language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear', narrationPace: 1 };
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
    expect(() => create.inputSchema.parse({ ...brief, chapterCount: 10 })).toThrow('Unrecognized key');
    expect(create.mutationWorkspace).toBe('ascend');
  });

  test('injects the trusted open document into document-specific Core actions', async () => {
    const calls: unknown[] = [];
    const currentDocumentKey = newId();
    const executeContent = async (...args: unknown[]) => { calls.push(args); return {}; };
    const translate = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'app.translate')!;
    await translate.execute({ targetLanguage: 'Spanish' }, { domain, currentDocumentKey, requestKey: 'translate-request', executeContent: executeContent as any });
    expect(calls).toEqual([
      ['document.translate', { documentKeys: [currentDocumentKey], targetLanguage: 'Spanish', sourceLanguage: undefined, instruction: undefined, preserveFormatting: true, mode: 'replace', idempotencyKey: 'translate-request:app.translate' }, domain, undefined],
    ]);
  });

  test('passes any requested target language through unchanged', async () => {
    const calls: unknown[] = [];
    const currentDocumentKey = newId();
    const translate = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'app.translate')!;
    await translate.execute({ targetLanguage: 'Welsh' }, { domain, currentDocumentKey, requestKey: 'welsh-request', executeContent: (async (...args: unknown[]) => { calls.push(args); return {}; }) as any });
    expect(calls[0]).toEqual(['document.translate', { documentKeys: [currentDocumentKey], targetLanguage: 'Welsh', sourceLanguage: undefined, instruction: undefined, preserveFormatting: true, mode: 'replace', idempotencyKey: 'welsh-request:app.translate' }, domain, undefined]);
  });
});

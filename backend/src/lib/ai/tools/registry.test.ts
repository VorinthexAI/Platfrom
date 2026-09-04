import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from './tool-context';
import { CONTENT_TOOL_NAMES, isToolReadOnly, MODEL_TOOL_NAMES, runTool, runTrustedTool, TOOL_DEFINITIONS, TOOL_NAMES, toolInputSchemas } from './index';
import { signalCapabilities } from '@/lib/ai/personal-assistant/service-capabilities';
import { defaultAssistantCapabilityRegistry } from '@/lib/ai/personal-assistant/capabilities';

const billingFixture = {
  recordEvent: async () => {},
  billing: {
    charge: async (_userKey: string, input: Record<string, unknown>) => ({ status: 'applied', transaction: { key: newId(), eventKey: input.eventKey } }) as never,
    refund: async () => ({ status: 'applied', transaction: { key: newId() } }) as never,
  },
};

describe('unified tool registry', () => {
  test('has one unique definition for every public tool name', () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
    expect(new Set(TOOL_DEFINITIONS.map(({ name }) => name)).size).toBe(TOOL_DEFINITIONS.length);
    expect(TOOL_NAMES).toHaveLength(190);
    expect(MODEL_TOOL_NAMES).toHaveLength(187);
    expect(TOOL_DEFINITIONS).toHaveLength(187);
    expect(TOOL_DEFINITIONS).toHaveLength(CONTENT_TOOL_NAMES.length + 142);
    expect(TOOL_DEFINITIONS.map(({ name }) => name)).toEqual([...MODEL_TOOL_NAMES]);
    expect(TOOL_NAMES).not.toContain('chat');
    expect(TOOL_NAMES).not.toContain('orchestrator.chat');
    expect(TOOL_DEFINITIONS.some(({ name }) => name === 'chat')).toBe(false);
    expect(TOOL_NAMES).not.toContain('transcribe');
    expect(TOOL_NAMES).not.toContain('audio.generate');
    expect(TOOL_NAMES).not.toContain('document.summary.audio.generate');
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.caption')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.create-visual-identity')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'image.search')).toHaveLength(1);
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'web.search')).toHaveLength(1);
    expect(toolInputSchemas['web.search'].parse({ query: 'latest Gemini release' })).toEqual({ query: 'latest Gemini release' });
    for (const field of ['organizationKey', 'scopeKey', 'userKey', 'model', 'provider', 'engine', 'apiKey']) expect(() => toolInputSchemas['web.search'].parse({ query: 'latest Gemini release', [field]: 'forged' })).toThrow('Unrecognized key');
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'app.search')).toHaveLength(1);
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['app.enhance', 'app.translate', 'app.speech']));
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['tag.list', 'tag.create', 'tag.update', 'tag.delete', 'tag.assignment.set']));
    expect(toolInputSchemas['tag.list'].parse({})).toEqual({ limit: 50 });
    for (const name of ['tag.list', 'tag.create', 'tag.update', 'tag.delete', 'tag.assignment.set']) expect(() => toolInputSchemas[name].parse({ organizationKey: 'forged' })).toThrow('Unrecognized key');
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['billing.summary.read', 'profile.update', 'ticket.create', 'feedback.create', 'feedback.list', 'feedback.vote']));
    expect(toolInputSchemas['feedback.create'].parse({ message: 'Add dark mode' })).toEqual({ message: 'Add dark mode' });
    expect(toolInputSchemas['feedback.list'].parse({})).toEqual({ limit: 20 });
    expect(toolInputSchemas['feedback.vote'].parse({ ticketKey: newId(), vote: null })).toMatchObject({ vote: null });
    for (const name of ['feedback.create', 'feedback.list', 'feedback.vote']) expect(() => toolInputSchemas[name].parse({ userKey: newId() })).toThrow('Unrecognized key');
    for (const name of ['profile.update', 'ticket.create']) for (const field of ['organizationKey', 'scopeKey', 'userKey', 'membershipKey', 'idempotencyKey']) {
      const input = name === 'profile.update' ? { name: 'Ada Lovelace', [field]: 'forged' } : { message: 'Please help', [field]: 'forged' };
      expect(() => toolInputSchemas[name].parse(input)).toThrow('Unrecognized key');
    }
    expect(TOOL_DEFINITIONS.filter(({ name }) => name === 'app.speech')).toHaveLength(1);
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['book.extend', 'book.share.detail', 'book.share.update']));
    expect(() => toolInputSchemas['book.share.update'].parse({ bookKey: newId(), active: true, scopeKey: newId() })).toThrow('Unrecognized key');
    expect(toolInputSchemas['app.speech'].parse({ documentKey: newId() })).toMatchObject({ voice: 'clear', pace: 1, includeTitle: true, includeCode: false });
    for (const field of ['organizationKey', 'scopeKey', 'userKey', 'model', 'provider', 'storageKey', 'text']) expect(() => toolInputSchemas['app.speech'].parse({ documentKey: newId(), [field]: 'forged' })).toThrow('Unrecognized key');
    expect(TOOL_NAMES).not.toContain('document.enhance');
    expect(TOOL_NAMES).not.toContain('document.translate');
    expect(TOOL_NAMES).not.toContain('email.message.translate');
    expect(() => toolInputSchemas['app.search'].parse({ query: 'roadmap', collectionSlugs: ['folders', 'images'] })).toThrow();
    expect(toolInputSchemas['app.search'].parse({ query: 'roadmap', collectionSlugs: ['folders', 'images'], limit: 10 })).toEqual({ query: 'roadmap', collectionSlugs: ['folders', 'images'], recordHistory: true, limit: 10 });
    expect(toolInputSchemas['app.search'].parse({ operation: 'count', collectionSlugs: ['books'], limit: 10 })).toMatchObject({ operation: 'count', collectionSlugs: ['books'] });
    expect(toolInputSchemas['app.search'].parse({ operation: 'get', collectionSlugs: ['books'], key: newId(), limit: 1 })).toMatchObject({ operation: 'get' });
    expect(toolInputSchemas['app.search'].parse({ operation: 'count', collectionSlugs: ['images'], limit: 10 })).toMatchObject({ operation: 'count', collectionSlugs: ['images'] });
    expect(toolInputSchemas['app.search'].parse({ operation: 'sum', collectionSlugs: ['images'], field: 'sizeBytes', limit: 10 })).toMatchObject({ operation: 'sum', collectionSlugs: ['images'], field: 'sizeBytes' });
    expect(() => toolInputSchemas['app.search'].parse({ operation: 'sum', collectionSlugs: ['images'], field: 'width' })).toThrow();
    expect(() => toolInputSchemas['app.search'].parse({ operation: 'list', collectionSlugs: ['books'], query: 'unexpected' })).toThrow();
    expect(() => toolInputSchemas['app.search'].parse({ query: 'roadmap', collectionSlugs: ['folders'], minimumScore: 0.55 })).toThrow('Unrecognized key');
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
    expect(MODEL_TOOL_NAMES).not.toContain('inbox.sync');
    expect(TOOL_DEFINITIONS.some(({ name }) => name === 'inbox.sync')).toBe(false);
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['inbox.search', 'email.tone.search']));
    expect(toolInputSchemas['inbox.search'].parse({ query: 'leadership' })).toEqual({ query: 'leadership', minimumScore: 0.55, limit: 50, recordHistory: true });
    expect(toolInputSchemas['email.tone.search'].parse({ query: 'measured', recordHistory: false })).toMatchObject({ query: 'measured', recordHistory: false });
    expect(() => toolInputSchemas['inbox.search'].parse({ query: 'leadership', scopeKey: newId() })).toThrow('Unrecognized key');
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['email.similar.find', 'email.thread.trash', 'email.message.translation.list', 'email.message.translation.delete', 'email.message.summarize', 'email.message.summary.list', 'email.message.summary.delete']));
    expect(TOOL_NAMES).toContain('inbox.sort');
    expect(TOOL_NAMES).toContain('inbox.refresh');
    expect(() => toolInputSchemas['email.similar.find'].parse({ messageKey: newId(), categories: ['Other'] })).toThrow();
    expect(TOOL_NAMES).toContain('inbox.subscribe');
    expect(MODEL_TOOL_NAMES).not.toContain('inbox.subscribe');
    expect(TOOL_DEFINITIONS.some(({ name }) => name === 'inbox.subscribe')).toBe(false);
    expect(TOOL_NAMES).toContain('email.draft.create-if-needed');
    expect(MODEL_TOOL_NAMES).not.toContain('email.draft.create-if-needed');
    expect(TOOL_DEFINITIONS.some(({ name }) => name === 'email.draft.create-if-needed')).toBe(false);
    expect(TOOL_NAMES).not.toContain('email.disconnect');
    expect(TOOL_NAMES).not.toContain('email.sync');
    const inboxSortConnectorKey = newId();
    expect(toolInputSchemas['inbox.sort'].parse({ connectorKey: inboxSortConnectorKey })).toEqual({ connectorKey: inboxSortConnectorKey });
    expect(toolInputSchemas['inbox.refresh'].parse({ connectorKey: inboxSortConnectorKey })).toEqual({ connectorKey: inboxSortConnectorKey });
    expect(toolInputSchemas['inbox.sync'].parse({ connectorKey: inboxSortConnectorKey })).toEqual({ connectorKey: inboxSortConnectorKey });
    expect(toolInputSchemas['inbox.subscribe'].parse({ connectorKey: inboxSortConnectorKey, notificationHistoryId: '123' })).toEqual({ connectorKey: inboxSortConnectorKey, notificationHistoryId: '123' });
    expect(toolInputSchemas['email.draft.create-if-needed'].parse({ connectorKey: inboxSortConnectorKey, threadKey: newId(), messageKey: newId() })).toHaveProperty('connectorKey', inboxSortConnectorKey);
    for (const tool of ['inbox.sync', 'inbox.subscribe']) for (const field of ['organizationKey', 'scopeKey', 'userKey', 'accessToken']) expect(() => toolInputSchemas[tool].parse({ connectorKey: inboxSortConnectorKey, [field]: newId() })).toThrow('Unrecognized key');
    for (const tool of ['inbox.refresh', 'inbox.sort']) for (const field of ['organizationKey', 'scopeKey', 'userKey']) expect(() => toolInputSchemas[tool].parse({ connectorKey: inboxSortConnectorKey, [field]: newId() })).toThrow('Unrecognized key');
    expect(() => toolInputSchemas['email.draft.assign'].parse({ draftKey: newId(), connectorKey: newId(), scopeKey: newId() })).toThrow('Unrecognized key');
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['content.hidden.list', 'book.topic.suggest', 'book.goal.suggest', 'book.create', 'book.favorite', 'email.thread.read', 'email.thread.read-state', 'email.trash.clear']));
    expect(toolInputSchemas['book.favorite'].parse({ bookKey: newId(), isFavorite: true })).toMatchObject({ isFavorite: true });
    expect(() => toolInputSchemas['book.favorite'].parse({ bookKey: newId(), isFavorite: true, scopeKey: newId() })).toThrow('Unrecognized key');
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
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['conversation.create', 'conversation.list', 'conversation.search', 'conversation.rename', 'conversation.favorite', 'conversation.delete', 'conversation.message.list', 'conversation.message.delete', 'conversation.message.send', 'conversation.image.enqueue', 'agent.query', 'agents.core']));
    expect(TOOL_NAMES.filter((name) => name === 'agents.core')).toHaveLength(1);
    expect(TOOL_NAMES).not.toContain('assistant.query');
    expect(toolInputSchemas['agent.query'].parse({ query: 'history' })).toEqual({ query: 'history', limit: 20 });
    expect(toolInputSchemas['agent.query'].parse({ query: 'history', limit: 20 })).toEqual({ query: 'history', limit: 20 });
    expect(() => toolInputSchemas['agent.query'].parse({ query: 'history', limit: 21 })).toThrow();
    expect(() => toolInputSchemas['agent.query'].parse({ query: 'history', conversationKey: newId() })).toThrow('Unrecognized key');
    const agentQueryDefinition = TOOL_DEFINITIONS.find(({ name }) => name === 'agent.query')!;
    expect(agentQueryDefinition.description).toContain('completed private messages across the authenticated user\'s conversations in the current organization and scope');
    expect(agentQueryDefinition.description).toContain('only when context beyond the supplied recent messages is needed');
    expect(agentQueryDefinition.inputSchema).toMatchObject({ type: 'object', additionalProperties: false, required: ['query'], properties: { limit: { default: 20, maximum: 20 } } });
    expect(() => toolInputSchemas['conversation.message.send'].parse({ conversationKey: newId(), message: 'hello', requestKey: 'forged' })).toThrow('Unrecognized key');
    expect(toolInputSchemas['conversation.image.enqueue'].parse({ prompt: 'hello' })).toEqual({ prompt: 'hello', referenceImageKeys: [], size: '1024x1024', quality: 'medium', mode: 'default' });
    expect(() => toolInputSchemas['conversation.image.enqueue'].parse({ conversationKey: newId(), prompt: 'hello' })).toThrow('Unrecognized key');
    expect(() => toolInputSchemas['conversation.message.delete'].parse({ conversationKey: newId(), messageKey: newId(), userKey: newId() })).toThrow('Unrecognized key');
    expect(toolInputSchemas['agents.core'].parse({ message: 'hello' })).toEqual({ message: 'hello', generateName: false });
    for (const field of ['systemPrompt', 'currentDate', 'requestKey', 'organizationKey', 'scopeKey', 'userKey', 'membership']) expect(() => toolInputSchemas['agents.core'].parse({ message: 'hello', [field]: 'forged' })).toThrow('Unrecognized key');
    expect(toolInputSchemas['conversation.list'].parse({})).toMatchObject({ favoriteOnly: false, limit: 25 });
    expect(toolInputSchemas['conversation.search'].parse({ query: 'saved', favoriteOnly: true })).toMatchObject({ favoriteOnly: true, recordHistory: true });
    expect(() => toolInputSchemas['app.search'].parse({ query: 'chat', collectionSlugs: ['conversations'] })).toThrow();
    const conversationNames = new Set(TOOL_NAMES.filter((name) => name.startsWith('conversation.')));
    for (const surface of ['knowledge-workspace', 'media-workspace', 'book-workspace', 'travel-workspace', 'signal-workspace'] as const) {
      expect(defaultAssistantCapabilityRegistry.resolve(surface).some(({ definition }) => conversationNames.has(definition.name))).toBe(false);
      expect(defaultAssistantCapabilityRegistry.resolve(surface).some(({ definition }) => definition.name === 'agent.query')).toBe(false);
    }
  });

  test('classifies model-visible execution effects from the canonical registry', () => {
    expect(isToolReadOnly('app.search', { query: 'roadmap', collectionSlugs: ['documents'], limit: 1 })).toBe(true);
    expect(isToolReadOnly('web.search', { query: 'current guidance' })).toBe(true);
    expect(isToolReadOnly('feedback.list', {})).toBe(true);
    expect(isToolReadOnly('tag.list', {})).toBe(true);
    expect(isToolReadOnly('conversation.list', {})).toBe(true);
    expect(isToolReadOnly('app.enhance', { text: 'Draft' })).toBe(true);

    expect(isToolReadOnly('profile.update', { name: 'Ada' })).toBe(false);
    expect(isToolReadOnly('feedback.vote', { ticketKey: newId(), vote: 'up' })).toBe(false);
    expect(isToolReadOnly('tag.create', { name: 'Plan' })).toBe(false);
    expect(isToolReadOnly('tag.assignment.set', { changes: [{ tagKey: newId(), target: { type: 'document', key: newId() }, assigned: true }] })).toBe(false);
    expect(isToolReadOnly('conversation.image.enqueue', { prompt: 'A dog' })).toBe(false);
    expect(isToolReadOnly('app.enhance', { documentKey: newId(), save: true })).toBe(false);
  });

  test('returns raw app.search results to unified observers while keeping model projection in the agent', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const raw = { query: 'roadmap', groups: [{ collectionSlug: 'documents', results: [{ key: newId(), name: 'Roadmap', scopeKey, isFavorite: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] }] };
    await expect(runTool('app.search', 'agents.core', { query: 'roadmap', collectionSlugs: ['documents'], limit: 1 }, { contentContext: context, appSearchService: { search: async () => raw } as never })).resolves.toEqual(raw);
  });

  test('executes profile and ticket tools through canonical services with trusted identity and context', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const calls: unknown[] = [];
    const accountProfileService = { updateName: async (...args: unknown[]) => { calls.push(['profile', ...args]); return { profile: { key: userKey, name: 'Ada Lovelace', profileStorageKey: null, updatedAt: '2026-09-03T10:00:00.000Z' } }; } } as any;
    const ticketService = { submit: async (...args: unknown[]) => { calls.push(['ticket', ...args]); return { key: newId(), message: 'Please help', createdAt: '2026-09-03T10:00:00.000Z' }; } } as any;
    const profileResult = await runTool('profile.update', '', { name: 'Ada Lovelace' }, { contentContext, accountProfileService });
    await runTool('ticket.create', '', { message: 'Please help' }, { contentContext, ticketService, requestKey: 'request-1' });
    expect(calls).toEqual([
      ['profile', { name: 'Ada Lovelace' }, userKey],
      ['ticket', { message: 'Please help' }, contentContext, 'request-1'],
    ]);
    expect(profileResult).toEqual({ profile: { name: 'Ada Lovelace' } });
    expect(profileResult).not.toHaveProperty('profile.key');
    expect(profileResult).not.toHaveProperty('profile.profileStorageKey');
    expect(profileResult).not.toHaveProperty('profile.updatedAt');
    expect(JSON.stringify(profileResult)).not.toMatch(/profileStorageKey|updatedAt|profiles\//);
  });

  test('injects trusted request context and keeps agent recall scope-wide', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId(), conversationKey = newId(), referenceImageKey = newId(); const calls: unknown[] = [];
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const conversations = { turn: async (input: unknown, _context: ToolContext, emit: (event: unknown) => void) => { calls.push(input); emit({ type: 'done' }); }, enqueueImageTurn: async (input: unknown) => { calls.push(input); return {}; }, deleteMessage: async (input: unknown) => { calls.push(input); return { deletedKeys: [] }; }, query: async (_context: ToolContext, input: unknown) => { calls.push(input); return { messages: [] }; } } as any;
    await runTool('conversation.message.send', '', { conversationKey, message: 'hello' }, { contentContext, conversationService: conversations, requestKey: 'trusted-request' });
    await runTool('conversation.image.enqueue', '', { prompt: 'draw this', referenceImageKeys: [newId()] }, { contentContext, conversationService: conversations, currentConversationKey: conversationKey, currentReferenceImageKeys: [referenceImageKey], requestKey: 'trusted-image-request' });
    const messageKey = newId(); await runTool('conversation.message.delete', '', { conversationKey, messageKey }, { contentContext, conversationService: conversations });
    await runTool('agent.query', '', { query: 'prior' }, { contentContext, conversationService: conversations });
    expect(calls).toEqual([{ conversationKey, message: 'hello', requestKey: 'trusted-request' }, { conversationKey, prompt: 'draw this', referenceImageKeys: [referenceImageKey], size: '1024x1024', quality: 'medium', mode: 'default', requestKey: 'trusted-image-request' }, { conversationKey, messageKey }, { query: 'prior', limit: 20 }]);
  });

  test('dispatches web search through the canonical action with trusted routing context', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const calls: unknown[] = [];
    const result = await runTool('web.search', '', { query: 'current information' }, {
      ...billingFixture,
      requestKey: 'web-request',
      contentContext,
      executeSearch: async (trustedOrganization, input, options) => {
        calls.push({ trustedOrganization, input, providers: options.providers });
        return { output: { text: 'Grounded answer', citations: [{ title: 'Source', url: 'https://example.com/source' }], sources: ['https://example.com/source'] }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, providerId: 'openrouter', modelId: 'model', externalModelId: 'model' };
      },
    });
    expect(calls).toEqual([{ trustedOrganization: organizationKey, input: { prompt: 'current information' }, providers: ['web.primary'] }]);
    expect(result).toMatchObject({ text: 'Grounded answer', citations: [{ url: 'https://example.com/source' }] });
  });

  test('dispatches the unique agents.core tool through the canonical lazy agent adapter', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const inputs: unknown[] = [];
    const result = await runTool('agents.core', '', { message: 'hello' }, {
      contentContext, requestKey: 'trusted-agent-request',
      conversationService: {} as any,
      agentDependencies: { stream: async function* (_organization, input) { inputs.push(input); yield { type: 'text-delta', text: '{"tools":[],"message":"Hello."}' }; yield { type: 'done' }; } },
    });
    expect(result).toEqual({ message: 'Hello.', tools: [] });
    expect(inputs).toHaveLength(1);
    await expect(runTool('agents.core', '', { message: 'hello' }, { contentContext, agentDependencies: { stream: async function* () {} } })).rejects.toThrow('trusted request key');
  });

  test('executes inbox ingestion tools only through trusted system context', async () => {
    const organizationKey = newId(), scopeKey = newId(), connectorKey = newId(), userKey = newId();
    const calls: unknown[][] = [];
    const emailService = {
      initialSync: async (...args: unknown[]) => { calls.push(['sync', ...args]); return { synced: 4, initialSyncCompleted: true }; },
      ingestSubscriptionNotification: async (...args: unknown[]) => { calls.push(['subscribe', ...args]); return { synced: 2 }; },
      continueSubscription: async (...args: unknown[]) => { calls.push(['continue', ...args]); return { synced: 1 }; },
      createDraftIfNeeded: async (...args: unknown[]) => { calls.push(['draft-if-needed', ...args]); return { decision: 'skip' }; },
    } as any;
    const systemContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'system' } } as ToolContext;
    const memberContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;

    await runTrustedTool('inbox.sync', { connectorKey }, { context: systemContext, email: emailService });
    await runTrustedTool('inbox.subscribe', { connectorKey, notificationHistoryId: '456' }, { context: systemContext, email: emailService });
    await runTrustedTool('inbox.subscribe', { connectorKey }, { context: systemContext, email: emailService });
    const draftInput = { connectorKey, threadKey: newId(), messageKey: newId() };
    await runTrustedTool('email.draft.create-if-needed', draftInput, { context: systemContext, email: emailService });
    await expect(runTrustedTool('inbox.sync', { connectorKey }, { context: memberContext, email: emailService })).rejects.toThrow('system-only');
    await expect(runTool('inbox.sync', '', { connectorKey }, { contentContext: systemContext, emailService })).rejects.toThrow();
    expect(calls).toEqual([
      ['sync', { userKey: 'system', organizationKey, scopeKey }, connectorKey],
      ['subscribe', { userKey: 'system', organizationKey, scopeKey }, connectorKey, '456'],
      ['continue', { userKey: 'system', organizationKey, scopeKey }, connectorKey],
      ['draft-if-needed', { userKey: 'system', organizationKey, scopeKey }, draftInput],
    ]);
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
    const organizationKey = newId(), scopeKey = newId(), userKey = newId(), collectionKey = newId();
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
    await runTool('trip.create', '', { name: 'Route', placeKeys: [scopeKey] }, { ...billingFixture, contentContext, travelService, requestKey: 'request-1' });
    await expect(runTool('trip.update', '', { tripKey: scopeKey, isFavorite: true, position: 0 }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('trip.update', '', { tripKey: scopeKey, isFavorite: true }, { contentContext, travelService });
    await runTool('trip.delete', '', { tripKey: scopeKey }, { contentContext, travelService });
    await expect(runTool('trip.attachment.set', '', { tripKey: scopeKey, attachments: [{ type: 'file', key: scopeKey }] }, { contentContext, travelService })).rejects.toThrow();
    await runTool('trip.attachment.set', '', { tripKey: scopeKey, attachments: [{ type: 'collection', key: scopeKey }] }, { contentContext, travelService });
    await runTool('place.guide.find', '', { query: 'Reykjavik' }, { ...billingFixture, contentContext, travelService, requestKey: 'guide-request' });
    const cityInput = { city: 'Reykjavik', country: { name: 'Iceland', code: 'IS', continent: 'Europe', lat: 65, lon: -18 } };
    await expect(runTool('place.find-city', '', { ...cityInput, userKey }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('place.find-city', '', cityInput, { ...billingFixture, contentContext, travelService, requestKey: 'city-request' });
    await expect(runTool('place.find-children', '', { childrenRequestToken: 'token', scopeKey }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('place.find-children', '', { childrenRequestToken: 'token' }, { contentContext, travelService });
    const createInput = { name: 'Iceland', summary: 'Volcanic island.', countryCode: 'IS', latitude: 65, longitude: -18, imageRequestToken: 'token' };
    await expect(runTool('place.create', '', { ...createInput, scopeKey }, { contentContext, travelService })).rejects.toThrow('Unrecognized key');
    await runTool('place.create', '', createInput, { ...billingFixture, contentContext, travelService, requestKey: 'place-request' });
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
    await runTool('folder.list', '', {}, { contentContext, requestKey: 'read-request-key', executeWorkspaceContent: executeWorkspaceContent as any });
    await runTool('folder.create', '', { folders: [{ name: 'Plans' }] }, { contentContext, executeWorkspaceContent: executeWorkspaceContent as any });
    await runTool('document.search-all', '', { query: 'roadmap' }, { contentContext, executeWorkspaceContent: executeWorkspaceContent as any });
    await runTool('folder.create', '', { folders: [{ name: 'Idempotent' }] }, { contentContext, requestKey: 'agent-request-key', executeWorkspaceContent: executeWorkspaceContent as any });

    expect(calls).toEqual([
      ['folder.list', { scopeKey }, contentContext, expect.any(Object)],
      ['folder.list', { scopeKey }, contentContext, expect.any(Object)],
      ['folder.create', { folders: [{ scopeKey, name: 'Plans' }] }, contentContext, expect.any(Object)],
      ['document.search-all', { organizationKey, query: 'roadmap' }, contentContext, expect.any(Object)],
      ['folder.create', { folders: [{ scopeKey, name: 'Idempotent' }], idempotencyKey: 'agent-request-key' }, contentContext, expect.any(Object)],
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
    const organizationKey = newId(), scopeKey = newId(), userKey = newId(), collectionKey = newId();
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const calls: unknown[][] = [];
    const images = {
      createIdeas: async (...args: unknown[]) => { calls.push(['ideas', ...args]); return { concepts: [] }; },
      generate: async (...args: unknown[]) => { calls.push(['generate', ...args]); return { images: [], provider: {} }; },
    } as any;
    await runTool('image.ideas.create', '', { prompt: 'Earth', requestedCount: 2 }, { contentContext, images });
    await runTool('image.generate', '', { prompt: 'Earth', count: 1, collectionKey }, { contentContext, requestKey: 'request-1', images });
    expect(calls).toEqual([
      ['ideas', { prompt: 'Earth', requestedCount: 2 }, contentContext],
      ['generate', { prompt: 'Earth', count: 1, size: '1024x1024', quality: 'medium', mode: 'default', referenceImageKeys: [], collectionKey }, contentContext, 'request-1'],
    ]);
    await expect(runTool('image.generate', '', { prompt: 'Earth', count: 1, collectionKey, scopeKey }, { contentContext, images })).rejects.toThrow('Unrecognized key');
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

  test('executes book creation, favorite, and Signal read-state tools through injected services', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId(), threadKey = newId();
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const calls: unknown[][] = [];
    const emailService = {
      threadForTool: async (...args: unknown[]) => { calls.push(['threadForTool', ...args]); return {}; },
      setReadState: async (...args: unknown[]) => { calls.push(['setReadState', ...args]); return {}; },
      findSimilar: async (...args: unknown[]) => { calls.push(['findSimilar', ...args]); return {}; },
    } as any;
    const bookService = { suggestTopics: async (...args: unknown[]) => { calls.push(['suggestTopics', ...args]); return { topics: [] }; }, suggestGoals: async (...args: unknown[]) => { calls.push(['suggestGoals', ...args]); return { goals: [] }; }, create: async (...args: unknown[]) => { calls.push(['create', ...args]); return {}; }, setFavorite: async (...args: unknown[]) => { calls.push(['setFavorite', ...args]); return {}; } } as any;
    const brief = { topic: 'Decision making', goal: 'Decide well', currentKnowledge: 'Basic familiarity', writingTone: 'Clear', language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear', narrationPace: 1 };
    await expect(runTool('book.create', '', { ...brief, chapterCount: 10 }, { contentContext, bookService })).rejects.toThrow('Unrecognized key');
    await expect(runTool('book.create', '', { ...brief, scopeKey }, { contentContext, bookService })).rejects.toThrow('Unrecognized key');
    await expect(runTool('book.topic.suggest', '', { scopeKey }, { contentContext, bookService })).rejects.toThrow('Unrecognized key');
    await runTool('book.topic.suggest', '', { excludeTopics: ['Old idea'] }, { contentContext, bookService });
    await runTool('book.goal.suggest', '', { topic: 'Decision making', excludeGoals: ['Old goal'] }, { contentContext, bookService });
    await runTool('book.create', '', brief, { ...billingFixture, contentContext, bookService, requestKey: 'request-1' });
    const bookKey = newId();
    await expect(runTool('book.favorite', '', { bookKey, isFavorite: true, organizationKey }, { contentContext, bookService })).rejects.toThrow('Unrecognized key');
    await runTool('book.favorite', '', { bookKey, isFavorite: true }, { contentContext, bookService });
    await runTool('email.thread.read', '', { threadKey }, { contentContext, emailService });
    await runTool('email.thread.read-state', '', { threadKey, isRead: true }, { contentContext, emailService });
    await runTool('email.similar.find', '', { messageKey: threadKey }, { contentContext, emailService });
    const actor = { userKey, organizationKey, scopeKey };
    expect(calls).toEqual([
      ['suggestTopics', { organizationKey, scopeKey, excludeTopics: ['Old idea'] }, userKey, { signal: undefined, timeoutMs: undefined }],
      ['suggestGoals', { organizationKey, scopeKey, topic: 'Decision making', excludeGoals: ['Old goal'] }, userKey, { signal: undefined, timeoutMs: undefined }],
      ['create', { organizationKey, scopeKey, generationRequestKey: 'request-1', ...brief }, userKey],
      ['setFavorite', bookKey, { organizationKey, scopeKey, isFavorite: true }, userKey],
      ['threadForTool', actor, threadKey, undefined],
      ['setReadState', actor, { threadKey, isRead: true }, false, undefined],
      ['findSimilar', actor, { messageKey: threadKey, limit: 10 }],
    ]);
  });

  test('dispatches all 31 Signal-specific tools through runTool with strict trusted contracts', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId(), key = newId();
    const contentContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const cases = [
      ['email.overview', 'overview', {}],
      ['inbox.refresh', 'sync', { connectorKey: key }],
      ['inbox.search', 'searchInboxes', { query: 'leadership', recordHistory: false }],
      ['email.tone.search', 'searchTones', { query: 'measured', recordHistory: false }],
      ['inbox.sort', 'sort', { connectorKey: key }],
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
      'inbox.refresh', 'inbox.sort', 'inbox.update', 'email.thread.read-state', 'email.thread.favorite', 'email.thread.trash', 'email.trash.clear',
      'email.message.translation.delete', 'email.message.summarize', 'email.message.summary.delete', 'email.draft.create', 'email.draft.compose', 'email.draft.update', 'email.draft.assign',
      'email.draft.send', 'email.draft.delete', 'email.tone.create', 'email.tone.update', 'email.tone.delete', 'email.reply-context.create',
      'email.reply-context.update', 'email.reply-context.delete',
    ]);
    expect(cases.map(([name]): string => name)).toEqual(signalCapabilities.map(({ definition }) => definition.name));
    expect(cases).toHaveLength(31);
    for (const [name, method, input] of cases) {
      await expect(runTool(name, '', { ...input, unexpected: true }, { contentContext, emailService, requestKey: 'signal-request' })).rejects.toThrow('Unrecognized key');
      const output = await runTool(name, '', input, { ...billingFixture, contentContext, emailService, requestKey: 'signal-request' });
      const call = calls.at(-1)!;
      expect(call[0]).toBe(method);
      expect(call[1]).toEqual(actor);
      expect(call.includes('signal-request')).toBe(receiptMethods.has(method));
      expect(signalCapabilities.find(({ definition }) => definition.name === name)?.mutationWorkspace === 'signal').toBe(mutationNames.has(name));
      expect(JSON.stringify(output)).not.toMatch(/embedding|scopeKey|accountKey|providerThreadId|providerMessageId|encryptedCredentials|sendLeaseToken/);
      expect(JSON.stringify(output)).not.toMatch(/"bcc"|hidden@example\.com/i);
    }
  });
});

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createEmailHandlers } from './email-inbox';
import { EmailIdempotencyError } from '@/lib/email-inbox/service';

const userKey = 'cmrnlzf650002qc7k4p5zem5w';
const organizationKey = 'org-1';
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const connectorKey = 'cmsp3gwac0009r07kdlin5eoi';
const now = '2026-08-23T00:00:00.000Z';
const newDraftOutput = { key: userKey, variant: 'new' as const, connectorKey, to: ['recipient@example.com'], bcc: ['hidden@example.com'], subject: 'Planning', generatedContent: 'Body', status: 'generated' as const, createdAt: now, updatedAt: now };
const replyDraftOutput = { key: userKey, variant: 'reply' as const, replyMode: 'reply_all' as const, threadKey: userKey, messageKey: connectorKey, to: ['recipient@example.com'], cc: [], generatedContent: 'Body', status: 'generated' as const, createdAt: now, updatedAt: now };
const overviewOutput = { accounts: [], selectedAccount: null, threads: [], drafts: [], tones: [], unassignedDrafts: [], counts: { all: 0, important: 0, urgent: 0, needsAction: 0, filtered: 0, unread: 0, favorite: 0, trash: 0 }, nextCursor: null };
const identity = async () => ({ key: userKey, identityType: 'user' as const });

function appWith(overrides: Parameters<typeof createEmailHandlers>[0]) {
  const handlers = createEmailHandlers(overrides);
  return new Hono()
    .post('/email/overview', handlers.overview)
    .post('/email/inboxes/search', handlers.searchInboxes)
    .post('/email/tones/search', handlers.searchTones)
    .post('/email/connect', handlers.startConnect)
    .post('/email/connect/exchange', handlers.exchangeConnect)
    .post('/email/sync', handlers.sync)
    .post('/email/subscribe', handlers.subscribe)
    .post('/email/threads/favorite', handlers.favoriteBulk)
    .post('/email/threads/read-state', handlers.readStateBulk)
    .post('/email/threads/trash', handlers.trashThreads)
    .post('/email/trash/clear', handlers.clearTrash)
    .post('/email/threads/:threadKey', handlers.thread)
    .post('/email/threads/:threadKey/favorite', handlers.favorite)
    .post('/email/threads/:threadKey/read-state', handlers.readState)
    .post('/email/threads/:threadKey/trash', handlers.trashThread)
    .post('/email/messages/:messageKey/similar', handlers.findSimilar)
    .post('/email/messages/:messageKey/translations/list', handlers.listMessageTranslations)
    .delete('/email/messages/:messageKey/translations', handlers.deleteMessageTranslations)
    .post('/email/messages/:messageKey/summaries', handlers.summarizeMessage)
    .post('/email/messages/:messageKey/summaries/list', handlers.listMessageSummaries)
    .delete('/email/messages/:messageKey/summaries', handlers.deleteMessageSummaries)
    .post('/email/drafts', handlers.draft)
    .post('/email/drafts/compose', handlers.draftNew)
    .patch('/email/drafts/:draftKey', handlers.updateDraft)
    .post('/email/drafts/:draftKey/send', handlers.sendDraft)
    .post('/email/drafts/:draftKey/assign', handlers.assignDraft)
    .delete('/email/drafts/:draftKey', handlers.deleteDraft)
    .post('/email/tones/list', handlers.tones)
    .post('/email/reply-context/list', handlers.listReplyContext)
    .post('/email/reply-context', handlers.createReplyContext)
    .patch('/email/reply-context/:noteKey', handlers.updateReplyContext)
    .post('/email/reply-context/delete', handlers.deleteReplyContext)
    .post('/email/tones', handlers.createTone)
    .patch('/email/tones/:toneKey', handlers.updateTone)
    .delete('/email/tones/:toneKey', handlers.deleteTone)
    .patch('/email/inboxes', handlers.updateInbox)
    .post('/email/disconnect', handlers.disconnect);
}

describe('email inbox handlers', () => {
  test('passes authenticated organization and scope context to overview', async () => {
    let received: unknown;
    const app = appWith({ getIdentity: identity as never, service: { overview: async (actor: unknown, input: unknown) => { received = { actor, input }; return overviewOutput; } } as never, oauth: {} as never });
    const response = await app.request('/email/overview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, connectorKey, filter: 'urgent' }) });
    expect(response.status).toBe(200);
    expect(received).toEqual({ actor: { userKey, organizationKey, scopeKey }, input: { connectorKey, filter: 'urgent', search: undefined, cursor: undefined, limit: undefined } });
  });

  test('passes composite overview input unchanged to the canonical service and rejects ambiguous transport input', async () => {
    const calls: unknown[] = [];
    const app = appWith({ getIdentity: identity as never, service: { overview: async (...input: unknown[]) => { calls.push(input); return overviewOutput; } } as never, oauth: {} as never });
    const composite = { organizationKey, scopeKey, connectorKey, readState: 'unread', facets: ['favorite', 'urgent', 'urgent'], search: 'plan', limit: 10 };
    expect((await app.request('/email/overview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(composite) })).status).toBe(200);
    expect(calls).toEqual([[{ userKey, organizationKey, scopeKey }, { connectorKey, readState: 'unread', facets: ['favorite', 'urgent', 'urgent'], search: 'plan', limit: 10 }]]);
    expect((await app.request('/email/overview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...composite, filter: 'all' }) })).status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  test('routes strict inbox and tone semantic searches to their canonical services', async () => {
    const calls: unknown[] = [];
    const service = {
      searchInboxes: async (...input: unknown[]) => { calls.push(['inboxes', ...input]); return { inboxes: [] }; },
      searchTones: async (...input: unknown[]) => { calls.push(['tones', ...input]); return { tones: [] }; },
    };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const body = { organizationKey, scopeKey, query: '  leadership  ', recordHistory: false };
    expect((await app.request('/email/inboxes/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(200);
    expect((await app.request('/email/tones/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(200);
    expect(calls.map((call: any) => call.slice(0, 3))).toEqual([
      ['inboxes', { userKey, organizationKey, scopeKey }, { query: 'leadership', minimumScore: 0.55, limit: 50, recordHistory: false }],
      ['tones', { userKey, organizationKey, scopeKey }, { query: 'leadership', minimumScore: 0.55, limit: 50, recordHistory: false }],
    ]);
    expect((await app.request('/email/inboxes/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, forged: true }) })).status).toBe(400);
    expect((await app.request('/email/tones/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, minimumScore: 2 }) })).status).toBe(400);
  });

  test('rejects unknown input and unauthenticated requests', async () => {
    const app = appWith({ getIdentity: identity as never, service: { overview: async () => ({}) } as never, oauth: {} as never });
    const invalid = await app.request('/email/overview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, unexpected: true }) });
    expect(invalid.status).toBe(400);
    const unauthorized = appWith({ getIdentity: (async () => null) as never, service: { overview: async () => ({}) } as never, oauth: {} as never });
    expect((await unauthorized.request('/email/overview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey }) })).status).toBe(401);
  });

  test('maps stable email idempotency states to HTTP 409 with retryability', async () => {
    for (const [code, retryable] of [['EMAIL_IDEMPOTENCY_CONFLICT', false], ['EMAIL_IDEMPOTENCY_PENDING', true], ['EMAIL_IDEMPOTENCY_INDETERMINATE', false], ['EMAIL_IDEMPOTENCY_FAILED', false]] as const) {
      const app = appWith({ getIdentity: identity as never, service: { overview: async () => { throw new EmailIdempotencyError(code, 'Safe idempotency state.', retryable); } } as never, oauth: {} as never });
      const response = await app.request('/email/overview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey }) });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ success: false, error: { code, retryable, message: 'Safe idempotency state.' } });
    }
  });

  test('keeps deployed sync and subscribe aliases strict and projects their legacy response shapes', async () => {
    const calls: unknown[] = [];
    const service = {
      sync: async (...args: unknown[]) => { calls.push(['sync', ...args]); return { synced: 2, busy: false, lastSyncedAt: now, initialSyncCompleted: true }; },
      registerWatch: async (...args: unknown[]) => { calls.push(['registerWatch', ...args]); return { watchExpiresAt: '2026-08-24T00:00:00.000Z', connectorRevision: 'new-revision' }; },
    };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const body = { organizationKey, scopeKey, connectorKey };
    const sync = await app.request('/email/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const subscribe = await app.request('/email/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(sync.status).toBe(200);
    expect(subscribe.status).toBe(200);
    expect((await sync.json() as any).data).toEqual({ synced: 2, busy: false, lastSyncedAt: now });
    expect((await subscribe.json() as any).data).toEqual({ watchExpiresAt: '2026-08-24T00:00:00.000Z' });
    expect((await app.request('/email/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, accessToken: 'untrusted' }) })).status).toBe(400);
    expect(calls).toEqual([
      ['sync', { userKey, organizationKey, scopeKey }, connectorKey],
      ['registerWatch', { userKey, organizationKey, scopeKey }, connectorKey],
    ]);
  });

  test('omits new connector fields from legacy strict mobile transport responses', async () => {
    const connector = { key: connectorKey, connectorKey, provider: 'gmail', email: 'mobile@example.com', name: 'Mobile', isFavorite: false, status: 'active', syncEnabled: true, initialSyncCompleted: true, syncStatus: 'idle', createdAt: now, updatedAt: now } as const;
    const service = {
      overview: async () => ({ ...overviewOutput, accounts: [connector], selectedAccount: connector }),
      searchInboxes: async () => ({ inboxes: [{ ...connector, score: 0.9 }] }),
      updateInbox: async () => connector,
    };
    const oauth = { exchange: async () => connector };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: oauth as never });
    const request = (path: string, body: object, method = 'POST') => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, ...body }) });
    const responses = await Promise.all([
      request('/email/overview', {}),
      request('/email/inboxes/search', { query: 'mobile' }),
      request('/email/connect/exchange', { code: `vrtx_email_grant_${'a'.repeat(20)}` }),
      request('/email/inboxes', { connectorKey, name: 'Mobile' }, 'PATCH'),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200, 200]);
    for (const response of responses) expect(await response.text()).not.toContain('initialSyncCompleted');

    const current = await app.request('/email/overview', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vorinthex-email-transport': '2' }, body: JSON.stringify({ organizationKey, scopeKey }) });
    expect(current.status).toBe(200);
    expect((await current.json() as any).data.accounts[0].initialSyncCompleted).toBe(true);
  });

  test('routes similarity, trash, and summaries through canonical service operations', async () => {
    const calls: unknown[] = [];
    const generated = { key: connectorKey, documentKey: userKey, version: 1, content: 'Bonjour.', summary: 'Summary.', style: 'brief', sourceTitle: 'Subject', sourceDocumentUpdatedAt: '2026-08-23T00:00:00.000Z', createdAt: '2026-08-23T00:00:00.000Z', embedding: [1], chunkEmbeddings: [[1]], scopeKey, createdByKey: userKey };
    const service = {
      findSimilar: async (...args: unknown[]) => { calls.push(['findSimilar', ...args]); return {}; },
      trashThread: async (...args: unknown[]) => { calls.push(['trashThread', ...args]); return { requested: 1, succeeded: 1, failed: 0, repairPending: 0, items: [{ threadKey: userKey, status: 'succeeded', thread: { key: userKey } }] }; },
      listMessageTranslations: async (...args: unknown[]) => { calls.push(['listMessageTranslations', ...args]); return { messageKey: userKey, versions: [generated] }; },
      summarizeMessage: async (...args: unknown[]) => { calls.push(['summarizeMessage', ...args]); return { messageKey: userKey, text: 'Summary.', summary: generated }; },
      listMessageSummaries: async (...args: unknown[]) => { calls.push(['listMessageSummaries', ...args]); return { messageKey: userKey, summaries: [generated] }; },
    };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const context = { organizationKey, scopeKey };
    const post = (path: string, body: object) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, ...body }) });
    expect((await post(`/email/messages/${userKey}/similar`, { limit: 10 })).status).toBe(200);
    expect((await post(`/email/threads/${userKey}/trash`, {})).status).toBe(200);
    const generatedResponses = await Promise.all([post(`/email/messages/${userKey}/translations/list`, {}), post(`/email/messages/${userKey}/summaries`, { style: 'brief' }), post(`/email/messages/${userKey}/summaries/list`, {})]);
    expect(generatedResponses.map(({ status }) => status)).toEqual([200, 201, 200]);
    for (const response of generatedResponses) expect(await response.text()).not.toMatch(/embedding|chunkEmbeddings|scopeKey|createdByKey/);
    expect((await post(`/email/messages/${userKey}/similar`, { categories: ['Important'] })).status).toBe(400);
    expect(calls.map((call) => (call as unknown[])[0])).toEqual(['findSimilar', 'trashThread', 'listMessageTranslations', 'summarizeMessage', 'listMessageSummaries']);
    expect(calls.every((call) => JSON.stringify(call).includes(`"scopeKey":"${scopeKey}"`))).toBe(true);
  });

  test('routes strict bulk generated-email deletion with the trusted Idempotency-Key', async () => {
    const translationKey = connectorKey, summaryKey = userKey;
    const calls: unknown[] = [];
    const service = {
      deleteMessageTranslations: async (...args: unknown[]) => { calls.push(['translations', ...args]); return { messageKey: userKey, deletedKeys: [translationKey] }; },
      deleteMessageSummaries: async (...args: unknown[]) => { calls.push(['summaries', ...args]); return { messageKey: userKey, deletedKeys: [summaryKey] }; },
    };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const request = (path: string, body: object) => app.request(path, { method: 'DELETE', headers: { 'content-type': 'application/json', 'idempotency-key': 'delete-request' }, body: JSON.stringify({ organizationKey, scopeKey, ...body }) });
    expect((await request(`/email/messages/${userKey}/translations`, { translationKeys: [translationKey] })).status).toBe(200);
    expect((await request(`/email/messages/${userKey}/summaries`, { summaryKeys: [summaryKey] })).status).toBe(200);
    expect((await request(`/email/messages/${userKey}/translations`, { translationKeys: [translationKey, translationKey] })).status).toBe(400);
    expect((await request(`/email/messages/${userKey}/summaries`, { summaryKeys: [summaryKey], userKey })).status).toBe(400);
    expect(calls).toEqual([
      ['translations', { userKey, organizationKey, scopeKey }, { messageKey: userKey, translationKeys: [translationKey] }, 'delete-request'],
      ['summaries', { userKey, organizationKey, scopeKey }, { messageKey: userKey, summaryKeys: [summaryKey] }, 'delete-request'],
    ]);
  });

  test('requires one-time connection grants and strict drafting tones', async () => {
    const oauth = { exchange: async () => null };
    const app = appWith({ getIdentity: identity as never, service: { draft: async () => replyDraftOutput } as never, oauth: oauth as never });
    const exchange = await app.request('/email/connect/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, code: `vrtx_email_grant_${'a'.repeat(20)}` }) });
    expect(exchange.status).toBe(401);
    const draft = await app.request('/email/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, threadKey: userKey, tone: '' }) });
    expect(draft.status).toBe(400);
    const valid = await app.request('/email/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, threadKey: userKey, tone: 'warm', replyMode: 'reply_all' }) });
    expect(valid.status).toBe(201);
    const invalidMode = await app.request('/email/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, threadKey: userKey, tone: 'warm', replyMode: 'all' }) });
    expect(invalidMode.status).toBe(400);
  });

  test('accepts only the Gmail connection transport', async () => {
    const calls: unknown[] = [];
    const oauth = {
      start: async (input: unknown) => { calls.push(['oauth', input]); return { authorizationUrl: 'https://provider.example/authorize' }; },
    };
    const app = appWith({ getIdentity: identity as never, service: {} as never, oauth: oauth as never });
    const context = { organizationKey, scopeKey, name: 'Work' };
    const gmail = await app.request('/email/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, provider: 'gmail', returnUri: 'vorinthexcore://capability/signal' }) });
    expect(gmail.status).toBe(200);
    expect((await app.request('/email/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, provider: 'unsupported', returnUri: 'vorinthexcore://capability/signal' }) })).status).toBe(400);
    expect(calls).toEqual([
      ['oauth', { userKey, organizationKey, scopeKey, provider: 'gmail', name: 'Work', description: undefined, returnUri: 'vorinthexcore://capability/signal' }],
    ]);
  });

  test('routes strict disconnect through the authorized protocol boundary only', async () => {
    const calls: unknown[] = [];
    const service = { disconnect: async (...args: unknown[]) => { calls.push(args); return { disconnected: true }; } };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const body = { organizationKey, scopeKey, connectorKey };
    expect((await app.request('/email/disconnect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(200);
    expect((await app.request('/email/disconnect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, deleteMessages: true }) })).status).toBe(400);
    expect(calls).toEqual([[{ userKey, organizationKey, scopeKey }, connectorKey]]);
  });

  test('routes Gmail-backed favorite through the same canonical operation as Core', async () => {
    const calls: unknown[] = [];
    const service = { setFavorite: async (...args: unknown[]) => { calls.push(args); return { requested: 1, succeeded: 1, failed: 0, repairPending: 0, items: [{ threadKey: userKey, status: 'succeeded', thread: { key: userKey, isFavorite: true, starred: true, labels: ['STARRED'] } }] }; } };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const response = await app.request(`/email/threads/${userKey}/favorite`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-1' }, body: JSON.stringify({ organizationKey, scopeKey, isFavorite: true }) });
    expect(response.status).toBe(200);
    expect(calls).toEqual([[{ userKey, organizationKey, scopeKey }, { threadKey: userKey, isFavorite: true }, false, 'request-1']]);
  });

  test('keeps canonical HTTP thread reads viewer-safe and rejects legacy compound markRead input', async () => {
    const calls: unknown[] = [];
    const service = {
      setReadState: async () => { throw new Error('read route must not mutate'); },
      threadForTool: async (...args: unknown[]) => { calls.push(args); return { thread: {}, messages: [] }; },
    };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const request = (body: object) => app.request(`/email/threads/${userKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, ...body }) });
    expect((await request({})).status).toBe(200);
    expect((await request({ cursor: 'next-page' })).status).toBe(200);
    expect((await request({ markRead: true })).status).toBe(400);
    expect(calls).toEqual([
      [{ userKey, organizationKey, scopeKey }, userKey, undefined],
      [{ userKey, organizationKey, scopeKey }, userKey, 'next-page'],
    ]);
  });

  test('adapts strict singular and bulk thread mutations and clear Trash to canonical operations', async () => {
    const calls: unknown[] = [];
    const success = (keys: string[]) => ({ requested: keys.length, succeeded: keys.length, failed: 0, repairPending: 0, items: keys.map((threadKey) => ({ threadKey, status: 'succeeded', thread: { key: threadKey } })) });
    const service = {
      setFavorite: async (actor: unknown, input: any) => { calls.push(['favorite', actor, input]); return success(input.threadKeys ?? [input.threadKey]); },
      setReadState: async (actor: unknown, input: any) => { calls.push(['read-state', actor, input]); return success(input.threadKeys ?? [input.threadKey]); },
      trashThread: async (actor: unknown, input: any) => { calls.push(['trash', actor, input]); return success(input.threadKeys ?? [input.threadKey]); },
      clearTrash: async (...input: unknown[]) => { calls.push(['clear', ...input]); return { connectorKey, providerMessagesDeleted: 0, threadsDeleted: 0, documentsDeleted: 0 }; },
    };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const context = { organizationKey, scopeKey };
    const post = (path: string, body: object) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, ...body }) });
    expect((await post('/email/threads/favorite', { threadKeys: [userKey], isFavorite: true })).status).toBe(200);
    expect((await post(`/email/threads/${userKey}/read-state`, { isRead: false })).status).toBe(200);
    expect((await post('/email/threads/trash', { threadKeys: [userKey] })).status).toBe(200);
    expect((await post('/email/trash/clear', { connectorKey })).status).toBe(200);
    expect((await post('/email/threads/favorite', { threadKeys: [userKey, userKey], isFavorite: true })).status).toBe(400);
    expect((await post('/email/threads/read-state', { threadKeys: [userKey], isRead: true, threadKey: userKey })).status).toBe(400);
    expect(calls.map((call) => (call as unknown[])[0])).toEqual(['favorite', 'read-state', 'trash', 'clear']);
  });

  test('routes strict new drafts and tone listing through the canonical service', async () => {
    const calls: unknown[] = [];
    const service = {
      draftNew: async (...args: unknown[]) => { calls.push(['draftNew', ...args]); return newDraftOutput; },
      tones: async (...args: unknown[]) => { calls.push(['tones', ...args]); return []; },
    };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const input = { organizationKey, scopeKey, connectorKey, to: ['recipient@example.com'], subject: 'Planning', tone: 'direct', attachments: [{ type: 'document', key: userKey }] };
    const generatedResponse = await app.request('/email/drafts/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect(generatedResponse.status).toBe(201);
    expect((await generatedResponse.json() as any).data.bcc).toEqual(['hidden@example.com']);
    const preserved = { organizationKey, scopeKey, connectorKey, to: ['recipient@example.com'], subject: '', authoredBody: '', generationMode: 'preserve' };
    expect((await app.request('/email/drafts/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(preserved) })).status).toBe(201);
    expect((await app.request('/email/drafts/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...preserved, tone: 'direct' }) })).status).toBe(400);
    expect((await app.request('/email/drafts/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, unexpected: true }) })).status).toBe(400);
    expect((await app.request('/email/drafts/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, displayName: 'Untrusted' }) })).status).toBe(400);
    expect((await app.request('/email/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, threadKey: userKey, tone: 'direct', senderIdentity: { displayName: 'Untrusted' } }) })).status).toBe(400);
    expect((await app.request('/email/tones/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey }) })).status).toBe(200);
    expect(calls).toEqual([
      ['draftNew', { userKey, organizationKey, scopeKey }, { connectorKey, to: input.to, generationMode: 'generate', subject: input.subject, tone: input.tone, attachments: input.attachments }, undefined],
      ['draftNew', { userKey, organizationKey, scopeKey }, { connectorKey, to: preserved.to, generationMode: 'preserve', subject: '', authoredBody: '' }, undefined],
      ['tones', { userKey, organizationKey, scopeKey }],
    ]);

    const leaking = appWith({ getIdentity: identity as never, service: { draftNew: async () => ({ ...newDraftOutput, scopeKey }) } as never, oauth: {} as never });
    expect((await leaking.request('/email/drafts/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).status).toBe(400);
  });

  test('routes draft and custom tone hard deletion with trusted request keys', async () => {
    const calls: unknown[] = [];
    const service = {
      deleteDraft: async (...args: unknown[]) => { calls.push(['draft', ...args]); return { deletedKey: userKey }; },
      deleteTone: async (...args: unknown[]) => { calls.push(['tone', ...args]); return { deletedKey: userKey }; },
    };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const init = { method: 'DELETE', headers: { 'content-type': 'application/json', 'idempotency-key': 'delete-1' }, body: JSON.stringify({ organizationKey, scopeKey }) };
    expect((await app.request(`/email/drafts/${userKey}`, init)).status).toBe(200);
    expect((await app.request(`/email/tones/${userKey}`, init)).status).toBe(200);
    expect(calls).toEqual([
      ['draft', { userKey, organizationKey, scopeKey }, { draftKey: userKey }, 'delete-1'],
      ['tone', { userKey, organizationKey, scopeKey }, { toneKey: userKey }, 'delete-1'],
    ]);
  });

  test('routes strict legacy draft assignment through the canonical service', async () => {
    const calls: unknown[] = [];
    const service = { assignDraft: async (...args: unknown[]) => { calls.push(args); return newDraftOutput; } };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const body = { organizationKey, scopeKey, connectorKey };
    expect((await app.request(`/email/drafts/${userKey}/assign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(200);
    expect((await app.request(`/email/drafts/${userKey}/assign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, accountKey: connectorKey }) })).status).toBe(400);
    expect(calls).toEqual([[{ userKey, organizationKey, scopeKey }, { draftKey: userKey, connectorKey }]]);
  });

  test('routes strict body and attachment draft patches through the canonical service', async () => {
    const calls: unknown[] = [];
    const service = { updateDraft: async (...args: unknown[]) => { calls.push(args); return newDraftOutput; } };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const request = (body: object) => app.request(`/email/drafts/${userKey}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'idempotency-key': 'update-1' }, body: JSON.stringify({ organizationKey, scopeKey, ...body }) });
    const attachments = [{ type: 'document', key: connectorKey }];
    expect((await request({ finalContent: 'Reviewed', attachments })).status).toBe(200);
    expect((await request({ attachments: [] })).status).toBe(200);
    expect((await request({})).status).toBe(400);
    expect((await request({ finalContent: 'Reviewed', unexpected: true })).status).toBe(400);
    expect((await request({ attachments: [attachments[0], attachments[0]] })).status).toBe(400);
    expect(calls).toEqual([
      [{ userKey, organizationKey, scopeKey }, { draftKey: userKey, finalContent: 'Reviewed', attachments }, 'update-1'],
      [{ userKey, organizationKey, scopeKey }, { draftKey: userKey, attachments: [] }, 'update-1'],
    ]);
  });

  test('routes an optional send-time reply mode through the canonical service', async () => {
    const calls: unknown[] = [];
    const service = { sendDraft: async (...args: unknown[]) => { calls.push(args); return { sent: true, draftKey: userKey }; } };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const body = { organizationKey, scopeKey, replyMode: 'reply_all' };
    expect((await app.request(`/email/drafts/${userKey}/send`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'send-1' }, body: JSON.stringify(body) })).status).toBe(200);
    expect((await app.request(`/email/drafts/${userKey}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, unexpected: true }) })).status).toBe(400);
    expect(calls).toEqual([[{ userKey, organizationKey, scopeKey }, userKey, undefined, 'send-1', 'reply_all']]);
  });

  test('routes strict inbox and custom tone mutations through the canonical service', async () => {
    const calls: unknown[] = [];
    const service = {
      updateInbox: async (...args: unknown[]) => { calls.push(['updateInbox', ...args]); return { key: connectorKey, connectorKey, provider: 'gmail', email: 'work@example.com', name: 'Work', isFavorite: false, status: 'active', syncEnabled: true, initialSyncCompleted: true, syncStatus: 'idle', createdAt: now, updatedAt: now }; },
      createTone: async (...args: unknown[]) => { calls.push(['createTone', ...args]); return {}; },
      updateTone: async (...args: unknown[]) => { calls.push(['updateTone', ...args]); return {}; },
    };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const context = { organizationKey, scopeKey };
    expect((await app.request('/email/inboxes', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, connectorKey, name: 'Work' }) })).status).toBe(200);
    expect((await app.request('/email/tones', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, name: 'Calm', instruction: 'Use calm language.' }) })).status).toBe(201);
    expect((await app.request(`/email/tones/${userKey}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, isFavorite: true }) })).status).toBe(200);
    expect((await app.request(`/email/tones/${userKey}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, instruction: 'Keep it direct.' }) })).status).toBe(200);
    expect((await app.request('/email/inboxes', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, connectorKey, name: 'Work', forged: true }) })).status).toBe(400);
    expect(calls).toEqual([
      ['updateInbox', { userKey, ...context }, { connectorKey, name: 'Work' }],
      ['createTone', { userKey, ...context }, { name: 'Calm', instruction: 'Use calm language.', isFavorite: false }],
      ['updateTone', { userKey, ...context }, { toneKey: userKey, isFavorite: true }],
      ['updateTone', { userKey, ...context }, { toneKey: userKey, instruction: 'Keep it direct.' }],
    ]);
  });

  test('routes strict reply-context HTTP operations through the canonical service with atomic key lists', async () => {
    const calls: unknown[] = [];
    const service = {
      listReplyContext: async (...args: unknown[]) => { calls.push(['list', ...args]); return []; },
      createReplyContext: async (...args: unknown[]) => { calls.push(['create', ...args]); return {}; },
      updateReplyContext: async (...args: unknown[]) => { calls.push(['update', ...args]); return {}; },
      deleteReplyContext: async (...args: unknown[]) => { calls.push(['delete', ...args]); return {}; },
    };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const context = { organizationKey, scopeKey };
    expect((await app.request('/email/reply-context/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(context) })).status).toBe(200);
    expect((await app.request('/email/reply-context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, name: 'Availability', text: 'No Fridays.' }) })).status).toBe(201);
    expect((await app.request(`/email/reply-context/${userKey}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, text: 'No Mondays.' }) })).status).toBe(200);
    expect((await app.request('/email/reply-context/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, noteKeys: [userKey] }) })).status).toBe(200);
    expect((await app.request('/email/reply-context/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, noteKeys: [userKey, userKey] }) })).status).toBe(400);
    expect((await app.request('/email/reply-context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, name: 'x', text: 'y', scope: 'forged' }) })).status).toBe(400);
    expect(calls).toEqual([
      ['list', { userKey, ...context }],
      ['create', { userKey, ...context }, { name: 'Availability', text: 'No Fridays.' }],
      ['update', { userKey, ...context }, { noteKey: userKey, text: 'No Mondays.' }],
      ['delete', { userKey, ...context }, { noteKeys: [userKey] }],
    ]);
  });
});

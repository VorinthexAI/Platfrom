import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createEmailHandlers } from './email-inbox';

const userKey = 'cmrnlzf650002qc7k4p5zem5w';
const organizationKey = 'org-1';
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const connectorKey = 'cmsp3gwac0009r07kdlin5eoi';
const identity = async () => ({ key: userKey, identityType: 'user' as const });

function appWith(overrides: Parameters<typeof createEmailHandlers>[0]) {
  const handlers = createEmailHandlers(overrides);
  return new Hono()
    .post('/email/overview', handlers.overview)
    .post('/email/connect', handlers.startConnect)
    .post('/email/connect/exchange', handlers.exchangeConnect)
    .post('/email/sync', handlers.sync)
    .post('/email/sort', handlers.sort)
    .post('/email/subscribe', handlers.subscribe)
    .post('/email/threads/:threadKey', handlers.thread)
    .post('/email/threads/:threadKey/trash', handlers.trashThread)
    .post('/email/messages/:messageKey/similar', handlers.findSimilar)
    .post('/email/messages/:messageKey/translations', handlers.translateMessage)
    .post('/email/messages/:messageKey/translations/list', handlers.listMessageTranslations)
    .post('/email/messages/:messageKey/summaries', handlers.summarizeMessage)
    .post('/email/messages/:messageKey/summaries/list', handlers.listMessageSummaries)
    .post('/email/drafts', handlers.draft)
    .post('/email/drafts/compose', handlers.draftNew)
    .post('/email/drafts/:draftKey/assign', handlers.assignDraft)
    .post('/email/tones/list', handlers.tones)
    .post('/email/reply-context/list', handlers.listReplyContext)
    .post('/email/reply-context', handlers.createReplyContext)
    .patch('/email/reply-context/:noteKey', handlers.updateReplyContext)
    .post('/email/reply-context/delete', handlers.deleteReplyContext)
    .post('/email/tones', handlers.createTone)
    .patch('/email/tones/:toneKey', handlers.updateTone)
    .patch('/email/inboxes', handlers.updateInbox);
}

describe('email inbox handlers', () => {
  test('passes authenticated organization and scope context to overview', async () => {
    let received: unknown;
    const app = appWith({ getIdentity: identity as never, service: { overview: async (actor: unknown, input: unknown) => { received = { actor, input }; return { threads: [] }; } } as never, oauth: {} as never });
    const response = await app.request('/email/overview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, connectorKey, filter: 'urgent' }) });
    expect(response.status).toBe(200);
    expect(received).toEqual({ actor: { userKey, organizationKey, scopeKey }, input: { connectorKey, filter: 'urgent', search: undefined, cursor: undefined, limit: undefined } });
  });

  test('rejects unknown input and unauthenticated requests', async () => {
    const app = appWith({ getIdentity: identity as never, service: { overview: async () => ({}) } as never, oauth: {} as never });
    const invalid = await app.request('/email/overview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, unexpected: true }) });
    expect(invalid.status).toBe(400);
    const unauthorized = appWith({ getIdentity: (async () => null) as never, service: { overview: async () => ({}) } as never, oauth: {} as never });
    expect((await unauthorized.request('/email/overview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey }) })).status).toBe(401);
  });

  test('keeps HTTP sync and subscription on the canonical service with strict selectors', async () => {
    const calls: unknown[] = [];
    const service = { sync: async (...args: unknown[]) => { calls.push(['sync', ...args]); return { synced: 0 }; }, subscribe: async (...args: unknown[]) => { calls.push(['subscribe', ...args]); return { watchExpiresAt: '2026-08-24T00:00:00.000Z' }; } };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const body = { organizationKey, scopeKey, connectorKey };
    expect((await app.request('/email/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(200);
    expect((await app.request('/email/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(200);
    expect((await app.request('/email/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, accessToken: 'untrusted' }) })).status).toBe(400);
    expect(calls).toEqual([['sync', { userKey, organizationKey, scopeKey }, connectorKey], ['subscribe', { userKey, organizationKey, scopeKey }, connectorKey]]);
  });

  test('routes sorting, similarity, trash, translation, and summaries through canonical service operations', async () => {
    const calls: unknown[] = [];
    const generated = { key: connectorKey, documentKey: userKey, version: 1, content: 'Bonjour.', summary: 'Summary.', style: 'brief', sourceTitle: 'Subject', sourceDocumentUpdatedAt: '2026-08-23T00:00:00.000Z', createdAt: '2026-08-23T00:00:00.000Z', embedding: [1], chunkEmbeddings: [[1]], scopeKey, createdByKey: userKey };
    const service = {
      ...Object.fromEntries(['sort', 'findSimilar', 'trashThread'].map((name) => [name, async (...args: unknown[]) => { calls.push([name, ...args]); return {}; }])),
      translateMessage: async (...args: unknown[]) => { calls.push(['translateMessage', ...args]); return { messageKey: userKey, language: 'French', version: generated }; },
      listMessageTranslations: async (...args: unknown[]) => { calls.push(['listMessageTranslations', ...args]); return { messageKey: userKey, versions: [generated] }; },
      summarizeMessage: async (...args: unknown[]) => { calls.push(['summarizeMessage', ...args]); return { messageKey: userKey, text: 'Summary.', summary: generated }; },
      listMessageSummaries: async (...args: unknown[]) => { calls.push(['listMessageSummaries', ...args]); return { messageKey: userKey, summaries: [generated] }; },
    };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const context = { organizationKey, scopeKey };
    const post = (path: string, body: object) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, ...body }) });
    expect((await post('/email/sort', { connectorKey })).status).toBe(200);
    expect((await post(`/email/messages/${userKey}/similar`, { categories: ['Urgent', 'Filtered'], limit: 5 })).status).toBe(200);
    expect((await post(`/email/threads/${userKey}/trash`, {})).status).toBe(200);
    const generatedResponses = await Promise.all([post(`/email/messages/${userKey}/translations`, { targetLanguage: 'French' }), post(`/email/messages/${userKey}/translations/list`, {}), post(`/email/messages/${userKey}/summaries`, { style: 'brief' }), post(`/email/messages/${userKey}/summaries/list`, {})]);
    expect(generatedResponses.map(({ status }) => status)).toEqual([201, 200, 201, 200]);
    for (const response of generatedResponses) expect(await response.text()).not.toMatch(/embedding|chunkEmbeddings|scopeKey|createdByKey/);
    expect((await post('/email/sort', { connectorKey, userKey })).status).toBe(400);
    expect((await post(`/email/messages/${userKey}/similar`, { categories: ['Important', 'Important'] })).status).toBe(400);
    expect(calls.map((call) => (call as unknown[])[0])).toEqual(['sort', 'findSimilar', 'trashThread', 'translateMessage', 'listMessageTranslations', 'summarizeMessage', 'listMessageSummaries']);
    expect(calls.every((call) => JSON.stringify(call).includes(`"scopeKey":"${scopeKey}"`))).toBe(true);
  });

  test('requires one-time connection grants and strict drafting tones', async () => {
    const oauth = { exchange: async () => null };
    const app = appWith({ getIdentity: identity as never, service: { draft: async () => ({}) } as never, oauth: oauth as never });
    const exchange = await app.request('/email/connect/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, code: `vrtx_email_grant_${'a'.repeat(20)}` }) });
    expect(exchange.status).toBe(401);
    const draft = await app.request('/email/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, threadKey: userKey, tone: '' }) });
    expect(draft.status).toBe(400);
  });

  test('preserves HTTP mark-read defaults while allowing read-only thread requests', async () => {
    const calls: boolean[] = [];
    const service = {
      threadForHttp: async (_actor: unknown, _threadKey: string, markRead: boolean) => { calls.push(markRead); return { thread: {}, messages: [] }; },
    };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const request = (body: object) => app.request(`/email/threads/${userKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, ...body }) });
    expect((await request({})).status).toBe(200);
    expect((await request({ markRead: true })).status).toBe(200);
    expect((await request({ markRead: false })).status).toBe(200);
    expect(calls).toEqual([true, true, false]);
  });

  test('routes strict new drafts and tone listing through the canonical service', async () => {
    const calls: unknown[] = [];
    const service = {
      draftNew: async (...args: unknown[]) => { calls.push(['draftNew', ...args]); return { variant: 'new' }; },
      tones: async (...args: unknown[]) => { calls.push(['tones', ...args]); return []; },
    };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const input = { organizationKey, scopeKey, connectorKey, to: ['recipient@example.com'], subject: 'Planning', tone: 'direct', attachments: [{ type: 'document', key: userKey }] };
    expect((await app.request('/email/drafts/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).status).toBe(201);
    expect((await app.request('/email/drafts/compose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, unexpected: true }) })).status).toBe(400);
    expect((await app.request('/email/tones/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey }) })).status).toBe(200);
    expect(calls).toEqual([
      ['draftNew', { userKey, organizationKey, scopeKey }, { connectorKey, to: input.to, subject: input.subject, tone: input.tone, attachments: input.attachments }],
      ['tones', { userKey, organizationKey, scopeKey }],
    ]);
  });

  test('routes strict legacy draft assignment through the canonical service', async () => {
    const calls: unknown[] = [];
    const service = { assignDraft: async (...args: unknown[]) => { calls.push(args); return { key: userKey, accountKey: connectorKey }; } };
    const app = appWith({ getIdentity: identity as never, service: service as never, oauth: {} as never });
    const body = { organizationKey, scopeKey, connectorKey };
    expect((await app.request(`/email/drafts/${userKey}/assign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(200);
    expect((await app.request(`/email/drafts/${userKey}/assign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, accountKey: connectorKey }) })).status).toBe(400);
    expect(calls).toEqual([[{ userKey, organizationKey, scopeKey }, { draftKey: userKey, connectorKey }]]);
  });

  test('routes strict inbox and custom tone mutations through the canonical service', async () => {
    const calls: unknown[] = [];
    const service = {
      updateInbox: async (...args: unknown[]) => { calls.push(['updateInbox', ...args]); return {}; },
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

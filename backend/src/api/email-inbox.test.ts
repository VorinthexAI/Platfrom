import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createEmailHandlers } from './email-inbox';

const userKey = 'cmrnlzf650002qc7k4p5zem5w';
const organizationKey = 'org-1';
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const identity = async () => ({ key: userKey, identityType: 'user' as const });

function appWith(overrides: Parameters<typeof createEmailHandlers>[0]) {
  const handlers = createEmailHandlers(overrides);
  return new Hono()
    .post('/email/overview', handlers.overview)
    .post('/email/connect', handlers.startConnect)
    .post('/email/connect/exchange', handlers.exchangeConnect)
    .post('/email/drafts', handlers.draft);
}

describe('email inbox handlers', () => {
  test('passes authenticated organization and scope context to overview', async () => {
    let received: unknown;
    const app = appWith({ getIdentity: identity as never, service: { overview: async (actor: unknown, input: unknown) => { received = { actor, input }; return { threads: [] }; } } as never, oauth: {} as never });
    const response = await app.request('/email/overview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, filter: 'urgent' }) });
    expect(response.status).toBe(200);
    expect(received).toEqual({ actor: { userKey, organizationKey, scopeKey }, input: { filter: 'urgent', search: undefined } });
  });

  test('rejects unknown input and unauthenticated requests', async () => {
    const app = appWith({ getIdentity: identity as never, service: { overview: async () => ({}) } as never, oauth: {} as never });
    const invalid = await app.request('/email/overview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, unexpected: true }) });
    expect(invalid.status).toBe(400);
    const unauthorized = appWith({ getIdentity: (async () => null) as never, service: { overview: async () => ({}) } as never, oauth: {} as never });
    expect((await unauthorized.request('/email/overview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey }) })).status).toBe(401);
  });

  test('requires one-time connection grants and strict drafting tones', async () => {
    const oauth = { exchange: async () => null };
    const app = appWith({ getIdentity: identity as never, service: { draft: async () => ({}) } as never, oauth: oauth as never });
    const exchange = await app.request('/email/connect/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, code: `vrtx_email_grant_${'a'.repeat(20)}` }) });
    expect(exchange.status).toBe(401);
    const draft = await app.request('/email/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, threadKey: userKey, tone: 'impersonate' }) });
    expect(draft.status).toBe(400);
  });
});

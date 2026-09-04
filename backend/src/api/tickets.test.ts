import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { TicketFeedbackRejectedError, TicketIdempotencyError, type TicketService } from '@/lib/tickets/service';
import { createFeedbackHandlers, createTicketHandler } from './tickets';

const organizationKey = newId(), scopeKey = newId(), userKey = newId();
const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
const identity = async () => ({ key: userKey, identityType: 'user' as const });

describe('ticket HTTP API', () => {
  test('requires an authenticated user, Idempotency-Key, and a strict body', async () => {
    const body = { organizationKey, scopeKey, message: 'Help' };
    const unauthenticated = new Hono().post('/tickets', createTicketHandler({ getIdentity: async () => null }));
    expect((await unauthenticated.request('/tickets', { method: 'POST' })).status).toBe(401);
    const app = new Hono().post('/tickets', createTicketHandler({ getIdentity: identity, authorize: async () => ({ context }), service: { submit: async () => ({}) } as never }));
    expect((await app.request('/tickets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(400);
    expect((await app.request('/tickets', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-1' }, body: JSON.stringify({ ...body, userKey }) })).status).toBe(400);
  });

  test('authorizes selectors and invokes the canonical service with trusted context', async () => {
    const calls: unknown[][] = [];
    const service = { submit: async (...args: Parameters<TicketService['submit']>) => { calls.push(args); return { key: newId(), message: 'Help', upvotes: 0, downvotes: 0, viewerVote: null, createdAt: '2026-09-03T10:00:00.000Z' }; } } as TicketService;
    let authorized: unknown;
    const app = new Hono().post('/tickets', createTicketHandler({
      getIdentity: identity,
      authorize: async (selectors, options) => { authorized = { selectors, options }; return { context }; },
      service,
    }));
    const response = await app.request('/tickets', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-1' }, body: JSON.stringify({ organizationKey, scopeKey, message: 'Help' }) });
    expect(response.status).toBe(201);
    const payload = await response.json() as { data: Record<string, unknown> };
    expect(payload.data).toEqual({ key: expect.any(String), message: 'Help', upvotes: 0, downvotes: 0, viewerVote: null, createdAt: '2026-09-03T10:00:00.000Z' });
    expect(payload.data).not.toHaveProperty('embedding');
    expect(authorized).toEqual({ selectors: { organizationKey, scopeKey }, options: { authenticatedUserKey: userKey } });
    expect(calls).toEqual([[{ message: 'Help' }, context, 'request-1']]);
  });

  test('maps idempotency payload conflicts to HTTP 409', async () => {
    const app = new Hono().post('/tickets', createTicketHandler({ getIdentity: identity, authorize: async () => ({ context }), service: { submit: async () => { throw new TicketIdempotencyError('different payload'); } } as unknown as TicketService }));
    const response = await app.request('/tickets', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-1' }, body: JSON.stringify({ organizationKey, scopeKey, message: 'Help' }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: { code: 'TICKET_IDEMPOTENCY_CONFLICT', message: 'different payload' } });
  });

  test('feedback routes strictly authorize selectors and call canonical methods', async () => {
    const ticketKey = newId(), calls: unknown[][] = [];
    const safe = { key: ticketKey, message: 'Dark mode', upvotes: 1, downvotes: 0, viewerVote: 'up' as const, createdAt: '2026-09-03T10:00:00.000Z' };
    const service = {
      createFeedback: async (...args: unknown[]) => { calls.push(['create', ...args]); return safe; },
      listFeedback: async (...args: unknown[]) => { calls.push(['list', ...args]); return { items: [safe], nextCursor: null }; },
      setFeedbackVote: async (...args: unknown[]) => { calls.push(['vote', ...args]); return safe; },
    } as unknown as TicketService;
    const handlers = createFeedbackHandlers({ getIdentity: identity, authorize: async () => ({ context }), service, recordEvent: async () => {} });
    const app = new Hono().post('/feedback', handlers.create).post('/feedback/list', handlers.list).put('/feedback/:ticketKey/vote', handlers.vote);
    const headers = { 'content-type': 'application/json', 'idempotency-key': 'request-1' };
    expect((await app.request('/feedback', { method: 'POST', headers, body: JSON.stringify({ organizationKey, scopeKey, message: 'Dark mode' }) })).status).toBe(201);
    expect((await app.request('/feedback/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, forged: true }) })).status).toBe(400);
    expect((await app.request('/feedback/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, limit: 10 }) })).status).toBe(200);
    expect((await app.request(`/feedback/${ticketKey}/vote`, { method: 'PUT', headers, body: JSON.stringify({ organizationKey, scopeKey, vote: 'up' }) })).status).toBe(200);
    expect(calls).toEqual([
      ['create', { message: 'Dark mode' }, context, 'request-1'],
      ['list', { limit: 10 }, context],
      ['vote', { ticketKey, vote: 'up' }, context, 'request-1'],
    ]);
  });

  test('maps AI-rejected feedback to a safe client error', async () => {
    const handlers = createFeedbackHandlers({ getIdentity: identity, authorize: async () => ({ context }), service: { createFeedback: async () => { throw new TicketFeedbackRejectedError('Please submit a clear feature request or product improvement.'); } } as unknown as TicketService, recordEvent: async () => {} });
    const app = new Hono().post('/feedback', handlers.create);
    const response = await app.request('/feedback', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-1' }, body: JSON.stringify({ organizationKey, scopeKey, message: 'asdf' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: { code: 'TICKET_FEEDBACK_REJECTED', message: 'Please submit a clear feature request or product improvement.' } });
  });
});

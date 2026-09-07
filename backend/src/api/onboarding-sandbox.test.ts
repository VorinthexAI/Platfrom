import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from './errors';
import { createOnboardingSandboxHandlers } from './onboarding-sandbox';
import { OnboardingSandboxError } from '@/lib/onboarding-sandbox/service';

const identifier = 'a'.repeat(128);
const token = 'A'.repeat(43);

describe('onboarding sandbox HTTP transport', () => {
  test('passes only trusted installation context and strict input to the canonical service', async () => {
    const calls: unknown[][] = [];
    const handlers = createOnboardingSandboxHandlers({
      createSession: async (...args: unknown[]) => { calls.push(args); return { token, prompts: [], questionLimit: 3, expiresAt: new Date().toISOString() } as never; },
      answer: async (...args: unknown[]) => { calls.push(args); return { promptId: 'what-is-core', question: 'What can Core do?', answer: 'Core connects Vorinthex.', answeredCount: 1, complete: false } as never; },
    } as never);
    const app = new Hono();
    app.onError(errorHandler);
    app.post('/sessions', handlers.createSession);
    app.post('/answers', handlers.answer);

    expect((await app.request('/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vorinthex-Event-Identifier': identifier }, body: '{}' })).status).toBe(201);
    expect((await app.request('/answers', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vorinthex-Event-Identifier': identifier }, body: JSON.stringify({ token, promptId: 'what-is-core' }) })).status).toBe(200);
    expect(calls[0]).toEqual([identifier]);
    expect(calls[1]?.slice(0, 3)).toEqual([identifier, token, 'what-is-core']);
    expect((await app.request('/answers', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vorinthex-Event-Identifier': identifier }, body: JSON.stringify({ token, promptId: 'what-is-core', question: 'arbitrary input' }) })).status).toBe(400);
  });

  test('requires an installation identifier and maps sandbox limits without exposing internals', async () => {
    const handlers = createOnboardingSandboxHandlers({
      createSession: async () => ({}) as never,
      answer: async () => { throw new OnboardingSandboxError('limit'); },
    } as never);
    const app = new Hono(); app.onError(errorHandler); app.post('/sessions', handlers.createSession); app.post('/answers', handlers.answer);
    expect((await app.request('/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(400);
    const response = await app.request('/answers', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vorinthex-Event-Identifier': identifier }, body: JSON.stringify({ token, promptId: 'what-is-core' }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'sandbox question limit reached', code: 'SANDBOX_LIMIT_REACHED' });
  });
});

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { runTool } from '@/lib/ai/tools';
import { ImageGenerationIdempotencyError } from '@/lib/image-generation/service';
import { createImageGenerateHandler, createImageGenerationHistoryDeleteHandler, createImageGenerationHistoryListHandler } from './image-generation';
import { registerRoutes } from './routes';

const organizationKey = newId(), scopeKey = newId(), userKey = newId(), collectionKey = newId();
const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
const identity = async () => ({ key: userKey, identityType: 'user' as const });
const authorize = async () => ({ context });

describe('image generation HTTP API', () => {
  test('requires authentication, strict input, and Idempotency-Key', async () => {
    const app = new Hono();
    app.post('/images/generate', createImageGenerateHandler({ getIdentity: identity, authorize, service: { generate: async () => ({}) } as never }));
    const body = { organizationKey, scopeKey, collectionKey, prompt: 'Earth' };
    expect((await app.request('/images/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(400);
    expect((await app.request('/images/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-1' }, body: JSON.stringify({ ...body, provider: 'openrouter' }) })).status).toBe(400);
    const unauthenticated = new Hono();
    unauthenticated.post('/images/generate', createImageGenerateHandler({ getIdentity: async () => null }));
    expect((await unauthenticated.request('/images/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-1' }, body: JSON.stringify(body) })).status).toBe(401);
  });

  test('HTTP and Core invoke the same canonical generation service with trusted context', async () => {
    const calls: unknown[][] = [];
    const service = { generate: async (...args: unknown[]) => { calls.push(args); return { images: [], provider: { durationMs: 0, costUsd: null } }; } } as never;
    await runTool('image.generate', '', { collectionKey, prompt: 'Earth', count: 2 }, { contentContext: context, requestKey: 'request-1', images: service });
    const app = new Hono();
    app.post('/images/generate', createImageGenerateHandler({ getIdentity: identity, authorize, service }));
    const response = await app.request('/images/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-1' }, body: JSON.stringify({ organizationKey, scopeKey, collectionKey, prompt: 'Earth', count: 2 }) });
    expect(response.status).toBe(201);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]?.[1]).toBe(context);
  });

  test('maps image idempotency conflicts to HTTP 409', async () => {
    const app = new Hono();
    app.post('/images/generate', createImageGenerateHandler({
      getIdentity: identity,
      authorize,
      service: { generate: async () => { throw new ImageGenerationIdempotencyError('IMAGE_IDEMPOTENCY_CONFLICT', 'different request', false); } } as never,
    }));
    const response = await app.request('/images/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'conflict' }, body: JSON.stringify({ organizationKey, scopeKey, collectionKey, prompt: 'Earth' }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: { code: 'IMAGE_IDEMPOTENCY_CONFLICT', message: 'different request', retryable: false } });
  });

  test('history list/delete inject trusted identity and strictly reject identity fields', async () => {
    const calls: unknown[][] = [];
    const generation = { type: 'image', prompt: 'Earth', normalizedPrompt: 'earth', usageCount: 2, generatedAt: '2026-08-31T10:00:00.000Z' };
    const service = { listHistory: async (...args: unknown[]) => { calls.push(['list', ...args]); return { generations: [generation] }; }, deleteHistory: async (...args: unknown[]) => { calls.push(['delete', ...args]); return { normalizedPrompt: 'earth', deleted: true }; } } as never;
    const app = new Hono();
    app.get('/images/generation-history', createImageGenerationHistoryListHandler({ getIdentity: identity, authorize, service }));
    app.delete('/images/generation-history', createImageGenerationHistoryDeleteHandler({ getIdentity: identity, authorize, service }));
    const listResponse = await app.request(`/images/generation-history?organizationKey=${organizationKey}&scopeKey=${scopeKey}`);
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({ success: true, data: { generations: [generation] } });
    const deleteResponse = await app.request('/images/generation-history', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, prompt: 'Earth' }) });
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ success: true, data: { normalizedPrompt: 'earth', deleted: true } });
    expect((await app.request('/images/generation-history', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, prompt: 'Earth', userKey }) })).status).toBe(400);
    expect(calls[0]?.[2]).toBe(context);
    expect(calls[1]?.[2]).toBe(context);
  });

  test('history HTTP and Core adapters converge on the same canonical methods', async () => {
    const calls: unknown[][] = [];
    const service = {
      listHistory: async (...args: unknown[]) => { calls.push(['list', ...args]); return { generations: [] }; },
      deleteHistory: async (...args: unknown[]) => { calls.push(['delete', ...args]); return { normalizedPrompt: 'earth', deleted: true }; },
    } as never;
    await runTool('image.generation-history.list', '', { limit: 5 }, { contentContext: context, images: service });
    await runTool('image.generation-history.delete', '', { prompt: 'Earth' }, { contentContext: context, images: service });
    const app = new Hono();
    app.get('/images/generation-history', createImageGenerationHistoryListHandler({ getIdentity: identity, authorize, service }));
    app.delete('/images/generation-history', createImageGenerationHistoryDeleteHandler({ getIdentity: identity, authorize, service }));
    await app.request(`/images/generation-history?organizationKey=${organizationKey}&scopeKey=${scopeKey}&limit=5`);
    await app.request('/images/generation-history', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, prompt: 'Earth' }) });
    expect(calls[0]!.slice(1)).toEqual(calls[2]!.slice(1));
    expect(calls[1]!.slice(1)).toEqual(calls[3]!.slice(1));
  });

  test('registers product-neutral routes', async () => {
    const app = new Hono();
    registerRoutes(app);
    expect((await app.request('/images/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).not.toBe(404);
    expect((await app.request('/images/generation-history')).status).not.toBe(404);
  });
});

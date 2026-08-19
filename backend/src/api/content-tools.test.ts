import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { ContentError } from '@/lib/ai/tools';
import { createContentToolHandler } from './content-tools';
import { registerRoutes } from './routes';
import { validateQueryParams } from './middleware';

const organizationKey = newId(), scopeKey = newId(), folderKey = newId();
function request(dependencies: Parameters<typeof createContentToolHandler>[0], tool = 'folder.list', body: unknown = { organizationKey, scopeKey, input: { scopeKey } }, headers: Record<string, string> = {}) {
  const app = new Hono(); app.post('/content/tools/:tool', createContentToolHandler(dependencies));
  return app.request(`/content/tools/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

describe('Content tool API', () => {
  test('requires an authenticated user identity', async () => {
    const unauthenticated = await request({ getIdentity: async () => null });
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({ error: { code: 'CONTENT_UNAUTHORIZED' } });
    const wrongIdentity = await request({ getIdentity: async () => ({ key: newId(), identityType: 'member' }) });
    expect(wrongIdentity.status).toBe(403);
  });

  test('rejects invalid tools, bodies, and caller-selected membership fields', async () => {
    const deps = { getIdentity: async () => ({ key: newId(), identityType: 'user' as const }), run: async () => ({}) };
    expect((await request(deps, 'unknown')).status).toBe(400);
    expect((await request(deps, 'folder.list', { organizationKey, scopeKey, input: { scopeKey: 'invalid' } })).status).toBe(400);
    expect((await request(deps, 'folder.list', { organizationKey, scopeKey, input: {}, membershipKey: newId() })).status).toBe(400);
    expect((await request(deps, 'folder.list', { organizationKey, scopeKey, agentKey: newId(), input: { scopeKey } })).status).toBe(400);
  });

  test('dispatches only the authenticated user key and forwards mutation idempotency', async () => {
    const userKey = newId(); let call: any;
    const response = await request({ getIdentity: async () => ({ key: userKey, identityType: 'user' }), run: async (input, options) => { call = { input, options }; return { results: [] }; } }, 'folder.create', { organizationKey, scopeKey, input: { folders: [{ scopeKey, name: 'Plans' }] } }, { 'idempotency-key': 'request-1' });
    expect(response.status).toBe(200);
    expect(call.input.input).toMatchObject({ idempotencyKey: 'request-1' });
    expect(call.options.authenticatedUserKey).toBe(userKey);
    expect(JSON.stringify(call)).not.toContain('membershipKey');
  });

  test('does not forward idempotency to reads and rejects mutation mismatches', async () => {
    let dispatched: any;
    const deps = { getIdentity: async () => ({ key: newId(), identityType: 'user' as const }), run: async (input: any) => { dispatched = input; return {}; } };
    expect((await request(deps, 'folder.list', undefined, { 'idempotency-key': 'ignored' })).status).toBe(200);
    expect(dispatched.input.idempotencyKey).toBeUndefined();
    expect((await request(deps, 'document.translate', { organizationKey, scopeKey, input: { documentKeys: [newId()], targetLanguage: 'French' } }, { 'idempotency-key': 'ignored-preview' })).status).toBe(200);
    expect(dispatched.input.idempotencyKey).toBeUndefined();
    const mismatch = await request(deps, 'folder.create', { organizationKey, scopeKey, input: { folders: [{ scopeKey, name: 'Plans' }], idempotencyKey: 'body' } }, { 'idempotency-key': 'header' });
    expect(mismatch.status).toBe(409);
  });

  test('recognizes and dispatches semantic-neighbor reads', async () => {
    let dispatched: any;
    const response = await request({
      getIdentity: async () => ({ key: newId(), identityType: 'user' }),
      run: async (input) => { dispatched = input; return { folders: [], documents: [], files: [] }; },
    }, 'content.neighbors', { organizationKey, scopeKey, input: { folderKey } });
    expect(response.status).toBe(200);
    expect(dispatched).toMatchObject({ organizationKey, scopeKey, tool: 'content.neighbors', input: { folderKey } });
  });

  test('maps structured Content failures to HTTP statuses', async () => {
    const cases = [['CONTENT_INVALID_INPUT', 400], ['CONTENT_FORBIDDEN', 403], ['CONTENT_NOT_FOUND', 404], ['CONTENT_CONFLICT', 409], ['DOCUMENT_PROCESSING_FAILED', 500]] as const;
    for (const [code, status] of cases) {
      const response = await request({ getIdentity: async () => ({ key: newId(), identityType: 'user' }), run: async () => { throw new ContentError(code, 'Safe failure.', 'folder.list'); } });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ success: false, error: { code, message: 'Safe failure.', retryable: false } });
    }
  });

  test('normalizes document base64 without retaining encoded content and enforces size', async () => {
    let input: any; const user = { key: newId(), identityType: 'user' as const };
    const valid = await request({ getIdentity: async () => user, maxDocumentBytes: 4, run: async (requestInput) => { input = requestInput.input; return {}; } }, 'document.parse', { organizationKey, scopeKey, input: { scopeKey, folderKey, file: { filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 3, encoding: 'base64', content: 'YWJj' } } });
    expect(valid.status).toBe(200);
    expect(input.file.bytes).toEqual(new Uint8Array([97, 98, 99]));
    expect(input.file.content).toBeUndefined();
    const tooLarge = await request({ getIdentity: async () => user, maxDocumentBytes: 2, run: async () => ({}) }, 'document.parse', { organizationKey, scopeKey, input: { scopeKey, folderKey, file: { filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 3, encoding: 'base64', content: 'YWJj' } } });
    expect(tooLarge.status).toBe(400);
    expect(await tooLarge.json()).toMatchObject({ error: { code: 'DOCUMENT_TOO_LARGE' } });
  });

  test('rejects oversized request bodies before JSON and base64 normalization', async () => {
    const user = { key: newId(), identityType: 'user' as const };
    const response = await request({ getIdentity: async () => user, maxDocumentBytes: 1, run: async () => ({}) }, 'document.parse', {
      organizationKey,
      scopeKey,
      input: { scopeKey, file: { filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 1, encoding: 'base64', content: 'A'.repeat(70_000) } },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'DOCUMENT_TOO_LARGE' } });
  });

  test('is registered under the API route and rejects query parameters', async () => {
    const app = new Hono(); const api = app.basePath('/api/v1');
    app.onError((_error, c) => c.json({ error: 'invalid query' }, 400));
    app.use('*', validateQueryParams);
    app.use('*', async (c, next) => { (c as any).set('authIdentity', { key: newId(), identityType: 'user' }); await next(); });
    registerRoutes(api);
    const registered = await app.request('/api/v1/content/tools/not-a-tool', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(await registered.json()).toMatchObject({ error: { code: 'CONTENT_INVALID_INPUT' } });
    const response = await app.request('/api/v1/content/tools/not-a-tool?membershipKey=other', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(400);
  });
});

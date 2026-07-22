import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { ArchiveError } from '@/lib/ai/tools/archive';
import { createArchiveToolHandler } from './archive-tools';
import { registerRoutes } from './routes';
import { validateQueryParams } from './middleware';

const organizationKey = newId(), agentKey = newId(), scopeKey = newId(), folderKey = newId();
function request(dependencies: Parameters<typeof createArchiveToolHandler>[0], tool = 'folder.list', body: unknown = { organizationKey, agentKey, input: { scopeKey } }, headers: Record<string, string> = {}) {
  const app = new Hono(); app.post('/archive/tools/:tool', createArchiveToolHandler(dependencies));
  return app.request(`/archive/tools/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

describe('Archive tool API', () => {
  test('requires an authenticated user identity', async () => {
    const unauthenticated = await request({ getIdentity: async () => null });
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({ error: { code: 'ARCHIVE_UNAUTHORIZED' } });
    const wrongIdentity = await request({ getIdentity: async () => ({ key: newId(), identityType: 'member' }) });
    expect(wrongIdentity.status).toBe(403);
  });

  test('rejects invalid tools, bodies, and caller-selected membership fields', async () => {
    const deps = { getIdentity: async () => ({ key: newId(), identityType: 'user' as const }), run: async () => ({}) };
    expect((await request(deps, 'unknown')).status).toBe(400);
    expect((await request(deps, 'folder.list', { organizationKey, agentKey, input: { scopeKey: 'invalid' } })).status).toBe(400);
    expect((await request(deps, 'folder.list', { organizationKey, agentKey, input: {}, membershipKey: newId() })).status).toBe(400);
  });

  test('dispatches only the authenticated user key and forwards mutation idempotency', async () => {
    const userKey = newId(); let call: any;
    const response = await request({ getIdentity: async () => ({ key: userKey, identityType: 'user' }), run: async (input, options) => { call = { input, options }; return { results: [] }; } }, 'folder.create', { organizationKey, agentKey, input: { folders: [{ scopeKey, name: 'Plans' }] } }, { 'idempotency-key': 'request-1' });
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
    expect((await request(deps, 'document.translate', { organizationKey, agentKey, input: { documentKeys: [newId()], targetLanguage: 'French' } }, { 'idempotency-key': 'ignored-preview' })).status).toBe(200);
    expect(dispatched.input.idempotencyKey).toBeUndefined();
    const mismatch = await request(deps, 'folder.create', { organizationKey, agentKey, input: { folders: [{ scopeKey, name: 'Plans' }], idempotencyKey: 'body' } }, { 'idempotency-key': 'header' });
    expect(mismatch.status).toBe(409);
  });

  test('maps structured Archive failures to HTTP statuses', async () => {
    const cases = [['ARCHIVE_INVALID_INPUT', 400], ['ARCHIVE_FORBIDDEN', 403], ['ARCHIVE_NOT_FOUND', 404], ['ARCHIVE_CONFLICT', 409], ['DOCUMENT_PROCESSING_FAILED', 500]] as const;
    for (const [code, status] of cases) {
      const response = await request({ getIdentity: async () => ({ key: newId(), identityType: 'user' }), run: async () => { throw new ArchiveError(code, 'Safe failure.', 'folder.list'); } });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ success: false, error: { code, message: 'Safe failure.', retryable: false } });
    }
  });

  test('normalizes document base64 without retaining encoded content and enforces size', async () => {
    let input: any; const user = { key: newId(), identityType: 'user' as const };
    const valid = await request({ getIdentity: async () => user, maxDocumentBytes: 4, run: async (requestInput) => { input = requestInput.input; return {}; } }, 'document.processing', { organizationKey, agentKey, input: { scopeKey, folderKey, file: { filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 3, encoding: 'base64', content: 'YWJj' } } });
    expect(valid.status).toBe(200);
    expect(input.file.bytes).toEqual(new Uint8Array([97, 98, 99]));
    expect(input.file.content).toBeUndefined();
    const tooLarge = await request({ getIdentity: async () => user, maxDocumentBytes: 2, run: async () => ({}) }, 'document.processing', { organizationKey, agentKey, input: { scopeKey, folderKey, file: { filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 3, encoding: 'base64', content: 'YWJj' } } });
    expect(tooLarge.status).toBe(400);
    expect(await tooLarge.json()).toMatchObject({ error: { code: 'DOCUMENT_TOO_LARGE' } });
  });

  test('is registered under the API route and rejects query parameters', async () => {
    const app = new Hono(); const api = app.basePath('/api/v1');
    app.onError((_error, c) => c.json({ error: 'invalid query' }, 400));
    app.use('*', validateQueryParams);
    app.use('*', async (c, next) => { (c as any).set('authIdentity', { key: newId(), identityType: 'user' }); await next(); });
    registerRoutes(api);
    const registered = await app.request('/api/v1/archive/tools/not-a-tool', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(await registered.json()).toMatchObject({ error: { code: 'ARCHIVE_INVALID_INPUT' } });
    const response = await app.request('/api/v1/archive/tools/not-a-tool?membershipKey=other', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(400);
  });
});

import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { createDocumentUploadHandlers } from './document-uploads';

test('upload transport rejects untrusted fields and reaches only the scoped protocol service', async () => {
  const teamKey = newId(), scopeKey = newId(), userKey = newId();
  const calls: unknown[] = [];
  const handlers = createDocumentUploadHandlers({
    getIdentity: async () => ({ key: userKey, identityType: 'user' }),
    authorize: async (selectors) => { calls.push(selectors); return { context: { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey } } } as any, input: selectors }; },
    reserve: async (input, context) => { calls.push({ input, context }); return { uploadKey: newId(), uploads: [] }; },
    complete: async (input, context, options) => { calls.push({ input, context, options }); return { document: { key: newId() } }; },
  });
  const app = new Hono(); app.post('/presign', handlers.reserve); app.post('/complete', handlers.complete);
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const input = { teamKey, scopeKey, kind: 'file', files: [{ filename: 'note.txt', mimeType: 'text/plain', sizeBytes: 4 }], idempotencyKey: 'request-1' };
  expect((await post('/presign', { ...input, membershipKey: newId() })).status).toBe(400);
  expect((await post('/presign', input)).status).toBe(201);
  expect(calls[0]).toEqual({ teamKey, scopeKey });
  expect(calls[1]).toMatchObject({ input, context: { runtimeScopeKey: scopeKey } });
  expect((await post('/complete', { teamKey, scopeKey, uploadKey: newId(), idempotencyKey: 'request-1' })).status).toBe(200);
  expect(calls[3]).toMatchObject({ options: { authenticatedUserKey: userKey } });
  const unauthenticated = createDocumentUploadHandlers({ getIdentity: async () => null });
  const anonymous = new Hono(); anonymous.post('/presign', unauthenticated.reserve);
  expect((await anonymous.request('/presign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).status).toBe(401);
});

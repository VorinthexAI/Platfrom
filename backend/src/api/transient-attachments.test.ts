import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools';
import { createTransientAttachmentHandlers } from './transient-attachments';
import { normalizeTransientAttachmentError } from '@/lib/conversations/transient-attachments';
import { DocumentInputError } from '@/lib/ai/document-processing';

describe('transient attachment HTTP contract', () => {
  test('classifies deterministic file validation as a client error', () => {
    expect(normalizeTransientAttachmentError(new DocumentInputError('DOCUMENT_UPLOAD_INVALID', 'Invalid bytes.', 'document-validate'))).toMatchObject({ status: 400, code: 'DOCUMENT_UPLOAD_INVALID' });
  });

  test('requires user auth, rejects unknown fields, and passes only trusted ownership to the service', async () => {
    const organizationKey = 'organization', scopeKey = newId(), userKey = newId(), conversationKey = newId();
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const calls: unknown[] = [];
    const handlers = createTransientAttachmentHandlers({
      getIdentity: async () => ({ identityType: 'user', key: userKey }) as never,
      authorize: async () => ({ context }),
      reserve: async (...args: unknown[]) => { calls.push(args); return { uploads: [] }; },
      complete: async (...args: unknown[]) => { calls.push(args); return { attachments: [] }; },
    });
    const app = new Hono();
    app.post('/conversations/:conversationKey/attachments/uploads/presign', handlers.reserve);
    app.post('/conversations/:conversationKey/attachments/uploads/complete', handlers.complete);
    const body = { organizationKey, scopeKey, requestKey: 'request-1', files: [{ clientKey: 'file-1', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 12 }] };
    expect((await app.request(`/conversations/${conversationKey}/attachments/uploads/presign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, userKey }) })).status).toBe(400);
    const response = await app.request(`/conversations/${conversationKey}/attachments/uploads/presign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(201);
    expect(calls).toEqual([[{ conversationKey, requestKey: 'request-1', files: body.files }, { organizationKey, scopeKey, userKey }]]);
    const complete = await app.request(`/conversations/${conversationKey}/attachments/uploads/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, requestKey: 'request-1', attachmentKeys: [newId()] }) });
    expect(complete.status).toBe(200);
  });

  test('returns 401 before invoking the protocol for an unauthenticated request', async () => {
    let called = false;
    const handlers = createTransientAttachmentHandlers({ getIdentity: async () => null, reserve: async () => { called = true; return { uploads: [] }; } });
    const app = new Hono(); app.post('/conversations/:conversationKey/attachments/uploads/presign', handlers.reserve);
    const response = await app.request(`/conversations/${newId()}/attachments/uploads/presign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey: 'organization', scopeKey: newId(), requestKey: 'request', files: [{ clientKey: 'x', filename: 'x.txt', mimeType: 'text/plain', sizeBytes: 1 }] }) });
    expect(response.status).toBe(401); expect(called).toBe(false);
  });
});

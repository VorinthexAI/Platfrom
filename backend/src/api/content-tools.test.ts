import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { ContentError } from '@/lib/ai/tools';
import { createContentToolHandler } from './content-tools';
import { registerRoutes } from './routes';
import { validateQueryParams } from './middleware';
import { SparkRepositoryError } from '@/lib/sparks/repository';
import { recordActionCost, recordActionUsage } from '@/lib/ai/events/runtime';

const teamKey = newId(), scopeKey = newId(), folderKey = newId();
function request(dependencies: Parameters<typeof createContentToolHandler>[0], tool = 'folder.list', body: unknown = { teamKey, scopeKey, input: { scopeKey } }, headers: Record<string, string> = {}) {
  const app = new Hono(); app.post('/content/tools/:tool', createContentToolHandler(dependencies));
  return app.request(`/content/tools/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

describe('Content tool API', () => {
  test('accepts valid multi-megabyte upload and scan base64 without regex backtracking limits', async () => {
    const bytes = new Uint8Array(4 * 1024 * 1024).fill(1);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const content = Buffer.from(bytes).toString('base64');
    const calls: any[] = [];
    const dependencies = { getIdentity: async () => ({ key: newId(), identityType: 'user' as const }), run: async (input: any) => { calls.push(input); return {}; } };
    const file = { filename: 'large.txt', mimeType: 'text/plain', sizeBytes: bytes.length, encoding: 'base64', content };
    const upload = await request(dependencies, 'document.parse', { teamKey, scopeKey, input: { scopeKey, file, idempotencyKey: 'large-upload' } }, { 'idempotency-key': 'large-upload' });
    expect(upload.status).toBe(200);
    const scan = await request(dependencies, 'document.parse', { teamKey, scopeKey, input: { scopeKey, pages: [{ ...file, filename: 'page.png', mimeType: 'image/png' }], idempotencyKey: 'large-scan' } }, { 'idempotency-key': 'large-scan' });
    expect(scan.status).toBe(200);
    expect(calls[0].input.file.bytes.byteLength).toBe(bytes.length);
    expect(calls[1].input.pages[0].bytes.byteLength).toBe(bytes.length);
  });
  test('preserves the body key when a topic summary is requested without an idempotency header', async () => {
    const dispatched: any[] = [];
    const documentKey = newId();
    const deps = { getIdentity: async () => ({ key: newId(), identityType: 'user' as const }), run: async (input: unknown, options: unknown) => { dispatched.push({ input, options }); return { results: [] }; } };
    const body = { teamKey, scopeKey, input: { documentKeys: [documentKey], topic: 'Hello', style: 'brief', persist: true, idempotencyKey: 'summary-click-1' } };
    expect((await request(deps, 'document.summarize', body)).status).toBe(200);
    expect(dispatched[0]).toMatchObject({ input: { input: { idempotencyKey: 'summary-click-1', topic: 'Hello' } }, options: { requestKey: 'summary-click-1' } });
    expect((await request(deps, 'document.summarize', body, { 'idempotency-key': 'summary-click-1' })).status).toBe(200);
    expect((await request(deps, 'document.summarize', body, { 'idempotency-key': 'different-click' })).status).toBe(409);
    expect(dispatched).toHaveLength(2);
  });

  test('derives a stable summary execution key only when neither transport location supplies one', async () => {
    const keys: string[] = [];
    const deps = { getIdentity: async () => ({ key: newId(), identityType: 'user' as const }), run: async (_input: unknown, options: any) => { keys.push(options.requestKey); return { results: [] }; } };
    const body = { teamKey, scopeKey, input: { documentKeys: [newId()], topic: 'Hello', persist: true } };
    for (const value of [body, body, { ...body, input: { ...body.input, topic: 'Another topic' } }]) expect((await request(deps, 'document.summarize', value)).status).toBe(200);
    expect(keys[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });
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
    expect((await request(deps, 'folder.list', { teamKey, scopeKey, input: { scopeKey: 'invalid' } })).status).toBe(400);
    expect((await request(deps, 'folder.list', { teamKey, scopeKey, input: {}, teamMembershipKey: newId() })).status).toBe(400);
    expect((await request(deps, 'folder.list', { teamKey, scopeKey, agentKey: newId(), input: { scopeKey } })).status).toBe(400);
  });

  test('injects session-bound team assurance and forwards mutation idempotency', async () => {
    const userKey = newId(); let call: any;
    const assurance = { teamMembershipKey: newId(), teamMfaVersion: 3 };
    const response = await request({ getIdentity: async () => ({ key: userKey, identityType: 'user', ...assurance }), run: async (input, options) => { call = { input, options }; return { results: [] }; } }, 'folder.create', { teamKey, scopeKey, input: { folders: [{ scopeKey, name: 'Plans' }] } }, { 'idempotency-key': 'request-1' });
    expect(response.status).toBe(200);
    expect(call.input.input).toMatchObject({ idempotencyKey: 'request-1' });
    expect(call.options.authenticatedUserKey).toBe(userKey);
    expect(call.options.teamAssurance).toEqual(assurance);
  });

  test('keeps read inputs clean, forwards the execution key, and rejects mutation mismatches', async () => {
    let dispatched: any, executionOptions: any;
    const deps = { getIdentity: async () => ({ key: newId(), identityType: 'user' as const }), run: async (input: any, options: any) => { dispatched = input; executionOptions = options; return {}; } };
    expect((await request(deps, 'folder.list', undefined, { 'idempotency-key': 'ignored' })).status).toBe(200);
    expect(dispatched.input.idempotencyKey).toBeUndefined();
    expect(executionOptions.requestKey).toBe('ignored');
    expect((await request(deps, 'document.translate', { teamKey, scopeKey, input: { documentKeys: [newId()], targetLanguage: 'French' } }, { 'idempotency-key': 'ignored-preview' })).status).toBe(400);
    expect(dispatched.input.idempotencyKey).toBeUndefined();
    const mismatch = await request(deps, 'folder.create', { teamKey, scopeKey, input: { folders: [{ scopeKey, name: 'Plans' }], idempotencyKey: 'body' } }, { 'idempotency-key': 'header' });
    expect(mismatch.status).toBe(409);
  });

  test('recognizes and dispatches semantic-neighbor reads', async () => {
    let dispatched: any;
    const response = await request({
      getIdentity: async () => ({ key: newId(), identityType: 'user' }),
      run: async (input) => { dispatched = input; return { folders: [], documents: [], files: [] }; },
    }, 'content.neighbors', { teamKey, scopeKey, input: { folderKey } });
    expect(response.status).toBe(200);
    expect(dispatched).toMatchObject({ teamKey, scopeKey, tool: 'content.neighbors', input: { folderKey } });
  });

  test('maps structured Content failures to HTTP statuses', async () => {
    const cases = [['CONTENT_INVALID_INPUT', 400], ['CONTENT_FORBIDDEN', 403], ['CONTENT_NOT_FOUND', 404], ['CONTENT_CONFLICT', 409], ['CONTENT_IDEMPOTENCY_PENDING', 409], ['CONTENT_IDEMPOTENCY_INDETERMINATE', 409], ['CONTENT_IDEMPOTENCY_FAILED', 409], ['DOCUMENT_PROCESSING_FAILED', 500]] as const;
    for (const [code, status] of cases) {
      const response = await request({ getIdentity: async () => ({ key: newId(), identityType: 'user' }), run: async () => { throw new ContentError(code, 'Safe failure.', 'folder.list'); } });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ success: false, error: { code, message: 'Safe failure.', retryable: false } });
    }
  });

  test('normalizes document base64 without retaining encoded content and enforces size', async () => {
    let input: any; const user = { key: newId(), identityType: 'user' as const };
    const valid = await request({ getIdentity: async () => user, maxDocumentBytes: 4, run: async (requestInput) => { input = requestInput.input; return {}; } }, 'document.parse', { teamKey, scopeKey, input: { scopeKey, folderKey, file: { filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 3, encoding: 'base64', content: 'YWJj' } } }, { 'idempotency-key': 'parse-request' });
    expect(valid.status).toBe(200);
    expect(input.file.bytes).toEqual(new Uint8Array([97, 98, 99]));
    expect(input.file.content).toBeUndefined();
    const tooLarge = await request({ getIdentity: async () => user, maxDocumentBytes: 2, run: async () => ({}) }, 'document.parse', { teamKey, scopeKey, input: { scopeKey, folderKey, file: { filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 3, encoding: 'base64', content: 'YWJj' } } });
    expect(tooLarge.status).toBe(400);
    expect(await tooLarge.json()).toMatchObject({ error: { code: 'DOCUMENT_TOO_LARGE' } });
  });

  test('charges document parsing by actual text action usage without a fixed tool debit', async () => {
    const userKey = newId();
    const charges: Record<string, unknown>[] = [], refunds: Record<string, unknown>[] = [];
    let executions = 0;
    const serviceOptions = {
      resolveMembership: async () => ({ key: newId(), teamKey: teamKey, userId: userKey, status: 'active' }),
      resolveUser: async () => ({ key: userKey, currentScopeKey: scopeKey }),
      authorizeScope: async () => ({ allowed: true }),
      execute: async () => { await recordActionCost('text'); await recordActionUsage('text', {}, { inputTokens: 100, outputTokens: 20, totalTokens: 120 }); executions += 1; return { results: [] }; },
      recordEvent: async () => {},
      appScopeKey: newId(),
      billing: {
        charge: async (_key: string, input: Record<string, unknown>) => { charges.push(input); return { status: 'applied', transaction: { key: newId(), eventKey: input.eventKey } } as never; },
        refund: async (_key: string, input: Record<string, unknown>) => { refunds.push(input); return { status: 'applied', transaction: { key: newId() } } as never; },
      },
    } as never;
    const body = { teamKey, scopeKey, input: { scopeKey, folderKey, file: { filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 3, encoding: 'base64', content: 'YWJj' } } };
    expect((await request({ getIdentity: async () => ({ key: userKey, identityType: 'user' }), serviceOptions }, 'document.parse', body, { 'idempotency-key': 'parse-billed' })).status).toBe(200);
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ kind: 'action', actionSlug: 'text', metadata: { inputTokens: 100, outputTokens: 20 } });
    expect(charges[0]).not.toHaveProperty('toolSlug');

    const failedOptions = { ...(serviceOptions as any), execute: async () => { await recordActionCost('text'); await recordActionUsage('text', {}, { inputTokens: 100, outputTokens: 20, totalTokens: 120 }); throw new Error('parse failed'); } };
    expect((await request({ getIdentity: async () => ({ key: userKey, identityType: 'user' }), serviceOptions: failedOptions }, 'document.parse', body, { 'idempotency-key': 'parse-failed' })).status).toBe(500);
    expect(refunds).toHaveLength(1);

    const insufficientOptions = { ...(serviceOptions as any), billing: { charge: async () => { throw new SparkRepositoryError('INSUFFICIENT_BALANCE', 'private'); } } };
    expect((await request({ getIdentity: async () => ({ key: userKey, identityType: 'user' }), serviceOptions: insufficientOptions }, 'document.parse', body, { 'idempotency-key': 'parse-insufficient' })).status).toBe(402);
    expect(executions).toBe(1);
  });

  test('rejects oversized request bodies before JSON and base64 normalization', async () => {
    const user = { key: newId(), identityType: 'user' as const };
    const response = await request({ getIdentity: async () => user, maxDocumentBytes: 1, run: async () => ({}) }, 'document.parse', {
      teamKey,
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
    const response = await app.request('/api/v1/content/tools/not-a-tool?teamMembershipKey=other', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(400);
  });
});

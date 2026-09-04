import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { runTool } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { createAppTransformationHandlers } from './app-transformation';
import { registerRoutes } from './routes';
import { recordActionCost, recordActionUsage } from '@/lib/ai/events/runtime';
import { SparkRepositoryError } from '@/lib/sparks/repository';

const organizationKey = newId(), scopeKey = newId(), userKey = newId(), documentKey = newId(), messageKey = newId();
const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
const identity = async () => ({ key: userKey, identityType: 'user' as const });
const authorize = async () => ({ input: { organizationKey, scopeKey }, context });

function appWith(dependencies: Parameters<typeof createAppTransformationHandlers>[0]) {
  const handlers = createAppTransformationHandlers(dependencies);
  return new Hono().post('/app/enhance', handlers.enhance).post('/app/translate', handlers.translate);
}

describe('app transformation HTTP API', () => {
  test('registers both authenticated routes and rejects unknown model input', async () => {
    const routes = new Hono();
    registerRoutes(routes);
    expect((await routes.request('/app/enhance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    expect((await routes.request('/app/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    const app = appWith({ getIdentity: identity, authorize, service: { enhance: async () => ({ text: 'ok' }), translate: async () => ({ text: 'ok' }) } });
    const response = await app.request('/app/enhance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, input: { text: 'Draft', userKey } }) });
    expect(response.status).toBe(400);
  });

  test('HTTP and unified tools share raw text transformation services', async () => {
    const calls: unknown[][] = [];
    const service = {
      enhance: async (...args: any[]) => { calls.push(['enhance', ...args]); return { text: 'Clear draft.' }; },
      translate: async (...args: any[]) => { calls.push(['translate', ...args]); return { text: 'Brouillon.' }; },
    };
    await runTool('app.enhance', '', { text: 'Draft.' }, { contentContext: context, appTransformationService: service });
    const response = await appWith({ getIdentity: identity, authorize, service }).request('/app/enhance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, input: { text: 'Draft.' } }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { text: 'Clear draft.' } });
    expect(calls.map((call) => call.slice(0, 3))).toEqual([
      ['enhance', { text: 'Draft.', instruction: undefined }, organizationKey],
      ['enhance', { text: 'Draft.', instruction: undefined }, organizationKey],
    ]);
  });

  test('Archive selectors converge on preview-only Content operations', async () => {
    const calls: unknown[][] = [];
    const executeContent = async (...args: any[]) => { calls.push(args); return { results: [{ success: true, data: { text: 'Generated.' } }] }; };
    await runTool('app.translate', '', { documentKey, targetLanguage: 'French', save: false }, { contentContext: context, executeWorkspaceContent: executeContent as never });
    const response = await appWith({ getIdentity: identity, authorize, executeContent: executeContent as never }).request('/app/translate', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'preview-request' }, body: JSON.stringify({ organizationKey, scopeKey, input: { documentKey, targetLanguage: 'French', save: false } }) });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call[0]).toBe('document.translate');
      expect(call[1]).toEqual({ documentKeys: [documentKey], targetLanguage: 'French', preserveFormatting: true, mode: 'preview' });
      expect(call[2]).toBe(context);
    }
  });

  test('Signal selectors converge on persisted email translation', async () => {
    const calls: unknown[][] = [];
    const version = { key: newId(), documentKey: messageKey, version: 1, content: 'Bonjour.', createdAt: '2026-08-24T00:00:00.000Z' };
    const email = { translateMessage: async (...args: any[]) => { calls.push(args); return { messageKey, language: 'French', version }; } } as never;
    await runTool('app.translate', '', { messageKey, targetLanguage: 'French' }, { contentContext: context, emailService: email, requestKey: 'tool-request' });
    const response = await appWith({ getIdentity: identity, authorize, email }).request('/app/translate', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'http-request' }, body: JSON.stringify({ organizationKey, scopeKey, input: { messageKey, targetLanguage: 'French' } }) });
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      [{ userKey, organizationKey, scopeKey }, { messageKey, targetLanguage: 'French', sourceLanguage: undefined }, 'tool-request'],
      [{ userKey, organizationKey, scopeKey }, { messageKey, targetLanguage: 'French', sourceLanguage: undefined }, 'http-request'],
    ]);
  });

  test('HTTP and Core meter translation actions identically and preserve 402', async () => {
    const charges: Record<string, unknown>[] = [];
    const service = { enhance: async () => ({ text: 'unused' }), translate: async () => { await recordActionCost('text'); await recordActionUsage('text', { messages: ['Draft'] }, { inputTokens: 1, outputTokens: 1, totalTokens: 2 }); return { text: 'Brouillon' }; } };
    const billing = { charge: async (_key: string, input: Record<string, unknown>) => { charges.push(input); return { status: 'applied', transaction: { key: newId() } } as never; } };
    await runTool('app.translate', '', { text: 'Draft', targetLanguage: 'French' }, { contentContext: context, appTransformationService: service, requestKey: 'core-translate', recordEvent: async () => {}, billing });
    const response = await appWith({ getIdentity: identity, authorize, service, recordEvent: async () => {}, billing }).request('/app/translate', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'http-translate' }, body: JSON.stringify({ organizationKey, scopeKey, input: { text: 'Draft', targetLanguage: 'French' } }) });
    expect(response.status).toBe(200);
    expect(charges).toHaveLength(2);
    expect(charges.every((charge) => charge.actionSlug === 'text' && charge.microSparks === 550)).toBe(true);

    const insufficient = await appWith({ getIdentity: identity, authorize, service, recordEvent: async () => {}, billing: { charge: async () => { throw new SparkRepositoryError('INSUFFICIENT_BALANCE', 'private'); } } }).request('/app/translate', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'insufficient-translate' }, body: JSON.stringify({ organizationKey, scopeKey, input: { text: 'Draft', targetLanguage: 'French' } }) });
    expect(insufficient.status).toBe(402);
  });
});

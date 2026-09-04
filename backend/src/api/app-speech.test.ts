import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { runTool } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { createAppSpeechHandler } from './app-speech';
import { registerRoutes } from './routes';
import { recordActionCost, recordActionUsage } from '@/lib/ai/events/runtime';
import { SparkRepositoryError } from '@/lib/sparks/repository';

const organizationKey = newId(), scopeKey = newId(), userKey = newId(), documentKey = newId();
const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
const output = { key: newId(), documentKey, version: 1, sourceContentHash: 'a'.repeat(64), sourceTitle: 'Notes', sourceDocumentUpdatedAt: '2026-08-27T00:00:00.000Z', mimeType: 'audio/mpeg' as const, sizeBytes: 1, durationMs: 1_000, isCurrent: false, playbackPositionMs: 0, voice: 'clear', speakingRate: 1, includeTitle: true, includeCode: false, createdAt: '2026-08-27T00:00:00.000Z', current: true, url: 'https://audio.example/version.mp3' };

describe('app speech HTTP API', () => {
  test('registers the authenticated strict route', async () => {
    const routes = new Hono(); registerRoutes(routes);
    expect((await routes.request('/app/speech', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    const app = new Hono().post('/app/speech', createAppSpeechHandler({ getIdentity: async () => ({ key: userKey, identityType: 'user' }), authorize: async () => ({ input: { organizationKey, scopeKey }, context }), service: { generateDocument: async () => output, generateForTarget: async () => { throw new Error('unexpected'); } } }));
    const response = await app.request('/app/speech', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, input: { documentKey, text: 'forged' } }) });
    expect(response.status).toBe(400);
  });

  test('HTTP and Core converge on app.speech with trusted identity and scope', async () => {
    const calls: unknown[][] = [];
    const service = { generateDocument: async (...args: any[]) => { calls.push(args); return output; }, generateForTarget: async () => { throw new Error('unexpected'); } } as any;
    await runTool('app.speech', '', { documentKey, voice: 'calm' }, { contentContext: context, appSpeechService: service });
    const app = new Hono().post('/app/speech', createAppSpeechHandler({ getIdentity: async () => ({ key: userKey, identityType: 'user' }), authorize: async () => ({ input: { organizationKey, scopeKey }, context }), service }));
    const response = await app.request('/app/speech', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'speech-request' }, body: JSON.stringify({ organizationKey, scopeKey, input: { documentKey, voice: 'calm' } }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: output });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call[1] === context)).toBe(true);
    expect(calls.map((call) => call[0])).toEqual([{ documentKey, voice: 'calm', pace: 1, includeTitle: true, includeCode: false }, { documentKey, voice: 'calm', pace: 1, includeTitle: true, includeCode: false }]);
  });

  test('HTTP and Core share action debit semantics and HTTP preserves 402', async () => {
    const charges: Record<string, unknown>[] = [];
    const service = { generateDocument: async () => { await recordActionCost('speech'); await recordActionUsage('speech', { text: 'hello' }, { inputTokens: 0, outputTokens: 1, totalTokens: 1 }); return output; }, generateForTarget: async () => { throw new Error('unexpected'); } } as any;
    const billing = { charge: async (_key: string, input: Record<string, unknown>) => { charges.push(input); return { status: 'applied', transaction: { key: newId() } } as never; } };
    await runTool('app.speech', '', { documentKey, voice: 'calm' }, { contentContext: context, appSpeechService: service, requestKey: 'core-speech', recordEvent: async () => {}, billing });
    const app = new Hono().post('/app/speech', createAppSpeechHandler({ getIdentity: async () => ({ key: userKey, identityType: 'user' }), authorize: async () => ({ input: { organizationKey, scopeKey }, context }), service, recordEvent: async () => {}, billing }));
    expect((await app.request('/app/speech', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'http-speech' }, body: JSON.stringify({ organizationKey, scopeKey, input: { documentKey, voice: 'calm' } }) })).status).toBe(200);
    expect(charges).toHaveLength(2);
    expect(charges.every((charge) => charge.actionSlug === 'speech' && charge.microSparks === 10_000)).toBe(true);

    const insufficient = new Hono().post('/app/speech', createAppSpeechHandler({ getIdentity: async () => ({ key: userKey, identityType: 'user' }), authorize: async () => ({ input: { organizationKey, scopeKey }, context }), service, recordEvent: async () => {}, billing: { charge: async () => { throw new SparkRepositoryError('INSUFFICIENT_BALANCE', 'private'); } } }));
    expect((await insufficient.request('/app/speech', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'insufficient' }, body: JSON.stringify({ organizationKey, scopeKey, input: { documentKey, voice: 'calm' } }) })).status).toBe(402);
  });
});

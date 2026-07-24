import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { createChorusHandlers } from './chorus';

const organizationKey = 'root-org';
const channelKey = newId();
const actor = { organizationKey, membershipKey: newId() };

function appFor(options: { authenticated?: boolean; forbidden?: boolean; fail?: boolean; output?: string; gate?: Promise<void> } = {}) {
  const persisted: string[] = [];
  const assistantCalls: unknown[][] = [];
  const historyCalls: unknown[][] = [];
  const access = { channel: { key: channelKey }, orchestrator: { skill: 'Lead.' } };
  const service = {
    async persistUserMessage() { persisted.push('user'); return { access, message: { key: newId(), content: 'hello' } }; },
    async history(...args: unknown[]) { historyCalls.push(args); return []; },
    async persistOrchestratorMessage(...args: unknown[]) { assistantCalls.push(args); persisted.push('assistant'); return { key: newId(), content: args[1] as string, threadKey: args[2] as string, replyToMessageKey: args[3] as string }; },
  };
  const handlers = createChorusHandlers({
    service: service as never,
    resolveActor: async (c) => options.authenticated === false ? c.json({ error: 'authentication required' }, 401) : options.forbidden ? c.json({ error: 'founders gate access required' }, 403) : actor,
    stream: async function* () { yield { type: 'text-delta', text: options.output ?? 'Hi ' }; if (options.gate) await options.gate; if (options.fail) throw new Error('provider unavailable'); if (!options.output) yield { type: 'text-delta', text: 'there' }; yield { type: 'done' }; },
  });
  const app = new Hono();
  app.post('/founders/organizations/:organizationKey/chorus/channels/:channelKey/messages', handlers.postMessage);
  return { app, persisted, assistantCalls, historyCalls };
}

describe('Chorus SSE API', () => {
  test('returns 401 before parsing a message for an unauthenticated request', async () => {
    const { app } = appFor({ authenticated: false });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'authentication required' });
  });

  test('streams tokens and persists user then assistant messages', async () => {
    const { app, persisted, assistantCalls, historyCalls } = appFor();
    const threadKey = newId();
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello', threadKey }) });
    const text = await response.text();
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(text).toContain('event: start'); expect(text).toContain('event: token'); expect(text).toContain('event: done');
    expect(persisted).toEqual(['user', 'assistant']);
    expect(historyCalls[0]?.slice(1)).toEqual([threadKey, expect.any(String)]);
    expect(assistantCalls[0]?.slice(1)).toEqual(['Hi there', threadKey, expect.any(String)]);
  });

  test('keeps founder-gate denial distinct from authentication denial', async () => {
    const { app } = appFor({ forbidden: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'founders gate access required' });
  });

  test('sanitizes and bounds provider output before persistence', async () => {
    const { app, assistantCalls } = appFor({ output: `${'x'.repeat(8_100)}😀` });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    await response.text();
    expect(assistantCalls[0]?.[1]).toBe('x'.repeat(8_000));
  });

  test('rejects concurrent sends per channel and releases the lock after completion', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { app } = appFor({ gate });
    const request = () => app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const first = await request();
    const consuming = first.text();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await request()).status).toBe(409);
    release();
    await consuming;
    const retried = await request();
    expect(retried.status).toBe(200);
    await retried.text();
  });

  test('emits a safe error and does not persist a partial assistant response', async () => {
    const { app, persisted } = appFor({ fail: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const text = await response.text();
    expect(text).toContain('event: error'); expect(text).toContain('orchestrator stream failed');
    expect(persisted).toEqual(['user']);
    const retried = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'retry' }) });
    expect(retried.status).toBe(200);
  });

  test('uses the shared founder gate and founder user key for target organization access', async () => {
    const source = await Bun.file(new URL('./chorus.ts', import.meta.url)).text();
    expect(source).toContain('await requireFounder(c)');
    expect(source).toContain('requireOrganizationAccess(auth.founder.user.key, requestedOrganizationKey)');
    expect(source).not.toContain("identity.identityType !== 'user'");
  });
});

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
  const streamSkills: string[] = [];
  const streamInputs: unknown[] = [];
  const transcriptionCalls: unknown[][] = [];
  const speechCalls: unknown[][] = [];
  const access = { channel: { key: channelKey }, humanParticipant: { key: newId() }, mentions: [{ participantKey: 'everyone', type: 'everyone', key: 'everyone', name: 'everyone', mentionCount: 0 }, { participantKey: newId(), type: 'orchestrator', key: newId(), name: 'Atlas', mentionCount: 0 }] };
  const atlas = { participantKey: newId(), type: 'orchestrator' as const, key: newId(), name: 'Atlas', role: 'CEO', skill: 'Lead.' };
  const service = {
    async persistUserMessage() { persisted.push('user'); return { access, message: { key: newId(), content: 'hello' }, orchestrators: [atlas] }; },
    async persistOrchestratorMessage(...args: unknown[]) { assistantCalls.push(args); persisted.push('assistant'); return { key: newId(), content: args[1] as string, threadKey: args[2] as string, replyToMessageKey: args[3] as string }; },
    async clearChannel() { return 2; },
    async generalChannel() { return access; },
  };
  const handlers = createChorusHandlers({
    service: service as never,
    resolveActor: async (c) => options.authenticated === false ? c.json({ error: 'authentication required' }, 401) : options.forbidden ? c.json({ error: 'founders gate access required' }, 403) : actor,
    stream: async function* (skill, input) { streamSkills.push(skill); streamInputs.push(input); yield { type: 'text-delta', text: options.output ?? 'Hi ' }; if (options.gate) await options.gate; if (options.fail) throw new Error('provider unavailable'); if (!options.output) yield { type: 'text-delta', text: 'there' }; yield { type: 'done' }; },
    listScopes: async () => [{ name: 'HQ', description: 'The organization workspace.' }, { name: 'Ignored', description: null }],
    transcribe: async (...args) => { transcriptionCalls.push(args); return { text: '@Atlas hello' }; },
    speak: async (...args) => { speechCalls.push(args); return { audioBase64: 'UklGRg==', mimeType: 'audio/wav' }; },
  });
  const app = new Hono();
  app.post('/founders/organizations/:organizationKey/chorus/channels/:channelKey/messages', handlers.postMessage);
  app.delete('/founders/organizations/:organizationKey/chorus/channels/:channelKey/messages', handlers.clearChannel);
  app.post('/founders/organizations/:organizationKey/chorus/transcriptions', handlers.transcribe);
  app.post('/founders/organizations/:organizationKey/chorus/speech', handlers.speak);
  return { app, persisted, assistantCalls, streamSkills, streamInputs, transcriptionCalls, speechCalls };
}

describe('Chorus SSE API', () => {
  test('returns 401 before parsing a message for an unauthenticated request', async () => {
    const { app } = appFor({ authenticated: false });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'authentication required' });
  });

  test('streams tokens and persists user then assistant messages', async () => {
    const { app, persisted, assistantCalls, streamSkills, streamInputs } = appFor();
    const threadKey = newId();
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello', threadKey }) });
    const text = await response.text();
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(text).toContain('event: start'); expect(text).toContain('event: token'); expect(text).toContain('event: done');
    expect(persisted).toEqual(['user', 'assistant']);
    expect(streamInputs).toEqual([{ message: 'hello' }]);
    expect(assistantCalls[0]?.slice(2)).toEqual(['Hi there', threadKey, expect.any(String)]);
    expect(streamSkills[0]).toContain('detailed, self-contained plain-text answer');
    expect(streamSkills[0]).toContain('## Organization scopes\nHQ: The organization workspace.');
    expect(streamSkills[0]).not.toContain('Ignored');
  });

  test('clears an authorized channel', async () => {
    const { app } = appFor();
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cleared: 2 });
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
    expect(assistantCalls[0]?.[2]).toBe('x'.repeat(8_000));
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

  test('transcribes PCM with organization mention context', async () => {
    const { app, transcriptionCalls } = appFor();
    const audioBase64 = Buffer.alloc(960).toString('base64');
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/transcriptions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audioBase64, mimeType: 'audio/pcm' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: '@Atlas hello' });
    expect(transcriptionCalls[0]?.slice(0, 3)).toEqual([organizationKey, audioBase64, 'Valid mention names are: @everyone, @Atlas.']);
  });

  test('reads messages with the fixed speech service', async () => {
    const { app, speechCalls } = appFor();
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/speech`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Read this.' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ audioBase64: 'UklGRg==', mimeType: 'audio/wav' });
    expect(speechCalls[0]?.slice(0, 2)).toEqual([organizationKey, 'Read this.']);
  });

  test('pins Chorus audio routes to static OpenAI GPT Realtime 2 and Ash', async () => {
    const source = await Bun.file(new URL('./chorus.ts', import.meta.url)).text();
    expect(source.match(/modelSlug: 'openai\.gpt-realtime-2', providerSlug: 'openai'/g)).toHaveLength(2);
    expect(source).toContain("{ text, voice: 'ash', format: 'wav' }");
  });
});

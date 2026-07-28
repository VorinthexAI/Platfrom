import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { buildMentionRoster, createChorusHandlers } from './chorus';
import { CANONICAL_ORCHESTRATOR_NAMES } from '@/lib/orchestrators/roster';

const organizationKey = 'root-org';
const channelKey = newId();
const actor = { organizationKey, membershipKey: newId() };

function parseSse(text: string) {
  return text.trim().split('\n\n').map((block) => {
    const lines = block.split('\n');
    return {
      event: lines.find((line) => line.startsWith('event: '))?.slice(7),
      data: JSON.parse(lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '{}') as Record<string, unknown>,
    };
  });
}

function appFor(options: { authenticated?: boolean; forbidden?: boolean; fail?: boolean; failSkill?: string; output?: string; gate?: Promise<void>; orchestratorCount?: 0 | 1 | 2 | 3; failScopes?: boolean } = {}) {
  const persisted: string[] = [];
  const assistantCalls: unknown[][] = [];
  const streamSkills: string[] = [];
  const streamInputs: unknown[] = [];
  const streamDependencies: unknown[] = [];
  const transcriptionCalls: unknown[][] = [];
  const speechCalls: unknown[][] = [];
  const access = { channel: { key: channelKey }, humanParticipant: { key: newId() }, mentions: [{ participantKey: 'everyone', type: 'everyone', key: 'everyone', name: 'everyone', mentionCount: 0 }, { participantKey: newId(), type: 'orchestrator', key: newId(), name: 'Atlas', mentionCount: 0 }] };
  const atlas = { participantKey: newId(), type: 'orchestrator' as const, key: newId(), name: 'Atlas', role: 'CEO', skill: 'Lead.' };
  const nova = { participantKey: newId(), type: 'orchestrator' as const, key: newId(), name: 'Nova', role: 'CTO', skill: 'Build.' };
  const metis = { participantKey: newId(), type: 'orchestrator' as const, key: newId(), name: 'Metis', role: 'CIO', skill: 'Analyze.' };
  const orchestrators = [atlas, nova, metis].slice(0, options.orchestratorCount ?? 1);
  const service = {
    async persistUserMessage() { persisted.push('user'); return { access, message: { key: newId(), channelKey, content: 'hello' }, orchestrators }; },
    async persistOrchestratorMessage(...args: unknown[]) { assistantCalls.push(args); persisted.push('assistant'); return { key: newId(), channelKey, content: args[2] as string, threadKey: args[3] as string, replyToMessageKey: args[4] as string }; },
    async clearChannel() { return 2; },
    async generalChannel() { return access; },
  };
  const handlers = createChorusHandlers({
    service: service as never,
    resolveActor: async (c) => options.authenticated === false ? c.json({ error: 'authentication required' }, 401) : options.forbidden ? c.json({ error: 'founders gate access required' }, 403) : actor,
    stream: async function* (skill, input, dependencies) { streamSkills.push(skill); streamInputs.push(input); streamDependencies.push(dependencies); yield { type: 'text-delta', text: options.output ?? 'Hi ' }; if (options.gate) await options.gate; if (options.fail || (options.failSkill && skill.includes(options.failSkill))) throw new Error('provider unavailable'); if (!options.output) yield { type: 'text-delta', text: 'there' }; yield { type: 'done' }; },
    listScopes: async () => {
      if (options.failScopes) throw new Error('malformed scope data');
      return [{ name: 'HQ', description: 'The organization workspace.' }, { name: 'Ignored', description: null }];
    },
    transcribe: async (...args) => { transcriptionCalls.push(args); return { text: '@Atlas hello' }; },
    speak: async (...args) => { speechCalls.push(args); return { audioBase64: 'UklGRg==', mimeType: 'audio/wav' }; },
  });
  const app = new Hono();
  app.post('/founders/organizations/:organizationKey/chorus/channels/:channelKey/messages', handlers.postMessage);
  app.delete('/founders/organizations/:organizationKey/chorus/channels/:channelKey/messages', handlers.clearChannel);
  app.post('/founders/organizations/:organizationKey/chorus/transcriptions', handlers.transcribe);
  app.post('/founders/organizations/:organizationKey/chorus/speech', handlers.speak);
  return { app, persisted, assistantCalls, streamSkills, streamInputs, streamDependencies, transcriptionCalls, speechCalls, orchestrators };
}

describe('Chorus SSE API', () => {
  test('builds an explicit canonical roster with everyone and members in separate lanes', () => {
    const roster = buildMentionRoster([
      { participantKey: 'everyone', type: 'everyone', key: 'everyone', name: 'everyone', mentionCount: 0 },
      { participantKey: newId(), type: 'user', key: newId(), name: 'Vincent', mentionCount: 2 },
      { participantKey: newId(), type: 'user', key: newId(), name: 'Anton', mentionCount: 1 },
      ...[...CANONICAL_ORCHESTRATOR_NAMES].reverse().map((name, index) => ({ participantKey: newId(), type: 'orchestrator' as const, key: newId(), name, role: 'Executive', skill: 'Lead.', mentionCount: index })),
    ]);
    expect(roster.orchestrators.map(({ name }) => name)).toEqual([...CANONICAL_ORCHESTRATOR_NAMES]);
    expect(roster.everyone.name).toBe('everyone');
    expect(roster.members.map(({ name }) => name)).toEqual(['Anton', 'Vincent']);
  });

  test('returns 401 before parsing a message for an unauthenticated request', async () => {
    const { app } = appFor({ authenticated: false });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'authentication required' });
  });

  test('streams separate identified responses for two orchestrators', async () => {
    const { app, persisted, assistantCalls, streamSkills, streamInputs, streamDependencies, orchestrators } = appFor({ orchestratorCount: 2 });
    const threadKey = newId();
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello', threadKey }) });
    const text = await response.text();
    const events = parseSse(text);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(events.map(({ event }) => event)).toEqual(['start', 'assistant-start', 'token', 'token', 'done', 'assistant-start', 'token', 'token', 'done', 'complete']);
    expect(events[1]?.data).toEqual({ orchestrator: { participantKey: orchestrators[0]!.participantKey, key: orchestrators[0]!.key, name: 'Atlas' } });
    expect(events[2]?.data).toEqual({ orchestratorKey: orchestrators[0]!.key, text: 'Hi ' });
    expect(events[3]?.data).toEqual({ orchestratorKey: orchestrators[0]!.key, text: 'there' });
    expect(events[4]?.data).toMatchObject({ orchestratorKey: orchestrators[0]!.key, message: { content: 'Hi there' } });
    expect(events[5]?.data).toEqual({ orchestrator: { participantKey: orchestrators[1]!.participantKey, key: orchestrators[1]!.key, name: 'Nova' } });
    expect(events[6]?.data).toEqual({ orchestratorKey: orchestrators[1]!.key, text: 'Hi ' });
    expect(events[7]?.data).toEqual({ orchestratorKey: orchestrators[1]!.key, text: 'there' });
    expect(events[8]?.data).toMatchObject({ orchestratorKey: orchestrators[1]!.key, message: { content: 'Hi there' } });
    expect(events[9]?.data).toEqual({});
    expect(text).not.toContain('Atlas:');
    expect(text).not.toContain('Nova:');
    expect(persisted).toEqual(['user', 'assistant', 'assistant']);
    expect(streamInputs).toEqual([{ message: 'hello' }, { message: 'hello' }]);
    expect(streamDependencies[0]).toMatchObject({ organizationKey, messageContext: { organizationKey, membershipKey: actor.membershipKey, excludeMessageKey: expect.any(String) } });
    expect(assistantCalls[0]?.slice(2)).toEqual(['Hi there', threadKey, expect.any(String)]);
    expect(assistantCalls[1]?.slice(2)).toEqual(['Hi there', threadKey, expect.any(String)]);
    expect(streamSkills).toHaveLength(2);
    for (const skill of streamSkills) {
      expect(skill).toContain('detailed, self-contained plain-text answer');
      expect(skill).toContain('## Organization scopes\nHQ: The organization workspace.');
      expect(skill).not.toContain('Ignored');
    }
  });

  test('continues with empty scope context when listing scopes fails', async () => {
    const { app, persisted, streamSkills } = appFor({ failScopes: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(text).toContain('event: complete');
    expect(text).not.toContain('malformed scope data');
    expect(persisted).toEqual(['user', 'assistant']);
    expect(streamSkills[0]).not.toContain('Organization scopes');
  });

  test('emits one complete event when no orchestrator is selected', async () => {
    const { app, persisted } = appFor({ orchestratorCount: 0 });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const text = await response.text();
    expect(text).toContain('event: start');
    expect(text).not.toContain('event: assistant-start');
    expect(text).not.toContain('event: done');
    expect(text.match(/event: complete/g)).toHaveLength(1);
    expect(persisted).toEqual(['user']);
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

  test('isolates one orchestrator failure and continues dispatching the rest', async () => {
    const { app, persisted, streamSkills, orchestrators } = appFor({ orchestratorCount: 3, failSkill: 'Build.' });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const text = await response.text();
    const events = parseSse(text);
    expect(events.some(({ event, data }) => event === 'assistant-error' && data.orchestratorKey === orchestrators[1]!.key)).toBe(true);
    expect(events.at(-1)?.event).toBe('complete');
    expect(persisted).toEqual(['user', 'assistant', 'assistant']);
    expect(streamSkills).toHaveLength(3);
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
    expect(transcriptionCalls[0]?.slice(0, 3)).toEqual([organizationKey, audioBase64, `Valid mention names are: @everyone, ${CANONICAL_ORCHESTRATOR_NAMES.map((name) => `@${name}`).join(', ')}.`]);
  });

  test('reads messages with the fixed speech service', async () => {
    const { app, speechCalls } = appFor();
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/speech`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Read this.' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ audioBase64: 'UklGRg==', mimeType: 'audio/wav' });
    expect(speechCalls[0]?.slice(0, 2)).toEqual([organizationKey, 'Read this.']);
  });

  test('routes transcription through its tool and pins speech to Realtime 2 with Ash', async () => {
    const source = await Bun.file(new URL('./chorus.ts', import.meta.url)).text();
    expect(source).toContain('transcribeTool.execute');
    expect(source.match(/modelSlug: 'openai\.gpt-realtime-2', providerSlug: 'openai'/g)).toHaveLength(1);
    expect(source).toContain("{ text, voice: 'ash', format: 'wav' }");
  });
});

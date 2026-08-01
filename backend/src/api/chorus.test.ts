import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { buildMentionRoster, createChorusHandlers, orchestratorPromptMessage } from './chorus';
import { CANONICAL_ORCHESTRATOR_NAMES } from '@/lib/orchestrators/roster';
import { orchestratorChatTool } from '@/lib/ai/tools/orchestrator-chat';

const organizationKey = 'root-org';
const channelKey = newId();
const actor = { organizationKey, membershipKey: newId(), name: 'Anton' };

function parseSse(text: string) {
  return text.trim().split('\n\n').map((block) => {
    const lines = block.split('\n');
    return {
      event: lines.find((line) => line.startsWith('event: '))?.slice(7),
      data: JSON.parse(lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '{}') as Record<string, unknown>,
    };
  });
}

function appFor(options: { authenticated?: boolean; forbidden?: boolean; fail?: boolean; partialFail?: boolean; abort?: boolean; failSkill?: string; failPersistence?: boolean; output?: string; gate?: Promise<void>; orchestratorCount?: 0 | 1 | 2 | 3; failScopes?: boolean; throughChatTool?: boolean } = {}) {
  const persisted: string[] = [];
  const assistantCalls: unknown[][] = [];
  const streamSkills: string[] = [];
  const streamInputs: unknown[] = [];
  const streamDependencies: unknown[] = [];
  const transcriptionCalls: unknown[][] = [];
  const speechCalls: unknown[][] = [];
  const retrievalQueries: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
  const novaInputs: unknown[] = [];
  const typingEvents: unknown[] = [];
  const access = { channel: { key: channelKey }, humanParticipant: { key: newId() }, mentions: [{ participantKey: 'everyone', type: 'everyone', key: 'everyone', name: 'everyone', mentionCount: 0 }, { participantKey: newId(), type: 'orchestrator', key: newId(), name: 'Atlas', mentionCount: 0 }] };
  const atlas = { participantKey: newId(), type: 'orchestrator' as const, key: newId(), name: 'Atlas', role: 'CEO', skill: 'Lead.' };
  const nova = { participantKey: newId(), type: 'orchestrator' as const, key: newId(), name: 'Nova', role: 'CTO', skill: 'Build.' };
  const metis = { participantKey: newId(), type: 'orchestrator' as const, key: newId(), name: 'Metis', role: 'CIO', skill: 'Analyze.' };
  const orchestrators = [atlas, nova, metis].slice(0, options.orchestratorCount ?? 1);
  const service = {
    async persistUserMessage(_actor: unknown, _channelKey: string, content: string) { persisted.push('user'); return { access, message: { key: newId(), channelKey, content }, orchestrators }; },
    async persistOrchestratorMessage(...args: unknown[]) { if (options.failPersistence) throw new Error('database unavailable'); assistantCalls.push(args); persisted.push('assistant'); return { key: newId(), channelKey, content: args[2] as string, threadKey: args[3] as string, replyToMessageKey: args[4] as string }; },
    async clearChannel() { return 2; },
    async generalChannel() { return access; },
    async requireChannel() { return access; },
    async frequentReactions() { return [{ reaction: '🔥', count: 3 }]; },
  };
  const handlers = createChorusHandlers({
    service: service as never,
    resolveActor: async (c) => options.authenticated === false ? c.json({ error: 'authentication required' }, 401) : options.forbidden ? c.json({ error: 'founders gate access required' }, 403) : actor,
    stream(skill, input, dependencies) {
      streamSkills.push(skill); streamInputs.push(input); streamDependencies.push(dependencies);
      if (options.throughChatTool) return orchestratorChatTool.stream(skill, input, {
        ...dependencies,
        embedRetrievalQuery: async () => [1, 0],
        queryRetrieval: async (query, bindVars) => { retrievalQueries.push({ query, bindVars }); return { all: async () => [{ key: 'prior-message', fields: { content: 'The launch is Friday.' }, createdAt: '2026-07-28T12:00:00.000Z', score: 0.9 }] }; },
        stream: async function* (_organizationKey, chatInput) { novaInputs.push(chatInput); yield { type: 'text-delta', text: 'Retrieved answer' }; yield { type: 'done' }; },
      });
      return (async function* () { if (options.abort) throw new DOMException('cancelled', 'AbortError'); if (options.fail || (options.failSkill && skill.includes(options.failSkill))) throw new Error('provider unavailable'); yield { type: 'text-delta', text: options.output ?? 'Hi ' }; if (options.gate) await Promise.race([options.gate, new Promise((_, reject) => dependencies.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }))]); if (options.partialFail) throw new Error('provider interrupted'); if (!options.output) yield { type: 'text-delta', text: 'there' }; yield { type: 'done' }; })();
    },
    listScopes: async (resolved) => {
      expect(resolved).toEqual(actor);
      if (options.failScopes) throw new Error('malformed scope data');
      return [{ name: 'HQ', description: 'The organization workspace.' }, { name: 'Ignored', description: null }];
    },
    publishTyping: async (event) => { typingEvents.push(event); },
    transcribe: async (...args) => { transcriptionCalls.push(args); return { text: '@Atlas hello' }; },
    speak: async (...args) => { speechCalls.push(args); return { audioBase64: 'UklGRg==', mimeType: 'audio/wav' }; },
  });
  const app = new Hono();
  app.post('/founders/organizations/:organizationKey/chorus/channels/:channelKey/messages', handlers.postMessage);
  app.delete('/founders/organizations/:organizationKey/chorus/channels/:channelKey/messages', handlers.clearChannel);
  app.post('/founders/organizations/:organizationKey/chorus/transcriptions', handlers.transcribe);
  app.post('/founders/organizations/:organizationKey/chorus/speech', handlers.speak);
  app.get('/founders/organizations/:organizationKey/chorus/reactions', handlers.frequentReactions);
  app.post('/founders/organizations/:organizationKey/chorus/channels/:channelKey/typing', handlers.typing);
  return { app, persisted, assistantCalls, streamSkills, streamInputs, streamDependencies, transcriptionCalls, speechCalls, orchestrators, retrievalQueries, novaInputs, typingEvents };
}

describe('Chorus SSE API', () => {
  test('strips case-insensitive orchestrator mentions only when multiple unique orchestrators are selected', () => {
    const atlas = { participantKey: newId(), type: 'orchestrator' as const, key: newId(), name: 'Atlas', role: 'CEO', skill: 'Lead.' };
    const nova = { participantKey: newId(), type: 'orchestrator' as const, key: newId(), name: 'Nova', role: 'CTO', skill: 'Build.' };
    expect(orchestratorPromptMessage('@ATLAS, @nova; @Atlas: @Vincent plan the launch', [atlas, nova])).toBe('@Vincent plan the launch');
    expect(orchestratorPromptMessage('@ATLAS @Atlas plan the launch', [atlas, atlas])).toBe('@ATLAS @Atlas plan the launch');
  });

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

  test('accepts opaque public channel keys when posting a message', async () => {
    const opaqueChannelKey = 'channel_general';
    const { app, persisted } = appFor();
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${opaqueChannelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('event: complete');
    expect(persisted).toEqual(['user', 'assistant']);
  });

  test('streams separate identified responses for two orchestrators', async () => {
    const { app, persisted, assistantCalls, streamSkills, streamInputs, streamDependencies, orchestrators, typingEvents } = appFor({ orchestratorCount: 2 });
    const threadKey = newId();
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '@ATLAS, @Nova; @Atlas: @Vincent hello', threadKey }) });
    const text = await response.text();
    const events = parseSse(text);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(events.map(({ event }) => event)).toEqual(['start', 'assistant-start', 'assistant-start', 'token', 'token', 'token', 'token', 'done', 'done', 'complete']);
    expect(events[1]?.data).toEqual({ orchestrator: { participantKey: orchestrators[0]!.participantKey, key: orchestrators[0]!.key, name: 'Atlas' } });
    expect(events[2]?.data).toEqual({ orchestrator: { participantKey: orchestrators[1]!.participantKey, key: orchestrators[1]!.key, name: 'Nova' } });
    expect(events.filter(({ event }) => event === 'token').map(({ data }) => data).filter(({ orchestratorKey }) => orchestratorKey === orchestrators[0]!.key)).toEqual([{ orchestratorKey: orchestrators[0]!.key, text: 'Hi ' }, { orchestratorKey: orchestrators[0]!.key, text: 'there' }]);
    expect(events.filter(({ event }) => event === 'token').map(({ data }) => data).filter(({ orchestratorKey }) => orchestratorKey === orchestrators[1]!.key)).toEqual([{ orchestratorKey: orchestrators[1]!.key, text: 'Hi ' }, { orchestratorKey: orchestrators[1]!.key, text: 'there' }]);
    expect(events.filter(({ event }) => event === 'done').map(({ data }) => data)).toEqual(expect.arrayContaining(orchestrators.map((orchestrator) => expect.objectContaining({ orchestratorKey: orchestrator.key, message: expect.objectContaining({ content: 'Hi there' }) }))));
    expect(events[9]?.data).toEqual({});
    expect(persisted).toEqual(['user', 'assistant', 'assistant']);
    expect(streamInputs).toEqual([{ message: '@Vincent hello' }, { message: '@Vincent hello' }]);
    expect(events[0]?.data).toMatchObject({ userMessage: { content: '@ATLAS, @Nova; @Atlas: @Vincent hello' } });
    expect(streamDependencies[0]).toMatchObject({ organizationKey, retrievalContext: { organizationKey, membershipKey: actor.membershipKey, exclude: { messages: [expect.any(String)] } } });
    expect((streamDependencies[1] as { retrievalContext: { exclude: { messages: string[] } } }).retrievalContext.exclude.messages).toEqual([expect.any(String)]);
    expect(assistantCalls[0]?.slice(2)).toEqual(['Hi there', threadKey, expect.any(String)]);
    expect(assistantCalls[1]?.slice(2)).toEqual(['Hi there', threadKey, expect.any(String)]);
    expect(streamSkills).toHaveLength(2);
    expect(streamSkills[0]).toContain('You are Atlas, the CEO orchestrator. This invocation belongs only to Atlas.');
    expect(streamSkills[0]).not.toContain('You are Nova');
    expect(streamSkills[1]).toContain('You are Nova, the CTO orchestrator. This invocation belongs only to Nova.');
    expect(streamSkills[1]).not.toContain('You are Atlas');
    expect(typingEvents).toEqual([
      ...orchestrators.map((orchestrator) => expect.objectContaining({ participantKey: orchestrator.participantKey, name: orchestrator.name, type: 'orchestrator', active: true })),
      ...orchestrators.map((orchestrator) => expect.objectContaining({ participantKey: orchestrator.participantKey, name: orchestrator.name, type: 'orchestrator', active: false })),
    ]);
    for (const skill of streamSkills) {
      expect(skill).toContain('Speak in first person from your own perspective');
      expect(skill).toContain('Any other orchestrator mentions are routing metadata, not participants in your conversation. Ignore them completely');
      expect(skill).toContain('Do not describe yourself in the third person or answer on behalf of a group.');
      expect(skill).toContain('detailed, self-contained plain-text answer');
      expect(skill).toContain('Other orchestrator mentions only select independent recipients');
      expect(skill).toContain('## Organization scopes\nHQ: The organization workspace.');
      expect(skill).not.toContain('Ignored');
    }
  });

  test('starts every mentioned orchestrator before waiting for any response', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { app, streamSkills } = appFor({ orchestratorCount: 2, gate });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '@Atlas @Nova hello' }) });
    const consuming = response.text();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(streamSkills).toHaveLength(2);

    release();
    await consuming;
  });

  test('runs authorized retrieval before the orchestrator Nova chat response', async () => {
    const { app, retrievalQueries, novaInputs } = appFor({ throughChatTool: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '@Atlas explain the launch' }) });
    const events = parseSse(await response.text());
    expect(events.map(({ event }) => event)).toEqual(['start', 'assistant-start', 'token', 'done', 'complete']);
    expect(events[2]?.data).toMatchObject({ text: 'Retrieved answer' });
    expect(retrievalQueries[0]?.bindVars).toMatchObject({ organizationKey, membershipKey: actor.membershipKey, excludeKeys: [expect.any(String)], filterOrganizationKey: organizationKey, dimensions: 2, limit: 50 });
    expect(retrievalQueries[0]?.bindVars).not.toHaveProperty('collectionName');
    expect(novaInputs[0]).toMatchObject({ systemPrompt: expect.stringContaining('The launch is Friday.'), messages: [{ role: 'user', content: [{ type: 'text', text: '@Atlas explain the launch' }] }] });
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

  test('reports a missing canonical orchestrator instead of completing silently', async () => {
    const { app, persisted } = appFor({ orchestratorCount: 0 });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '@Atlas hello' }) });
    const events = parseSse(await response.text());
    expect(events.map(({ event }) => event)).toEqual(['start', 'error']);
    expect(events[1]?.data.error).toBe('mentioned orchestrator is unavailable');
    expect(persisted).toEqual(['user']);
  });

  test('clears an authorized channel', async () => {
    const { app } = appFor();
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cleared: 2 });
  });

  test('lists the ten most-used reactions for the authenticated user', async () => {
    const { app } = appFor();
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/reactions`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reactions: [{ reaction: '🔥', count: 3 }] });
  });

  test('publishes authenticated member typing state for the channel', async () => {
    const { app, typingEvents } = appFor();
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/typing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: true }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(typingEvents).toEqual([expect.objectContaining({ organizationKey, channelKey, participantKey: expect.any(String), type: 'user', name: 'Anton', active: true, expiresAt: expect.any(Number) })]);
  });

  test('keeps founder-gate denial distinct from authentication denial', async () => {
    const { app } = appFor({ forbidden: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'founders gate access required' });
  });

  test('bounds provider output consistently across streaming and persistence', async () => {
    const { app, assistantCalls } = appFor({ output: `${'x'.repeat(8_100)}😀` });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const events = parseSse(await response.text());
    const tokens = events.filter(({ event }) => event === 'token').map(({ data }) => data.text).join('');
    const canonical = (events.find(({ event }) => event === 'done')?.data.message as { content: string }).content;
    expect(assistantCalls[0]?.[2]).toBe('x'.repeat(8_000));
    expect(tokens).toBe(canonical);
    expect(tokens).toHaveLength(8_000);
  });

  test('keeps partial provider output identical across tokens, persistence, and done', async () => {
    const { app, assistantCalls } = appFor({ partialFail: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const events = parseSse(await response.text());
    const tokens = events.filter(({ event }) => event === 'token').map(({ data }) => data.text).join('');
    const canonical = (events.find(({ event }) => event === 'done')?.data.message as { content: string }).content;
    expect(tokens).toBe('Hi \n\nI could not complete this response. Please try again.');
    expect(tokens).toBe(canonical);
    expect(assistantCalls[0]?.[2]).toBe(canonical);
  });

  test('persists a fallback when the provider aborts without a client cancellation', async () => {
    const { app, persisted } = appFor({ abort: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const events = parseSse(await response.text());
    expect(events.map(({ event }) => event)).toEqual(['start', 'assistant-start', 'token', 'done', 'complete']);
    expect(events[2]?.data.text).toBe('I could not generate a response right now. Please try again.');
    expect(persisted).toEqual(['user', 'assistant']);
  });

  test('does not persist a fallback when the client request is actually aborted', async () => {
    const gate = new Promise<void>(() => {});
    const controller = new AbortController();
    const { app, persisted } = appFor({ gate });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }), signal: controller.signal });
    const consuming = response.text();
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await consuming;
    expect(persisted).toEqual(['user']);
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

  test('persists a truthful response for every mentioned orchestrator when all providers fail', async () => {
    const { app, persisted, assistantCalls, streamSkills, orchestrators } = appFor({ orchestratorCount: 3, fail: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const text = await response.text();
    const events = parseSse(text);
    expect(events.filter(({ event }) => event === 'done').map(({ data }) => data.orchestratorKey)).toEqual(orchestrators.map(({ key }) => key));
    expect(events.some(({ event }) => event === 'assistant-error')).toBe(false);
    expect(events.at(-1)?.event).toBe('complete');
    expect(persisted).toEqual(['user', 'assistant', 'assistant', 'assistant']);
    expect(assistantCalls.map((call) => call[2])).toEqual(orchestrators.map(() => 'I could not generate a response right now. Please try again.'));
    expect(streamSkills).toHaveLength(3);
    const retried = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'retry' }) });
    expect(retried.status).toBe(200);
  });

  test('emits assistant-error when the fallback response cannot be persisted', async () => {
    const { app, persisted, orchestrators } = appFor({ fail: true, failPersistence: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const events = parseSse(await response.text());
    expect(events.some(({ event, data }) => event === 'assistant-error' && data.orchestratorKey === orchestrators[0]!.key)).toBe(true);
    expect(events.some(({ event }) => event === 'done')).toBe(false);
    expect(persisted).toEqual(['user']);
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

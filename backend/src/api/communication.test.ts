import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { buildMentionRoster, createCommunicationHandlers, orchestratorPromptMessage } from './communication';
import { CANONICAL_ORCHESTRATOR_NAMES } from '@/lib/orchestrators/roster';
import { orchestratorResponseRuntime } from '@/lib/ai/orchestrator-response-runtime';

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

function appFor(options: { authenticated?: boolean; forbidden?: boolean; fail?: boolean; partialFail?: boolean; abort?: boolean; failSkill?: string; failPersistence?: boolean; failPersistenceSkill?: string; output?: string; gate?: Promise<void>; orchestratorCount?: number; failScopes?: boolean; throughResponseRuntime?: boolean; leaseUnavailable?: boolean; leaseRefreshFails?: boolean; leaseRefreshResults?: boolean[]; duplicateResolved?: boolean } = {}) {
  const persisted: string[] = [];
  const assistantCalls: unknown[][] = [];
  const streamSkills: string[] = [];
  const streamInputs: unknown[] = [];
  const streamDependencies: unknown[] = [];
  const retrievalQueries: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
  const novaInputs: unknown[] = [];
  const typingEvents: unknown[] = [];
  const replyReads: string[] = [];
  const edits: Array<{ messageKey: string; content: string }> = [];
  const leaseEvents: string[] = [];
  const access = { channel: { key: channelKey }, humanParticipant: { key: newId() }, mentions: [{ participantKey: 'everyone', type: 'everyone', key: 'everyone', name: 'everyone', mentionCount: 0 }, { participantKey: newId(), type: 'orchestrator', key: newId(), name: 'Atlas', mentionCount: 0 }] };
  const atlas = { participantKey: newId(), type: 'orchestrator' as const, key: newId(), name: 'Atlas', role: 'CEO', skill: 'Lead.' };
  const nova = { participantKey: newId(), type: 'orchestrator' as const, key: newId(), name: 'Nova', role: 'CTO', skill: 'Build.' };
  const metis = { participantKey: newId(), type: 'orchestrator' as const, key: newId(), name: 'Metis', role: 'CIO', skill: 'Analyze.' };
  const extras = CANONICAL_ORCHESTRATOR_NAMES.slice(3, 5).map((name) => ({ participantKey: newId(), type: 'orchestrator' as const, key: newId(), name, role: 'Executive', skill: `${name} skill.` }));
  const orchestrators = [atlas, nova, metis, ...extras].slice(0, options.orchestratorCount ?? 1);
  const resolvedOrchestrators = options.duplicateResolved && orchestrators[0] ? [...orchestrators, orchestrators[0]] : orchestrators;
  const service = {
    async resolveOrchestrators() { return resolvedOrchestrators; },
    async persistUserMessage(_actor: unknown, _channelKey: string, content: string, threadKey?: string, replyToMessageKey?: string) { persisted.push('user'); return { access, message: { key: newId(), channelKey, content, threadKey, replyToMessageKey }, orchestrators: resolvedOrchestrators }; },
    async persistOrchestratorMessage(...args: unknown[]) { if (options.failPersistence || (options.failPersistenceSkill && (args[1] as { skill?: string }).skill?.includes(options.failPersistenceSkill))) throw new Error('database unavailable'); assistantCalls.push(args); persisted.push('assistant'); return { key: newId(), channelKey, content: args[2] as string, threadKey: args[3] as string, replyToMessageKey: args[4] as string }; },
    async generalChannel() { return access; },
    async requireChannel() { return access; },
    async frequentReactions() { return [{ reaction: '🔥', count: 3 }]; },
    async readReplies(_actor: unknown, _channelKey: string, messageKey: string) { replyReads.push(messageKey); return { parentMessageKey: messageKey, messages: [] }; },
    async editMessage(_actor: unknown, _channelKey: string, messageKey: string, content: string) { edits.push({ messageKey, content }); return { key: messageKey, channelKey, content, editedAt: '2026-08-02T12:00:00.000Z', createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-02T12:00:00.000Z' }; },
  };
  const handlers = createCommunicationHandlers({
    service: service as never,
    resolveActor: async (c) => options.authenticated === false ? c.json({ error: 'authentication required' }, 401) : options.forbidden ? c.json({ error: 'founders gate access required' }, 403) : actor,
    stream(skill, input, dependencies) {
      streamSkills.push(skill); streamInputs.push(input); streamDependencies.push(dependencies);
      if (options.throughResponseRuntime) return orchestratorResponseRuntime.stream(skill, input, {
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
    channelLease: {
      async acquire() { leaseEvents.push('acquire'); return !options.leaseUnavailable; },
      async refresh() { leaseEvents.push('refresh'); return options.leaseRefreshResults?.shift() ?? !options.leaseRefreshFails; },
      async release() { leaseEvents.push('release'); },
    },
  });
  const app = new Hono();
  app.onError((_error, c) => c.json({ error: 'invalid request' }, 400));
  app.post('/founders/organizations/:organizationKey/communication/channels/:channelKey/messages', handlers.postMessage);
  app.get('/founders/organizations/:organizationKey/communication/reactions', handlers.frequentReactions);
  app.post('/founders/organizations/:organizationKey/communication/channels/:channelKey/typing', handlers.typing);
  app.get('/founders/organizations/:organizationKey/communication/channels/:channelKey/messages/:messageKey/replies', handlers.readReplies);
  app.patch('/founders/organizations/:organizationKey/communication/channels/:channelKey/messages/:messageKey', handlers.editMessage);
  return { app, persisted, assistantCalls, streamSkills, streamInputs, streamDependencies, orchestrators, retrievalQueries, novaInputs, typingEvents, replyReads, edits, leaseEvents };
}

describe('Communication SSE API', () => {
  test('reads replies by their recursive parent message', async () => {
    const { app, replyReads } = appFor();
    const messageKey = newId();
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages/${messageKey}/replies`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ parentMessageKey: messageKey, messages: [] });
    expect(replyReads).toEqual([messageKey]);
  });

  test('edits a message with a strict content-only body', async () => {
    const { app, edits } = appFor();
    const messageKey = newId();
    const url = `/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages/${messageKey}`;
    const response = await app.request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Updated message' }) });
    const invalid = await app.request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Updated again', author: 'forged' }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ message: { key: messageKey, content: 'Updated message', editedAt: '2026-08-02T12:00:00.000Z' } });
    expect(invalid.status).toBe(400);
    expect(edits).toEqual([{ messageKey, content: 'Updated message' }]);
  });

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
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'authentication required' });
  });

  test('accepts opaque public channel keys when posting a message', async () => {
    const opaqueChannelKey = 'channel_general';
    const { app, persisted } = appFor();
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${opaqueChannelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('event: complete');
    expect(persisted).toEqual(['user', 'assistant']);
  });

  test('streams separate identified responses for two orchestrators', async () => {
    const { app, persisted, assistantCalls, streamSkills, streamInputs, streamDependencies, orchestrators, typingEvents } = appFor({ orchestratorCount: 2 });
    const threadKey = newId();
    const replyToMessageKey = newId();
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '@ATLAS, @Nova; @Atlas: @Vincent hello', threadKey, replyToMessageKey }) });
    const text = await response.text();
    const events = parseSse(text);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(events[0]?.event).toBe('start');
    expect(events.at(-1)?.event).toBe('complete');
    expect(events.filter(({ event }) => event === 'assistant-start').map(({ data }) => (data.orchestrator as { key: string }).key)).toEqual(orchestrators.map(({ key }) => key));
    for (const orchestrator of orchestrators) {
      expect(events.filter(({ event, data }) => event === 'token' && data.orchestratorKey === orchestrator.key).map(({ data }) => data.text).join('')).toBe('Hi there');
      expect(events.find(({ event, data }) => event === 'done' && data.orchestratorKey === orchestrator.key)?.data).toMatchObject({ message: { content: 'Hi there' } });
    }
    expect(persisted).toEqual(['user', 'assistant', 'assistant']);
    expect(streamInputs).toEqual([{ message: '@Vincent hello' }, { message: '@Vincent hello' }]);
    expect(events[0]?.data).toMatchObject({ userMessage: { content: '@ATLAS, @Nova; @Atlas: @Vincent hello' } });
    expect(streamDependencies[0]).toMatchObject({ organizationKey, retrievalContext: { organizationKey, membershipKey: actor.membershipKey, exclude: { messages: [expect.any(String)] } } });
    expect((streamDependencies[1] as { retrievalContext: { exclude: { messages: string[] } } }).retrievalContext.exclude.messages).toEqual([(events[0]?.data.userMessage as { key: string }).key]);
    expect(assistantCalls[0]?.slice(2)).toEqual(['Hi there', threadKey, replyToMessageKey, (events[0]?.data.userMessage as { key: string }).key]);
    expect(assistantCalls[1]?.slice(2)).toEqual(['Hi there', threadKey, replyToMessageKey, (events[0]?.data.userMessage as { key: string }).key]);
    expect(streamSkills).toHaveLength(2);
    expect(streamSkills[0]).toContain('You are Atlas, the CEO orchestrator. This invocation belongs only to Atlas.');
    expect(streamSkills[0]).not.toContain('You are Nova');
    expect(streamSkills[1]).toContain('You are Nova, the CTO orchestrator. This invocation belongs only to Nova.');
    expect(streamSkills[1]).not.toContain('You are Atlas');
    for (const orchestrator of orchestrators) {
      expect(typingEvents).toContainEqual(expect.objectContaining({ participantKey: orchestrator.participantKey, name: orchestrator.name, type: 'orchestrator', active: true }));
      expect(typingEvents).toContainEqual(expect.objectContaining({ participantKey: orchestrator.participantKey, name: orchestrator.name, type: 'orchestrator', active: false }));
    }
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

  test('runs authorized retrieval before the orchestrator Nova chat response', async () => {
    const { app, retrievalQueries, novaInputs } = appFor({ throughResponseRuntime: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '@Atlas explain the launch' }) });
    const events = parseSse(await response.text());
    expect(events.map(({ event }) => event)).toEqual(['start', 'assistant-start', 'token', 'done', 'complete']);
    expect(events[2]?.data).toMatchObject({ text: 'Retrieved answer' });
    expect(retrievalQueries[0]?.bindVars).toMatchObject({ organizationKey, membershipKey: actor.membershipKey, excludeKeys: [expect.any(String)], filterOrganizationKey: organizationKey, dimensions: 2, limit: 50 });
    expect(retrievalQueries[0]?.bindVars).not.toHaveProperty('collectionName');
    expect(novaInputs[0]).toMatchObject({ systemPrompt: expect.stringContaining('The launch is Friday.'), messages: [{ role: 'user', content: [{ type: 'text', text: '@Atlas explain the launch' }] }] });
  });

  test('continues with empty scope context when listing scopes fails', async () => {
    const { app, persisted, streamSkills } = appFor({ failScopes: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
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
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const text = await response.text();
    expect(text).toContain('event: start');
    expect(text).not.toContain('event: assistant-start');
    expect(text).not.toContain('event: done');
    expect(text.match(/event: complete/g)).toHaveLength(1);
    expect(persisted).toEqual(['user']);
  });

  test('reports a missing canonical orchestrator instead of completing silently', async () => {
    const { app, persisted } = appFor({ orchestratorCount: 0 });
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '@Atlas hello' }) });
    const events = parseSse(await response.text());
    expect(events.map(({ event }) => event)).toEqual(['start', 'error']);
    expect(events[1]?.data.error).toBe('mentioned orchestrator is unavailable');
    expect(persisted).toEqual(['user']);
  });

  test('lists the ten most-used reactions for the authenticated user', async () => {
    const { app } = appFor();
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/reactions`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reactions: [{ reaction: '🔥', count: 3 }] });
  });

  test('publishes authenticated member typing state for the channel', async () => {
    const { app, typingEvents } = appFor();
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/typing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: true }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(typingEvents).toEqual([expect.objectContaining({ organizationKey, channelKey, participantKey: expect.any(String), type: 'user', name: 'Anton', active: true, expiresAt: expect.any(Number) })]);
  });

  test('keeps founder-gate denial distinct from authentication denial', async () => {
    const { app } = appFor({ forbidden: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'founders gate access required' });
  });

  test('bounds provider output consistently across streaming and persistence', async () => {
    const { app, assistantCalls } = appFor({ output: `${'x'.repeat(8_100)}😀` });
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const events = parseSse(await response.text());
    const tokens = events.filter(({ event }) => event === 'token').map(({ data }) => data.text).join('');
    const canonical = (events.find(({ event }) => event === 'done')?.data.message as { content: string }).content;
    expect(assistantCalls[0]?.[2]).toBe('x'.repeat(8_000));
    expect(tokens).toBe(canonical);
    expect(tokens).toHaveLength(8_000);
  });

  test('keeps partial provider output identical across tokens, persistence, and done', async () => {
    const { app, assistantCalls } = appFor({ partialFail: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const events = parseSse(await response.text());
    const tokens = events.filter(({ event }) => event === 'token').map(({ data }) => data.text).join('');
    const canonical = (events.find(({ event }) => event === 'done')?.data.message as { content: string }).content;
    expect(tokens).toBe('Hi \n\nI could not complete this response. Please try again.');
    expect(tokens).toBe(canonical);
    expect(assistantCalls[0]?.[2]).toBe(canonical);
  });

  test('persists a fallback when the provider aborts without a client cancellation', async () => {
    const { app, persisted } = appFor({ abort: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const events = parseSse(await response.text());
    expect(events.map(({ event }) => event)).toEqual(['start', 'assistant-start', 'token', 'done', 'complete']);
    expect(events[2]?.data.text).toBe('I could not generate a response right now. Please try again.');
    expect(persisted).toEqual(['user', 'assistant']);
  });

  test('does not persist a fallback when the client request is actually aborted', async () => {
    const gate = new Promise<void>(() => {});
    const controller = new AbortController();
    const { app, persisted } = appFor({ gate });
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }), signal: controller.signal });
    const consuming = response.text();
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await consuming;
    expect(persisted).toEqual(['user']);
  });

  test('starts mentioned orchestrators concurrently before either provider completes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { app, streamSkills } = appFor({ orchestratorCount: 2, gate });
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '@Atlas @Nova compare plans' }) });
    const consuming = response.text();
    for (let attempt = 0; attempt < 20 && streamSkills.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(streamSkills).toHaveLength(2);
    release();
    const events = parseSse(await consuming);
    expect(events.filter(({ event }) => event === 'done')).toHaveLength(2);
    expect(events.at(-1)?.event).toBe('complete');
  });

  test('rejects concurrent sends per channel and releases the lock after completion', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { app } = appFor({ gate });
    const request = () => app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
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

  test('rejects a channel held by another process and caps provider fan-out', async () => {
    const held = appFor({ leaseUnavailable: true });
    const heldResponse = await held.app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '@Atlas hello' }) });
    expect(heldResponse.status).toBe(409);
    expect(held.persisted).toEqual([]);
    expect(held.leaseEvents).toEqual(['acquire']);

    const capped = appFor({ orchestratorCount: 5 });
    const mentions = CANONICAL_ORCHESTRATOR_NAMES.slice(0, 5).map((name) => `@${name}`).join(' ');
    const cappedResponse = await capped.app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: mentions }) });
    expect(cappedResponse.status).toBe(400);
    expect(capped.persisted).toEqual([]);
    expect(capped.leaseEvents).toEqual([]);
  });

  test('deduplicates the resolved roster and caps the actual resolved recipients before persistence', async () => {
    const duplicate = appFor({ orchestratorCount: 1, duplicateResolved: true });
    const events = parseSse(await (await duplicate.app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) })).text());
    expect(events.filter(({ event }) => event === 'assistant-start')).toHaveLength(1);
    expect(duplicate.assistantCalls).toHaveLength(1);

    const overflow = appFor({ orchestratorCount: 5 });
    const response = await overflow.app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    expect(response.status).toBe(400);
    expect(overflow.persisted).toEqual([]);
    expect(overflow.leaseEvents).toEqual([]);
  });

  test('aborts and joins every worker before release when lease refresh fails', async () => {
    const failed = appFor({ orchestratorCount: 2, leaseRefreshFails: true });
    const events = parseSse(await (await failed.app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '@Atlas @Nova hello' }) })).text());
    expect(failed.persisted).toEqual(['user']);
    expect(events.some(({ event }) => event === 'done' || event === 'complete' || event === 'assistant-error' || event === 'error')).toBe(false);
    expect(failed.leaseEvents.at(-1)).toBe('release');
  });

  test('suppresses done and completion when the lease is lost during persistence', async () => {
    const lost = appFor({ leaseRefreshResults: [true, false] });
    const events = parseSse(await (await lost.app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '@Atlas hello' }) })).text());
    expect(lost.persisted).toEqual(['user', 'assistant']);
    expect(events.some(({ event }) => event === 'done' || event === 'complete' || event === 'assistant-error' || event === 'error')).toBe(false);
    expect(lost.leaseEvents.at(-1)).toBe('release');
  });

  test('scopes local locks by organization and settles workers before lease release', async () => {
    const source = await Bun.file(new URL('./communication.ts', import.meta.url)).text();
    expect(source).toContain('const localChannelKey = `${resolved.organizationKey}:${channelKey}`');
    expect(source).toContain('await Promise.allSettled(workers)');
    expect(source.indexOf('await Promise.allSettled(workers)', source.indexOf('finally {'))).toBeLessThan(source.indexOf('await lease.release', source.indexOf('finally {')));
  });

  test('persists a truthful response for every mentioned orchestrator when all providers fail', async () => {
    const { app, persisted, assistantCalls, streamSkills, orchestrators } = appFor({ orchestratorCount: 3, fail: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const text = await response.text();
    const events = parseSse(text);
    expect(events.filter(({ event }) => event === 'done').map(({ data }) => data.orchestratorKey)).toEqual(orchestrators.map(({ key }) => key));
    expect(events.some(({ event }) => event === 'assistant-error')).toBe(false);
    expect(events.at(-1)?.event).toBe('complete');
    expect(persisted).toEqual(['user', 'assistant', 'assistant', 'assistant']);
    expect(assistantCalls.map((call) => call[2])).toEqual(orchestrators.map(() => 'I could not generate a response right now. Please try again.'));
    expect(streamSkills).toHaveLength(3);
    const retried = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'retry' }) });
    expect(retried.status).toBe(200);
  });

  test('isolates provider and persistence failures between concurrent recipients', async () => {
    const providerFailure = appFor({ orchestratorCount: 2, failSkill: 'Lead.' });
    const providerEvents = parseSse(await (await providerFailure.app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '@Atlas @Nova answer independently' }) })).text());
    const atlasDone = providerEvents.find(({ event, data }) => event === 'done' && data.orchestratorKey === providerFailure.orchestrators[0]!.key);
    const novaDone = providerEvents.find(({ event, data }) => event === 'done' && data.orchestratorKey === providerFailure.orchestrators[1]!.key);
    expect((atlasDone?.data.message as { content: string }).content).toContain('could not generate');
    expect((novaDone?.data.message as { content: string }).content).toBe('Hi there');

    const persistenceFailure = appFor({ orchestratorCount: 2, failPersistenceSkill: 'Lead.' });
    const persistenceEvents = parseSse(await (await persistenceFailure.app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '@Atlas @Nova persist independently' }) })).text());
    expect(persistenceEvents.some(({ event, data }) => event === 'assistant-error' && data.orchestratorKey === persistenceFailure.orchestrators[0]!.key)).toBe(true);
    expect(persistenceEvents.some(({ event, data }) => event === 'done' && data.orchestratorKey === persistenceFailure.orchestrators[1]!.key)).toBe(true);
    expect(persistenceEvents.at(-1)?.event).toBe('complete');
  });

  test('emits assistant-error when the fallback response cannot be persisted', async () => {
    const { app, persisted, orchestrators } = appFor({ fail: true, failPersistence: true });
    const response = await app.request(`/founders/organizations/${organizationKey}/communication/channels/${channelKey}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const events = parseSse(await response.text());
    expect(events.some(({ event, data }) => event === 'assistant-error' && data.orchestratorKey === orchestrators[0]!.key)).toBe(true);
    expect(events.some(({ event }) => event === 'done')).toBe(false);
    expect(persisted).toEqual(['user']);
  });

  test('uses the shared founder gate and founder user key for target organization access', async () => {
    const source = await Bun.file(new URL('./communication.ts', import.meta.url)).text();
    expect(source).toContain('await requireFounder(c)');
    expect(source).toContain('requireOrganizationAccess(auth.founder.user.key, requestedOrganizationKey)');
    expect(source).not.toContain("identity.identityType !== 'user'");
  });

});

import { describe, expect, test } from 'bun:test';
import type { CoreChatInput, CoreChatToolDefinition } from '@/lib/ai/actions';
import type { ProviderStreamChunk } from '@/lib/ai/providers';
import type { ToolContext } from '@/lib/ai/tools';
import { newId } from '@/lib/ids';
import { SparkRefundError } from '@/lib/ai/events/runtime';
import { SparkRepositoryError } from '@/lib/sparks/repository';
import { coreAgent, executeCoreAgent } from './core';
import { resolveAgentAllowlist } from './index';
import { coreAgentToolInputSchema, internalAgentRequestSchema } from './schemas';

const teamKey = newId(), scopeKey = newId(), userKey = newId();
const toolContext = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId(), teamKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
const request = (overrides: Record<string, unknown> = {}) => ({ systemPrompt: coreAgent.systemPrompt, message: 'Help me', currentDate: '2026-09-01T00:00:00.000Z', requestKey: 'request-1', ...overrides });
const definition = (name: string): CoreChatToolDefinition => ({ name, description: `Definition ${name}`, inputSchema: { type: 'object', additionalProperties: false } });
const definitions = coreAgent.allowlist.map(definition);
const text = (value: string): ProviderStreamChunk => ({ type: 'text-delta', text: value });
const call = (id: string, name: string, args: unknown): ProviderStreamChunk => ({ type: 'tool-call', toolCall: { id, name, arguments: args } });
const done: ProviderStreamChunk = { type: 'done' };

function queue(responses: ProviderStreamChunk[][], inputs: CoreChatInput[] = [], options: unknown[] = []) {
  return async function* (_team: string, input: CoreChatInput, streamOptions?: unknown) {
    inputs.push(input); options.push(streamOptions);
    const chunks = responses.shift();
    if (!chunks) throw new Error('Unexpected stream');
    for (const chunk of chunks) yield chunk;
  };
}

type Execute = NonNullable<NonNullable<Parameters<typeof executeCoreAgent>[2]>['tools']>['execute'];
function runtime(responses: ProviderStreamChunk[][], execute: Execute, inputs: CoreChatInput[] = []) {
  return { stream: queue(responses, inputs), tools: { names: coreAgent.allowlist, definitions, execute } };
}

describe('native Core agent loop', () => {
  test('uses a strict explicit Core allowlist', () => {
    expect(coreAgent.allowlist).toEqual(['app.search', 'agent.guide', 'app.generate-image']);
    expect(coreAgent.capabilities).toEqual({ webGrounding: 'model-selected' });
    expect(resolveAgentAllowlist(coreAgent.allowlist, coreAgent.allowlist)).toEqual([...coreAgent.allowlist]);
    expect(coreAgent.systemPrompt).toContain('re-run app.search before relying on the current state');
    expect(coreAgent.systemPrompt).toContain('same language as that message');
  });

  test('strict-parses trusted and public inputs', () => {
    expect(internalAgentRequestSchema.parse(request())).toMatchObject({ generateName: false, attachments: [] });
    const recalledContext = [{ role: 'user' as const, content: 'Older preference', createdAt: '2026-01-01T00:00:00.000Z' }];
    expect(internalAgentRequestSchema.parse(request({ recalledContext })).recalledContext).toEqual(recalledContext);
    expect(() => internalAgentRequestSchema.parse(request({ recalledContext: Array(21).fill(recalledContext[0]) }))).toThrow();
    expect(() => internalAgentRequestSchema.parse({ ...request(), extra: true })).toThrow('Unrecognized key');
    expect(coreAgentToolInputSchema.parse({ message: 'hello' })).toEqual({ message: 'hello', generateName: false });
    for (const field of ['systemPrompt', 'currentDate', 'requestKey', 'recalledContext', 'teamKey', 'scopeKey']) expect(() => coreAgentToolInputSchema.parse({ message: 'hello', [field]: 'forged' })).toThrow('Unrecognized key');
  });

  test('streams direct text on the first native request and creates the title locally', async () => {
    const inputs: CoreChatInput[] = []; const options: any[] = []; const deltas: string[] = []; let beforeDone = '';
    const stream = async function* (_team: string, input: CoreChatInput, streamOptions?: unknown) {
      inputs.push(input); options.push(streamOptions); yield text('A'.repeat(100)); beforeDone = deltas.join(''); yield done;
    };
    const message = `  ${'A useful title '.repeat(8)}  `;
    const recalledContext = [{ role: 'user' as const, content: 'A completely different old title', createdAt: '2026-01-01T00:00:00.000Z' }];
    const result = await executeCoreAgent(request({ generateName: true, message, recalledContext }), { toolContext, onDelta: (delta) => { deltas.push(delta); } }, { stream, tools: { names: coreAgent.allowlist, definitions, execute: async () => ({}) } });
    expect(beforeDone).toBe('A'.repeat(100));
    expect(deltas.join('')).toBe('A'.repeat(100));
    expect(result.name).toBe(`${message.replace(/\s+/g, ' ').trim().slice(0, 77).trimEnd()}...`);
    expect(JSON.parse((inputs[0]!.messages[0]!.content[0] as { text: string }).text).recalledContext).toEqual(recalledContext);
    expect(inputs[0]!.systemPrompt).toContain('Native public web search is available directly within the text model');
    expect(inputs[0]!.systemPrompt).toContain('Swedish dog-breed usage of "perro" may mean perro de agua español');
    expect(inputs[0]!.systemPrompt).toContain('Tell the user what you found directly');
    expect(inputs[0]!.systemPrompt).toContain('one brief natural sentence');
    expect(inputs[0]!.systemPrompt).toContain('do not append URLs or a Sources list unless the user asks');
    expect(inputs[0]!.systemPrompt).toContain('Current-request attachments are already provided directly to you');
    expect(inputs[0]!.systemPrompt).toContain('Never call app.search or use public web grounding merely because the user refers to this, the attached, the uploaded, or the captured image or document');
    expect(inputs[0]!.tools?.map(({ name }) => name)).toEqual([...coreAgent.allowlist]);
    expect(options[0].capabilities).toEqual({ webGrounding: 'model-selected' });
    expect(inputs[0]!.responseFormat).toBeUndefined();
  });

  test('does not delay visible text while provider teardown and billing remain pending', async () => {
    let releaseTeardown!: () => void;
    let teardownReached!: () => void;
    const teardownGate = new Promise<void>((resolve) => { releaseTeardown = resolve; });
    const reached = new Promise<void>((resolve) => { teardownReached = resolve; });
    const deltas: string[] = [];
    const stream = async function* () {
      yield text('The complete answer is visible now.');
      yield done;
      teardownReached();
      await teardownGate;
    };
    const operation = executeCoreAgent(request(), { toolContext, onDelta: (delta) => { deltas.push(delta); } }, { stream, tools: { names: coreAgent.allowlist, definitions, execute: async () => ({}) } });
    await reached;
    expect(deltas.join('')).toBe('The complete answer is visible now.');
    releaseTeardown();
    await expect(operation).resolves.toMatchObject({ message: 'The complete answer is visible now.' });
  });

  test('passes current images and files directly without workspace or public search capabilities', async () => {
    const inputs: CoreChatInput[] = []; const options: any[] = [];
    const stream = queue([[text('I see a red square.'), done]], inputs, options);
    const result = await executeCoreAgent(request({
      message: 'What do you see in this image?',
      attachments: [
        { kind: 'image', filename: 'capture.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
        { kind: 'document', filename: 'notes.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([4, 5, 6]) },
      ],
    }), { toolContext }, { stream, tools: { names: coreAgent.allowlist, definitions, execute: async () => { throw new Error('Attachment analysis must not invoke a tool.'); } } });
    expect(result).toMatchObject({ message: 'I see a red square.', tools: [] });
    expect(inputs[0]!.tools?.map(({ name }) => name)).toEqual(['agent.guide', 'app.generate-image']);
    expect(options[0].capabilities).toEqual({});
    expect(inputs[0]!.messages.at(-1)?.content).toContainEqual(expect.objectContaining({ type: 'image' }));
    expect(inputs[0]!.messages.at(-1)?.content).toContainEqual(expect.objectContaining({ type: 'file', filename: 'notes.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([4, 5, 6]) }));
  });

  test('preserves mixed visible text in the stream and assistant tool-call transcript', async () => {
    const inputs: CoreChatInput[] = []; const deltas: string[] = [];
    const result = await executeCoreAgent(request(), { toolContext, onDelta: (delta) => { deltas.push(delta); } }, runtime([
      [text('I will check that. '), call('search', 'app.search', { operation: 'count', collectionSlugs: ['books'], limit: 10 }), done],
      [text('You have four books.'), done],
    ], async () => ({ operation: 'count', groups: [{ collectionSlug: 'books', count: 4 }] }), inputs));
    expect(result.message).toBe('I will check that. You have four books.');
    expect(deltas.join('')).toBe(result.message);
    expect(inputs[1]!.messages.at(-2)?.content).toEqual([
      { type: 'text', text: 'I will check that. ' },
      { type: 'tool-call', toolCallId: 'search', name: 'app.search', arguments: { operation: 'count', collectionSlugs: ['books'], limit: 10 } },
    ]);
  });

  test('validates an entire batch before dispatching any call', async () => {
    const scenarios: Array<[ProviderStreamChunk[], string]> = [
      [[call('read', 'app.search', { operation: 'count', collectionSlugs: ['images'], limit: 10 }), call('write', 'app.generate-image', { prompt: 'A dog' })], 'every call must be read-only'],
      [[call('read', 'app.search', { operation: 'count', collectionSlugs: ['images'], limit: 10 }), call('unknown', 'unknown.tool', {})], 'unauthorized tool'],
      [[call('read', 'app.search', { operation: 'count', collectionSlugs: ['images'], limit: 10 }), call('large', 'agent.guide', { value: 'x'.repeat(41_000) })], 'exceeds 40000 bytes'],
    ];
    for (const [calls, error] of scenarios) {
      let executions = 0;
      await expect(executeCoreAgent(request(), { toolContext }, runtime([[...calls, done]], async () => { executions += 1; return {}; }))).rejects.toThrow(error);
      expect(executions).toBe(0);
    }
  });

  test('runs an all-read batch concurrently and retains emitted order', async () => {
    const started: string[] = []; let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const result = await executeCoreAgent(request(), { toolContext }, runtime([
      [call('search', 'app.search', { operation: 'count', collectionSlugs: ['trips'], limit: 10 }), call('guide', 'agent.guide', { mode: 'explain' }), done],
      [text('Compared.'), done],
    ], async (name) => { started.push(name); if (started.length === 2) release(); await gate; return name === 'app.search' ? { operation: 'count', groups: [] } : { guides: [] }; }));
    expect(started).toEqual(['app.search', 'agent.guide']);
    expect(result.tools.map(({ slug }) => slug)).toEqual(['app.search', 'agent.guide']);
  });

  test('executes a write alone and delegates the Core image name', async () => {
    const called: string[] = []; const inputs: CoreChatInput[] = []; let trustedMessage: string | undefined;
    const result = await executeCoreAgent(request(), { toolContext, currentUserMessageContent: 'Draw what I described', onToolSucceeded: (slug) => slug === 'app.generate-image' }, runtime([
      [call('image', 'app.generate-image', { prompt: 'Earth from orbit' }), done],
      [text('I am creating your view of Earth from orbit now.'), done],
    ], async (name, _input, dependencies) => { called.push(name); trustedMessage = dependencies.currentUserMessageContent; return { queued: true }; }, inputs));
    expect(called).toEqual(['app.generate-image']);
    expect(trustedMessage).toBe('Draw what I described');
    expect(inputs).toHaveLength(2);
    expect(inputs[1]!.tools).toBeUndefined();
    expect(result.message).toBe('I am creating your view of Earth from orbit now.');
    expect(result.tools[0]).toMatchObject({ slug: 'app.generate-image', status: 'succeeded' });
  });

  test('shares one in-flight promise for deterministic duplicate calls', async () => {
    let executions = 0, succeeded = 0;
    const result = await executeCoreAgent(request(), { toolContext, onToolSucceeded: () => { succeeded += 1; } }, runtime([
      [call('one', 'agent.guide', { mode: 'explain' }), call('two', 'agent.guide', { mode: 'explain' }), done],
      [text('Complete.'), done],
    ], async () => { executions += 1; await Promise.resolve(); return { guides: [] }; }));
    expect({ executions, succeeded }).toEqual({ executions: 1, succeeded: 1 });
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0]).toEqual(result.tools[1]);
  });

  test('executes image generation only once per request even when later arguments differ', async () => {
    const requestKeys: string[] = [];
    let executions = 0;
    const result = await executeCoreAgent(request(), { toolContext }, runtime([
      [call('one', 'app.generate-image', { prompt: 'A white horse' }), done],
      [call('two', 'app.generate-image', { prompt: 'A black horse' }), done],
      [text('I am creating an image of a horse now.'), done],
    ], async (_name, _input, dependencies) => {
      executions += 1;
      requestKeys.push(dependencies.requestKey!);
      return { queued: true };
    }));

    expect(executions).toBe(1);
    expect(new Set(requestKeys).size).toBe(1);
    expect(result.tools).toHaveLength(2);
    expect(result.message).toBe('I am creating an image of a horse now.');
  });

  test('allows one empty-search reformulation with unchanged constraints', async () => {
    const calls: unknown[] = [];
    const result = await executeCoreAgent(request(), { toolContext }, runtime([
      [call('first', 'app.search', { query: 'docuemnts Q4', collectionSlugs: ['documents'], filters: { createdFrom: '2026-01-01T00:00:00.000Z' }, limit: 1 }), done],
      [call('second', 'app.search', { query: 'Q4', collectionSlugs: ['documents'], filters: { createdFrom: '2026-01-01T00:00:00.000Z' }, limit: 1 }), done],
      [text('Found it.'), done],
    ], async (_name, raw) => { calls.push(raw); return calls.length === 1 ? { query: 'docuemnts Q4', groups: [{ collectionSlug: 'documents', results: [] }] } : { query: 'Q4', groups: [{ collectionSlug: 'documents', results: [{ key: newId(), name: 'Q4' }] }] }; }));
    expect(calls).toHaveLength(2);
    expect(result.message).toBe('Found it.');
    await expect(executeCoreAgent(request(), { toolContext }, runtime([
      [call('first', 'app.search', { query: 'first', collectionSlugs: ['documents'], limit: 1 }), done],
      [call('second', 'app.search', { query: 'second', collectionSlugs: ['files'], limit: 1 }), done],
    ], async () => ({ query: 'first', groups: [{ collectionSlug: 'documents', results: [] }] })))).rejects.toThrow('change only the query');
  });

  test('rejects two semantic searches in one batch before side effects', async () => {
    let executions = 0;
    await expect(executeCoreAgent(request(), { toolContext }, runtime([[
      call('one', 'app.search', { query: 'one', collectionSlugs: ['documents'], limit: 10 }),
      call('two', 'app.search', { query: 'two', collectionSlugs: ['documents'], limit: 10 }), done,
    ]], async () => { executions += 1; return {}; }))).rejects.toThrow('one app.search semantic query');
    expect(executions).toBe(0);
  });

  test('forces a tool-free final request after four emitted calls', async () => {
    const inputs: CoreChatInput[] = []; let executions = 0;
    const result = await executeCoreAgent(request(), { toolContext }, runtime([
      [call('1', 'agent.guide', { mode: 'explain', query: '1' }), call('2', 'agent.guide', { mode: 'explain', query: '2' }), done],
      [call('3', 'agent.guide', { mode: 'explain', query: '3' }), call('4', 'agent.guide', { mode: 'explain', query: '4' }), done],
      [text('I completed four checks.'), done],
    ], async () => { executions += 1; return { guides: [] }; }, inputs));
    expect(executions).toBe(4);
    expect(result.tools).toHaveLength(4);
    expect(inputs[2]!.tools).toBeUndefined();
    expect(inputs[2]!.systemPrompt).toContain('Do not call a tool');
  });

  test('streams every provider chunk immediately without output holdback or rewriting', async () => {
    const deltas: string[] = [];
    const result = await executeCoreAgent(request(), { toolContext, onDelta: (delta) => { deltas.push(delta); } }, runtime([
      [text('Reference cabcdefghijkl'), text('mnopqrstuvwx safely.'), done],
    ], async () => ({})));
    expect(result.message).toBe('Reference cabcdefghijklmnopqrstuvwx safely.');
    expect(deltas.join('')).toBe(result.message);
    expect(deltas).toEqual(['Reference cabcdefghijkl', 'mnopqrstuvwx safely.']);
  });

  test('preserves app.search projection in model context', async () => {
    const inputs: CoreChatInput[] = [];
    await executeCoreAgent(request(), { toolContext }, runtime([
      [call('search', 'app.search', { query: 'orange', collectionSlugs: ['images'], limit: 10 }), done], [text('Found images.'), done],
    ], async () => ({ query: 'orange', groups: [{ collectionSlug: 'images', results: [{ key: newId(), caption: 'Sunset' }] }] }), inputs));
    expect(inputs[1]!.messages.at(-1)?.content[0]).toMatchObject({ type: 'tool-result', result: { slug: 'app.search', status: 'succeeded', result: { matchSemantics: 'ranked-best-match', groups: [{ examples: [{ label: 'Sunset' }] }] } } });
  });

  test('rethrows billing and refund errors', async () => {
    const insufficient = new SparkRepositoryError('INSUFFICIENT_BALANCE', 'insufficient');
    await expect(executeCoreAgent(request(), { toolContext }, runtime([[call('one', 'app.search', { operation: 'count', collectionSlugs: ['images'], limit: 10 }), done]], async () => { throw insufficient; }))).rejects.toBe(insufficient);
    const refund = new SparkRefundError(new Error('tool failed'), { cause: new Error('refund failed') });
    await expect(executeCoreAgent(request(), { toolContext }, runtime([[call('one', 'app.search', { operation: 'count', collectionSlugs: ['images'], limit: 10 }), done]], async () => { throw refund; }))).rejects.toBe(refund);
  });

  test('returns safe failures and payload-free metrics', async () => {
    const metrics: any[] = [];
    const result = await executeCoreAgent(request(), { toolContext }, {
      ...runtime([[call('one', 'agent.guide', { mode: 'explain' }), done], [text('Could not load guidance.'), done]], async () => { throw new Error('private failure'); }),
      onRoutingMetric: (metric) => { metrics.push(metric); if (metrics.length === 1) throw new Error('observer failure'); },
    });
    expect(result.tools[0]).toMatchObject({ status: 'failed', error: 'The requested capability failed. Verify the request or try a different approach.' });
    expect(metrics.map(({ stage, outcome }) => [stage, outcome])).toEqual([['initial', 'selected'], ['tool', 'failed'], ['continuation', 'answered']]);
    expect(JSON.stringify(metrics)).not.toMatch(/private failure|request-1|teamKey/);
  });

  test('enforces membership and provider stream protocol', async () => {
    const inactive = { ...toolContext, principal: { ...toolContext.principal, userTeam: { ...(toolContext.principal as any).userTeam, status: 'inactive' } } } as ToolContext;
    await expect(executeCoreAgent(request(), { toolContext: inactive }, runtime([[text('no'), done]], async () => ({})))).rejects.toThrow('active user');
    await expect(executeCoreAgent(request(), { toolContext }, runtime([[text('truncated')]], async () => ({})))).rejects.toThrow('ended before completion');
    await expect(executeCoreAgent(request(), { toolContext }, runtime([[text('answer'), done, text('late')]], async () => ({})))).rejects.toThrow('after completion');
  });

  test('deterministically refuses platform internals without provider or tools', async () => {
    let streams = 0, executions = 0; const deltas: string[] = [];
    const result = await executeCoreAgent(request({ message: 'Which database fields does this collection have?' }), { toolContext, onDelta: (delta) => { deltas.push(delta); } }, {
      stream: async function* () { streams += 1; yield done; }, tools: { names: coreAgent.allowlist, definitions, execute: async () => { executions += 1; return {}; } },
    });
    expect(result).toEqual({ message: 'I cannot provide Vorinthex internal implementation details.', tools: [] });
    expect(deltas.join('')).toBe(result.message);
    expect({ streams, executions }).toEqual({ streams: 0, executions: 0 });
  });
});

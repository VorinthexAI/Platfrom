import { describe, expect, test } from 'bun:test';
import type { CoreChatInput, CoreChatToolDefinition } from '@/lib/ai/actions';
import type { ProviderStreamChunk } from '@/lib/ai/providers';
import type { ToolContext } from '@/lib/ai/tools';
import { newId } from '@/lib/ids';
import { SparkRefundError } from '@/lib/ai/events/runtime';
import { SparkRepositoryError } from '@/lib/sparks/repository';
import { coreAgent, executeCoreAgent } from './core';
import { AgentStreamProtocolError, resolveAgentAllowlist } from './index';
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
    expect(coreAgent.systemPrompt).toContain('Always answer in concise, natural English');
    expect(coreAgent.systemPrompt).toContain('Use app.search only for the user\'s private workspace');
    expect(coreAgent.systemPrompt.length).toBeLessThan(2_500);
  });

  test('strict-parses trusted and public inputs', () => {
    expect(internalAgentRequestSchema.parse(request())).toMatchObject({ generateName: false, attachments: [] });
    const recalledContext = [{ role: 'user' as const, content: 'Older preference', createdAt: '2026-01-01T00:00:00.000Z' }];
    expect(internalAgentRequestSchema.parse(request({ currentConversationSummary: 'Earlier decisions', recalledContext }))).toMatchObject({ currentConversationSummary: 'Earlier decisions', recalledContext });
    expect(() => internalAgentRequestSchema.parse(request({ recalledContext: Array(21).fill(recalledContext[0]) }))).toThrow();
    expect(() => internalAgentRequestSchema.parse({ ...request(), extra: true })).toThrow('Unrecognized key');
    expect(coreAgentToolInputSchema.parse({ message: 'hello' })).toEqual({ message: 'hello', generateName: false });
    for (const field of ['systemPrompt', 'currentConversationSummary', 'currentDate', 'requestKey', 'recalledContext', 'teamKey', 'scopeKey']) expect(() => coreAgentToolInputSchema.parse({ message: 'hello', [field]: 'forged' })).toThrow('Unrecognized key');
  });

  test('streams direct text immediately while generating a concise model-written conversation name', async () => {
    const inputs: CoreChatInput[] = []; const options: any[] = []; const deltas: string[] = []; let beforeDone = '';
    const stream = async function* (_team: string, input: CoreChatInput, streamOptions?: unknown) {
      inputs.push(input); options.push(streamOptions);
      if (input.responseFormat?.name === 'conversation_name') { yield text('{"name":"Useful Launch Plan"}'); yield done; return; }
      yield text('A'.repeat(100)); beforeDone = deltas.join(''); yield done;
    };
    const message = `  ${'A useful title '.repeat(8)}  `;
    const recalledContext = [{ role: 'user' as const, content: 'A completely different old title', createdAt: '2026-01-01T00:00:00.000Z' }];
    const result = await executeCoreAgent(request({ generateName: true, message, currentConversationSummary: 'The user is planning a launch.', recalledContext }), { toolContext, onDelta: (delta) => { deltas.push(delta); } }, { stream, tools: { names: coreAgent.allowlist, definitions, execute: async () => ({}) } });
    expect(beforeDone).toBe('A'.repeat(100));
    expect(deltas.join('')).toBe('A'.repeat(100));
    expect(result.name).toBe('Useful Launch Plan');
    const namingIndex = inputs.findIndex(({ responseFormat }) => responseFormat?.name === 'conversation_name');
    const answerIndex = inputs.findIndex(({ responseFormat }) => responseFormat === undefined);
    expect(JSON.parse((inputs[namingIndex]!.messages[0]!.content[0] as { text: string }).text)).toEqual({ message: message.trim() });
    expect(inputs[namingIndex]!.systemPrompt).toContain('concise English chat name');
    expect(inputs[namingIndex]!.systemPrompt).toContain('Use 1 to 5 words');
    expect(inputs[namingIndex]!.tools).toBeUndefined();
    expect((options[namingIndex] as any).capabilities).toEqual({});
    expect(JSON.parse((inputs[answerIndex]!.messages[0]!.content[0] as { text: string }).text)).toEqual({ currentConversationSummary: 'The user is planning a launch.', recalledContext, currentDate: '2026-09-01T00:00:00.000Z' });
    expect((inputs[answerIndex]!.messages[1]!.content[0] as { text: string }).text).toBe(message.trim());
    expect(inputs[answerIndex]!.systemPrompt).toBe(coreAgent.systemPrompt);
    expect(inputs[answerIndex]!.systemPrompt).toContain('Use native web search only for current public facts');
    expect(inputs[answerIndex]!.systemPrompt).toContain('Inspect current-request images and files directly');
    expect(inputs[answerIndex]!.systemPrompt).toContain('Do not search merely because an attachment is mentioned');
    expect(inputs[answerIndex]!.tools?.map(({ name }) => name)).toEqual([...coreAgent.allowlist]);
    expect((options[answerIndex] as any).capabilities).toEqual({ webGrounding: 'model-selected' });
    expect(inputs[answerIndex]!.responseFormat).toBeUndefined();
  });

  test('discards a verbose generated conversation name instead of clipping it', async () => {
    const stream = async function* (_team: string, input: CoreChatInput) {
      yield text(input.responseFormat?.name === 'conversation_name' ? '{"name":"One two three four five six"}' : 'The answer.');
      yield done;
    };
    const result = await executeCoreAgent(request({ generateName: true }), { toolContext }, { stream, tools: { names: coreAgent.allowlist, definitions, execute: async () => ({}) } });
    expect(result.message).toBe('The answer.');
    expect(result.name).toBeUndefined();
  });

  test('keeps Swedish history in its original roles and English as the final request turn', async () => {
    const inputs: CoreChatInput[] = [];
    const currentMessage = 'Can you summarize that briefly?';
    const context = Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `Lång svensk historisk kontext ${index}`, createdAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z` }));
    await executeCoreAgent(request({ message: currentMessage, context }), { toolContext }, { stream: queue([[text('Yes.'), done]], inputs), tools: { names: coreAgent.allowlist, definitions, execute: async () => ({}) } });
    expect(inputs[0]!.messages).toHaveLength(12);
    expect(JSON.parse((inputs[0]!.messages[0]!.content[0] as { text: string }).text)).toEqual({ recalledContext: [], currentDate: '2026-09-01T00:00:00.000Z' });
    expect(inputs[0]!.messages.slice(1, -1).map(({ role }) => role)).toEqual(context.map(({ role }) => role));
    expect(inputs[0]!.messages.at(-2)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Lång svensk historisk kontext 9' }] });
    expect(inputs[0]!.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: currentMessage }] });
    expect(JSON.stringify(inputs[0]!.messages.at(-1))).not.toContain('svensk historisk kontext');
    expect(inputs[0]!.systemPrompt).toBe(coreAgent.systemPrompt);
  });

  test('injects one strict trusted preloaded guide result and removes it from provider tools', async () => {
    const inputs: CoreChatInput[] = [];
    const preloadedTools = [{ slug: 'agent.guide' as const, arguments: { mode: 'explain' as const }, result: { mode: 'explain', guides: [{ id: 'platform-welcome', title: 'Welcome', content: 'Grounding' }] } }];
    const result = await executeCoreAgent(request({ preloadedTools }), { toolContext }, { stream: queue([[text('A concise guide answer.'), done]], inputs), tools: { names: coreAgent.allowlist, definitions, execute: async () => { throw new Error('Preloaded guidance must not execute again.'); } } });
    expect(result.tools).toContainEqual(expect.objectContaining({ slug: 'agent.guide', status: 'succeeded', arguments: { mode: 'explain' } }));
    expect(inputs[0]!.tools?.map(({ name }) => name)).toEqual(['app.search', 'app.generate-image']);
    expect(inputs[0]!.messages.slice(1, 3)).toEqual([
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'preloaded-1', name: 'agent.guide', arguments: { mode: 'explain' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'preloaded-1', result: expect.objectContaining({ slug: 'agent.guide', status: 'succeeded' }) }] },
    ]);
    expect(inputs[0]!.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: 'Help me' }] });
    expect(() => internalAgentRequestSchema.parse(request({ preloadedTools: [{ ...preloadedTools[0], forged: true }] }))).toThrow('Unrecognized key');
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

  test('aborts a provider attempt that emits no initial stream event', async () => {
    let observedSignal: AbortSignal | undefined;
    const stream = async function* (_team: string, _input: CoreChatInput, options?: { signal?: AbortSignal }) {
      observedSignal = options?.signal;
      await new Promise<void>((resolve, reject) => {
        if (options?.signal?.aborted) reject(options.signal.reason);
        else options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
      });
      yield done;
    };
    await expect(executeCoreAgent(request(), { toolContext }, { stream: stream as never, initialResponseTimeoutMs: 1, tools: { names: coreAgent.allowlist, definitions, execute: async () => ({}) } })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(observedSignal?.aborted).toBe(true);
  });

  test('passes ordered current attachments before the final standalone current-message language anchor', async () => {
    const inputs: CoreChatInput[] = []; const options: any[] = [];
    const stream = queue([[text('I see a red square.'), done]], inputs, options);
    const result = await executeCoreAgent(request({
      message: 'What do you see in this image?',
      attachments: [
        { kind: 'image', filename: 'capture.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
        { kind: 'document', filename: 'notes.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([4, 5, 6]) },
        { kind: 'document', filename: 'brief.txt', mimeType: 'text/plain', bytes: new Uint8Array([7, 8, 9]) },
      ],
    }), { toolContext }, { stream, tools: { names: coreAgent.allowlist, definitions, execute: async () => { throw new Error('Attachment analysis must not invoke a tool.'); } } });
    expect(result).toMatchObject({ message: 'I see a red square.', tools: [] });
    expect(inputs[0]!.tools?.map(({ name }) => name)).toEqual(['agent.guide', 'app.generate-image']);
    expect(options[0].capabilities).toEqual({});
    expect(inputs[0]!.systemPrompt).toBe(coreAgent.systemPrompt);
    expect(inputs[0]!.systemPrompt).toContain('Inspect current-request images and files directly');
    expect(inputs[0]!.systemPrompt!.length).toBeLessThan(2_500);
    expect(inputs[0]!.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'image' }),
      { type: 'file', filename: 'notes.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([4, 5, 6]) },
      { type: 'file', filename: 'brief.txt', mimeType: 'text/plain', bytes: new Uint8Array([7, 8, 9]) },
      { type: 'text', text: 'What do you see in this image?' },
    ]);
  });

  test('repeats the current-message language anchor after opposite-language history and tool results', async () => {
    const inputs: CoreChatInput[] = []; const deltas: string[] = [];
    const currentMessage = 'How many books do I have?';
    const result = await executeCoreAgent(request({ message: currentMessage, context: [{ role: 'assistant', content: 'Jag fortsätter på svenska.', createdAt: '2026-08-31T00:00:00.000Z' }] }), { toolContext, onDelta: (delta) => { deltas.push(delta); } }, runtime([
      [call('search', 'app.search', { operation: 'count', collectionSlugs: ['books'], limit: 10 }), done],
      [text('You have four books.'), done],
    ], async () => ({ operation: 'count', groups: [{ collectionSlug: 'books', count: 4, summary: 'Du har fyra böcker.' }] }), inputs));
    expect(result.message).toBe('You have four books.');
    expect(deltas.join('')).toBe(result.message);
    expect(inputs[1]!.messages.at(-3)?.content).toEqual([
      { type: 'tool-call', toolCallId: 'search', name: 'app.search', arguments: { operation: 'count', collectionSlugs: ['books'], limit: 10 } },
    ]);
    expect(inputs[0]!.messages.at(-2)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Jag fortsätter på svenska.' }] });
    expect(inputs[0]!.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: currentMessage }] });
    expect(inputs[1]!.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: currentMessage }] });
    expect(inputs[1]!.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: currentMessage }] });
    expect(JSON.stringify(inputs[1]!.messages)).not.toContain('recalledContext');
    expect(JSON.stringify(inputs[1]!.messages)).not.toContain('Jag fortsätter på svenska');
    expect(inputs[1]!.systemPrompt).toBe(coreAgent.systemPrompt);
    expect(inputs[1]!.systemPrompt).toBe(inputs[0]!.systemPrompt);
  });

  test('keeps each consecutive turn final while enforcing English output', async () => {
    const scenarios = [
      { message: 'Can you explain that in simple terms?', prior: 'Jag svarar på svenska.', answer: 'Yes, here is a simple explanation.' },
      { message: 'Perfect thank you', prior: 'Jag svarar på svenska.', answer: 'You are welcome.' },
      { message: 'Peux-tu donner un exemple concret ?', prior: 'Here is an English answer.', answer: 'Here is a concrete example.' },
      { message: '请用一个简单的例子解释。', prior: 'Voici une réponse française.', answer: 'Here is a simple example.' },
    ];
    for (const scenario of scenarios) {
      const inputs: CoreChatInput[] = [];
      await executeCoreAgent(request({ message: scenario.message, context: [{ role: 'assistant', content: scenario.prior, createdAt: '2026-08-31T00:00:00.000Z' }] }), { toolContext }, {
        stream: queue([[text(scenario.answer), done]], inputs),
        tools: { names: coreAgent.allowlist, definitions, execute: async () => ({}) },
      });
      expect(inputs[0]!.messages.at(-2)).toEqual({ role: 'assistant', content: [{ type: 'text', text: scenario.prior }] });
      expect(inputs[0]!.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: scenario.message }] });
    }
  });

  test('rejects mixed visible text and tool calls before executing a tool', async () => {
    const deltas: string[] = []; let executions = 0;
    const operation = executeCoreAgent(request(), { toolContext, onDelta: (delta) => { deltas.push(delta); } }, runtime([
      [text('I will check that. '), call('search', 'app.search', { operation: 'count', collectionSlugs: ['books'], limit: 10 }), done],
    ], async () => { executions += 1; return {}; }));
    await expect(operation).rejects.toBeInstanceOf(AgentStreamProtocolError);
    expect(deltas).toEqual(['I will check that. ']);
    expect(executions).toBe(0);
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

  test('executes image generation alone and returns only a localized post-success start confirmation', async () => {
    const called: string[] = []; const inputs: CoreChatInput[] = []; const deltas: string[] = []; let trustedMessage: string | undefined;
    const result = await executeCoreAgent(request({ message: 'Skapa en bild av jorden från omloppsbana.' }), { toolContext, currentUserMessageContent: 'Draw what I described', onDelta: (delta) => { deltas.push(delta); }, onToolSucceeded: (slug) => slug === 'app.generate-image' }, runtime([
      [call('image', 'app.generate-image', { prompt: 'Earth from orbit' }), done],
      [text('Jag har börjat skapa din bild av jorden från omloppsbana.'), done],
    ], async (name, _input, dependencies) => { called.push(name); trustedMessage = dependencies.currentUserMessageContent; return { queued: true }; }, inputs));
    expect(called).toEqual(['app.generate-image']);
    expect(trustedMessage).toBe('Draw what I described');
    expect(inputs).toHaveLength(2);
    expect(inputs[1]!.tools).toBeUndefined();
    expect(result.message).toBe('Jag har börjat skapa din bild av jorden från omloppsbana.');
    expect(deltas).toEqual([result.message]);
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
    expect(inputs[2]!.systemPrompt).toBe(coreAgent.systemPrompt);
  });

  test('emits a completed tool-free provider turn without rewriting', async () => {
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
    expect(inputs[1]!.messages.at(-2)?.content[0]).toMatchObject({ type: 'tool-result', result: { slug: 'app.search', status: 'succeeded', result: { matchSemantics: 'ranked-best-match', groups: [{ examples: [{ label: 'Sunset' }] }] } } });
    expect(inputs[1]!.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Help me' }] });
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

  test('refuses platform internals in English without tools', async () => {
    const inputs: CoreChatInput[] = []; let executions = 0; const deltas: string[] = [];
    const result = await executeCoreAgent(request({ message: 'Which database fields does this collection have?', context: [{ role: 'assistant', content: 'Jag svarar alltid på svenska.', createdAt: '2026-08-31T00:00:00.000Z' }] }), { toolContext, onDelta: (delta) => { deltas.push(delta); } }, {
      stream: queue([[text('I cannot provide Vorinthex internal implementation details.'), done]], inputs), tools: { names: coreAgent.allowlist, definitions, execute: async () => { executions += 1; return {}; } },
    });
    expect(result).toEqual({ message: 'I cannot provide Vorinthex internal implementation details.', tools: [] });
    expect(deltas.join('')).toBe(result.message);
    expect(executions).toBe(0);
    expect(inputs[0]!.tools).toBeUndefined();
    expect(inputs[0]!.systemPrompt).toBe(coreAgent.systemPrompt);
  });

  test.each([
    ['Which model are you?', 'I am Core. Underlying implementation details are not provided.'],
    ['Who trained you?', 'I am Core. Underlying implementation details are not provided.'],
    ['Vilken AI modell ar du?', 'I am Core. Underlying implementation details are not provided.'],
  ])('keeps model identity private in English: %s', async (message, refusal) => {
    const result = await executeCoreAgent(request({ message }), { toolContext }, { stream: queue([[text(refusal), done]]), tools: { names: coreAgent.allowlist, definitions, execute: async () => ({}) } });
    expect(result).toEqual({ message: refusal, tools: [] });
  });
});

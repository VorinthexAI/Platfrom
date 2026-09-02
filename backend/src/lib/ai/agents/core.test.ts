import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import type { CoreChatInput, CoreChatToolDefinition } from '@/lib/ai/actions';
import type { ProviderStreamChunk } from '@/lib/ai/providers';
import type { ToolContext } from '@/lib/ai/tools';
import { coreAgent, executeCoreAgent } from './core';
import { resolveAgentAllowlist, runAgent } from './index';
import { coreAgentToolInputSchema, internalAgentRequestSchema } from './schemas';

const organizationKey = newId(), scopeKey = newId(), userKey = newId();
const toolContext = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
const request = (overrides: Record<string, unknown> = {}) => ({ systemPrompt: coreAgent.systemPrompt, message: 'Help me', currentDate: '2026-09-01T00:00:00.000Z', requestKey: 'request-1', ...overrides });
const definition = (name: string): CoreChatToolDefinition => ({ name, description: `Definition ${name}`, inputSchema: { type: 'object', additionalProperties: false } });
const text = (value: string): ProviderStreamChunk => ({ type: 'text-delta', text: value });
const call = (id: string, name: string, args: unknown): ProviderStreamChunk => ({ type: 'tool-call', toolCall: { id, name, arguments: args } });
const done: ProviderStreamChunk = { type: 'done' };
function queue(responses: ProviderStreamChunk[][], inputs: CoreChatInput[] = [], options: unknown[] = []) {
  return async function* (_organization: string, input: CoreChatInput, streamOptions?: unknown) { inputs.push(input); options.push(streamOptions); const chunks = responses.shift(); if (!chunks) throw new Error('Unexpected stream'); for (const chunk of chunks) yield chunk; };
}

describe('internal agents', () => {
  test('resolves exact, wildcard, deduplicated, and empty allowlists with recursion exclusions', () => {
    const names = ['folder.create', 'folder.delete', 'document.read', 'conversation.message.send', 'agents.core'];
    expect(resolveAgentAllowlist(['folder.create', 'folder.create'], names, 'agents.core')).toEqual(['folder.create']);
    expect(resolveAgentAllowlist(['folder.*'], names, 'agents.core')).toEqual(['folder.create', 'folder.delete']);
    expect(resolveAgentAllowlist([], names, 'agents.core')).toEqual(['folder.create', 'folder.delete', 'document.read']);
    expect(resolveAgentAllowlist([], names, 'agents.core', ['folder.*'])).toEqual(['document.read']);
    expect(resolveAgentAllowlist(['folder.*', 'document.read'], names, 'agents.core', ['folder.delete'])).toEqual(['folder.create', 'document.read']);
    expect(() => resolveAgentAllowlist(['folder*'], names)).toThrow(); expect(() => resolveAgentAllowlist(['missing.*'], names)).toThrow('matched no');
    expect(coreAgent).toMatchObject({ allowlist: [], excludedTools: [] });
  });

  test('strict-parses internal and public Core inputs and rejects forged trusted fields', () => {
    expect(internalAgentRequestSchema.parse(request())).toMatchObject({ generateName: false });
    expect(() => internalAgentRequestSchema.parse({ ...request(), extra: true })).toThrow('Unrecognized key');
    expect(coreAgentToolInputSchema.parse({ message: 'hello' })).toEqual({ message: 'hello', generateName: false });
    for (const field of ['systemPrompt', 'currentDate', 'requestKey', 'organizationKey', 'scopeKey', 'userKey', 'membership']) expect(() => coreAgentToolInputSchema.parse({ message: 'hello', [field]: 'forged' })).toThrow('Unrecognized key');
    expect(coreAgent.systemPrompt).toContain('Use web.search when the user asks for current, changing, live, or externally verifiable information');
    expect(coreAgent.systemPrompt).toContain('include relevant Markdown source links from its citations');
    expect(coreAgent.systemPrompt).toContain('re-run app.search before relying on the current state');
  });

  test('routes current information through web search and returns its grounded result to the model', async () => {
    const inputs: CoreChatInput[] = []; const calls: unknown[] = [];
    const result = await executeCoreAgent(request({ message: 'What happened today?' }), { toolContext }, {
      stream: queue([
        [text('{"tools":["web.search"],"message":""}'), done],
        [call('search', 'web.search', { query: 'important events today' }), done],
        [text('{"tools":[],"message":"Today’s update ([Source](https://example.com/news))."}'), done],
      ], inputs),
      tools: {
        names: ['web.search'], definitions: [definition('web.search')],
        execute: async (name, raw) => { calls.push({ name, raw }); return { text: 'Grounded facts', citations: [{ title: 'Source', url: 'https://example.com/news' }], sources: ['https://example.com/news'] }; },
      },
    });
    expect(calls).toEqual([{ name: 'web.search', raw: { query: 'important events today' } }]);
    expect(inputs[2]!.messages.at(-1)?.content[0]).toMatchObject({ type: 'tool-result', result: { slug: 'web.search', status: 'succeeded', result: { citations: [{ url: 'https://example.com/news' }] } } });
    expect(inputs[2]!.systemPrompt).toContain('include relevant Markdown links using only those citation URLs');
    expect(result.message).toContain('[Source](https://example.com/news)');
  });

  test('rejects inactive or mismatched membership before provider execution', async () => {
    let streams = 0;
    const stream = async function* () { streams += 1; yield done; };
    const inactive = { ...toolContext, principal: { ...toolContext.principal, userOrganization: { ...(toolContext.principal as any).userOrganization, status: 'inactive' } } } as ToolContext;
    const mismatched = { ...toolContext, principal: { ...toolContext.principal, userOrganization: { ...(toolContext.principal as any).userOrganization, userId: newId() } } } as ToolContext;
    await expect(executeCoreAgent(request(), { toolContext: inactive }, { stream, tools: { names: ['folder.create'], definitions: [definition('folder.create')] } })).rejects.toThrow('active user');
    await expect(executeCoreAgent(request(), { toolContext: mismatched }, { stream, tools: { names: ['folder.create'], definitions: [definition('folder.create')] } })).rejects.toThrow('does not match');
    expect(streams).toBe(0);
  });

  test('streams direct first and later answers without JSON framing', async () => {
    const firstInputs: CoreChatInput[] = []; const firstDeltas: string[] = [];
    const first = await executeCoreAgent(request({ generateName: true }), { toolContext, onDelta: (value) => { firstDeltas.push(value); } }, { stream: queue([[text('{"tools":[],"name":"Greeting","message":"Hello '), text('there"}'), done]], firstInputs), tools: { names: ['folder.create'], definitions: [definition('folder.create')] } });
    expect(first).toEqual({ message: 'Hello there', name: 'Greeting', tools: [] }); expect(firstDeltas).toEqual(['Hello ', 'there']);
    expect(firstInputs[0]!.responseFormat?.schema).toMatchObject({ required: ['tools', 'name', 'message'], additionalProperties: false });
    expect((firstInputs[0]!.responseFormat?.schema.properties as any).tools.items).toEqual({ type: 'string', minLength: 1 });
    const laterDeltas: string[] = [];
    await executeCoreAgent(request(), { toolContext, onDelta: (value) => { laterDeltas.push(value); } }, { stream: queue([[text('{"tools":[],"message":"Later"}'), done]]), tools: { names: ['folder.create'], definitions: [definition('folder.create')] } });
    expect(laterDeltas).toEqual(['Later']);
  });

  test('loads selected definitions only, validates props in dispatcher, and returns failed status to the AI', async () => {
    const inputs: CoreChatInput[] = []; const dispatchSchema = z.object({ name: z.string() }).strict(); let succeededHooks = 0;
    const result = await executeCoreAgent(request(), { toolContext, onToolSucceeded: () => { succeededHooks += 1; } }, {
      stream: queue([[text('{"tools":["folder.create"],"message":""}'), done], [call('one', 'folder.create', { forged: true }), done], [text('{"tools":[],"message":"I could not create it."}'), done]], inputs),
      tools: { names: ['folder.create', 'folder.delete'], definitions: [definition('folder.create'), definition('folder.delete')], execute: async (_name, raw) => dispatchSchema.parse(raw) },
    });
    expect(inputs[0]!.tools).toBeUndefined(); expect(inputs[1]!.tools).toEqual([definition('folder.create')]);
    expect(inputs[2]!.messages.at(-1)?.content[0]).toMatchObject({ type: 'tool-result', result: { slug: 'folder.create', arguments: { forged: true }, status: 'failed', error: expect.any(String) } });
    expect(result.tools).toMatchObject([{ slug: 'folder.create', status: 'failed' }]);
    expect(succeededHooks).toBe(0);
  });

  test('returns successful statuses, supports sequential selected tools, and hashes deterministic call keys', async () => {
    const keys: string[] = [];
    const responses = [
      [text('{"tools":["folder.create","folder.delete"],"message":""}'), done], [call('one', 'folder.create', { name: 'A' }), done],
      [text('{"tools":["folder.delete"],"message":""}'), done], [call('two', 'folder.delete', { key: 'A' }), done],
      [text('{"tools":[],"message":"Completed."}'), done],
    ];
    const tools = { names: ['folder.create', 'folder.delete'], definitions: [definition('folder.create'), definition('folder.delete')], execute: async (_name: string, _raw: unknown, deps: any) => { keys.push(deps.requestKey); return { ok: true }; } };
    const first = await executeCoreAgent(request(), { toolContext }, { stream: queue(responses.map((items) => [...items])), tools });
    const secondKeys: string[] = [];
    await executeCoreAgent(request(), { toolContext }, { stream: queue(responses.map((items) => [...items])), tools: { ...tools, execute: async (_name, _raw, deps) => { secondKeys.push(deps.requestKey!); return { ok: true }; } } });
    expect(first.tools.map(({ status }) => status)).toEqual(['succeeded', 'succeeded']); expect(first.message).toBe('Completed.');
    expect(keys).toEqual(secondKeys); expect(keys.every((key) => /^[a-f0-9]{64}$/.test(key))).toBe(true); expect(keys[0]).not.toBe(keys[1]);
  });

  test('rejects invalid calls and forces a final answer after four executions', async () => {
    const scenarios: Array<[string, ProviderStreamChunk[][], string, number]> = [
      ['unknown', [[text('{"tools":["unknown.tool"],"message":""}'), done]], 'not allowed', 0],
      ['unselected', [[text('{"tools":["folder.create"],"message":""}'), done], [call('x', 'folder.delete', {}), done]], 'unselected', 0],
      ['multiple', [[text('{"tools":["folder.create"],"message":""}'), done], [call('x', 'folder.create', {}), call('y', 'folder.create', {}), done]], 'more than one', 0],
      ['mixed', [[text('{"tools":["folder.create"],"message":""}'), done], [text('leak'), call('x', 'folder.create', {}), done]], 'mixed visible text', 0],
    ];
    for (const [, responses, expected, expectedCalls] of scenarios) { let executions = 0; await expect(executeCoreAgent(request(), { toolContext }, { stream: queue(responses), tools: { names: ['folder.create', 'folder.delete'], definitions: [definition('folder.create'), definition('folder.delete')], execute: async () => { executions += 1; } } })).rejects.toThrow(expected); expect(executions).toBe(expectedCalls); }
    const repeated: ProviderStreamChunk[][] = [[text('{"tools":["folder.create"],"message":""}'), done]];
    for (let index = 0; index < 4; index += 1) repeated.push([call(String(index), 'folder.create', {}), done], [text(index === 3 ? '{"tools":[],"message":"Execution limit reached."}' : '{"tools":["folder.create"],"message":""}'), done]);
    let executions = 0; let succeededHooks = 0;
    await expect(executeCoreAgent(request(), { toolContext, onToolSucceeded: () => { succeededHooks += 1; } }, { stream: queue(repeated), tools: { names: ['folder.create'], definitions: [definition('folder.create')], execute: async () => { executions += 1; return {}; } } })).resolves.toMatchObject({ message: 'Execution limit reached.', tools: expect.any(Array) });
    expect(executions).toBe(1);
    expect(succeededHooks).toBe(1);
  });

  test('propagates abort and safely omits oversized successful results', async () => {
    const controller = new AbortController(); const options: any[] = [];
    await executeCoreAgent(request(), { toolContext }, { router: { signal: controller.signal }, stream: queue([[text('{"tools":[],"message":"ok"}'), done]], [], options), tools: { names: ['folder.create'], definitions: [definition('folder.create')] } });
    expect(options[0]).toMatchObject({ signal: controller.signal });
    const events: string[] = []; let captured: unknown;
    const result = await runAgent(coreAgent, request(), { toolContext, onToolSucceeded: (_slug, _arguments, rawResult) => { events.push('hook'); captured = rawResult; } }, { stream: queue([[text('{"tools":["folder.create"],"message":""}'), done], [call('x', 'folder.create', {}), done], [text('{"tools":[],"message":"Too large."}'), done]]), tools: { names: ['folder.create'], definitions: [definition('folder.create')], execute: async () => { events.push('execute'); return { data: 'x'.repeat(50_000) }; } } });
    expect(result.tools[0]).toMatchObject({ status: 'succeeded', result: { omitted: true } });
    expect(events).toEqual(['execute', 'hook']);
    expect((captured as { data: string }).data).toHaveLength(50_000);
  });

  test('does not turn a successful tool into a failure when its observer fails', async () => {
    const result = await runAgent(coreAgent, request(), { toolContext, onToolSucceeded: () => { throw new Error('observer failed'); } }, { stream: queue([[text('{"tools":["folder.create"],"message":""}'), done], [call('x', 'folder.create', {}), done], [text('{"tools":[],"message":"Created."}'), done]]), tools: { names: ['folder.create'], definitions: [definition('folder.create')], execute: async () => ({ key: newId() }) } });
    expect(result.tools[0]).toMatchObject({ slug: 'folder.create', status: 'succeeded' });
  });

  test('requires terminal provider chunks and rejects oversized arguments before dispatch', async () => {
    await expect(executeCoreAgent(request(), { toolContext }, { stream: queue([[text('{"tools":[],"message":"answer"}')]]), tools: { names: ['folder.create'], definitions: [definition('folder.create')] } })).rejects.toThrow('ended before completion');
    await expect(executeCoreAgent(request(), { toolContext }, { stream: queue([[text('{"tools":[],"message":"answer"}'), done, text('late')]]), tools: { names: ['folder.create'], definitions: [definition('folder.create')] } })).rejects.toThrow('after completion');
    let executions = 0;
    await expect(executeCoreAgent(request(), { toolContext }, {
      stream: queue([[text('{"tools":["folder.create"],"message":""}'), done], [call('large', 'folder.create', { value: 'x'.repeat(41_000) }), done]]),
      tools: { names: ['folder.create'], definitions: [definition('folder.create')], execute: async () => { executions += 1; } },
    })).rejects.toThrow('exceeds 40000 bytes');
    expect(executions).toBe(0);
  });
});

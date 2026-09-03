import { describe, expect, test } from 'bun:test';
import { createRoutingResponseDecoder, MAX_ROUTING_RESPONSE_TOOLS, RoutingResponseError, type RoutingResponse } from './routing-response';

const allowed = new Set(['agent.query', 'document.search', ...Array.from({ length: 25 }, (_, index) => `tool.${index}`)]);

async function decode(source: string, options: { fragments?: string[]; name?: 'optional' | 'required'; maxBytes?: number } = {}) {
  const emitted: string[] = [];
  const decoder = createRoutingResponseDecoder({ allowedTools: allowed, emit: async (fragment) => { emitted.push(fragment); }, name: options.name, maxBytes: options.maxBytes });
  for (const fragment of options.fragments ?? [source]) await decoder.push(fragment);
  const value = await decoder.finish();
  return { value, emitted };
}

async function rejected(source: string, options: { name?: 'optional' | 'required'; maxBytes?: number } = {}) {
  const decoder = createRoutingResponseDecoder({ allowedTools: allowed, emit: () => {}, ...options });
  try {
    await decoder.push(source);
    await decoder.finish();
  } catch (error) {
    return error;
  }
  throw new Error('Expected decoding to fail');
}

describe('routing response decoder', () => {
  test('decodes and emits a direct response under every-character fragmentation', async () => {
    const source = '{"tools":[],"message":"Hello, world"}';
    const result = await decode(source, { fragments: [...source] });
    expect(result.value).toEqual({ tools: [], message: 'Hello, world' });
    expect(result.emitted.join('')).toBe('Hello, world');
    expect(result.emitted.every((fragment) => !/[{}"\\]/.test(fragment))).toBe(true);
  });

  test('supports either property order without emitting syntax', async () => {
    const toolsFirst = await decode('{"tools":[],"message":"live answer"}', { fragments: ['{"tools":[]', ',"message":"live ', 'answer"}'] });
    expect(toolsFirst.emitted).toEqual(['live ', 'answer']);
    const messageFirst = await decode('{"message":"buffered answer","tools":[]}', { fragments: ['{"message":"buffered ', 'answer",', '"tools":[]}'] });
    expect(messageFirst.emitted).toEqual(['buffered answer']);
  });

  test('decodes escaped values and surrogate pairs split across chunks', async () => {
    const source = '{"tools":[],"message":"line\\nquote: \\"; slash: \\\\; face: \\uD83D\\uDE00"}';
    const fragments = [...source];
    const { value, emitted } = await decode(source, { fragments });
    expect(value.message).toBe('line\nquote: "; slash: \\; face: 😀');
    expect(emitted.join('')).toBe(value.message);
    expect(emitted).not.toContain('\ud83d');
  });

  test('never emits and discards incidental text for a valid tool selection regardless of property order', async () => {
    for (const source of [
      '{"tools":["agent.query"],"message":""}',
      '{"message":"","tools":["agent.query","document.search"]}',
      '{"tools":["agent.query"],"message":"I will search for that."}',
      '{"message":"I will search for that.","tools":["agent.query"]}',
    ]) {
      const result = await decode(source, { fragments: [...source] });
      expect(result.value.tools.length).toBeGreaterThan(0);
      expect(result.value.message).toBe('');
      expect(result.emitted).toEqual([]);
    }
  });

  test('rejects unknown, duplicate, and too many tools', async () => {
    expect(await rejected('{"tools":["unknown"],"message":""}')).toBeInstanceOf(RoutingResponseError);
    expect(await rejected('{"tools":["agent.query","agent.query"],"message":""}')).toHaveProperty('message', expect.stringContaining('duplicate tool'));
    const tools = Array.from({ length: MAX_ROUTING_RESPONSE_TOOLS + 1 }, (_, index) => `tool.${index}`);
    expect(await rejected(JSON.stringify({ tools, message: '' }))).toHaveProperty('message', expect.stringContaining('at most 20'));
  });

  test('canonicalizes an authorized slug when a provider prematurely includes arguments', async () => {
    await expect(decode(`{"tools":["agent.query(query='archive', limit=100)"],"message":""}`)).resolves.toMatchObject({ value: { tools: ['agent.query'], message: '' } });
    expect(await rejected(`{"tools":["unknown.tool(query='archive')"],"message":""}`)).toHaveProperty('message', expect.stringContaining('not allowed'));
    expect(await rejected(`{"tools":["agent.query","agent.query(query='archive')"],"message":""}`)).toHaveProperty('message', expect.stringContaining('duplicate tool'));
  });

  test('rejects unknown and duplicate object fields', async () => {
    for (const source of [
      '{"tools":[],"message":"answer","extra":true}',
      '{"tools":[],"tools":[],"message":"answer"}',
      '{"tools":[],"message":"answer","message":"again"}',
      '{"name":"First","name":"Second","tools":[],"message":"answer"}',
    ]) expect(await rejected(source)).toBeInstanceOf(RoutingResponseError);
  });

  test('requires a nonblank direct response', async () => {
    for (const source of [
      '{"tools":[],"message":""}',
      '{"tools":[],"message":"  \n "}',
    ]) expect(await rejected(source)).toBeInstanceOf(RoutingResponseError);
  });

  test('rejects malformed, truncated, trailing, and oversized input', async () => {
    for (const source of [
      '["not an object"]',
      '{"tools":[],"message":false}',
      '{"tools":[,],"message":""}',
      '{"tools":[],"message":"bad\\x"}',
      '{"tools":[],"message":"answer",}',
      '{"tools":[],"message":"answer"',
      '{"tools":[],"message":"answer"} trailing',
    ]) expect(await rejected(source)).toBeInstanceOf(RoutingResponseError);
    expect(await rejected('{"tools":[],"message":"long"}', { maxBytes: 10 })).toHaveProperty('message', expect.stringContaining('exceeds 10 bytes'));
  });

  test('supports optional name and requires a nonblank name on first turns', async () => {
    await expect(decode('{"tools":[],"message":"answer"}')).resolves.toMatchObject({ value: { message: 'answer' } });
    const named = await decode('{"message":"answer","name":"Introductions","tools":[]}', { name: 'required', fragments: [...'{"message":"answer","name":"Introductions","tools":[]}'] });
    expect(named.value).toEqual({ tools: [], message: 'answer', name: 'Introductions' } satisfies RoutingResponse);
    expect(named.emitted.join('')).toBe('answer');
    expect(await rejected('{"tools":[],"message":"answer"}', { name: 'required' })).toHaveProperty('message', expect.stringContaining('missing name'));
    expect(await rejected('{"tools":[],"message":"answer","name":"  "}', { name: 'required' })).toHaveProperty('message', expect.stringContaining('must not be blank'));
  });

  test('requires both fields and rejects non-string fields and array trailing commas', async () => {
    for (const source of [
      '{}',
      '{"tools":[]}',
      '{"message":"answer"}',
      '{"tools":"agent.query","message":""}',
      '{"tools":[],"message":"answer","name":1}',
      '{"tools":["agent.query",],"message":""}',
    ]) expect(await rejected(source)).toBeInstanceOf(RoutingResponseError);
  });

  test('awaits emission and makes finish idempotent while preventing later pushes', async () => {
    const emitted: string[] = [];
    const decoder = createRoutingResponseDecoder({ allowedTools: allowed, emit: async (fragment) => { await Promise.resolve(); emitted.push(fragment); } });
    await decoder.push('{"tools":[],"message":"answer"}');
    expect(emitted).toEqual(['answer']);
    await expect(decoder.finish()).resolves.toEqual({ tools: [], message: 'answer' });
    await expect(decoder.finish()).resolves.toEqual({ tools: [], message: 'answer' });
    await expect(decoder.push(' ')).rejects.toThrow('cannot push after finish');
  });
});

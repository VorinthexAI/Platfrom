import { ConverseStreamCommand, type ConverseStreamCommandOutput, type ConverseStreamOutput } from '@aws-sdk/client-bedrock-runtime';
import { afterEach, describe, expect, test } from 'bun:test';
import type { ProviderError } from './errors';
import { createAwsBedrockProvider } from './aws-bedrock';

const provider = () => createAwsBedrockProvider({ region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret' });
const originalFetch = globalThis.fetch;

async function* eventStream(events: ConverseStreamOutput[]): AsyncIterable<ConverseStreamOutput> {
  yield* events;
}

async function streamError(stream: AsyncIterable<unknown>): Promise<ProviderError> {
  try {
    await Array.fromAsync(stream);
  } catch (error) {
    return error as ProviderError;
  }
  throw new Error('Expected stream to fail');
}

const streamRequest = {
  actionId: 'orchestrator-chat' as const,
  modelId: 'test.bedrock-chat',
  externalModelId: 'test.bedrock-chat-v1:0',
  input: {
    systemPrompt: 'Primary system prompt',
    messages: [
      { role: 'system' as const, content: [{ type: 'text' as const, text: 'Additional system prompt' }] },
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'Hi' }] },
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'Continue' }] },
    ],
    options: { maxTokens: 200, temperature: 1.5 },
  },
  organizationKey: 'organization',
};

afterEach(() => { globalThis.fetch = originalFetch; });

describe('AWS Bedrock provider', () => {
  test('prefers dedicated Bedrock credentials over generic AWS credentials', async () => {
    let authorization = '';
    globalThis.fetch = (async (_input, init) => {
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return Response.json({ output: { message: { content: [{ text: 'ok' }] } } });
    }) as typeof fetch;
    const adapter = createAwsBedrockProvider(undefined, {
      AWS_REGION: 'wrong-region',
      AWS_ACCESS_KEY_ID: 'generic-key',
      AWS_SECRET_ACCESS_KEY: 'generic-secret',
      BEDROCK_REGION: 'us-east-1',
      BEDROCK_AWS_ACCESS_KEY_ID: 'bedrock-key',
      BEDROCK_AWS_SECRET_ACCESS_KEY: 'bedrock-secret',
    });
    await adapter.execute({
      actionId: 'reason', modelId: 'amazon.nova-pro', externalModelId: 'us.amazon.nova-pro-v1:0', organizationKey: 'organization',
      input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Summarize' }] }] },
    });
    expect(authorization).toContain('Credential=bedrock-key/');
    expect(authorization).not.toContain('generic-key');
  });

  test('sends raw model IDs while signing their canonical encoded path', async () => {
    let url = '';
    globalThis.fetch = (async (input) => {
      url = String(input);
      return Response.json({
        output: { message: { content: [{ text: 'continued thought' }] } },
        usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
        stopReason: 'end_turn',
      });
    }) as typeof fetch;

    const response = await provider().execute({
      actionId: 'document-topics',
      modelId: 'amazon.nova-lite',
      externalModelId: 'us.amazon.nova-lite-v1:0',
      input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Continue' }] }] },
      organizationKey: 'organization',
    });

    expect(url).toEndWith('/model/us.amazon.nova-lite-v1:0/converse');
    expect(url).not.toContain('%253A');
    expect(response.output).toEqual({ text: 'continued thought', toolCalls: [], stopReason: 'end_turn' });
  });

  test('serializes Converse tools and normalizes native tool calls', async () => {
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({
        output: { message: { content: [{ text: 'Searching.' }, { toolUse: { toolUseId: 'call-1', name: 'search_knowledge', input: { query: 'roadmap' } } }] } },
        stopReason: 'tool_use',
      });
    }) as typeof fetch;

    const response = await provider().execute({
      actionId: 'orchestrator-chat',
      modelId: 'amazon.nova-lite',
      externalModelId: 'us.amazon.nova-lite-v1:0',
      organizationKey: 'organization',
      input: {
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Find the roadmap' }] }],
        tools: [
          { name: 'search_knowledge', description: 'Search accessible knowledge.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
          { name: 'write_note', inputSchema: { type: 'object' } },
        ],
      },
    });

    expect(body).toEqual({
      messages: [{ role: 'user', content: [{ text: 'Find the roadmap' }] }],
      toolConfig: { tools: [
        { toolSpec: { name: 'search_knowledge', description: 'Search accessible knowledge.', inputSchema: { json: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } } } },
        { toolSpec: { name: 'write_note', inputSchema: { json: { type: 'object' } } } },
      ] },
    });
    expect(response.output).toEqual({ text: 'Searching.', toolCalls: [{ id: 'call-1', name: 'search_knowledge', arguments: { query: 'roadmap' } }], stopReason: 'tool_use' });
  });

  test('serializes prior tool calls and results for Converse', async () => {
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ output: { message: { content: [{ text: 'Found it.' }] } }, stopReason: 'end_turn' });
    }) as typeof fetch;

    await provider().execute({
      actionId: 'orchestrator-chat', modelId: 'amazon.nova-lite', externalModelId: 'us.amazon.nova-lite-v1:0', organizationKey: 'organization',
      input: { messages: [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call-1', name: 'search_knowledge', arguments: { query: 'roadmap' } }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1', result: { documents: [] } }] },
      ] },
    });

    expect(body.messages).toEqual([
      { role: 'assistant', content: [{ toolUse: { toolUseId: 'call-1', name: 'search_knowledge', input: { query: 'roadmap' } } }] },
      { role: 'user', content: [{ toolResult: { toolUseId: 'call-1', content: [{ json: { documents: [] } }], status: 'success' } }] },
    ]);
  });

  test('streams typed Converse text, usage, and exactly one done event', async () => {
    let command: ConverseStreamCommand | undefined;
    let abortSignal: AbortSignal | undefined;
    let requestTimeout = 0;
    let destroyed = false;
    const controller = new AbortController();
    const adapter = createAwsBedrockProvider(
      { region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret' },
      undefined,
      (timeout) => {
        requestTimeout = timeout;
        return {
          async send(nextCommand, options) {
            command = nextCommand;
            abortSignal = options?.abortSignal;
            return {
              stream: eventStream([
                { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'Hello ' } } },
                { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'world' } } },
                { metadata: { usage: { inputTokens: 12, outputTokens: 2, totalTokens: 14 }, metrics: { latencyMs: 5 } } },
              ]),
            } as ConverseStreamCommandOutput;
          },
          destroy() { destroyed = true; },
        };
      },
    );

    const chunks = await Array.fromAsync(adapter.stream!({ ...streamRequest, signal: controller.signal, timeoutMs: 5_000 }));

    expect(command).toBeInstanceOf(ConverseStreamCommand);
    expect(command!.input).toEqual({
      modelId: 'test.bedrock-chat-v1:0',
      messages: [
        { role: 'user', content: [{ text: 'Hello' }] },
        { role: 'assistant', content: [{ text: 'Hi' }] },
        { role: 'user', content: [{ text: 'Continue' }] },
      ],
      system: [{ text: 'Primary system prompt' }, { text: 'Additional system prompt' }],
      inferenceConfig: { maxTokens: 200, temperature: 1 },
    });
    expect(JSON.stringify(command!.input)).not.toContain('audio');
    expect(requestTimeout).toBe(5_000);
    expect(abortSignal).toBeDefined();
    controller.abort();
    expect(abortSignal!.aborted).toBe(true);
    expect(chunks).toEqual([
      { type: 'text-delta', text: 'Hello ' },
      { type: 'text-delta', text: 'world' },
      { type: 'usage', usage: { inputTokens: 12, outputTokens: 2, totalTokens: 14 } },
      { type: 'done' },
    ]);
    expect(chunks.filter(({ type }) => type === 'done')).toHaveLength(1);
    expect(destroyed).toBe(true);
  });

  test('rejects non-chat actions before creating a stream client', async () => {
    let clientsCreated = 0;
    const adapter = createAwsBedrockProvider(
      { region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret' },
      undefined,
      () => { clientsCreated += 1; throw new Error('should not create client'); },
    );

    const error = await streamError(adapter.stream!({ ...streamRequest, actionId: 'embed' as const }));
    expect(error.code).toBe('unsupported_action');
    expect(clientsCreated).toBe(0);
  });

  test('normalizes missing, empty, and unknown event streams as invalid responses', async () => {
    const responses: ConverseStreamCommandOutput[] = [
      {} as ConverseStreamCommandOutput,
      { stream: eventStream([]) } as ConverseStreamCommandOutput,
      { stream: eventStream([{ $unknown: ['futureEvent', {}] }]) } as ConverseStreamCommandOutput,
    ];

    for (const response of responses) {
      let destroyed = false;
      const adapter = createAwsBedrockProvider(
        { region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret' },
        undefined,
        () => ({ async send() { return response; }, destroy() { destroyed = true; } }),
      );
      const error = await streamError(adapter.stream!(streamRequest));
      expect(error.code).toBe('response_invalid');
      expect(destroyed).toBe(true);
    }
  });

  test('normalizes cancellation and Bedrock stream exceptions and destroys the client', async () => {
    const abortError = new Error('cancelled');
    abortError.name = 'AbortError';
    const outcomes: Array<{ response?: ConverseStreamCommandOutput; error?: Error; code: ProviderError['code'] }> = [
      { error: abortError, code: 'aborted' },
      { response: { stream: eventStream([{ serviceUnavailableException: { message: 'unavailable' } } as unknown as ConverseStreamOutput]) } as ConverseStreamCommandOutput, code: 'provider_unavailable' },
    ];

    for (const outcome of outcomes) {
      let destroyed = false;
      const adapter = createAwsBedrockProvider(
        { region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret' },
        undefined,
        () => ({
          async send() {
            if (outcome.error) throw outcome.error;
            return outcome.response!;
          },
          destroy() { destroyed = true; },
        }),
      );
      const error = await streamError(adapter.stream!(streamRequest));
      expect(error.code).toBe(outcome.code);
      expect(error.providerId).toBe('aws-bedrock');
      expect(destroyed).toBe(true);
    }
  });
});

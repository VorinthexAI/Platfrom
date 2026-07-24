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
  modelId: 'amazon.nova-pro',
  externalModelId: 'amazon.nova-pro-v1:0',
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
  test('invokes Titan embeddings for embed', async () => {
    let url = '';
    globalThis.fetch = (async (input) => {
      url = String(input);
      return new Response(JSON.stringify({ embedding: [0.25, 0.75], inputTextTokenCount: 3 }), { status: 200 });
    }) as typeof fetch;
    const result = await provider().execute({ actionId: 'embed', modelId: 'amazon.titan-embed-text-v2', externalModelId: 'amazon.titan-embed-text-v2:0', input: { text: 'hello' }, organizationKey: 'organization' });
    expect(result.output).toEqual({ embedding: [0.25, 0.75] });
    expect(result.usage.inputTokens).toBe(3);
    expect(url).toContain('/model/amazon.titan-embed-text-v2%3A0/invoke');
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
      modelId: 'amazon.nova-pro-v1:0',
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

  test('rejects Sonic and non-chat actions before creating a stream client', async () => {
    let clientsCreated = 0;
    const adapter = createAwsBedrockProvider(
      { region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret' },
      undefined,
      () => { clientsCreated += 1; throw new Error('should not create client'); },
    );

    for (const request of [
      { ...streamRequest, externalModelId: 'amazon.nova-2-sonic-v1:0' },
      { ...streamRequest, actionId: 'embed' as const },
    ]) {
      const error = await streamError(adapter.stream!(request));
      expect(error.code).toBe('unsupported_action');
    }
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

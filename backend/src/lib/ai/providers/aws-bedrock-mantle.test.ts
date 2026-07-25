import { afterEach, describe, expect, test } from 'bun:test';
import { createAwsBedrockMantleProvider } from './aws-bedrock-mantle';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const request = {
  actionId: 'chat' as const,
  modelId: 'openai.gpt-5.6-terra',
  externalModelId: 'openai.gpt-5.6-terra',
  input: {
    systemPrompt: 'Be concise',
    messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }],
    options: { maxTokens: 100, temperature: 0.2 },
  },
  organizationKey: 'organization',
};

const provider = () => createAwsBedrockMantleProvider({ region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret' });

describe('AWS Bedrock Mantle provider', () => {
  test('posts Responses API requests to the us-east-1 Mantle endpoint', async () => {
    let url = '';
    let init: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
      url = String(input);
      init = options;
      return Response.json({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello back' }] }],
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      });
    }) as unknown as typeof fetch;

    const result = await provider().execute(request);

    expect(url).toBe('https://bedrock-mantle.us-east-1.api.aws/openai/v1/responses');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authorization).toContain('AWS4-HMAC-SHA256');
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'openai.gpt-5.6-terra',
      instructions: 'Be concise',
      input: [{ role: 'user', content: 'Hello' }],
      max_output_tokens: 100,
      temperature: 0.2,
      store: false,
    });
    expect(result.output).toEqual({ text: 'Hello back', toolCalls: [], stopReason: 'completed' });
    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 2, totalTokens: 6 });
  });

  test('normalizes streamed output text and usage', async () => {
    const chunks = [
      'event: response.output_text.delta\ndata: {"delta":"Hello "}\n\n',
      'event: response.output_text.delta\ndata: {"delta":"world"}\n\n',
      'event: response.completed\ndata: {"response":{"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}\n\n',
      'data: [DONE]\n\n',
    ];
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }), { headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;

    expect(await Array.fromAsync(provider().stream!(request))).toEqual([
      { type: 'text-delta', text: 'Hello ' },
      { type: 'text-delta', text: 'world' },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
      { type: 'done' },
    ]);
  });
});

import { z } from 'zod';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { awsCredentialsSchema, resolveAwsCredentials, signAwsRequest, type AwsCredentialEnvironment } from './aws-sigv4';
import { normalizeProviderError, ProviderError, providerErrorCodeForStatus } from './errors';
import { CHAT_ACTION_IDS, unsupportedAction } from './openai-compatible';
import { chatInputSchema, resolveRequestSignal, type ChatInput, type ChatOutput, type ProviderAdapter, type ProviderExecuteRequest, type ProviderExecuteResponse, type ProviderFactory, type ProviderStreamChunk } from './types';

export const awsBedrockMantleProviderConfigSchema = awsCredentialsSchema;
export type AwsBedrockMantleProviderConfig = z.infer<typeof awsBedrockMantleProviderConfigSchema>;
export const awsBedrockMantleCredentialsSchema = awsBedrockMantleProviderConfigSchema;
export type AwsBedrockMantleCredentials = AwsBedrockMantleProviderConfig;

const PROVIDER_ID = 'aws-bedrock-mantle' as const;
const MANTLE_PATH = '/openai/v1/responses';
const RESPONSE_EVENT = 'response';

const responseSchema = z.object({
  status: z.string().optional(),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional(),
    call_id: z.string().optional(),
    name: z.string().optional(),
    arguments: z.string().optional(),
  }).passthrough()).optional(),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional(), total_tokens: z.number().optional() }).passthrough().optional(),
}).passthrough();

type MantleResponse = z.infer<typeof responseSchema>;

function buildResponseInput(input: ChatInput): { instructions?: string; input: unknown[]; tools?: unknown[]; max_output_tokens?: number; temperature?: number } {
  const messages: unknown[] = [];
  for (const message of input.messages) {
    const text = message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    if (message.role === 'tool') {
      if (!message.toolCallId || !text) throw new ProviderError(PROVIDER_ID, 'unsupported_action', 'Bedrock Mantle requires text tool results with a tool call id');
      messages.push({ type: 'function_call_output', call_id: message.toolCallId, output: text });
      continue;
    }
    if (!text || message.content.some((part) => part.type !== 'text')) throw new ProviderError(PROVIDER_ID, 'unsupported_action', 'Bedrock Mantle does not support non-text chat content');
    messages.push({ role: message.role, content: text });
  }

  const body: ReturnType<typeof buildResponseInput> = { input: messages };
  if (input.systemPrompt) body.instructions = input.systemPrompt;
  if (input.options?.maxTokens !== undefined) body.max_output_tokens = input.options.maxTokens;
  if (input.options?.temperature !== undefined) body.temperature = input.options.temperature;
  if (input.tools?.length) {
    body.tools = input.tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema }));
  }
  return body;
}

function normalizeResponse(raw: unknown, modelId: string, externalModelId: string): ProviderExecuteResponse<ChatOutput> {
  const response = responseSchema.parse(raw);
  const text = (response.output ?? []).flatMap((item) => item.content ?? []).filter((item) => item.type === 'output_text').map((item) => item.text ?? '').join('');
  const toolCalls = (response.output ?? [])
    .filter((item) => item.type === 'function_call' && item.call_id && item.name)
    .map((item) => {
      let args: unknown = item.arguments ?? '';
      try { args = JSON.parse(item.arguments ?? ''); } catch { /* preserve malformed provider arguments for the caller */ }
      return { id: item.call_id!, name: item.name!, arguments: args };
    });
  return {
    output: { text, toolCalls, stopReason: response.status ?? null },
    usage: tokenUsage(response.usage?.input_tokens, response.usage?.output_tokens, response.usage?.total_tokens),
    providerId: PROVIDER_ID,
    modelId,
    externalModelId,
    rawResponse: raw,
  };
}

function mantleRequest(config: AwsBedrockMantleProviderConfig, modelId: string, body: string, signal?: AbortSignal): Promise<Response> {
  const host = `bedrock-mantle.${config.region}.api.aws`;
  const signed = signAwsRequest(config, 'bedrock-mantle', host, MANTLE_PATH, body, { accept: 'application/json', 'content-type': 'application/json' });
  return fetch(`https://${host}${MANTLE_PATH}`, {
    method: 'POST',
    headers: { ...signed.headers, authorization: signed.authorization },
    body,
    signal,
  });
}

async function executeMantle<TInput, TOutput>(config: AwsBedrockMantleProviderConfig, request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
  const input = chatInputSchema.parse(request.input);
  const body = JSON.stringify({ model: request.externalModelId, ...buildResponseInput(input), store: false });
  const response = await mantleRequest(config, request.externalModelId, body, resolveRequestSignal(request));
  if (!response.ok) throw new ProviderError(PROVIDER_ID, providerErrorCodeForStatus(response.status), `aws-bedrock-mantle request failed with status ${response.status}`, { status: response.status });
  return normalizeResponse(await response.json(), request.modelId, request.externalModelId) as ProviderExecuteResponse<TOutput>;
}

function parseSseEvents(buffer: string): { events: Array<{ event: string; data: string }>; remainder: string } {
  const events: Array<{ event: string; data: string }> = [];
  const records = buffer.split('\n\n');
  const remainder = records.pop() ?? '';
  for (const record of records) {
    let event = RESPONSE_EVENT;
    const data: string[] = [];
    for (const line of record.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return { events, remainder };
}

async function* streamMantle(config: AwsBedrockMantleProviderConfig, request: ProviderExecuteRequest<unknown>): AsyncIterable<ProviderStreamChunk> {
  const input = chatInputSchema.parse(request.input);
  const body = JSON.stringify({ model: request.externalModelId, ...buildResponseInput(input), store: false, stream: true });
  const response = await mantleRequest(config, request.externalModelId, body, resolveRequestSignal(request));
  if (!response.ok) throw new ProviderError(PROVIDER_ID, providerErrorCodeForStatus(response.status), `aws-bedrock-mantle request failed with status ${response.status}`, { status: response.status });
  if (!response.body) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'aws-bedrock-mantle returned no response stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawText = false;
  try {
    while (true) {
      const next = await reader.read();
      buffer += decoder.decode(next.value, { stream: !next.done });
      const parsed = parseSseEvents(buffer);
      buffer = parsed.remainder;
      for (const event of parsed.events) {
        if (event.data === '[DONE]') continue;
        const data = JSON.parse(event.data) as Record<string, unknown>;
        if (event.event === 'response.output_text.delta') {
          const text = typeof data.delta === 'string' ? data.delta : '';
          if (text) { sawText = true; yield { type: 'text-delta', text }; }
        } else if (event.event === 'response.completed') {
          const usage = z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional(), total_tokens: z.number().optional() }).passthrough().safeParse(data.response && typeof data.response === 'object' ? (data.response as Record<string, unknown>).usage : undefined);
          if (usage.success) yield { type: 'usage', usage: tokenUsage(usage.data.input_tokens, usage.data.output_tokens, usage.data.total_tokens) };
        } else if (event.event === 'error' || event.event === 'response.failed') {
          throw new ProviderError(PROVIDER_ID, 'provider_unavailable', 'aws-bedrock-mantle stream failed');
        }
      }
      if (next.done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (!sawText) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'aws-bedrock-mantle returned an empty text stream');
  yield { type: 'done' };
}

export function createAwsBedrockMantleProvider(config?: Partial<AwsBedrockMantleProviderConfig>, env?: AwsCredentialEnvironment): ProviderAdapter {
  const parsed = resolveAwsCredentials({ region: config?.region ?? 'us-east-1', accessKeyId: config?.accessKeyId, secretAccessKey: config?.secretAccessKey }, env);
  return {
    id: PROVIDER_ID,
    name: 'AWS Bedrock Mantle',
    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) {
      try {
        if (!CHAT_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
        return await executeMantle<TInput, TOutput>(parsed, request);
      } catch (error) { throw normalizeProviderError(PROVIDER_ID, error); }
    },
    stream(request) {
      if (!CHAT_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
      return streamMantle(parsed, request);
    },
  };
}

export const awsBedrockMantleProviderFactory: ProviderFactory = {
  id: PROVIDER_ID,
  configSchema: awsBedrockMantleProviderConfigSchema,
  create(config) { return createAwsBedrockMantleProvider(awsBedrockMantleProviderConfigSchema.parse(config)); },
};

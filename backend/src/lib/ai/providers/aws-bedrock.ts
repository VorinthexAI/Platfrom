import { BedrockRuntimeClient, ConverseStreamCommand, type ConverseStreamCommandInput, type ConverseStreamCommandOutput, type ConverseStreamOutput } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { z } from 'zod';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { awsCredentialsSchema, resolveAwsCredentials, signAwsRequest, type AwsCredentialEnvironment } from './aws-sigv4';
import { normalizeProviderError, ProviderError, providerErrorCodeForStatus } from './errors';
import { CHAT_ACTION_IDS, unsupportedAction } from './openai-compatible';
import {
  chatInputSchema,
  embeddingInputSchema,
  resolveRequestSignal,
  type ChatInput,
  type ChatOutput,
  type EmbeddingOutput,
  type ProviderAdapter,
  type ProviderEmbedRequest,
  type ProviderEmbedResponse,
  type ProviderExecuteRequest,
  type ProviderExecuteResponse,
  type ProviderFactory,
  type ProviderStreamChunk,
} from './types';

export const awsBedrockProviderConfigSchema = awsCredentialsSchema;
export type AwsBedrockProviderConfig = z.infer<typeof awsBedrockProviderConfigSchema>;
export const awsBedrockCredentialsSchema = awsBedrockProviderConfigSchema;
export type AwsBedrockCredentials = AwsBedrockProviderConfig;

const PROVIDER_ID = 'aws-bedrock' as const;
const BEDROCK_TEXT_MODEL_IDS = new Set([
  'amazon.nova-premier-v1:0',
  'amazon.nova-pro-v1:0',
  'amazon.nova-2-lite-v1:0',
]);
const converseResponseSchema = z.object({ output: z.object({ message: z.object({ content: z.array(z.object({ text: z.string().optional() }).passthrough()).optional() }).passthrough().optional() }), usage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional(), totalTokens: z.number().optional() }).passthrough().optional(), stopReason: z.string().optional() });
const embeddingResponseSchema = z.object({ embedding: z.array(z.number().finite()).min(1), inputTextTokenCount: z.number().optional() }).passthrough();

function buildConverseInput(input: ChatInput): Omit<ConverseStreamCommandInput, 'modelId'> {
  const messages: NonNullable<ConverseStreamCommandInput['messages']> = [];
  const systemParts: string[] = input.systemPrompt ? [input.systemPrompt] : [];
  if (input.tools?.length) throw new ProviderError(PROVIDER_ID, 'unsupported_action', 'AWS Bedrock adapter does not support core.chat tools');
  for (const message of input.messages) {
    const text = message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    if (!text || message.content.some((part) => part.type !== 'text')) throw new ProviderError(PROVIDER_ID, 'unsupported_action', 'AWS Bedrock adapter does not support non-text core.chat content');
    if (message.role === 'system') { systemParts.push(text); continue; }
    if (message.role === 'tool') throw new ProviderError(PROVIDER_ID, 'unsupported_action', 'AWS Bedrock adapter does not support core.chat tool-result messages');
    messages.push({ role: message.role, content: [{ text }] });
  }
  const request: Omit<ConverseStreamCommandInput, 'modelId'> = { messages };
  if (systemParts.length > 0) request.system = systemParts.map((text) => ({ text }));
  const inferenceConfig: NonNullable<ConverseStreamCommandInput['inferenceConfig']> = {};
  if (input.options?.maxTokens !== undefined) inferenceConfig.maxTokens = input.options.maxTokens;
  if (input.options?.temperature !== undefined) inferenceConfig.temperature = Math.min(input.options.temperature, 1);
  if (Object.keys(inferenceConfig).length > 0) request.inferenceConfig = inferenceConfig;
  return request;
}

type BedrockStreamClient = {
  send(command: ConverseStreamCommand, options?: { abortSignal?: AbortSignal }): Promise<ConverseStreamCommandOutput>;
  destroy(): void;
};

type BedrockStreamClientFactory = (requestTimeout: number) => BedrockStreamClient;

function streamException(event: ConverseStreamOutput): ProviderError | undefined {
  if (event.validationException) return new ProviderError(PROVIDER_ID, 'invalid_input', 'aws-bedrock stream rejected the request', { cause: event.validationException });
  if (event.throttlingException) return new ProviderError(PROVIDER_ID, 'rate_limited', 'aws-bedrock stream was rate limited', { cause: event.throttlingException });
  const unavailable = event.internalServerException ?? event.modelStreamErrorException ?? event.serviceUnavailableException;
  if (unavailable) return new ProviderError(PROVIDER_ID, 'provider_unavailable', 'aws-bedrock stream failed', { cause: unavailable });
  if (event.$unknown) return new ProviderError(PROVIDER_ID, 'response_invalid', 'aws-bedrock returned an unknown stream event');
  return undefined;
}

async function invoke(config: AwsBedrockProviderConfig, externalModelId: string, body: string, signal?: AbortSignal): Promise<unknown> {
  const host = `bedrock-runtime.${config.region}.amazonaws.com`;
  const path = `/model/${encodeURIComponent(externalModelId)}/invoke`;
  const signed = signAwsRequest(config, 'bedrock', host, path, body, { 'content-type': 'application/json', accept: 'application/json' });
  const response = await fetch(`https://${host}${path}`, { method: 'POST', headers: { ...signed.headers, authorization: signed.authorization }, body, signal });
  if (!response.ok) throw new ProviderError(PROVIDER_ID, providerErrorCodeForStatus(response.status), `aws-bedrock request failed with status ${response.status}`, { status: response.status });
  return response.json();
}

async function embed(config: AwsBedrockProviderConfig, request: ProviderEmbedRequest): Promise<ProviderEmbedResponse> {
  try {
    const inputs = typeof request.input === 'string' ? [request.input] : request.input;
    const rawResponses = await Promise.all(inputs.map(async (input) => invoke(config, request.externalModelId, JSON.stringify({ inputText: input, ...(request.dimensions ? { dimensions: request.dimensions } : {}) }), resolveRequestSignal(request))));
    const parsed = rawResponses.map((raw) => embeddingResponseSchema.parse(raw));
    return { embeddings: parsed.map(({ embedding }) => embedding), usage: tokenUsage(parsed.reduce((sum, item) => sum + (item.inputTextTokenCount ?? 0), 0), 0), providerId: PROVIDER_ID, externalModelId: request.externalModelId, rawResponse: rawResponses };
  } catch (error) { throw normalizeProviderError(PROVIDER_ID, error); }
}

export function createAwsBedrockProvider(config?: Partial<AwsBedrockProviderConfig>, env?: AwsCredentialEnvironment, createStreamClient?: BedrockStreamClientFactory): ProviderAdapter {
  const parsed = resolveAwsCredentials(config, env);
  const streamClientFactory = createStreamClient ?? ((requestTimeout) => new BedrockRuntimeClient({
    region: parsed.region,
    credentials: { accessKeyId: parsed.accessKeyId, secretAccessKey: parsed.secretAccessKey },
    endpoint: `https://bedrock-runtime.${parsed.region}.amazonaws.com`,
    requestHandler: new NodeHttpHandler({ requestTimeout, connectionTimeout: requestTimeout }),
  }));
  return {
    id: PROVIDER_ID,
    name: 'AWS Bedrock',
    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
      try {
        if (request.actionId === 'embed') {
          const input = embeddingInputSchema.parse(request.input);
          const result = await embed(parsed, { externalModelId: request.externalModelId, input: input.text, timeoutMs: request.timeoutMs, signal: request.signal });
          const output: EmbeddingOutput = { embedding: result.embeddings[0]! };
          return { output: output as TOutput, usage: result.usage, providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: result.rawResponse };
        }
        if (!CHAT_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
        const input = chatInputSchema.parse(request.input);
        const host = `bedrock-runtime.${parsed.region}.amazonaws.com`;
        const path = `/model/${encodeURIComponent(request.externalModelId)}/converse`;
        const body = JSON.stringify(buildConverseInput(input));
        const signed = signAwsRequest(parsed, 'bedrock', host, path, body, { 'content-type': 'application/json' });
        const response = await fetch(`https://${host}${path}`, { method: 'POST', headers: { ...signed.headers, authorization: signed.authorization }, body, signal: resolveRequestSignal(request) });
        if (!response.ok) throw new ProviderError(PROVIDER_ID, providerErrorCodeForStatus(response.status), `aws-bedrock request failed with status ${response.status}`, { status: response.status });
        const raw = await response.json();
        const result = converseResponseSchema.parse(raw);
        const output: ChatOutput = { text: (result.output.message?.content ?? []).map((block) => block.text ?? '').join(''), toolCalls: [], stopReason: result.stopReason ?? null };
        return { output: output as TOutput, usage: tokenUsage(result.usage?.inputTokens, result.usage?.outputTokens, result.usage?.totalTokens), providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: raw };
      } catch (error) { throw normalizeProviderError(PROVIDER_ID, error); }
    },
    async *stream<TInput>(request: ProviderExecuteRequest<TInput>): AsyncIterable<ProviderStreamChunk> {
      let client: BedrockStreamClient | undefined;
      try {
        if (!CHAT_ACTION_IDS.has(request.actionId) || !BEDROCK_TEXT_MODEL_IDS.has(request.externalModelId)) throw unsupportedAction(PROVIDER_ID, 'stream');
        const input = chatInputSchema.parse(request.input);
        client = streamClientFactory(request.timeoutMs ?? 300_000);
        const response = await client.send(new ConverseStreamCommand({ modelId: request.externalModelId, ...buildConverseInput(input) }), { abortSignal: resolveRequestSignal(request) });
        if (!response.stream) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'aws-bedrock returned no event stream');
        let sawText = false;
        for await (const event of response.stream) {
          const exception = streamException(event);
          if (exception) throw exception;
          const text = event.contentBlockDelta?.delta?.text;
          if (text) yield { type: 'text-delta' as const, text };
          if (text) sawText = true;
          const usage = event.metadata?.usage;
          if (usage) yield { type: 'usage', usage: tokenUsage(usage.inputTokens, usage.outputTokens, usage.totalTokens) };
        }
        if (!sawText) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'aws-bedrock returned an empty text stream');
        yield { type: 'done' };
      } catch (error) {
        throw normalizeProviderError(PROVIDER_ID, error);
      } finally {
        client?.destroy();
      }
    },
    embed(request) { return embed(parsed, request); },
  };
}

export const awsBedrockProviderFactory: ProviderFactory = { id: PROVIDER_ID, configSchema: awsBedrockProviderConfigSchema, create(config) { return createAwsBedrockProvider(awsBedrockProviderConfigSchema.parse(config)); } };

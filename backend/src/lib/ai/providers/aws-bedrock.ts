import { z } from 'zod';
import { tokenUsage, ZERO_TOKEN_USAGE } from '@/lib/ai/shared/usage';
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
} from './types';

export const awsBedrockProviderConfigSchema = awsCredentialsSchema;
export type AwsBedrockProviderConfig = z.infer<typeof awsBedrockProviderConfigSchema>;
export const awsBedrockCredentialsSchema = awsBedrockProviderConfigSchema;
export type AwsBedrockCredentials = AwsBedrockProviderConfig;

const PROVIDER_ID = 'aws-bedrock' as const;
const converseResponseSchema = z.object({ output: z.object({ message: z.object({ content: z.array(z.object({ text: z.string().optional() }).passthrough()).optional() }).passthrough().optional() }), usage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional(), totalTokens: z.number().optional() }).passthrough().optional(), stopReason: z.string().optional() });
const embeddingResponseSchema = z.object({ embedding: z.array(z.number().finite()).min(1), inputTextTokenCount: z.number().optional() }).passthrough();

function buildConverseBody(input: ChatInput): string {
  const messages: Array<{ role: 'user' | 'assistant'; content: Array<{ text: string }> }> = [];
  const systemParts: string[] = input.systemPrompt ? [input.systemPrompt] : [];
  for (const message of input.messages) {
    if (message.role === 'system') { systemParts.push(message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')); continue; }
    if (message.role === 'tool') throw new ProviderError(PROVIDER_ID, 'unsupported_action', 'AWS Bedrock adapter does not support core.chat tool-result messages');
    const text = message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    if (!text || message.content.some((part) => part.type !== 'text')) throw new ProviderError(PROVIDER_ID, 'unsupported_action', 'AWS Bedrock adapter does not support non-text core.chat content');
    messages.push({ role: message.role, content: [{ text }] });
  }
  const body: Record<string, unknown> = { messages };
  if (systemParts.length > 0) body.system = systemParts.map((text) => ({ text }));
  const inferenceConfig: Record<string, unknown> = {};
  if (input.options?.maxTokens !== undefined) inferenceConfig.maxTokens = input.options.maxTokens;
  if (input.options?.temperature !== undefined) inferenceConfig.temperature = Math.min(input.options.temperature, 1);
  if (Object.keys(inferenceConfig).length > 0) body.inferenceConfig = inferenceConfig;
  return JSON.stringify(body);
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

export function createAwsBedrockProvider(config?: Partial<AwsBedrockProviderConfig>, env?: AwsCredentialEnvironment): ProviderAdapter {
  const parsed = resolveAwsCredentials(config, env);
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
        const body = buildConverseBody(input);
        const signed = signAwsRequest(parsed, 'bedrock', host, path, body, { 'content-type': 'application/json' });
        const response = await fetch(`https://${host}${path}`, { method: 'POST', headers: { ...signed.headers, authorization: signed.authorization }, body, signal: resolveRequestSignal(request) });
        if (!response.ok) throw new ProviderError(PROVIDER_ID, providerErrorCodeForStatus(response.status), `aws-bedrock request failed with status ${response.status}`, { status: response.status });
        const raw = await response.json();
        const result = converseResponseSchema.parse(raw);
        const output: ChatOutput = { text: (result.output.message?.content ?? []).map((block) => block.text ?? '').join(''), toolCalls: [], stopReason: result.stopReason ?? null };
        return { output: output as TOutput, usage: tokenUsage(result.usage?.inputTokens, result.usage?.outputTokens, result.usage?.totalTokens), providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: raw };
      } catch (error) { throw normalizeProviderError(PROVIDER_ID, error); }
    },
    embed(request) { return embed(parsed, request); },
  };
}

export const awsBedrockProviderFactory: ProviderFactory = { id: PROVIDER_ID, configSchema: awsBedrockProviderConfigSchema, create(config) { return createAwsBedrockProvider(awsBedrockProviderConfigSchema.parse(config)); } };

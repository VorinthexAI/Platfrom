import { BedrockRuntimeClient, ConverseStreamCommand, type ContentBlock, type ConverseStreamCommandInput, type ConverseStreamCommandOutput, type ConverseStreamOutput, type Tool } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import type { DocumentType } from '@smithy/types';
import { z } from 'zod';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { awsCredentialsSchema, resolveAwsCredentials, signAwsRequest, type AwsCredentialEnvironment } from './aws-sigv4';
import { normalizeProviderError, ProviderError, providerErrorCodeForStatus } from './errors';
import { acceptsChatInput, unsupportedAction } from './openai-compatible';
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
const converseResponseSchema = z.object({ output: z.object({ message: z.object({ content: z.array(z.object({ text: z.string().optional(), toolUse: z.object({ toolUseId: z.string().min(1), name: z.string().min(1), input: z.unknown() }).optional() }).passthrough()).optional() }).passthrough().optional() }), usage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional(), totalTokens: z.number().optional() }).passthrough().optional(), stopReason: z.string().optional() });
const embeddingResponseSchema = z.object({ embedding: z.array(z.number().finite()).min(1), inputTextTokenCount: z.number().optional() }).passthrough();
const documentValue = (value: unknown) => value as DocumentType;

function buildConverseInput(input: ChatInput): Omit<ConverseStreamCommandInput, 'modelId'> {
  const messages: NonNullable<ConverseStreamCommandInput['messages']> = [];
  const systemParts: string[] = input.systemPrompt ? [input.systemPrompt] : [];
  for (const message of input.messages) {
    if (message.role === 'system') {
      const text = message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
      if (!text || message.content.some((part) => part.type !== 'text')) throw new ProviderError(PROVIDER_ID, 'unsupported_action', 'AWS Bedrock adapter supports text-only system messages');
      systemParts.push(text);
      continue;
    }
    const content = message.content.map((part): ContentBlock => {
      if (part.type === 'text') return { text: part.text };
      if (part.type === 'tool-call' && message.role === 'assistant') return { toolUse: { toolUseId: part.toolCallId, name: part.name, input: documentValue(part.arguments) } };
      if (part.type === 'tool-result' && message.role === 'tool') return { toolResult: { toolUseId: part.toolCallId, content: [{ json: documentValue(part.result) }], status: 'success' } };
      throw new ProviderError(PROVIDER_ID, 'unsupported_action', 'AWS Bedrock adapter received unsupported core.chat content');
    });
    messages.push({ role: message.role === 'tool' ? 'user' : message.role, content });
  }
  const request: Omit<ConverseStreamCommandInput, 'modelId'> = { messages };
  if (systemParts.length > 0) request.system = systemParts.map((text) => ({ text }));
  const inferenceConfig: NonNullable<ConverseStreamCommandInput['inferenceConfig']> = {};
  if (input.options?.maxTokens !== undefined) inferenceConfig.maxTokens = input.options.maxTokens;
  if (input.options?.temperature !== undefined) inferenceConfig.temperature = Math.min(input.options.temperature, 1);
  if (Object.keys(inferenceConfig).length > 0) request.inferenceConfig = inferenceConfig;
  if (input.tools?.length) request.toolConfig = { tools: input.tools.map((tool): Tool => ({ toolSpec: { name: tool.name, ...(tool.description ? { description: tool.description } : {}), inputSchema: { json: documentValue(tool.inputSchema) } } })) };
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
  const requestPath = `/model/${externalModelId}/invoke`;
  const canonicalPath = `/model/${encodeURIComponent(externalModelId)}/invoke`;
  const signed = signAwsRequest(config, 'bedrock', host, canonicalPath, body, { 'content-type': 'application/json', accept: 'application/json' });
  const response = await fetch(`https://${host}${requestPath}`, { method: 'POST', headers: { ...signed.headers, authorization: signed.authorization }, body, signal });
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
  const source = env ?? process.env;
  const parsed = resolveAwsCredentials(config, {
    ...source,
    AWS_REGION: source.BEDROCK_REGION ?? source.AWS_REGION,
    AWS_ACCESS_KEY_ID: source.BEDROCK_AWS_ACCESS_KEY_ID ?? source.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: source.BEDROCK_AWS_SECRET_ACCESS_KEY ?? source.AWS_SECRET_ACCESS_KEY,
  });
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
        if (!acceptsChatInput(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
        const input = chatInputSchema.parse(request.input);
        const host = `bedrock-runtime.${parsed.region}.amazonaws.com`;
        const requestPath = `/model/${request.externalModelId}/converse`;
        const canonicalPath = `/model/${encodeURIComponent(request.externalModelId)}/converse`;
        const body = JSON.stringify(buildConverseInput(input));
        const signed = signAwsRequest(parsed, 'bedrock', host, canonicalPath, body, { 'content-type': 'application/json' });
        const response = await fetch(`https://${host}${requestPath}`, { method: 'POST', headers: { ...signed.headers, authorization: signed.authorization }, body, signal: resolveRequestSignal(request) });
        if (!response.ok) throw new ProviderError(PROVIDER_ID, providerErrorCodeForStatus(response.status), `aws-bedrock request failed with status ${response.status}`, { status: response.status });
        const raw = await response.json();
        const result = converseResponseSchema.parse(raw);
        const blocks = result.output.message?.content ?? [];
        const output: ChatOutput = {
          text: blocks.map((block) => block.text ?? '').join(''),
          toolCalls: blocks.flatMap((block) => block.toolUse ? [{ id: block.toolUse.toolUseId, name: block.toolUse.name, arguments: block.toolUse.input }] : []),
          stopReason: result.stopReason ?? null,
        };
        return { output: output as TOutput, usage: tokenUsage(result.usage?.inputTokens, result.usage?.outputTokens, result.usage?.totalTokens), providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: raw };
      } catch (error) { throw normalizeProviderError(PROVIDER_ID, error); }
    },
    async *stream<TInput>(request: ProviderExecuteRequest<TInput>): AsyncIterable<ProviderStreamChunk> {
      let client: BedrockStreamClient | undefined;
      try {
        if (!acceptsChatInput(request.actionId)) throw unsupportedAction(PROVIDER_ID, 'stream');
        const input = chatInputSchema.parse(request.input);
        if (input.tools?.length || input.messages.some((message) => message.content.some((part) => part.type === 'tool-call' || part.type === 'tool-result'))) throw new ProviderError(PROVIDER_ID, 'unsupported_action', 'AWS Bedrock streaming does not support tools');
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

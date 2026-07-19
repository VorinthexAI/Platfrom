import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { normalizeProviderError, ProviderError, providerErrorCodeForStatus } from './errors';
import { CHAT_ACTION_IDS, unsupportedAction } from './openai-compatible';
import {
  chatInputSchema,
  resolveRequestSignal,
  type ChatInput,
  type ChatOutput,
  type ProviderAdapter,
  type ProviderExecuteRequest,
  type ProviderExecuteResponse,
  type ProviderFactory,
} from './types';

/**
 * AWS Bedrock over the model-agnostic Converse REST API, signed with SigV4
 * directly (no @aws-sdk/client-bedrock-runtime dependency). Credentials are
 * supplied explicitly by the caller for each adapter creation.
 */
export const awsBedrockProviderConfigSchema = z
  .object({
    region: z.string().min(1),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
  })
  .strict();

export type AwsBedrockProviderConfig = z.infer<typeof awsBedrockProviderConfigSchema>;
export const awsBedrockCredentialsSchema = awsBedrockProviderConfigSchema;
export type AwsBedrockCredentials = AwsBedrockProviderConfig;

const PROVIDER_ID = 'aws-bedrock' as const;

const converseResponseSchema = z.object({
  output: z.object({
    message: z
      .object({
        content: z.array(z.object({ text: z.string().optional() }).passthrough()).optional(),
      })
      .passthrough()
      .optional(),
  }),
  usage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      totalTokens: z.number().optional(),
    })
    .passthrough()
    .optional(),
  stopReason: z.string().optional(),
});

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/** AWS Signature Version 4 for a Bedrock runtime POST with a JSON body. */
function signBedrockRequest(config: AwsBedrockProviderConfig, path: string, body: string, now: Date): SignedRequest {
  const service = 'bedrock';
  const host = `bedrock-runtime.${config.region}.amazonaws.com`;
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headerEntries: Array<[string, string]> = [
    ['content-type', 'application/json'],
    ['host', host],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', amzDate],
  ];
  headerEntries.sort(([a], [b]) => (a < b ? -1 : 1));

  const canonicalHeaders = headerEntries.map(([name, value]) => `${name}:${value}\n`).join('');
  const signedHeaders = headerEntries.map(([name]) => name).join(';');
  const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${config.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const headers: Record<string, string> = Object.fromEntries(headerEntries.filter(([name]) => name !== 'host'));
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: `https://${host}${path}`, headers };
}

function buildConverseBody(input: ChatInput): string {
  const messages: Array<{ role: 'user' | 'assistant'; content: Array<{ text: string }> }> = [];
  const systemParts: string[] = input.systemPrompt ? [input.systemPrompt] : [];
  for (const message of input.messages) {
    if (message.role === 'system') {
      systemParts.push(message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n'));
      continue;
    }
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

export function createAwsBedrockProvider(config: AwsBedrockProviderConfig): ProviderAdapter {
  const parsed = awsBedrockProviderConfigSchema.parse(config);

  return {
    id: PROVIDER_ID,
    name: 'AWS Bedrock',

    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
      if (!CHAT_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
      const input = chatInputSchema.parse(request.input);
      const path = `/model/${encodeURIComponent(request.externalModelId)}/converse`;
      const body = buildConverseBody(input);
      const signed = signBedrockRequest(parsed, path, body, new Date());
      try {
        const response = await fetch(signed.url, {
          method: 'POST',
          headers: signed.headers,
          body,
          signal: resolveRequestSignal(request),
        });
        if (!response.ok) {
          throw new ProviderError(
            PROVIDER_ID,
            providerErrorCodeForStatus(response.status),
            `aws-bedrock request failed with status ${response.status}`,
            { status: response.status },
          );
        }
        const raw: unknown = await response.json();
        const parsedResponse = converseResponseSchema.parse(raw);
        const text = (parsedResponse.output.message?.content ?? [])
          .map((block) => block.text ?? '')
          .join('');
        const output: ChatOutput = { text, toolCalls: [], stopReason: parsedResponse.stopReason ?? null };
        return {
          output: output as TOutput,
          usage: tokenUsage(parsedResponse.usage?.inputTokens, parsedResponse.usage?.outputTokens, parsedResponse.usage?.totalTokens),
          providerId: PROVIDER_ID,
          modelId: request.modelId,
          externalModelId: request.externalModelId,
          rawResponse: raw,
        };
      } catch (err) {
        throw normalizeProviderError(PROVIDER_ID, err);
      }
    },
  };
}

export const awsBedrockProviderFactory: ProviderFactory = {
  id: PROVIDER_ID,
  configSchema: awsBedrockProviderConfigSchema,
  create(config) {
    return createAwsBedrockProvider(awsBedrockProviderConfigSchema.parse(config));
  },
};

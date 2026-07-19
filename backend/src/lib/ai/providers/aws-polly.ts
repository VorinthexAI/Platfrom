import { z } from 'zod';
import { ZERO_TOKEN_USAGE } from '@/lib/ai/shared/usage';
import { awsCredentialsSchema, signAwsRequest } from './aws-sigv4';
import { normalizeProviderError, ProviderError, providerErrorCodeForStatus } from './errors';
import { unsupportedAction } from './openai-compatible';
import { resolveRequestSignal, speechInputSchema, type ProviderAdapter, type ProviderExecuteRequest, type ProviderExecuteResponse, type ProviderFactory, type SpeechOutput } from './types';

export const awsPollyProviderConfigSchema = awsCredentialsSchema;
export type AwsPollyProviderConfig = z.infer<typeof awsPollyProviderConfigSchema>;
export const awsPollyCredentialsSchema = awsPollyProviderConfigSchema;
export type AwsPollyCredentials = AwsPollyProviderConfig;
const PROVIDER_ID = 'aws-polly' as const;

export function createAwsPollyProvider(config: AwsPollyProviderConfig): ProviderAdapter {
  const parsed = awsPollyProviderConfigSchema.parse(config);
  return {
    id: PROVIDER_ID,
    name: 'AWS Polly',
    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
      if (request.actionId !== 'core.speak') throw unsupportedAction(PROVIDER_ID, request.actionId);
      try {
        const input = speechInputSchema.parse(request.input);
        const host = `polly.${parsed.region}.amazonaws.com`;
        const path = '/v1/speech';
        const body = JSON.stringify({ Text: input.text, VoiceId: input.voice === 'alloy' ? 'Joanna' : input.voice, OutputFormat: input.format, Engine: request.externalModelId || 'generative' });
        const signed = signAwsRequest(parsed, 'polly', host, path, body, { 'content-type': 'application/json' });
        const response = await fetch(`https://${host}${path}`, { method: 'POST', headers: { ...signed.headers, authorization: signed.authorization }, body, signal: resolveRequestSignal(request) });
        if (!response.ok) throw new ProviderError(PROVIDER_ID, providerErrorCodeForStatus(response.status), `aws-polly request failed with status ${response.status}`, { status: response.status });
        const output: SpeechOutput = { audioBase64: Buffer.from(await response.arrayBuffer()).toString('base64'), mimeType: input.format === 'wav' ? 'audio/wav' : 'audio/mpeg' };
        return { output: output as TOutput, usage: ZERO_TOKEN_USAGE, providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: { contentType: response.headers.get('content-type') } };
      } catch (error) { throw normalizeProviderError(PROVIDER_ID, error); }
    },
  };
}

export const awsPollyProviderFactory: ProviderFactory = { id: PROVIDER_ID, configSchema: awsPollyProviderConfigSchema, create(config) { return createAwsPollyProvider(awsPollyProviderConfigSchema.parse(config)); } };

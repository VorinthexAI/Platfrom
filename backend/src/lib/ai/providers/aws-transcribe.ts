import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { s3, S3_BUCKET } from '@/lib/s3';
import { ZERO_TOKEN_USAGE } from '@/lib/ai/shared/usage';
import { awsCredentialsSchema, resolveAwsCredentials, signAwsRequest, type AwsCredentialEnvironment } from './aws-sigv4';
import { normalizeProviderError, ProviderError, providerErrorCodeForStatus } from './errors';
import { unsupportedAction } from './openai-compatible';
import { resolveRequestSignal, transcribeInputSchema, type ProviderAdapter, type ProviderExecuteRequest, type ProviderExecuteResponse, type ProviderFactory, type TranscriptionOutput } from './types';

export const awsTranscribeProviderConfigSchema = awsCredentialsSchema;
export type AwsTranscribeProviderConfig = z.infer<typeof awsTranscribeProviderConfigSchema>;
export const awsTranscribeCredentialsSchema = awsTranscribeProviderConfigSchema;
export type AwsTranscribeCredentials = AwsTranscribeProviderConfig;
const PROVIDER_ID = 'aws-transcribe' as const;
const jobSchema = z.object({ TranscriptionJob: z.object({ TranscriptionJobStatus: z.enum(['COMPLETED', 'FAILED', 'IN_PROGRESS', 'QUEUED']), Transcript: z.object({ TranscriptFileUri: z.string().url() }).optional(), FailureReason: z.string().optional() }) });
const transcriptSchema = z.object({ results: z.object({ transcripts: z.array(z.object({ transcript: z.string() })).min(1) }) });

const sleep = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => { const timeout = setTimeout(resolve, milliseconds); signal?.addEventListener('abort', () => { clearTimeout(timeout); reject(signal.reason); }, { once: true }); });

export function createAwsTranscribeProvider(config?: Partial<AwsTranscribeProviderConfig>, env?: AwsCredentialEnvironment): ProviderAdapter {
  const parsed = resolveAwsCredentials(config, env);
  return {
    id: PROVIDER_ID,
    name: 'AWS Transcribe',
    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
    if (request.actionId !== 'transcribe') throw unsupportedAction(PROVIDER_ID, request.actionId);
      const signal = resolveRequestSignal(request);
      const objectKey = `transcribe/${request.organizationKey}/${newId()}`;
      try {
        const input = transcribeInputSchema.parse(request.input);
        const bytes = Buffer.from(input.audioBase64, 'base64');
        if (bytes.length === 0) throw new ProviderError(PROVIDER_ID, 'invalid_input', 'audioBase64 must contain audio bytes');
        await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: objectKey, Body: bytes, ContentType: input.mimeType }));
        const host = `transcribe.${parsed.region}.amazonaws.com`;
        const jobName = `vorinthex-${newId()}`;
        const startBody = JSON.stringify({ TranscriptionJobName: jobName, Media: { MediaFileUri: `s3://${S3_BUCKET}/${objectKey}` }, MediaFormat: input.mimeType.split('/').at(-1), ...(input.language ? { LanguageCode: input.language } : {}) });
        const start = signAwsRequest(parsed, 'transcribe', host, '/', startBody, { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Transcribe.StartTranscriptionJob' });
        const started = await fetch(`https://${host}/`, { method: 'POST', headers: { ...start.headers, authorization: start.authorization }, body: startBody, signal });
        if (!started.ok) throw new ProviderError(PROVIDER_ID, providerErrorCodeForStatus(started.status), `aws-transcribe request failed with status ${started.status}`, { status: started.status });
        const deadline = Date.now() + (request.timeoutMs ?? 120_000);
        while (Date.now() < deadline) {
          await sleep(1_000, signal);
          const getBody = JSON.stringify({ TranscriptionJobName: jobName });
          const get = signAwsRequest(parsed, 'transcribe', host, '/', getBody, { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Transcribe.GetTranscriptionJob' });
          const result = await fetch(`https://${host}/`, { method: 'POST', headers: { ...get.headers, authorization: get.authorization }, body: getBody, signal });
          if (!result.ok) throw new ProviderError(PROVIDER_ID, providerErrorCodeForStatus(result.status), `aws-transcribe request failed with status ${result.status}`, { status: result.status });
          const job = jobSchema.parse(await result.json()).TranscriptionJob;
          if (job.TranscriptionJobStatus === 'FAILED') throw new ProviderError(PROVIDER_ID, 'provider_unavailable', job.FailureReason ?? 'AWS Transcribe job failed');
          if (job.TranscriptionJobStatus === 'COMPLETED' && job.Transcript?.TranscriptFileUri) {
            const transcript = transcriptSchema.parse(await (await fetch(job.Transcript.TranscriptFileUri, { signal })).json());
            const output: TranscriptionOutput = { text: transcript.results.transcripts.map(({ transcript: text }) => text).join('\n') };
            return { output: output as TOutput, usage: ZERO_TOKEN_USAGE, providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: job };
          }
        }
        throw new ProviderError(PROVIDER_ID, 'timeout', 'AWS Transcribe job timed out');
      } catch (error) { throw normalizeProviderError(PROVIDER_ID, error); }
      finally { await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: objectKey })).catch(() => undefined); }
    },
  };
}

export const awsTranscribeProviderFactory: ProviderFactory = { id: PROVIDER_ID, configSchema: awsTranscribeProviderConfigSchema, create(config) { return createAwsTranscribeProvider(awsTranscribeProviderConfigSchema.parse(config)); } };

import { z } from 'zod';
import { awsCredentialsSchema, signAwsRequest } from '@/lib/ai/providers/aws-sigv4';

export const EMBEDDING_PROVIDER_ID = 'aws-bedrock' as const;
export const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2';
export const BEDROCK_EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0';
export const EMBEDDING_CHUNK_CHARACTERS = 4_000;
const THROTTLE_MAX_ATTEMPTS = 10;
const THROTTLE_MAX_DELAY_MS = 60_000;
const EMBEDDING_REQUEST_INTERVAL_MS = 100;

const embedInputSchema = z.object({ text: z.string().min(1) }).strict();
const titanEmbeddingResponseSchema = z.object({ embedding: z.array(z.number().finite()).min(1) }).passthrough();
const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
let titanInvocationQueue: Promise<void> = Promise.resolve();

function serializeTitanInvocation<T>(invoke: () => Promise<T>): Promise<T> {
  const result = titanInvocationQueue.then(invoke, invoke);
  titanInvocationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function embeddingMetadata() {
  return { embeddingProvider: EMBEDDING_PROVIDER_ID, embeddingModel: EMBEDDING_MODEL } as const;
}

function getAwsCredentials() {
  const parsed = awsCredentialsSchema.safeParse({
    region: process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
    accessKeyId: process.env.BEDROCK_AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.BEDROCK_AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY,
  });
  return parsed.success ? parsed.data : null;
}

/** Generates fixed Titan embeddings from the application's AWS environment credentials. */
export async function embedText(input: z.infer<typeof embedInputSchema>): Promise<number[]> {
  const parsed = embedInputSchema.parse(input);
  const credentials = getAwsCredentials();
  if (!credentials) return [];

  const characters = [...parsed.text];
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += EMBEDDING_CHUNK_CHARACTERS) {
    chunks.push(characters.slice(index, index + EMBEDDING_CHUNK_CHARACTERS).join(''));
  }
  const host = `bedrock-runtime.${credentials.region}.amazonaws.com`;
  const path = `/model/${BEDROCK_EMBEDDING_MODEL_ID}/invoke`;
  // Bedrock URI-encodes the model separator while validating SigV4.
  const canonicalPath = `/model/${encodeURIComponent(BEDROCK_EMBEDDING_MODEL_ID)}/invoke`;
  const embeddings: number[][] = [];
  for (const inputText of chunks) {
    const body = JSON.stringify({ inputText });
    const embedding = await serializeTitanInvocation(async () => {
      for (let attempt = 0; attempt < THROTTLE_MAX_ATTEMPTS; attempt += 1) {
        const signed = signAwsRequest(credentials, 'bedrock', host, canonicalPath, body, { 'content-type': 'application/json', accept: 'application/json' });
        const response = await fetch(`https://${host}${path}`, { method: 'POST', headers: { ...signed.headers, authorization: signed.authorization }, body });
        if (response.ok) {
          const vector = titanEmbeddingResponseSchema.parse(await response.json()).embedding;
          await sleep(EMBEDDING_REQUEST_INTERVAL_MS);
          return vector;
        }
        if (response.status !== 429 || attempt === THROTTLE_MAX_ATTEMPTS - 1) {
          throw new Error(`AWS Bedrock Titan embedding request failed with status ${response.status}.`);
        }
        const retryAfter = Number(response.headers.get('retry-after'));
        const exponentialDelay = Math.min(1_000 * 2 ** attempt, THROTTLE_MAX_DELAY_MS);
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1_000
          : exponentialDelay + Math.random() * 1_000;
        await sleep(waitMs);
      }
      throw new Error('AWS Bedrock Titan embedding request retry loop ended unexpectedly.');
    });
    embeddings.push(embedding);
  }

  if (embeddings.length === 1) return embeddings[0]!;
  const dimensions = embeddings[0]!.length;
  if (embeddings.some((vector) => vector.length !== dimensions)) {
    throw new Error('AWS Bedrock Titan returned inconsistent vector dimensions.');
  }
  const averaged = Array.from({ length: dimensions }, (_, dimension) =>
    embeddings.reduce((sum, vector) => sum + vector[dimension]!, 0) / embeddings.length);
  const norm = Math.sqrt(averaged.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? averaged : averaged.map((value) => value / norm);
}

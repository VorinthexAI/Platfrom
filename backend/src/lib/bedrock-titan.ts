import { z } from 'zod';
import { awsCredentialsSchema, signAwsRequest } from '@/lib/ai/providers/aws-sigv4';

export const EMBEDDING_PROVIDER_ID = 'aws-bedrock' as const;
export const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2';
export const BEDROCK_EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0';
export const EMBEDDING_CHUNK_CHARACTERS = 4_000;
const THROTTLE_RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000, 60_000];

const embedInputSchema = z.object({ text: z.string().min(1) }).strict();
const titanEmbeddingResponseSchema = z.object({ embedding: z.array(z.number().finite()).min(1) }).passthrough();

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
    const signed = signAwsRequest(credentials, 'bedrock', host, canonicalPath, body, { 'content-type': 'application/json', accept: 'application/json' });
    let embedding: number[] | null = null;
    for (const retryDelay of [...THROTTLE_RETRY_DELAYS_MS, null]) {
      const response = await fetch(`https://${host}${path}`, { method: 'POST', headers: { ...signed.headers, authorization: signed.authorization }, body });
      if (response.ok) {
        embedding = titanEmbeddingResponseSchema.parse(await response.json()).embedding;
        break;
      }
      if (response.status !== 429 || retryDelay === null) {
        throw new Error(`AWS Bedrock Titan embedding request failed with status ${response.status}.`);
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1_000
        : retryDelay;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    if (!embedding) throw new Error('AWS Bedrock Titan embedding request retry loop ended unexpectedly.');
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

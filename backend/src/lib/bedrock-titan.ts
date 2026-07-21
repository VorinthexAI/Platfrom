import { z } from 'zod';
import { awsCredentialsSchema, signAwsRequest } from '@/lib/ai/providers/aws-sigv4';

export const EMBEDDING_PROVIDER_ID = 'aws-bedrock' as const;
export const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2';
export const BEDROCK_EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0';
export const EMBEDDING_CHUNK_CHARACTERS = 4_000;

const embedInputSchema = z.object({ text: z.string().min(1) }).strict();
const titanEmbeddingResponseSchema = z.object({ embedding: z.array(z.number().finite()).min(1) }).passthrough();

export function embeddingMetadata() {
  return { embeddingProvider: EMBEDDING_PROVIDER_ID, embeddingModel: EMBEDDING_MODEL } as const;
}

function getAwsCredentials() {
  const parsed = awsCredentialsSchema.safeParse({
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
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
  const path = `/model/${encodeURIComponent(BEDROCK_EMBEDDING_MODEL_ID)}/invoke`;
  const embeddings = await Promise.all(chunks.map(async (inputText) => {
    const body = JSON.stringify({ inputText });
    const signed = signAwsRequest(credentials, 'bedrock', host, path, body, { 'content-type': 'application/json', accept: 'application/json' });
    const response = await fetch(`https://${host}${path}`, { method: 'POST', headers: { ...signed.headers, authorization: signed.authorization }, body });
    if (!response.ok) throw new Error(`AWS Bedrock Titan embedding request failed with status ${response.status}.`);
    return titanEmbeddingResponseSchema.parse(await response.json()).embedding;
  }));

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

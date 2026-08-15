import {
  DetectDocumentTextCommand,
  GetDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommand,
  TextractClient,
  type Block,
} from '@aws-sdk/client-textract';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketEncryptionCommand,
  PutBucketLifecycleConfigurationCommand,
  PutPublicAccessBlockCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { S3_BUCKET } from '@/lib/s3';
import type { ExtractionResult } from './schemas';

function positiveLimit(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const documentTextractAccessKeyId = process.env.CONTENT_TEXTRACT_AWS_ACCESS_KEY_ID ?? process.env.BEDROCK_AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
const documentTextractSecretAccessKey = process.env.CONTENT_TEXTRACT_AWS_SECRET_ACCESS_KEY ?? process.env.BEDROCK_AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
const documentTextractSessionToken = process.env.CONTENT_TEXTRACT_AWS_SESSION_TOKEN ?? process.env.BEDROCK_AWS_SESSION_TOKEN ?? process.env.AWS_SESSION_TOKEN;
const documentTextractUsesAwsCredentials = Boolean(process.env.CONTENT_TEXTRACT_AWS_ACCESS_KEY_ID || process.env.BEDROCK_AWS_ACCESS_KEY_ID);
const documentTextractRegion = process.env.CONTENT_TEXTRACT_REGION ?? (documentTextractUsesAwsCredentials ? undefined : process.env.AWS_ENDPOINT_URL ? process.env.AWS_REGION : undefined) ?? 'eu-west-1';
const documentTextractEndpoint = process.env.CONTENT_TEXTRACT_ENDPOINT ?? (documentTextractUsesAwsCredentials ? `https://textract.${documentTextractRegion}.amazonaws.com` : process.env.AWS_ENDPOINT_URL);
const documentTextractStorageEndpoint = process.env.CONTENT_TEXTRACT_S3_ENDPOINT ?? (documentTextractUsesAwsCredentials ? `https://s3.${documentTextractRegion}.amazonaws.com` : process.env.AWS_ENDPOINT_URL);
const documentTextractCredentials = documentTextractAccessKeyId ? {
  accessKeyId: documentTextractAccessKeyId,
  secretAccessKey: documentTextractSecretAccessKey ?? '',
  ...(documentTextractSessionToken && documentTextractSessionToken !== 'undefined' ? { sessionToken: documentTextractSessionToken } : {}),
} : undefined;

const textract = new TextractClient({
  region: documentTextractRegion,
  endpoint: documentTextractEndpoint,
  credentials: documentTextractCredentials,
});

const textractStorage = new S3Client({
  region: documentTextractRegion,
  endpoint: documentTextractStorageEndpoint,
  forcePathStyle: !documentTextractUsesAwsCredentials && Boolean(documentTextractStorageEndpoint),
  credentials: documentTextractCredentials,
});

const documentTextractBucket = process.env.CONTENT_TEXTRACT_BUCKET;
const developmentTextractBucket = 'vorinthex-ai-dev-textract-938565868704-eu-west-1';
let developmentBucketReady: Promise<void> | undefined;

interface DocumentOcrOptions {
  textractClient?: Pick<TextractClient, 'send'>;
  storageClient?: Pick<S3Client, 'send'>;
  stagingBucket?: string;
  sourceBucket?: string;
}

function stagedDocumentKey(storageKey: string) {
  return `textract/${createHash('sha256').update(storageKey).digest('hex')}.pdf`;
}

async function ensureDevelopmentBucket(bucket: string) {
  if (process.env.NODE_ENV !== 'development' || !documentTextractUsesAwsCredentials) return;
  developmentBucketReady ??= (async () => {
    let exists = true;
    try {
      await textractStorage.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 404 && (error as { name?: string }).name !== 'NotFound') throw error;
      exists = false;
    }
    if (!exists) {
      try {
        await textractStorage.send(new CreateBucketCommand({
          Bucket: bucket,
          CreateBucketConfiguration: { LocationConstraint: 'eu-west-1' },
        }));
      } catch (error) {
        if ((error as { name?: string }).name !== 'BucketAlreadyOwnedByYou') throw error;
      }
    }
    const configure = async (send: () => Promise<unknown>) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await send();
          return;
        } catch (error) {
          if ((error as { name?: string }).name !== 'OperationAborted' || attempt >= 4) throw error;
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        }
      }
    };
    await configure(() => textractStorage.send(new PutPublicAccessBlockCommand({
      Bucket: bucket,
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    })));
    await configure(() => textractStorage.send(new PutBucketEncryptionCommand({
      Bucket: bucket,
      ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
    })));
    await configure(() => textractStorage.send(new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: { Rules: [{ ID: 'expire-textract-inputs', Status: 'Enabled', Filter: { Prefix: 'textract/' }, Expiration: { Days: 1 }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }] },
    })));
  })().catch((error) => {
    developmentBucketReady = undefined;
    throw error;
  });
  await developmentBucketReady;
}

const imageTextractAccessKeyId = process.env.CONTENT_SCAN_TEXTRACT_AWS_ACCESS_KEY_ID ?? process.env.BEDROCK_AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
const imageTextractSecretAccessKey = process.env.CONTENT_SCAN_TEXTRACT_AWS_SECRET_ACCESS_KEY ?? process.env.BEDROCK_AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
const imageTextractSessionToken = process.env.CONTENT_SCAN_TEXTRACT_AWS_SESSION_TOKEN ?? process.env.BEDROCK_AWS_SESSION_TOKEN ?? process.env.AWS_SESSION_TOKEN;
const imageTextractUsesAwsCredentials = Boolean(process.env.CONTENT_SCAN_TEXTRACT_AWS_ACCESS_KEY_ID || process.env.BEDROCK_AWS_ACCESS_KEY_ID);
const imageTextractRegion = process.env.CONTENT_SCAN_TEXTRACT_REGION ?? (imageTextractUsesAwsCredentials ? undefined : process.env.AWS_ENDPOINT_URL ? process.env.AWS_REGION : undefined) ?? 'eu-west-1';

const imageTextract = new TextractClient({
  region: imageTextractRegion,
  endpoint: process.env.CONTENT_SCAN_TEXTRACT_ENDPOINT ?? (imageTextractUsesAwsCredentials ? `https://textract.${imageTextractRegion}.amazonaws.com` : process.env.AWS_ENDPOINT_URL),
  credentials: imageTextractAccessKeyId ? {
    accessKeyId: imageTextractAccessKeyId,
    secretAccessKey: imageTextractSecretAccessKey ?? '',
    ...(imageTextractSessionToken && imageTextractSessionToken !== 'undefined' ? { sessionToken: imageTextractSessionToken } : {}),
  } : undefined,
});

const wait = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason);
  const timeout = setTimeout(done, milliseconds);
  function done() {
    signal.removeEventListener('abort', aborted);
    resolve();
  }
  function aborted() {
    clearTimeout(timeout);
    reject(signal.reason);
  }
  signal.addEventListener('abort', aborted, { once: true });
});

export interface DocumentOcr {
  extract(storageKey: string, bytes?: Uint8Array): Promise<ExtractionResult>;
}

export interface DocumentImageOcr {
  extract(storageKey: string, bytes: Uint8Array): Promise<ExtractionResult>;
}

export function textractBlocksToExtractionResult(blocks: Block[]): ExtractionResult {
  const uniqueLines = [...new Map(blocks.filter((block) => block.BlockType === 'LINE' && block.Text?.trim()).map((block, index) => [block.Id ?? `anonymous-${index}`, block])).values()];
  const pages = new Map<number, Block[]>();
  for (const line of uniqueLines) {
    const pageLines = pages.get(line.Page ?? 1) ?? [];
    pageLines.push(line);
    pages.set(line.Page ?? 1, pageLines);
  }
  const extractedText = [...pages.entries()].sort(([left], [right]) => left - right).map(([, pageLines]) => pageLines
    .sort((left, right) => (left.Geometry?.BoundingBox?.Top ?? 0) - (right.Geometry?.BoundingBox?.Top ?? 0) || (left.Geometry?.BoundingBox?.Left ?? 0) - (right.Geometry?.BoundingBox?.Left ?? 0))
    .map((line) => line.Text!.trim()).join('\n')).filter(Boolean).join('\n\n');
  return {
    extractedText,
    metadata: { provider: 'aws-textract', pages: pages.size },
  };
}

export function createAwsTextractDocumentOcr(options: DocumentOcrOptions = {}): DocumentOcr {
  const textractClient = options.textractClient ?? textract;
  const storageClient = options.storageClient ?? textractStorage;
  const sourceBucket = options.sourceBucket ?? S3_BUCKET;
  const extract: DocumentOcr['extract'] = async (storageKey, bytes) => {
    const stagingBucket = options.stagingBucket
      ?? process.env.CONTENT_TEXTRACT_BUCKET
      ?? documentTextractBucket
      ?? (process.env.NODE_ENV === 'development' && documentTextractUsesAwsCredentials ? developmentTextractBucket : undefined);
    const timeoutMs = positiveLimit(process.env.CONTENT_TEXTRACT_TIMEOUT_MS, 300_000);
    const maxCharacters = positiveLimit(process.env.CONTENT_MAX_EXTRACTED_CHARACTERS, 10_000_000);
    const maxBlocks = positiveLimit(process.env.CONTENT_TEXTRACT_MAX_BLOCKS, 250_000);
    const deadline = Date.now() + timeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const bucket = stagingBucket ?? sourceBucket;
    const objectKey = stagingBucket ? stagedDocumentKey(storageKey) : storageKey;
    try {
      if (stagingBucket) {
        if (!bytes?.byteLength) throw new Error('PDF bytes are required for cross-region Textract staging.');
        if (storageClient === textractStorage) await ensureDevelopmentBucket(stagingBucket);
        await storageClient.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: bytes, ContentType: 'application/pdf' }), { abortSignal: controller.signal });
        if (storageClient === textractStorage && documentTextractUsesAwsCredentials) {
          await storageClient.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }), { abortSignal: controller.signal });
        }
      }
      const started = await textractClient.send(new StartDocumentTextDetectionCommand({
        DocumentLocation: { S3Object: { Bucket: bucket, Name: objectKey } },
        ClientRequestToken: createHash('sha256').update(bucket).update('\0').update(objectKey).digest('hex'),
      }), { abortSignal: controller.signal });
      if (!started.JobId) throw new Error('AWS Textract did not return a job identifier.');

      const blocks: Block[] = [];
      const blockIds = new Set<string>();
      const seenTokens = new Set<string>();
      let nextToken: string | undefined;
      let pollAttempt = 0;
      do {
        let response;
        do {
          if (Date.now() >= deadline) throw new Error('AWS Textract extraction timed out.');
          response = await textractClient.send(new GetDocumentTextDetectionCommand({ JobId: started.JobId, NextToken: nextToken }), { abortSignal: controller.signal });
          if (response.JobStatus === 'FAILED' || response.JobStatus === 'PARTIAL_SUCCESS') {
            throw new Error('AWS Textract could not extract the document.');
          }
          if (response.JobStatus === 'IN_PROGRESS') {
            const delay = Math.min(400 * 2 ** pollAttempt, 1_000) + Math.floor(Math.random() * 100);
            pollAttempt += 1;
            await wait(delay, controller.signal);
          }
        } while (response.JobStatus === 'IN_PROGRESS');
        pollAttempt = 0;
        if (response.JobStatus !== 'SUCCEEDED') throw new Error(`AWS Textract returned unexpected status ${response.JobStatus ?? 'unknown'}.`);
        for (const block of response.Blocks ?? []) {
          if (block.Id && blockIds.has(block.Id)) continue;
          if (block.Id) blockIds.add(block.Id);
          blocks.push(block);
          if (blocks.length > maxBlocks) throw new Error(`AWS Textract exceeded the configured limit of ${maxBlocks} blocks.`);
        }
        nextToken = response.NextToken;
        if (nextToken && seenTokens.has(nextToken)) throw new Error('AWS Textract returned a repeated pagination token.');
        if (nextToken) seenTokens.add(nextToken);
      } while (nextToken);

      const result = textractBlocksToExtractionResult(blocks);
      if (result.extractedText.length > maxCharacters) throw new Error('Extracted document content exceeds the configured limit.');
      return result;
    } catch (error) {
      if (process.env.NODE_ENV === 'development' && error instanceof Error) {
        throw new Error(`Textract staging ${bucket}/${objectKey} failed: ${error.message}`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (stagingBucket) await storageClient.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey })).catch(() => undefined);
    }
  };
  return { extract };
}

export const awsTextractDocumentOcr = createAwsTextractDocumentOcr();

export const awsTextractImageOcr: DocumentImageOcr = {
  async extract(_storageKey, bytes) {
    const timeoutMs = positiveLimit(process.env.CONTENT_TEXTRACT_TIMEOUT_MS, 300_000);
    const maxCharacters = positiveLimit(process.env.CONTENT_MAX_EXTRACTED_CHARACTERS, 10_000_000);
    const response = await imageTextract.send(new DetectDocumentTextCommand({ Document: { Bytes: bytes } }), { abortSignal: AbortSignal.timeout(timeoutMs) });
    const result = textractBlocksToExtractionResult(response.Blocks ?? []);
    if (result.extractedText.length > maxCharacters) throw new Error('Extracted document content exceeds the configured limit.');
    return result;
  },
};

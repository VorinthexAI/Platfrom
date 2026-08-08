import {
  GetDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommand,
  TextractClient,
} from '@aws-sdk/client-textract';
import { S3_BUCKET } from '@/lib/s3';
import type { ExtractionResult } from './schemas';

function positiveLimit(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const textract = new TextractClient({
  region: process.env.AWS_REGION ?? 'eu-north-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
  credentials: process.env.AWS_ACCESS_KEY_ID ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  } : undefined,
});

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export interface DocumentOcr {
  extract(storageKey: string): Promise<ExtractionResult>;
}

export const awsTextractDocumentOcr: DocumentOcr = {
  async extract(storageKey) {
    const timeoutMs = positiveLimit(process.env.CONTENT_TEXTRACT_TIMEOUT_MS, 300_000);
    const maxCharacters = positiveLimit(process.env.CONTENT_MAX_EXTRACTED_CHARACTERS, 10_000_000);
    const deadline = Date.now() + timeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const started = await textract.send(new StartDocumentTextDetectionCommand({
        DocumentLocation: { S3Object: { Bucket: S3_BUCKET, Name: storageKey } },
      }), { abortSignal: controller.signal });
      if (!started.JobId) throw new Error('AWS Textract did not return a job identifier.');

      const lines: string[] = [];
      let extractedCharacters = 0;
      let nextToken: string | undefined;
      do {
        let response;
        do {
          if (Date.now() >= deadline) throw new Error('AWS Textract extraction timed out.');
          response = await textract.send(new GetDocumentTextDetectionCommand({ JobId: started.JobId, NextToken: nextToken }), { abortSignal: controller.signal });
          if (response.JobStatus === 'FAILED' || response.JobStatus === 'PARTIAL_SUCCESS') {
            throw new Error('AWS Textract could not extract the document.');
          }
          if (response.JobStatus === 'IN_PROGRESS') await wait(1_000);
        } while (response.JobStatus === 'IN_PROGRESS');
        if (response.JobStatus !== 'SUCCEEDED') throw new Error(`AWS Textract returned unexpected status ${response.JobStatus ?? 'unknown'}.`);
        for (const block of response.Blocks ?? []) {
          if (block.BlockType === 'LINE' && block.Text?.trim()) {
            const line = block.Text.trim();
            extractedCharacters += line.length + (lines.length ? 2 : 0);
            if (extractedCharacters > maxCharacters) throw new Error('Extracted document content exceeds the configured limit.');
            lines.push(line);
          }
        }
        nextToken = response.NextToken;
      } while (nextToken);

      return {
        extractedText: lines.join('\n\n'),
        blocks: lines.map((text) => ({ type: 'paragraph' as const, text })),
        metadata: { provider: 'aws-textract' },
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};

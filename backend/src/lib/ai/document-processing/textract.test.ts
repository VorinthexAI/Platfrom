import { describe, expect, test } from 'bun:test';
import { DeleteObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { GetDocumentTextDetectionCommand, StartDocumentTextDetectionCommand, type Block, type TextractClient } from '@aws-sdk/client-textract';
import { createAwsTextractDocumentOcr, textractBlocksToExtractionResult } from './textract';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('AWS Textract document extraction', () => {
  test('stages, polls, extracts, and removes selectable, scanned, and multi-page PDFs', async () => {
    const fixtures: Array<{ name: string; pdf: Uint8Array; blocks: Block[]; text: string; pages: number }> = [
      { name: 'selectable', pdf: bytes('%PDF selectable %%EOF'), blocks: [{ Id: 'selectable', BlockType: 'LINE', Page: 1, Text: 'Selectable quarterly report' }], text: 'Selectable quarterly report', pages: 1 },
      { name: 'scanned', pdf: bytes('%PDF scanned %%EOF'), blocks: [{ Id: 'scan-line', BlockType: 'LINE', Page: 1, Text: 'OCR from scanned invoice' }], text: 'OCR from scanned invoice', pages: 1 },
      { name: 'multi-page', pdf: bytes('%PDF multi %%EOF'), blocks: [{ Id: 'page-one', BlockType: 'LINE', Page: 1, Text: 'Annual results' }, { Id: 'page-two', BlockType: 'LINE', Page: 2, Text: 'Revenue' }], text: 'Annual results\n\nRevenue', pages: 2 },
    ];

    for (const fixture of fixtures) {
      const storageCommands: Array<PutObjectCommand | DeleteObjectCommand> = [];
      const textractCommands: Array<StartDocumentTextDetectionCommand | GetDocumentTextDetectionCommand> = [];
      const storageClient = { send: async (command: PutObjectCommand | DeleteObjectCommand) => { storageCommands.push(command); return {}; } } as unknown as Pick<S3Client, 'send'>;
      const textractClient = {
        send: async (command: StartDocumentTextDetectionCommand | GetDocumentTextDetectionCommand) => {
          textractCommands.push(command);
          return command instanceof StartDocumentTextDetectionCommand ? { JobId: `job-${fixture.name}` } : { JobStatus: 'SUCCEEDED', Blocks: fixture.blocks };
        },
      } as unknown as Pick<TextractClient, 'send'>;
      const ocr = createAwsTextractDocumentOcr({ stagingBucket: 'dummy-textract-eu-west-1', sourceBucket: 'dummy-source-eu-north-1', storageClient, textractClient });
      const result = await ocr.extract(`content/${fixture.name}.pdf`, fixture.pdf);

      expect(storageCommands).toHaveLength(2);
      expect(storageCommands[0]).toBeInstanceOf(PutObjectCommand);
      expect(storageCommands[0]!.input).toMatchObject({ Bucket: 'dummy-textract-eu-west-1', Body: fixture.pdf, ContentType: 'application/pdf' });
      expect(storageCommands[1]).toBeInstanceOf(DeleteObjectCommand);
      expect(storageCommands[1]!.input).toMatchObject({ Bucket: 'dummy-textract-eu-west-1', Key: storageCommands[0]!.input.Key });
      expect(textractCommands[0]).toBeInstanceOf(StartDocumentTextDetectionCommand);
      expect(textractCommands[1]).toBeInstanceOf(GetDocumentTextDetectionCommand);
      expect(result.extractedText).toBe(fixture.text);
      expect(result.metadata).toMatchObject({ provider: 'aws-textract', pages: fixture.pages });
    }
  });

  test('removes a staged PDF when Textract rejects it', async () => {
    const storageCommands: Array<PutObjectCommand | DeleteObjectCommand> = [];
    const ocr = createAwsTextractDocumentOcr({
      stagingBucket: 'dummy-textract-eu-west-1',
      storageClient: { send: async (command: PutObjectCommand | DeleteObjectCommand) => { storageCommands.push(command); return {}; } } as unknown as Pick<S3Client, 'send'>,
      textractClient: { send: async (command: StartDocumentTextDetectionCommand | GetDocumentTextDetectionCommand) => command instanceof StartDocumentTextDetectionCommand ? { JobId: 'failed-job' } : { JobStatus: 'FAILED' } } as unknown as Pick<TextractClient, 'send'>,
    });
    await expect(ocr.extract('content/rejected.pdf', bytes('%PDF rejected %%EOF'))).rejects.toThrow('could not extract');
    expect(storageCommands.map((command) => command.constructor)).toEqual([PutObjectCommand, DeleteObjectCommand]);
    expect(storageCommands[1]!.input.Key).toBe(storageCommands[0]!.input.Key);
  });

  test('orders lines by page and position and deduplicates block IDs', () => {
    const result = textractBlocksToExtractionResult([
      { Id: 'value', BlockType: 'LINE', Page: 1, Text: '$10M', Confidence: 96, Geometry: { BoundingBox: { Top: 0.2, Left: 0.1 } } },
      { Id: 'title', BlockType: 'LINE', Page: 1, Text: 'Annual report', Confidence: 99, Geometry: { BoundingBox: { Top: 0.05, Left: 0.1 } } },
      { Id: 'title', BlockType: 'LINE', Page: 1, Text: 'Annual report', Confidence: 99, Geometry: { BoundingBox: { Top: 0.05, Left: 0.1 } } },
      { Id: 'second-page', BlockType: 'LINE', Page: 2, Text: 'Appendix', Confidence: 93, Geometry: { BoundingBox: { Top: 0.05, Left: 0.1 } } },
    ]);
    expect(result.extractedText).toBe('Annual report\n$10M\n\nAppendix');
    expect(result.metadata).toMatchObject({ provider: 'aws-textract', pages: 2, averageConfidence: 96, minimumConfidence: 93 });
  });
});

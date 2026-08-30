import { fileInputSchema, fileOutputSchema, type FileInput, type FileOutput } from '@/lib/ai/actions/file';
import { awsTextractDocumentOcr, awsTextractImageOcr, type DocumentImageOcr, type DocumentOcr } from './textract';

export interface FileActionClient {
  execute(input: FileInput, organizationKey: string): Promise<FileOutput>;
}

export function createAwsFileAction(documentOcr: DocumentOcr = awsTextractDocumentOcr, imageOcr: DocumentImageOcr = awsTextractImageOcr): FileActionClient {
  return {
    async execute(rawInput) {
      const input = fileInputSchema.parse(rawInput);
      const result = input.operation === 'document'
        ? await documentOcr.extract(input.storageKey, input.bytes)
        : await imageOcr.extract(input.storageKey, input.bytes);
      return fileOutputSchema.parse({ text: result.extractedText, metadata: result.metadata });
    },
  };
}

export const awsFileAction = createAwsFileAction();

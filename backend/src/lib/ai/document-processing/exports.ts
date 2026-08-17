import { z } from 'zod';

export const documentExportFormatSchema = z.literal('txt');
export type DocumentExportFormat = z.infer<typeof documentExportFormatSchema>;
export type DocumentExportInput = {
  format: DocumentExportFormat;
  content: string;
};

export interface DocumentExportResult {
  bytes: Uint8Array;
  mimeType: string;
  extension: DocumentExportFormat;
}

const documentExportInputSchema = z.object({
  format: documentExportFormatSchema,
  content: z.string().max(10_000_000),
}).strict();

export async function generateDocumentExport(input: DocumentExportInput): Promise<DocumentExportResult> {
  const parsed = documentExportInputSchema.parse(input);
  return {
    bytes: new TextEncoder().encode(parsed.content),
    mimeType: 'text/plain; charset=utf-8',
    extension: parsed.format,
  };
}

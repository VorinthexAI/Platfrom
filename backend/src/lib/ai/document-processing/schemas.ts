import { z } from 'zod';
export const documentExtensionSchema = z.enum(['txt', 'md', 'doc', 'docx', 'pdf']);

export const DOCUMENT_ACTION_NAMES = [
  'document-validate',
  'storage-upload',
  'document-extract',
  'document-generate-html',
  'document-generate-content',
  'document-embed',
  'document-insert',
] as const;

export type DocumentActionName = (typeof DOCUMENT_ACTION_NAMES)[number];

export const uploadedDocumentFileSchema = z.custom<File | {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array | ArrayBuffer;
}>((value) => {
  if (typeof File !== 'undefined' && value instanceof File) return true;
  if (!value || typeof value !== 'object') return false;
  const file = value as Record<string, unknown>;
  return typeof file.filename === 'string'
    && typeof file.mimeType === 'string'
    && typeof file.sizeBytes === 'number'
    && (file.bytes instanceof Uint8Array || file.bytes instanceof ArrayBuffer);
}, 'A valid uploaded file is required');

export type UploadedDocumentFile = z.infer<typeof uploadedDocumentFileSchema>;

export const documentParseInputSchema = z.object({
  file: uploadedDocumentFileSchema,
  scopeKey: z.string().cuid(),
  folderKey: z.string().cuid().optional(),
  name: z.string().trim().min(1).max(255).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict();

export type DocumentParseInput = z.infer<typeof documentParseInputSchema>;

export const extractedBlockTypeSchema = z.enum([
  'heading', 'paragraph', 'blockquote', 'bulletList', 'orderedList', 'listItem',
  'codeBlock', 'table', 'tableRow', 'tableCell', 'horizontalRule',
]);

export type ExtractedBlock = {
  type: z.infer<typeof extractedBlockTypeSchema>;
  text?: string;
  level?: number;
  attrs?: Record<string, unknown>;
  children?: ExtractedBlock[];
};

export const extractedBlockSchema: z.ZodType<ExtractedBlock> = z.lazy(() => z.object({
  type: extractedBlockTypeSchema,
  text: z.string().optional(),
  level: z.number().int().min(1).max(6).optional(),
  attrs: z.record(z.unknown()).optional(),
  children: z.array(extractedBlockSchema).optional(),
}).strict());

export const extractionResultSchema = z.object({
  extractedText: z.string(),
  blocks: z.array(extractedBlockSchema),
  metadata: z.record(z.unknown()).optional(),
}).strict();

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export const normalizedDocumentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  extension: documentExtensionSchema,
  mimeType: z.string().trim().min(1),
  sizeBytes: z.number().int().positive(),
  scopeKey: z.string().cuid(),
  folderKey: z.string().cuid().optional(),
  fileInput: z.instanceof(Uint8Array),
}).strict();

export type NormalizedDocument = z.infer<typeof normalizedDocumentSchema>;

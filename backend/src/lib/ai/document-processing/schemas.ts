import { z } from 'zod';
export const documentExtensionSchema = z.enum(['txt', 'md', 'doc', 'docx', 'pdf']);

export const DOCUMENT_ACTION_NAMES = [
  'document-validate',
  'storage-upload',
  'document-extract',
  'document-cleanup',
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
  return Object.keys(file).every((key) => ['filename', 'mimeType', 'sizeBytes', 'bytes'].includes(key))
    && typeof file.filename === 'string'
    && typeof file.mimeType === 'string'
    && typeof file.sizeBytes === 'number'
    && (file.bytes instanceof Uint8Array || file.bytes instanceof ArrayBuffer);
}, 'A valid uploaded file is required');

export type UploadedDocumentFile = z.infer<typeof uploadedDocumentFileSchema>;

export const MAX_DOCUMENT_SCAN_PAGES = 12;
export const MAX_DOCUMENT_SCAN_PAGE_BYTES = 8 * 1024 * 1024;
export const documentPageSchema = z.object({
  filename: z.string().trim().min(1).max(255), mimeType: z.enum(['image/jpeg', 'image/png']),
  sizeBytes: z.number().int().positive().max(MAX_DOCUMENT_SCAN_PAGE_BYTES), bytes: z.instanceof(Uint8Array),
}).strict().superRefine((page, context) => {
  if (page.bytes.byteLength !== page.sizeBytes) context.addIssue({ code: 'custom', message: 'Page size does not match its bytes.' });
  const signature = page.mimeType === 'image/jpeg' ? [255, 216, 255] : [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => page.bytes[index] === value)) context.addIssue({ code: 'custom', message: 'Page bytes do not match its image type.' });
});
export function validateDocumentParseSource(input: { file?: unknown; pages?: Array<{ sizeBytes: number }> }, context: z.RefinementCtx) {
  if ((input.file !== undefined) === (input.pages !== undefined)) context.addIssue({ code: 'custom', message: 'Provide exactly one file or an ordered pages array.' });
  if (input.pages && input.pages.reduce((sum, page) => sum + page.sizeBytes, 0) > MAX_DOCUMENT_SCAN_PAGE_BYTES * 2) context.addIssue({ code: 'custom', message: 'Combined pages exceed the 16 MB limit.' });
}
export const documentParseInputSchema = z.object({
  file: uploadedDocumentFileSchema.optional(),
  pages: z.array(documentPageSchema).min(1).max(MAX_DOCUMENT_SCAN_PAGES).optional(),
  scopeKey: z.string().cuid(),
  folderKey: z.string().cuid().optional(),
  name: z.string().trim().min(1).max(255).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict().superRefine(validateDocumentParseSource);

export type DocumentParseInput = z.infer<typeof documentParseInputSchema>;

export const extractionResultSchema = z.object({
  extractedText: z.string(),
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

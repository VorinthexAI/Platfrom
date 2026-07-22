import { z } from 'zod';
export const documentExtensionSchema = z.enum(['txt', 'md', 'doc', 'docx', 'pdf']);

export const DOCUMENT_ACTION_NAMES = [
  'document-validate',
  'storage-upload',
  'document-extract',
  'document-generate-html',
  'document-generate-json',
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

export const documentProcessingInputSchema = z.object({
  file: uploadedDocumentFileSchema,
  scopeKey: z.string().cuid(),
  folderKey: z.string().cuid(),
  name: z.string().trim().min(1).max(255).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict();

export type DocumentProcessingInput = z.infer<typeof documentProcessingInputSchema>;

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

const editorMarkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }).strict(),
  z.object({ type: z.literal('italic') }).strict(),
  z.object({ type: z.literal('link'), attrs: z.object({ href: z.string().url().refine((href) => /^https?:\/\//i.test(href), 'Links must use HTTP or HTTPS.'), target: z.enum(['_blank', '_self']).optional() }).strict() }).strict(),
]);

export type EditorNodeJson = {
  type: 'doc' | 'heading' | 'paragraph' | 'text' | 'bulletList' | 'orderedList' | 'listItem'
    | 'blockquote' | 'codeBlock' | 'horizontalRule' | 'table' | 'tableRow' | 'tableCell';
  attrs?: Record<string, unknown>;
  content?: EditorNodeJson[];
  text?: string;
  marks?: Array<z.infer<typeof editorMarkSchema>>;
};

export const editorNodeJsonSchema: z.ZodType<EditorNodeJson> = z.lazy(() => z.object({
  type: z.enum(['doc', 'heading', 'paragraph', 'text', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'tableRow', 'tableCell']),
  attrs: z.record(z.unknown()).optional(),
  content: z.array(editorNodeJsonSchema).optional(),
  text: z.string().optional(),
  marks: z.array(editorMarkSchema).optional(),
}).strict().superRefine((node, context) => {
  if (node.type === 'text' && node.text === undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Text nodes require text.' });
  if (node.type !== 'text' && node.text !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Only text nodes may contain text.' });
  if (node.type === 'heading') {
    const level = node.attrs?.level;
    if (!Number.isInteger(level) || Number(level) < 1 || Number(level) > 6) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Headings require a level from 1 to 6.' });
  }
  if (node.type !== 'heading' && node.attrs && Object.keys(node.attrs).length > 0) context.addIssue({ code: z.ZodIssueCode.custom, message: `${node.type} does not support attributes.` });
}));

export const editorDocumentJsonSchema = editorNodeJsonSchema.refine((node) => node.type === 'doc', 'Editor document root must have type doc.');
export type EditorDocumentJson = EditorNodeJson;

export const normalizedDocumentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  extension: documentExtensionSchema,
  mimeType: z.string().trim().min(1),
  sizeBytes: z.number().int().positive(),
  scopeKey: z.string().cuid(),
  folderKey: z.string().cuid(),
  fileInput: z.instanceof(Uint8Array),
}).strict();

export type NormalizedDocument = z.infer<typeof normalizedDocumentSchema>;

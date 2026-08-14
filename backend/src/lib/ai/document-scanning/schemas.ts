import { z } from 'zod';

export const MAX_DOCUMENT_SCAN_PAGES = 12;
export const MAX_DOCUMENT_SCAN_PAGE_BYTES = 8 * 1024 * 1024;

export const documentScanPageSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png']),
  sizeBytes: z.number().int().positive().max(MAX_DOCUMENT_SCAN_PAGE_BYTES),
  bytes: z.instanceof(Uint8Array),
}).strict().superRefine((page, context) => {
  if (page.bytes.byteLength !== page.sizeBytes) context.addIssue({ code: z.ZodIssueCode.custom, path: ['sizeBytes'], message: 'Page size does not match its content.' });
  const jpeg = page.bytes[0] === 0xff && page.bytes[1] === 0xd8 && page.bytes[2] === 0xff;
  const png = page.bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => page.bytes[index] === value);
  if (page.mimeType === 'image/jpeg' ? !jpeg : !png) context.addIssue({ code: z.ZodIssueCode.custom, path: ['bytes'], message: 'Page bytes do not match the declared image type.' });
});

export const documentScanInputSchema = z.object({
  scopeKey: z.string().cuid(),
  folderKey: z.string().cuid().optional(),
  name: z.string().trim().min(1).max(255).optional(),
  pages: z.array(documentScanPageSchema).min(1).max(MAX_DOCUMENT_SCAN_PAGES),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict().superRefine((input, context) => {
  const total = input.pages.reduce((sum, page) => sum + page.sizeBytes, 0);
  if (total > MAX_DOCUMENT_SCAN_PAGE_BYTES * 2) context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages'], message: 'Combined scan pages exceed the 16 MB limit.' });
});

export type DocumentScanInput = z.infer<typeof documentScanInputSchema>;

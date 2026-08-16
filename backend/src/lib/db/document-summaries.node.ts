import { z } from 'zod';

export const DOCUMENT_SUMMARIES_COLLECTION = 'documentSummaries';

export const documentSummarySchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  documentKey: z.string().cuid(),
  version: z.number().int().positive(),
  summary: z.string().trim().min(1),
  topic: z.string().trim().min(1).optional(),
  style: z.enum(['brief', 'detailed', 'executive', 'bullet-points', 'technical']),
  language: z.string().trim().min(1).optional(),
  sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceTitle: z.string().trim().min(1),
  sourceDocumentUpdatedAt: z.string().datetime(),
  createdByKey: z.string().cuid(),
  createdAt: z.string().datetime(),
});

export type DocumentSummary = z.infer<typeof documentSummarySchema>;

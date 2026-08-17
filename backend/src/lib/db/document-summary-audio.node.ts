import { z } from 'zod';

export const DOCUMENT_SUMMARY_AUDIO_COLLECTION = 'documentSummaryAudio';

export const documentSummaryAudioSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  documentKey: z.string().cuid(),
  summaryKey: z.string().cuid(),
  storageKey: z.string().trim().min(1),
  mimeType: z.literal('audio/mpeg'),
  sizeBytes: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  voice: z.string().trim().min(1).optional(),
  language: z.string().trim().min(1).optional(),
  createdByKey: z.string().cuid(),
  createdAt: z.string().datetime(),
});

export type DocumentSummaryAudio = z.infer<typeof documentSummaryAudioSchema>;

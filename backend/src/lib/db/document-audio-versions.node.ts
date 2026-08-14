import { z } from 'zod';

export const DOCUMENT_AUDIO_VERSIONS_COLLECTION = 'documentAudioVersions';

export const documentAudioVersionSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  documentKey: z.string().cuid(),
  version: z.number().int().positive(),
  sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceTitle: z.string().trim().min(1),
  sourceDocumentUpdatedAt: z.string().datetime(),
  storageKey: z.string().trim().min(1),
  mimeType: z.literal('audio/mpeg'),
  sizeBytes: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  voice: z.string().trim().min(1).optional(),
  language: z.string().trim().min(1).optional(),
  speakingRate: z.number().min(0.25).max(4).optional(),
  includeTitle: z.boolean(),
  includeCode: z.boolean(),
  createdByKey: z.string().cuid(),
  createdAt: z.string().datetime(),
});

export type DocumentAudioVersion = z.infer<typeof documentAudioVersionSchema>;

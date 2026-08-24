import { z } from 'zod';

export const GENERATED_DOCUMENT_BINDINGS_COLLECTION = 'generatedDocumentBindings';
export const generatedDocumentSubjectTypeSchema = z.enum(['trip', 'place']);
export const generatedDocumentKindSchema = z.enum(['guide', 'brief', 'accommodations', 'restaurants', 'activities']);

export const generatedDocumentBindingSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  documentKey: z.string().cuid(),
  subjectType: generatedDocumentSubjectTypeSchema,
  subjectKey: z.string().cuid(),
  kind: generatedDocumentKindSchema,
  provenance: z.literal('generated'),
  createdByKey: z.string().cuid(),
  idempotencyKey: z.string().trim().min(1).max(200),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type GeneratedDocumentBinding = z.infer<typeof generatedDocumentBindingSchema>;

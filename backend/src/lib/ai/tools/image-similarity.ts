import { z } from 'zod';
import { ToolExecutionError, type ToolContext } from './tool-context';
import type { AccessibleImageSearchResult } from '@/lib/media-library';

export const imageSimilarityThresholdSchema = z.number().finite().min(-1).max(1);

export const imageSimilarityOutputSchema = z.object({
  images: z.array(z.object({
    key: z.string().cuid(),
    scopeKey: z.string().cuid(),
    filename: z.string(),
    caption: z.string(),
    imageCaptionKey: z.string().cuid().nullable(),
    mimeType: z.string(),
    sizeBytes: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    isFavorite: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    score: imageSimilarityThresholdSchema.optional(),
  }).strict()),
}).strict();

export type ImageSimilarityOutput = z.infer<typeof imageSimilarityOutputSchema>;

export function imageSearchActor(context: ToolContext): string {
  if (context.principal.kind !== 'member') {
    throw new ToolExecutionError('human_principal_required', 'A human organization member must search Gallery images');
  }
  const membership = context.principal.userOrganization;
  if (membership.status !== 'active' || membership.organizationId !== context.organizationKey) {
    throw new ToolExecutionError('organization_forbidden', 'Active organization membership is required');
  }
  return membership.key;
}

export function imageSimilarityOutput(results: Array<{ image: AccessibleImageSearchResult['image']; score?: number }>): ImageSimilarityOutput {
  return imageSimilarityOutputSchema.parse({
    images: results.map(({ image, score }) => ({
      key: image.key,
      scopeKey: image.scopeKey,
      filename: image.filename,
      caption: image.caption,
      imageCaptionKey: image.imageCaptionKey ?? null,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      width: image.width,
      height: image.height,
      isFavorite: image.isFavorite,
      createdAt: image.createdAt,
      updatedAt: image.updatedAt,
      ...(score === undefined ? {} : { score }),
    })),
  });
}

import { z } from 'zod';

export const TRIP_ATTACHMENTS_COLLECTION = 'tripAttachments';
export const tripAttachmentTargetTypeSchema = z.enum(['folder', 'collection']);
export const tripAttachmentSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  tripKey: z.string().cuid(),
  targetType: tripAttachmentTargetTypeSchema,
  targetKey: z.string().cuid(),
  position: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});

export type TripAttachment = z.infer<typeof tripAttachmentSchema>;
export type TripAttachmentTargetType = z.infer<typeof tripAttachmentTargetTypeSchema>;

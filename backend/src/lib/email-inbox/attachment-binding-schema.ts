import { z } from 'zod';

export const EMAIL_ATTACHMENT_BINDINGS_COLLECTION = 'emailAttachmentBindings';

export const emailAttachmentBindingSchema = z.object({
  key: z.string().cuid(),
  organizationKey: z.string().min(1),
  scopeKey: z.string().cuid(),
  connectorKey: z.string().cuid(),
  providerMessageId: z.string().min(1),
  partPath: z.string().regex(/^\d+(?:\.\d+)*$/),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceMimeType: z.string().min(1).max(255),
  sourceFilename: z.string().min(1).max(255),
  sourceSize: z.number().int().nonnegative().max(25 * 1024 * 1024),
  targetType: z.enum(['document', 'image']),
  targetKey: z.string().cuid(),
  status: z.enum(['processing', 'completed']),
  leaseToken: z.string().uuid().optional(),
  leaseExpiresAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type EmailAttachmentBinding = z.infer<typeof emailAttachmentBindingSchema>;

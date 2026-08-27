import { z } from 'zod';

export const EMAIL_ATTACHMENTS_COLLECTION = 'emailAttachments';

export const emailAttachmentSchema = z.object({
  key: z.string().cuid(),
  organizationKey: z.string().min(1),
  scopeKey: z.string().cuid(),
  connectorKey: z.string().cuid(),
  providerMessageId: z.string().trim().min(1),
  partPath: z.string().regex(/^\d+(?:\.\d+)*$/),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(['document', 'image']),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().nonnegative().max(25 * 1024 * 1024),
  storageKey: z.string().trim().min(1).optional(),
  status: z.enum(['processing', 'completed']),
  leaseToken: z.string().uuid().optional(),
  leaseExpiresAt: z.string().datetime().optional(),
  archiveDocumentKey: z.string().cuid().optional(),
  galleryImageKey: z.string().cuid().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict().superRefine((attachment, context) => {
  if (attachment.kind === 'document' && attachment.galleryImageKey) context.addIssue({ code: z.ZodIssueCode.custom, path: ['galleryImageKey'], message: 'Document attachments cannot reference a Gallery export' });
  if (attachment.kind === 'image' && attachment.archiveDocumentKey) context.addIssue({ code: z.ZodIssueCode.custom, path: ['archiveDocumentKey'], message: 'Image attachments cannot reference an Archive export' });
  if (attachment.status === 'processing' && (!attachment.leaseToken || !attachment.leaseExpiresAt)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['leaseToken'], message: 'Processing attachments require a lease' });
  if (attachment.status === 'completed' && (attachment.leaseToken || attachment.leaseExpiresAt)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['leaseToken'], message: 'Completed attachments cannot retain a lease' });
  if (attachment.status === 'completed' && !attachment.storageKey) context.addIssue({ code: z.ZodIssueCode.custom, path: ['storageKey'], message: 'Completed attachments require canonical storage' });
});

export type EmailAttachment = z.infer<typeof emailAttachmentSchema>;

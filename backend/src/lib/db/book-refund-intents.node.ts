import { z } from 'zod';

export const BOOK_REFUND_INTENTS_COLLECTION = 'bookRefundIntents';
export const bookRefundIntentSchema = z.object({
  key: z.string().cuid(),
  bookKey: z.string().cuid(),
  extensionKey: z.string().cuid().optional(),
  userKey: z.string().cuid(),
  chargeTransactionKey: z.string().cuid(),
  executionIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  microSparks: z.number().int().positive(),
  status: z.enum(['pending', 'processing']).default('pending'),
  leaseToken: z.string().trim().min(1).optional(),
  leaseExpiresAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type BookRefundIntent = z.infer<typeof bookRefundIntentSchema>;

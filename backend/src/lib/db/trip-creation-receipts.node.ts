import { z } from 'zod';

export const TRIP_CREATION_RECEIPTS_COLLECTION = 'tripCreationReceipts';
export const tripCreationReceiptSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  userKey: z.string().cuid(),
  tripKey: z.string().cuid(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
}).strict();

export type TripCreationReceipt = z.infer<typeof tripCreationReceiptSchema>;

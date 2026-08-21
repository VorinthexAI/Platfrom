import { z } from 'zod';

export const TRIPS_COLLECTION = 'trips';
export const tripSchema = z.object({
  key: z.string().cuid(),
  userKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(10_000).optional(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  createdAt: z.string().datetime(),
});
export type Trip = z.infer<typeof tripSchema>;

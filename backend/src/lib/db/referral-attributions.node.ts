import { z } from 'zod';
import { referralProgramVersionSchema } from './referral-codes.node';

export const REFERRAL_ATTRIBUTIONS_COLLECTION = 'referralAttributions';

export const referralAttributionSchema = z.object({
  key: z.string().trim().min(1).max(200),
  referralCodeKey: z.string().trim().min(1).max(200),
  referrerUserKey: z.string().trim().min(1).max(200),
  referredUserKey: z.string().trim().min(1).max(200),
  programVersion: referralProgramVersionSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export type ReferralAttribution = z.infer<typeof referralAttributionSchema>;

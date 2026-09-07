import { z } from 'zod';

export const REFERRAL_CODES_COLLECTION = 'referralCodes';
export const referralProgramVersionSchema = z.literal('v1');
export const referralCodeValueSchema = z.string().regex(/^[A-F0-9]{12}$/);

export const referralCodeSchema = z.object({
  key: z.string().trim().min(1).max(200),
  ownerUserKey: z.string().trim().min(1).max(200),
  programVersion: referralProgramVersionSchema,
  code: referralCodeValueSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export type ReferralCode = z.infer<typeof referralCodeSchema>;

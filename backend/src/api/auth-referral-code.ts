import { rawReferralCodeSchema } from '@/lib/referrals/contracts';

/** Transport accepts canonical referral codes case-insensitively; the service normalizes case. */
export const referralCodeTransportSchema = rawReferralCodeSchema.regex(/^[A-F0-9]{12}$/i);

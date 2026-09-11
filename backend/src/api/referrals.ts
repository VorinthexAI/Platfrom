import type { Context } from 'hono';
import { z } from 'zod';
import { referralRedeemInputSchema, referralRedeemResultSchema, referralSummarySchema } from '@/lib/referrals/contracts';
import { ReferralRepositoryError } from '@/lib/referrals/repository';
import { referralService } from '@/lib/referrals/service';
import { getAuthIdentity } from './security';
import { parseJson, parseQuery } from './validation';

const referralSummaryQuerySchema = z.object({ includeInvitees: z.literal('true').optional() }).strict();
const legacyReferralSummarySchema = referralSummarySchema.omit({ invitees: true }).strip();

interface ReferralSummaryHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  readSummary?: typeof referralService.readSummary;
}

interface ReferralRedeemHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  redeem?: typeof referralService.redeem;
}

const referralRepositoryErrors = {
  USER_NOT_FOUND: { status: 404, code: 'REFERRAL_USER_NOT_FOUND', message: 'Referral account was not found.' },
  USER_NOT_VERIFIED: { status: 409, code: 'REFERRAL_USER_NOT_VERIFIED', message: 'Verify the account before applying a referral code.' },
  INVALID_CODE: { status: 404, code: 'REFERRAL_INVALID_CODE', message: 'Referral code was not found.' },
  SELF_REFERRAL: { status: 422, code: 'REFERRAL_SELF_REFERRAL', message: 'A user cannot refer themselves.' },
  ALREADY_ATTRIBUTED: { status: 409, code: 'REFERRAL_ALREADY_ATTRIBUTED', message: 'A different referral code is already applied to this account.' },
  PAYMENT_ALREADY_USED: { status: 409, code: 'REFERRAL_PAYMENT_ALREADY_USED', message: 'The qualifying payment is already associated with another referral.' },
  REFERRAL_CODE_MISSING: { status: 409, code: 'REFERRAL_CODE_MISSING', message: 'The referral account is not ready.' },
} as const satisfies Record<ReferralRepositoryError['code'], { status: 404 | 409 | 422; code: string; message: string }>;

export function createReferralSummaryHandler(dependencies: ReferralSummaryHandlerDependencies = {}) {
  return async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity || identity.identityType !== 'user') {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json({ success: false, error: 'authenticated user required' }, 401);
    }
    const query = parseQuery(c, referralSummaryQuerySchema);
    const summary = referralSummarySchema.parse(await (dependencies.readSummary ?? referralService.readSummary)(identity.key));
    return c.json({ success: true, data: query.includeInvitees ? summary : legacyReferralSummarySchema.parse(summary) });
  };
}

export function createReferralRedeemHandler(dependencies: ReferralRedeemHandlerDependencies = {}) {
  return async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity || identity.identityType !== 'user') {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json({ success: false, error: 'authenticated user required' }, 401);
    }
    const { code } = await parseJson(c, referralRedeemInputSchema);
    try {
      const result = await (dependencies.redeem ?? referralService.redeem)(identity.key, code);
      return c.json({ success: true, data: referralRedeemResultSchema.parse(result) });
    } catch (error) {
      if (!(error instanceof ReferralRepositoryError)) throw error;
      const mapped = referralRepositoryErrors[error.code];
      return c.json({ success: false, error: { code: mapped.code, message: mapped.message } }, mapped.status);
    }
  };
}

export const getReferralSummary = createReferralSummaryHandler();
export const redeemReferral = createReferralRedeemHandler();

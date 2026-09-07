import type { Context } from 'hono';
import { referralService } from '@/lib/referrals/service';
import { getAuthIdentity } from './security';
import { parseQuery } from './validation';
import { z } from 'zod';

interface ReferralSummaryHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  readSummary?: typeof referralService.readSummary;
}

export function createReferralSummaryHandler(dependencies: ReferralSummaryHandlerDependencies = {}) {
  return async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity || identity.identityType !== 'user') {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json({ success: false, error: 'authenticated user required' }, 401);
    }
    parseQuery(c, z.object({}).strict());
    return c.json({ success: true, data: await (dependencies.readSummary ?? referralService.readSummary)(identity.key) });
  };
}

export const getReferralSummary = createReferralSummaryHandler();

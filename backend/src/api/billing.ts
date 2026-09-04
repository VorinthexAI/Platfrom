import type { Context } from 'hono';
import { sparkHistoryInputSchema } from '@/lib/sparks/contracts';
import { sparkService } from '@/lib/sparks/service';
import { getAuthIdentity } from './security';
import { parseQuery } from './validation';
import { z } from 'zod';

const billingSummaryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  beforeCreatedAt: z.string().datetime({ offset: true }).optional(),
  beforeKey: z.string().trim().min(1).max(200).optional(),
}).strict();

interface BillingHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  getSummary?: typeof sparkService.getSummary;
}

export function createBillingSummaryHandler(dependencies: BillingHandlerDependencies = {}) {
  return async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity || identity.identityType !== 'user') {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json({ success: false, error: 'authenticated user required' }, 401);
    }
    const query = sparkHistoryInputSchema.parse(parseQuery(c, billingSummaryQuerySchema));
    const data = await (dependencies.getSummary ?? sparkService.getSummary)(identity.key, query);
    return c.json({ success: true, data });
  };
}

export const getBillingSummary = createBillingSummaryHandler();

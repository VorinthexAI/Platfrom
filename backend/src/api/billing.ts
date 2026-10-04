import type { Context } from 'hono';
import { sparkHistoryInputSchema, sparkTransactionKindSchema } from '@/lib/sparks/contracts';
import { billingSummaryReadInputSchema } from '@/lib/ai/tools/billing-summary-read';
import { ScopeServiceError } from '@/lib/ai/scopes/service';
import { sparkService } from '@/lib/sparks/service';
import { getAuthIdentity } from './security';
import { parseQuery } from './validation';
import { z } from 'zod';

const billingSummaryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  beforeCreatedAt: z.string().datetime({ offset: true }).optional(),
  beforeKey: z.string().trim().min(1).max(200).optional(),
  kind: sparkTransactionKindSchema.optional(),
  scopeKey: z.string().cuid().optional(),
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
    const { scopeKey, ...history } = billingSummaryReadInputSchema.parse(parseQuery(c, billingSummaryQuerySchema));
    try {
      const data = await (dependencies.getSummary ?? sparkService.getSummary)(identity.key, sparkHistoryInputSchema.parse(history), scopeKey);
      return c.json({ success: true, data });
    } catch (error) {
      if (error instanceof ScopeServiceError) return c.json({ success: false, error: 'The selected scope is not available.' }, 404);
      throw error;
    }
  };
}

export const getBillingSummary = createBillingSummaryHandler();

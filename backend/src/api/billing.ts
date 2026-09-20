import type { Context } from 'hono';
import { sparksToMicroSparks } from '@/lib/costs';
import { sparkHistoryInputSchema, sparkTransactionKindSchema } from '@/lib/sparks/contracts';
import { sparkService } from '@/lib/sparks/service';
import { getAuthIdentity } from './security';
import { parseQuery } from './validation';
import { z } from 'zod';

const billingSummaryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  beforeCreatedAt: z.string().datetime({ offset: true }).optional(),
  beforeKey: z.string().trim().min(1).max(200).optional(),
  kind: sparkTransactionKindSchema.optional(),
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

const devSparkBalanceSchema = z.object({ sparks: z.number().int().min(0).max(1_000_000) }).strict();

interface DevSparkBalanceHandlerDependencies {
  enabled?: boolean;
  getIdentity?: typeof getAuthIdentity;
  getBalance?: typeof sparkService.getBalance;
  adjust?: typeof sparkService.adjust;
  getSummary?: typeof sparkService.getSummary;
}

export function createDevSparkBalanceHandler(dependencies: DevSparkBalanceHandlerDependencies = {}) {
  const enabled = dependencies.enabled ?? process.env.NODE_ENV !== 'production';
  return async (c: Context) => {
    if (!enabled) return c.json({ success: false, error: 'not found' }, 404);
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity || identity.identityType !== 'user') {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json({ success: false, error: 'authenticated user required' }, 401);
    }
    const { sparks } = devSparkBalanceSchema.parse(await c.req.json());
    const target = sparksToMicroSparks(sparks);
    const current = await (dependencies.getBalance ?? sparkService.getBalance)(identity.key) ?? 0;
    const delta = target - current;
    if (delta !== 0) {
      await (dependencies.adjust ?? sparkService.adjust)(identity.key, {
        deltaMicroSparks: delta,
        idempotencyKey: `dev-balance:${identity.key}:${target}:${Date.now()}`,
        requestHash: `dev-balance-set:${identity.key}:${target}`,
      });
    }
    const data = await (dependencies.getSummary ?? sparkService.getSummary)(identity.key);
    return c.json({ success: true, data });
  };
}

export const setDevSparkBalance = createDevSparkBalanceHandler();

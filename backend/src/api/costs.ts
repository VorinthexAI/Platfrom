import type { Context } from 'hono';
import { costService, type CostService } from '@/lib/costs/service';
import { publicSparkCostsSchema } from '@/lib/costs/contracts';

export function createListCostsHandler(service: CostService = costService) {
  return async (c: Context) => {
    c.header('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
    return c.json({ success: true, data: publicSparkCostsSchema.parse(await service.listCharges()) });
  };
}

export const listCosts = createListCostsHandler();

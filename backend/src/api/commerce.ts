import type { Context } from 'hono';
import { commerceService } from '@/lib/commerce/service';
import { getAuthIdentity } from './security';
import { parseQuery, strictObject } from './validation';

export const commerceHandlers = {
  async listProducts(c: Context) {
    c.header('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
    return c.json({ success: true, data: await commerceService.listProducts() });
  },
  async currentSubscription(c: Context) {
    const identity = await getAuthIdentity(c);
    if (!identity || identity.identityType !== 'user') return c.json({ success: false, error: 'authenticated user required' }, 401);
    parseQuery(c, strictObject({}));
    return c.json({ success: true, data: await commerceService.getCurrentSubscription(identity.key) });
  },
};

import type { Context } from 'hono';
import { ZodError } from 'zod';
import { countrySearchInputSchema, createCountrySearchService, type CountrySearchService } from '@/lib/travel/country-search';
import { getAuthIdentity } from './security';

export function createCountryHandlers(options: { service?: CountrySearchService; getIdentity?: typeof getAuthIdentity } = {}) {
  const service = options.service ?? createCountrySearchService();
  const getIdentity = options.getIdentity ?? getAuthIdentity;
  return { search: async (c: Context) => {
    try {
      const identity = await getIdentity(c);
      if (!identity || identity.identityType !== 'user') return c.json({ success: false, error: { code: 'COUNTRY_UNAUTHORIZED', message: 'A user session is required.' } }, 401);
      const input = countrySearchInputSchema.parse(await c.req.json());
      return c.json({ success: true, data: await service.search(input, identity.key, { signal: c.req.raw.signal, timeoutMs: 10_000 }) });
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'COUNTRY_INVALID_INPUT', message: 'Country search input was invalid.' } }, 400);
      return c.json({ success: false, error: { code: 'COUNTRY_SEARCH_FAILED', message: 'Country search failed.' } }, 500);
    }
  } };
}
export const countryHandlers = createCountryHandlers();

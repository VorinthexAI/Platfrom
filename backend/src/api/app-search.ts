import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { appSearchInputSchema, createAppSearchService, type AppSearchDependencies, type AppSearchService } from '@/lib/app-search/service';
import { authorizeContentExecution, ContentError, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';

export const appSearchHttpInputSchema = appSearchInputSchema.extend({
  organizationKey: z.string().trim().min(1),
  scopeKey: z.string().cuid(),
}).strict();

export interface AppSearchHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: (input: { organizationKey: string; scopeKey: string }, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) => Promise<{ input: { organizationKey: string; scopeKey: string }; context: ToolContext }>;
  authorizationOptions?: Omit<RunAuthenticatedContentToolOptions, 'authenticatedUserKey' | 'execute'>;
  service?: AppSearchService;
  searchDependencies?: AppSearchDependencies;
}

export function createAppSearchHandler(dependencies: AppSearchHandlerDependencies = {}) {
  return async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
    if (identity.identityType !== 'user') return c.json({ success: false, error: 'user session required' }, 403);
    try {
      const { organizationKey, scopeKey, ...input } = await parseJson(c, appSearchHttpInputSchema);
      const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ organizationKey, scopeKey }, {
        ...dependencies.authorizationOptions,
        authenticatedUserKey: identity.key,
      });
      const output = await (dependencies.service ?? createAppSearchService()).search(input, context, {
        ...dependencies.searchDependencies,
        signal: c.req.raw.signal,
      });
      return c.json({ success: true, data: output });
    } catch (error) {
      if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' ? 403 : 400);
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid app search request' }, 400);
      return c.json({ success: false, error: 'app search failed' }, 500);
    }
  };
}

export const searchApp = createAppSearchHandler();

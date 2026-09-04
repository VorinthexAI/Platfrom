import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { appSearchInputShape, createAppSearchService, projectAppSearchRetrieval, validateAppSearchInput, type AppSearchDependencies, type AppSearchService } from '@/lib/app-search/service';
import { authorizeContentExecution, ContentError, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';
import { sparkErrorResponse } from './errors';
import { observeToolExecution, type ToolBillingDependencies } from '@/lib/ai/events/runtime';
import { toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';
import { createHash } from 'node:crypto';

export const appSearchHttpInputSchema = z.object({ ...appSearchInputShape,
  organizationKey: z.string().trim().min(1),
  scopeKey: z.string().cuid(),
}).strict().superRefine(validateAppSearchInput);

export interface AppSearchHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: (input: { organizationKey: string; scopeKey: string }, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) => Promise<{ input: { organizationKey: string; scopeKey: string }; context: ToolContext }>;
  authorizationOptions?: Omit<RunAuthenticatedContentToolOptions, 'authenticatedUserKey' | 'execute'>;
  service?: AppSearchService;
  searchDependencies?: AppSearchDependencies;
  recordEvent?: ToolEventRecorder;
  billing?: ToolBillingDependencies;
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
      const idempotencyKey = z.string().trim().min(1).max(200).parse(c.req.header('idempotency-key') ?? createHash('sha256').update(JSON.stringify({ organizationKey, scopeKey, input })).digest('hex'));
      const output = await observeToolExecution('app.search', context, () => (dependencies.service ?? createAppSearchService()).search(input, context, {
        ...dependencies.searchDependencies,
        signal: c.req.raw.signal,
      }), { recorder: dependencies.recordEvent ?? toolEventService.record, idempotencyKey, input, ...dependencies.billing });
      return c.json({ success: true, data: { ...output, retrieval: projectAppSearchRetrieval(input, output) } });
    } catch (error) {
      const billing = sparkErrorResponse(c, error); if (billing) return billing;
      if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' || error.code === 'CONTENT_UNAUTHORIZED' ? 403 : error.code === 'CONTENT_NOT_FOUND' ? 404 : error.code === 'CONTENT_CONFLICT' ? 409 : 400);
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid app search request' }, 400);
      console.error('app search failed', { error });
      return c.json({ success: false, error: 'app search failed' }, 500);
    }
  };
}

export const searchApp = createAppSearchHandler();

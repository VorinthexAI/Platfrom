import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { resolveScopeManagementContext, scopeCreateInputSchema, scopeListInputSchema, scopeSelectInputSchema, scopeService, ScopeServiceError, type ScopeService } from '@/lib/ai/scopes';
import { runTool, type ToolContext } from '@/lib/ai/tools';
import type { ToolBillingDependencies } from '@/lib/ai/events/runtime';
import type { ToolEventRecorder } from '@/lib/ai/events/service';
import { getAuthIdentity } from './security';
import { parseJson, strictObject } from './validation';
import { teamAssurance } from './auth';

const teamKeySchema = z.string().trim().min(1).max(160);
export const scopeHttpListInputSchema = strictObject({ teamKey: teamKeySchema, ...scopeListInputSchema.shape });
export const scopeHttpCreateInputSchema = strictObject({ teamKey: teamKeySchema, ...scopeCreateInputSchema.shape });
export const scopeHttpSelectInputSchema = strictObject({ teamKey: teamKeySchema, ...scopeSelectInputSchema.shape });
const idempotencyKeySchema = z.string().trim().min(1).max(200);

export interface ScopeHandlerDependencies {
  service?: ScopeService;
  getIdentity?: typeof getAuthIdentity;
  resolveContext?: (userKey: string, teamKey: string, assurance?: ToolContext['teamAssurance']) => Promise<ToolContext>;
  recordEvent?: ToolEventRecorder;
  appScopeKey?: string;
  billing?: ToolBillingDependencies;
}

export function createScopeHandlers(dependencies: ScopeHandlerDependencies = {}) {
  const service = dependencies.service ?? scopeService;
  const run = (operation: (c: Context, identity: NonNullable<Awaited<ReturnType<typeof getAuthIdentity>>>) => Promise<unknown>, status: 200 | 201 = 200) => async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity) return c.json({ success: false, error: { code: 'SCOPE_UNAUTHORIZED', message: 'Authentication required.' } }, 401);
    try {
      return c.json({ success: true, data: await operation(c, identity) }, status);
    } catch (error) {
      if (error instanceof ScopeServiceError) {
        const errorStatus = error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : 409;
        return c.json({ success: false, error: { code: `SCOPE_${error.code}`, message: error.message } }, errorStatus);
      }
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'SCOPE_INVALID_INPUT', message: 'Scope request input was invalid.' } }, 400);
      console.error('scope request failed', { method: c.req.method, path: c.req.path, error });
      return c.json({ success: false, error: { code: 'SCOPE_FAILED', message: 'Scope request failed.' } }, 500);
    }
  };
  const context = (identity: NonNullable<Awaited<ReturnType<typeof getAuthIdentity>>>, teamKey: string) => (dependencies.resolveContext ?? resolveScopeManagementContext)(identity.key, teamKey, teamAssurance(identity));

  return {
    list: run(async (c, identity) => { const { teamKey } = await parseJson(c, scopeHttpListInputSchema); const contentContext = await context(identity, teamKey); return runTool('scope.list', '', {}, { contentContext, scopeService: service, recordEvent: dependencies.recordEvent, appScopeKey: dependencies.appScopeKey, billing: dependencies.billing }); }),
    create: run(async (c, identity) => {
      const { teamKey, ...input } = await parseJson(c, scopeHttpCreateInputSchema);
      const requestKey = idempotencyKeySchema.parse(c.req.header('idempotency-key'));
      const contentContext = await context(identity, teamKey);
      return runTool('scope.create', '', input, { contentContext, scopeService: service, requestKey, recordEvent: dependencies.recordEvent, appScopeKey: dependencies.appScopeKey, billing: dependencies.billing });
    }, 201),
    select: run(async (c, identity) => { const { teamKey, ...input } = await parseJson(c, scopeHttpSelectInputSchema); const contentContext = await context(identity, teamKey); return runTool('scope.select', '', input, { contentContext, scopeService: service, recordEvent: dependencies.recordEvent, appScopeKey: dependencies.appScopeKey, billing: dependencies.billing }); }),
  };
}

export const scopeHandlers = createScopeHandlers();

import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { resolveScopeManagementContext, scopeCreateInputSchema, scopeListInputSchema, scopeSelectInputSchema, scopeService, ScopeServiceError, scopeUpdateInputSchema, type ScopeService } from '@/lib/ai/scopes';
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
export const scopeHttpMutationInputSchema = strictObject({ teamKey: teamKeySchema });
export const scopeHttpUpdateInputSchema = strictObject({ teamKey: teamKeySchema, coverImageKey: scopeUpdateInputSchema.shape.coverImageKey });
const idempotencyKeySchema = z.string().trim().min(1).max(200);
const scopeKeySchema = z.string().cuid();
export const SCOPE_PROJECTION_HEADER = 'x-vorinthex-scope-projection';

function transportProjection(c: Context, value: unknown) {
  if (c.req.header(SCOPE_PROJECTION_HEADER) === '2') return value;
  const legacyScope = (scope: Record<string, unknown>) => {
    const { coverImageKey: _coverImageKey, coverUrl: _coverUrl, ...legacy } = scope;
    return legacy;
  };
  if (value && typeof value === 'object' && Array.isArray((value as { scopes?: unknown }).scopes)) {
    return { ...(value as Record<string, unknown>), scopes: ((value as { scopes: Record<string, unknown>[] }).scopes).map(legacyScope) };
  }
  return value && typeof value === 'object' && 'key' in value ? legacyScope(value as Record<string, unknown>) : value;
}

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
      return c.json({ success: true, data: transportProjection(c, await operation(c, identity)) }, status);
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
    prioritize: run(async (c, identity) => { const { teamKey } = await parseJson(c, scopeHttpMutationInputSchema); const contentContext = await context(identity, teamKey); return runTool('scope.prioritize', '', { targetScopeKey: scopeKeySchema.parse(c.req.param('scopeKey')) }, { contentContext, scopeService: service, recordEvent: dependencies.recordEvent, appScopeKey: dependencies.appScopeKey, billing: dependencies.billing }); }),
    update: run(async (c, identity) => { const { teamKey, coverImageKey } = await parseJson(c, scopeHttpUpdateInputSchema); const contentContext = await context(identity, teamKey); return runTool('scope.update', '', { targetScopeKey: scopeKeySchema.parse(c.req.param('scopeKey')), coverImageKey }, { contentContext, scopeService: service, recordEvent: dependencies.recordEvent, appScopeKey: dependencies.appScopeKey, billing: dependencies.billing }); }),
    delete: run(async (c, identity) => { const { teamKey } = await parseJson(c, scopeHttpMutationInputSchema); const contentContext = await context(identity, teamKey); return runTool('scope.delete', '', { targetScopeKey: scopeKeySchema.parse(c.req.param('scopeKey')) }, { contentContext, scopeService: service, recordEvent: dependencies.recordEvent, appScopeKey: dependencies.appScopeKey, billing: dependencies.billing }); }),
  };
}

export const scopeHandlers = createScopeHandlers();

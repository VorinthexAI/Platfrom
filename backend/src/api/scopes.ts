import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { scopeCreateInputSchema, scopeSelectInputSchema, scopeService, ScopeServiceError } from '@/lib/ai/scopes';
import { authorizeContentExecution } from '@/lib/ai/tools';
import { getAuthIdentity } from './security';
import { parseJson, strictObject } from './validation';
import { getUserById } from '@/lib/db/users.node';
import { memberPrincipal } from '@/lib/ai/tools/tool-context';

const scopeKeySchema = z.string().cuid();
const listSchema = strictObject({ scopeKey: z.string().cuid().optional() });
const createSchema = strictObject({ ...scopeCreateInputSchema.shape });
const selectSchema = strictObject({ ...scopeSelectInputSchema.shape });

async function userContext(userKey: string, scopeKey: string) {
  return authorizeContentExecution({ scopeKey }, { authenticatedUserKey: userKey });
}

async function currentContext(userKey: string) {
  const user = await getUserById(userKey);
  if (!user) throw new ScopeServiceError('FORBIDDEN', 'Authenticated user was not found.');
  return { context: { userKey, teamKey: userKey, runtimeScopeKey: user.currentScopeKey, principal: memberPrincipal(user) } };
}

export function createScopeHandlers() {
  const run = (operation: (c: Context, userKey: string) => Promise<unknown>, status: 200 | 201 = 200) => async (c: Context) => {
    const identity = await getAuthIdentity(c);
    if (!identity) return c.json({ success: false, error: { code: 'SCOPE_UNAUTHORIZED', message: 'Authentication required.' } }, 401);
    try {
      return c.json({ success: true, data: await operation(c, identity.key) }, status);
    } catch (error) {
      if (error instanceof ScopeServiceError) {
        const errorStatus = error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : 409;
        return c.json({ success: false, error: { code: `SCOPE_${error.code}`, message: error.message } }, errorStatus);
      }
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'SCOPE_INVALID_INPUT', message: 'Scope request input was invalid.' } }, 400);
      return c.json({ success: false, error: { code: 'SCOPE_FAILED', message: 'Scope request failed.' } }, 500);
    }
  };
  return {
    list: run(async (c, userKey) => { const body = await parseJson(c, listSchema); const { context } = body.scopeKey ? await userContext(userKey, body.scopeKey) : await currentContext(userKey); return scopeService.list(context); }),
    create: run(async (c, userKey) => { const input = await parseJson(c, createSchema); const { context } = await currentContext(userKey); return scopeService.create(input, context); }, 201),
    select: run(async (c, userKey) => { const input = await parseJson(c, selectSchema); const { context } = await currentContext(userKey); return scopeService.select(input, context); }),
    update: run(async (c, userKey) => { const input = await parseJson(c, strictObject({ name: z.string().trim().min(1).max(160).optional(), description: z.string().trim().min(1).max(10_000).nullable().optional() })); const { context } = await currentContext(userKey); return scopeService.update({ targetScopeKey: scopeKeySchema.parse(c.req.param('scopeKey')), ...input }, context); }),
    delete: run(async (c, userKey) => { const { context } = await currentContext(userKey); return scopeService.delete({ targetScopeKey: scopeKeySchema.parse(c.req.param('scopeKey')) }, context); }),
  };
}

export const scopeHandlers = createScopeHandlers();

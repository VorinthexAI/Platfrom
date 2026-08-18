import type { Context } from 'hono';
import { ZodError, z } from 'zod';
import { getPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { userHiddenSourceSchema } from '@/lib/db/user-hiddens.node';
import { userHiddenOperations } from '@/lib/user-hiddens/operations';
import { UserHiddenSourceNotFoundError, type UserHiddenService } from '@/lib/user-hiddens/service';
import { getAuthIdentity } from './security';
import { emptyObject, parseJson, parseQuery, strictObject } from './validation';

const targetSchema = strictObject({ source: userHiddenSourceSchema, sourceKey: z.string().cuid() });

export function createUserHiddenHandlers(options: {
  service?: UserHiddenService;
  getIdentity?: typeof getAuthIdentity;
  getContext?: typeof getPersonalAuthContext;
} = {}) {
  const getIdentity = options.getIdentity ?? getAuthIdentity;
  const getContext = options.getContext ?? getPersonalAuthContext;
  const run = (operation: (c: Context, actor: { userKey: string; organizationKey: string; membershipKey: string; service?: UserHiddenService }) => Promise<unknown>) => async (c: Context) => {
    const identity = await getIdentity(c);
    if (!identity) return c.json({ error: 'authentication required' }, 401);
    if (identity.identityType !== 'user') return c.json({ error: 'user authentication required' }, 403);
    const context = await getContext(identity.key);
    if (!context) return c.json({ error: 'user context not found' }, 404);
    try {
      return c.json(await operation(c, { userKey: identity.key, organizationKey: context.organization.key, membershipKey: context.membership.key, service: options.service }));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ error: 'invalid hidden content input' }, 400);
      if (error instanceof UserHiddenSourceNotFoundError) return c.json({ error: 'source not found' }, 404);
      throw error;
    }
  };
  return {
    list: run(async (c, actor) => { parseQuery(c, emptyObject); return userHiddenOperations.list({}, actor); }),
    hide: run(async (c, actor) => userHiddenOperations.hide(await parseJson(c, targetSchema), actor)),
    reveal: run(async (c, actor) => userHiddenOperations.reveal(parseQuery(c, targetSchema), actor)),
  };
}

export const userHiddenHandlers = createUserHiddenHandlers();

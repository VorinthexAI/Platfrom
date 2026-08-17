import type { Context } from 'hono';
import { ZodError } from 'zod';
import { createUserSettingsService, UserSettingsNotFoundError, type UserSettingsService } from '@/lib/user-settings/service';
import { getAuthIdentity } from './security';
import { emptyObject, parseJson, parseQuery } from './validation';
import { userSettingsSchema } from '@/lib/db/users.node';

type IdentityReader = typeof getAuthIdentity;

export function createUserSettingsHandlers(options: {
  service?: UserSettingsService;
  getIdentity?: IdentityReader;
} = {}) {
  const service = options.service ?? createUserSettingsService();
  const getIdentity = options.getIdentity ?? getAuthIdentity;
  const run = (operation: (c: Context, userKey: string) => Promise<unknown>) => async (c: Context) => {
    const identity = await getIdentity(c);
    if (!identity) return c.json({ error: 'authentication required' }, 401);
    if (identity.identityType !== 'user') return c.json({ error: 'user authentication required' }, 403);
    try {
      return c.json(await operation(c, identity.key));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ error: 'invalid settings input' }, 400);
      if (error instanceof UserSettingsNotFoundError) return c.json({ error: 'user not found' }, 404);
      throw error;
    }
  };
  return {
    read: run(async (c, userKey) => {
      parseQuery(c, emptyObject);
      return service.read(userKey);
    }),
    update: run(async (c, userKey) => service.update(userKey, await parseJson(c, userSettingsSchema))),
  };
}

export const userSettingsHandlers = createUserSettingsHandlers();

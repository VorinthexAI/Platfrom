import type { Context } from 'hono';
import { ZodError } from 'zod';
import { getPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { workspacePickerOperations } from '@/lib/workspace-picker/operations';
import { WorkspacePickerError, workspacePickerUpdateInputSchema, type WorkspacePickerService } from '@/lib/workspace-picker/service';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';

export function createWorkspacePickerHandlers(options: {
  service?: WorkspacePickerService;
  getIdentity?: typeof getAuthIdentity;
  getContext?: typeof getPersonalAuthContext;
} = {}) {
  const getIdentity = options.getIdentity ?? getAuthIdentity;
  const getContext = options.getContext ?? getPersonalAuthContext;
  return {
    async update(c: Context) {
      const identity = await getIdentity(c);
      if (!identity) return c.json({ error: 'authentication required' }, 401);
      if (identity.identityType !== 'user') return c.json({ error: 'user authentication required' }, 403);
      const context = await getContext(identity.key);
      if (!context) return c.json({ error: 'user context not found' }, 404);
      try {
        const input = await parseJson(c, workspacePickerUpdateInputSchema);
        return c.json(await workspacePickerOperations.update(input, { userKey: identity.key, service: options.service }));
      } catch (error) {
        if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ error: 'invalid workspace picker input' }, 400);
        if (error instanceof WorkspacePickerError && error.code === 'INVALID') return c.json({ error: error.message }, 400);
        if (error instanceof WorkspacePickerError && error.code === 'NOT_FOUND') return c.json({ error: error.message }, 404);
        throw error;
      }
    },
  };
}

export const workspacePickerHandlers = createWorkspacePickerHandlers();

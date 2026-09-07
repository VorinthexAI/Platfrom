import type { Context } from 'hono';
import { ZodError, z } from 'zod';
import { authorizeContentExecution, ContentError, runTool } from '@/lib/ai/tools';
import { currentEventIdentifier } from '@/lib/ai/events/event-identifier';
import { appNotifyInputSchema, notificationListInputSchema, pushRegistrationInputSchema } from '@/lib/app-notifications/contracts';
import { AppNotificationAccessError, appNotificationService, type AppNotificationService } from '@/lib/app-notifications/service';
import { InvalidNotificationCursorError } from '@/lib/app-notifications/repository';
import { getAuthIdentity } from './security';
import { authenticatedTeamContext } from './auth';
import { parseJson } from './validation';

const notifyHttpSchema = appNotifyInputSchema.innerType().extend({ teamKey: z.string().cuid(), scopeKey: z.string().cuid() }).strict();
const listHttpSchema = notificationListInputSchema.extend({ teamKey: z.string().cuid(), scopeKey: z.string().cuid() }).strict();

function errorResponse(c: Context, error: unknown) {
  if (error instanceof AppNotificationAccessError) return c.json({ success: false, error: error.message }, 403);
  if (error instanceof InvalidNotificationCursorError) return c.json({ success: false, error: error.message }, 400);
  if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code.includes('FORBIDDEN') || error.code.includes('UNAUTHORIZED') ? 403 : 400);
  if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid notification request' }, 400);
  console.error('app notification request failed', { error });
  return c.json({ success: false, error: 'notification request could not be completed' }, 500);
}

export function createAppNotificationHandlers(dependencies: { service?: AppNotificationService; getIdentity?: typeof getAuthIdentity; getInstallationIdentifier?: typeof currentEventIdentifier; authorize?: typeof authorizeContentExecution } = {}) {
  const service = dependencies.service ?? appNotificationService;
  const authenticated = async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity) return { response: c.json({ success: false, error: 'authentication required' }, 401) };
    if (identity.identityType !== 'user') return { response: c.json({ success: false, error: 'user session required' }, 403) };
    return { identity };
  };
  return {
    register: async (c: Context) => { try { const auth = await authenticated(c); if ('response' in auth) return auth.response; const installationKey = (dependencies.getInstallationIdentifier ?? currentEventIdentifier)(); if (!installationKey) return c.json({ success: false, error: 'installation identifier required' }, 400); const result = await service.register(auth.identity.key, installationKey, await parseJson(c, pushRegistrationInputSchema)); return c.json({ success: true, data: result }); } catch (error) { return errorResponse(c, error); } },
    unregister: async (c: Context) => { try { const auth = await authenticated(c); if ('response' in auth) return auth.response; const installationKey = (dependencies.getInstallationIdentifier ?? currentEventIdentifier)(); if (!installationKey) return c.json({ success: false, error: 'installation identifier required' }, 400); await parseJson(c, z.object({}).strict()); return c.json({ success: true, data: await service.unregister(auth.identity.key, installationKey) }); } catch (error) { return errorResponse(c, error); } },
    notify: async (c: Context) => { try { const auth = await authenticated(c); if ('response' in auth) return auth.response; const idempotencyKey = z.string().trim().min(1).max(180).parse(c.req.header('idempotency-key')); const body = await parseJson(c, notifyHttpSchema); const { teamKey, scopeKey, ...input } = body; const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ teamKey, scopeKey }, authenticatedTeamContext(auth.identity)); const result = await runTool('app.notify', '', appNotifyInputSchema.parse(input), { contentContext: context, requestKey: idempotencyKey, appNotificationService: service }); return c.json({ success: true, data: result }, 202); } catch (error) { return errorResponse(c, error); } },
    list: async (c: Context) => { try { const auth = await authenticated(c); if ('response' in auth) return auth.response; const body = await parseJson(c, listHttpSchema); const { teamKey, scopeKey, ...input } = body; const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ teamKey, scopeKey }, authenticatedTeamContext(auth.identity)); const result = await runTool('notification.list', '', notificationListInputSchema.parse(input), { contentContext: context, appNotificationService: service }); return c.json({ success: true, data: result }); } catch (error) { return errorResponse(c, error); } },
  };
}

export const appNotificationHandlers = createAppNotificationHandlers();

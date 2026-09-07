import type { Context } from 'hono';
import { currentEventAppScopeKey } from '@/lib/ai/events/runtime';
import { toolEventInputSchema, toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';
import { getUserById } from '@/lib/db/users.node';
import { getAuthIdentity } from './security';
import { parseJson, strictObject } from './validation';
import { currentEventIdentifier } from '@/lib/ai/events/event-identifier';

const analyticsEventInputSchema = strictObject({
  slug: toolEventInputSchema.shape.slug,
});

interface AnalyticsEventHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  getAppScopeKey?: typeof currentEventAppScopeKey;
  getUser?: typeof getUserById;
  record?: ToolEventRecorder;
  getEventIdentifier?: typeof currentEventIdentifier;
}

export function createAnalyticsEventHandler(dependencies: AnalyticsEventHandlerDependencies = {}) {
  return async (c: Context) => {
    const eventIdentifier = (dependencies.getEventIdentifier ?? currentEventIdentifier)();
    if (!eventIdentifier) return c.json({ success: false, error: 'event identifier header required' }, 400);
    const appScopeKey = (dependencies.getAppScopeKey ?? currentEventAppScopeKey)();
    if (!appScopeKey) return c.json({ success: false, error: 'product scope context required' }, 400);
    const input = await parseJson(c, analyticsEventInputSchema);
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity && c.get('authCredentialsPresented') === true) {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json({ success: false, error: 'valid authentication required for presented credentials' }, 401);
    }
    const user = identity?.identityType === 'user'
      ? await (dependencies.getUser ?? getUserById)(identity.key)
      : null;
    if (identity?.identityType === 'user' && !user) return c.json({ success: false, error: 'authenticated user not found' }, 401);
    await (dependencies.record ?? toolEventService.record)({
      userId: identity?.identityType === 'user' ? identity.key : null,
      scopeKey: user?.currentScopeKey ?? null,
      eventIdentifier,
      slug: input.slug,
      appScopeKey,
    });
    return c.json({ success: true }, 201);
  };
}

export const recordAnalyticsEvent = createAnalyticsEventHandler();

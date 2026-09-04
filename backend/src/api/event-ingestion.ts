import type { Context } from 'hono';
import { currentEventAppKey } from '@/lib/ai/events/runtime';
import { toolEventInputSchema, toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';
import { getUserById } from '@/lib/db/users.node';
import { getAuthIdentity } from './security';
import { parseJson, strictObject } from './validation';

const analyticsEventInputSchema = strictObject({
  slug: toolEventInputSchema.shape.slug,
});

interface AnalyticsEventHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  getAppKey?: typeof currentEventAppKey;
  getUser?: typeof getUserById;
  record?: ToolEventRecorder;
}

export function createAnalyticsEventHandler(dependencies: AnalyticsEventHandlerDependencies = {}) {
  return async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity || identity.identityType !== 'user') {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json({ success: false, error: 'authenticated user required' }, 401);
    }

    const input = await parseJson(c, analyticsEventInputSchema);
    const user = await (dependencies.getUser ?? getUserById)(identity.key);
    if (!user) return c.json({ success: false, error: 'authenticated user not found' }, 401);
    await (dependencies.record ?? toolEventService.record)({
      userId: identity.key,
      scopeKey: user.currentScopeKey,
      slug: input.slug,
      appKey: (dependencies.getAppKey ?? currentEventAppKey)(),
    });
    return c.json({ success: true }, 201);
  };
}

export const recordAnalyticsEvent = createAnalyticsEventHandler();

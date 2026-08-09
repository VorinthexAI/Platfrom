import type { Context } from 'hono';
import { z } from 'zod';
import { insertEvent } from '@/lib/db/events.node';
import { isArangoUniqueConstraintError } from '@/lib/db/base';
import { getAuthIdentity } from './security';
import { parseJson, strictObject } from './validation';

const distinctIdSchema = z.string().trim().min(20).max(80).regex(/^app_[A-Za-z0-9_-]+$/);
const eventIdSchema = z.string().min(20).max(120).regex(/^evt_[A-Za-z0-9_-]+$/);
const coreAppNameSchema = z.enum(['Archive', 'Gallery', 'Signal', 'Compass', 'Ascend']);

export const appEventBodySchema = z.union([
  strictObject({
    slug: z.literal('app.opened'),
    eventId: eventIdSchema,
    distinctId: distinctIdSchema,
  }),
  strictObject({
    slug: z.literal('app.onboarding'),
    eventId: eventIdSchema,
    distinctId: distinctIdSchema,
    step: z.number().int().min(1).max(5),
    coreAppName: coreAppNameSchema,
    enabled: z.boolean(),
    skipped: z.boolean(),
  }).refine((event) => event.enabled !== event.skipped, {
    message: 'exactly one onboarding decision must be true',
  }),
]);

export function createPlatformEventHandler(dependencies: {
  getIdentity?: typeof getAuthIdentity;
  insert?: typeof insertEvent;
} = {}) {
  return async (c: Context) => {
    const body = await parseJson(c, appEventBodySchema);
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    const data = body.slug === 'app.onboarding'
      ? { step: body.step, coreAppName: body.coreAppName, enabled: body.enabled, skipped: body.skipped }
      : null;
    try {
      await (dependencies.insert ?? insertEvent)({
        key: body.eventId,
        slug: body.slug,
        distinctId: body.distinctId,
        userId: identity?.key ?? null,
        data,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      if (!isArangoUniqueConstraintError(error)) throw error;
    }
    return c.json({ ok: true }, 202);
  };
}

export const recordPlatformEvent = createPlatformEventHandler();

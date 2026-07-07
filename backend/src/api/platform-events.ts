import type { Context } from 'hono';
import { z } from 'zod';
import { clientEventSlugSchema, trackPlatformEvent } from '@/platform/events';
import { getUserId } from './security';
import { parseJson, strictObject } from './validation';

const jsonObject = z.record(z.string(), z.unknown()).default({});
const tempEmailHash = z.string().regex(/^[a-f0-9]{64}$/);

export const platformEventsBodySchema = strictObject({
  distinctId: z.string().min(1).max(200),
  slug: clientEventSlugSchema,
  app_id: z.string().min(1).optional(),
  source_id: z.string().min(1).optional(),
  temp_email_hash: tempEmailHash.optional(),
  metadata: jsonObject.optional(),
});

export async function recordPlatformClientEvent(c: Context) {
  const body = await parseJson(c, platformEventsBodySchema);
  const userId = await getUserId(c);
  trackPlatformEvent({
    slug: body.slug,
    appId: body.app_id,
    sourceId: body.source_id,
    userId,
    data: {
      ...body.metadata,
      distinct_id: body.distinctId,
      ...(body.temp_email_hash ? { temp_email_hash: body.temp_email_hash } : {}),
    },
  });
  return c.json({ ok: true }, 202);
}

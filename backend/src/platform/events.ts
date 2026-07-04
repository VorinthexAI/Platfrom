import { z } from 'zod';
import { insertEvent } from '@/lib/db/events.node';
import { getPlatformByName, insertPlatform } from '@/lib/db/platforms.node';
import { newId } from '@/lib/ids';

export const eventSlugSchema = z.string().min(1).max(200);

export type EventSlug = z.infer<typeof eventSlugSchema>;

export const clientEventSlugSchema = eventSlugSchema;

export type ClientEventSlug = z.infer<typeof clientEventSlugSchema>;

export function trackPlatformEvent(input: {
  slug: EventSlug;
  data?: Record<string, unknown>;
  entityId?: string;
}) {
  void (async () => {
    await insertEvent({
      key: newId(),
      entityId: input.entityId ?? await getDefaultPlatformId(),
      belongsTo: 'platform',
      slug: input.slug,
      data: input.data ?? {},
      createdAt: new Date().toISOString(),
    });
  })().catch((error) => {
    console.warn('failed to track platform event', {
      slug: input.slug,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

async function getDefaultPlatformId() {
  const existing = await getPlatformByName('this');
  if (existing) return existing.key;

  const now = new Date().toISOString();
  const created = await insertPlatform({
    key: newId(),
    name: 'this',
    metadata: {},
    createdAt: now,
    updatedAt: now,
  });
  return created.key;
}

import { z } from 'zod';
import { NEXUS_SCOPE_KEY } from '@/lib/ai/scopes';
import { insertEvent } from '@/lib/db/events.node';
import { getRootOrganization, insertOrganization } from '@/lib/db/organizations.node';
import { newId } from '@/lib/ids';
import {
  runtimeEventDataSchema,
  runtimeEventSlugSchema,
  type EventSlug,
  type RuntimeEventRecorder,
} from './event-catalog';

export * from './event-catalog';

/** Awaitable trusted runtime event writer; callers decide whether telemetry failure is fatal. */
export const recordRuntimeEvent: RuntimeEventRecorder = async (input) => {
  const event = z.object({
    scopeId: z.string().cuid(),
    userId: z.string().nullable().default(null),
    slug: runtimeEventSlugSchema,
    data: runtimeEventDataSchema,
  }).strict().parse({ ...input, userId: input.userId ?? null });
  await insertEvent({ key: newId(), ...event, createdAt: new Date().toISOString() });
};

export function trackPlatformEvent(input: {
  slug: EventSlug;
  data?: Record<string, unknown>;
  userId?: string | null;
}) {
  void (async () => {
    await insertEvent({
      key: newId(),
      scopeId: NEXUS_SCOPE_KEY,
      userId: input.userId ?? null,
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

export async function getRootOrganizationId() {
  const existing = await getRootOrganization();
  if (existing) return existing.key;

  const now = new Date().toISOString();
  const created = await insertOrganization({
    key: newId(),
    name: 'Vorinthex AI',
    is_root: true,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  });
  return created.key;
}

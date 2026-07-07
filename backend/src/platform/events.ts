import { z } from 'zod';
import { insertEvent } from '@/lib/db/events.node';
import { getPlatformByName, insertPlatform } from '@/lib/db/platforms.node';
import { newId } from '@/lib/ids';

export const eventSlugSchema = z.string().min(1).max(200);

export type EventSlug = z.infer<typeof eventSlugSchema>;

export const landingEventSlugs = [
  'landing.page_viewed',
  'landing.product_entered',
  'landing.orchestrator_entered',
  'landing.capability_entered',
  'landing.rock_entered',
  'landing.cta_clicked',
  'landing.cave_opened',
  'landing.cave_closed',
  'landing.audio_played',
  'landing.fragment_discovered',
  'landing.fragment_claim_clicked',
  'landing.fragment_join_to_claim_clicked',
  'waitlist.form_started',
  'waitlist.submit_clicked',
  'waitlist.signup_submitted',
  'waitlist.email_verified',
  'auth.signin_opened',
  'auth.member_gate_opened',
  'legal.opened',
  'fragments.collected',
] as const;

export const landingEventSlugSchema = z.enum(landingEventSlugs);

export const clientEventSlugSchema = eventSlugSchema;

export type ClientEventSlug = z.infer<typeof clientEventSlugSchema>;

type EventSourceInput = {
  appId?: string;
  sourceId?: string;
};

export async function resolveEventSource(input: EventSourceInput = {}) {
  if (input.appId) {
    return { belongsTo: 'app' as const, sourceId: input.appId };
  }

  return {
    belongsTo: 'platform' as const,
    sourceId: input.sourceId ?? await getDefaultPlatformId(),
  };
}

export function trackPlatformEvent(input: {
  slug: EventSlug;
  data?: Record<string, unknown>;
  sourceId?: string;
  appId?: string;
  userId?: string | null;
}) {
  void (async () => {
    const source = await resolveEventSource({ appId: input.appId, sourceId: input.sourceId });
    await insertEvent({
      key: newId(),
      ...source,
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

export async function getDefaultPlatformId() {
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

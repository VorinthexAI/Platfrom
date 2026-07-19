import { z } from 'zod';
import { insertEvent } from '@/lib/db/events.node';
import { newId } from '@/lib/ids';
import { eventSlugSchema, type EventSlug } from '@/platform/event-catalog';

const organizationEventSchema = z.object({
  scopeId: z.string().cuid(),
  slug: eventSlugSchema,
  data: z.object({
    nodeType: z.string().trim().min(1).max(120),
    nodeKey: z.string().trim().min(1).max(160),
  }).strict(),
}).strict();

export type OrganizationEventInput = {
  scopeId: string;
  slug: EventSlug;
  data: { nodeType: string; nodeKey: string };
};

export type OrganizationEventRecorder = (input: OrganizationEventInput) => Promise<void>;

/** Writes the minimal durable event consumed by the organization SSE stream. */
export const recordOrganizationEvent: OrganizationEventRecorder = async (input) => {
  const event = organizationEventSchema.parse(input);
  await insertEvent({ key: newId(), ...event, userId: null, createdAt: new Date().toISOString() });
};

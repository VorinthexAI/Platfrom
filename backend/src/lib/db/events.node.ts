import { z } from 'zod';
import { createNodeHelpers } from './base';

export const EVENTS_COLLECTION = 'events';

export const appEventSlugSchema = z.enum(['app.opened', 'app.onboarding']);

export const eventSchema = z.object({
  key: z.string(),
  slug: appEventSlugSchema,
  distinctId: z.string(),
  userId: z.string().nullable().default(null),
  data: z.record(z.string(), z.unknown()).nullable().default(null),
  createdAt: z.string().datetime(),
  embedding: z.array(z.number()).default([]),
});

export type AppEvent = z.infer<typeof eventSchema>;

const helpers = createNodeHelpers(EVENTS_COLLECTION, eventSchema, []);

export const insertEvent = helpers.insert;

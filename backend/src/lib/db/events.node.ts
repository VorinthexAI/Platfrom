import { z } from 'zod';
import { createNodeHelpers } from './base';

export const EVENTS_COLLECTION = 'events';

export const eventSchema = z.object({
  key: z.string(),
  sourceId: z.string(),
  belongsTo: z.enum(['platform', 'app']),
  userId: z.string().nullable().default(null),
  slug: z.string(),
  data: z.record(z.unknown()).nullable().default(null),
  embedding: z.array(z.number()).default([]),
  createdAt: z.string(),
});

export type Event = z.infer<typeof eventSchema>;

// Ownership ids, arbitrary payload data, and createdAt belong in AQL filters,
// not semantic search text.
export const eventsEmbedKeys = z.enum(['belongsTo', 'slug']);

const helpers = createNodeHelpers(EVENTS_COLLECTION, eventSchema, eventsEmbedKeys.options);

export const insertEvent = helpers.insert;
export const getEventById = helpers.getById;
export const updateEvent = helpers.updateById;
export const deleteEvent = helpers.deleteById;
export const upsertEventByKey = helpers.upsertByKey;
export const getAllEventsChunked = helpers.getAllChunked;
export const listEventsPage = helpers.listPage;

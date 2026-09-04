import { z } from 'zod';
import { createNodeHelpers } from './base';
import { appKeySchema } from './apps.node';

export const EVENTS_COLLECTION = 'events';

export const eventSchema = z.object({
  key: z.string().cuid(),
  userId: z.string().nullable(),
  scopeKey: z.string().min(1),
  slug: z.string().trim().min(1).max(200).regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/),
  appKey: appKeySchema,
  createdAt: z.string().datetime(),
  status: z.enum(['completed', 'failed']).default('completed'),
  microSparks: z.number().int().safe().nonnegative().default(0),
  sparkTransactionKey: z.string().min(1).nullable().default(null),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
}).strict();

export type AppEvent = z.infer<typeof eventSchema>;

const helpers = createNodeHelpers(EVENTS_COLLECTION, eventSchema, [], { requireEmbedding: false });

export const insertEvent = helpers.insert;
export const getEventById = helpers.getById;

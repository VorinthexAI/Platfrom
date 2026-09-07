import { z } from 'zod';
import { createNodeHelpers } from './base';
import { eventIdentifierSchema } from '@/lib/ai/events/event-identifier';
import { scopeSchema } from '@/lib/ai/scopes';

export const EVENTS_COLLECTION = 'events';

export const eventSchema = z.object({
  key: z.string().cuid(),
  userId: z.string().min(1).nullable().default(null),
  scopeKey: z.string().min(1).nullable().default(null),
  eventIdentifier: eventIdentifierSchema,
  slug: z.string().trim().min(1).max(200),
  appScopeKey: scopeSchema.shape.key,
  createdAt: z.string().datetime(),
  status: z.enum(['completed', 'failed']).default('completed'),
  microSparks: z.number().int().safe().nonnegative().default(0),
  sparkTransactionKey: z.string().min(1).nullable().default(null),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
});

export type AppEvent = z.infer<typeof eventSchema>;

const helpers = createNodeHelpers(EVENTS_COLLECTION, eventSchema, [], { requireEmbedding: false });

export const insertEvent = helpers.insert;
export const getEventById = helpers.getById;

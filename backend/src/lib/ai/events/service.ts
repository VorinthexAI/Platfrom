import { z } from 'zod';
import { getEventById, insertEvent } from '@/lib/db/events.node';
import { isArangoUniqueConstraintError } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { createEventIdentifier, currentEventIdentifier, eventIdentifierSchema } from './event-identifier';
import { createProductScopeRepository, requireProductScopes } from '@/lib/apps/repository';
import { scopeSchema } from '@/lib/ai/scopes';

const toolSlugSchema = z.string().trim().min(1).max(200);
const optionalUsageSchema = z.number().int().nonnegative().optional();

export const toolEventInputSchema = z.object({
  userId: z.string().min(1).nullable().default(null),
  scopeKey: z.string().min(1).nullable().default(null),
  eventIdentifier: eventIdentifierSchema.optional(),
  slug: toolSlugSchema,
  appScopeKey: scopeSchema.shape.key,
  status: z.enum(['completed', 'failed']).default('completed'),
  microSparks: z.number().int().safe().nonnegative().default(0),
  sparkTransactionKey: z.string().min(1).nullable().default(null),
  inputTokens: optionalUsageSchema,
  outputTokens: optionalUsageSchema,
  totalTokens: optionalUsageSchema,
}).strict();

export type ToolEventInput = z.input<typeof toolEventInputSchema>;
export type ToolEventRecorder = (input: ToolEventInput, options?: { key?: string }) => Promise<unknown>;

interface ToolEventServiceDependencies {
  insert?: typeof insertEvent;
  getById?: typeof getEventById;
  productScopeExists?: (scopeKey: string) => Promise<boolean>;
  id?: () => string;
  now?: () => string;
  createIdentifier?: () => string;
}

export function createToolEventService(dependencies: ToolEventServiceDependencies = {}) {
  const insert = dependencies.insert ?? insertEvent;
  const getById = dependencies.getById ?? getEventById;
  const productScopeExists = dependencies.productScopeExists ?? (async (scopeKey: string) => [...(await requireProductScopes(createProductScopeRepository())).values()].some(({ key }) => key === scopeKey));
  const id = dependencies.id ?? newId;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const createIdentifier = dependencies.createIdentifier ?? createEventIdentifier;

  return {
    async record(rawInput: ToolEventInput, options: { key?: string } = {}) {
      const input = toolEventInputSchema.parse(rawInput);
      if (!await productScopeExists(input.appScopeKey)) throw new Error(`Product scope ${input.appScopeKey} was not found in the root team catalog.`);
      const key = options.key ? z.string().cuid().parse(options.key) : id();
      try {
        const eventIdentifier = eventIdentifierSchema.parse(input.eventIdentifier ?? currentEventIdentifier() ?? createIdentifier());
        return await insert({ key, ...input, eventIdentifier, createdAt: now() });
      } catch (error) {
        if (!options.key || !isArangoUniqueConstraintError(error)) throw error;
        const existing = await getById(key);
        if (!existing) throw error;
        return existing;
      }
    },
  };
}

export const toolEventService = createToolEventService();

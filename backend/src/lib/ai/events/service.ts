import { z } from 'zod';
import { getEventById, insertEvent } from '@/lib/db/events.node';
import { appKeySchema, appsRepository } from '@/lib/db/apps.node';
import { isArangoUniqueConstraintError } from '@/lib/db/base';
import { newId } from '@/lib/ids';

const toolSlugSchema = z.string().trim().min(1).max(200).regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/);
const optionalUsageSchema = z.number().int().nonnegative().optional();

export const toolEventInputSchema = z.object({
  userId: z.string().min(1).nullable(),
  scopeKey: z.string().min(1),
  slug: toolSlugSchema,
  appKey: appKeySchema,
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
  appExists?: (appKey: string) => Promise<boolean>;
  id?: () => string;
  now?: () => string;
}

export function createToolEventService(dependencies: ToolEventServiceDependencies = {}) {
  const insert = dependencies.insert ?? insertEvent;
  const getById = dependencies.getById ?? getEventById;
  const appExists = dependencies.appExists ?? (async (appKey: string) => Boolean(await appsRepository.getByKey(appKey)));
  const id = dependencies.id ?? newId;
  const now = dependencies.now ?? (() => new Date().toISOString());

  return {
    async record(rawInput: ToolEventInput, options: { key?: string } = {}) {
      const input = toolEventInputSchema.parse(rawInput);
      if (!await appExists(input.appKey)) throw new Error(`App ${input.appKey} was not found.`);
      const key = options.key ? z.string().cuid().parse(options.key) : id();
      try {
        return await insert({ key, ...input, createdAt: now() });
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

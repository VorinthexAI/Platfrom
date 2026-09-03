import { z } from 'zod';
import { insertEvent } from '@/lib/db/events.node';
import { appKeySchema, appsRepository } from '@/lib/db/apps.node';
import { newId } from '@/lib/ids';

const toolSlugSchema = z.string().trim().min(1).max(200).regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/);
const optionalUsageSchema = z.number().int().nonnegative().optional();

export const toolEventInputSchema = z.object({
  userId: z.string().min(1).nullable(),
  scopeId: z.string().min(1).nullable(),
  slug: toolSlugSchema,
  appKey: appKeySchema,
  sparks: z.number().finite().nonnegative().optional(),
  inputTokens: optionalUsageSchema,
  outputTokens: optionalUsageSchema,
  totalTokens: optionalUsageSchema,
}).strict();

export type ToolEventInput = z.input<typeof toolEventInputSchema>;
export type ToolEventRecorder = (input: ToolEventInput) => Promise<unknown>;

interface ToolEventServiceDependencies {
  insert?: typeof insertEvent;
  appExists?: (appKey: string) => Promise<boolean>;
  id?: () => string;
  now?: () => string;
}

export function createToolEventService(dependencies: ToolEventServiceDependencies = {}) {
  const insert = dependencies.insert ?? insertEvent;
  const appExists = dependencies.appExists ?? (async (appKey: string) => Boolean(await appsRepository.getByKey(appKey)));
  const id = dependencies.id ?? newId;
  const now = dependencies.now ?? (() => new Date().toISOString());

  return {
    async record(rawInput: ToolEventInput) {
      const input = toolEventInputSchema.parse(rawInput);
      if (!await appExists(input.appKey)) throw new Error(`App ${input.appKey} was not found.`);
      return insert({ key: id(), ...input, createdAt: now() });
    },
  };
}

export const toolEventService = createToolEventService();

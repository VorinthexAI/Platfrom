import { AsyncLocalStorage } from 'node:async_hooks';
import type { TokenUsage } from '@/lib/ai/shared/usage';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { APP_KEYS } from '@/lib/apps/registry';
import { appKeySchema } from '@/lib/db/apps.node';
import { toolEventService, type ToolEventInput, type ToolEventRecorder } from './service';

export const TOOL_APP_KEY_HEADER = 'X-Vorinthex-App-Key';

interface MutableUsage extends TokenUsage {
  observed: boolean;
}

interface EventRuntimeContext {
  appKey: string;
  recorder: ToolEventRecorder;
  usage?: MutableUsage;
}

const storage = new AsyncLocalStorage<EventRuntimeContext>();

export function currentEventAppKey(): string {
  return storage.getStore()?.appKey ?? APP_KEYS.CORE;
}

export function runWithEventApp<T>(appKey: string, execute: () => T, recorder: ToolEventRecorder = toolEventService.record) {
  return storage.run({ appKey: appKeySchema.parse(appKey), recorder }, execute);
}

export function addToolTokenUsage(usage: TokenUsage) {
  const active = storage.getStore()?.usage;
  if (!active) return;
  active.observed = true;
  active.inputTokens += usage.inputTokens;
  active.outputTokens += usage.outputTokens;
  active.totalTokens += usage.totalTokens;
}

function actor(context?: ToolContext): Pick<ToolEventInput, 'userId' | 'scopeId'> {
  return {
    userId: context?.principal.kind === 'member' ? context.principal.user.key : null,
    scopeId: context?.runtimeScopeKey ?? null,
  };
}

export async function observeToolExecution<T>(
  slug: string,
  context: ToolContext | undefined,
  execute: () => Promise<T>,
  options: { appKey?: string; recorder?: ToolEventRecorder; sparks?: number } = {},
): Promise<T> {
  const parent = storage.getStore();
  const recorder = options.recorder ?? parent?.recorder;
  const appKey = appKeySchema.parse(options.appKey ?? parent?.appKey ?? APP_KEYS.CORE);
  const usage: MutableUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, observed: false };

  try {
    return await storage.run({ appKey, recorder: recorder ?? toolEventService.record, usage }, execute);
  } finally {
    if (recorder) {
      const metrics = usage.observed
        ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens }
        : {};
      void recorder({ ...actor(context), slug, appKey, ...metrics, ...(options.sparks === undefined ? {} : { sparks: options.sparks }) })
        .catch((error) => console.warn('tool event recording failed', error instanceof Error ? error.message : String(error)));
    }
  }
}

import { currentEventAppScopeKey } from './runtime';
import { toolEventService, type ToolEventRecorder } from './service';

export type AuthMethod = 'google' | 'apple' | 'email';

interface AuthCompletionInput {
  method: AuthMethod;
  userKey: string;
  scopeKey: string;
  wasVerified: boolean;
}

interface AuthCompletionDependencies {
  getAppScopeKey?: typeof currentEventAppScopeKey;
  record?: ToolEventRecorder;
  warn?: (...args: unknown[]) => void;
}

export function authCompletionSlug(method: AuthMethod, wasVerified: boolean) {
  return `auth.completed.${method}.${wasVerified ? 'sign-in' : 'sign-up'}` as const;
}

export async function recordAuthCompletion(input: AuthCompletionInput, dependencies: AuthCompletionDependencies = {}) {
  try {
    const appScopeKey = (dependencies.getAppScopeKey ?? currentEventAppScopeKey)();
    if (!appScopeKey) throw new Error('product scope context required');
    await (dependencies.record ?? toolEventService.record)({
      userId: input.userKey,
      scopeKey: input.scopeKey,
      slug: authCompletionSlug(input.method, input.wasVerified),
      appScopeKey,
    });
  } catch (error) {
    (dependencies.warn ?? console.warn)('auth completion event recording failed', error instanceof Error ? error.message : String(error));
  }
}

import type { RuntimeEventInput } from '@/platform/events';

export type BeaconToolActivityPhase = 'started' | 'completed' | 'failed';

export interface BeaconToolActivity {
  invocationId: string;
  phase: BeaconToolActivityPhase;
  agent: { slug: string; name: string };
  tool: { slug: string; name: string };
  action: { slug: string; name: string };
  elapsedMs?: number;
}

/**
 * Converts trusted runtime events into the deliberately small public shape.
 * Runtime keys, arguments, outputs, failure reasons, and provider data never
 * cross the SSE boundary.
 */
export function createBeaconToolActivityProjector() {
  const publicIds = new Map<string, string>();
  let nextId = 1;

  return (event: RuntimeEventInput): BeaconToolActivity | null => {
    const phase = event.slug === 'tool.called'
      ? 'started'
      : event.slug === 'tool.completed'
        ? 'completed'
        : event.slug === 'tool.failed'
          ? 'failed'
          : null;
    if (!phase) return null;

    const { data } = event;
    const privateId = data.invocationKey ?? data.stepKey;
    if (!privateId || !data.agentSlug || !data.agentName || !data.toolSlug || !data.toolName || !data.actionSlug || !data.actionName) {
      return null;
    }

    let invocationId = publicIds.get(privateId);
    if (!invocationId) {
      invocationId = `tool-${nextId++}`;
      publicIds.set(privateId, invocationId);
    }

    return {
      invocationId,
      phase,
      agent: { slug: data.agentSlug, name: data.agentName },
      tool: { slug: data.toolSlug, name: data.toolName },
      action: { slug: data.actionSlug, name: data.actionName },
      ...(phase !== 'started' && data.elapsedMs !== undefined ? { elapsedMs: data.elapsedMs } : {}),
    };
  };
}

/** Minimal async channel used to yield runtime events while execution runs. */
export class AsyncEventChannel<T> implements AsyncIterable<T> {
  private readonly queued: T[] = [];
  private readonly waiting: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T) {
    if (this.closed) return;
    const resolve = this.waiting.shift();
    if (resolve) resolve({ value, done: false });
    else this.queued.push(value);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const resolve of this.waiting.splice(0)) resolve({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.queued.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.waiting.push(resolve));
      },
    };
  }
}

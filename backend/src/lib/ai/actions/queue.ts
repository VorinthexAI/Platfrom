import type { ActionDefinition, ActionId } from './types';

export const queueAction: ActionDefinition = { id: 'queue', modelPolicy: 'none', models: [] };

export interface QueueActionInput<T> {
  action: ActionId;
  run: () => Promise<T>;
  shouldRetry: (error: unknown) => boolean;
  baseDelayMs?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
}

function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
    const aborted = () => { clearTimeout(timer); reject(signal?.reason ?? new DOMException('The operation was aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, milliseconds);
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

export async function executeQueueAction<T>({ run, shouldRetry, baseDelayMs = 2_000, maxAttempts = 10, signal }: QueueActionInput<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    try { return await run(); } catch (error) {
      if (!shouldRetry(error) || attempt >= maxAttempts - 1) throw error;
      const base = Math.min(30_000, baseDelayMs * 2 ** attempt);
      const delay = base + Math.floor(Math.random() * Math.min(1_000, base / 4));
      await wait(delay, signal);
    }
  }
}

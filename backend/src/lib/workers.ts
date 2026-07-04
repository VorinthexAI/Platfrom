import { functionScheduler, startScheduledFunctions } from '@/core/execution/schedule';
import { startSweaps, sweepScheduler } from '@/lib/sweaps';

export interface AppWorkerConfig {
  slug: string;
  start: () => Promise<unknown>;
  close: () => Promise<void>;
  enabled?: boolean;
}

export function defineAppWorker<const Slug extends string>(config: AppWorkerConfig & { slug: Slug }) {
  return config;
}

export function defineAppWorkerRegistry<const Registry extends Record<string, AppWorkerConfig>>(registry: Registry) {
  for (const [slug, config] of Object.entries(registry)) {
    if (slug !== config.slug) throw new Error(`App worker registry key must match config slug: ${slug} != ${config.slug}`);
  }
  return registry;
}

/*
 * Add future app-started workers here:
 *
 * import { startMyWorker, myWorker } from '@/lib/my-worker';
 *
 * 'my-worker': defineAppWorker({
 *   slug: 'my-worker',
 *   start: () => startMyWorker(),
 *   close: () => myWorker.close(),
 * }),
 */
export const appWorkerRegistry = defineAppWorkerRegistry({
  'scheduled-functions': defineAppWorker({
    slug: 'scheduled-functions',
    start: () => startScheduledFunctions(),
    close: () => functionScheduler.close(),
  }),
  sweaps: defineAppWorker({
    slug: 'sweaps',
    start: () => startSweaps(),
    close: () => sweepScheduler.close(),
  }),
});

export async function startAppWorkers(registry: Record<string, AppWorkerConfig> = appWorkerRegistry) {
  const started = [];
  for (const [slug, config] of Object.entries(registry)) {
    if (config.enabled === false) continue;
    await config.start();
    started.push(slug);
  }
  return started;
}

export async function closeAppWorkers(registry: Record<string, AppWorkerConfig> = appWorkerRegistry) {
  const workers = Object.values(registry).filter((config) => config.enabled !== false).reverse();
  await Promise.all(workers.map((config) => config.close()));
}

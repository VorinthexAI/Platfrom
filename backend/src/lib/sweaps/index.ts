import type { Job } from 'bullmq';
import { createQueue, createWorker } from '@/lib/queue';
import { resendVerificationEmailSweep } from './resend-verification-email';

export type SweepInterval =
  | 'every_15_min'
  | 'every_30_min'
  | 'every_1_h'
  | 'every_2_h'
  | 'every_3_h'
  | 'every_6_h'
  | 'every_12_h'
  | 'every_1_day'
  | 'every_2_days'
  | 'every_3_days'
  | 'every_5_days'
  | 'every_7_days'
  | 'every_14_days'
  | 'every_30_days'
  | `every_${number}_min`
  | `every_${number}_h`
  | `every_${number}_days`;

export interface SweepJobData {
  slug: string;
}

export interface SweepContext {
  job: Job<SweepJobData>;
}

export interface SweepConfig {
  slug: string;
  interval: SweepInterval;
  handler: (context: SweepContext) => Promise<unknown>;
  enabled?: boolean;
  concurrency?: number;
}

const sweepQueueName = 'sweaps:functions';
const sweepJobName = 'sweaps:function';

export const sweepIntervalPresets = {
  every_15_min: 'every_15_min',
  every_30_min: 'every_30_min',
  every_1_h: 'every_1_h',
  every_2_h: 'every_2_h',
  every_3_h: 'every_3_h',
  every_6_h: 'every_6_h',
  every_12_h: 'every_12_h',
  every_1_day: 'every_1_day',
  every_2_days: 'every_2_days',
  every_3_days: 'every_3_days',
  every_5_days: 'every_5_days',
  every_7_days: 'every_7_days',
  every_14_days: 'every_14_days',
  every_30_days: 'every_30_days',
} as const satisfies Record<string, SweepInterval>;

export function defineSweep<const Slug extends string>(config: SweepConfig & { slug: Slug }) {
  return config;
}

export function defineSweepRegistry<const Registry extends Record<string, SweepConfig>>(registry: Registry) {
  for (const [slug, config] of Object.entries(registry)) {
    if (slug !== config.slug) throw new Error(`Sweep registry key must match config slug: ${slug} != ${config.slug}`);
  }
  return registry;
}

export function sweepIntervalToCron(interval: SweepInterval) {
  const match = interval.match(/^every_(\d+)_(min|h|days)$/);
  if (!match) throw new Error(`Unsupported sweep interval: ${interval}`);

  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error(`Sweep interval amount must be a positive integer: ${interval}`);
  }

  if (unit === 'min') {
    if (amount > 59) throw new Error(`Minute sweep interval must be 1-59 for cron: ${interval}`);
    return `*/${amount} * * * *`;
  }

  if (unit === 'h') {
    if (amount > 23) throw new Error(`Hourly sweep interval must be 1-23 for cron: ${interval}`);
    return `0 */${amount} * * *`;
  }

  if (amount > 31) throw new Error(`Day sweep interval must be 1-31 for cron: ${interval}`);
  return `0 0 */${amount} * *`;
}

/*
 * Add new sweeps by:
 * 1. Creating one handler file next to this file, for example `my-sweep.ts`.
 * 2. Importing the handler above.
 * 3. Adding one `defineSweep(...)` entry below with a unique slug.
 */
export const sweepRegistry = defineSweepRegistry({
  'resend-verification-email': defineSweep({
    slug: 'resend-verification-email',
    interval: sweepIntervalPresets.every_12_h,
    handler: async () => resendVerificationEmailSweep(),
  }),
});

class SweepScheduler {
  private queue = createQueue<SweepJobData>(sweepQueueName);
  private worker: ReturnType<typeof createWorker<SweepJobData>> | null = null;

  async sync(registry: Record<string, SweepConfig> = sweepRegistry) {
    for (const [slug, config] of Object.entries(registry)) {
      if (slug !== config.slug) throw new Error(`Sweep slug mismatch: ${slug} != ${config.slug}`);

      if (config.enabled === false) {
        await this.queue.removeJobScheduler(slug);
        continue;
      }

      await this.queue.upsertJobScheduler(
        slug,
        { pattern: sweepIntervalToCron(config.interval) },
        {
          name: sweepJobName,
          data: { slug },
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: 100,
            removeOnFail: 1_000,
          },
        },
      );
    }
  }

  start(registry: Record<string, SweepConfig> = sweepRegistry) {
    if (this.worker) return this.worker;

    const concurrency = Math.max(1, ...Object.values(registry).map((config) => config.concurrency ?? 1));
    this.worker = createWorker<SweepJobData>(
      sweepQueueName,
      async (job) => {
        const config = registry[job.data.slug];
        if (!config || config.enabled === false) throw new Error(`Unknown sweep: ${job.data.slug}`);
        return config.handler({ job });
      },
      concurrency,
    );

    return this.worker;
  }

  async close() {
    await this.worker?.close();
    this.worker = null;
    await this.queue.close();
  }
}

export const sweepScheduler = new SweepScheduler();

export async function startSweaps(registry: Record<string, SweepConfig> = sweepRegistry) {
  await sweepScheduler.sync(registry);
  return sweepScheduler.start(registry);
}

if (import.meta.main) {
  await startSweaps();
  console.log(`Started ${sweepQueueName} worker with ${Object.keys(sweepRegistry).length} sweep(s).`);

  const shutdown = async () => {
    await sweepScheduler.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

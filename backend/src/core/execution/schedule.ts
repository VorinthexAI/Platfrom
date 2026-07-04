import type { Job } from 'bullmq';
import { createQueue, createWorker } from '@/lib/queue';

export type ScheduledCadence =
  | 'hourly'
  | 'daily'
  | 'weekly'
  | `every_${number}_min`
  | `every_${number}m`
  | `every_${number}_hour`
  | `every_${number}_hours`
  | `every_${number}h`;

export interface ScheduledJobData {
  task: string;
}

export interface ScheduledTaskContext {
  job: Job<ScheduledJobData>;
}

export interface ScheduledTaskConfig {
  cadence: ScheduledCadence;
  handler: (context: ScheduledTaskContext) => Promise<void> | void;
  enabled?: boolean;
  concurrency?: number;
}

export type ScheduledTaskRegistry = Record<string, ScheduledTaskConfig>;

const scheduledQueueName = 'scheduled:functions';
const scheduledJobName = 'scheduled:function';

/*
 * Import standalone functions here and add them to this registry, for example:
 *
 * export const scheduledTaskRegistry = {
 *   refreshMetrics: {
 *     cadence: 'every_5_min',
 *     handler: async () => refreshMetrics(),
 *   },
 * } satisfies ScheduledTaskRegistry;
 */
export const scheduledTaskRegistry = {} satisfies ScheduledTaskRegistry;

export function cadenceToCron(cadence: ScheduledCadence) {
  if (cadence === 'hourly') return '0 * * * *';
  if (cadence === 'daily') return '0 0 * * *';
  if (cadence === 'weekly') return '0 0 * * 0';

  const match = cadence.match(/^every_(\d+)(?:_(min|hour|hours)|m|h)$/);
  if (!match) throw new Error(`Unsupported cadence: ${cadence}`);

  const amount = Number(match[1]);
  const unit = cadence.endsWith('m') || cadence.endsWith('_min') ? 'minutes' : 'hours';
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error(`Cadence amount must be a positive integer: ${cadence}`);
  }

  if (unit === 'minutes') {
    if (amount > 59) throw new Error(`Minute cadence must be 1-59 for cron: ${cadence}`);
    return `*/${amount} * * * *`;
  }

  if (amount > 23) throw new Error(`Hourly cadence must be 1-23 for cron: ${cadence}`);
  return `0 */${amount} * * *`;
}

class FunctionScheduler {
  private queue = createQueue<ScheduledJobData>(scheduledQueueName);
  private worker: ReturnType<typeof createWorker<ScheduledJobData>> | null = null;

  async sync(registry: ScheduledTaskRegistry = scheduledTaskRegistry) {
    for (const [task, config] of Object.entries(registry)) {
      if (config.enabled === false) {
        await this.queue.removeJobScheduler(task);
        continue;
      }

      await this.queue.upsertJobScheduler(
        task,
        { pattern: cadenceToCron(config.cadence) },
        {
          name: scheduledJobName,
          data: { task },
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

  start(registry: ScheduledTaskRegistry = scheduledTaskRegistry) {
    if (this.worker) return this.worker;

    const concurrency = Math.max(1, ...Object.values(registry).map((config) => config.concurrency ?? 1));
    this.worker = createWorker<ScheduledJobData>(
      scheduledQueueName,
      async (job) => {
        const config = registry[job.data.task];
        if (!config || config.enabled === false) throw new Error(`Unknown scheduled task: ${job.data.task}`);
        await config.handler({ job });
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

export const functionScheduler = new FunctionScheduler();

export async function startScheduledFunctions(registry: ScheduledTaskRegistry = scheduledTaskRegistry) {
  await functionScheduler.sync(registry);
  return functionScheduler.start(registry);
}

if (import.meta.main) {
  await startScheduledFunctions();
  console.log(`Started ${scheduledQueueName} worker with ${Object.keys(scheduledTaskRegistry).length} scheduled task(s).`);

  const shutdown = async () => {
    await functionScheduler.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

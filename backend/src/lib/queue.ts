import { Queue, Worker, type Processor } from 'bullmq';
import IORedis from 'ioredis';

export const redisConnection = new IORedis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380', {
  maxRetriesPerRequest: null,
});

export function normalizeQueueName(name: string) {
  return name.replaceAll(':', '-');
}

export function createQueue<Data = unknown>(name: string) {
  return new Queue<Data>(normalizeQueueName(name), { connection: redisConnection as any });
}

export function createWorker<Data = unknown>(name: string, handler: Processor<Data>, concurrency = 1) {
  return new Worker<Data>(normalizeQueueName(name), handler, { connection: redisConnection as any, concurrency });
}

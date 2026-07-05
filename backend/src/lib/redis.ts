import IORedis from 'ioredis';

export const redisConnection = new IORedis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380', {
  maxRetriesPerRequest: null,
});

import IORedis from 'ioredis';

// lazyConnect: short-lived CLI scripts (migrations and seeds)
// import backend modules that transitively touch this client (e.g. auth.ts
// -> auth-handoff.ts) without ever issuing a Redis command. Without
// lazyConnect, the client connects immediately on import and retries
// forever when no Redis is reachable, keeping the process alive and the
// script hanging long after its real work is done. Deferring the
// connection to the first actual command fixes that for scripts while
// staying transparent for the long-running server (it just connects on
// its first real use, e.g. the first rate-limited request).
export function createRedisConnection(url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6380') {
  return new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
}

export const redisConnection = createRedisConnection();

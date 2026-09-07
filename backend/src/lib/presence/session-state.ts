import { redisConnection } from '@/lib/redis';

const SESSION_PREFIX = 'presence:s:';
const REVOKED_PREFIX = 'presence:revoked:';
const REVOKED_USER_PREFIX = 'presence:revoked-user:';
const USER_SESSIONS_PREFIX = 'presence:user-sessions:';
const REVOCATION_TTL_SECONDS = 120;
const USER_REVOCATION_TTL_SECONDS = 600;

type PresenceRedis = Pick<typeof redisConnection, 'eval'>;
type PresenceLookupRedis = Pick<typeof redisConnection, 'pipeline'>;

export async function createPresenceSession(sessionKey: string, userKey: string | null, value: string, ttlSeconds: number, redis: PresenceRedis = redisConnection): Promise<boolean> {
  const result = await redis.eval(
    'if redis.call("exists", KEYS[2]) == 1 or redis.call("exists", KEYS[3]) == 1 then return 0 end redis.call("set", KEYS[1], ARGV[1], "EX", ARGV[2]) if ARGV[3] ~= "" then local now = redis.call("time")[1] redis.call("zremrangebyscore", KEYS[4], "-inf", now) redis.call("zadd", KEYS[4], now + tonumber(ARGV[2]), ARGV[3]) redis.call("expire", KEYS[4], ARGV[2]) end return 1',
    4,
    SESSION_PREFIX + sessionKey,
    REVOKED_PREFIX + sessionKey,
    userKey ? REVOKED_USER_PREFIX + userKey : REVOKED_USER_PREFIX,
    userKey ? USER_SESSIONS_PREFIX + userKey : USER_SESSIONS_PREFIX,
    value,
    String(ttlSeconds),
    userKey ? sessionKey : '',
  );
  return Number(result) === 1;
}

export async function refreshPresenceSession(sessionKey: string, userKey: string | null, value: string, ttlSeconds: number, redis: PresenceRedis = redisConnection): Promise<boolean> {
  const result = await redis.eval(
    'if redis.call("exists", KEYS[2]) == 1 or redis.call("exists", KEYS[3]) == 1 or redis.call("exists", KEYS[1]) == 0 then return 0 end redis.call("set", KEYS[1], ARGV[1], "EX", ARGV[2]) if ARGV[3] ~= "" then local now = redis.call("time")[1] redis.call("zremrangebyscore", KEYS[4], "-inf", now) redis.call("zadd", KEYS[4], now + tonumber(ARGV[2]), ARGV[3]) redis.call("expire", KEYS[4], ARGV[2]) end return 1',
    4,
    SESSION_PREFIX + sessionKey,
    REVOKED_PREFIX + sessionKey,
    userKey ? REVOKED_USER_PREFIX + userKey : REVOKED_USER_PREFIX,
    userKey ? USER_SESSIONS_PREFIX + userKey : USER_SESSIONS_PREFIX,
    value,
    String(ttlSeconds),
    userKey ? sessionKey : '',
  );
  return Number(result) === 1;
}

export async function invalidatePresenceSessions(userKey: string, sessionKeys: string[], redis: PresenceRedis = redisConnection): Promise<void> {
  await redis.eval('redis.call("set", KEYS[1], "1", "EX", ARGV[1]) return redis.call("del", KEYS[2])', 2, REVOKED_USER_PREFIX + userKey, USER_SESSIONS_PREFIX + userKey, String(USER_REVOCATION_TTL_SECONDS));
  for (const sessionKey of new Set(sessionKeys)) {
    await redis.eval(
      'redis.call("set", KEYS[2], "1", "EX", ARGV[1]) return redis.call("del", KEYS[1])',
      2,
      SESSION_PREFIX + sessionKey,
      REVOKED_PREFIX + sessionKey,
      String(REVOCATION_TTL_SECONDS),
    );
  }
}

export async function leavePresenceSession(sessionKey: string, userKey: string | null, redis: PresenceRedis = redisConnection): Promise<void> {
  await redis.eval('redis.call("del", KEYS[1]) if ARGV[1] ~= "" then local now = redis.call("time")[1] redis.call("zrem", KEYS[2], ARGV[1]) redis.call("zremrangebyscore", KEYS[2], "-inf", now) if redis.call("zcard", KEYS[2]) == 0 then redis.call("del", KEYS[2]) end end return 1', 2, SESSION_PREFIX + sessionKey, userKey ? USER_SESSIONS_PREFIX + userKey : USER_SESSIONS_PREFIX, userKey ? sessionKey : '');
}

export async function getActivePresenceUserKeys(userKeys: readonly string[], redis: PresenceLookupRedis = redisConnection): Promise<Set<string>> {
  const unique = [...new Set(userKeys)];
  if (!unique.length) return new Set();
  const pipeline = redis.pipeline();
  for (const userKey of unique) pipeline.eval('local now = redis.call("time")[1] redis.call("zremrangebyscore", KEYS[1], "-inf", now) return redis.call("zcard", KEYS[1])', 1, USER_SESSIONS_PREFIX + userKey);
  const results = await pipeline.exec();
  if (!results || results.length !== unique.length) throw new Error('Presence lookup did not return every requested user.');
  return new Set(unique.filter((_key, index) => {
    const [error, rawCount] = results[index]!;
    if (error) throw error;
    const count = Number(rawCount);
    if (!Number.isFinite(count) || count < 0) throw new Error('Presence lookup returned an invalid lease count.');
    return count > 0;
  }));
}

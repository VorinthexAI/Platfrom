import { describe, expect, test } from 'bun:test';
import { createPresenceSession, getActivePresenceUserKeys, invalidatePresenceSessions, leavePresenceSession, refreshPresenceSession } from './session-state';

describe('presence session state', () => {
  test('installs a user fence before atomically tombstoning account sessions', async () => {
    const calls: unknown[][] = [];
    const redis = { eval: async (...args: unknown[]) => { calls.push(args); return 1; } };
    await invalidatePresenceSessions('user-1', ['one', 'one', 'two'], redis as never);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.slice(1)).toEqual([2, 'presence:revoked-user:user-1', 'presence:user-sessions:user-1', '600']);
    expect(calls[1]?.slice(1)).toEqual([2, 'presence:s:one', 'presence:revoked:one', '120']);
  });

  test('join and heartbeat scripts atomically reject user or session tombstones', async () => {
    const calls: unknown[][] = [];
    const redis = { eval: async (...args: unknown[]) => { calls.push(args); return 1; } };
    await expect(createPresenceSession('one', 'user-1', '{}', 45, redis as never)).resolves.toBe(true);
    await expect(refreshPresenceSession('one', 'user-1', '{"p":[]}', 45, redis as never)).resolves.toBe(true);
    expect(calls[0]?.slice(1)).toEqual([4, 'presence:s:one', 'presence:revoked:one', 'presence:revoked-user:user-1', 'presence:user-sessions:user-1', '{}', '45', 'one']);
    expect(calls[1]?.slice(1)).toEqual([4, 'presence:s:one', 'presence:revoked:one', 'presence:revoked-user:user-1', 'presence:user-sessions:user-1', '{"p":[]}', '45', 'one']);
    await expect(createPresenceSession('one', 'user-1', '{}', 45, { eval: async () => 0 } as never)).resolves.toBe(false);
  });

  test('leaving removes only the current device lease', async () => {
    const calls: unknown[][] = [];
    await leavePresenceSession('one', 'user-1', { eval: async (...args: unknown[]) => { calls.push(args); return 1; } } as never);
    expect(calls[0]?.slice(1)).toEqual([2, 'presence:s:one', 'presence:user-sessions:user-1', 'one']);
  });

  test('deduplicates users and maps mixed active leases without extra Redis work', async () => {
    const calls: unknown[][] = [];
    const pipeline = {
      eval: (...args: unknown[]) => { calls.push(args); return pipeline; },
      exec: async () => [[null, 2], [null, 0]],
    };
    const active = await getActivePresenceUserKeys(['user-1', 'user-1', 'user-2'], { pipeline: () => pipeline } as never);
    expect(active).toEqual(new Set(['user-1']));
    expect(calls.map((call) => call.slice(1))).toEqual([[1, 'presence:user-sessions:user-1'], [1, 'presence:user-sessions:user-2']]);
  });

  test('does not contact Redis for an empty presence lookup', async () => {
    let pipelines = 0;
    await expect(getActivePresenceUserKeys([], { pipeline: () => { pipelines += 1; throw new Error('unexpected'); } } as never)).resolves.toEqual(new Set());
    expect(pipelines).toBe(0);
  });

  test('fails closed when any presence pipeline result is missing or errored', async () => {
    const lookup = (results: unknown) => ({ pipeline: () => { const pipeline = { eval: () => pipeline, exec: async () => results }; return pipeline; } } as never);
    await expect(getActivePresenceUserKeys(['user-1'], lookup(null))).rejects.toThrow('every requested user');
    await expect(getActivePresenceUserKeys(['user-1', 'user-2'], lookup([[null, 1]]))).rejects.toThrow('every requested user');
    await expect(getActivePresenceUserKeys(['user-1'], lookup([[new Error('redis unavailable'), null]]))).rejects.toThrow('redis unavailable');
    await expect(getActivePresenceUserKeys(['user-1'], lookup([[null, 'invalid']]))).rejects.toThrow('invalid lease count');
  });
});

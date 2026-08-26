import { describe, expect, test } from 'bun:test';
import { drainStorageDeletionJobs } from './storage-deletion';

describe('storage deletion outbox', () => {
  test('acknowledges only successful object deletion and retries retained jobs', async () => {
    const jobs = [{ key: 'one', storageKey: 'objects/one', createdAt: '2026-08-19T00:00:00.000Z', status: 'deleting' as const, claimToken: '11111111-1111-4111-8111-111111111111', claimedAt: '2026-08-19T00:00:01.000Z' }];
    const acknowledged: string[] = [];
    let available = false;
    const dependencies = {
      list: async () => jobs,
      acknowledge: async (key: string) => { acknowledged.push(key); return true; },
      release: async () => true,
      referenced: async () => false,
      storage: { delete: async () => { if (!available) throw new Error('offline'); } },
    };
    expect(await drainStorageDeletionJobs(100, dependencies)).toEqual({ deleted: 0, pending: 1 });
    expect(acknowledged).toEqual([]);
    available = true;
    expect(await drainStorageDeletionJobs(100, dependencies)).toEqual({ deleted: 1, pending: 0 });
    expect(acknowledged).toEqual(['one']);
  });

  test('drops stale deletion jobs without deleting objects that became referenced', async () => {
    const acknowledged: string[] = []; let deleted = false;
    const result = await drainStorageDeletionJobs(100, {
      list: async () => [{ key: 'one', storageKey: 'objects/adopted', createdAt: '2026-08-19T00:00:00.000Z', status: 'deleting', claimToken: '11111111-1111-4111-8111-111111111111', claimedAt: '2026-08-19T00:00:01.000Z' }],
      referenced: async () => true,
      acknowledge: async (key) => { acknowledged.push(key); return true; },
      storage: { delete: async () => { deleted = true; } },
    });
    expect(result).toEqual({ deleted: 0, pending: 0 });
    expect(acknowledged).toEqual(['one']);
    expect(deleted).toBe(false);
  });

  test('uses expiring reservations, stale-claim recovery, and atomic token-fenced reference acknowledgement', async () => {
    const source = await Bun.file(new URL('./db/storage-deletion-jobs.node.ts', import.meta.url)).text();
    expect(source).toContain('UPDATE job WITH { status: "deleting", claimToken: @claimToken');
    expect(source).toContain('job.status == "deleting" && job.claimToken == @claimToken');
    expect(source).toContain('job.status == "reserved" && job.reservationExpiresAt <= @claimedAt');
    expect(source).toContain('job.status == "deleting" && job.claimedAt <= @staleBefore');
    expect(source).toContain('status: "reserved", reservationExpiresAt: @reservationExpiresAt, claimToken: @token');
    expect(source).toContain('job.status == "reserved" && job.claimToken == @token');
    expect(source).toContain('LET referenced = ${storageReferenceAql}');
    expect(source).toContain('UPDATE job WITH { claimedAt: @decidedAt }');
  });

  test('does not delete after an atomically resolved reference race', async () => {
    let deleted = false;
    const result = await drainStorageDeletionJobs(1, {
      list: async () => [{ key: 'race', storageKey: 'objects/race', createdAt: '2026-08-19T00:00:00.000Z', status: 'deleting', claimToken: '11111111-1111-4111-8111-111111111111', claimedAt: '2026-08-19T00:00:01.000Z' }],
      resolveClaim: async () => 'referenced',
      storage: { delete: async () => { deleted = true; } },
    });
    expect(result).toEqual({ deleted: 0, pending: 0 });
    expect(deleted).toBe(false);
  });

  test('keeps a crashed deletion pending when its reclaimed token loses the acknowledgement fence', async () => {
    let released = false;
    const result = await drainStorageDeletionJobs(1, {
      list: async () => [{ key: 'crash', storageKey: 'objects/crash', createdAt: '2026-08-19T00:00:00.000Z', status: 'deleting', claimToken: '22222222-2222-4222-8222-222222222222', claimedAt: '2026-08-19T00:00:01.000Z' }],
      resolveClaim: async () => 'unreferenced',
      acknowledge: async () => false,
      release: async () => { released = true; return false; },
      storage: { delete: async () => {} },
    });
    expect(result).toEqual({ deleted: 0, pending: 1 });
    expect(released).toBe(true);
  });

  test('renews the token-fenced claim throughout a slow object delete', async () => {
    let finishDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => { finishDelete = resolve; });
    let renewals = 0;
    const draining = drainStorageDeletionJobs(1, {
      list: async () => [{ key: 'slow', storageKey: 'objects/slow', createdAt: '2026-08-19T00:00:00.000Z', status: 'deleting', claimToken: '44444444-4444-4444-8444-444444444444', claimedAt: '2026-08-19T00:00:01.000Z' }],
      resolveClaim: async () => 'unreferenced',
      renew: async (key, storageKey, token) => { expect([key, storageKey, token]).toEqual(['slow', 'objects/slow', '44444444-4444-4444-8444-444444444444']); renewals += 1; return true; },
      acknowledge: async () => true,
      heartbeatMs: 5,
      storage: { delete: async () => deleteGate },
    });
    await new Promise((resolve) => setTimeout(resolve, 55));
    expect(renewals).toBeGreaterThanOrEqual(2);
    finishDelete();
    await expect(draining).resolves.toEqual({ deleted: 1, pending: 0 });
  });

  test('never deletes when a stale worker has already lost its claim token', async () => {
    let deleted = false;
    const result = await drainStorageDeletionJobs(1, {
      list: async () => [{ key: 'lost', storageKey: 'objects/lost', createdAt: '2026-08-19T00:00:00.000Z', status: 'deleting', claimToken: '33333333-3333-4333-8333-333333333333', claimedAt: '2026-08-19T00:00:01.000Z' }],
      resolveClaim: async () => 'lost',
      release: async () => false,
      storage: { delete: async () => { deleted = true; } },
    });
    expect(result).toEqual({ deleted: 0, pending: 1 });
    expect(deleted).toBe(false);
  });
});

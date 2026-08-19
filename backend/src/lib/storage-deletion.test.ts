import { describe, expect, test } from 'bun:test';
import { drainStorageDeletionJobs } from './storage-deletion';

describe('storage deletion outbox', () => {
  test('acknowledges only successful object deletion and retries retained jobs', async () => {
    const jobs = [{ key: 'one', storageKey: 'objects/one', createdAt: '2026-08-19T00:00:00.000Z' }];
    const acknowledged: string[] = [];
    let available = false;
    const dependencies = {
      list: async () => jobs,
      acknowledge: async (key: string) => { acknowledged.push(key); return true; },
      storage: { delete: async () => { if (!available) throw new Error('offline'); } },
    };
    expect(await drainStorageDeletionJobs(100, dependencies)).toEqual({ deleted: 0, pending: 1 });
    expect(acknowledged).toEqual([]);
    available = true;
    expect(await drainStorageDeletionJobs(100, dependencies)).toEqual({ deleted: 1, pending: 0 });
    expect(acknowledged).toEqual(['one']);
  });
});

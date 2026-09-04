import { describe, expect, test } from 'bun:test';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { deleteStorageObjectsBulk, drainStorageDeletionJobs } from './storage-deletion';

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
    for (const collection of ['books', 'bookChapters', 'emailAttachments', 'placeHeroMedia']) expect(source).toContain(`FOR ${collection === 'books' ? 'book' : collection === 'bookChapters' ? 'chapter' : collection === 'emailAttachments' ? 'attachment' : 'media'} IN ${collection}`);
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

  test('sends exactly 1000 keys in one bulk S3 request and rejects larger requests', async () => {
    const commands: DeleteObjectsCommand[] = [];
    const keys = Array.from({ length: 1000 }, (_, index) => `objects/${index}`);
    const client = { async send(command: DeleteObjectsCommand) { commands.push(command); return { Deleted: keys.map((Key) => ({ Key })) }; } };
    await expect(deleteStorageObjectsBulk(keys, client, 'bucket')).resolves.toEqual({ succeeded: keys, failed: [] });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(DeleteObjectsCommand);
    expect(commands[0]!.input.Delete?.Objects).toHaveLength(1000);
    await expect(deleteStorageObjectsBulk([...keys, 'objects/1000'], client, 'bucket')).rejects.toThrow('at most 1000');
  });

  test('bulk deletion excludes referenced and lost claims, acknowledges successes, and releases only failures', async () => {
    const token = '11111111-1111-4111-8111-111111111111';
    const jobs = ['success', 'failed', 'referenced', 'lost'].map((key) => ({ key, storageKey: `objects/${key}`, createdAt: '2026-08-19T00:00:00.000Z', status: 'deleting' as const, claimToken: token, claimedAt: '2026-08-19T00:00:01.000Z' }));
    const sent: string[][] = [], acknowledged: string[] = [], released: string[] = [], closed: string[][] = [];
    const result = await drainStorageDeletionJobs(1000, {
      list: async () => jobs,
      resolveClaim: async (key) => key === 'referenced' ? 'referenced' : key === 'lost' ? 'lost' : 'unreferenced',
      bulkDelete: async (keys) => { sent.push(keys); return { succeeded: ['objects/success'], failed: ['objects/failed'] }; },
      acknowledge: async (key) => { acknowledged.push(key); return true; },
      release: async (key) => { released.push(key); return true; },
      closeInventory: async (keys) => { closed.push(keys); },
    });
    expect(sent).toEqual([['objects/success', 'objects/failed']]);
    expect(acknowledged).toEqual(['success']);
    expect(released).toEqual(['lost', 'failed']);
    expect(closed).toEqual([['objects/success']]);
    expect(result).toEqual({ deleted: 1, pending: 2 });
  });
});

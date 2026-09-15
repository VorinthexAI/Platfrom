import { expect, test } from 'bun:test';
import { attachmentExportJobSchema, recoverAttachmentExports } from './attachment-export-queue';

const key = 'cmrnlzf640001qc7kazsr96k5';

test('recovers durable attachment exports after queue failure using stable deduplicated jobs', async () => {
  const database = { query: async () => ({ all: async () => [key] }) } as never;
  await expect(recoverAttachmentExports({ add: async () => { throw new Error('Redis unavailable'); } } as never, database)).rejects.toThrow('Redis unavailable');
  const jobs: unknown[] = [];
  const queue = { add: async (...args: unknown[]) => { jobs.push(args); } } as never;
  await recoverAttachmentExports(queue, database);
  await recoverAttachmentExports(queue, database);
  expect(jobs).toHaveLength(2);
  expect(jobs[0]).toEqual(jobs[1]);
  expect(jobs[0]).toEqual(['export', { attachmentKey: key }, expect.objectContaining({ jobId: key, attempts: 8, removeOnComplete: true, removeOnFail: true })]);
  expect(() => attachmentExportJobSchema.parse({ attachmentKey: key, userKey: key })).toThrow();
});

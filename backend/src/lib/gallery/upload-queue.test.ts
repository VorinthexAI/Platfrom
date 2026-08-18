import { describe, expect, test } from 'bun:test';
import { GALLERY_UPLOAD_PROCESSING_LEASE_MS, galleryUploadFailureStatus, galleryUploadJobSchema, galleryUploadStaleBefore } from './upload-queue';

const key = (suffix: string) => `cmrnlzf650002qc7k4p5zem${suffix}`;

describe('Gallery upload queue contract', () => {
  test('accepts one durable batch of up to twenty uploads', () => {
    expect(galleryUploadJobSchema.parse({ schemaVersion: 1, uploadKeys: [key('5w')] }).uploadKeys).toHaveLength(1);
    expect(() => galleryUploadJobSchema.parse({ schemaVersion: 1, uploadKeys: [] })).toThrow();
    expect(() => galleryUploadJobSchema.parse({ schemaVersion: 1, uploadKeys: [key('5w'), key('5w')] })).toThrow('unique');
    expect(() => galleryUploadJobSchema.parse({ schemaVersion: 1, uploadKeys: Array.from({ length: 21 }, (_, index) => key(index.toString(36).padStart(2, '0'))) })).toThrow();
  });

  test('runs a same-server BullMQ worker with retry and startup recovery', async () => {
    const source = await Bun.file(new URL('./upload-queue.ts', import.meta.url)).text();
    expect(source).toContain("new Worker<GalleryUploadJob, GalleryUploadResult>(QUEUE_NAME");
    expect(source).toContain('processGalleryUploadBatch');
    expect(source).toContain('attempts: 3');
    expect(source).toContain('recoverUploadQueue');
    expect(await Bun.file(new URL('./upload-processing.ts', import.meta.url)).text()).toContain('setInterval');
    expect(source).toContain("getJobs(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children']");
  });

  test('uses a thirty-minute stale-processing lease and excludes active workers', () => {
    const now = new Date('2026-08-18T13:00:00.000Z');
    expect(GALLERY_UPLOAD_PROCESSING_LEASE_MS).toBe(30 * 60_000);
    expect(galleryUploadStaleBefore(now)).toBe('2026-08-18T12:30:00.000Z');
  });

  test('keeps uploads retryable until BullMQ exhausts all attempts', () => {
    expect(galleryUploadFailureStatus(0, 3)).toBe('queued');
    expect(galleryUploadFailureStatus(1, 3)).toBe('queued');
    expect(galleryUploadFailureStatus(2, 3)).toBe('failed');
  });
});

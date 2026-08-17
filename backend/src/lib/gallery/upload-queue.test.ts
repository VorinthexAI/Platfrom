import { describe, expect, test } from 'bun:test';
import { galleryUploadFailureStatus, galleryUploadJobSchema } from './upload-queue';

const key = (suffix: string) => `cmrnlzf650002qc7k4p5zem${suffix}`;

describe('Gallery upload queue contract', () => {
  test('accepts one durable batch of up to twenty uploads', () => {
    expect(galleryUploadJobSchema.parse({ schemaVersion: 1, uploadKeys: [key('5w')] }).uploadKeys).toHaveLength(1);
    expect(() => galleryUploadJobSchema.parse({ schemaVersion: 1, uploadKeys: [] })).toThrow();
    expect(() => galleryUploadJobSchema.parse({ schemaVersion: 1, uploadKeys: Array.from({ length: 21 }, (_, index) => key(index.toString(36).padStart(2, '0'))) })).toThrow();
  });

  test('runs a same-server BullMQ worker with retry and startup recovery', async () => {
    const source = await Bun.file(new URL('./upload-queue.ts', import.meta.url)).text();
    expect(source).toContain("new Worker<GalleryUploadJob, GalleryUploadResult>(QUEUE_NAME");
    expect(source).toContain('processGalleryUploadBatch');
    expect(source).toContain('attempts: 3');
    expect(source).toContain('listRecoverableUploads');
    expect(source).toContain("getJobs(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children']");
  });

  test('keeps uploads retryable until BullMQ exhausts all attempts', () => {
    expect(galleryUploadFailureStatus(0, 3)).toBe('queued');
    expect(galleryUploadFailureStatus(1, 3)).toBe('queued');
    expect(galleryUploadFailureStatus(2, 3)).toBe('failed');
  });
});

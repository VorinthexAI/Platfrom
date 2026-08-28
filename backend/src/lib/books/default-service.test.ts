import { describe, expect, test } from 'bun:test';
import { createCachedUrlSigner } from './default-service';

describe('book URL signing', () => {
  test('reuses a signed URL until its cache lifetime expires', async () => {
    let now = 0;
    let calls = 0;
    const sign = createCachedUrlSigner(async (key) => `${key}:${++calls}`, { cacheMs: 100, now: () => now });

    expect(await sign('cover')).toBe('cover:1');
    now = 99;
    expect(await sign('cover')).toBe('cover:1');
    now = 100;
    expect(await sign('cover')).toBe('cover:2');
  });

  test('deduplicates concurrent requests and retries rejected signing', async () => {
    let calls = 0;
    let resolve!: (url: string) => void;
    const sign = createCachedUrlSigner(() => {
      calls += 1;
      return calls === 1 ? new Promise<string>((done) => { resolve = done; }) : calls === 2 ? Promise.reject(new Error('failed')) : Promise.resolve('recovered');
    });

    const first = sign('cover');
    const second = sign('cover');
    expect(calls).toBe(1);
    resolve('shared');
    expect(await Promise.all([first, second])).toEqual(['shared', 'shared']);

    await expect(sign('other')).rejects.toThrow('failed');
    expect(await sign('other')).toBe('recovered');
  });

  test('bounds retained storage keys', async () => {
    let calls = 0;
    const sign = createCachedUrlSigner(async (key) => `${key}:${++calls}`, { maxEntries: 2 });
    await sign('one');
    await sign('two');
    await sign('three');
    expect(await sign('one')).toBe('one:4');
  });
});

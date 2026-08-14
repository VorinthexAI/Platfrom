import { describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { mergeMp3Chunks } from './merge-mp3';

describe('merge MP3 chunks', () => {
  test('normalizes a single provider chunk through ffmpeg', async () => {
    let called = false;
    const output = await mergeMp3Chunks([new Uint8Array([1, 2, 3])], undefined, async (args) => {
      called = true;
      await writeFile(args.at(-1)!, new Uint8Array([4, 5, 6]));
    });
    expect(called).toBe(true);
    expect([...output]).toEqual([4, 5, 6]);
  });

  test('rejects an empty narration', async () => {
    await expect(mergeMp3Chunks([])).rejects.toThrow('At least one');
  });

  test('writes an ordered concat manifest and returns the normalized output', async () => {
    let manifest = '';
    const output = await mergeMp3Chunks([new Uint8Array([1]), new Uint8Array([2])], undefined, async (args) => {
      const manifestPath = args[args.indexOf('-i') + 1]!;
      manifest = await readFile(manifestPath, 'utf8');
      await writeFile(args.at(-1)!, new Uint8Array([9, 8, 7]));
    });
    expect(manifest.split('\n')).toHaveLength(2);
    expect(manifest).toContain('0000.mp3');
    expect(manifest).toContain('0001.mp3');
    expect([...output]).toEqual([9, 8, 7]);
  });

  test('rejects oversized ffmpeg output before reading it', async () => {
    await expect(mergeMp3Chunks([new Uint8Array([1])], undefined, async (args) => {
      await writeFile(args.at(-1)!, new Uint8Array([1, 2, 3]));
    }, 2)).rejects.toThrow('2-byte limit');
  });
});

import { describe, expect, test } from 'bun:test';
import { findRedundantGalleryImageKeys } from './gallery-duplicates';

const at = (key: string, createdAt: string, perceptualHash: string) => ({ key, createdAt, perceptualHash });

describe('Gallery duplicate clustering', () => {
  test('keeps the oldest image and returns two redundant copies from a group of three', () => {
    expect(findRedundantGalleryImageKeys([
      at('keeper', '2026-08-11T10:00:00.000Z', '0000000000000000'),
      at('copy-1', '2026-08-11T11:00:00.000Z', '0000000000000001'),
      at('copy-2', '2026-08-11T12:00:00.000Z', '0000000000000003'),
    ])).toEqual(['copy-1', 'copy-2']);
  });

  test('does not return visually distinct or unpaired images', () => {
    expect(findRedundantGalleryImageKeys([
      at('first', '2026-08-11T10:00:00.000Z', '0000000000000000'),
      at('second', '2026-08-11T11:00:00.000Z', 'ffffffffffffffff'),
    ])).toEqual([]);
  });

  test('retains an active Subject reference even when it is newer', () => {
    expect(findRedundantGalleryImageKeys([
      { ...at('older', '2026-08-11T10:00:00.000Z', '0000000000000000') },
      { ...at('subject-reference', '2026-08-11T11:00:00.000Z', '0000000000000001'), protected: true },
    ])).toEqual(['older']);
  });

  test('never returns any protected reference when a cluster has several', () => {
    expect(findRedundantGalleryImageKeys([
      { ...at('reference-1', '2026-08-11T10:00:00.000Z', '0000000000000000'), protected: true },
      { ...at('reference-2', '2026-08-11T11:00:00.000Z', '0000000000000001'), protected: true },
      at('copy', '2026-08-11T12:00:00.000Z', '0000000000000003'),
    ])).toEqual(['copy']);
  });

  test('is deterministic for shuffled equal-time inputs and lexical key ties', () => {
    const first = at('a-copy', '2026-08-11T10:00:00.000Z', '0000000000000001');
    const keeper = at('a-keeper', '2026-08-11T10:00:00.000Z', '0000000000000000');
    expect(findRedundantGalleryImageKeys([first, keeper])).toEqual(['a-keeper']);
    expect(findRedundantGalleryImageKeys([keeper, first])).toEqual(['a-keeper']);
  });

  test('clusters transitive near matches before selecting redundant images', () => {
    expect(findRedundantGalleryImageKeys([
      at('keeper', '2026-08-11T10:00:00.000Z', '0000000000000000'),
      at('bridge', '2026-08-11T11:00:00.000Z', '0000000000000007'),
      at('edge', '2026-08-11T12:00:00.000Z', '0000000000000037'),
    ])).toEqual(['bridge', 'edge']);
  });
});

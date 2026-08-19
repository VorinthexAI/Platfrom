import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { imageSchema } from '@/lib/db/images.node';
import { highlightTargetCount, selectHighlightCandidates } from './highlight-selection';

const candidate = (embedding: number[], qualityScore = 50) => {
  const now = new Date().toISOString();
  const vector = Array.from({ length: 4096 }, (_, index) => embedding[index] ?? 0);
  return { qualityScore, image: imageSchema.parse({ key: newId(), scopeKey: newId(), filename: 'image.jpg', caption: 'Image', storageKey: newId(), mimeType: 'image/jpeg', sizeBytes: 1, width: 1, height: 1, embedding: vector, createdByKey: null, isFavorite: false, createdAt: now, updatedAt: now }) };
};

describe('highlight selection', () => {
  test('handles empty and small collections without a minimum-image failure', () => {
    expect(highlightTargetCount(0, () => 0)).toBe(0);
    expect(highlightTargetCount(3, () => 0.99)).toBe(3);
    expect(selectHighlightCandidates([], () => 0)).toEqual([]);
    expect(selectHighlightCandidates([candidate([1]), candidate([1]), candidate([1])], () => 0.5)).toHaveLength(3);
  });

  test('weights 8 through 10 above each lower target and caps to availability', () => {
    const counts = new Map<number, number>();
    for (let index = 0; index < 18_000; index += 1) {
      const count = highlightTargetCount(20, () => (index + 0.5) / 18_000);
      counts.set(count, (counts.get(count) ?? 0) + 1);
    }
    expect(counts.get(8)).toBeGreaterThan(counts.get(7)!);
    expect(counts.get(9)).toBeGreaterThan(counts.get(7)!);
    expect(counts.get(10)).toBeGreaterThan(counts.get(7)!);
    expect(highlightTargetCount(6, () => 0.999)).toBe(6);
  });

  test('always fills the target even when every image embedding is identical', () => {
    const candidates = Array.from({ length: 12 }, (_, index) => candidate([1, 0], index + 1));
    const selected = selectHighlightCandidates(candidates, () => 0.999);
    expect(selected).toHaveLength(10);
    expect(new Set(selected.map(({ image }) => image.key)).size).toBe(10);
  });

  test('uses quality and embedding diversity only as soft ranking signals', () => {
    const candidates = [candidate([1, 0], 100), candidate([0, 1], 90), ...Array.from({ length: 9 }, () => candidate([1, 0], 1))];
    const values = [0, ...Array(200).fill(0)];
    const selected = selectHighlightCandidates(candidates, () => values.shift() ?? 0);
    expect(selected).toHaveLength(5);
    expect(selected.some(({ qualityScore }) => qualityScore === 100)).toBe(true);
  });
});

import { describe, expect, test } from 'bun:test';
import { formatNodesForThree } from './three-format';

const docs = [
  { key: 'frag_a', name: 'Nexus Shard', rarity: 'common' },
  { key: 'frag_b', name: 'Founder Core', rarity: 'founder' },
  { key: 'frag_c', name: 'Legendary Prism', rarity: 'legendary' },
  { key: 'frag_d' },
];

describe('formatNodesForThree', () => {
  test('is deterministic: the same docs always produce the same payload', () => {
    const first = formatNodesForThree(docs);
    const second = formatNodesForThree(docs.map((doc) => ({ ...doc })));
    expect(second).toEqual(first);
  });

  test('positions land on the jittered unit sphere (radius 0.85-1.15)', () => {
    const { points } = formatNodesForThree(docs);
    expect(points.length).toBe(docs.length);
    for (const [x, y, z] of points) {
      const radius = Math.sqrt(x * x + y * y + z * z);
      expect(radius).toBeGreaterThanOrEqual(0.85);
      expect(radius).toBeLessThanOrEqual(1.15);
    }
  });

  test('respects radius option overrides deterministically', () => {
    const { points } = formatNodesForThree(docs, { radiusMin: 2, radiusMax: 3 });
    for (const [x, y, z] of points) {
      const radius = Math.sqrt(x * x + y * y + z * z);
      expect(radius).toBeGreaterThanOrEqual(2);
      expect(radius).toBeLessThanOrEqual(3);
    }
  });

  test('defaults to silver and warms founder/legendary rarities', () => {
    const { colors } = formatNodesForThree(docs);
    expect(colors[0]).toEqual([0.7, 0.75, 0.78]);
    expect(colors[3]).toEqual([0.7, 0.75, 0.78]);
    // Warm tints: red channel dominates blue, unlike the cool silver default.
    expect(colors[1]![0]).toBeGreaterThan(colors[1]![2]!);
    expect(colors[2]![0]).toBeGreaterThan(colors[2]![2]!);
    expect(colors[1]).not.toEqual([0.7, 0.75, 0.78]);
    expect(colors[2]).not.toEqual([0.7, 0.75, 0.78]);
  });

  test('meta carries keys and optional labels', () => {
    const { meta } = formatNodesForThree(docs);
    expect(meta).toEqual([
      { key: 'frag_a', label: 'Nexus Shard' },
      { key: 'frag_b', label: 'Founder Core' },
      { key: 'frag_c', label: 'Legendary Prism' },
      { key: 'frag_d', label: null },
    ]);
  });

  test('different keys land at different positions', () => {
    const { points } = formatNodesForThree(docs);
    const unique = new Set(points.map((p) => p.join(',')));
    expect(unique.size).toBe(points.length);
  });
});

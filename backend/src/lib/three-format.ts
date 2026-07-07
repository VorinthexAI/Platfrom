/**
 * Canonical node -> three.js bridge.
 *
 * This module is the single place (singleton by module semantics) that turns
 * graph node documents into a render-ready three.js payload: point positions,
 * per-point RGB colors, and lightweight metadata. Any future feature that
 * wants to render nodes in the web app's three.js scenes should format its
 * documents through {@link formatNodesForThree} rather than inventing its own
 * layout, so every surface renders the same data as the same shape.
 *
 * Positions are DETERMINISTIC: each doc's `key` is hashed into spherical
 * coordinates on a unit sphere with a slight radius jitter (0.85-1.15 by
 * default), so the same data always renders the same constellation.
 */

export interface ThreeFormatOptions {
  /** Inner bound of the radius jitter. Defaults to 0.85. */
  radiusMin?: number;
  /** Outer bound of the radius jitter. Defaults to 1.15. */
  radiusMax?: number;
}

export interface ThreeFormatPayload {
  points: Array<[number, number, number]>;
  colors: Array<[number, number, number]>;
  meta: Array<{ key: string; label: string | null; mesh: Record<string, unknown> | null }>;
}

/** Neutral silver used for every node without a special rarity. */
const SILVER: [number, number, number] = [0.7, 0.75, 0.78];

/** Warm tints for the collectible rarities that deserve a glow. */
const RARITY_COLORS: Record<string, [number, number, number]> = {
  founder: [0.95, 0.72, 0.35],
  legendary: [0.9, 0.78, 0.5],
};

function hashSeed(seed: string): number {
  // FNV-1a 32-bit: stable across runtimes so layouts never shift between deploys.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function unitFraction(seed: string): number {
  return hashSeed(seed) / 0x100000000;
}

function positionForKey(key: string, radiusMin: number, radiusMax: number): [number, number, number] {
  const theta = unitFraction(`theta:${key}`) * 2 * Math.PI;
  // acos of a uniform [-1, 1] sample keeps points uniform over the sphere
  // instead of clustering at the poles.
  const phi = Math.acos(2 * unitFraction(`phi:${key}`) - 1);
  const radius = radiusMin + unitFraction(`radius:${key}`) * (radiusMax - radiusMin);
  return [
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
  ];
}

function colorForDoc(doc: Record<string, unknown>): [number, number, number] {
  const rarity = typeof doc.rarity === 'string' ? doc.rarity.toLowerCase() : null;
  return (rarity && RARITY_COLORS[rarity]) || SILVER;
}

function labelForDoc(doc: Record<string, unknown>): string | null {
  return typeof doc.name === 'string' && doc.name.length > 0 ? doc.name : null;
}

function meshForDoc(doc: Record<string, unknown>): Record<string, unknown> | null {
  return doc.mesh && typeof doc.mesh === 'object' && !Array.isArray(doc.mesh)
    ? doc.mesh as Record<string, unknown>
    : null;
}

/**
 * Formats node documents into a three.js points payload. Deterministic: the
 * same `docs` (by `key`) always produce the same positions and colors.
 */
export function formatNodesForThree(
  docs: Array<{ key: string; [k: string]: unknown }>,
  opts: ThreeFormatOptions = {},
): ThreeFormatPayload {
  const radiusMin = opts.radiusMin ?? 0.85;
  const radiusMax = opts.radiusMax ?? 1.15;

  const points: Array<[number, number, number]> = [];
  const colors: Array<[number, number, number]> = [];
  const meta: Array<{ key: string; label: string | null; mesh: Record<string, unknown> | null }> = [];

  for (const doc of docs) {
    points.push(positionForKey(doc.key, radiusMin, radiusMax));
    colors.push(colorForDoc(doc));
    meta.push({ key: doc.key, label: labelForDoc(doc), mesh: meshForDoc(doc) });
  }

  return { points, colors, meta };
}

// Isomorphic grid-cell derivation (neural-map.md §10.3, §16.2, Risk #3 / ADR-003).
//
// This module is the single source of truth for turning a world-space
// position + LOD tier into a `gridCell` id. The backend's precomputed
// `gridCell` field on every node/cluster document (§10.3) and the client's
// viewport-frustum → cell-id computation (§11.2) both derive from this exact
// formula. If a backend implementation of this file exists, it MUST stay
// byte-for-byte identical to this one — a drift between the two silently
// breaks every "what's near the camera" query (Risk #3, ADR-003).

export const BASE_CELL_SIZE = 64;
export const GROWTH_FACTOR = 12;

export function cellSize(tier: number): number {
  return BASE_CELL_SIZE * GROWTH_FACTOR ** tier;
}

export type Vector3Like = { x: number; y: number; z: number };

/** Derives the `gridCell` id for a position at a given LOD tier, e.g. `"L2:14,-3,7"`. */
export function gridCell(tier: number, position: Vector3Like): string {
  const size = cellSize(tier);
  const cx = Math.floor(position.x / size);
  const cy = Math.floor(position.y / size);
  const cz = Math.floor(position.z / size);
  return `L${tier}:${cx},${cy},${cz}`;
}

/** Parses a `gridCell` id back into its tier and integer cell coordinates. */
export function parseGridCell(
  cell: string,
): { tier: number; cx: number; cy: number; cz: number } | null {
  const match = /^L(\d+):(-?\d+),(-?\d+),(-?\d+)$/.exec(cell);
  if (!match) return null;
  const [, tier, cx, cy, cz] = match;
  return {
    tier: Number(tier),
    cx: Number(cx),
    cy: Number(cy),
    cz: Number(cz),
  };
}

/** The coarser tier's cell id that a given cell's cluster rolls up into. */
export function parentGridCell(cell: string): string | null {
  const parsed = parseGridCell(cell);
  if (!parsed || parsed.tier === 0) return null;
  const parentTier = parsed.tier - 1;
  const scaleRatio = cellSize(parsed.tier) / cellSize(parentTier);
  return `L${parentTier}:${Math.floor(parsed.cx * scaleRatio)},${Math.floor(
    parsed.cy * scaleRatio,
  )},${Math.floor(parsed.cz * scaleRatio)}`;
}

/**
 * Enumerates every gridCell id a sphere (viewport frustum bounding sphere)
 * of `radius` centered at `center` may intersect, at the given tier. Used by
 * the client to compute the `cellIds` list sent to the tile endpoint (§11.2).
 */
export function cellsInRadius(
  tier: number,
  center: Vector3Like,
  radius: number,
): string[] {
  const size = cellSize(tier);
  const span = Math.max(0, Math.ceil(radius / size));
  const centerCx = Math.floor(center.x / size);
  const centerCy = Math.floor(center.y / size);
  const centerCz = Math.floor(center.z / size);

  const cells: string[] = [];
  for (let dx = -span; dx <= span; dx++) {
    for (let dy = -span; dy <= span; dy++) {
      for (let dz = -span; dz <= span; dz++) {
        cells.push(
          `L${tier}:${centerCx + dx},${centerCy + dy},${centerCz + dz}`,
        );
      }
    }
  }
  return cells;
}

// ── Query-string encoding for multi-cell requests (§11.2, §45) ─────────────
//
// `gridCell` ids are themselves comma-shaped (`L2:14,-3,7`), so joining a
// list of them with `,` (as §45's OpenAPI sketch literally says — "cells...
// comma-separated gridCell ids") is ambiguous: `"L1:14,-3,7"` and
// `"L1:14","-3","7"` are indistinguishable after a naive `split(",")`. Every
// producer/consumer of the `cells` query param — the client
// (`data/universe-api.ts`), the Next.js proxy route
// (`app/api/universe/tiles/route.ts`), the realtime-feed cell filter
// (`data/use-universe-realtime.ts`), and the mock backend
// (`scripts/dev/mock-backend/server.ts`) — must use these two functions
// rather than hand-rolling `.join(",")`/`.split(",")`, so the delimiter
// choice can never drift out of sync across those independently-evolving
// files again.
const CELL_ID_DELIMITER = ";";

export function encodeCellIds(cellIds: string[]): string {
  return cellIds.join(CELL_ID_DELIMITER);
}

export function decodeCellIds(raw: string): string[] {
  return raw.split(CELL_ID_DELIMITER).filter(Boolean);
}

// scripts/dev/generate-seed-graph.ts
//
// Synthetic seed data generator (neural-map.md §32) for local dev/test
// tooling — NOT part of the production Next.js bundle. Produces a graph with
// realistic, clumpy clustering structure (nodes gravitate around a small
// number of "natural" dense regions, rather than uniform-random placement)
// so it actually stresses the grid-cell spatial index (§10.3) the way a
// real-world graph would.
//
// Determinism: the SAME `seed` string always produces the SAME graph — this
// is required for §16.2's visual-regression golden-frame tests and §10.5.3's
// "don't reshuffle the universe on every rebuild" requirement to be testable
// at all. All randomness flows through a single seeded PRNG (mulberry32,
// seeded from a sha256 hash of the seed string); nothing here ever calls
// `Math.random()`.
//
// Run standalone via Bun (no bundler resolution needed): this file uses a
// relative import for `gridCell`/`cellSize` rather than the `@/*` path alias
// because scripts under scripts/dev/** run directly through `bun run`, not
// through Next's module resolution — see AGENTS.md's dev-tooling conventions
// note. Reusing the exact shared formula (rather than reimplementing it) is
// required by Risk #3 / ADR-003: the mock backend's spatial index MUST use
// byte-for-byte the same gridCell math the client engine uses, or "what's
// near the camera" queries silently break.

import { createHash } from "node:crypto";
import { gridCell } from "../../src/lib/shared-spatial-index";
import { NODE_TYPES, type NodeType } from "../../src/lib/node-types";

// ── Public types (mirrors neural-map.md §21's GraphNodeDoc/GraphEdgeDoc) ────

export type SeedOptions = {
  /** Total number of nodes to generate. */
  nodeCount: number;
  /** Number of "natural" dense regions nodes gravitate toward. */
  clusterCount: number;
  /** Average edges per node, biased toward same-cluster (nearby-index) targets. */
  edgeDensityPerNode: number;
  /** Stable across runs for reproducible fixtures (§10.5.3, §16.2). */
  seed: string;
};

export type SeedGraphNode = {
  _key: string;
  type: string;
  label: string;
  properties: Record<string, unknown>;
  weight: number;
  position: { x: number; y: number; z: number };
  /** One synthetic cluster id per representative LOD tier (§21 `clusterPath`). */
  clusterPath: string[];
  /** Canonical gridCell at the node's "native" tier (R2 — individual nodes live here, §8.1). */
  gridCell: string;
  /**
   * Non-canonical convenience field (not part of §21's GraphNodeDoc): the
   * same gridCell computed at a couple of other representative tiers, using
   * the identical shared formula. Demonstrates/documents that gridCell is
   * always tier-relative, never a single fixed value per node. The mock
   * backend's tile index (server.ts) does NOT rely on this field — it
   * recomputes gridCell per requested tier directly from `position`, exactly
   * as the real backend would need to per §10.3.
   */
  gridCellsByTier: Record<number, string>;
  createdAt: string;
  updatedAt: string;
};

export type SeedGraphEdge = {
  _key: string;
  _from: string;
  _to: string;
  type: string;
  weight: number;
  properties: Record<string, unknown>;
  createdAt: string;
};

export type SeedGraph = { nodes: SeedGraphNode[]; edges: SeedGraphEdge[] };

// ── Fixed vocab, so labels read like plausible entity names without a
//    wordlist dependency (~40 flavor words, per AGENTS.md's guidance). ──────

const FLAVOR_WORDS = [
  "amber", "basalt", "cobalt", "delta", "ember", "fjord", "glacier", "harbor",
  "indigo", "juniper", "kestrel", "lumen", "meridian", "nebula", "obsidian",
  "prism", "quartz", "ridge", "sable", "tundra", "umbra", "vertex", "willow",
  "xenon", "yarrow", "zephyr", "atlas", "beacon", "cinder", "drift", "echo",
  "flint", "grove", "haven", "ion", "keystone", "lattice", "mosaic", "nomad",
  "opal",
] as const;

// Bounded enum used for the tile wire format's per-node type byte
// (encode-tile.ts) — re-exported here for convenience, but its single
// source of truth is `src/lib/node-types.ts`, since the universe engine
// (production/shipped client code, not dev-only tooling) needs the exact
// same ordering to decode the byte it receives back into a type string.
export { NODE_TYPES, type NodeType };

// Representative LOD tiers to precompute gridCell for. R2 (index 2 here,
// tier=2) is treated as each node's "native" tier since §8.1 puts individual
// node/edge documents as the R2 ("Constellations") data source; R0/R1 tiers
// are included so `gridCellsByTier` demonstrates the same formula rolling
// nodes up into much coarser cells at coarser tiers.
const REPRESENTATIVE_TIERS = [0, 1, 2] as const;
const NATIVE_TIER = 2;

// ── Deterministic PRNG ───────────────────────────────────────────────────────

function stableRandom(seedStr: string): () => number {
  // Deterministic PRNG (mulberry32) seeded from a hash of `seedStr`, so the
  // SAME seed always produces the SAME graph — required for §16.2's visual
  // regression golden-frame tests and §10.5.3's "don't reshuffle the universe
  // on every rebuild" determinism requirement to be testable at all.
  let a = createHash("sha256").update(seedStr).digest().readUInt32LE(0);
  return function mulberry32() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, options: readonly T[]): T {
  return options[Math.floor(rand() * options.length)];
}

function clampIndex(i: number, len: number): number {
  return ((i % len) + len) % len;
}

function makeLabel(rand: () => number, i: number): string {
  // "word-word-####" style, e.g. "amber-lattice-4821".
  const a = pick(rand, FLAVOR_WORDS);
  let b = pick(rand, FLAVOR_WORDS);
  if (b === a) b = FLAVOR_WORDS[(FLAVOR_WORDS.indexOf(a) + 7) % FLAVOR_WORDS.length];
  const suffix = String(1000 + Math.floor(rand() * 9000));
  return `${a}-${b}-${suffix}${i === 0 ? "" : ""}`;
}

// ── Generator ─────────────────────────────────────────────────────────────

export function generateSeedGraph(opts: SeedOptions): SeedGraph {
  const rand = stableRandom(opts.seed);

  // Deterministic base timestamp so createdAt/updatedAt are stable across
  // runs too, not just the graph's structure/positions.
  const baseTimestampMs = Date.UTC(2026, 0, 1);

  // Cluster centers spread across the R0/R1 regime bands (§8.1): R0 begins
  // at camera distance >10,000 world units, R1 spans 1,000-10,000 — so
  // scattering cluster centers within roughly a +/-10,000 unit cube (and a
  // flatter +/-2,000 on Y, a loose "galactic disk" aesthetic bias) keeps the
  // bulk of generated nodes inside a few thousand units of the origin,
  // consistent with `REBASE_THRESHOLD` (5,000 world units,
  // src/features/universe/engine/floating-origin.ts) being a *typical*
  // camera-drift distance rather than an outlier.
  const clusterCenters = Array.from({ length: opts.clusterCount }, () => ({
    x: (rand() - 0.5) * 20_000,
    y: (rand() - 0.5) * 4_000,
    z: (rand() - 0.5) * 20_000,
  }));

  const nodes: SeedGraphNode[] = Array.from({ length: opts.nodeCount }, (_, i) => {
    const clusterIndex = Math.floor(rand() * clusterCenters.length);
    const cluster = clusterCenters[clusterIndex];
    const spread = 400 + rand() * 800; // dense core, loose halo per cluster
    const position = {
      x: cluster.x + (rand() - 0.5) * spread,
      y: cluster.y + (rand() - 0.5) * spread * 0.4,
      z: cluster.z + (rand() - 0.5) * spread,
    };

    const gridCellsByTier: Record<number, string> = {};
    for (const tier of REPRESENTATIVE_TIERS) {
      gridCellsByTier[tier] = gridCell(tier, position);
    }

    const createdAt = new Date(baseTimestampMs + Math.floor(rand() * 1000 * 60 * 60 * 24 * 365)).toISOString();

    return {
      _key: `n${i}`,
      type: pick(rand, NODE_TYPES),
      label: makeLabel(rand, i),
      properties: {},
      weight: Math.round(rand() * 100),
      position,
      clusterPath: REPRESENTATIVE_TIERS.map((tier) => `cluster-${clusterIndex}-L${tier}`),
      gridCell: gridCellsByTier[NATIVE_TIER],
      gridCellsByTier,
      createdAt,
      updatedAt: createdAt,
    };
  });

  const edges: SeedGraphEdge[] = [];
  let edgeCounter = 0;
  for (let i = 0; i < nodes.length; i++) {
    const edgeCount = Math.round(opts.edgeDensityPerNode * (0.5 + rand()));
    for (let e = 0; e < edgeCount; e++) {
      // Bias strongly toward nearby indices (same-cluster proxy, since nodes
      // aren't shuffled post-generation) to produce realistic, non-uniform
      // connectivity rather than a random graph's unrealistically even spread.
      const nearby = clampIndex(i + Math.round((rand() - 0.5) * 40), nodes.length);
      if (nearby === i) continue;
      edges.push({
        _key: `e${edgeCounter++}`,
        _from: `nodes/${nodes[i]._key}`,
        _to: `nodes/${nodes[nearby]._key}`,
        type: "relates_to",
        weight: rand(),
        properties: {},
        createdAt: nodes[i].createdAt,
      });
    }
  }

  return { nodes, edges };
}

// Convenience default fixture, matching the mock backend's startup graph
// (§47) — importable by other dev scripts that want the exact same fixture
// without repeating the options literal.
export const DEV_FIXTURE_SEED_OPTIONS: SeedOptions = {
  nodeCount: 20_000,
  clusterCount: 60,
  edgeDensityPerNode: 3,
  seed: "dev-fixture-v1",
};

// Recommended fixture sizes for the three testing tiers described in §16:
// ~500 nodes for fast component/unit tests, ~50,000 for the Phase 0 spike
// (§18) and CI visual-regression runs, and ~500,000+ reserved for the
// periodic (not-every-CI-run) load-shaped test in §16.3.
export const FIXTURE_SIZES = {
  small: 500,
  medium: 50_000,
  large: 500_000,
} as const;

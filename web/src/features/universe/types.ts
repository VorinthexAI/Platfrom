// Universe domain types (neural-map.md §21 "Data Model Reference (Consolidated)"
// is the canonical source — this module mirrors those shapes 1:1 so every
// file under src/features/universe/** imports from one place instead of
// redeclaring ad-hoc shapes that could drift from §21).

export type Vec3 = [number, number, number];

// ── Graph domain (mirrors backend documents, §10.2/§21) ─────────────────────

export type GraphNodeDoc = {
  _key: string;
  type: string;
  label: string;
  properties: Record<string, unknown>;
  weight: number;
  position: { x: number; y: number; z: number };
  clusterPath: string[];
  gridCell: string;
  createdAt: string;
  updatedAt: string;
};

export type GraphEdgeDoc = {
  _key: string;
  _from: string;
  _to: string;
  type: string;
  weight: number;
  properties: Record<string, unknown>;
  createdAt: string;
};

export type ClusterDoc = {
  _key: string;
  tier: number;
  centroid: { x: number; y: number; z: number };
  radius: number;
  memberCount: number;
  childClusterIds: string[];
  gridCell: string;
  label?: string;
  lastRebuiltAt: string;
};

// ── Client-side runtime shapes (§21) ─────────────────────────────────────────

export type LoadedNode = {
  id: string;
  position: Vec3;
  weight: number;
  type: string;
  /** 0..1 — drives the §8.6 "new node" glow-intensity fade-in pulse. */
  intensity?: number;
  color?: [number, number, number];
};

export type LoadedCluster = {
  id: string;
  position: Vec3;
  radius: number;
  memberCount: number;
  label?: string;
};

export type SpatialBucket = {
  cellKey: string;
  memberIds: string[];
  centroid: Vec3;
};

export type NodeDetail = {
  id: string;
  label: string;
  type: string;
  properties: Record<string, unknown>;
  neighborCount: number;
  position?: Vec3;
};

export type SearchResult = {
  id: string;
  label: string;
  type: string;
  position: Vec3;
};

export type SerializedCameraState = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  tier: number;
  focus: string | null;
};

export type Regime = "R0" | "R1" | "R2" | "R3";

export type EngineSnapshot = {
  regime: Regime;
  zoomTier: number;
  breadcrumb: string;
};

// ── Wire protocol (§11) ──────────────────────────────────────────────────────

export type TileHeader = {
  tier: number;
  pyramidVersion: string;
  cellIds: string[];
  nextChunkToken: string | null;
  memberCounts?: number[]; // decoded from Uint32Array bytes (cluster tiles only)
  colors?: Uint8Array; // packed RGBA, optional per-node override color
};

/**
 * A single decoded tile page (one binary frame, pre-pagination-merge).
 *
 * Wire format note: §11.1's early sketch describes node ids as "indices
 * into a parallel string table sent once per session" — this codebase's
 * actual implementation (scripts/dev/mock-backend/encode-tile.ts, matched
 * here) instead sends each node's id inline, once per tile. Simpler to
 * produce and consume correctly, at the cost of some redundant bytes across
 * repeated tile requests for the same node — an acceptable trade for a v1
 * whose real backend doesn't exist yet. `ids`/`types` are index-aligned with
 * each other and with `positions` (i.e. `positions[i*3..i*3+2]` is node
 * `ids[i]`, whose entity type is `NODE_TYPES[types[i]]` — see
 * `src/lib/node-types.ts`).
 */
export type DecodedTilePage = {
  header: TileHeader;
  positions: Float32Array; // (x,y,z) * nodeCount
  ids: string[];
  types: Uint8Array; // index into NODE_TYPES, aligned with ids
};

/** A fully-merged tile (all pages of a `nextChunkToken` chain concatenated). */
export type DecodedTile = {
  tier: number;
  pyramidVersion: string;
  cellIds: string[];
  positions: Float32Array;
  ids: string[];
  types: Uint8Array;
};

export type UniverseChangeEvent =
  | {
      type: "node_created";
      nodeId: string;
      gridCell: string;
      tier: number;
      position: Vec3;
    }
  | { type: "node_updated"; nodeId: string; gridCell: string }
  | { type: "node_deleted"; nodeId: string; gridCell: string }
  | { type: "edge_created" | "edge_deleted"; from: string; to: string }
  | {
      type: "cluster_rebuilt";
      tier: number | "all";
      pyramidVersion: string;
      affectedCells: string[];
    };

// ── Worker message contracts (§37) ──────────────────────────────────────────

export type DecodeWorkerRequest = { type: "decode"; buffer: ArrayBuffer };
export type DecodeWorkerResponse =
  | {
      type: "decoded";
      header: TileHeader;
      positions: Float32Array;
      ids: string[];
      types: Uint8Array;
    }
  | { type: "decode_error"; message: string };

export type ClusterWorkerRequest = {
  type: "rebucket";
  nodes: LoadedNode[];
  cellSize: number;
};
export type ClusterWorkerResponse = {
  type: "rebucketed";
  buckets: SpatialBucket[];
};

export type LayoutWorkerRequest = {
  type: "relax";
  nodes: { id: string; position: Vec3 }[];
  iterations: number;
};
export type LayoutWorkerResponse = {
  type: "relaxed";
  positions: Map<string, Vec3>;
};

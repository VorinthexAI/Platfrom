// Shared node `type` enum for the binary tile wire format (neural-map.md
// §11.1, §21). The tile frame encodes each node's `type` as a single byte
// (an index into this array) rather than a repeated string, so the
// producer (mock backend today, real backend eventually — see
// scripts/dev/mock-backend/encode-tile.ts) and every consumer
// (`src/features/universe/engine/workers/decode.worker.ts`) MUST agree on
// the exact same ordering. Kept here, in production shared code, rather
// than inside `scripts/dev/**`, since the universe engine (shipped client
// code) needs it too.

export const NODE_TYPES = [
  "service",
  "dataset",
  "person",
  "document",
  "cluster",
  "system",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export function nodeTypeToEnum(type: string): number {
  const index = NODE_TYPES.indexOf(type as NodeType);
  return index === -1 ? NODE_TYPES.length - 1 : index;
}

export function nodeTypeFromEnum(index: number): NodeType {
  return NODE_TYPES[index] ?? NODE_TYPES[NODE_TYPES.length - 1];
}

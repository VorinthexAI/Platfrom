// scripts/dev/mock-backend/encode-tile.ts
//
// Binary tile-response framing for the mock backend's `/api/v1/universe/tiles`
// endpoint (neural-map.md §11.1, §45). This is a concrete, self-describing
// implementation of §11.1's "binary, not JSON" framing decision — chosen
// here to be simple to both write AND parse, since a real implementation of
// the universe engine's `decode.worker.ts` (§9.6.1) needs to consume
// whatever this produces.
//
// ── Byte layout (all multi-byte integers little-endian, unsigned) ──────────
//
//   ┌───────────────────────┬──────────────────────────────────────────────┐
//   │ Field                  │ Size / contents                              │
//   ├───────────────────────┼──────────────────────────────────────────────┤
//   │ frameVersion            │ uint32 (4 bytes) — see §65 Protocol          │
//   │                         │ Versioning Strategy; bump FRAME_VERSION any  │
//   │                         │ time a byte-layout-breaking change is made,  │
//   │                         │ so older connected clients can detect and    │
//   │                         │ reject a frame they don't know how to parse  │
//   │                         │ instead of silently misreading bytes.        │
//   │ headerJsonByteLength    │ uint32 (4 bytes) — byte length H of the next │
//   │                         │ field                                        │
//   │ headerJson              │ H bytes, UTF-8 JSON matching the TileHeader  │
//   │                         │ shape (§21): { tier, pyramidVersion,         │
//   │                         │ cellIds, nextChunkToken, ... }               │
//   │ nodeCount               │ uint32 (4 bytes) — N, the number of nodes in │
//   │                         │ this frame                                   │
//   │ ids[N]                  │ repeated N times, in order:                  │
//   │                         │   idByteLength: uint32 (4 bytes)             │
//   │                         │   id: idByteLength bytes, UTF-8 (a node's    │
//   │                         │   `_key`)                                    │
//   │ positions               │ N * 3 * float32 (12 bytes/node) — packed     │
//   │                         │ (x0,y0,z0, x1,y1,z1, ...), SAME order as     │
//   │                         │ ids[]                                        │
//   │ types                   │ N * uint8 — index into NODE_TYPES (see       │
//   │                         │ ../generate-seed-graph.ts), SAME order as    │
//   │                         │ ids[]. Unknown/unrecognized type strings     │
//   │                         │ encode to the last NODE_TYPES index.         │
//   └───────────────────────┴──────────────────────────────────────────────┘
//
// No padding or alignment between sections or between repeated elements —
// every section starts immediately where the previous one ended. A decoder
// must track its own running byte offset (it cannot assume 4-byte alignment
// once past the variable-length id strings) rather than indexing directly
// into a typed array at a fixed stride.
//
// Deliberately NOT implemented (out of scope for this mock, see §11.1):
// the "ids as indices into a parallel string table sent once per session"
// optimization — this format instead sends each node's id inline, once per
// tile, which is simpler to produce/consume correctly for dev purposes at
// the cost of some redundant bytes across repeated tile requests. This is
// the format `src/features/universe/engine/workers/decode.worker.ts`
// actually parses (confirmed byte-for-byte compatible) — the two were
// briefly out of sync during initial parallel development and have since
// been reconciled onto this inline-id format as the single source of truth.

import { nodeTypeToEnum } from "../../../src/lib/node-types";

/** Bump whenever this byte layout changes in a way older readers can't handle. */
export const FRAME_VERSION = 1;

export type TileHeaderInput = {
  tier: number;
  pyramidVersion: string;
  cellIds: string[];
  nextChunkToken: string | null;
  [extra: string]: unknown;
};

/** Minimal shape this encoder needs from a node — a structural subset of SeedGraphNode. */
export type EncodableNode = {
  _key: string;
  type: string;
  position: { x: number; y: number; z: number };
};

export function encodeTileResponse({
  header,
  nodes,
}: {
  header: TileHeaderInput;
  nodes: EncodableNode[];
}): ArrayBuffer {
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(JSON.stringify(header));
  const idByteArrays = nodes.map((n) => encoder.encode(n._key));
  const idsSectionLength = idByteArrays.reduce((sum, bytes) => sum + 4 + bytes.byteLength, 0);

  const totalLength =
    4 + // frameVersion
    4 + // headerJsonByteLength
    headerBytes.byteLength +
    4 + // nodeCount
    idsSectionLength +
    nodes.length * 3 * 4 + // positions: 3 float32 per node
    nodes.length * 1; // types: 1 uint8 per node

  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  let offset = 0;

  view.setUint32(offset, FRAME_VERSION, true);
  offset += 4;

  view.setUint32(offset, headerBytes.byteLength, true);
  offset += 4;

  new Uint8Array(buffer, offset, headerBytes.byteLength).set(headerBytes);
  offset += headerBytes.byteLength;

  view.setUint32(offset, nodes.length, true);
  offset += 4;

  for (const idBytes of idByteArrays) {
    view.setUint32(offset, idBytes.byteLength, true);
    offset += 4;
    new Uint8Array(buffer, offset, idBytes.byteLength).set(idBytes);
    offset += idBytes.byteLength;
  }

  for (const node of nodes) {
    view.setFloat32(offset, node.position.x, true);
    offset += 4;
    view.setFloat32(offset, node.position.y, true);
    offset += 4;
    view.setFloat32(offset, node.position.z, true);
    offset += 4;
  }

  for (const node of nodes) {
    view.setUint8(offset, nodeTypeToEnum(node.type));
    offset += 1;
  }

  return buffer;
}

// ── Decoder (reference implementation, not used by server.ts itself) ───────
//
// Provided so the byte layout above is unambiguous even without cross-
// referencing a separate consumer file — this mirrors exactly what a real
// `decode.worker.ts` would need to do to parse a frame this module produced.

export type DecodedTileFrame = {
  frameVersion: number;
  header: TileHeaderInput;
  ids: string[];
  positions: Float32Array; // (x,y,z) * ids.length, index-aligned with ids
  types: Uint8Array; // index-aligned with ids; each value indexes NODE_TYPES
};

export function decodeTileResponse(buffer: ArrayBuffer): DecodedTileFrame {
  const view = new DataView(buffer);
  let offset = 0;

  const frameVersion = view.getUint32(offset, true);
  offset += 4;

  const headerLength = view.getUint32(offset, true);
  offset += 4;

  const headerJson = new TextDecoder().decode(new Uint8Array(buffer, offset, headerLength));
  const header = JSON.parse(headerJson) as TileHeaderInput;
  offset += headerLength;

  const nodeCount = view.getUint32(offset, true);
  offset += 4;

  const ids: string[] = new Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    const idLength = view.getUint32(offset, true);
    offset += 4;
    ids[i] = new TextDecoder().decode(new Uint8Array(buffer, offset, idLength));
    offset += idLength;
  }

  const positions = new Float32Array(nodeCount * 3);
  for (let i = 0; i < nodeCount * 3; i++) {
    positions[i] = view.getFloat32(offset, true);
    offset += 4;
  }

  const types = new Uint8Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    types[i] = view.getUint8(offset);
    offset += 1;
  }

  return { frameVersion, header, ids, positions, types };
}

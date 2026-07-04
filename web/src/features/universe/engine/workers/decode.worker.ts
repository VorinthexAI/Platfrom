// neural-map.md §9.6.1/§11.1/§37.1 — parses the binary tile payload into
// typed arrays ready for direct upload into InstancedMesh buffers. Runs off
// the main thread specifically so a large tile's parse doesn't stall input
// handling elsewhere in the console (§9.6.1).
//
// Binary frame layout (application/octet-stream), little-endian throughout —
// MUST stay byte-for-byte in sync with
// `scripts/dev/mock-backend/encode-tile.ts`, the producer this decodes:
//
//   ┌───────────────┬───────────────┬───────────────┬────────────┬──────────────────────┬──────────────────┬──────────┐
//   │ frameVersion  │ header length │ header (JSON) │ node count │ ids[N]: repeated      │ positions:       │ types:   │
//   │ (uint32)      │ (uint32)      │ (utf-8 bytes) │ (uint32)   │ (idByteLen: uint32,   │ N*3*float32      │ N*uint8, │
//   │               │               │               │            │ id: idByteLen utf-8   │ (x,y,z per node, │ index    │
//   │               │               │               │            │ bytes) — a node's     │ same order as    │ into     │
//   │               │               │               │            │ `_key`, same order as │ ids)             │ NODE_TYPES│
//   │               │               │               │            │ everything below      │                  │ (same    │
//   │               │               │               │            │                       │                  │ order)   │
//   └───────────────┴───────────────┴───────────────┴────────────┴──────────────────────┴──────────────────┴──────────┘
//
// No padding/alignment between sections — a decoder must track its own
// running byte offset rather than indexing at a fixed stride, since the
// variable-length id strings make everything after them non-4-byte-aligned
// in general.
//
// `frameVersion` (§65) is prepended ahead of the header-length prefix that
// the plan's early sketches used alone — added so a future breaking change
// to this framing can be detected and handled (or rejected with a clear
// decode_error) rather than silently misparsed.
//
// Deliberately NOT implemented (matching encode-tile.ts, see its header
// comment): the "ids as indices into a session-wide string table"
// optimization §11.1's early sketch describes — this decodes each node's id
// inline instead, once per tile.
/// <reference lib="webworker" />

import type {
  DecodeWorkerRequest,
  DecodeWorkerResponse,
  TileHeader,
} from "../../types";

export const CURRENT_FRAME_VERSION = 1;

self.onmessage = (event: MessageEvent<DecodeWorkerRequest>) => {
  if (event.data.type !== "decode") return;

  try {
    const buffer = event.data.buffer;
    const view = new DataView(buffer);
    let offset = 0;

    const frameVersion = view.getUint32(offset, true);
    offset += 4;
    if (frameVersion !== CURRENT_FRAME_VERSION) {
      throw new Error(
        `Unsupported tile frameVersion ${frameVersion} (expected ${CURRENT_FRAME_VERSION})`,
      );
    }

    const headerLength = view.getUint32(offset, true);
    offset += 4;
    if (headerLength < 0 || offset + headerLength > buffer.byteLength) {
      throw new Error("Malformed tile frame: header length out of bounds");
    }
    const headerBytes = new Uint8Array(buffer, offset, headerLength);
    const header: TileHeader = JSON.parse(new TextDecoder().decode(headerBytes));
    offset += headerLength;

    const nodeCount = view.getUint32(offset, true);
    offset += 4;

    const decoder = new TextDecoder();
    const ids: string[] = new Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) {
      if (offset + 4 > buffer.byteLength) {
        throw new Error("Malformed tile frame: id length out of bounds");
      }
      const idByteLength = view.getUint32(offset, true);
      offset += 4;
      if (offset + idByteLength > buffer.byteLength) {
        throw new Error("Malformed tile frame: id bytes out of bounds");
      }
      ids[i] = decoder.decode(new Uint8Array(buffer, offset, idByteLength));
      offset += idByteLength;
    }

    const positionsByteLength = nodeCount * 3 * Float32Array.BYTES_PER_ELEMENT;
    const typesByteLength = nodeCount * Uint8Array.BYTES_PER_ELEMENT;
    if (offset + positionsByteLength + typesByteLength > buffer.byteLength) {
      throw new Error("Malformed tile frame: node payload out of bounds");
    }

    // `.slice()` (not a view over the shared `buffer`) so `positions`/`types`
    // are independent, transferable ArrayBuffers — two typed-array views
    // over the SAME source buffer can't each be listed in a `postMessage`
    // transfer list (fixes a real bug present in the plan's own §37.1
    // reference sketch, which tried exactly that and would throw).
    const positions = new Float32Array(
      buffer.slice(offset, offset + positionsByteLength),
    );
    offset += positionsByteLength;

    const types = new Uint8Array(
      buffer.slice(offset, offset + typesByteLength),
    );
    offset += typesByteLength;

    const response: DecodeWorkerResponse = {
      type: "decoded",
      header,
      positions,
      ids,
      types,
    };

    // Transfer the position/type buffers back zero-copy (§11.1) — `ids` is a
    // plain string array, not a transferable ArrayBuffer-backed view, so it
    // rides along via the normal structured-clone path.
    (self as unknown as Worker).postMessage(response, [
      positions.buffer,
      types.buffer,
    ]);
  } catch (error) {
    // §64: malformed/corrupt payloads must be caught, not thrown — a thrown
    // error inside a worker's onmessage silently kills the worker for every
    // subsequent message, which would take down all future tile decodes.
    const response: DecodeWorkerResponse = {
      type: "decode_error",
      message: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(response);
  }
};

// neural-map.md §11/§34 — the fetch layer backing every universe data hook.
// Talks to this app's own `src/app/api/universe/*` route handlers (never the
// backend directly) so auth/session stays a server-side concern.

import { encodeCellIds } from "@/lib/shared-spatial-index";

import { getUniverseWorkerPool } from "../engine/worker-pool";
import type {
  DecodedTile,
  DecodedTilePage,
  NodeDetail,
  SearchResult,
  UniverseChangeEvent,
} from "../types";

export type TileFetchParams = {
  tier: number;
  cellIds: string[];
  pyramidVersion: string;
};

async function fetchUniverseTilePage(
  params: TileFetchParams & { cursor: string | null },
): Promise<DecodedTilePage> {
  const url = new URL("/api/universe/tiles", window.location.origin);
  url.searchParams.set("tier", String(params.tier));
  url.searchParams.set("cells", encodeCellIds(params.cellIds));
  url.searchParams.set("pyramidVersion", params.pyramidVersion);
  if (params.cursor) url.searchParams.set("cursor", params.cursor);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Universe tile fetch failed: ${res.status}`);
  }
  const buffer = await res.arrayBuffer();

  const pool = getUniverseWorkerPool();
  const decoded = await pool.decodeTile(buffer);
  if (decoded.type === "decode_error") {
    throw new Error(`Universe tile decode failed: ${decoded.message}`);
  }

  return {
    header: decoded.header,
    positions: decoded.positions,
    ids: decoded.ids,
    types: decoded.types,
  };
}

/**
 * Handles §11.1's cursor/nextChunkToken pagination transparently — a tile
 * "query" from the calling component's perspective is a single logical
 * result, even though it may involve several round-trips under the hood.
 */
export async function fetchUniverseTile(
  params: TileFetchParams,
): Promise<DecodedTile> {
  let cursor: string | null = null;
  const pages: DecodedTilePage[] = [];
  do {
    const page = await fetchUniverseTilePage({ ...params, cursor });
    pages.push(page);
    cursor = page.header.nextChunkToken;
  } while (cursor);
  return mergeTilePages(params, pages);
}

function mergeTilePages(
  params: TileFetchParams,
  pages: DecodedTilePage[],
): DecodedTile {
  const totalNodes = pages.reduce((sum, p) => sum + p.ids.length, 0);
  const positions = new Float32Array(totalNodes * 3);
  const types = new Uint8Array(totalNodes);
  const ids: string[] = new Array(totalNodes);
  let cursor = 0;
  for (const page of pages) {
    positions.set(page.positions, cursor * 3);
    types.set(page.types, cursor);
    for (let i = 0; i < page.ids.length; i++) ids[cursor + i] = page.ids[i];
    cursor += page.ids.length;
  }

  return {
    tier: params.tier,
    pyramidVersion: params.pyramidVersion,
    cellIds: params.cellIds,
    positions,
    ids,
    types,
  };
}

export async function fetchNodeDetail(nodeId: string): Promise<NodeDetail> {
  const res = await fetch(`/api/universe/node/${encodeURIComponent(nodeId)}`);
  if (!res.ok) {
    throw new Error(`Node detail fetch failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchUniverseSearch(
  query: string,
): Promise<SearchResult[]> {
  const url = new URL("/api/universe/search", window.location.origin);
  url.searchParams.set("q", query);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Universe search failed: ${res.status}`);
  }
  return res.json();
}

// ── Realtime WS client ───────────────────────────────────────────────────
//
// See src/app/api/universe/stream/route.ts for the full writeup of why this
// mints a short-lived ticket via a same-origin GET rather than proxying the
// WS upgrade itself.

export type UniverseSocket = {
  onMessage: (handler: (event: UniverseChangeEvent) => void) => void;
  close: () => void;
};

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

class UniverseSocketImpl implements UniverseSocket {
  private ws: WebSocket | null = null;
  private handlers: Array<(event: UniverseChangeEvent) => void> = [];
  private closed = false;
  private backoffMs = RECONNECT_BASE_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    try {
      const ticketRes = await fetch("/api/universe/stream");
      if (!ticketRes.ok) {
        throw new Error(`WS ticket mint failed: ${ticketRes.status}`);
      }
      const { wsUrl } = (await ticketRes.json()) as { wsUrl: string };
      if (this.closed) return;

      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onopen = () => {
        this.backoffMs = RECONNECT_BASE_MS;
      };
      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(event.data) as UniverseChangeEvent;
          for (const handler of this.handlers) handler(parsed);
        } catch {
          // Malformed event — drop it rather than throwing inside a socket
          // callback, which would otherwise be an unhandled rejection.
        }
      };
      ws.onclose = () => {
        this.ws = null;
        if (!this.closed) this.scheduleReconnect();
      };
      ws.onerror = () => {
        ws.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.reconnectTimer = setTimeout(() => {
      this.backoffMs = Math.min(this.backoffMs * 2, RECONNECT_MAX_MS);
      void this.connect();
    }, this.backoffMs);
  }

  onMessage(handler: (event: UniverseChangeEvent) => void): void {
    this.handlers.push(handler);
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.handlers = [];
  }
}

export function openUniverseSocket(): UniverseSocket {
  return new UniverseSocketImpl();
}

// neural-map.md §9.6/§37.4 — long-lived pool manager for the three named
// workers. Created once per Universe mount (in practice: once per console
// session, since the Universe panel is never unmounted once toggled to,
// §6.3) — not per-message, not per-tile-request. `dispose()` only actually
// fires on a true console-shell unmount (navigating away from `/console`
// entirely), per §37.4's explicit clarification.

import type {
  ClusterWorkerRequest,
  ClusterWorkerResponse,
  DecodeWorkerRequest,
  DecodeWorkerResponse,
  LayoutWorkerRequest,
  LayoutWorkerResponse,
} from "../types";

export class UniverseWorkerPool {
  private decode: Worker;
  private cluster: Worker;
  private layout: Worker;

  constructor() {
    this.decode = new Worker(
      new URL("./workers/decode.worker.ts", import.meta.url),
    );
    this.cluster = new Worker(
      new URL("./workers/cluster.worker.ts", import.meta.url),
    );
    this.layout = new Worker(
      new URL("./workers/layout.worker.ts", import.meta.url),
    );
  }

  decodeTile(buffer: ArrayBuffer): Promise<DecodeWorkerResponse> {
    return new Promise((resolve, reject) => {
      const handle = (e: MessageEvent<DecodeWorkerResponse>) => {
        this.decode.removeEventListener("message", handle);
        this.decode.removeEventListener("error", errorHandle);
        resolve(e.data);
      };
      const errorHandle = (e: ErrorEvent) => {
        this.decode.removeEventListener("message", handle);
        this.decode.removeEventListener("error", errorHandle);
        reject(e.error ?? new Error(e.message));
      };
      this.decode.addEventListener("message", handle);
      this.decode.addEventListener("error", errorHandle);
      this.decode.postMessage(
        { type: "decode", buffer } satisfies DecodeWorkerRequest,
        [buffer],
      );
    });
  }

  rebucket(
    request: Omit<ClusterWorkerRequest, "type">,
  ): Promise<ClusterWorkerResponse> {
    return new Promise((resolve) => {
      const handle = (e: MessageEvent<ClusterWorkerResponse>) => {
        this.cluster.removeEventListener("message", handle);
        resolve(e.data);
      };
      this.cluster.addEventListener("message", handle);
      this.cluster.postMessage({
        type: "rebucket",
        ...request,
      } satisfies ClusterWorkerRequest);
    });
  }

  relax(
    request: Omit<LayoutWorkerRequest, "type">,
  ): Promise<LayoutWorkerResponse> {
    return new Promise((resolve) => {
      const handle = (e: MessageEvent<LayoutWorkerResponse>) => {
        this.layout.removeEventListener("message", handle);
        resolve(e.data);
      };
      this.layout.addEventListener("message", handle);
      this.layout.postMessage({
        type: "relax",
        ...request,
      } satisfies LayoutWorkerRequest);
    });
  }

  dispose() {
    this.decode.terminate();
    this.cluster.terminate();
    this.layout.terminate();
  }
}

let sharedPool: UniverseWorkerPool | null = null;

/** One worker pool for the whole console session (§37.4). */
export function getUniverseWorkerPool(): UniverseWorkerPool {
  if (!sharedPool) sharedPool = new UniverseWorkerPool();
  return sharedPool;
}

export function disposeUniverseWorkerPool(): void {
  sharedPool?.dispose();
  sharedPool = null;
}

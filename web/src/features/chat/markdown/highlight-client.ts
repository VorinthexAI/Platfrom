"use client";

// Main-thread side of `workers/highlight.worker.ts` — a lazily-created
// singleton Worker (one per tab, not one per code block) plus a
// requestId -> {resolve,reject} map, mirroring the worker-pool pattern from
// neural-map.md §37.4. `import type` below is deliberate: pulling in only
// the worker's *types* here keeps the worker's own runtime code (and its
// Shiki dependency) out of the main thread's bundle.
import type { HighlightToken, HighlightWorkerRequest, HighlightWorkerResponse } from "./workers/highlight.worker";

type PendingRequest = {
  resolve: (lines: HighlightToken[][]) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
const pending = new Map<string, PendingRequest>();

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL("./workers/highlight.worker.ts", import.meta.url));
  worker.addEventListener("message", (event: MessageEvent<HighlightWorkerResponse>) => {
    const { data } = event;
    const request = pending.get(data.requestId);
    if (!request) return;
    pending.delete(data.requestId);

    if (data.type === "highlighted") request.resolve(data.lines);
    else request.reject(new Error(data.error));
  });
  worker.addEventListener("error", () => {
    // A worker-level failure (e.g. failed to load) — reject everything still
    // in flight so callers fall back to plain text instead of hanging.
    for (const [, request] of pending) request.reject(new Error("Syntax highlighting worker crashed."));
    pending.clear();
  });

  return worker;
}

let requestCounter = 0;

export function highlightCode(code: string, lang: string | null): Promise<HighlightToken[][]> {
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now().toString(36)}-${(requestCounter++).toString(36)}`;
    pending.set(requestId, { resolve, reject });
    const request: HighlightWorkerRequest = { type: "highlight", requestId, code, lang };
    getWorker().postMessage(request);
  });
}

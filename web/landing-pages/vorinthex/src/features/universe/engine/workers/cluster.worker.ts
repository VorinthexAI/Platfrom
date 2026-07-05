// neural-map.md §9.6.2/§37.2 — client-side grid rebucketing for whatever
// node set is currently loaded, distinct from (and much coarser-lived than)
// the server's persisted gridCell/pyramid tiers. Also backs the coarse-pick
// spatial index from §9.5 (the same `buckets` output narrows raycast
// candidates before exact per-instance hit-testing runs).
/// <reference lib="webworker" />

import type {
  ClusterWorkerRequest,
  ClusterWorkerResponse,
  SpatialBucket,
} from "../../types";

self.onmessage = (event: MessageEvent<ClusterWorkerRequest>) => {
  if (event.data.type !== "rebucket") return;

  try {
    const { nodes, cellSize } = event.data;
    const buckets = new Map<string, SpatialBucket>();

    for (const node of nodes) {
      const [x, y, z] = node.position;
      const cellKey = `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;
      let bucket = buckets.get(cellKey);
      if (!bucket) {
        bucket = { cellKey, memberIds: [], centroid: [0, 0, 0] };
        buckets.set(cellKey, bucket);
      }
      bucket.memberIds.push(node.id);
      bucket.centroid[0] += x;
      bucket.centroid[1] += y;
      bucket.centroid[2] += z;
    }
    for (const bucket of buckets.values()) {
      const n = bucket.memberIds.length;
      bucket.centroid = [
        bucket.centroid[0] / n,
        bucket.centroid[1] / n,
        bucket.centroid[2] / n,
      ];
    }

    const response: ClusterWorkerResponse = {
      type: "rebucketed",
      buckets: Array.from(buckets.values()),
    };
    (self as unknown as Worker).postMessage(response);
  } catch (error) {
    // Narrow-job worker (§9.6) — a bad input here must not silently kill
    // the worker for subsequent rebucket requests (§64).
    (self as unknown as Worker).postMessage({
      type: "rebucketed",
      buckets: [],
    } satisfies ClusterWorkerResponse);
    console.error("cluster.worker: rebucket failed", error);
  }
};

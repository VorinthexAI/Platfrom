// neural-map.md §9.6.3/§37.3 — a cheap, transient local-relaxation pass for
// freshly-arrived siblings that would otherwise render exactly overlapping a
// parent/existing node. Positions here are NEVER persisted; server-computed
// positions (§10.5.3) remain authoritative the instant they arrive. An O(n^2)
// pairwise repulsion pass is acceptable only because this worker runs over a
// small transient subset (single-digit to low-double-digit counts, §9.6.3) —
// if that assumption is ever violated, switch to Barnes-Hut before reaching
// for a bigger dependency.
/// <reference lib="webworker" />

import type {
  LayoutWorkerRequest,
  LayoutWorkerResponse,
  Vec3,
} from "../../types";

const REPULSION_STRENGTH = 800;
const DAMPING = 0.85;

self.onmessage = (event: MessageEvent<LayoutWorkerRequest>) => {
  if (event.data.type !== "relax") return;

  try {
    const { nodes, iterations } = event.data;

    const velocities = new Map<string, Vec3>(
      nodes.map((n) => [n.id, [0, 0, 0] as Vec3]),
    );
    const positions = new Map<string, Vec3>(
      nodes.map((n) => [n.id, [...n.position] as Vec3]),
    );

    for (let iter = 0; iter < iterations; iter++) {
      for (const a of nodes) {
        const pa = positions.get(a.id)!;
        const va = velocities.get(a.id)!;
        for (const b of nodes) {
          if (a.id === b.id) continue;
          const pb = positions.get(b.id)!;
          const dx = pa[0] - pb[0];
          const dy = pa[1] - pb[1];
          const dz = pa[2] - pb[2];
          const distSq = dx * dx + dy * dy + dz * dz + 0.01;
          const force = REPULSION_STRENGTH / distSq;
          const dist = Math.sqrt(distSq);
          va[0] += (dx / dist) * force;
          va[1] += (dy / dist) * force;
          va[2] += (dz / dist) * force;
        }
      }
      for (const n of nodes) {
        const p = positions.get(n.id)!;
        const v = velocities.get(n.id)!;
        v[0] *= DAMPING;
        v[1] *= DAMPING;
        v[2] *= DAMPING;
        p[0] += v[0] * 0.016;
        p[1] += v[1] * 0.016;
        p[2] += v[2] * 0.016;
      }
    }

    const response: LayoutWorkerResponse = { type: "relaxed", positions };
    (self as unknown as Worker).postMessage(response);
  } catch (error) {
    // §64 — never let a bad relax request kill the worker for future ones.
    console.error("layout.worker: relax failed", error);
    const response: LayoutWorkerResponse = {
      type: "relaxed",
      positions: new Map(),
    };
    (self as unknown as Worker).postMessage(response);
  }
};

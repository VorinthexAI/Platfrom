// neural-map.md §9.2.2 — the floating-origin / origin-rebasing system.
//
// Every renderable's "true" position lives in double-precision (JS `number`)
// here, in `WorldRegistry`, keyed by node id — NOT read from `Object3D.position`
// as the source of truth. `Object3D.position` (float32-backed on the GPU side)
// only ever holds the position *relative to the current local origin*.
//
// Rebasing only matters once fine (R2/R3) geometry is on screen — §9.2.2's
// "not during R0/R1" note — so callers gate `maybeRebase` accordingly (the
// regime controller only invokes it while `currentRegime` is R2 or R3).

import type * as THREE from "three";

export type DoubleVec3 = { x: number; y: number; z: number };

/** World-space (double precision) positions, keyed by node/cluster id. */
export type WorldRegistry = Map<string, DoubleVec3>;

/** World units the camera may drift from the active local origin before a rebase fires. */
export const REBASE_THRESHOLD = 5_000;

export function createWorldRegistry(): WorldRegistry {
  return new Map();
}

export function setWorldPosition(
  registry: WorldRegistry,
  id: string,
  position: DoubleVec3,
): void {
  registry.set(id, position);
}

/** True world position of a renderable, independent of any rebase history. */
export function getWorldPosition(
  registry: WorldRegistry,
  id: string,
): DoubleVec3 | undefined {
  return registry.get(id);
}

/**
 * Converts a true world position into the current local-origin-relative
 * frame that's safe to hand to a float32 `Object3D.position`/instance buffer.
 */
export function toLocalRelative(
  world: DoubleVec3,
  localOrigin: DoubleVec3,
): DoubleVec3 {
  return {
    x: world.x - localOrigin.x,
    y: world.y - localOrigin.y,
    z: world.z - localOrigin.z,
  };
}

/** Inverse of `toLocalRelative` — used to resolve picking hits back to world space. */
export function toWorld(
  relative: DoubleVec3,
  localOrigin: DoubleVec3,
): DoubleVec3 {
  return {
    x: relative.x + localOrigin.x,
    y: relative.y + localOrigin.y,
    z: relative.z + localOrigin.z,
  };
}

export type RebaseCallback = (localOrigin: DoubleVec3) => void;

/**
 * Checks whether the camera has drifted far enough from the active local
 * origin to warrant a rebase, and if so performs it atomically: the local
 * origin is shifted by the camera's current offset, the camera snaps back to
 * (0,0,0), and `onRebase` is invoked synchronously so every consumer keyed to
 * world space (instance buffers, picking caches, the minimap, in-flight
 * camera-flight targets) rewrites itself in the same frame — never spread
 * across frames, or the user would see a one-frame "jump" as some objects
 * update before others (§9.2.2).
 */
export function maybeRebase(
  camera: THREE.Camera,
  localOrigin: DoubleVec3,
  onRebase: RebaseCallback,
): boolean {
  const distFromOrigin = Math.hypot(
    camera.position.x,
    camera.position.y,
    camera.position.z,
  );
  if (distFromOrigin < REBASE_THRESHOLD) return false;

  localOrigin.x += camera.position.x;
  localOrigin.y += camera.position.y;
  localOrigin.z += camera.position.z;
  camera.position.set(0, 0, 0);

  onRebase(localOrigin);
  return true;
}

/** Rewrites every registered instance's origin-relative transform after a rebase. */
export function rewriteInstanceTransformsRelativeToOrigin(
  mesh: THREE.InstancedMesh,
  ids: string[],
  registry: WorldRegistry,
  localOrigin: DoubleVec3,
  tmp: THREE.Matrix4,
  tmpVec: THREE.Vector3,
): void {
  for (let i = 0; i < ids.length; i++) {
    const world = registry.get(ids[i]);
    if (!world) continue;
    const rel = toLocalRelative(world, localOrigin);
    mesh.getMatrixAt(i, tmp);
    tmpVec.setFromMatrixPosition(tmp);
    tmp.setPosition(rel.x, rel.y, rel.z);
    mesh.setMatrixAt(i, tmp);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

import * as THREE from "three";

/**
 * Live world positions of orbiting bodies, written by planet/asteroid
 * components each frame and read by the camera rig. A module singleton is
 * used instead of React state because these values change every frame.
 */
export const planetPositions = new Map<string, THREE.Vector3>();
export const capabilityPositions = new Map<string, THREE.Vector3>();

export function trackedVector(map: Map<string, THREE.Vector3>, key: string) {
  let vector = map.get(key);
  if (!vector) {
    vector = new THREE.Vector3();
    map.set(key, vector);
  }
  return vector;
}

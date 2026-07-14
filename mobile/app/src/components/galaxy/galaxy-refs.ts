import * as THREE from "three";

/**
 * Live world positions of the orbiting capability planets, written every
 * frame by CapabilityPlanet and read by the camera rig — deliberately
 * module singletons, not React state (same pattern as the web galaxy).
 */
export const capabilityPositions = new Map<string, THREE.Vector3>();

export function trackedVector(
  map: Map<string, THREE.Vector3>,
  key: string,
): THREE.Vector3 {
  let vector = map.get(key);
  if (!vector) {
    vector = new THREE.Vector3();
    map.set(key, vector);
  }
  return vector;
}

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

/**
 * User-steered orientation of the whole solar system: horizontal swipes
 * spin it around the vertical axis (yaw), vertical swipes tilt it (pitch).
 * Written by the pan gesture on the JS thread, damped toward by the
 * SystemRig every frame — same singleton pattern as the positions above.
 */
export const systemRotation = {
  yaw: 0,
  pitch: 0,
};

/** Tilt limit so the system can lean steeply but never flips over. */
export const SYSTEM_PITCH_LIMIT = 1.15;

export function clampSystemPitch(pitch: number): number {
  return Math.max(-SYSTEM_PITCH_LIMIT, Math.min(SYSTEM_PITCH_LIMIT, pitch));
}

/** The live scene camera, published by the CameraRig for screen-space hit tests. */
export const galaxyCamera: { current: THREE.Camera | null } = {
  current: null,
};

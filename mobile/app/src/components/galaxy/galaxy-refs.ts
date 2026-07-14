import { makeMutable } from "react-native-reanimated";
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
 * These are Reanimated mutables so the pan gesture writes them straight
 * from the UI thread — no cross-thread scheduling, so a wild diagonal
 * scribble tracks the finger even while the JS thread is busy rendering
 * frames.
 * The SystemRig reads `.value` synchronously in useFrame and damps toward
 * them.
 */
export const systemYaw = makeMutable(0);
export const systemPitch = makeMutable(0);

/**
 * The RENDERED rotation, published back by the SystemRig every frame.
 * Touching down grabs THIS (and snaps the target to it) — like stopping a
 * spinning globe with your finger. Without it, a new pan starts from a
 * target the rig is still chasing after a fling, and the scene feels
 * stuck for seconds while the damping closes the gap.
 */
export const systemYawLive = makeMutable(0);
export const systemPitchLive = makeMutable(0);

/** Tilt limit so the system can lean steeply but never flips over. */
export const SYSTEM_PITCH_LIMIT = 1.15;

/** The live scene camera, published by the CameraRig for screen-space hit tests. */
export const galaxyCamera: { current: THREE.Camera | null } = {
  current: null,
};

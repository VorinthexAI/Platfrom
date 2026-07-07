"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { presenceMotion } from "@/lib/presence/presence-store";

/**
 * Live presence, currently invisible: the follower-star visuals (the
 * orange-gold eight-pointed suns that drifted after every explorer's
 * camera) have been retired from the scene, but the presence pipeline
 * underneath is fully alive — `PresenceConductor` still joins the
 * session, streams visitor positions into `usePresenceStore`, and this
 * component still publishes our own camera position on every frame so
 * other tabs keep receiving it. Rebuilding a visual on top later only
 * takes reading `usePresenceStore((s) => s.sessionIds)` and rendering
 * something at each visitor's position again.
 */
export function VisitorStars() {
  const camera = useThree((s) => s.camera);

  // Publish our own position for everyone else's view of the galaxy.
  useFrame(() => {
    presenceMotion.position[0] = camera.position.x;
    presenceMotion.position[1] = camera.position.y;
    presenceMotion.position[2] = camera.position.z;
  });

  return null;
}

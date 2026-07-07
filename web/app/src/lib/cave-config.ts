import type { CaveKind, RockAnchor } from "@/lib/galaxy-store";
import type { ChamberStyleKey } from "@/lib/three/chamber";

/**
 * Where each auth story lives. Every cave is the hollowed interior of a
 * belt asteroid: the camera flies to an anchor rock on the belt, punches
 * through the surface (screen flash), and wakes up inside an interior
 * chamber parked far below the galaxy plane so it never collides with the
 * solar system.
 */

export interface CaveConfig {
  /** Bearing of the anchor asteroid on the main belt. */
  anchorAngle: number;
  /** Belt radius of the anchor rock. */
  anchorRadius: number;
  /** World position of the hollow interior chamber. */
  interior: [number, number, number];
  theme: ChamberStyleKey;
  /** Micro-label shown while flying in. */
  approachLabel: string;
}

export const CAVE_CONFIGS: Record<CaveKind, CaveConfig> = {
  join: {
    anchorAngle: 0.6,
    anchorRadius: 17.2,
    interior: [0, -240, 0],
    theme: "gem",
    approachLabel: "Approaching the Reservation Vault",
  },
  "waitlist-verify": {
    anchorAngle: 3.6,
    anchorRadius: 17.8,
    interior: [90, -240, 0],
    theme: "ember",
    approachLabel: "Opening the Ember Vault",
  },
  signin: {
    anchorAngle: 2.2,
    anchorRadius: 16.8,
    interior: [180, -240, 0],
    theme: "lush",
    approachLabel: "Descending into the Grove",
  },
  members: {
    anchorAngle: 2.9,
    anchorRadius: 17.9,
    interior: [540, -240, 0],
    theme: "violet",
    approachLabel: "Approaching the Members Gate",
  },
  magic: {
    anchorAngle: 4.9,
    anchorRadius: 17.5,
    interior: [270, -240, 0],
    theme: "violet",
    approachLabel: "Unsealing the Cipher Chamber",
  },
  privacy: {
    anchorAngle: 1.5,
    anchorRadius: 16.5,
    interior: [360, -240, 0],
    theme: "ice",
    approachLabel: "Opening the Records Vault",
  },
  terms: {
    anchorAngle: 5.7,
    anchorRadius: 18.2,
    interior: [450, -240, 0],
    theme: "gem",
    approachLabel: "Opening the Accord Vault",
  },
  // Any ordinary belt rock: the anchor here is a fallback — the real
  // bearing comes from the clicked rock (store.rockAnchor), and the
  // chamber theme rolls from the visit seed.
  rock: {
    anchorAngle: 1.1,
    anchorRadius: 17.4,
    interior: [630, -240, 0],
    theme: "ice",
    approachLabel: "Approaching an uncharted asteroid",
  },
};

/** Seeded chamber themes for uncharted rocks — every dive rolls its own. */
export const ROCK_THEMES: ChamberStyleKey[] = [
  "ice",
  "gem",
  "ember",
  "violet",
  "lush",
  "ocean",
];

/** Camera ring for belt-exploration mode: outside the belt, looking in. */
export const BELT_CAMERA_RADIUS = 27;
export const BELT_CAMERA_HEIGHT = 4.2;

/**
 * A random bearing on the main belt (r 15.4–19.8, mirroring the dense
 * ring in AsteroidBelt) — where a scroll inside one rock throws you next.
 */
export function randomRockAnchor(): RockAnchor {
  return {
    angle: Math.random() * Math.PI * 2,
    radius: 15.4 + Math.random() * (19.8 - 15.4),
  };
}

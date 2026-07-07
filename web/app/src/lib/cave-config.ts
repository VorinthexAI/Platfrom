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

/**
 * The story vaults hide inside ordinary-looking belt asteroids, and they
 * move: every page load rolls a fresh bearing for each vault, so the
 * terms/privacy/auth asteroids are never in the same place twice. The
 * bearings live only in the client bundle's module state — nothing
 * server-rendered depends on them.
 */
function rolledAnchor(): { anchorAngle: number; anchorRadius: number } {
  return {
    anchorAngle: Math.random() * Math.PI * 2,
    anchorRadius: 15.8 + Math.random() * 3.6,
  };
}

export const CAVE_CONFIGS: Record<CaveKind, CaveConfig> = {
  join: {
    ...rolledAnchor(),
    interior: [0, -240, 0],
    theme: "gem",
    approachLabel: "Approaching the Reservation Vault",
  },
  "waitlist-verify": {
    ...rolledAnchor(),
    interior: [90, -240, 0],
    theme: "ember",
    approachLabel: "Opening the Ember Vault",
  },
  signin: {
    ...rolledAnchor(),
    interior: [180, -240, 0],
    theme: "lush",
    approachLabel: "Descending into the Grove",
  },
  members: {
    ...rolledAnchor(),
    interior: [540, -240, 0],
    theme: "violet",
    approachLabel: "Approaching the Members Gate",
  },
  magic: {
    ...rolledAnchor(),
    interior: [270, -240, 0],
    theme: "violet",
    approachLabel: "Unsealing the Cipher Chamber",
  },
  privacy: {
    ...rolledAnchor(),
    interior: [360, -240, 0],
    theme: "ice",
    approachLabel: "Opening the Records Vault",
  },
  terms: {
    ...rolledAnchor(),
    interior: [450, -240, 0],
    theme: "gem",
    approachLabel: "Opening the Accord Vault",
  },
  leaderboard: {
    ...rolledAnchor(),
    interior: [720, -240, 0],
    theme: "gem",
    approachLabel: "Approaching the Galaxy Leaderboard",
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

/** Story caves an ordinary-looking asteroid can secretly host. */
const ANCHORED_CAVE_KINDS: CaveKind[] = ["terms", "privacy", "signin", "members", "join", "leaderboard"];

/**
 * Does this belt bearing sit on one of the hidden story vaults? Diving
 * into a rock close enough to a vault's rolled anchor opens that story.
 */
export function caveKindAtAnchor(anchor: RockAnchor): CaveKind | null {
  for (const kind of ANCHORED_CAVE_KINDS) {
    const config = CAVE_CONFIGS[kind];
    const angleDelta = Math.abs(
      Math.atan2(
        Math.sin(anchor.angle - config.anchorAngle),
        Math.cos(anchor.angle - config.anchorAngle),
      ),
    );
    if (angleDelta < 0.1 && Math.abs(anchor.radius - config.anchorRadius) < 0.7) {
      return kind;
    }
  }
  return null;
}

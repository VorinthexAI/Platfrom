import { Easing } from "react-native-reanimated";
import type { WithSpringConfig } from "react-native-reanimated";

/** Shared motion vocabulary — every animation in the app pulls from here. */
export const durations = {
  fast: 180,
  base: 320,
  reveal: 900,
  splashHold: 2200,
  cardExit: 280,
  dustBurst: 480,
  buildTotal: 4200,
  buildExitDelay: 4800,
  /** Web .vui-button background-position transition (800ms luxury). */
  chromeSlide: 800,
  /** Web .vui-button color/border/shadow transition (400ms luxury). */
  buttonState: 400,
} as const;

export const easings = {
  out: Easing.out(Easing.cubic),
  inOut: Easing.inOut(Easing.cubic),
  /** Web --vui-ease-luxury: cubic-bezier(0.16, 1, 0.3, 1). */
  luxury: Easing.bezier(0.16, 1, 0.3, 1),
} as const;

export const springs = {
  /** Cancelled drag returns the card to a perfectly frontal rest pose. */
  snapBack: { damping: 17, stiffness: 190, mass: 0.7 } as WithSpringConfig,
  /** Next card pops forward from the stack with restrained overshoot. */
  promote: { damping: 13, stiffness: 150, mass: 0.85 } as WithSpringConfig,
  /** Capability cubes settle quickly with a short, visible overshoot. */
  carousel: { damping: 10, stiffness: 280, mass: 0.62 } as WithSpringConfig,
  press: { damping: 20, stiffness: 300, mass: 0.5 } as WithSpringConfig,
} as const;

/** Swipe decision thresholds. */
export const swipe = {
  distanceFactor: 0.34,
  velocity: 900,
  dragResistance: 0.94,
  maxRotationDeg: 6,
} as const;

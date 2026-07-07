"use client";

/**
 * One-shot handoff between an arrival deep link and the sealed chamber.
 *
 * When a tapped email link succeeds on a surface that is NOT the one that
 * requested it (a mail app's built-in view, another device), the arrival
 * flow parks the outcome here and opens the sealed cave — which reads it
 * to show the right success story. Module state is enough: the sealed
 * chamber mounts in the same page life as the arrival validation.
 */

export type LinkLandingAction = "signin" | "waitlist-verify";

export interface LinkLanding {
  action: LinkLandingAction;
  alias: string | null;
  waitlistNumber: number | null;
}

let landing: LinkLanding | null = null;

export function setLinkLanding(next: LinkLanding) {
  landing = next;
}

export function peekLinkLanding(): LinkLanding | null {
  return landing;
}

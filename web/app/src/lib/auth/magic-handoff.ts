"use client";

/**
 * One-shot handoff between the arrival deep link and the Cipher Chamber.
 *
 * Magic-link tokens are single-use: the arrival flow validates the token
 * while the visitor is still traveling through the solar system. If the
 * backend answers with a TOTP challenge (members), the challenge is parked
 * here so the cave flow can continue without re-validating a token that
 * has already been consumed.
 */

export interface MagicHandoff {
  status: "totp_setup_required" | "totp_required";
  challengeTokenHash: string;
}

let handoff: MagicHandoff | null = null;

export function setMagicHandoff(next: MagicHandoff) {
  handoff = next;
}

export function takeMagicHandoff(): MagicHandoff | null {
  const current = handoff;
  handoff = null;
  return current;
}

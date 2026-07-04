// neural-map.md §9.7 + §31 — the custom camera controller. Lifted close to
// verbatim from §31's reference sketch, with the gaps that sketch left
// unimplemented (retargetTowardCursor, computeBearingYaw, the regime-bounds
// constants) filled in, and one deliberate adaptation: `classifyRegime` here
// takes raw distance (matching §9.4's `updateRegime(state, rawDistance)`
// contract in regime-controller.ts) rather than `zoomTier`, so both the
// per-frame regime loop and this controller classify off the same input
// shape instead of two subtly different ones.
//
// Not `OrbitControls`/`MapControls` unmodified — those assume a single fixed
// coordinate-space target and know nothing about regime transitions or
// floating-origin rebasing (§9.2). Built as a plain class, driven imperatively
// from a single `useFrame`, never re-derived through React's render cycle.

import * as THREE from "three";
import type { Regime, SerializedCameraState } from "../types";
import { classifyRegime, distanceToZoomTier } from "./regime-controller";

export type CameraControllerEvents = {
  onRegimeCrossing: (from: Regime, to: Regime) => void;
  onSettle: (state: SerializedCameraState) => void;
  onFlightComplete: () => void;
};

// Generous safety rails, not the "zoom forever" clamp — §8.2's third
// sub-claim is that the zoom *gesture* itself is never clamped; these exist
// only to keep `distance` a finite, non-zero float. Regime hand-offs (not
// these bounds) are what actually reframes the zoom range as the camera
// crosses R0..R3.
const MIN_REGIME_DISTANCE = 0.05;
const MAX_REGIME_DISTANCE = 5_000_000;

const ORBIT_SENSITIVITY = 0.0055;
const PAN_SENSITIVITY = 0.0022;
const SETTLE_DELAY_MS = 150; // §9.7

const REGIME_BREADCRUMBS: Record<Regime, string> = {
  R0: "Cosmos",
  R1: "Nebulae",
  R2: "Constellations",
  R3: "Inspect",
};

export class UniverseCameraController {
  private camera: THREE.PerspectiveCamera;
  private focalPoint: THREE.Vector3; // origin-relative (float32-safe), §9.2
  private distance: number; // camera-to-focal distance, this regime's units
  private yaw = 0;
  private pitch = -0.15;
  private zoomTier = 0; // continuous, drives §9.4's regime classification
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private flight: CameraFlight | null = null;
  private currentRegime: Regime = "R0";
  private focusNodeId: string | null = null;
  private reducedMotion: boolean;
  private raycaster = new THREE.Raycaster();

  constructor(
    camera: THREE.PerspectiveCamera,
    private events: CameraControllerEvents,
    options: { zoomSensitivity?: number; reducedMotion?: boolean } = {},
  ) {
    this.camera = camera;
    this.focalPoint = new THREE.Vector3();
    this.distance = 2000; // initial R0-ish distance
    this.zoomSensitivity = options.zoomSensitivity ?? 0.0018;
    this.reducedMotion = options.reducedMotion ?? false;
    this.zoomTier = distanceToZoomTier(this.distance);
    this.currentRegime = classifyRegime(this.distance);
  }

  private zoomSensitivity: number;

  handleWheel(deltaY: number, cursorNdc: THREE.Vector2, fast = false) {
    // Multiplicative zoom — §9.7's rationale for why this must not be additive.
    const sensitivity = fast ? this.zoomSensitivity * 4 : this.zoomSensitivity;
    const factor = Math.exp(-deltaY * sensitivity);
    this.distance = clamp(
      this.distance * factor,
      MIN_REGIME_DISTANCE,
      MAX_REGIME_DISTANCE,
    );
    this.zoomTier = distanceToZoomTier(this.distance);
    this.retargetTowardCursor(cursorNdc, factor); // zoom-to-cursor, §8.3
    this.armSettleTimer();
  }

  handleDrag(deltaX: number, deltaYPixels: number, orbiting: boolean) {
    if (orbiting) {
      this.yaw += deltaX * ORBIT_SENSITIVITY;
      this.pitch = clamp(
        this.pitch + deltaYPixels * ORBIT_SENSITIVITY,
        -Math.PI / 2 + 0.05,
        Math.PI / 2 - 0.05,
      );
    } else {
      // Pan — moves the focal point, not just the camera, so orbiting after a
      // pan still orbits around the (now-moved) point the user was looking at.
      const right = new THREE.Vector3(
        Math.cos(this.yaw),
        0,
        -Math.sin(this.yaw),
      );
      const forward = new THREE.Vector3(
        Math.sin(this.yaw),
        0,
        Math.cos(this.yaw),
      );
      this.focalPoint.addScaledVector(
        right,
        -deltaX * PAN_SENSITIVITY * this.distance,
      );
      this.focalPoint.addScaledVector(
        forward,
        deltaYPixels * PAN_SENSITIVITY * this.distance,
      );
    }
    this.armSettleTimer();
  }

  /** Esc / deselect — does not change zoom, per §8.3. */
  clearFocus() {
    this.focusNodeId = null;
  }

  /** Scripted transition per §8.4 — logarithmic-time ease on the zoom-tier
   *  dimension, orbital sweep on bearing, not a straight linear dolly.
   *  Replaces any in-flight flight rather than queuing (§64 chaos-scenario
   *  requirement: "this.flight = new CameraFlight(...)"). */
  flyTo(
    targetFocal: THREE.Vector3,
    targetDistance: number,
    options: { durationMs?: number; focusNodeId?: string | null } = {},
  ) {
    const durationMs = this.reducedMotion ? 0 : (options.durationMs ?? 1400);
    this.focusNodeId = options.focusNodeId ?? null;

    if (durationMs <= 0) {
      // prefers-reduced-motion → instant cut, §14.3.
      this.focalPoint.copy(targetFocal);
      this.distance = targetDistance;
      this.yaw = computeBearingYaw(this.focalPoint, targetFocal, this.yaw);
      this.zoomTier = distanceToZoomTier(this.distance);
      this.flight = null;
      this.events.onFlightComplete();
      return;
    }

    this.flight = new CameraFlight({
      fromFocal: this.focalPoint.clone(),
      toFocal: targetFocal.clone(),
      fromDistance: this.distance,
      toDistance: targetDistance,
      fromYaw: this.yaw,
      toYaw: computeBearingYaw(this.focalPoint, targetFocal, this.yaw),
      durationMs,
    });
  }

  /** Called once per frame from the R3F `<Canvas>`'s `useFrame` loop. */
  tick(deltaMs: number) {
    if (this.flight) {
      const done = this.flight.step(deltaMs, (state) => {
        this.focalPoint.copy(state.focal);
        this.distance = state.distance;
        this.yaw = state.yaw;
        this.zoomTier = distanceToZoomTier(this.distance);
      });
      if (done) {
        this.flight = null;
        this.events.onFlightComplete();
      }
    }

    this.applyToThreeCamera();
    const newRegime = classifyRegime(this.distance);
    if (newRegime !== this.currentRegime) {
      this.events.onRegimeCrossing(this.currentRegime, newRegime);
      this.currentRegime = newRegime;
    }
  }

  private retargetTowardCursor(cursorNdc: THREE.Vector2, factor: number) {
    // Approximate the world point under the cursor by intersecting the
    // cursor ray with the plane perpendicular to view direction, at the
    // current focal distance from the camera — then pull the focal point
    // toward (zoom in) or away from (zoom out) that point proportionally to
    // how much the distance just changed, so the point under the cursor
    // stays visually anchored across the zoom step (§8.3's zoom-to-cursor).
    this.raycaster.setFromCamera(cursorNdc, this.camera);
    const targetPoint = this.raycaster.ray.origin
      .clone()
      .addScaledVector(this.raycaster.ray.direction, this.distance);
    const pull = clamp(1 - factor, -0.5, 0.5);
    this.focalPoint.lerp(targetPoint, pull);
  }

  private applyToThreeCamera() {
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).multiplyScalar(this.distance);
    this.camera.position.copy(this.focalPoint).add(offset);
    this.camera.lookAt(this.focalPoint);
  }

  private armSettleTimer() {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.events.onSettle(this.serialize());
    }, SETTLE_DELAY_MS);
  }

  serialize(): SerializedCameraState {
    return {
      x: this.focalPoint.x,
      y: this.focalPoint.y,
      z: this.focalPoint.z,
      yaw: this.yaw,
      pitch: this.pitch,
      tier: this.zoomTier,
      focus: this.focusNodeId,
    };
  }

  /** Restores camera state from the URL-serialized frame (§8.7/§9.2.4). */
  restore(state: SerializedCameraState) {
    this.focalPoint.set(state.x, state.y, state.z);
    this.yaw = state.yaw;
    this.pitch = state.pitch;
    this.focusNodeId = state.focus;
    // `tier` in the URL is redundant with distance but kept explicit so a
    // loaded page can request the right tile bundle before distance math
    // runs (§8.7) — reconstruct a representative distance for that tier.
    this.distance = zoomTierToApproxDistance(state.tier);
    this.zoomTier = distanceToZoomTier(this.distance);
    this.currentRegime = classifyRegime(this.distance);
    this.applyToThreeCamera();
  }

  getRegime(): Regime {
    return this.currentRegime;
  }

  getZoomTier(): number {
    return this.zoomTier;
  }

  getBreadcrumb(): string {
    return REGIME_BREADCRUMBS[this.currentRegime];
  }

  getFocalPoint(): THREE.Vector3 {
    return this.focalPoint.clone();
  }

  getDistance(): number {
    return this.distance;
  }

  dispose() {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.flight = null;
  }
}

/** Logarithmic-time ease on zoom tier, orbital bearing sweep on yaw — §8.4. */
class CameraFlight {
  private elapsed = 0;
  constructor(private plan: FlightPlan) {}

  step(deltaMs: number, apply: (state: FlightFrameState) => void): boolean {
    this.elapsed += deltaMs;
    const t = clamp(this.elapsed / this.plan.durationMs, 0, 1);
    const eased = cubicBezierEase(t); // standard ease-in-out on normalized time

    // Interpolate distance in LOG space, not linear space — see §8.4's
    // rationale: equal *perceptual* zoom-tier progress per unit of eased
    // time, not equal raw-distance progress (which would either rush or
    // crawl at the extremes).
    const logFrom = Math.log(this.plan.fromDistance);
    const logTo = Math.log(this.plan.toDistance);
    const distance = Math.exp(logFrom + (logTo - logFrom) * eased);

    const focal = this.plan.fromFocal.clone().lerp(this.plan.toFocal, eased);
    const yaw = lerpAngle(this.plan.fromYaw, this.plan.toYaw, eased);

    apply({ focal, distance, yaw });
    return t >= 1;
  }
}

type FlightPlan = {
  fromFocal: THREE.Vector3;
  toFocal: THREE.Vector3;
  fromDistance: number;
  toDistance: number;
  fromYaw: number;
  toYaw: number;
  durationMs: number;
};
type FlightFrameState = { focal: THREE.Vector3; distance: number; yaw: number };

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function cubicBezierEase(t: number) {
  return t * t * (3 - 2 * t); // smoothstep as a placeholder for a tuned
  // cubic-bezier, §23.2's --vx-ease-standard
}
function lerpAngle(a: number, b: number, t: number) {
  const diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  return a + diff * t;
}

/** Bearing yaw from `from` toward `to` — the "great-circle-style" sweep
 *  target for §8.4's fly-to path, matching `applyToThreeCamera`'s
 *  sin(yaw)/cos(yaw) offset convention. */
function computeBearingYaw(
  from: THREE.Vector3,
  to: THREE.Vector3,
  fallbackYaw: number,
): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return fallbackYaw;
  return Math.atan2(dx, dz);
}

/** Approximate a representative distance for a serialized continuous
 *  `zoomTier` — inverse of `distanceToZoomTier`, used only to reconstruct
 *  camera state on load (§9.2.4). */
function zoomTierToApproxDistance(tier: number): number {
  // distanceToZoomTier is log-linear across anchors 0..4 spanning
  // 100_000..1 world units — invert that same mapping here.
  const logMax = Math.log(100_000);
  const logMin = Math.log(1);
  const clampedTier = tier; // intentionally unclamped, matches §8.2's "no floor"
  const t = clampedTier / 4;
  return Math.exp(logMax + (logMin - logMax) * t);
}

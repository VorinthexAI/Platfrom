"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  presenceMotion,
  usePresenceStore,
} from "@/lib/presence/presence-store";

/**
 * Fellow explorers, live: every other open tab is a medium orange-gold
 * EIGHT-POINTED glowing star drifting wherever its explorer's camera
 * goes, trailing a tail of star dust that fades as it moves, with the
 * explorer's alias hanging behind it as a small badge. None of it
 * reacts to the mouse. Your own star is your camera — it sits behind
 * your eyes, so you never see yourself, only the others.
 */

const STAR_COLOR = "#ffc766";
const GLOW_COLOR = "#ff9d3c";
const TRAIL_COUNT = 30;
/** New dust settles this far apart along the path. */
const TRAIL_SPACING = 0.22;

/* ------------------------------------------------------------------ */
/* Shared textures (one canvas each, cached for every star)            */
/* ------------------------------------------------------------------ */

let starTexture: THREE.CanvasTexture | null = null;

/** An 8-pointed star with a hot white core and orange-gold falloff. */
function getStarTexture(): THREE.CanvasTexture {
  if (starTexture) return starTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;

  // Soft radial glow behind the points.
  const glow = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  glow.addColorStop(0, "rgba(255, 236, 190, 0.9)");
  glow.addColorStop(0.35, "rgba(255, 176, 84, 0.38)");
  glow.addColorStop(1, "rgba(255, 150, 50, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // The eight points: alternating long/short spikes.
  ctx.translate(cx, cx);
  ctx.beginPath();
  const spikes = 8;
  const outer = size * 0.46;
  const inner = size * 0.1;
  for (let i = 0; i < spikes * 2; i += 1) {
    const radius = i % 2 === 0 ? (i % 4 === 0 ? outer : outer * 0.62) : inner;
    const angle = (i * Math.PI) / spikes - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, outer);
  core.addColorStop(0, "rgba(255, 255, 245, 0.98)");
  core.addColorStop(0.3, "rgba(255, 214, 130, 0.85)");
  core.addColorStop(1, "rgba(255, 160, 60, 0)");
  ctx.fillStyle = core;
  ctx.fill();

  starTexture = new THREE.CanvasTexture(canvas);
  return starTexture;
}

/** Small glowing dot reused for the dust tail. */
let dustTexture: THREE.CanvasTexture | null = null;
function getDustTexture(): THREE.CanvasTexture {
  if (dustTexture) return dustTexture;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, "rgba(255, 226, 170, 1)");
  gradient.addColorStop(0.5, "rgba(255, 180, 90, 0.55)");
  gradient.addColorStop(1, "rgba(255, 150, 50, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  dustTexture = new THREE.CanvasTexture(canvas);
  return dustTexture;
}

/** Alias badge texture: a quiet monochrome pill with the explorer name. */
function createBadgeTexture(alias: string): {
  texture: THREE.CanvasTexture;
  aspect: number;
} {
  const font = "600 22px 'JetBrains Mono', monospace";
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const label = alias.toUpperCase();
  const textWidth = Math.ceil(measure.measureText(label).width);
  const padX = 26;
  const height = 52;
  const width = textWidth + padX * 2;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const radius = height / 2;
  ctx.beginPath();
  ctx.roundRect(1, 1, width - 2, height - 2, radius);
  ctx.fillStyle = "rgba(3, 5, 7, 0.62)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 199, 102, 0.4)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255, 226, 170, 0.92)";
  ctx.fillText(label, width / 2, height / 2 + 1);

  return { texture: new THREE.CanvasTexture(canvas), aspect: width / height };
}

/* ------------------------------------------------------------------ */
/* One remote explorer                                                 */
/* ------------------------------------------------------------------ */

function VisitorStar({ session }: { session: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const starRef = useRef<THREE.Sprite>(null);
  const badgeRef = useRef<THREE.Sprite>(null);
  const trailRef = useRef<THREE.Points>(null);
  const timeRef = useRef(0);
  // Deterministic per-session phase so the stars don't pulse in lockstep.
  const phase = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < session.length; i += 1) {
      hash = (hash * 31 + session.charCodeAt(i)) % 997;
    }
    return hash / 158;
  }, [session]);
  const badgePos = useRef(new THREE.Vector3());
  const initializedRef = useRef(false);
  const trailStateRef = useRef({
    cursor: 0,
    last: new THREE.Vector3(),
    ages: new Float32Array(TRAIL_COUNT).fill(Infinity),
  });

  const alias = usePresenceStore.getState().visitors[session]?.alias ?? "Explorer";
  const badge = useMemo(() => createBadgeTexture(alias), [alias]);
  useEffect(() => {
    return () => {
      badge.texture.dispose();
    };
  }, [badge]);

  const trailGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(TRAIL_COUNT * 3), 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(TRAIL_COUNT * 3), 3),
    );
    return geometry;
  }, []);
  useEffect(() => {
    return () => {
      trailGeometry.dispose();
    };
  }, [trailGeometry]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const visitor = usePresenceStore.getState().visitors[session];
    if (!visitor) return;
    timeRef.current += delta;
    const t = timeRef.current + phase;

    const target = new THREE.Vector3(...visitor.position);
    if (!initializedRef.current) {
      initializedRef.current = true;
      group.position.copy(target);
      badgePos.current.copy(target);
      trailStateRef.current.last.copy(target);
    }
    // Glide toward the last published position (beats arrive every ~5s).
    group.position.lerp(target, Math.min(1, delta * 1.6));

    // The star breathes.
    if (starRef.current) {
      const pulse = 1 + Math.sin(t * 2.1) * 0.12;
      starRef.current.scale.setScalar(0.85 * pulse);
      starRef.current.material.rotation += delta * 0.4;
    }

    // Star dust: drop a mote whenever the star has traveled far enough,
    // then let every mote age out — the scent it leaves behind.
    const trail = trailStateRef.current;
    for (let i = 0; i < TRAIL_COUNT; i += 1) trail.ages[i] += delta;
    if (group.position.distanceTo(trail.last) > TRAIL_SPACING) {
      trail.last.copy(group.position);
      const slot = trail.cursor;
      trail.cursor = (trail.cursor + 1) % TRAIL_COUNT;
      trail.ages[slot] = 0;
      const positions = trailGeometry.getAttribute("position") as THREE.BufferAttribute;
      positions.setXYZ(
        slot,
        group.position.x + (Math.random() - 0.5) * 0.14,
        group.position.y + (Math.random() - 0.5) * 0.14,
        group.position.z + (Math.random() - 0.5) * 0.14,
      );
      positions.needsUpdate = true;
    }
    const colors = trailGeometry.getAttribute("color") as THREE.BufferAttribute;
    for (let i = 0; i < TRAIL_COUNT; i += 1) {
      // ~4s of afterglow per mote, warm orange cooling to nothing.
      const life = Math.max(0, 1 - trail.ages[i] / 4);
      const eased = life * life;
      colors.setXYZ(i, 1 * eased, 0.72 * eased, 0.34 * eased);
    }
    colors.needsUpdate = true;

    // The alias badge hangs after the star: it chases with a softer
    // spring, always a beat behind, floating slightly below.
    badgePos.current.lerp(group.position, Math.min(1, delta * 1.0));
    if (badgeRef.current) {
      badgeRef.current.position.set(
        badgePos.current.x - group.position.x,
        badgePos.current.y - group.position.y - 0.62,
        badgePos.current.z - group.position.z,
      );
    }
  });

  return (
    <group ref={groupRef}>
      {/* the eight-pointed star */}
      <sprite ref={starRef} scale={[0.85, 0.85, 1]}>
        <spriteMaterial
          map={getStarTexture()}
          color={STAR_COLOR}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* halo */}
      <sprite scale={[2, 2, 1]}>
        <spriteMaterial
          map={getDustTexture()}
          color={GLOW_COLOR}
          transparent
          opacity={0.32}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* fading star dust behind the flight path */}
      <points ref={trailRef} geometry={trailGeometry} frustumCulled={false}>
        <pointsMaterial
          map={getDustTexture()}
          size={0.16}
          sizeAttenuation
          vertexColors
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      {/* the alias, hanging after — no mouse interaction, ever */}
      <sprite
        ref={badgeRef}
        scale={[badge.aspect * 0.34, 0.34, 1]}
        position={[0, -0.62, 0]}
      >
        <spriteMaterial
          map={badge.texture}
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      </sprite>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* The constellation of everyone here right now                        */
/* ------------------------------------------------------------------ */

export function VisitorStars() {
  const camera = useThree((s) => s.camera);
  const sessionIds = usePresenceStore((s) => s.sessionIds);

  // Publish our own position: the star others see IS our camera — it
  // rides behind our eyes, which is exactly why we never see it.
  useFrame(() => {
    presenceMotion.position[0] = camera.position.x;
    presenceMotion.position[1] = camera.position.y;
    presenceMotion.position[2] = camera.position.z;
  });

  return (
    <group>
      {sessionIds.map((session) => (
        <VisitorStar key={session} session={session} />
      ))}
    </group>
  );
}

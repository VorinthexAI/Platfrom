"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  SUN_SURFACE_FRAGMENT_SHADER,
  SUN_SURFACE_VERTEX_SHADER,
  sunHeartbeat,
} from "@/lib/three/sun-shader";

/**
 * The founders-gate backdrop: the camera hangs just off the Nexus sun so
 * its surface — the identical shader, colors, and heartbeat the star runs
 * in the galaxy overview — fills the whole viewport. No emblem, no floor
 * disc, no chrome: just the burning outside of the sun.
 */

// Much larger than the overview star (1.35): the noise runs in object
// space, so a bigger radius keeps the convection cells at the density
// they have on the distant sun instead of blowing up into soft blobs.
const SURFACE_RADIUS = 9;

function SurfaceStar({ paused }: { paused: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uPulse: { value: sunHeartbeat(0) } }),
    [],
  );

  // Keep the star overfilling the frame at every aspect ratio: pull the
  // camera in until the limb sits outside all four corners (with margin
  // for the 13% pulse swell), never closer than the near plane allows.
  useEffect(() => {
    const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hHalf = Math.atan(
      Math.tan(vHalf) * (size.width / Math.max(1, size.height)),
    );
    const dHalf = Math.atan(Math.hypot(Math.tan(vHalf), Math.tan(hHalf)));
    const overfill = Math.min(dHalf * 1.14, 1.42);
    camera.position.set(
      0,
      0,
      Math.max(SURFACE_RADIUS + 0.25, SURFACE_RADIUS / Math.sin(overfill)),
    );
    camera.updateProjectionMatrix();
  }, [camera, size]);

  useFrame((_, delta) => {
    if (paused || !materialRef.current) return;
    const time = (materialRef.current.uniforms.uTime.value += delta);
    materialRef.current.uniforms.uPulse.value = sunHeartbeat(time);
    if (meshRef.current) {
      // The overview system slowly spins the whole star; up close the same
      // drift keeps fresh convection cells rolling through the frame.
      meshRef.current.rotation.y += delta * 0.02;
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[SURFACE_RADIUS, 96, 96]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={SUN_SURFACE_VERTEX_SHADER}
        fragmentShader={SUN_SURFACE_FRAGMENT_SHADER}
        uniforms={uniforms}
      />
    </mesh>
  );
}

export default function SunSurface() {
  const [hidden, setHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMedia = () => setReducedMotion(media.matches);
    onMedia();
    media.addEventListener("change", onMedia);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      media.removeEventListener("change", onMedia);
    };
  }, []);

  return (
    <Canvas
      frameloop={hidden ? "never" : "always"}
      dpr={[1, 1.75]}
      camera={{ fov: 55, near: 0.1, far: 30 }}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      aria-hidden
      className="!absolute !inset-0"
    >
      <SurfaceStar paused={hidden || reducedMotion} />
    </Canvas>
  );
}

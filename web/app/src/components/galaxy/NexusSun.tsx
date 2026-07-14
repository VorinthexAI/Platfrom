"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { trackCtaClick } from "@/lib/analytics";
import { galaxyMotion, useGalaxyStore } from "@/lib/galaxy-store";
import {
  SUN_SURFACE_FRAGMENT_SHADER,
  SUN_SURFACE_VERTEX_SHADER,
  sunHeartbeat,
} from "@/lib/three/sun-shader";

/**
 * The Nexus sun: a golden intelligent star that burns and breathes —
 * convection cells churn across the surface while the whole body pulses
 * smoothly in 3D. Bright enough to anchor the system, still metallic
 * rather than cartoon-yellow. No emblem, no label: the sun speaks for
 * itself. The surface shader lives in lib/three/sun-shader so the
 * founders-gate backdrop (/nexus) burns with the identical material.
 */

export function NexusSun({ paused }: { paused: boolean }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const haloRef = useRef<THREE.Sprite>(null);
  const haloWideRef = useRef<THREE.Sprite>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const holdTimerRef = useRef<number | null>(null);

  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uPulse: { value: 0 } }),
    [],
  );

  // The master brand ring: the sun sits WITHIN the Vorinthex mark.
  const ringRef = useRef<THREE.Group>(null);
  const markTexture = useMemo(() => {
    const texture = new THREE.TextureLoader().load("/logos/vorinthex-mark.png");
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  const glowTexture = useMemo(() => {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2,
    );
    gradient.addColorStop(0, "rgba(255, 178, 92, 0.85)");
    gradient.addColorStop(0.25, "rgba(232, 132, 46, 0.35)");
    gradient.addColorStop(0.6, "rgba(180, 92, 32, 0.1)");
    gradient.addColorStop(1, "rgba(160, 80, 28, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }, []);

  useFrame((_, delta) => {
    if (paused || !materialRef.current) return;
    const time = (materialRef.current.uniforms.uTime.value += delta);
    // An unmissable heartbeat: deep primary pulse with a double-beat on top.
    const pulse = sunHeartbeat(time);
    materialRef.current.uniforms.uPulse.value = pulse;
    if (haloRef.current) {
      haloRef.current.material.opacity = 0.6 + pulse * 0.42;
      haloRef.current.scale.setScalar(5.7 + pulse * 2.4);
    }
    if (haloWideRef.current) {
      haloWideRef.current.material.opacity = 0.14 + pulse * 0.36;
      haloWideRef.current.scale.setScalar(11.5 + pulse * 4.2);
    }
    if (lightRef.current) {
      lightRef.current.intensity = 42 + pulse * 44;
    }
    if (ringRef.current) {
      // The mark breathes with its star and turns imperceptibly.
      ringRef.current.rotation.z += delta * 0.03;
      ringRef.current.scale.setScalar(1 + pulse * 0.03);
    }
  });

  function clearHoldTimer() {
    galaxyMotion.holdingSun = false;
    galaxyMotion.sunHold = null;
    galaxyMotion.sunHoldId += 1;
    galaxyMotion.cancelSunHold = null;
    if (holdTimerRef.current === null) return;
    window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  }

  // If the scene unmounts mid-hold (a jump begins, WebGL drops), release
  // the shared holdingSun claim — a leaked true would permanently disable
  // drag-to-rotate across the whole stage.
  useEffect(() => clearHoldTimer, []);

  function beginFoundersHold(event: ThreeEvent<PointerEvent>) {
    if (galaxyMotion.cancelSunHold && galaxyMotion.cancelSunHold !== clearHoldTimer) {
      galaxyMotion.cancelSunHold();
    }
    clearHoldTimer();
    const holdId = galaxyMotion.sunHoldId + 1;
    galaxyMotion.sunHoldId = holdId;
    // Claim the gesture before UniverseStage's own pointerdown/touchstart
    // listeners on the canvas see it — otherwise the resting overview state
    // (canRotate() === true) turns this same press into a camera-drag,
    // which reorients the ray under a still cursor and makes R3F think the
    // pointer left the sun mesh, cancelling the hold well before 3s.
    galaxyMotion.holdingSun = true;
    galaxyMotion.sunHold = {
      id: holdId,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
    };
    galaxyMotion.cancelSunHold = clearHoldTimer;
    holdTimerRef.current = window.setTimeout(() => {
      if (!galaxyMotion.holdingSun || galaxyMotion.sunHoldId !== holdId) return;
      holdTimerRef.current = null;
      galaxyMotion.holdingSun = false;
      galaxyMotion.sunHold = null;
      galaxyMotion.sunHoldId += 1;
      galaxyMotion.cancelSunHold = null;
      trackCtaClick("founders_gate_open", { placement: "sun_long_press" });
      useGalaxyStore.getState().startJump("sun");
    }, 3000);
  }

  return (
    <group>
      {/* Only the star's body claims the founders-gate hold. The ring,
          halos and lights below must stay out of the raycaster: they span
          up to ~15 world units around the sun, so letting them catch
          pointer events turns most of the screen center into a dead zone
          where holdingSun swallows every drag-to-rotate gesture. */}
      <mesh
        onPointerDown={(event) => {
          event.stopPropagation();
          beginFoundersHold(event);
        }}
        onPointerUp={clearHoldTimer}
        onPointerLeave={clearHoldTimer}
        onPointerCancel={clearHoldTimer}
      >
        <sphereGeometry args={[1.35, 64, 64]} />
        <shaderMaterial
          ref={materialRef}
          vertexShader={SUN_SURFACE_VERTEX_SHADER}
          fragmentShader={SUN_SURFACE_FRAGMENT_SHADER}
          uniforms={uniforms}
        />
      </mesh>
      {/* the Vorinthex ring — the sun burns within the brand mark */}
      <Billboard>
        <group ref={ringRef}>
          <mesh raycast={() => null}>
            <planeGeometry args={[4.7, 4.7]} />
            <meshBasicMaterial
              map={markTexture}
              transparent
              opacity={0.85}
              depthWrite={false}
            />
          </mesh>
        </group>
      </Billboard>

      {/* layered halo, breathing with the pulse */}
      <sprite ref={haloRef} scale={[6.5, 6.5, 1]} raycast={() => null}>
        <spriteMaterial
          map={glowTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <sprite ref={haloWideRef} scale={[13, 13, 1]} raycast={() => null}>
        <spriteMaterial
          map={glowTexture}
          transparent
          opacity={0.35}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* the sun is the scene's key light — its glow pulses with the surface */}
      <pointLight
        ref={lightRef}
        color="#e8842e"
        intensity={60}
        distance={40}
        decay={1.8}
      />
      <pointLight color="#dde2e5" intensity={10} distance={44} decay={2} />
    </group>
  );
}

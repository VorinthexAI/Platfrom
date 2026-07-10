"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import { trackCtaClick } from "@/lib/analytics";
import { useGalaxyStore } from "@/lib/galaxy-store";

/**
 * The Nexus sun: a golden intelligent star that burns and breathes —
 * convection cells churn across the surface while the whole body pulses
 * smoothly in 3D. Bright enough to anchor the system, still metallic
 * rather than cartoon-yellow. No emblem, no label: the sun speaks for
 * itself.
 */
const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    // Plasma breathing: the whole star dramatically swells and settles,
    // with rolling surface waves on top.
    vec3 displaced = position * (1.0 + uPulse * 0.13)
      + normal * sin(uTime * 1.2 + position.y * 3.0 + position.x * 2.0) * 0.028;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  varying vec3 vNormal;
  varying vec3 vPosition;

  // Ashima 3D simplex noise (public domain).
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  void main() {
    // Two drift layers plus a fast churn layer: burning convection cells.
    float n = snoise(vPosition * 2.4 + vec3(uTime * 0.06));
    float n2 = snoise(vPosition * 6.0 - vec3(uTime * 0.04));
    float churn = snoise(vPosition * 3.2 + vec3(0.0, uTime * 0.22, uTime * 0.1));
    float veins = smoothstep(0.05, 0.8, n * 0.55 + n2 * 0.35 + churn * 0.2);

    vec3 coreDark = vec3(0.10, 0.05, 0.02);
    vec3 gold = vec3(1.0, 0.62, 0.22);
    vec3 emberDeep = vec3(0.72, 0.36, 0.12);

    vec3 color = mix(coreDark, emberDeep, veins);

    // Bright golden limb, breathing hard with the pulse: the whole star
    // brightens and dims like a heartbeat.
    float rim = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 1.6);
    color += gold * rim * (1.1 + uPulse * 1.5);
    color += gold * veins * (0.18 + uPulse * 0.75);
    color *= 0.82 + uPulse * 0.42;

    gl_FragColor = vec4(color, 1.0);
  }
`;

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
    const pulse =
      0.5 +
      0.46 * Math.sin(time * 0.9) +
      0.16 * Math.sin(time * 2.3 + 1.2);
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
    if (holdTimerRef.current === null) return;
    window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  }

  function beginFoundersHold() {
    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      trackCtaClick("founders_gate_open", { placement: "sun_long_press" });
      useGalaxyStore.getState().startJump("sun");
    }, 3000);
  }

  return (
    <group
      onPointerDown={(event) => {
        event.stopPropagation();
        beginFoundersHold();
      }}
      onPointerUp={clearHoldTimer}
      onPointerLeave={clearHoldTimer}
      onPointerCancel={clearHoldTimer}
    >
      <mesh>
        <sphereGeometry args={[1.35, 64, 64]} />
        <shaderMaterial
          ref={materialRef}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
        />
      </mesh>
      {/* the Vorinthex ring — the sun burns within the brand mark */}
      <Billboard>
        <group ref={ringRef}>
          <mesh>
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
      <sprite ref={haloRef} scale={[6.5, 6.5, 1]}>
        <spriteMaterial
          map={glowTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <sprite ref={haloWideRef} scale={[13, 13, 1]}>
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

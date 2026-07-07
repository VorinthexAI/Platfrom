"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SIMPLEX_NOISE_GLSL } from "@/lib/three/glsl";
import {
  biomeForEntity,
  biomeStyleFor,
  createBiomePlanetGeometry,
  type PlanetBiome,
} from "@/lib/three/planet";
import { hashString, mulberry32 } from "@/lib/three/procedural";

/**
 * Shader-driven biome worlds lit by the Nexus sun at the origin: banded
 * gas giants, crackled ice, dark oceans with graphite islands, glowing
 * lava fissures, cratered grey worlds, ridged silver-capped mountains,
 * bioluminescent moss moons. Dormant worlds desaturate to a soft silver
 * tone — sleeping, never black (V4 §48).
 */

const planetVertexShader = /* glsl */ `
  attribute float aHeight;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vLocal;
  varying float vHeight;
  void main() {
    vLocal = position;
    vHeight = aHeight;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const planetFragmentShader = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uDeep;
  uniform vec3 uVein;
  uniform vec3 uAccent;
  uniform vec3 uRimColor;
  uniform float uBandFreq;
  uniform float uBandWeight;
  uniform float uCrackWeight;
  uniform float uCraterWeight;
  uniform float uGlowWeight;
  uniform float uHeightWeight;
  uniform float uSpecStrength;
  uniform float uBump;
  uniform float uNoiseFreq;
  uniform float uWarp;
  uniform float uAccentWeight;
  uniform float uRimStrength;
  uniform float uFlow;
  uniform float uTime;
  uniform float uDesat;
  uniform float uDim;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vLocal;
  varying float vHeight;

  ${SIMPLEX_NOISE_GLSL}

  // Terrain height field driving both color detail and bump normals.
  float terrain(vec3 q) {
    return fbm(q * 2.6 + vec3(11.3));
  }

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    // The Nexus sun sits at the origin — planets are lit from within the system.
    vec3 L = normalize(-vWorldPos);

    vec3 p = normalize(vLocal) * uNoiseFreq + vec3(uTime * uFlow);
    float warp = fbm(p) * uWarp;

    // Procedural bump: perturb the normal by the terrain gradient so the
    // surface catches light like real relief, not painted shading.
    if (uBump > 0.001) {
      vec3 tangent1 = normalize(cross(N, vec3(0.0, 1.0, 0.001)));
      vec3 tangent2 = normalize(cross(N, tangent1));
      float eps = 0.07;
      float h0 = terrain(p);
      float hx = terrain(p + tangent1 * eps);
      float hy = terrain(p + tangent2 * eps);
      N = normalize(
        N - (tangent1 * (hx - h0) + tangent2 * (hy - h0)) * (uBump * 4.5)
      );
    }

    // Flowing latitude bands, warped by noise (gas giants live here).
    float bands = 0.5 + 0.5 * sin(normalize(vLocal).y * uBandFreq * 3.0 + warp * 3.2);
    // Thin ridged fractures: plate seams, ice crackle, lava fissures.
    float cracks = smoothstep(0.55, 0.95, 1.0 - abs(snoise(p * 1.8 + vec3(warp))));
    // Fine mineral detail.
    float grain = 0.5 + 0.5 * fbm(p * 2.6 + vec3(11.3));
    // Impact scars: cellular-ish rings from layered ridged noise.
    float craterField = 1.0 - abs(snoise(p * 2.3 + vec3(37.7)));
    float craterFloor = smoothstep(0.78, 0.95, craterField);
    float craterRim = smoothstep(0.68, 0.78, craterField) - smoothstep(0.78, 0.9, craterField);

    float pattern = clamp(mix(grain, bands, uBandWeight), 0.0, 1.0);
    vec3 surface = mix(uDeep, uBase, pattern);
    surface = mix(surface, uVein, cracks * uCrackWeight);
    surface = mix(surface, uDeep * 0.65, craterFloor * uCraterWeight);
    surface += uVein * craterRim * uCraterWeight * 0.45;
    // Height tint: peaks catch silver (mountain snow), basins deepen (ocean islands).
    surface = mix(surface, uVein, smoothstep(0.35, 0.9, vHeight) * uHeightWeight);
    surface = mix(surface, uDeep, smoothstep(-0.35, -0.9, vHeight) * uHeightWeight * 0.6);
    surface = mix(
      surface,
      uAccent,
      uAccentWeight * smoothstep(0.72, 1.0, bands) * (0.35 + cracks * 0.65)
    );

    // Soft terminator with an ambient floor so the night side stays present.
    float ndl = dot(N, L);
    float dayside = smoothstep(-0.25, 0.45, ndl);
    float lambert = 0.26 + 0.85 * dayside;

    // Chrome/water specular from the sun.
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 46.0) * uSpecStrength * dayside;

    // Fresnel rim — star and galaxy light catching the limb.
    float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4);

    // Emissive fissure glow (lava, lush bioluminescence) — pulses slowly,
    // brightest on the night side where the crust light shows.
    float glowPulse = 0.75 + 0.25 * sin(uTime * 1.6 + vLocal.x * 4.0);
    vec3 glow = uAccent * cracks * uGlowWeight * glowPulse * (1.2 - dayside * 0.6);

    // Warm dusk band: the sun's ember light grazing the terminator.
    float dusk = smoothstep(-0.28, 0.05, ndl) * (1.0 - smoothstep(0.05, 0.42, ndl));

    vec3 color = surface * lambert
      + vec3(0.86, 0.9, 0.94) * spec
      + uRimColor * fresnel * uRimStrength
      + vec3(0.85, 0.45, 0.18) * dusk * 0.22
      + glow;

    // Dormant: desaturate toward soft silver and dim — visible, asleep.
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, vec3(luma) * vec3(0.9, 0.96, 1.05), uDesat);
    color *= 1.0 - uDim;

    gl_FragColor = vec4(color, 1.0);
  }
`;

const cloudVertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const cloudFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uCoverage;
  uniform vec3 uCloudColor;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vLocal;

  ${SIMPLEX_NOISE_GLSL}

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(-vWorldPos);
    vec3 p = normalize(vLocal);
    // Two drift layers shear against each other — living weather.
    float bank = fbm(p * 2.1 + vec3(uTime * 0.012, 0.0, uTime * 0.02));
    float wisp = fbm(p * 4.6 - vec3(uTime * 0.018, uTime * 0.008, 0.0));
    float density = smoothstep(1.0 - uCoverage * 1.4, 1.0, 0.55 + bank * 0.4 + wisp * 0.2);
    float dayside = smoothstep(-0.2, 0.5, dot(N, L));
    float alpha = density * (0.12 + dayside * 0.5);
    gl_FragColor = vec4(uCloudColor * (0.55 + dayside * 0.55), alpha);
  }
`;

const atmosphereVertexShader = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const atmosphereFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec3 vNormal;
  void main() {
    float glow = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.2);
    gl_FragColor = vec4(uColor, 1.0) * glow * uIntensity;
  }
`;

/** Curated biomes for the product planets (children are hashed). */
const PRODUCT_BIOMES: Record<string, PlanetBiome> = {
  // Core is alive: a bioluminescent world, glowing veins and weather.
  core: "lush",
  command: "steel",
  studio: "gas",
  launch: "lava",
};

interface PlanetSurfaceProps {
  /** Registry entity id — seeds the biome pick and palette jitter. */
  entityId: string;
  /** Explicit biome override (products); children derive from the id hash. */
  biome?: PlanetBiome;
  radius?: number;
  segments?: number;
  paused: boolean;
  /** coming-soon worlds sleep: desaturated, dimmed, slower. */
  dormant: boolean;
  hovered: boolean;
  focused: boolean;
}

export function PlanetSurface({
  entityId,
  biome,
  radius = 0.6,
  segments = 96,
  paused,
  dormant,
  hovered,
  focused,
}: PlanetSurfaceProps) {
  const resolvedBiome =
    biome ?? PRODUCT_BIOMES[entityId] ?? biomeForEntity(entityId);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const atmosphereRef = useRef<THREE.ShaderMaterial>(null);
  const spinRef = useRef<THREE.Group>(null);

  const style = useMemo(
    () => biomeStyleFor(entityId, resolvedBiome),
    [entityId, resolvedBiome],
  );

  const geometry = useMemo(
    () =>
      createBiomePlanetGeometry(
        hashString(entityId),
        resolvedBiome,
        radius,
        segments,
      ),
    [entityId, resolvedBiome, radius, segments],
  );
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const uniforms = useMemo(
    () => ({
      uBase: { value: new THREE.Color(style.base) },
      uDeep: { value: new THREE.Color(style.deep) },
      uVein: { value: new THREE.Color(style.vein) },
      uAccent: { value: new THREE.Color(style.accent) },
      uRimColor: { value: new THREE.Color(style.rim) },
      uBandFreq: { value: style.bandFreq },
      uBandWeight: { value: style.bandWeight },
      uCrackWeight: { value: style.crackWeight },
      uCraterWeight: { value: style.craterWeight },
      uGlowWeight: { value: style.glowWeight },
      uHeightWeight: { value: style.heightWeight },
      uSpecStrength: { value: style.specStrength },
      uBump: { value: style.bump },
      uNoiseFreq: { value: style.noiseFreq },
      uWarp: { value: style.warp },
      uAccentWeight: { value: style.accentWeight },
      uRimStrength: { value: 0.5 },
      uFlow: { value: style.flow },
      uTime: { value: 0 },
      uDesat: { value: dormant ? 0.5 : 0 },
      uDim: { value: dormant ? 0.28 : 0 },
    }),
    // Style is deterministic per entity; recreate only when the world changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entityId, resolvedBiome],
  );

  const atmosphereUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(style.atmosphere) },
      uIntensity: { value: dormant ? 0.35 : 0.7 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entityId, resolvedBiome],
  );

  const cloudUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCoverage: { value: style.clouds },
      uCloudColor: { value: new THREE.Color(style.atmosphere) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entityId, resolvedBiome],
  );
  const cloudRef = useRef<THREE.ShaderMaterial>(null);

  useFrame((_, delta) => {
    if (!materialRef.current) return;
    const u = materialRef.current.uniforms;
    if (!paused) {
      u.uTime.value += delta;
      if (spinRef.current) {
        spinRef.current.rotation.y += delta * (dormant ? 0.05 : 0.1);
      }
      if (cloudRef.current) {
        cloudRef.current.uniforms.uTime.value += delta;
      }
    }
    // Hovering a sleeping world stirs it; focusing wakes it further.
    const desatTarget = dormant ? (focused ? 0.22 : hovered ? 0.35 : 0.5) : 0;
    const dimTarget = dormant ? (focused ? 0.08 : hovered ? 0.16 : 0.28) : 0;
    const rimTarget = focused ? 1.05 : hovered ? 0.9 : 0.65;
    u.uDesat.value = THREE.MathUtils.damp(u.uDesat.value, desatTarget, 4, delta);
    u.uDim.value = THREE.MathUtils.damp(u.uDim.value, dimTarget, 4, delta);
    u.uRimStrength.value = THREE.MathUtils.damp(
      u.uRimStrength.value,
      rimTarget,
      4,
      delta,
    );
    if (atmosphereRef.current) {
      const intensity = atmosphereRef.current.uniforms.uIntensity;
      intensity.value = THREE.MathUtils.damp(
        intensity.value,
        dormant ? (hovered || focused ? 0.55 : 0.35) : 0.75,
        4,
        delta,
      );
    }
  });

  // Seeded axial tilt + starting rotation: no two worlds hang alike.
  const tilt = useMemo(() => {
    const random = mulberry32(hashString(entityId) ^ 0x711f);
    return {
      x: (random() - 0.5) * 0.5,
      z: (random() - 0.5) * 0.5,
      y0: random() * Math.PI * 2,
    };
  }, [entityId]);

  return (
    <group rotation={[tilt.x, tilt.y0, tilt.z]}>
      <group ref={spinRef}>
        <mesh geometry={geometry}>
          <shaderMaterial
            ref={materialRef}
            vertexShader={planetVertexShader}
            fragmentShader={planetFragmentShader}
            uniforms={uniforms}
          />
        </mesh>
      </group>
      {/* drifting cloud shell (gas, ocean, lush, ice worlds) */}
      {style.clouds > 0 ? (
        <mesh scale={1.045}>
          <sphereGeometry args={[radius, 56, 56]} />
          <shaderMaterial
            ref={cloudRef}
            vertexShader={cloudVertexShader}
            fragmentShader={cloudFragmentShader}
            uniforms={cloudUniforms}
            transparent
            depthWrite={false}
          />
        </mesh>
      ) : null}
      {/* thin atmosphere shell */}
      <mesh scale={1.12}>
        <sphereGeometry args={[radius, 48, 48]} />
        <shaderMaterial
          ref={atmosphereRef}
          vertexShader={atmosphereVertexShader}
          fragmentShader={atmosphereFragmentShader}
          uniforms={atmosphereUniforms}
          side={THREE.BackSide}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

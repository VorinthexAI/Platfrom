import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import {
  CHAMBER_POSITION,
  CHAMBER_STYLES,
  type ChamberStyleKey,
} from "@/components/galaxy/chamber-config";
import { getDotTexture } from "@/components/three/dot-texture";
import { SIMPLEX_NOISE_GLSL } from "@/lib/three/glsl";
import { mulberry32 } from "@/lib/three/procedural";

const CHAMBER_RADIUS = 7;

const rockVertexShader = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    vLocal = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

/**
 * Procedural cavern rock: mineral blotches, dark fracture seams, and a
 * pulsing emissive vein network — the GLSL stand-in for the web chamber's
 * canvas-painted rock/bump/emissive maps (no DOM canvas on native).
 */
const rockFragmentShader = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uHigh;
  uniform vec3 uCrack;
  uniform vec3 uEmissive;
  uniform vec3 uLightPos;
  uniform float uTime;
  varying vec3 vLocal;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  ${SIMPLEX_NOISE_GLSL}

  void main() {
    vec3 q = normalize(vLocal);
    float blotch = fbm(q * 3.2 + vec3(4.7));
    float seams = smoothstep(0.62, 0.95, 1.0 - abs(snoise(q * 5.1 + vec3(blotch))));
    float speckle = 0.5 + 0.5 * snoise(q * 22.0);

    vec3 rock = mix(uBase, uHigh, clamp(0.5 + 0.5 * blotch, 0.0, 1.0));
    rock = mix(rock, uCrack, seams * 0.75);
    rock *= 0.92 + speckle * 0.16;

    // Lit from the chamber heart; abs() keeps the BackSide shell readable.
    vec3 L = normalize(uLightPos - vWorldPos);
    float lambert = 0.3 + 0.8 * abs(dot(normalize(vWorldNormal), L));

    float pulse = 0.4 + 0.3 * sin(uTime * 1.3 + vLocal.y * 1.4);
    vec3 veins = uEmissive * seams * pulse;

    gl_FragColor = vec4(rock * lambert + veins, 1.0);
  }
`;

const crystalVertexShader = /* glsl */ `
  varying vec3 vViewNormal;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Unlit crystal: faceted top-light shading plus a pulsing emissive rim —
 * no scene lights, no PBR pipeline, the cheapest possible GL surface.
 */
const crystalFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uEmissive;
  uniform float uStrength;
  uniform float uTime;
  varying vec3 vViewNormal;
  varying vec3 vLocal;
  void main() {
    vec3 N = normalize(vViewNormal);
    float topLight = 0.5 + 0.5 * N.y;
    float facing = abs(N.z);
    float rim = pow(1.0 - facing, 1.6);
    float pulse = 0.75 + 0.25 * sin(uTime * 1.2 + vLocal.y * 3.0);
    vec3 color = uColor * (0.35 + 0.65 * topLight)
      + uEmissive * uStrength * pulse * (0.35 + 0.65 * rim);
    gl_FragColor = vec4(color, 1.0);
  }
`;

type CrystalSeed = {
  position: [number, number, number];
  scale: number;
  rotation: [number, number, number];
};

function buildCrystals(seed: number): CrystalSeed[] {
  const random = mulberry32(seed);
  const crystals: CrystalSeed[] = [];
  for (let i = 0; i < 9; i += 1) {
    const angle = random() * Math.PI * 2;
    const distance = 1.2 + random() * 3.6;
    crystals.push({
      position: [
        Math.cos(angle) * distance,
        -CHAMBER_RADIUS * 0.28 + random() * 0.3,
        Math.sin(angle) * distance,
      ],
      scale: 0.35 + random() * 0.85,
      rotation: [random() * 0.5 - 0.25, random() * Math.PI * 2, random() * 0.5 - 0.25],
    });
  }
  return crystals;
}

function buildMotes(seed: number, count: number): Float32Array {
  const random = mulberry32(seed ^ 0x51ce);
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    const distance = random() * 4.2;
    data[i * 3] = Math.cos(angle) * distance;
    data[i * 3 + 1] = -1.4 + random() * 3.6;
    data[i * 3 + 2] = Math.sin(angle) * distance;
  }
  return data;
}

type BiomeChamberProps = {
  styleKey: ChamberStyleKey;
  seed: number;
};

/**
 * Simplified port of the web BiomeChamber: seeded cavern shell, a glowing
 * central crystal heart with seeded satellite crystals, drifting style
 * particles (embers rise, snow falls, spores orbit), and warm point light.
 * Lives far below the galaxy in the same scene; the camera teleports in
 * under the TransitionVeil.
 */
export function BiomeChamber({ styleKey, seed }: BiomeChamberProps) {
  const style = CHAMBER_STYLES[styleKey];
  const rockRef = useRef<THREE.ShaderMaterial>(null);
  const motesRef = useRef<THREE.Points>(null);
  const heartRef = useRef<THREE.Mesh>(null);

  const rockUniforms = useMemo(
    () => ({
      uBase: { value: new THREE.Color(style.rockBase) },
      uHigh: { value: new THREE.Color(style.rockHigh) },
      uCrack: { value: new THREE.Color(style.rockCrack) },
      uEmissive: { value: new THREE.Color(style.emissive) },
      uLightPos: {
        value: CHAMBER_POSITION.clone().add(new THREE.Vector3(0, 2.4, 0)),
      },
      uTime: { value: 0 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [styleKey],
  );

  const crystals = useMemo(() => buildCrystals(seed), [seed]);
  const motes = useMemo(
    () => buildMotes(seed, style.moteCount),
    [seed, style.moteCount],
  );

  const heartUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(style.crystal) },
      uEmissive: { value: new THREE.Color(style.emissive) },
      uStrength: { value: 0.85 },
      uTime: { value: 0 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [styleKey],
  );

  // One shared uniforms object drives every satellite crystal.
  const satelliteUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(style.crystal) },
      uEmissive: { value: new THREE.Color(style.emissive) },
      uStrength: { value: 0.5 },
      uTime: { value: 0 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [styleKey],
  );

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (rockRef.current) {
      const time = rockRef.current.uniforms.uTime;
      if (time) time.value = t;
    }
    if (heartUniforms.uTime) heartUniforms.uTime.value = t;
    if (satelliteUniforms.uTime) satelliteUniforms.uTime.value = t;
    if (heartRef.current) {
      heartRef.current.rotation.y += delta * 0.35;
      const breathe = 1 + Math.sin(t * 1.1) * 0.04;
      heartRef.current.scale.setScalar(breathe);
    }
    if (motesRef.current) {
      if (style.feature === "orbit") {
        motesRef.current.rotation.y += delta * 0.16;
      } else {
        const drift = style.feature === "rise" ? 0.18 : -0.14;
        motesRef.current.position.y =
          ((motesRef.current.position.y + drift * delta + 1.8) % 3.6) - 1.8;
      }
    }
  });

  return (
    // Position passed as a plain array: fiber applies arrays with
    // fromArray and never needs an instanceof check on our Vector3.
    <group
      position={[CHAMBER_POSITION.x, CHAMBER_POSITION.y, CHAMBER_POSITION.z]}
    >
      {/* cavern shell */}
      <mesh>
        <sphereGeometry args={[CHAMBER_RADIUS, 48, 48]} />
        <shaderMaterial
          ref={rockRef}
          vertexShader={rockVertexShader}
          fragmentShader={rockFragmentShader}
          uniforms={rockUniforms}
          side={THREE.BackSide}
        />
      </mesh>

      {/* glowing crystal heart — the emblem-free centerpiece */}
      <mesh ref={heartRef} position={[0, 0.3, 0]}>
        <octahedronGeometry args={[0.52, 0]} />
        <shaderMaterial
          vertexShader={crystalVertexShader}
          fragmentShader={crystalFragmentShader}
          uniforms={heartUniforms}
        />
      </mesh>
      <sprite position={[0, 0.3, 0]} scale={2.6}>
        <spriteMaterial
          map={getDotTexture()}
          color={style.glow}
          transparent
          opacity={0.2}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>

      {/* seeded satellite crystals on the chamber floor */}
      {crystals.map((crystal, index) => (
        <mesh
          key={index}
          position={crystal.position}
          rotation={crystal.rotation}
          scale={crystal.scale}
        >
          <octahedronGeometry args={[0.5, 0]} />
          <shaderMaterial
            vertexShader={crystalVertexShader}
            fragmentShader={crystalFragmentShader}
            uniforms={satelliteUniforms}
          />
        </mesh>
      ))}

      {/* drifting style particles */}
      <points ref={motesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[motes, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={style.moteColor}
          size={0.075}
          sizeAttenuation
          map={getDotTexture()}
          transparent
          opacity={0.75}
          depthWrite={false}
        />
      </points>
    </group>
  );
}

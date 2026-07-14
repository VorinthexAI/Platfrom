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
    float seams = smoothstep(0.55, 0.93, 1.0 - abs(snoise(q * 5.1 + vec3(blotch))));
    // A second, finer filament layer that slowly crawls — the electric
    // wisp look of the web chamber's painted vein maps.
    float filaments = smoothstep(0.72, 0.97, 1.0 - abs(snoise(q * 9.4 + vec3(uTime * 0.05))));
    float speckle = 0.5 + 0.5 * snoise(q * 22.0);

    vec3 rock = mix(uBase, uHigh, clamp(0.5 + 0.5 * blotch, 0.0, 1.0));
    rock = mix(rock, uCrack, seams * 0.75);
    rock *= 0.92 + speckle * 0.16;

    // Lit from the chamber heart; abs() keeps the BackSide shell readable.
    vec3 L = normalize(uLightPos - vWorldPos);
    float lambert = 0.3 + 0.8 * abs(dot(normalize(vWorldNormal), L));

    float pulse = 0.55 + 0.35 * sin(uTime * 1.3 + vLocal.y * 1.4);
    float flicker = 0.6 + 0.4 * sin(uTime * 2.1 + vLocal.x * 2.2);
    vec3 veins = uEmissive * (seams * pulse * 1.35 + filaments * flicker * 0.9);

    gl_FragColor = vec4(rock * lambert + veins, 1.0);
  }
`;

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
 * Simplified port of the web BiomeChamber: seeded cavern shell with
 * pulsing electric vein filaments, a soft glowing heart of light, and
 * drifting style particles (embers rise, snow falls, spores orbit). No
 * crystal geometry — the interior belongs to the nebula walls and the
 * screen-space emblem. Lives far below the galaxy in the same scene; the
 * camera teleports in under the TransitionVeil.
 */
export function BiomeChamber({ styleKey, seed }: BiomeChamberProps) {
  const style = CHAMBER_STYLES[styleKey];
  const rockRef = useRef<THREE.ShaderMaterial>(null);
  const motesRef = useRef<THREE.Points>(null);

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

  const motes = useMemo(
    () => buildMotes(seed, style.moteCount),
    [seed, style.moteCount],
  );

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (rockRef.current) {
      const time = rockRef.current.uniforms.uTime;
      if (time) time.value = t;
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

      {/* soft glowing heart of light behind the screen-space emblem */}
      <sprite position={[0, 0.3, 0]} scale={3.1}>
        <spriteMaterial
          map={getDotTexture()}
          color={style.glow}
          transparent
          opacity={0.26}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>

      {/* drifting style particles */}
      <points ref={motesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[motes, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={style.moteColor}
          size={0.095}
          sizeAttenuation
          map={getDotTexture()}
          transparent
          opacity={0.85}
          depthWrite={false}
        />
      </points>
    </group>
  );
}

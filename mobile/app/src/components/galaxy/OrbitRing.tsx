import { useMemo, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const SEGMENTS = 160;

const ringVertexShader = /* glsl */ `
  attribute float aAngle;
  varying float vAngle;
  void main() {
    vAngle = aAngle;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ringFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uPlanetAngle;
  uniform float uGapHalfWidth;
  varying float vAngle;
  void main() {
    // Wrapped angular distance to the planet's live position on the ring.
    float diff = vAngle - uPlanetAngle;
    float distance = abs(atan(sin(diff), cos(diff)));
    // The line dissolves before it reaches the planet — the gas worlds
    // don't write depth, so without this gap the path would slice
    // straight through its own translucent planet.
    float fade = smoothstep(uGapHalfWidth * 0.5, uGapHalfWidth, distance);
    gl_FragColor = vec4(uColor, uOpacity * fade);
  }
`;

type OrbitRingProps = {
  radius: number;
  /** Live orbit angle of the planet riding this ring (radians). */
  planetAngleRef: MutableRefObject<number>;
  /** Half-width (radians) of the dissolve gap around the planet. */
  gapHalfWidth: number;
  opacity?: number;
};

/**
 * Thin chrome orbit path with a soft gap that tracks its planet, so the
 * line frames the orbit without ever crossing the translucent world.
 */
export function OrbitRing({
  radius,
  planetAngleRef,
  gapHalfWidth,
  opacity = 0.14,
}: OrbitRingProps) {
  const line = useMemo(() => {
    const positions = new Float32Array((SEGMENTS + 1) * 3);
    const angles = new Float32Array(SEGMENTS + 1);
    for (let i = 0; i <= SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      angles[i] = angle;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aAngle", new THREE.BufferAttribute(angles, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: ringVertexShader,
      fragmentShader: ringFragmentShader,
      uniforms: {
        uColor: { value: new THREE.Color("#aeb6bc") },
        uOpacity: { value: opacity },
        uPlanetAngle: { value: 0 },
        uGapHalfWidth: { value: gapHalfWidth },
      },
      transparent: true,
      depthWrite: false,
    });
    return new THREE.Line(geometry, material);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

  useFrame(() => {
    const material = line.material as THREE.ShaderMaterial;
    material.uniforms.uPlanetAngle!.value = planetAngleRef.current;
  });

  return <primitive object={line} />;
}

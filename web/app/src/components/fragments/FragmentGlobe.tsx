"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getDotTexture } from "@/lib/three/dot-texture";

/**
 * The explorer's neural map: every collected Intelligence Fragment is a
 * node on a slowly spinning globe, nearest nodes linked by faint arcs —
 * the same visual language as Core's brain. Data comes from the platform
 * backend's canonical node→three formatter (via /api/fragments/globe).
 */

export interface GlobeData {
  points: Array<[number, number, number]>;
  colors: Array<[number, number, number]>;
}

function GlobeContents({ data }: { data: GlobeData }) {
  const groupRef = useRef<THREE.Group>(null);

  const { pointsGeometry, arcsGeometry } = useMemo(() => {
    const vectors = data.points.map((p) => new THREE.Vector3(...p));
    const positions = new Float32Array(data.points.flat());
    const colors = new Float32Array(
      data.colors.length === data.points.length
        ? data.colors.flat()
        : data.points.flatMap(() => [0.7, 0.75, 0.78]),
    );
    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    pointsGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // Connect each node to its two nearest neighbours with gentle bows.
    const arcPoints: THREE.Vector3[] = [];
    for (let i = 0; i < vectors.length; i++) {
      const nearest = vectors
        .map((other, j) => ({ j, d: vectors[i].distanceTo(other) }))
        .filter(({ j }) => j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      for (const { j } of nearest) {
        if (j < i) continue;
        const mid = vectors[i]
          .clone()
          .add(vectors[j])
          .multiplyScalar(0.5)
          .normalize()
          .multiplyScalar(1.12);
        const curve = new THREE.QuadraticBezierCurve3(vectors[i], mid, vectors[j]);
        const samples = curve.getPoints(9);
        for (let s = 0; s < samples.length - 1; s++) {
          arcPoints.push(samples[s], samples[s + 1]);
        }
      }
    }
    const arcsGeometry = new THREE.BufferGeometry().setFromPoints(arcPoints);
    return { pointsGeometry, arcsGeometry };
  }, [data]);

  useEffect(() => {
    return () => {
      pointsGeometry.dispose();
      arcsGeometry.dispose();
    };
  }, [pointsGeometry, arcsGeometry]);

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.28;
  });

  return (
    <group ref={groupRef}>
      {/* faint containment sphere */}
      <mesh>
        <sphereGeometry args={[1.18, 20, 14]} />
        <meshBasicMaterial color="#3c434a" wireframe transparent opacity={0.16} />
      </mesh>
      <points geometry={pointsGeometry}>
        <pointsMaterial
          vertexColors
          size={0.09}
          sizeAttenuation
          map={getDotTexture()}
          transparent
          opacity={0.95}
          depthWrite={false}
        />
      </points>
      <lineSegments geometry={arcsGeometry}>
        <lineBasicMaterial color="#aeb6bc" transparent opacity={0.3} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

const subscribeNoop = () => () => {};

export function FragmentGlobe({ data }: { data: GlobeData }) {
  // Client-only canvas: render a spacer during SSR/hydration.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  if (!mounted) return <div className="h-56 w-56" aria-hidden />;

  return (
    <div className="h-56 w-56" aria-hidden>
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 0.6, 3.1], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.6} />
        <GlobeContents data={data} />
      </Canvas>
    </div>
  );
}

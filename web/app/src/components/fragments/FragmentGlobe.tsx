"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  createCrystalGeometry,
  createEdgyCrystalPieces,
  crystalTintForValue,
  CRYSTAL_VARIANTS,
  EDGY_CRYSTAL_GENERATOR,
} from "@/lib/three/crystal";
import { getDotTexture } from "@/lib/three/dot-texture";

/**
 * The explorer's neural map: every collected Intelligence Fragment is a
 * node on a slowly spinning globe — a jar of everything scavenged from
 * the galaxy. Fragments collected with a mesh recipe render as their
 * EXACT original crystal (regenerated deterministically from the stored
 * generator + seed); legacy entries stay luminous points. Data comes from
 * the platform backend's canonical node→three formatter.
 */

export interface GlobeMeshRecipe {
  generator?: string;
  seed?: number;
  variant?: number;
  scale?: number;
  params?: Record<string, number | string>;
}

export interface GlobeData {
  points: Array<[number, number, number]>;
  colors: Array<[number, number, number]>;
  meta?: Array<{ key: string; label: string | null; mesh?: GlobeMeshRecipe | null }>;
}

/** One collected piece rendered from its persisted mesh recipe. */
function CollectedMesh({
  recipe,
  position,
}: {
  recipe: GlobeMeshRecipe;
  position: [number, number, number];
}) {
  const value =
    typeof recipe.params?.value === "number" ? recipe.params.value : 0;
  const tint = crystalTintForValue(value);
  // Jar scale: fragments stay small; big crystals read bigger, capped so
  // even a 10k room-filler still fits inside the jar.
  const scale = Math.min(0.09 + Math.log10(Math.max(value, 1) + 1) * 0.035, 0.26);

  const pieces = useMemo(() => {
    if (recipe.generator === EDGY_CRYSTAL_GENERATOR) {
      return createEdgyCrystalPieces(recipe.seed ?? 0);
    }
    return null;
  }, [recipe.generator, recipe.seed]);
  const geometry = useMemo(() => {
    if (pieces) return null;
    const variant =
      (recipe.variant ?? recipe.seed ?? 0) % CRYSTAL_VARIANTS;
    return createCrystalGeometry(((variant % CRYSTAL_VARIANTS) + CRYSTAL_VARIANTS) % CRYSTAL_VARIANTS);
  }, [pieces, recipe.variant, recipe.seed]);

  useEffect(
    () => () => {
      geometry?.dispose();
      if (pieces) for (const piece of pieces) piece.geometry.dispose();
    },
    [geometry, pieces],
  );

  return (
    <group position={position} scale={scale}>
      {pieces
        ? pieces.map((piece, index) => (
            <mesh
              key={index}
              geometry={piece.geometry}
              position={piece.position}
              rotation={piece.rotation}
            >
              <meshStandardMaterial
                color={tint.color}
                metalness={0.35}
                roughness={0.15}
                emissive={tint.emissive}
                emissiveIntensity={1}
                flatShading
              />
            </mesh>
          ))
        : geometry
          ? (
            <mesh geometry={geometry}>
              <meshStandardMaterial
                color={tint.color}
                metalness={0.25}
                roughness={0.15}
                emissive={tint.emissive}
                emissiveIntensity={0.9}
              />
            </mesh>
          )
          : null}
    </group>
  );
}

function GlobeContents({ data }: { data: GlobeData }) {
  const groupRef = useRef<THREE.Group>(null);

  const { pointsGeometry, arcsGeometry, meshed } = useMemo(() => {
    const vectors = data.points.map((p) => new THREE.Vector3(...p));

    // Entries with a persisted mesh recipe render as real geometry; the
    // rest stay points.
    const meshed: Array<{
      key: string;
      recipe: GlobeMeshRecipe;
      position: [number, number, number];
    }> = [];
    const pointIndexes: number[] = [];
    data.points.forEach((_, index) => {
      const recipe = data.meta?.[index]?.mesh;
      if (recipe && typeof recipe.generator === "string") {
        meshed.push({
          key: data.meta?.[index]?.key ?? `m${index}`,
          recipe,
          position: data.points[index]!,
        });
      } else {
        pointIndexes.push(index);
      }
    });

    const positions = new Float32Array(
      pointIndexes.flatMap((index) => data.points[index]!),
    );
    const colors = new Float32Array(
      pointIndexes.flatMap((index) =>
        data.colors.length === data.points.length
          ? data.colors[index]!
          : [0.7, 0.75, 0.78],
      ),
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
    return { pointsGeometry, arcsGeometry, meshed };
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
      {/* the jar: twin wireframe shells fatten the lines ~20%, drawn in a
          lighter silver so the container actually reads */}
      <mesh>
        <sphereGeometry args={[1.18, 20, 14]} />
        <meshBasicMaterial color="#5b646d" wireframe transparent opacity={0.3} />
      </mesh>
      <mesh scale={1.012}>
        <sphereGeometry args={[1.18, 20, 14]} />
        <meshBasicMaterial color="#5b646d" wireframe transparent opacity={0.22} />
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
      {meshed.map((entry) => (
        <CollectedMesh
          key={entry.key}
          recipe={entry.recipe}
          position={entry.position}
        />
      ))}
      <lineSegments geometry={arcsGeometry}>
        <lineBasicMaterial color="#c4cbd1" transparent opacity={0.38} depthWrite={false} />
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
        <pointLight position={[2, 2, 2]} intensity={8} decay={2} />
        <GlobeContents data={data} />
      </Canvas>
    </div>
  );
}

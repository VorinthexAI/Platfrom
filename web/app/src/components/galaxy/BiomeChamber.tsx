"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  CHAMBER_STYLES,
  createChamberFloorGeometry,
  createChamberWallGeometry,
  getCrackTexture,
  getRockTextures,
  type ChamberStyleKey,
} from "@/lib/three/chamber";
import { createAsteroidGeometry } from "@/lib/three/asteroid";
import { createCrystalGeometry, CRYSTAL_VARIANTS } from "@/lib/three/crystal";
import { getDotTexture } from "@/lib/three/dot-texture";
import { mulberry32 } from "@/lib/three/procedural";

/**
 * A seeded interior world. Same style + different seed = a different
 * cavern every visit (Minecraft-style world gen): the wall bulges, floor
 * relief, crystal growth, rubble, spikes, and every organism's home roll
 * fresh from the seed. The rock is unmistakably solid — painted mineral
 * texture with bump relief, a real floor rising to meet the walls, and a
 * hazy interior atmosphere.
 */

export const CHAMBER_RADIUS = 5.6;
const FLOOR_Y = -CHAMBER_RADIUS * 0.52;

/** Random point on the interior wall, filtered by vertical band. */
function wallPoint(
  random: () => number,
  minY: number,
  maxY: number,
): THREE.Vector3 {
  for (let attempt = 0; attempt < 40; attempt++) {
    const y = random() * 2 - 1;
    if (y < minY || y > maxY) continue;
    const angle = random() * Math.PI * 2;
    const h = Math.sqrt(Math.max(0, 1 - y * y));
    return new THREE.Vector3(
      Math.cos(angle) * h,
      y,
      Math.sin(angle) * h,
    ).multiplyScalar(CHAMBER_RADIUS * (0.94 + random() * 0.05));
  }
  return new THREE.Vector3(0, minY * CHAMBER_RADIUS, 0);
}

/** Random spot on the cavern floor disc. */
function floorPoint(random: () => number): THREE.Vector3 {
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random()) * CHAMBER_RADIUS * 0.68;
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    FLOOR_Y + 0.12,
    Math.sin(angle) * radius,
  );
}

/* ------------------------------------------------------------------ */
/* Solid rock: textured walls + floor + spikes + rubble                */
/* ------------------------------------------------------------------ */

function ChamberRock({
  styleKey,
  seed,
}: {
  styleKey: ChamberStyleKey;
  seed: number;
}) {
  const style = CHAMBER_STYLES[styleKey];
  const textures = getRockTextures(styleKey);
  const spikesRef = useRef<THREE.InstancedMesh>(null);
  const rubbleRef = useRef<THREE.InstancedMesh>(null);

  const wallGeometry = useMemo(() => createChamberWallGeometry(seed), [seed]);
  const floorGeometry = useMemo(
    () => createChamberFloorGeometry(seed ^ 0xf100, CHAMBER_RADIUS * 0.92),
    [seed],
  );
  const rubbleGeometry = useMemo(
    () => createAsteroidGeometry(seed ^ 0xdeb, { detail: 1, craters: 1 }),
    [seed],
  );

  // Dense geology, one draw call each: stalactites and stalagmites share
  // a single instanced cone, rubble a single instanced rock — a hundred
  // pieces of stone now cost less than the old dozen separate meshes
  // (and entry no longer hitches compiling dozens of materials).
  const spikes = useMemo(() => {
    const random = mulberry32(seed ^ 0x57a1);
    const up = new THREE.Vector3(0, 1, 0);
    const list: Array<{
      position: THREE.Vector3;
      quaternion: THREE.Quaternion;
      length: number;
      radius: number;
    }> = [];
    // World gen: every seed rolls its own geology.
    const ceilingCount = 34 + Math.floor(random() * 42);
    const floorCount = 18 + Math.floor(random() * 26);
    for (let i = 0; i < ceilingCount; i++) {
      const anchor = wallPoint(random, 0.35, 0.95);
      const inward = anchor.clone().normalize().negate();
      list.push({
        position: anchor,
        quaternion: new THREE.Quaternion().setFromUnitVectors(up, inward),
        length: 0.5 + random() * 2.1,
        radius: 0.07 + random() * 0.2,
      });
    }
    for (let i = 0; i < floorCount; i++) {
      const anchor = floorPoint(random);
      list.push({
        position: anchor,
        quaternion: new THREE.Quaternion(),
        length: 0.4 + random() * 1.5,
        radius: 0.09 + random() * 0.22,
      });
    }
    return list;
  }, [seed]);

  const rubble = useMemo(() => {
    const random = mulberry32(seed ^ 0x2bb1e);
    const count = 44 + Math.floor(random() * 58);
    return Array.from({ length: count }, (_, i) => ({
      position: floorPoint(random),
      rotation: new THREE.Euler(
        random() * Math.PI * 2,
        random() * Math.PI * 2,
        random() * Math.PI * 2,
      ),
      // A few hero boulders rise above the gravel.
      scale: i < 7 ? 0.5 + random() * 0.7 : 0.1 + random() * 0.38,
    }));
  }, [seed]);

  // Stalagnate pillars: columns where dripstone met, floor to dome. The
  // camera parks on +z looking at the heart — never stand a pillar in
  // that corridor or it fills the whole view as a dark slab.
  const pillars = useMemo(() => {
    const random = mulberry32(seed ^ 0x9111);
    const count = 2 + Math.floor(random() * 3);
    const list: Array<{
      x: number;
      z: number;
      lean: number;
      leanZ: number;
      topRadius: number;
      bottomRadius: number;
    }> = [];
    for (let i = 0; i < count; i++) {
      let x = 0;
      let z = 0;
      for (let attempt = 0; attempt < 24; attempt++) {
        const angle = random() * Math.PI * 2;
        const radius = 2.2 + random() * 1.6;
        x = Math.cos(angle) * radius;
        z = Math.sin(angle) * radius;
        // Reject spots inside the camera's viewing corridor.
        if (z < 1.1 || Math.abs(x) > 2.6) break;
      }
      list.push({
        x,
        z,
        lean: (random() - 0.5) * 0.16,
        leanZ: (random() - 0.5) * 0.16,
        topRadius: 0.14 + random() * 0.16,
        bottomRadius: 0.3 + random() * 0.24,
      });
    }
    return list;
  }, [seed]);

  useEffect(() => {
    const mesh = spikesRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    spikes.forEach((spike, index) => {
      scale.set(spike.radius, spike.length, spike.radius);
      matrix.compose(spike.position, spike.quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.count = spikes.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [spikes]);

  useEffect(() => {
    const mesh = rubbleRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    rubble.forEach((rock, index) => {
      quaternion.setFromEuler(rock.rotation);
      scale.setScalar(rock.scale);
      matrix.compose(rock.position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.count = rubble.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [rubble]);

  useEffect(() => {
    return () => {
      wallGeometry.dispose();
      floorGeometry.dispose();
      rubbleGeometry.dispose();
    };
  }, [wallGeometry, floorGeometry, rubbleGeometry]);

  return (
    <group>
      {/* the cavern shell — painted rock, lit from inside */}
      <mesh geometry={wallGeometry} scale={CHAMBER_RADIUS * 1.12}>
        <meshStandardMaterial
          map={textures.map}
          bumpMap={textures.bumpMap}
          bumpScale={2.6}
          emissiveMap={textures.emissiveMap}
          emissive="#ffffff"
          emissiveIntensity={0.55}
          color="#d8dde1"
          metalness={0.12}
          roughness={0.95}
          side={THREE.BackSide}
        />
      </mesh>

      {/* the ground beneath your feet */}
      <mesh
        geometry={floorGeometry}
        position={[0, FLOOR_Y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <meshStandardMaterial
          map={textures.map}
          bumpMap={textures.bumpMap}
          bumpScale={3}
          emissiveMap={textures.emissiveMap}
          emissive="#ffffff"
          emissiveIntensity={0.35}
          color="#d8dde1"
          metalness={0.15}
          roughness={0.9}
        />
      </mesh>

      <instancedMesh
        ref={spikesRef}
        args={[undefined, undefined, 124]}
        frustumCulled={false}
      >
        <coneGeometry args={[1, 1, 7]} />
        <meshStandardMaterial
          map={textures.map}
          bumpMap={textures.bumpMap}
          bumpScale={1.8}
          color="#c8ced3"
          metalness={0.2}
          roughness={0.85}
        />
      </instancedMesh>

      <instancedMesh
        ref={rubbleRef}
        args={[undefined, undefined, 110]}
        geometry={rubbleGeometry}
        frustumCulled={false}
      >
        <meshStandardMaterial
          vertexColors
          color={style.wallTint}
          metalness={0.25}
          roughness={0.85}
        />
      </instancedMesh>

      {pillars.map((pillar, index) => (
        <mesh
          key={`pillar-${index}`}
          position={[pillar.x, FLOOR_Y + 4.1, pillar.z]}
          rotation={[pillar.leanZ, 0, pillar.lean]}
        >
          <cylinderGeometry
            args={[pillar.topRadius, pillar.bottomRadius, 8.6, 9]}
          />
          <meshStandardMaterial
            map={textures.map}
            bumpMap={textures.bumpMap}
            bumpScale={2}
            emissiveMap={textures.emissiveMap}
            emissive="#ffffff"
            emissiveIntensity={0.4}
            color="#c8ced3"
            metalness={0.18}
            roughness={0.9}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Crystal growth                                                      */
/* ------------------------------------------------------------------ */

function CrystalGrowth({
  styleKey,
  seed,
}: {
  styleKey: ChamberStyleKey;
  seed: number;
}) {
  const style = CHAMBER_STYLES[styleKey];

  const clusters = useMemo(() => {
    const random = mulberry32(seed ^ 0xc157e);
    const up = new THREE.Vector3(0, 1, 0);
    const list: Array<{
      position: THREE.Vector3;
      quaternion: THREE.Quaternion;
      scale: number;
      variant: number;
    }> = [];
    // Wall clusters growing inward — abundance rolls with the seed.
    const wallCount = 8 + Math.floor(random() * 14);
    const floorCount = 6 + Math.floor(random() * 12);
    for (let i = 0; i < wallCount; i++) {
      const anchor = wallPoint(random, -0.35, 0.4);
      const inward = anchor.clone().normalize().negate();
      list.push({
        position: anchor.multiplyScalar(0.97),
        quaternion: new THREE.Quaternion().setFromUnitVectors(up, inward),
        scale: 0.6 + random() * 1.3,
        variant: Math.floor(random() * CRYSTAL_VARIANTS),
      });
    }
    // Floor clusters reaching up.
    for (let i = 0; i < floorCount; i++) {
      list.push({
        position: floorPoint(random),
        quaternion: new THREE.Quaternion(),
        scale: 0.5 + random() * 1.6,
        variant: Math.floor(random() * CRYSTAL_VARIANTS),
      });
    }
    return list;
  }, [seed]);

  const geometries = useMemo(
    () => clusters.map((cluster) => createCrystalGeometry(cluster.variant)),
    [clusters],
  );
  // One material for every crystal in the chamber: a single shader
  // compile instead of one per cluster.
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: style.crystal,
        metalness: 0.25,
        roughness: 0.15,
        emissive: style.emissive,
        emissiveIntensity: 0.9,
        transparent: true,
        opacity: 0.96,
      }),
    [style],
  );
  useEffect(() => {
    return () => {
      geometries.forEach((geometry) => geometry.dispose());
    };
  }, [geometries]);
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  return (
    <group>
      {clusters.map((cluster, index) => (
        <mesh
          key={index}
          geometry={geometries[index]}
          material={material}
          position={cluster.position}
          quaternion={cluster.quaternion}
          scale={cluster.scale}
        />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* The living layer                                                    */
/* ------------------------------------------------------------------ */

interface Organism {
  home: THREE.Vector3;
  range: number;
  phaseX: number;
  phaseY: number;
  phaseZ: number;
  freq: number;
}

/** Free-floating organisms wandering the chamber on organic paths. */
function OrganismSwarm({
  styleKey,
  seed,
}: {
  styleKey: ChamberStyleKey;
  seed: number;
}) {
  const style = CHAMBER_STYLES[styleKey];
  const swarmCount = Math.round(style.swarmCount * 1.8);
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const timeRef = useRef(0);
  // Populated lazily inside the frame loop (refs are not for render).
  const organismsRef = useRef<{ seed: number; list: Organism[] } | null>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(swarmCount * 3), 3),
    );
    return geo;
  }, [swarmCount]);
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useFrame((_, delta) => {
    const points = pointsRef.current;
    if (!points) return;
    if (organismsRef.current == null || organismsRef.current.seed !== seed) {
      const random = mulberry32(seed ^ 0x0e9a);
      organismsRef.current = {
        seed,
        list: Array.from({ length: swarmCount }, () => {
          const angle = random() * Math.PI * 2;
          const radius = random() * CHAMBER_RADIUS * 0.66;
          return {
            home: new THREE.Vector3(
              Math.cos(angle) * radius,
              FLOOR_Y + 0.6 + random() * CHAMBER_RADIUS * 0.95,
              Math.sin(angle) * radius,
            ),
            range: 0.3 + random() * 1.1,
            phaseX: random() * Math.PI * 2,
            phaseY: random() * Math.PI * 2,
            phaseZ: random() * Math.PI * 2,
            freq: 0.4 + random() * 0.9,
          };
        }),
      };
    }
    const organisms = organismsRef.current;
    timeRef.current += delta;
    const t = timeRef.current;
    const attr = points.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const span = CHAMBER_RADIUS * 0.95;
    for (let i = 0; i < organisms.list.length; i++) {
      const organism = organisms.list[i];
      // Lissajous wander around a home point plus the biome's drift:
      // embers rise, diamond dust settles, spores hang.
      const drift = style.swarmLift * t * organism.freq;
      const baseY = organism.home.y - (FLOOR_Y + 0.6);
      const wrappedY =
        FLOOR_Y + 0.6 + (((baseY + drift) % span) + span) % span;
      attr.setXYZ(
        i,
        organism.home.x +
          Math.sin(t * organism.freq * style.swarmSpeed + organism.phaseX) *
            organism.range,
        wrappedY +
          Math.sin(t * organism.freq * style.swarmSpeed * 0.8 + organism.phaseY) *
            organism.range *
            0.5,
        organism.home.z +
          Math.cos(t * organism.freq * style.swarmSpeed * 0.9 + organism.phaseZ) *
            organism.range,
      );
    }
    attr.needsUpdate = true;
    if (materialRef.current) {
      materialRef.current.opacity = 0.65 + Math.sin(t * 1.1) * 0.15;
    }
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        ref={materialRef}
        color={style.swarmColor}
        size={style.swarmSize}
        sizeAttenuation
        map={getDotTexture()}
        transparent
        opacity={0.7}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/** Floor growth: mushrooms, coral, magma vents, or spore pods. */
function FloorGrowth({
  styleKey,
  seed,
}: {
  styleKey: ChamberStyleKey;
  seed: number;
}) {
  const style = CHAMBER_STYLES[styleKey];
  const groupRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);

  const growths = useMemo(() => {
    const rand = mulberry32(seed ^ 0x920);
    // Life grows in patches: a few colonies, each a scatter of individuals.
    const patchCount = 5 + Math.floor(rand() * 5);
    const list: Array<{
      position: THREE.Vector3;
      scale: number;
      pulsePhase: number;
    }> = [];
    for (let patch = 0; patch < patchCount; patch++) {
      const center = floorPoint(rand);
      const members = 4 + Math.floor(rand() * 8);
      for (let m = 0; m < members; m++) {
        const offset = new THREE.Vector3(
          (rand() - 0.5) * 1.6,
          0,
          (rand() - 0.5) * 1.6,
        );
        list.push({
          position: center.clone().add(offset),
          scale: 0.08 + rand() * 0.3,
          pulsePhase: rand() * Math.PI * 2,
        });
      }
    }
    return list;
  }, [seed]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    timeRef.current += delta;
    const t = timeRef.current;
    group.children.forEach((child, index) => {
      const growth = growths[index];
      if (!growth || !(child instanceof THREE.Mesh)) return;
      const material = child.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity =
        0.8 + Math.sin(t * 1.4 + growth.pulsePhase) * 0.45;
    });
  });

  return (
    <group ref={groupRef}>
      {growths.map((growth, index) => (
        <mesh key={index} position={growth.position} scale={growth.scale}>
          {style.growthKind === "mushroom" ? (
            <coneGeometry args={[0.7, 0.9, 8]} />
          ) : style.growthKind === "coral" ? (
            <icosahedronGeometry args={[0.6, 0]} />
          ) : style.growthKind === "vent" ? (
            <cylinderGeometry args={[0.5, 0.8, 0.4, 8]} />
          ) : (
            <sphereGeometry args={[0.55, 10, 10]} />
          )}
          <meshStandardMaterial
            color={style.growthColor}
            metalness={0.2}
            roughness={0.5}
            emissive={style.growthEmissive}
            emissiveIntensity={0.8}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Pulsing wall colonies: glow worms / mites in short crawling chains. */
function WallColonies({
  styleKey,
  seed,
}: {
  styleKey: ChamberStyleKey;
  seed: number;
}) {
  const style = CHAMBER_STYLES[styleKey];
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const timeRef = useRef(0);

  const positions = useMemo(() => {
    const random = mulberry32(seed ^ 0xc010);
    const data: number[] = [];
    for (let colony = 0; colony < style.colonyCount; colony++) {
      const anchor = wallPoint(random, -0.3, 0.85).multiplyScalar(0.97);
      const tangent = new THREE.Vector3(
        random() - 0.5,
        random() - 0.5,
        random() - 0.5,
      )
        .normalize()
        .multiplyScalar(0.16);
      const beads = 5 + Math.floor(random() * 5);
      const cursor = anchor.clone();
      for (let b = 0; b < beads; b++) {
        data.push(cursor.x, cursor.y, cursor.z);
        cursor.add(tangent);
        cursor.setLength(CHAMBER_RADIUS * 0.97);
      }
    }
    return new Float32Array(data);
  }, [seed, style.colonyCount]);

  useFrame((_, delta) => {
    timeRef.current += delta;
    if (materialRef.current) {
      materialRef.current.opacity =
        0.45 + 0.35 * Math.sin(timeRef.current * 0.9 + seed);
    }
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={materialRef}
        color={style.colonyColor}
        size={0.06}
        sizeAttenuation
        map={getDotTexture()}
        transparent
        opacity={0.6}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/**
 * Each biome's signature particle feature: embers and bubbles RISE in
 * columns from the floor, snow and diamond dust FALL from the dome, and
 * spores ORBIT the chamber heart in slow rings.
 */
function FeatureParticles({
  styleKey,
  seed,
}: {
  styleKey: ChamberStyleKey;
  seed: number;
}) {
  const style = CHAMBER_STYLES[styleKey];
  const pointsRef = useRef<THREE.Points>(null);
  const timeRef = useRef(0);
  const particlesRef = useRef<{
    seed: number;
    homes: Float32Array;
    phases: Float32Array;
    speeds: Float32Array;
  } | null>(null);
  const COUNT = 260;

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3),
    );
    return geo;
  }, []);
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useFrame((_, delta) => {
    const points = pointsRef.current;
    if (!points) return;
    if (particlesRef.current == null || particlesRef.current.seed !== seed) {
      const random = mulberry32(seed ^ 0xfea7);
      const homes = new Float32Array(COUNT * 3);
      const phases = new Float32Array(COUNT);
      const speeds = new Float32Array(COUNT);
      for (let i = 0; i < COUNT; i++) {
        const angle = random() * Math.PI * 2;
        const radius =
          style.feature === "orbit"
            ? 1.4 + random() * 2.6
            : Math.sqrt(random()) * CHAMBER_RADIUS * 0.6;
        homes[i * 3] = Math.cos(angle) * radius;
        homes[i * 3 + 1] = (random() * 2 - 1) * CHAMBER_RADIUS * 0.55;
        homes[i * 3 + 2] = Math.sin(angle) * radius;
        phases[i] = random() * Math.PI * 2;
        speeds[i] = 0.4 + random() * 0.9;
      }
      particlesRef.current = { seed, homes, phases, speeds };
    }
    timeRef.current += delta;
    const t = timeRef.current;
    const { homes, phases, speeds } = particlesRef.current;
    const attr = points.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const span = CHAMBER_RADIUS * 1.05;
    for (let i = 0; i < COUNT; i++) {
      const hx = homes[i * 3];
      const hy = homes[i * 3 + 1];
      const hz = homes[i * 3 + 2];
      if (style.feature === "orbit") {
        const orbitAngle = phases[i] + t * speeds[i] * 0.4;
        const radius = Math.hypot(hx, hz);
        attr.setXYZ(
          i,
          Math.cos(orbitAngle) * radius,
          hy + Math.sin(t * speeds[i] + phases[i]) * 0.3,
          Math.sin(orbitAngle) * radius,
        );
      } else {
        const direction = style.feature === "rise" ? 1 : -1;
        const travel = (((t * speeds[i] * 0.8 * direction + hy) % (span * 2)) + span * 2) % (span * 2);
        attr.setXYZ(
          i,
          hx + Math.sin(t * speeds[i] * 0.7 + phases[i]) * 0.25,
          travel - span,
          hz + Math.cos(t * speeds[i] * 0.6 + phases[i]) * 0.25,
        );
      }
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        color={style.featureColor}
        size={0.06}
        sizeAttenuation
        map={getDotTexture()}
        transparent
        opacity={0.75}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/** Hanging glow-berry vines — the grove's signature. */
function HangingVines({
  styleKey,
  seed,
}: {
  styleKey: ChamberStyleKey;
  seed: number;
}) {
  const style = CHAMBER_STYLES[styleKey];

  const positions = useMemo(() => {
    const random = mulberry32(seed ^ 0x40e5);
    const data: number[] = [];
    for (let strand = 0; strand < 46; strand++) {
      const angle = random() * Math.PI * 2;
      const radius = random() * 3.6;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const top = 4.6 - random() * 1.3;
      const beads = 5 + Math.floor(random() * 7);
      for (let b = 0; b < beads; b++) {
        data.push(
          x + (random() - 0.5) * 0.12,
          top - b * (0.26 + random() * 0.14),
          z + (random() - 0.5) * 0.12,
        );
      }
    }
    return new Float32Array(data);
  }, [seed]);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={style.glow}
        size={0.08}
        sizeAttenuation
        map={getDotTexture()}
        transparent
        opacity={0.75}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/** Low fog banks drifting over the cavern floor. */
function GroundFog({
  styleKey,
  seed,
}: {
  styleKey: ChamberStyleKey;
  seed: number;
}) {
  const style = CHAMBER_STYLES[styleKey];
  const groupRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);

  const puffs = useMemo(() => {
    const random = mulberry32(seed ^ 0xf09);
    return Array.from({ length: 11 }, () => ({
      x: (random() - 0.5) * 6.4,
      y: FLOOR_Y + 0.6 + random() * 1.1,
      z: (random() - 0.5) * 6.4,
      scale: 3 + random() * 3.4,
      phase: random() * Math.PI * 2,
      drift: 0.08 + random() * 0.16,
    }));
  }, [seed]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    timeRef.current += delta;
    const t = timeRef.current;
    group.children.forEach((child, index) => {
      const puff = puffs[index];
      if (!puff) return;
      child.position.x = puff.x + Math.sin(t * puff.drift + puff.phase) * 0.9;
      child.position.z =
        puff.z + Math.cos(t * puff.drift * 0.8 + puff.phase) * 0.9;
    });
  });

  return (
    <group ref={groupRef}>
      {puffs.map((puff, index) => (
        <sprite
          key={index}
          scale={[puff.scale, puff.scale * 0.5, 1]}
          position={[puff.x, puff.y, puff.z]}
        >
          <spriteMaterial
            map={getDotTexture()}
            color={style.glow}
            transparent
            opacity={0.05}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}

/** Faint god-ray shafts falling from the dome's glowing veins. */
function LightShafts({
  styleKey,
  seed,
}: {
  styleKey: ChamberStyleKey;
  seed: number;
}) {
  const style = CHAMBER_STYLES[styleKey];
  const groupRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);

  const shafts = useMemo(() => {
    const random = mulberry32(seed ^ 0x5a4f);
    return Array.from({ length: 3 }, () => ({
      x: (random() - 0.5) * 4.6,
      z: (random() - 0.5) * 4.6,
      tilt: (random() - 0.5) * 0.24,
      tiltZ: (random() - 0.5) * 0.24,
      phase: random() * Math.PI * 2,
    }));
  }, [seed]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    timeRef.current += delta;
    const t = timeRef.current;
    group.children.forEach((child, index) => {
      const shaft = shafts[index];
      if (!shaft || !(child instanceof THREE.Mesh)) return;
      const material = child.material as THREE.MeshBasicMaterial;
      material.opacity = 0.035 + 0.03 * (0.5 + 0.5 * Math.sin(t * 0.5 + shaft.phase));
    });
  });

  return (
    <group ref={groupRef}>
      {shafts.map((shaft, index) => (
        <mesh
          key={index}
          position={[shaft.x, FLOOR_Y + 3.6, shaft.z]}
          rotation={[shaft.tiltZ, 0, shaft.tilt]}
        >
          <coneGeometry args={[1.2, 7, 12, 1, true]} />
          <meshBasicMaterial
            color={style.glow}
            transparent
            opacity={0.05}
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Tiny dust motes hanging in the cavern air, catching the light. */
function MoteField({
  styleKey,
  seed,
}: {
  styleKey: ChamberStyleKey;
  seed: number;
}) {
  const style = CHAMBER_STYLES[styleKey];
  const pointsRef = useRef<THREE.Points>(null);
  const timeRef = useRef(0);
  const motesRef = useRef<{
    seed: number;
    homes: Float32Array;
    phases: Float32Array;
  } | null>(null);
  const COUNT = 340;

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3),
    );
    return geo;
  }, []);
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useFrame((_, delta) => {
    const points = pointsRef.current;
    if (!points) return;
    if (motesRef.current == null || motesRef.current.seed !== seed) {
      const random = mulberry32(seed ^ 0x307e);
      const homes = new Float32Array(COUNT * 3);
      const phases = new Float32Array(COUNT);
      for (let i = 0; i < COUNT; i++) {
        const angle = random() * Math.PI * 2;
        const radius = Math.sqrt(random()) * CHAMBER_RADIUS * 0.85;
        homes[i * 3] = Math.cos(angle) * radius;
        homes[i * 3 + 1] = FLOOR_Y + 0.3 + random() * CHAMBER_RADIUS * 1.15;
        homes[i * 3 + 2] = Math.sin(angle) * radius;
        phases[i] = random() * Math.PI * 2;
      }
      motesRef.current = { seed, homes, phases };
    }
    timeRef.current += delta;
    const t = timeRef.current;
    const { homes, phases } = motesRef.current;
    const attr = points.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    for (let i = 0; i < COUNT; i++) {
      attr.setXYZ(
        i,
        homes[i * 3] + Math.sin(t * 0.16 + phases[i]) * 0.35,
        homes[i * 3 + 1] + Math.sin(t * 0.11 + phases[i] * 1.7) * 0.28,
        homes[i * 3 + 2] + Math.cos(t * 0.13 + phases[i]) * 0.35,
      );
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        color={style.glow}
        size={0.026}
        sizeAttenuation
        map={getDotTexture()}
        transparent
        opacity={0.4}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/**
 * Persistent molten life on the floor: seeded lava rivers snaking out
 * from the vent, glowing end pools, and slow blobs of molten light
 * drifting across the rock. Colored by the biome's lava.
 */
function LavaFlows({
  styleKey,
  seed,
}: {
  styleKey: ChamberStyleKey;
  seed: number;
}) {
  const style = CHAMBER_STYLES[styleKey];
  const streamsRef = useRef<THREE.Group>(null);
  const blobsRef = useRef<THREE.Points>(null);
  const timeRef = useRef(0);
  const blobHomesRef = useRef<{
    seed: number;
    homes: Float32Array;
    phases: Float32Array;
  } | null>(null);
  const BLOBS = 26;

  const streams = useMemo(() => {
    const random = mulberry32(seed ^ 0x1afa);
    const count = 4 + Math.floor(random() * 3);
    return Array.from({ length: count }, () => {
      // A molten river: a random walk from the vent outward.
      let angle = random() * Math.PI * 2;
      let radius = 0.35;
      const points: THREE.Vector3[] = [];
      const segments = 5 + Math.floor(random() * 4);
      for (let i = 0; i <= segments; i++) {
        points.push(
          new THREE.Vector3(
            Math.cos(angle) * radius,
            FLOOR_Y + 0.05,
            Math.sin(angle) * radius,
          ),
        );
        angle += (random() - 0.5) * 0.9;
        radius += 0.45 + random() * 0.4;
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const geometry = new THREE.TubeGeometry(
        curve,
        28,
        0.05 + random() * 0.04,
        5,
      );
      const last = points[points.length - 1];
      return {
        geometry,
        end: [last.x, last.z] as [number, number],
        poolScale: 0.3 + random() * 0.3,
        phase: random() * Math.PI * 2,
      };
    });
  }, [seed]);
  useEffect(() => {
    return () => {
      streams.forEach((stream) => stream.geometry.dispose());
    };
  }, [streams]);

  const blobGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(BLOBS * 3), 3),
    );
    return geo;
  }, []);
  useEffect(() => {
    return () => {
      blobGeometry.dispose();
    };
  }, [blobGeometry]);

  useFrame((_, delta) => {
    timeRef.current += delta;
    const t = timeRef.current;
    // Rivers pulse like a heartbeat of the vent.
    const group = streamsRef.current;
    if (group) {
      group.children.forEach((child, index) => {
        const stream = streams[Math.floor(index / 2)];
        if (!stream || !(child instanceof THREE.Mesh)) return;
        const material = child.material as THREE.MeshBasicMaterial;
        material.opacity =
          (index % 2 === 0 ? 0.42 : 0.3) +
          0.14 * Math.sin(t * 1.2 + stream.phase);
      });
    }
    // Molten blobs wander the floor.
    const points = blobsRef.current;
    if (points) {
      if (
        blobHomesRef.current == null ||
        blobHomesRef.current.seed !== seed
      ) {
        const random = mulberry32(seed ^ 0xb10b);
        const homes = new Float32Array(BLOBS * 3);
        const phases = new Float32Array(BLOBS);
        for (let i = 0; i < BLOBS; i++) {
          const angle = random() * Math.PI * 2;
          const radius = Math.sqrt(random()) * CHAMBER_RADIUS * 0.6;
          homes[i * 3] = Math.cos(angle) * radius;
          homes[i * 3 + 1] = FLOOR_Y + 0.09;
          homes[i * 3 + 2] = Math.sin(angle) * radius;
          phases[i] = random() * Math.PI * 2;
        }
        blobHomesRef.current = { seed, homes, phases };
      }
      const { homes, phases } = blobHomesRef.current;
      const attr = points.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      for (let i = 0; i < BLOBS; i++) {
        attr.setXYZ(
          i,
          homes[i * 3] + Math.sin(t * 0.14 + phases[i]) * 0.7,
          homes[i * 3 + 1],
          homes[i * 3 + 2] + Math.cos(t * 0.11 + phases[i] * 1.6) * 0.7,
        );
      }
      attr.needsUpdate = true;
    }
  });

  return (
    <group>
      <group ref={streamsRef}>
        {streams.map((stream, index) => (
          <group key={index}>
            <mesh geometry={stream.geometry} position={[0, -0.02, 0]}>
              <meshBasicMaterial
                color={style.lava}
                transparent
                opacity={0.42}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </mesh>
            {/* the river pools where it ends */}
            <mesh
              position={[stream.end[0], FLOOR_Y + 0.04, stream.end[1]]}
              rotation={[-Math.PI / 2, 0, 0]}
              scale={stream.poolScale}
            >
              <circleGeometry args={[1, 18]} />
              <meshBasicMaterial
                color={style.lava}
                transparent
                opacity={0.3}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </mesh>
          </group>
        ))}
      </group>
      <points ref={blobsRef} geometry={blobGeometry}>
        <pointsMaterial
          color={style.lava}
          size={0.1}
          sizeAttenuation
          map={getDotTexture()}
          transparent
          opacity={0.8}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

/** Glowing drips falling from the stalactites to the floor, endlessly. */
function DripFall({
  styleKey,
  seed,
}: {
  styleKey: ChamberStyleKey;
  seed: number;
}) {
  const style = CHAMBER_STYLES[styleKey];
  const pointsRef = useRef<THREE.Points>(null);
  const timeRef = useRef(0);
  const dripsRef = useRef<{
    seed: number;
    anchors: Float32Array;
    spans: Float32Array;
    speeds: Float32Array;
    phases: Float32Array;
  } | null>(null);
  const COUNT = 26;

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3),
    );
    return geo;
  }, []);
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useFrame((_, delta) => {
    const points = pointsRef.current;
    if (!points) return;
    if (dripsRef.current == null || dripsRef.current.seed !== seed) {
      const random = mulberry32(seed ^ 0xd819);
      const anchors = new Float32Array(COUNT * 3);
      const spans = new Float32Array(COUNT);
      const speeds = new Float32Array(COUNT);
      const phases = new Float32Array(COUNT);
      for (let i = 0; i < COUNT; i++) {
        const anchor = wallPoint(random, 0.35, 0.9).multiplyScalar(0.94);
        anchors[i * 3] = anchor.x;
        anchors[i * 3 + 1] = anchor.y;
        anchors[i * 3 + 2] = anchor.z;
        spans[i] = anchor.y - (FLOOR_Y + 0.08);
        speeds[i] = 1 + random() * 1.6;
        phases[i] = random() * 20;
      }
      dripsRef.current = { seed, anchors, spans, speeds, phases };
    }
    timeRef.current += delta;
    const t = timeRef.current;
    const { anchors, spans, speeds, phases } = dripsRef.current;
    const attr = points.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    for (let i = 0; i < COUNT; i++) {
      const progress = ((t + phases[i]) * speeds[i]) % spans[i];
      attr.setXYZ(
        i,
        anchors[i * 3],
        anchors[i * 3 + 1] - progress,
        anchors[i * 3 + 2],
      );
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        color={style.glow}
        size={0.05}
        sizeAttenuation
        map={getDotTexture()}
        transparent
        opacity={0.6}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/**
 * The chamber's volcanic welcome, now a full event: the floor cracks
 * open behind an expanding shockwave ring, a 220-mote molten column
 * erupts with tumbling rock debris that lands and stays, lava spills
 * into pools — and the vent never dies: a small looping fountain keeps
 * simmering long after the main blast. Keyed to the visit seed.
 */
function FloorEruption({
  styleKey,
  seed,
}: {
  styleKey: ChamberStyleKey;
  seed: number;
}) {
  const style = CHAMBER_STYLES[styleKey];
  const crackRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const burstRef = useRef<THREE.Points>(null);
  const simmerRef = useRef<THREE.Points>(null);
  const debrisRef = useRef<THREE.InstancedMesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const poolsRef = useRef<THREE.Group>(null);
  const stateRef = useRef<{
    seed: number;
    t: number;
    vel: Float32Array;
    spawn: Float32Array;
    simmerVel: Float32Array;
    simmerPhase: Float32Array;
    simmerPeriod: Float32Array;
    debrisVel: Float32Array;
    debrisSpin: Float32Array;
    debrisScale: Float32Array;
  } | null>(null);
  const COUNT = 220;
  const SIMMER = 90;
  const DEBRIS = 24;
  const GRAVITY = 4.6;
  const COLUMN_SECONDS = 3.1;

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) positions[i * 3 + 1] = FLOOR_Y + 0.05;
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);
  const simmerGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(SIMMER * 3);
    for (let i = 0; i < SIMMER; i++) positions[i * 3 + 1] = FLOOR_Y + 0.05;
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);
  const debrisGeometry = useMemo(
    () => new THREE.IcosahedronGeometry(0.07, 0),
    [],
  );
  useEffect(() => {
    return () => {
      geometry.dispose();
      simmerGeometry.dispose();
      debrisGeometry.dispose();
    };
  }, [geometry, simmerGeometry, debrisGeometry]);

  const pools = useMemo(() => {
    const random = mulberry32(seed ^ 0x1a7a);
    const count = 7 + Math.floor(random() * 4);
    return Array.from({ length: count }, (_, i) => {
      const angle = random() * Math.PI * 2;
      const radius = i === 0 ? 0 : 0.6 + random() * 2.5;
      return {
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        scale: (i === 0 ? 0.9 : 0.3) + random() * 0.55,
        delay: 0.7 + random() * 1.1,
        phase: random() * Math.PI * 2,
      };
    });
  }, [seed]);

  useFrame((_, delta) => {
    if (stateRef.current == null || stateRef.current.seed !== seed) {
      const random = mulberry32(seed ^ 0xe20b);
      const vel = new Float32Array(COUNT * 3);
      const spawn = new Float32Array(COUNT);
      for (let i = 0; i < COUNT; i++) {
        const angle = random() * Math.PI * 2;
        const out = 0.2 + random() * 1.2;
        vel[i * 3] = Math.cos(angle) * out;
        vel[i * 3 + 1] = 3.2 + random() * 4.6;
        vel[i * 3 + 2] = Math.sin(angle) * out;
        spawn[i] = random() * 1.5;
      }
      const simmerVel = new Float32Array(SIMMER * 3);
      const simmerPhase = new Float32Array(SIMMER);
      const simmerPeriod = new Float32Array(SIMMER);
      for (let i = 0; i < SIMMER; i++) {
        const angle = random() * Math.PI * 2;
        const out = 0.1 + random() * 0.4;
        simmerVel[i * 3] = Math.cos(angle) * out;
        simmerVel[i * 3 + 1] = 1.2 + random() * 1.6;
        simmerVel[i * 3 + 2] = Math.sin(angle) * out;
        simmerPhase[i] = random() * 12;
        simmerPeriod[i] = 2.4 + random() * 3.6;
      }
      const debrisVel = new Float32Array(DEBRIS * 3);
      const debrisSpin = new Float32Array(DEBRIS);
      const debrisScale = new Float32Array(DEBRIS);
      for (let i = 0; i < DEBRIS; i++) {
        const angle = random() * Math.PI * 2;
        const out = 0.4 + random() * 1.4;
        debrisVel[i * 3] = Math.cos(angle) * out;
        debrisVel[i * 3 + 1] = 2.6 + random() * 3.4;
        debrisVel[i * 3 + 2] = Math.sin(angle) * out;
        debrisSpin[i] = 2 + random() * 8;
        debrisScale[i] = 0.5 + random() * 1.3;
      }
      stateRef.current = {
        seed, t: 0, vel, spawn,
        simmerVel, simmerPhase, simmerPeriod,
        debrisVel, debrisSpin, debrisScale,
      };
    }
    const state = stateRef.current;
    state.t += delta;
    const t = state.t;

    // The crack tears open fast, then settles into a glowing scar.
    if (crackRef.current) {
      const open = Math.min(1, t / 0.5);
      const eased = 1 - (1 - open) ** 3;
      crackRef.current.scale.setScalar(Math.max(0.001, eased));
      const material = crackRef.current.material as THREE.MeshBasicMaterial;
      material.opacity =
        eased * (t < 2.6 ? 0.9 : 0.55 + 0.1 * Math.sin(t * 1.7));
    }

    // Shockwave ring racing across the floor at the moment of rupture.
    if (ringRef.current) {
      const wave = Math.min(1, t / 0.9);
      const eased = 1 - (1 - wave) ** 2;
      ringRef.current.scale.setScalar(0.2 + eased * 6);
      const material = ringRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = (1 - eased) * 0.55;
    }

    // Main molten column.
    const points = burstRef.current;
    if (points) {
      if (t < COLUMN_SECONDS + 2.4) {
        points.visible = true;
        const attr = points.geometry.getAttribute(
          "position",
        ) as THREE.BufferAttribute;
        for (let i = 0; i < COUNT; i++) {
          const age = t - state.spawn[i];
          if (age <= 0) {
            attr.setXYZ(i, 0, FLOOR_Y + 0.05, 0);
            continue;
          }
          const y =
            FLOOR_Y + 0.05 + state.vel[i * 3 + 1] * age -
            0.5 * GRAVITY * age * age;
          if (y <= FLOOR_Y + 0.04) {
            const landT =
              (2 * state.vel[i * 3 + 1]) / GRAVITY;
            attr.setXYZ(
              i,
              state.vel[i * 3] * landT,
              FLOOR_Y + 0.05,
              state.vel[i * 3 + 2] * landT,
            );
          } else {
            attr.setXYZ(
              i,
              state.vel[i * 3] * age,
              y,
              state.vel[i * 3 + 2] * age,
            );
          }
        }
        attr.needsUpdate = true;
      } else {
        points.visible = false;
      }
    }

    // The vent never dies: a small looping fountain simmers forever.
    const simmer = simmerRef.current;
    if (simmer) {
      const attr = simmer.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      for (let i = 0; i < SIMMER; i++) {
        const cycle =
          (t + state.simmerPhase[i]) % state.simmerPeriod[i];
        const y =
          FLOOR_Y + 0.05 + state.simmerVel[i * 3 + 1] * cycle -
          0.5 * GRAVITY * cycle * cycle;
        if (y <= FLOOR_Y + 0.04) {
          attr.setXYZ(i, 0, FLOOR_Y + 0.05, 0);
        } else {
          attr.setXYZ(
            i,
            state.simmerVel[i * 3] * cycle,
            y,
            state.simmerVel[i * 3 + 2] * cycle,
          );
        }
      }
      attr.needsUpdate = true;
    }

    // Rock debris: blasted out, tumbling, landing where it falls — and
    // staying there as fresh scatter until the next visit.
    const debris = debrisRef.current;
    if (debris) {
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const euler = new THREE.Euler();
      const scale = new THREE.Vector3();
      for (let i = 0; i < DEBRIS; i++) {
        const age = Math.max(0.001, t - 0.15);
        const vy = state.debrisVel[i * 3 + 1];
        const landT = (2 * vy) / GRAVITY;
        const flying = age < landT;
        const clamped = Math.min(age, landT);
        position.set(
          state.debrisVel[i * 3] * clamped,
          Math.max(
            FLOOR_Y + 0.06,
            FLOOR_Y + 0.05 + vy * clamped - 0.5 * GRAVITY * clamped * clamped,
          ),
          state.debrisVel[i * 3 + 2] * clamped,
        );
        const tumble = state.debrisSpin[i] * (flying ? age : landT);
        euler.set(tumble, tumble * 0.7, tumble * 1.3);
        quaternion.setFromEuler(euler);
        scale.setScalar(state.debrisScale[i]);
        matrix.compose(position, quaternion, scale);
        debris.setMatrixAt(i, matrix);
      }
      debris.instanceMatrix.needsUpdate = true;
    }

    // Eruption light: a hard flash settling into a molten smoulder that
    // keeps flickering with the simmering vent.
    if (lightRef.current) {
      lightRef.current.intensity =
        t < 0.45
          ? (t / 0.45) * 17
          : Math.max(
              2.4 + Math.sin(t * 1.9) * 0.7 + Math.sin(t * 5.3) * 0.3,
              17 * Math.exp(-(t - 0.45) * 1.4),
            );
    }

    // Lava pools swell where the spill settles, then simmer.
    const group = poolsRef.current;
    if (group) {
      group.children.forEach((child, index) => {
        const pool = pools[index];
        if (!pool || !(child instanceof THREE.Mesh)) return;
        const grow = Math.min(1, Math.max(0, (t - pool.delay) / 0.8));
        const eased = 1 - (1 - grow) ** 2;
        child.scale.setScalar(Math.max(0.001, eased * pool.scale));
        const material = child.material as THREE.MeshBasicMaterial;
        material.opacity =
          eased * (0.38 + 0.12 * Math.sin(t * 1.3 + pool.phase));
      });
    }
  });

  return (
    <group>
      {/* the floor cracking open */}
      <mesh
        ref={crackRef}
        position={[0, FLOOR_Y + 0.06, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[4.4, 4.4]} />
        <meshBasicMaterial
          map={getCrackTexture()}
          color={style.lava}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* the rupture shockwave */}
      <mesh
        ref={ringRef}
        position={[0, FLOOR_Y + 0.07, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[0.55, 0.7, 48]} />
        <meshBasicMaterial
          color={style.lava}
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* the molten column */}
      <points ref={burstRef} geometry={geometry}>
        <pointsMaterial
          color={style.lava}
          size={0.1}
          sizeAttenuation
          map={getDotTexture()}
          transparent
          opacity={0.95}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      {/* the ever-simmering vent */}
      <points ref={simmerRef} geometry={simmerGeometry}>
        <pointsMaterial
          color={style.lava}
          size={0.07}
          sizeAttenuation
          map={getDotTexture()}
          transparent
          opacity={0.8}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      {/* blasted rock, resting where it lands */}
      <instancedMesh
        ref={debrisRef}
        args={[undefined, undefined, DEBRIS]}
        geometry={debrisGeometry}
        frustumCulled={false}
      >
        <meshStandardMaterial
          color={style.rockCrack}
          emissive={style.lava}
          emissiveIntensity={0.7}
          metalness={0.2}
          roughness={0.7}
        />
      </instancedMesh>

      {/* lava spilling across the floor */}
      <group ref={poolsRef}>
        {pools.map((pool, index) => (
          <mesh
            key={index}
            position={[pool.x, FLOOR_Y + 0.045 + index * 0.002, pool.z]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <circleGeometry args={[1, 20]} />
            <meshBasicMaterial
              color={style.lava}
              transparent
              opacity={0}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        ))}
      </group>

      <pointLight
        ref={lightRef}
        color={style.lava}
        intensity={0}
        distance={13}
        decay={2}
        position={[0, FLOOR_Y + 0.9, 0]}
      />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

export function BiomeChamber({
  styleKey,
  seed,
  position,
  children,
}: {
  styleKey: ChamberStyleKey;
  seed: number;
  position: [number, number, number];
  /** Extra chamber content (entity emblem, hidden treasures, …). */
  children?: React.ReactNode;
}) {
  const style = CHAMBER_STYLES[styleKey];

  return (
    <group position={position}>
      {children}
      <ChamberRock styleKey={styleKey} seed={seed} />
      <CrystalGrowth styleKey={styleKey} seed={seed} />

      {/* the volcanic welcome — every entry erupts fresh */}
      <FloorEruption styleKey={styleKey} seed={seed} />
      <LavaFlows styleKey={styleKey} seed={seed} />
      <DripFall styleKey={styleKey} seed={seed} />

      {/* the ecosystem */}
      <OrganismSwarm styleKey={styleKey} seed={seed} />
      <FloorGrowth styleKey={styleKey} seed={seed} />
      <WallColonies styleKey={styleKey} seed={seed} />
      <FeatureParticles styleKey={styleKey} seed={seed} />
      <MoteField styleKey={styleKey} seed={seed} />
      {style.vines ? <HangingVines styleKey={styleKey} seed={seed} /> : null}

      {/* cavern atmosphere */}
      <GroundFog styleKey={styleKey} seed={seed} />
      <LightShafts styleKey={styleKey} seed={seed} />

      {/* hazy cavern air — soft volume glow so the space feels enclosed */}
      <sprite scale={[10, 10, 1]} position={[0, 0.4, 0]}>
        <spriteMaterial
          map={getDotTexture()}
          color={style.glow}
          transparent
          opacity={0.07}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <sprite scale={[7, 4, 1]} position={[0, FLOOR_Y + 1, 0]}>
        <spriteMaterial
          map={getDotTexture()}
          color={style.emissive}
          transparent
          opacity={0.06}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      {/* chamber light */}
      <pointLight color={style.glow} intensity={10} distance={17} decay={1.9} />
      <pointLight
        color={style.emissive}
        intensity={5}
        distance={12}
        decay={2}
        position={[0, FLOOR_Y + 1.2, 0]}
      />
      <pointLight
        color={style.glow}
        intensity={2.4}
        distance={10}
        decay={2}
        position={[1.4, 3, -1]}
      />
      <ambientLight intensity={0.22} color={style.glow} />
    </group>
  );
}

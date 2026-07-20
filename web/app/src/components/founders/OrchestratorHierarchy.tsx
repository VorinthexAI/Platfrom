"use client";

import { useEffect, useRef } from "react";
import { Line } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import Image from "next/image";
import * as THREE from "three";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";

type Point = { x: number; y: number };

const LAYOUT: Record<string, Point> = {
  atlas: { x: 50, y: 48 },
  metis: { x: 50, y: 22 },
  hermes: { x: 29, y: 34 },
  phoenix: { x: 71, y: 34 },
  athena: { x: 75, y: 53 },
  ledger: { x: 50, y: 74 },
  sentinel: { x: 27, y: 62 },
  echo: { x: 42, y: 9 },
  matrix: { x: 58, y: 9 },
  harmony: { x: 14, y: 27 },
  iris: { x: 83, y: 20 },
  orbit: { x: 90, y: 8 },
  apollo: { x: 91, y: 29 },
  forge: { x: 72, y: 72 },
  helios: { x: 89, y: 54 },
  aura: { x: 84, y: 82 },
  pillar: { x: 68, y: 91 },
  vulcan: { x: 94, y: 65 },
  mercury: { x: 50, y: 93 },
  themis: { x: 13, y: 82 },
};

const ORCHESTRATORS = Object.values(VORINTHEX_GALAXY_REGISTRY.orchestrators)
  .filter((entity) => LAYOUT[entity.slug]);
const BY_ID = new Map(ORCHESTRATORS.map((entity) => [entity.id, entity]));

function worldPoint(point: Point, width: number, height: number): [number, number, number] {
  return [((point.x / 100) - 0.5) * width, (0.5 - (point.y / 100)) * height, 0];
}

function NodeHalo({ entity, selected }: { entity: GalaxyEntity; selected: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const { viewport, size } = useThree();
  const point = worldPoint(LAYOUT[entity.slug], viewport.width, viewport.height);
  const pixel = viewport.width / size.width;

  useFrame(({ clock }) => {
    if (!mesh.current || !material.current) return;
    const wave = Math.sin(clock.elapsedTime * 2.1 + LAYOUT[entity.slug].x) * 0.5 + 0.5;
    mesh.current.scale.setScalar(selected ? 1.08 + wave * 0.16 : 1 + wave * 0.035);
    material.current.opacity = selected ? 0.42 + wave * 0.2 : 0.11 + wave * 0.04;
  });

  return (
    <mesh ref={mesh} position={point}>
      <ringGeometry args={[(selected ? 39 : 31) * pixel, (selected ? 43 : 33) * pixel, 48]} />
      <meshBasicMaterial
        ref={material}
        color={selected ? "#f2f6ff" : "#93a0ad"}
        transparent
        opacity={selected ? 0.58 : 0.14}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

function HierarchyScene({ selectedSlug }: { selectedSlug: string }) {
  const { viewport, size } = useThree();
  const unit = viewport.width / size.width;
  const center = worldPoint(LAYOUT.atlas, viewport.width, viewport.height);
  const ringRadius = Math.min(viewport.width, viewport.height) * 0.16;

  return (
    <group>
      {[1, 1.55, 2.1, 2.65].map((scale) => (
        <mesh key={scale} position={[center[0], center[1], -0.08]}>
          <ringGeometry args={[ringRadius * scale - unit * 0.45, ringRadius * scale, 128]} />
          <meshBasicMaterial
            color="#83909e"
            transparent
            opacity={scale === 1 ? 0.13 : 0.075}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}

      {ORCHESTRATORS.map((entity) => {
        if (!entity.reportsTo) return null;
        const parent = BY_ID.get(entity.reportsTo);
        if (!parent) return null;
        const active = entity.slug === selectedSlug || parent.slug === selectedSlug;
        const points = [
          worldPoint(LAYOUT[parent.slug], viewport.width, viewport.height),
          worldPoint(LAYOUT[entity.slug], viewport.width, viewport.height),
        ];
        return (
          <group key={`${parent.id}:${entity.id}`}>
            <Line points={points} color="#8e9ba8" lineWidth={active ? 2.4 : 1} transparent opacity={active ? 0.44 : 0.14} />
            {active ? <Line points={points} color="#eef5ff" lineWidth={0.65} transparent opacity={0.72} /> : null}
          </group>
        );
      })}

      {ORCHESTRATORS.map((entity) => (
        <NodeHalo key={entity.id} entity={entity} selected={entity.slug === selectedSlug} />
      ))}
    </group>
  );
}

interface OrchestratorHierarchyProps {
  selectedSlug: string;
  onSelect: (orchestrator: GalaxyEntity) => void;
}

export default function OrchestratorHierarchy({ selectedSlug, onSelect }: OrchestratorHierarchyProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const point = LAYOUT[selectedSlug];
    const contentWidth = container.scrollWidth;
    container.scrollTo({
      left: Math.max(0, (contentWidth * point.x / 100) - (container.clientWidth / 2)),
      behavior: selectedSlug === "atlas" ? "instant" : "smooth",
    });
  }, [selectedSlug]);

  return (
    <div ref={scrollRef} className="scrollbar-hide relative h-full min-h-[590px] w-full overflow-x-auto overflow-y-hidden" aria-label="Command orchestrator hierarchy">
      <div className="relative mx-auto h-full min-h-[590px] min-w-[900px] max-w-[1280px]">
        <Canvas
          orthographic
          camera={{ position: [0, 0, 8], zoom: 1, near: 0.1, far: 20 }}
          dpr={[1, 1.5]}
          gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
          className="!absolute !inset-0 pointer-events-none"
          aria-hidden
        >
          <HierarchyScene selectedSlug={selectedSlug} />
        </Canvas>

        {ORCHESTRATORS.map((entity) => {
          const point = LAYOUT[entity.slug];
          const selected = entity.slug === selectedSlug;
          return (
            <button
              key={entity.id}
              type="button"
              aria-pressed={selected}
              aria-label={`Chat with ${entity.name}, ${entity.role}`}
              onClick={() => onSelect(entity)}
              className="group absolute z-10 flex w-[92px] -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center outline-none"
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
            >
              <span
                className={`relative flex h-[62px] w-[62px] items-center justify-center rounded-full border transition-all duration-500 ${selected
                  ? "border-white/80 bg-[#111820]/95 shadow-[0_0_14px_rgba(231,240,249,0.85),0_0_44px_rgba(151,181,209,0.58),inset_0_0_20px_rgba(220,235,248,0.16)]"
                  : "border-white/24 bg-[#080c11]/80 shadow-[0_0_15px_rgba(144,169,191,0.14)] group-hover:border-white/55 group-hover:shadow-[0_0_24px_rgba(180,207,230,0.36)]"
                }`}
              >
                <Image
                  src={entity.logo.src}
                  alt=""
                  width={46}
                  height={46}
                  draggable={false}
                  className={`h-[46px] w-[46px] object-contain transition-all duration-500 ${selected ? "brightness-125 drop-shadow-[0_0_8px_rgba(255,255,255,0.65)]" : "opacity-80 grayscale group-hover:opacity-100"}`}
                />
              </span>
              <span className={`mt-1.5 font-mono text-[0.61rem] tracking-[0.15em] transition-colors ${selected ? "text-white" : "text-silver-300 group-hover:text-silver-50"}`}>
                {entity.role}
              </span>
              <span className={`mt-0.5 text-[0.64rem] tracking-[0.1em] uppercase transition-colors ${selected ? "text-silver-50" : "text-silver-400"}`}>
                {entity.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

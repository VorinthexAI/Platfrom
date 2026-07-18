"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { SceneManifest, SceneNode } from "@/lib/founders/types";
import { TEXTURE_REGISTRY } from "@/lib/artifacts/material-registry";

function CameraController({ manifest }: { manifest: SceneManifest }) {
  const camera = useThree((state) => state.camera); const controls = useThree((state) => state.controls) as { target?: THREE.Vector3; update?: () => void } | undefined;
  useEffect(() => {
    const distance = Math.max(8, manifest.layout.bounds.radius * 1.55);
    camera.position.set(manifest.layout.cameraTarget[0], manifest.layout.cameraTarget[1] + distance * 0.25, manifest.layout.cameraTarget[2] + distance);
    camera.lookAt(...manifest.layout.cameraTarget); camera.updateProjectionMatrix();
    controls?.target?.set(...manifest.layout.cameraTarget); controls?.update?.();
  }, [camera, controls, manifest.layout]);
  return null;
}

function NodeGeometry({ node }: { node: SceneNode }) {
  if (node.appearance.shape === "cube") return <boxGeometry args={[1.2, 1.2, 1.2]} />;
  if (node.appearance.shape === "ring") return <torusGeometry args={[0.72, 0.18, 16, 48]} />;
  if (node.appearance.shape === "plane") return <planeGeometry args={[1.5, 1.05]} />;
  return <sphereGeometry args={[0.72, 32, 20]} />;
}

function SpatialNode({ node, selected, onSelect }: { node: SceneNode; selected: boolean; onSelect(node: SceneNode): void }) {
  const group = useRef<THREE.Group>(null); const [hovered, setHovered] = useState(false); const target = useMemo(() => new THREE.Vector3(...node.position), [node.position]);
  useFrame((_state, delta) => { if (!group.current) return; group.current.position.lerp(target, 1 - Math.exp(-delta * 7)); group.current.rotation.y += delta * (selected ? 0.6 : 0.16); });
  const material = TEXTURE_REGISTRY[node.appearance.texture];
  return <group ref={group} position={node.position} scale={node.appearance.scale * (hovered || selected ? 1.14 : 1)}>
    <mesh onClick={(event) => { event.stopPropagation(); onSelect(node); }} onPointerEnter={(event) => { event.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }} onPointerLeave={() => { setHovered(false); document.body.style.cursor = "default"; }}>
      <NodeGeometry node={node} />
      <meshStandardMaterial side={THREE.DoubleSide} color={node.appearance.color} emissive={node.appearance.emissive} emissiveIntensity={selected ? 0.8 : 0.32} metalness={material.metalness} roughness={material.roughness} transparent={material.transparent || node.appearance.opacity < 1} opacity={node.appearance.opacity} wireframe={node.appearance.wireframe} />
    </mesh>
    {hovered || selected ? <Html center distanceFactor={10} position={[0, -1.25, 0]} style={{ pointerEvents: "none" }}><span className="whitespace-nowrap rounded-full border border-white/10 bg-black/75 px-2 py-1 font-mono text-[9px] tracking-[0.08em] text-silver-100 backdrop-blur-md">{node.label}</span></Html> : null}
  </group>;
}

function SpatialScene({ manifest, selectedId, onSelect }: { manifest: SceneManifest; selectedId: string | null; onSelect(node: SceneNode): void }) {
  return <>
    <color attach="background" args={[manifest.appearance.background]} />
    <fog attach="fog" args={[manifest.appearance.background, manifest.layout.bounds.radius * 1.5, manifest.layout.bounds.radius * 4]} />
    <ambientLight intensity={0.55} color="#9aa4ab" />
    <directionalLight position={[8, 12, 10]} intensity={1.3} color="#eef2f4" />
    <pointLight position={[-10, -4, 8]} intensity={18} distance={35} color="#d57828" />
    {manifest.edges.map((edge) => <Line key={edge.id} points={[edge.fromPosition, edge.toPosition]} color={edge.color} transparent opacity={edge.opacity} lineWidth={0.65} />)}
    {manifest.nodes.map((node) => <SpatialNode key={node.id} node={node} selected={selectedId === node.id} onSelect={onSelect} />)}
    <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={3} maxDistance={manifest.layout.bounds.radius * 4} />
    <CameraController manifest={manifest} />
  </>;
}

export function SpatialArtifactCanvas({ manifest, selectedId, onSelect }: { manifest: SceneManifest; selectedId: string | null; onSelect(node: SceneNode): void }) {
  const orthographic = manifest.layout.camera === "orthographic";
  return <Canvas orthographic={orthographic} dpr={[1, 1.6]} camera={orthographic ? { position: [0, 4, 16], zoom: 32, near: 0.1, far: 500 } : { position: [0, 4, 16], fov: 45, near: 0.1, far: 500 }} gl={{ antialias: true, powerPreference: "high-performance", alpha: false }} className="!absolute !inset-0" aria-label="Interactive artifact graph">
    <SpatialScene manifest={manifest} selectedId={selectedId} onSelect={onSelect} />
  </Canvas>;
}

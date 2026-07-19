"use client";

import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { products, type ProductPlanetData } from "@/data/products";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import {
  getCapabilitiesForCore,
  getOrchestratorsForCommand,
} from "@/lib/galaxy/registry-helpers";
import {
  ORBIT_STEPS,
  stepForEntity,
  stepIndexForFocus,
  syncEntityUrl,
  useGalaxyStore,
} from "@/lib/galaxy-store";
import { AsteroidBelt } from "./AsteroidBelt";
import { CameraRig } from "./CameraRig";
import { CaveScene } from "./CaveScene";
import { CollectibleField } from "./CollectibleField";
import { HyperJumpStreaks } from "./HyperJumpStreaks";
import { IntroCosmos } from "./IntroCosmos";
import { NexusSun } from "./NexusSun";
import { OrbitRing } from "./OrbitRing";
import { OrbitingEntities } from "./OrbitingEntities";
import { ProductPlanet } from "./ProductPlanet";
import { SpinRig } from "./SpinRig";
import { Starfield } from "./Starfield";
import { SystemDebris } from "./SystemDebris";
import { VisitorStars } from "./VisitorStars";
import { WorldInterior } from "./WorldInterior";

interface GalaxySceneProps {
  reducedMotion: boolean;
}

const coreCapabilityEntities = getCapabilitiesForCore();
const commandOrchestratorEntities = getOrchestratorsForCommand();

/**
 * The full solar-system canvas, rendered entirely from the galaxy registry.
 * Rendering pauses while the tab is hidden, simplifies on low-power
 * devices, and freezes orbits under reduced motion. Clicking empty space
 * deliberately does NOTHING — navigation happens via scroll, the rail,
 * the nav, and direct clicks, so explorers hunting fragments never get
 * yanked back to the overview by a missed click.
 */
export default function GalaxyScene({ reducedMotion }: GalaxySceneProps) {
  const setStep = useGalaxyStore((s) => s.setStep);
  const [hidden, setHidden] = useState(false);
  // Device-capability heuristic: few cores or a coarse pointer likely means
  // a phone — thin the starfield and cap the pixel ratio harder. Safe to
  // read during render: this component only ever renders client-side.
  const [lowPower] = useState(() => {
    const cores = navigator.hardwareConcurrency ?? 8;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    return cores <= 4 || coarse;
  });

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const paused = reducedMotion || hidden;

  function selectProduct(data: ProductPlanetData) {
    const state = useGalaxyStore.getState();
    if (state.mode !== "system") return;
    if (state.focus === data.key) {
      // Clicking the focused planet steps back out to the overview.
      setStep(0);
      syncEntityUrl("/");
    } else {
      const nextStep = stepIndexForFocus(data.key);
      setStep(nextStep);
      syncEntityUrl(ORBIT_STEPS[nextStep]?.path ?? "/");
    }
  }

  function selectChild(entity: GalaxyEntity) {
    if (useGalaxyStore.getState().mode !== "system") return;
    const nextStep = stepForEntity(entity);
    setStep(nextStep);
    syncEntityUrl(ORBIT_STEPS[nextStep]?.path ?? "/");
  }

  return (
    <Canvas
      frameloop={hidden || reducedMotion ? "never" : "always"}
      // Render at CSS-pixel resolution so high-DPI displays cannot multiply
      // the full-screen color, depth, MSAA, and compositor buffer footprint.
      dpr={lowPower ? 0.65 : 0.8}
      camera={{ position: [0, 6.5, 15.5], fov: 42, near: 0.1, far: 320 }}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      aria-hidden
      className="!absolute !inset-0"
    >
      <color attach="background" args={["#020304"]} />
      <fog attach="fog" args={["#020304", 34, 150]} />

      <ambientLight intensity={0.3} color="#3c434a" />
      <directionalLight position={[8, 12, 6]} intensity={0.75} color="#dde2e5" />

      <Starfield paused={paused} dense={false} />

      <SpinRig>
        <NexusSun paused={paused} />
        <AsteroidBelt paused={paused} dense={false} />
        <SystemDebris paused={paused} dense={false} />

        {products.map((product) => (
          <OrbitRing key={`orbit-${product.key}`} radius={product.orbitRadius} />
        ))}

        {products.map((product) => (
          <ProductPlanet
            key={product.key}
            data={product}
            paused={paused}
            onSelect={selectProduct}
          >
            {product.key === "core" ? (
              <OrbitingEntities
                entities={coreCapabilityEntities}
                revealForFocus="core"
                paused={paused}
                onSelect={selectChild}
              />
            ) : product.key === "command" ? (
              <OrbitingEntities
                entities={commandOrchestratorEntities}
                revealForFocus="command"
                paused={paused}
                onSelect={selectChild}
              />
            ) : null}
          </ProductPlanet>
        ))}

        <CollectibleField paused={paused} />
      </SpinRig>

      <IntroCosmos />
      <CaveScene />
      <WorldInterior />
      {/* fellow explorers — world-space, outside the spinning rig */}
      <VisitorStars />
      <HyperJumpStreaks />
      <CameraRig reducedMotion={reducedMotion} />
    </Canvas>
  );
}

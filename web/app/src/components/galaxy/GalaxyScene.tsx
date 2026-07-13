"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
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
import {
  CHAMBER_STYLES,
  getCrackTexture,
  getRockTextures,
  type ChamberStyleKey,
} from "@/lib/three/chamber";
import { AsteroidBelt } from "./AsteroidBelt";
import { BiomeChamber } from "./BiomeChamber";
import { CameraRig } from "./CameraRig";
import { CaveScene } from "./CaveScene";
import { CollectibleField } from "./CollectibleField";
import { ExplosionField } from "./ExplosionField";
import { HyperJumpStreaks } from "./HyperJumpStreaks";
import { IntroCosmos } from "./IntroCosmos";
import { MeteorShower } from "./MeteorShower";
import { SunEjecta } from "./SunEjecta";
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

/**
 * First-entry warm-up. Entering a biome adds the chamber's point lights
 * to the scene, and a changed light count forces WebGL to recompile
 * EVERY lit material — planets, belt, rock, chamber — right at the
 * moment of entry: that was the "first biome is laggy, then fine" hitch.
 * This mounts one hidden chamber far below the galaxy a few seconds
 * after load, uploads every biome's textures, and compiles all shader
 * programs against interior lighting while nothing is moving.
 */
function InteriorWarmup() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const [warming, setWarming] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    // After the intro flight has landed and the system is idling.
    const timer = window.setTimeout(() => setWarming(true), 5200);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!warming || startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    // Wait one frame so the hidden chamber is in the scene graph.
    const frame = requestAnimationFrame(() => {
      (Object.keys(CHAMBER_STYLES) as ChamberStyleKey[]).forEach((key) => {
        const textures = getRockTextures(key);
        gl.initTexture(textures.map);
        gl.initTexture(textures.bumpMap);
        gl.initTexture(textures.emissiveMap);
      });
      gl.initTexture(getCrackTexture());
      const finish = () => {
        if (!cancelled) setWarming(false);
      };
      gl.compileAsync(scene, camera).then(finish, finish);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [warming, gl, scene, camera]);

  return warming ? (
    <BiomeChamber styleKey="gem" seed={7} position={[0, -900, 0]} />
  ) : null;
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
      frameloop={hidden ? "never" : "always"}
      dpr={lowPower ? [1, 1.5] : [1, 1.75]}
      camera={{ position: [0, 6.5, 15.5], fov: 42, near: 0.1, far: 320 }}
      gl={{ antialias: !lowPower, powerPreference: "high-performance" }}
      aria-hidden
      className="!absolute !inset-0"
    >
      <color attach="background" args={["#020304"]} />
      <fog attach="fog" args={["#020304", 34, 150]} />

      <ambientLight intensity={0.3} color="#3c434a" />
      <directionalLight position={[8, 12, 6]} intensity={0.75} color="#dde2e5" />

      <Starfield paused={paused} dense={!lowPower} />

      <SpinRig>
        <NexusSun paused={paused} />
        <AsteroidBelt paused={paused} dense={!lowPower} />
        <SystemDebris paused={paused} dense={!lowPower} />
        {/* the belt lives: eruptions, strikes, collisions */}
        <SunEjecta paused={paused} />
        <MeteorShower paused={paused} />
        <ExplosionField paused={paused} />

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
      <InteriorWarmup />
      <CameraRig reducedMotion={reducedMotion} />
    </Canvas>
  );
}

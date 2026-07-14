import { Component, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { BiomeChamber } from "@/components/galaxy/BiomeChamber";
import { CameraRig, OVERVIEW_POSITION } from "@/components/galaxy/CameraRig";
import { CapabilityPlanet } from "@/components/galaxy/CapabilityPlanet";
import { chamberStyleForSlug } from "@/components/galaxy/chamber-config";
import { CAPABILITY_ORBITS } from "@/components/galaxy/galaxy-config";
import { Starfield } from "@/components/galaxy/Starfield";
import { SystemRig } from "@/components/galaxy/SystemRig";
import { Canvas } from "@/components/three/Canvas";
import { BrainCoreObject } from "@/components/three/BrainCore3D";
import type { CapabilitySlug } from "@/data/registry";
import { useGalaxyStore } from "@/state/galaxy";

const OBSIDIAN = "#030507";

/**
 * A JS error anywhere in the 3D tree must never take the app down — the
 * field goes dark instead and the rest of the screen keeps working.
 */
class SceneBoundary extends Component<
  { children: ReactNode; style?: StyleProp<ViewStyle> },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[GalaxyScene] render error:", error);
  }

  render() {
    if (this.state.failed) {
      return (
        <View style={[{ backgroundColor: OBSIDIAN }, this.props.style]} />
      );
    }
    return this.props.children;
  }
}

export type GalaxySceneProps = {
  enabledSlugs: readonly CapabilitySlug[];
  selectedSlug: CapabilitySlug | null;
  paused?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * The mobile galaxy: the wireframe brain core at the origin where the web
 * landing keeps its sun, capability worlds orbiting on alternating
 * equatorial/polar planes — a 3D globe of orbits around the mind. Diving
 * into a world teleports (under the veil) to its BiomeChamber far below.
 */
export function GalaxyScene({
  enabledSlugs,
  selectedSlug,
  paused = false,
  style,
}: GalaxySceneProps) {
  const phase = useGalaxyStore((state) => state.phase);
  const targetSlug = useGalaxyStore((state) => state.targetSlug);
  const visitSeed = useGalaxyStore((state) => state.visitSeed);

  const orbits = CAPABILITY_ORBITS.filter((orbit) =>
    enabledSlugs.includes(orbit.slug),
  );
  // Mount the chamber only once the veil is closing/closed — its shader
  // compile happens in the dark, never during the swipe gesture itself.
  const diveTarget =
    (phase === "enter" || phase === "inside" || phase === "exit") && targetSlug
      ? targetSlug
      : null;

  return (
    <SceneBoundary style={style}>
      <Canvas
      style={style}
      camera={{
        position: [OVERVIEW_POSITION.x, OVERVIEW_POSITION.y, OVERVIEW_POSITION.z],
        fov: 48,
        near: 0.1,
        far: 160,
      }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      dpr={[1, 1.75]}
    >
      <color attach="background" args={[OBSIDIAN]} />
      <fog attach="fog" args={[OBSIDIAN, 18, 60]} />
      <CameraRig />
      <Starfield paused={paused} />
      {/* Swipe-steered system mount: everything that should rotate under
          the finger lives here; the chamber below must not. */}
      <SystemRig>
        <BrainCoreObject motion="spin" scale={1.05} />
        {orbits.map((orbit) => (
          <CapabilityPlanet
            key={orbit.slug}
            orbit={orbit}
            focused={orbit.slug === (targetSlug ?? selectedSlug)}
            paused={paused}
          />
        ))}
      </SystemRig>
      {diveTarget ? (
        <BiomeChamber
          key={`${diveTarget}-${visitSeed}`}
          styleKey={chamberStyleForSlug(diveTarget)}
          seed={visitSeed}
        />
      ) : null}
      </Canvas>
    </SceneBoundary>
  );
}

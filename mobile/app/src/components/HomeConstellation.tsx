import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as THREE from "three";
import { ChevronLeftIcon } from "@vorinthex/shared/ui/icons-mobile";

import {
  CAPABILITY_CAROUSEL_HEIGHT,
  CapabilityArcCarousel,
} from "@/components/CapabilityArcCarousel";
import { CapabilityDrawer } from "@/components/CapabilityDrawer";
import {
  capabilityPositions,
  clampSystemPitch,
  galaxyCamera,
  systemRotation,
} from "@/components/galaxy/galaxy-refs";
import { GalaxyScene } from "@/components/galaxy/GalaxyScene";
import { InteriorEmblem } from "@/components/InteriorEmblem";
import { PressableScale } from "@/components/PressableScale";
import {
  CAPABILITIES,
  type Capability,
  type CapabilitySlug,
} from "@/data/registry";
import { useGalaxyStore } from "@/state/galaxy";

const CAROUSEL_OVERLAP = 30;
/** Full-width horizontal swipe spins the system a bit more than half a turn. */
const YAW_PER_WIDTH = Math.PI * 1.15;
/** Full-height vertical swipe covers the whole tilt range. */
const PITCH_PER_HEIGHT = 2.2;
/** Screen-space radius (dp) a tap may land from a planet's center. */
const PLANET_TAP_RADIUS = 44;

const scratchProjection = new THREE.Vector3();

export type HomeConstellationProps = {
  enabledSlugs: readonly CapabilitySlug[];
  onOpen: (slug: CapabilitySlug) => void;
};

/**
 * The brain galaxy steered by the wrapped cube carousel AND the field
 * itself: pans rotate the solar system (horizontal = spin, vertical =
 * tilt), a tap on a planet dives into it, and swiping the carousel commits
 * a capability the same way. Once inside a biome the scene takes the whole
 * screen — no header, no carousel — with the back chevron (and the Android
 * hardware back) returning to orbit.
 */
export function HomeConstellation({
  enabledSlugs,
  onOpen,
}: HomeConstellationProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const width = Math.min(screenWidth - 16, 390);
  const fieldHeight = Math.max(270, Math.min(450, screenHeight - 310));
  const capabilities = useMemo(
    () =>
      CAPABILITIES.filter((capability) =>
        enabledSlugs.includes(capability.slug),
      ),
    [enabledSlugs],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  const phase = useGalaxyStore((state) => state.phase);
  const targetSlug = useGalaxyStore((state) => state.targetSlug);
  const enter = useGalaxyStore((state) => state.enter);
  const retarget = useGalaxyStore((state) => state.retarget);
  const warp = useGalaxyStore((state) => state.warp);
  const exit = useGalaxyStore((state) => state.exit);

  // The GL surface is resized only while the veil is fully dark: expansion
  // lands at "inside" (after the enter blackout), shrink at "overview"
  // (after the exit blackout) — so "exit" keeps the immersive layout.
  const immersed = phase === "inside" || phase === "exit";
  const carouselShown =
    (phase === "overview" || phase === "fly") && capabilities.length > 0;

  useEffect(() => {
    if (selectedIndex >= capabilities.length) setSelectedIndex(0);
  }, [capabilities.length, selectedIndex]);

  // Android hardware back mirrors the chevron anywhere off the overview.
  useEffect(() => {
    if (Platform.OS !== "android" || phase === "overview") return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        exit();
        return true;
      },
    );
    return () => subscription.remove();
  }, [exit, phase]);

  const selected = capabilities[selectedIndex];
  const targetCapability =
    capabilities.find((capability) => capability.slug === targetSlug) ?? null;
  const open = (capability: Capability) => onOpen(capability.slug);

  const select = useCallback(
    (index: number) => {
      setSelectedIndex(index);
      const capability = capabilities[index];
      if (!capability) return;
      const current = useGalaxyStore.getState().phase;
      if (current === "overview") {
        enter(capability.slug);
      } else if (current === "fly") {
        retarget(capability.slug);
      } else {
        warp(capability.slug);
      }
    },
    [capabilities, enter, retarget, warp],
  );

  const fieldWidth = immersed ? screenWidth : width;
  const fieldHeightNow = immersed ? screenHeight : fieldHeight;

  // Stable across renders so the memoized gestures never go stale — a
  // gesture rebuilt mid-swipe has crashed native before.
  const gestureStateRef = useRef({
    capabilities,
    fieldHeight: fieldHeightNow,
    fieldWidth,
    select,
  });
  gestureStateRef.current = {
    capabilities,
    fieldHeight: fieldHeightNow,
    fieldWidth,
    select,
  };
  const panStartRef = useRef({ yaw: 0, pitch: 0 });

  const fieldGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .minDistance(10)
      .onStart(() => {
        panStartRef.current = {
          yaw: systemRotation.yaw,
          pitch: systemRotation.pitch,
        };
      })
      .onChange((event) => {
        if (useGalaxyStore.getState().phase !== "overview") return;
        const state = gestureStateRef.current;
        systemRotation.yaw =
          panStartRef.current.yaw +
          (event.translationX / state.fieldWidth) * YAW_PER_WIDTH;
        systemRotation.pitch = clampSystemPitch(
          panStartRef.current.pitch +
            (event.translationY / state.fieldHeight) * PITCH_PER_HEIGHT,
        );
      })
      .onEnd((event) => {
        if (useGalaxyStore.getState().phase !== "overview") return;
        const state = gestureStateRef.current;
        // A little momentum: the fling keeps carrying, the rig damps it out.
        systemRotation.yaw +=
          (event.velocityX / state.fieldWidth) * YAW_PER_WIDTH * 0.12;
        systemRotation.pitch = clampSystemPitch(
          systemRotation.pitch +
            (event.velocityY / state.fieldHeight) * PITCH_PER_HEIGHT * 0.12,
        );
      });

    const tap = Gesture.Tap()
      .runOnJS(true)
      .maxDuration(320)
      .onEnd((event) => {
        if (useGalaxyStore.getState().phase !== "overview") return;
        const camera = galaxyCamera.current;
        const state = gestureStateRef.current;
        if (!camera) return;
        // Project every live planet position into field pixels and dive
        // into the nearest one within thumb range.
        let bestSlug: CapabilitySlug | null = null;
        let bestDistance = PLANET_TAP_RADIUS;
        for (const capability of state.capabilities) {
          const world = capabilityPositions.get(capability.slug);
          if (!world) continue;
          const projected = scratchProjection.copy(world).project(camera);
          if (projected.z > 1 || projected.z < -1) continue;
          const px = ((projected.x + 1) / 2) * state.fieldWidth;
          const py = ((1 - projected.y) / 2) * state.fieldHeight;
          const distance = Math.hypot(px - event.x, py - event.y);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestSlug = capability.slug;
          }
        }
        if (!bestSlug) return;
        const index = state.capabilities.findIndex(
          (capability) => capability.slug === bestSlug,
        );
        if (index >= 0) state.select(index);
      });

    return Gesture.Race(pan, tap);
  }, []);

  return (
    <View
      style={
        immersed
          ? styles.rootImmersed
          : [styles.root, { width, height: fieldHeight + 154 }]
      }
    >
      <GestureDetector gesture={fieldGesture}>
        <View
          collapsable={false}
          style={[
            styles.field,
            immersed ? styles.fieldImmersed : { width, height: fieldHeight },
          ]}
        >
          <GalaxyScene
            enabledSlugs={enabledSlugs}
            selectedSlug={selected?.slug ?? null}
            style={StyleSheet.absoluteFill}
          />
          <InteriorEmblem capability={targetCapability} />
          <CapabilityDrawer capability={targetCapability} />
          {phase !== "overview" ? (
            <View
              style={[
                styles.backButton,
                { top: immersed ? insets.top + 8 : 10 },
              ]}
            >
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Return to orbit"
                hitSlop={12}
                onPress={exit}
                style={styles.backPress}
              >
                <ChevronLeftIcon size="md" variant="accent" />
              </PressableScale>
            </View>
          ) : null}
        </View>
      </GestureDetector>

      {carouselShown ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.carousel,
            {
              top: fieldHeight - CAROUSEL_OVERLAP,
              height: CAPABILITY_CAROUSEL_HEIGHT,
            },
          ]}
        >
          <CapabilityArcCarousel
            capabilities={capabilities}
            selectedIndex={selectedIndex}
            width={width}
            onOpen={open}
            onSelect={select}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: "center",
  },
  rootImmersed: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  field: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  fieldImmersed: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  carousel: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  backButton: {
    position: "absolute",
    left: 10,
    zIndex: 30,
  },
  backPress: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(221, 226, 229, 0.18)",
    backgroundColor: "rgba(3, 5, 7, 0.55)",
  },
});

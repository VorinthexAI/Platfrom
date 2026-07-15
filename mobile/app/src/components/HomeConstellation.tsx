import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as THREE from "three";
import { ChevronLeftIcon, VolumeIcon } from "@vorinthex/shared/ui/icons-mobile";

import {
  CAPABILITY_CAROUSEL_HEIGHT,
  CapabilityArcCarousel,
} from "@/components/CapabilityArcCarousel";
import { CapabilityDrawer } from "@/components/CapabilityDrawer";
import {
  capabilityPositions,
  galaxyCamera,
  SYSTEM_PITCH_LIMIT,
  systemDragging,
  systemPitch,
  systemPitchLive,
  systemYaw,
  systemYawLive,
} from "@/components/galaxy/galaxy-refs";
import { GalaxyScene } from "@/components/galaxy/GalaxyScene";
import { InteriorEmblem } from "@/components/InteriorEmblem";
import { PressableScale } from "@/components/PressableScale";
import {
  CAPABILITIES,
  type Capability,
  type CapabilitySlug,
} from "@/data/registry";
import { useAppAudio } from "@/lib/app-audio";
import { useGalaxyStore } from "@/state/galaxy";

/** Full-width horizontal swipe spins the system well past half a turn. */
const YAW_PER_WIDTH = Math.PI * 1.35;
/** Full-height vertical swipe covers the whole tilt range. */
const PITCH_PER_HEIGHT = 2.6;
/** How much of the release velocity carries on as momentum. */
const FLING_CARRY = 0.18;
/** Screen-space radius (dp) a tap may land from a planet's center. */
const PLANET_TAP_RADIUS = 44;

const scratchProjection = new THREE.Vector3();

export type HomeConstellationProps = {
  enabledSlugs: readonly CapabilitySlug[];
  onOpen: (slug: CapabilitySlug) => void;
};

/**
 * The brain galaxy, rendered FULLSCREEN at all times — the header and
 * carousel float over it as transparent overlays, so orbits pass behind
 * them. Pans rotate the solar system (horizontal = spin, vertical = tilt),
 * a tap on a planet dives into it, and swiping the carousel commits a
 * capability the same way. Inside a biome the overlays go away and the
 * back chevron (and Android hardware back) returns to orbit.
 */
export function HomeConstellation({
  enabledSlugs,
  onOpen,
}: HomeConstellationProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const carouselWidth = Math.min(screenWidth - 16, 390);
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

  // Arriving inside a biome auto-plays its briefing (over the still-running
  // soundtrack); returning to orbit lets it go quiet again. Warping biome
  // to biome re-fires with the new target. Depends ONLY on the transition —
  // going through a ref keeps a naturally-finished briefing from
  // restarting itself.
  const audio = useAppAudio();
  const audioRef = useRef(audio);
  audioRef.current = audio;
  useEffect(() => {
    if (phase === "inside" && targetSlug) {
      audioRef.current.playBriefing(targetSlug);
    } else if (phase === "overview") {
      audioRef.current.stopBriefing();
    }
  }, [phase, targetSlug]);

  const selected = capabilities[selectedIndex];
  const targetCapability =
    capabilities.find((capability) => capability.slug === targetSlug) ?? null;
  const open = useCallback(
    (capability: Capability) => onOpen(capability.slug),
    [onOpen],
  );

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

  // Stable across renders so the memoized gestures never go stale — a
  // gesture rebuilt mid-swipe has crashed native before.
  const gestureStateRef = useRef({
    capabilities,
    fieldHeight: screenHeight,
    fieldWidth: screenWidth,
    select,
  });
  gestureStateRef.current = {
    capabilities,
    fieldHeight: screenHeight,
    fieldWidth: screenWidth,
    select,
  };

  // UI-thread mirrors for the pan worklet — it must never hop to the JS
  // thread (that queue is busy rendering frames, and hopping made swipes
  // feel dead unless they were slow and axis-aligned).
  const panEnabled = useSharedValue(phase === "overview" ? 1 : 0);
  const fieldSize = useSharedValue({ width: screenWidth, height: screenHeight });
  const panStartYaw = useSharedValue(0);
  const panStartPitch = useSharedValue(0);
  useEffect(() => {
    panEnabled.value = phase === "overview" ? 1 : 0;
  }, [panEnabled, phase]);
  useEffect(() => {
    fieldSize.value = { width: screenWidth, height: screenHeight };
  }, [fieldSize, screenHeight, screenWidth]);

  // Stable identity (the memoized tap worklet captures it): projects every
  // live planet position into field pixels and dives into the nearest one
  // within thumb range.
  const handleFieldTap = useCallback((tapX: number, tapY: number) => {
    if (useGalaxyStore.getState().phase !== "overview") return;
    const camera = galaxyCamera.current;
    const state = gestureStateRef.current;
    if (!camera) return;
    let bestSlug: CapabilitySlug | null = null;
    let bestDistance = PLANET_TAP_RADIUS;
    for (const capability of state.capabilities) {
      const world = capabilityPositions.get(capability.slug);
      if (!world) continue;
      const projected = scratchProjection.copy(world).project(camera);
      if (projected.z > 1 || projected.z < -1) continue;
      const px = ((projected.x + 1) / 2) * state.fieldWidth;
      const py = ((1 - projected.y) / 2) * state.fieldHeight;
      const distance = Math.hypot(px - tapX, py - tapY);
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
  }, []);

  const fieldGesture = useMemo(() => {
    // Pure worklet pan: every event lands on the UI thread and writes the
    // rotation targets directly — any direction, any speed, no waiting on
    // the JS thread.
    const pan = Gesture.Pan()
      .minDistance(6)
      .onStart(() => {
        if (!panEnabled.value) return;
        // GRAB the rendered orientation and kill leftover momentum — a
        // finger on the glass stops the globe instantly; without this a
        // re-swipe fights the previous fling's still-gliding target and
        // feels stuck for seconds. While dragging the rig applies the
        // targets verbatim (no damping), so the field is glued to the
        // finger.
        panStartYaw.value = systemYawLive.value;
        panStartPitch.value = systemPitchLive.value;
        systemYaw.value = systemYawLive.value;
        systemPitch.value = systemPitchLive.value;
        systemDragging.value = 1;
      })
      .onChange((event) => {
        if (!panEnabled.value) return;
        const size = fieldSize.value;
        systemYaw.value =
          panStartYaw.value + (event.translationX / size.width) * YAW_PER_WIDTH;
        const pitch =
          panStartPitch.value +
          (event.translationY / size.height) * PITCH_PER_HEIGHT;
        systemPitch.value = Math.max(
          -SYSTEM_PITCH_LIMIT,
          Math.min(SYSTEM_PITCH_LIMIT, pitch),
        );
      })
      .onEnd((event) => {
        if (!panEnabled.value) return;
        const size = fieldSize.value;
        // Momentum: the fling keeps carrying, the rig damps it out.
        systemYaw.value +=
          (event.velocityX / size.width) * YAW_PER_WIDTH * FLING_CARRY;
        const pitch =
          systemPitch.value +
          (event.velocityY / size.height) * PITCH_PER_HEIGHT * FLING_CARRY;
        systemPitch.value = Math.max(
          -SYSTEM_PITCH_LIMIT,
          Math.min(SYSTEM_PITCH_LIMIT, pitch),
        );
      })
      .onFinalize(() => {
        // Covers end AND cancellation — the rig must never stay glued.
        systemDragging.value = 0;
      });

    // The hit test needs the JS world (store, camera, THREE math), so the
    // worklet schedules it across with scheduleOnRN (the react-native-
    // worklets successor to Reanimated's deprecated JS-scheduling API).
    const tap = Gesture.Tap()
      .maxDuration(320)
      .onEnd((event) => {
        scheduleOnRN(handleFieldTap, event.x, event.y);
      });

    return Gesture.Race(pan, tap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.root}>
      <GestureDetector gesture={fieldGesture}>
        <View collapsable={false} style={styles.field}>
          <GalaxyScene
            enabledSlugs={enabledSlugs}
            selectedSlug={selected?.slug ?? null}
            style={StyleSheet.absoluteFill}
          />
          <InteriorEmblem capability={targetCapability} />
          <CapabilityDrawer capability={targetCapability} onOpen={open} />
          {phase !== "overview" ? (
            <View style={[styles.backButton, { top: insets.top + 8 }]}>
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
          {phase === "inside" && targetCapability ? (
            // The biome's voice control — the round header sibling of the
            // back chevron. Icon only; arrival auto-plays the briefing, so
            // this mostly reads as "mute".
            <View style={[styles.voiceButton, { top: insets.top + 8 }]}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={
                  audio.playingBriefing === targetCapability.slug
                    ? `Stop ${targetCapability.name} briefing`
                    : `Play ${targetCapability.name} briefing`
                }
                hitSlop={12}
                onPress={() => audio.toggleBriefing(targetCapability.slug)}
                style={[
                  styles.backPress,
                  audio.playingBriefing === targetCapability.slug
                    ? styles.voicePressLive
                    : null,
                ]}
              >
                <VolumeIcon size="md" variant="accent" />
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
              bottom: insets.bottom + 6,
              height: CAPABILITY_CAROUSEL_HEIGHT,
            },
          ]}
        >
          <CapabilityArcCarousel
            capabilities={capabilities}
            selectedIndex={selectedIndex}
            width={carouselWidth}
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
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  field: {
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
    alignItems: "center",
  },
  backButton: {
    position: "absolute",
    left: 10,
    zIndex: 30,
  },
  voiceButton: {
    position: "absolute",
    right: 10,
    zIndex: 30,
  },
  voicePressLive: {
    borderColor: "rgba(221, 226, 229, 0.42)",
    backgroundColor: "rgba(12, 16, 19, 0.7)",
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

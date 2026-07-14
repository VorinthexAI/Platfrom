import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { ChevronLeftIcon } from "@vorinthex/shared/ui/icons-mobile";

import {
  CAPABILITY_CAROUSEL_HEIGHT,
  CapabilityArcCarousel,
} from "@/components/CapabilityArcCarousel";
import { CapabilityDrawer } from "@/components/CapabilityDrawer";
import { GalaxyScene } from "@/components/galaxy/GalaxyScene";
import { PressableScale } from "@/components/PressableScale";
import { TransitionVeil } from "@/components/TransitionVeil";
import {
  CAPABILITIES,
  type Capability,
  type CapabilitySlug,
} from "@/data/registry";
import { useGalaxyStore } from "@/state/galaxy";
import { durations } from "@/theme/motion";

const CAROUSEL_OVERLAP = 30;

export type HomeConstellationProps = {
  enabledSlugs: readonly CapabilitySlug[];
  onOpen: (slug: CapabilitySlug) => void;
};

/**
 * The brain galaxy steered by the wrapped cube carousel: swiping commits a
 * capability and dives the camera into its biome (first swipe flies in,
 * later swipes warp biome to biome, the back chevron returns to orbit).
 */
export function HomeConstellation({
  enabledSlugs,
  onOpen,
}: HomeConstellationProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
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

  useEffect(() => {
    if (selectedIndex >= capabilities.length) setSelectedIndex(0);
  }, [capabilities.length, selectedIndex]);

  const selected = capabilities[selectedIndex];
  const targetCapability =
    capabilities.find((capability) => capability.slug === targetSlug) ?? null;
  const open = (capability: Capability) => onOpen(capability.slug);

  const select = (index: number) => {
    setSelectedIndex(index);
    const capability = capabilities[index];
    if (!capability) return;
    if (phase === "overview") {
      enter(capability.slug);
    } else if (phase === "fly") {
      retarget(capability.slug);
    } else {
      warp(capability.slug);
    }
  };

  return (
    <View style={[styles.root, { width, height: fieldHeight + 154 }]}>
      <View style={[styles.field, { width, height: fieldHeight }]}>
        <GalaxyScene
          enabledSlugs={enabledSlugs}
          selectedSlug={selected?.slug ?? null}
          style={StyleSheet.absoluteFill}
        />
        <TransitionVeil />
        <CapabilityDrawer capability={targetCapability} />
        {phase !== "overview" ? (
          <Animated.View
            entering={FadeIn.duration(durations.base)}
            exiting={FadeOut.duration(durations.fast)}
            style={styles.backButton}
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
          </Animated.View>
        ) : null}
      </View>

      {capabilities.length > 0 ? (
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
  field: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  carousel: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  backButton: {
    position: "absolute",
    top: 10,
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

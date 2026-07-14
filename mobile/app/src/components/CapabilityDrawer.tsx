import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { VolumeIcon } from "@vorinthex/shared/ui/icons-mobile";

import { BrandButton } from "@/components/BrandButton";
import { ChromeIcon } from "@/components/ChromeIcon";
import { ChromePanel } from "@/components/ChromePanel";
import { PressableScale } from "@/components/PressableScale";
import { capabilityIconSource } from "@/data/capability-icons";
import type { Capability } from "@/data/registry";
import { useAppAudio } from "@/lib/app-audio";
import { useGalaxyStore } from "@/state/galaxy";
import { easings, springs } from "@/theme/motion";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";

const SLIDE_IN_MS = 650;
const SLIDE_OUT_MS = 600;
const CLOSE_DISTANCE = 70;
const CLOSE_VELOCITY = 500;
const OFFSCREEN = 420;

type CapabilityDrawerProps = {
  capability: Capability | null;
};

/**
 * The web ProductDrawer, as it behaves for mobile web visitors: once the
 * camera is inside a biome, a chrome bottom sheet slides up with the
 * capability's identity and briefing. Dragging it down (or the X) closes
 * the drawer and leaves the world — same contract as the web.
 */
export function CapabilityDrawer({ capability }: CapabilityDrawerProps) {
  const phase = useGalaxyStore((state) => state.phase);
  const exit = useGalaxyStore((state) => state.exit);
  const { playingBriefing, toggleBriefing } = useAppAudio();

  const open = phase === "inside" && capability !== null;
  const [rendered, setRendered] = useState(open);
  const translateY = useSharedValue(OFFSCREEN);

  useEffect(() => {
    if (open) {
      setRendered(true);
      translateY.value = withTiming(0, {
        duration: SLIDE_IN_MS,
        easing: easings.luxury,
      });
      return;
    }
    translateY.value = withTiming(
      OFFSCREEN,
      { duration: SLIDE_OUT_MS, easing: Easing.inOut(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(setRendered)(false);
      },
    );
  }, [open, translateY]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-14, 8])
        .onChange((event) => {
          // Elastic downward drag only (web dragElastic bottom: 0.55).
          translateY.value = Math.max(0, event.translationY) * 0.55;
        })
        .onEnd((event) => {
          if (
            event.translationY > CLOSE_DISTANCE ||
            event.velocityY > CLOSE_VELOCITY
          ) {
            runOnJS(exit)();
          } else {
            translateY.value = withSpring(0, springs.snapBack);
          }
        }),
    [exit, translateY],
  );

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!rendered || !capability) return null;

  const briefingPlaying = playingBriefing === capability.slug;

  return (
    <Animated.View
      accessibilityViewIsModal
      style={[styles.root, slideStyle]}
    >
      <GestureDetector gesture={pan}>
        <ChromePanel radius={radii.xl} style={styles.panel}>
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Close and return to orbit"
            hitSlop={10}
            onPress={exit}
            style={styles.close}
          >
            <Text style={styles.closeGlyph}>{"×"}</Text>
          </PressableScale>

          <View style={styles.header}>
            <View style={styles.logoRing}>
              <ChromeIcon
                source={capabilityIconSource[capability.slug]}
                size={30}
                glow={0.3}
              />
            </View>
            <Text style={styles.name}>{capability.name.toUpperCase()}</Text>
          </View>
          <Text style={styles.tagline}>
            {capability.tagline.replace("\n", " ").toUpperCase()}
          </Text>
          <Text style={styles.body}>{capability.onboardingDescription}</Text>

          <BrandButton
            accessibilityLabel={`${briefingPlaying ? "Stop" : "Play"} ${capability.name} briefing`}
            compact
            icon={<VolumeIcon size="sm" variant="inverse" />}
            label={briefingPlaying ? "Stop Briefing" : "Play Briefing"}
            onPress={() => toggleBriefing(capability.slug)}
            style={styles.briefing}
            variant="primary"
          />
        </ChromePanel>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    zIndex: 25,
  },
  panel: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  handleRow: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
  close: {
    position: "absolute",
    top: 12,
    right: 14,
    zIndex: 1,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(255, 255, 255, 0.025)",
  },
  closeGlyph: {
    color: palette.silver500,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 18,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  logoRing: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  name: {
    color: palette.silver50,
    fontFamily: fonts.medium,
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 4.3,
  },
  tagline: {
    marginTop: 6,
    color: palette.silver500,
    fontFamily: fonts.medium,
    fontSize: 8.5,
    lineHeight: 12,
    letterSpacing: tracking.micro,
  },
  body: {
    marginTop: 10,
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  briefing: {
    marginTop: 14,
    alignSelf: "flex-start",
  },
});

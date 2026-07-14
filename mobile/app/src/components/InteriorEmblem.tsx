import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { ChromeIcon } from "@/components/ChromeIcon";
import { capabilityIconSource } from "@/data/capability-icons";
import type { Capability } from "@/data/registry";
import { useGalaxyStore } from "@/state/galaxy";
import { fonts, palette, tracking } from "@/theme/tokens";

/**
 * Screen-space port of the web biome's heart: the world's chrome emblem
 * with its clear name underneath, alive with the same pulse-and-bob the
 * web InteriorEmblem runs in 3D. Pure repeating UI-thread animations —
 * no completion callbacks (worklet→JS trampolines racing unmounts have
 * segfaulted Android before).
 */
export function InteriorEmblem({ capability }: { capability: Capability | null }) {
  const phase = useGalaxyStore((state) => state.phase);
  const visitSeed = useGalaxyStore((state) => state.visitSeed);
  // Keep showing through "exit" — the veil closes over it.
  const shown = (phase === "inside" || phase === "exit") && capability !== null;

  if (!shown || !capability) return null;

  return <EmblemBody key={`${capability.slug}-${visitSeed}`} capability={capability} />;
}

function EmblemBody({ capability }: { capability: Capability }) {
  const opacity = useSharedValue(0);
  const pulse = useSharedValue(0);
  const bob = useSharedValue(0);

  useEffect(() => {
    // Web parity: fade in 0.8s after a 0.4s beat, then pulse forever.
    opacity.value = withDelay(
      400,
      withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) }),
    );
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    bob.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, [bob, opacity, pulse]);

  const blockStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: (bob.value - 0.5) * 14 },
      { scale: 1 + pulse.value * 0.05 },
    ],
  }));

  const nameStyle = useAnimatedStyle(() => ({
    opacity: 0.72 + pulse.value * 0.28,
  }));

  return (
    <View pointerEvents="none" style={styles.root}>
      <Animated.View style={[styles.block, blockStyle]}>
        <ChromeIcon
          source={capabilityIconSource[capability.slug]}
          size={118}
          glow={0.8}
        />
        <Animated.Text style={[styles.name, nameStyle]}>
          {capability.name.toUpperCase()}
        </Animated.Text>
        <Text style={styles.subtitle}>AI BRAIN CAPABILITY</Text>
      </Animated.View>
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
    alignItems: "center",
    justifyContent: "center",
    // Sit above the canvas, below the drawer and veil.
    zIndex: 15,
  },
  block: {
    alignItems: "center",
    // The drawer claims the lower third — float the emblem above center.
    marginBottom: 150,
  },
  name: {
    marginTop: 22,
    color: palette.silver50,
    fontFamily: fonts.light,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: 7,
    textAlign: "center",
  },
  subtitle: {
    marginTop: 8,
    color: palette.silver500,
    fontFamily: fonts.medium,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: tracking.micro,
    textAlign: "center",
  },
});

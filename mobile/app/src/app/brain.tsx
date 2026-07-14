import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsIcon } from "@vorinthex/shared/ui/icons-mobile";

import { HomeConstellation } from "@/components/HomeConstellation";
import { PressableScale } from "@/components/PressableScale";
import { TransitionVeil } from "@/components/TransitionVeil";
import { MOCK_USER, greetingForHour } from "@/data/mock";
import { CAPABILITIES, type CapabilitySlug } from "@/data/registry";
import { useGalaxyStore } from "@/state/galaxy";
import { useOnboardingStore } from "@/state/onboarding";
import { durations } from "@/theme/motion";
import { fonts, palette, spacing } from "@/theme/tokens";

/** The AI brain home screen — capabilities orbit the neural core. */
export default function BrainRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const phase = useGalaxyStore((state) => state.phase);
  // Inside a biome the scene owns the WHOLE screen: no header, no padding.
  // The swap happens while the TransitionVeil below is fully dark.
  const immersed = phase === "inside" || phase === "exit";
  const greeting = greetingForHour(new Date().getHours());
  const decisions = useOnboardingStore((state) => state.decisions);
  const enabledSlugs = useMemo(
    () =>
      CAPABILITIES.filter(
        (capability) => decisions[capability.slug] === "enabled",
      ).map((capability) => capability.slug),
    [decisions],
  );
  const fullName = `${MOCK_USER.firstName}.`;
  const [typedCharacters, setTypedCharacters] = useState(0);
  const totalCharacters = greeting.length + fullName.length;

  useEffect(() => {
    const timer = setInterval(() => {
      setTypedCharacters((current) => {
        if (current >= totalCharacters) {
          clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, 55);
    return () => clearInterval(timer);
  }, [totalCharacters]);

  const typedGreeting = greeting.slice(0, typedCharacters);
  const typedName = fullName.slice(
    0,
    Math.max(0, typedCharacters - greeting.length),
  );

  const openCapability = useCallback(
    (slug: CapabilitySlug) => {
      router.push({ pathname: "/capability/[slug]", params: { slug } });
    },
    [router],
  );

  return (
    <View style={styles.root}>
      {/* The galaxy owns the whole screen; every overlay floats above it. */}
      <HomeConstellation enabledSlugs={enabledSlugs} onOpen={openCapability} />

      {immersed ? null : (
        <Animated.View
          entering={FadeInDown.duration(durations.base)}
          // Transparent overlay — orbits pass BEHIND the greeting; empty
          // header space stays swipeable (box-none), only the texts and
          // the settings button catch touches.
          pointerEvents="box-none"
          style={[styles.header, { paddingTop: insets.top + 10 }]}
        >
          <View pointerEvents="none">
            <Text style={styles.greeting}>{typedGreeting}</Text>
            <Text style={styles.name}>{typedName}</Text>
          </View>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Settings"
            style={styles.settingsButton}
          >
            <SettingsIcon size="md" variant="accent" />
          </PressableScale>
        </Animated.View>
      )}

      {/* Route-level veil: covers header AND scene, so every teleport
          happens in total darkness. */}
      <TransitionVeil />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.page,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
  },
  greeting: {
    minHeight: 18,
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
  name: {
    minHeight: 31,
    marginTop: 2,
    color: palette.silver50,
    fontFamily: fonts.semibold,
    fontSize: 24,
  },
  settingsButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(221, 226, 229, 0.18)",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
  },
});

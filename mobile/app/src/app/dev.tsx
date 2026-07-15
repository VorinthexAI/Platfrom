import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { HomeConstellation } from "@/components/HomeConstellation";
import { TransitionVeil } from "@/components/TransitionVeil";
import { CAPABILITIES, capabilitySlugSchema } from "@/data/registry";
import { useGalaxyStore } from "@/state/galaxy";
import { palette } from "@/theme/tokens";

const ALL_SLUGS = CAPABILITIES.map((capability) => capability.slug);

/**
 * Hidden verification route: brain home with every capability enabled.
 * `?dive=<slug>` auto-enters that biome after 4s (headless screenshots
 * can't swipe the carousel). `?caps=<n>` limits how many capabilities are
 * enabled — for checking the carousel's small-count behavior.
 */
export default function DevRoute() {
  const { dive, caps } = useLocalSearchParams<{ dive?: string; caps?: string }>();
  const enter = useGalaxyStore((state) => state.enter);

  useEffect(() => {
    const parsed = capabilitySlugSchema.safeParse(dive);
    if (!parsed.success) return;
    const timer = setTimeout(() => enter(parsed.data), 4000);
    return () => clearTimeout(timer);
  }, [dive, enter]);

  const capCount = Number(caps);
  const enabledSlugs =
    Number.isInteger(capCount) && capCount > 0
      ? ALL_SLUGS.slice(0, capCount)
      : ALL_SLUGS;

  return (
    <View style={styles.root}>
      <HomeConstellation enabledSlugs={enabledSlugs} onOpen={() => {}} />
      {/* Drives the enter/exit phase hand-offs — must be mounted here too. */}
      <TransitionVeil />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.page,
  },
});

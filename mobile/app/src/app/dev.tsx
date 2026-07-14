import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HomeConstellation } from "@/components/HomeConstellation";
import { CAPABILITIES, capabilitySlugSchema } from "@/data/registry";
import { useGalaxyStore } from "@/state/galaxy";
import { palette } from "@/theme/tokens";

const ALL_SLUGS = CAPABILITIES.map((capability) => capability.slug);

/**
 * Hidden verification route: brain home with every capability enabled.
 * `?dive=<slug>` auto-enters that biome after 4s (headless screenshots
 * can't swipe the carousel).
 */
export default function DevRoute() {
  const insets = useSafeAreaInsets();
  const { dive } = useLocalSearchParams<{ dive?: string }>();
  const enter = useGalaxyStore((state) => state.enter);

  useEffect(() => {
    const parsed = capabilitySlugSchema.safeParse(dive);
    if (!parsed.success) return;
    const timer = setTimeout(() => enter(parsed.data), 4000);
    return () => clearTimeout(timer);
  }, [dive, enter]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
      <HomeConstellation enabledSlugs={ALL_SLUGS} onOpen={() => {}} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: palette.page,
  },
});

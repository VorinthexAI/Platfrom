import { useRouter } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsIcon } from "@vorinthex/shared/ui/icons-mobile";

import { HomeConstellation } from "@/components/HomeConstellation";
import { PressableScale } from "@/components/PressableScale";
import { MOCK_USER, greetingForHour } from "@/data/mock";
import type { CapabilitySlug } from "@/data/registry";
import { durations } from "@/theme/motion";
import { fonts, palette, spacing } from "@/theme/tokens";

/** The AI brain home screen — capabilities orbit the neural core. */
export default function BrainRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const greeting = greetingForHour(new Date().getHours());

  const openCapability = useCallback(
    (slug: CapabilitySlug) => {
      router.push({ pathname: "/capability/[slug]", params: { slug } });
    },
    [router],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
      <Animated.View entering={FadeInDown.duration(durations.base)} style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.name}>{MOCK_USER.firstName}.</Text>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Settings"
          style={styles.settingsButton}
        >
          <SettingsIcon size="md" variant="accent" />
        </PressableScale>
      </Animated.View>

      <View style={styles.constellationWrap}>
        <HomeConstellation onOpen={openCapability} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.page,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  greeting: {
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
  name: {
    marginTop: 2,
    color: palette.silver50,
    fontFamily: fonts.semibold,
    fontSize: 24,
  },
  settingsButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  constellationWrap: {
    flex: 1,
    justifyContent: "center",
    paddingBottom: 24,
  },
});

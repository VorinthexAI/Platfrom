import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeftIcon } from "@vorinthex/shared/ui/icons-mobile";

import { ChromeIcon } from "@/components/ChromeIcon";
import { NeuralField } from "@/components/NeuralField";
import { PressableScale } from "@/components/PressableScale";
import { SearchBar } from "@/components/SearchBar";
import { capabilityIconSource } from "@/data/capability-icons";
import type { Capability } from "@/data/registry";
import { durations } from "@/theme/motion";
import { fonts, palette, spacing, tracking } from "@/theme/tokens";

const HERO_HEIGHT = 190;

export type CapabilityShellProps = {
  capability: Capability;
  children: ReactNode;
};

/**
 * Reusable capability screen shell: back chevron + uppercase title,
 * chrome hero icon over a neural filament field, tagline, search,
 * then capability-specific content.
 */
export function CapabilityShell({ capability, children }: CapabilityShellProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  return (
    <View style={[styles.root, { paddingTop: insets.top + 6 }]}>
      <View style={styles.header}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back to your brain"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <ChevronLeftIcon size="md" variant="accent" />
        </PressableScale>
        <Text style={styles.title}>{capability.name.toUpperCase()}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeIn.duration(durations.reveal)} style={styles.hero}>
          <NeuralField
            width={width}
            height={HERO_HEIGHT}
            seed={capability.slug.length * 13 + 5}
            nodeCount={34}
            pulseCount={4}
            style={styles.heroField}
          />
          <ChromeIcon source={capabilityIconSource[capability.slug]} size={96} glow={0.7} />
        </Animated.View>

        <Animated.Text
          entering={FadeInDown.delay(120).duration(durations.base)}
          style={styles.tagline}
        >
          {capability.tagline}
        </Animated.Text>

        <Animated.View entering={FadeInDown.delay(200).duration(durations.base)}>
          <SearchBar placeholder={capability.searchPlaceholder} style={styles.search} />
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(280).duration(durations.base)}
          style={styles.content}
        >
          {capability.sectionLabel ? (
            <Text style={styles.sectionLabel}>{capability.sectionLabel.toUpperCase()}</Text>
          ) : null}
          {children}
        </Animated.View>
      </ScrollView>
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
    alignItems: "center",
    paddingHorizontal: spacing.md,
    height: 48,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    textAlign: "center",
    color: palette.silver100,
    fontFamily: fonts.medium,
    fontSize: 15,
    letterSpacing: tracking.label,
    paddingLeft: tracking.label,
  },
  headerSpacer: {
    width: 40,
  },
  scroll: {
    paddingTop: 4,
  },
  hero: {
    height: HERO_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  heroField: {
    position: "absolute",
    top: 0,
    left: 0,
    opacity: 0.7,
  },
  tagline: {
    marginTop: 6,
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  search: {
    marginTop: 24,
    marginHorizontal: spacing.lg,
  },
  content: {
    marginTop: 28,
    paddingHorizontal: spacing.lg,
    gap: 10,
  },
  sectionLabel: {
    color: palette.silver500,
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: tracking.micro,
    marginBottom: 4,
  },
});

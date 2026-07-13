import { StyleSheet, Text, View } from "react-native";

import { ChromeIcon } from "@/components/ChromeIcon";
import { ProgressDots } from "@/components/ProgressDots";
import { capabilityIconSource } from "@/data/capability-icons";
import type { Capability } from "@/data/registry";
import { CAPABILITIES } from "@/data/registry";
import { fonts, palette, radii, tracking } from "@/theme/tokens";

export type OnboardingCardProps = {
  capability: Capability;
  index: number;
  width: number;
  height: number;
};

/**
 * Obsidian onboarding card: chrome icon in the upper section, uppercase
 * capability name, concise description, monochrome progress marker.
 * Thin neutral chrome border, subtle inset highlight, deep soft shadow.
 */
export function OnboardingCard({ capability, index, width, height }: OnboardingCardProps) {
  return (
    <View style={[styles.card, { width, height }]}>
      <View style={styles.insetHighlight} />
      <View style={styles.content}>
        <ChromeIcon
          source={capabilityIconSource[capability.slug]}
          size={Math.round(width * 0.42)}
          glow={0.6}
        />
        <Text style={styles.name}>{capability.name.toUpperCase()}</Text>
        <Text style={styles.description}>{capability.onboardingDescription}</Text>
      </View>
      <ProgressDots count={CAPABILITIES.length} activeIndex={index} style={styles.dots} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#0B0F15",
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: "rgba(221, 226, 229, 0.16)",
    overflow: "hidden",
    shadowColor: palette.voidBlack,
    shadowOpacity: 0.6,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 24 },
    elevation: 14,
  },
  insetHighlight: {
    position: "absolute",
    top: 0,
    left: 18,
    right: 18,
    height: 1,
    borderRadius: 1,
    backgroundColor: palette.insetHighlight,
  },
  content: {
    flex: 1,
    alignItems: "center",
    paddingTop: "16%",
    paddingHorizontal: 30,
  },
  name: {
    marginTop: 44,
    color: palette.silver50,
    fontFamily: fonts.medium,
    fontSize: 20,
    letterSpacing: tracking.title,
    // Optically recenter wide-tracked uppercase (letterSpacing trails right).
    paddingLeft: tracking.title,
    textAlign: "center",
  },
  description: {
    marginTop: 20,
    maxWidth: 232,
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
  },
  dots: {
    position: "absolute",
    bottom: 28,
    alignSelf: "center",
  },
});

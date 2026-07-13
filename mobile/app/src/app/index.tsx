import { useRouter } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { ChromeIcon } from "@/components/ChromeIcon";
import { vorinthexMarkSource } from "@/data/capability-icons";
import { durations, easings } from "@/theme/motion";
import { fonts, palette, tracking } from "@/theme/tokens";

const LOGO_SIZE = 150;

/**
 * Splash: pure obsidian black, the real Vorinthex mark revealed with a
 * restrained fade-and-scale and a soft neutral specular sweep.
 */
export default function SplashRoute() {
  const router = useRouter();

  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.86);
  const wordmarkOpacity = useSharedValue(0);
  const taglineOpacity = useSharedValue(0);
  const sweepX = useSharedValue(-110);

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: durations.reveal, easing: easings.out });
    logoScale.value = withTiming(1, { duration: durations.reveal, easing: easings.out });
    wordmarkOpacity.value = withDelay(200, withTiming(1, { duration: 650 }));
    taglineOpacity.value = withDelay(420, withTiming(1, { duration: 650 }));
    sweepX.value = withDelay(
      700,
      withTiming(LOGO_SIZE + 110, { duration: 1200, easing: easings.inOut }),
    );

    const timer = setTimeout(
      () => router.replace("/onboarding"),
      durations.splashHold + 300,
    );
    return () => clearTimeout(timer);
  }, [logoOpacity, logoScale, router, sweepX, taglineOpacity, wordmarkOpacity]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));
  const wordmarkStyle = useAnimatedStyle(() => ({ opacity: wordmarkOpacity.value }));
  const taglineStyle = useAnimatedStyle(() => ({ opacity: taglineOpacity.value }));
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sweepX.value }, { rotateZ: "18deg" }],
  }));

  return (
    <View style={styles.root}>
      <Animated.Text style={[styles.wordmark, wordmarkStyle]}>VORINTHEX AI</Animated.Text>

      <Animated.View style={logoStyle}>
        <ChromeIcon source={vorinthexMarkSource} size={LOGO_SIZE} glow={0.8} />
        <View style={styles.sweepClip} pointerEvents="none">
          <Animated.View style={[styles.sweep, sweepStyle]} />
        </View>
      </Animated.View>

      <Animated.Text style={[styles.tagline, taglineStyle]}>
        {"THE NEXUS\nOF INTELLIGENCE"}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.page,
    alignItems: "center",
    justifyContent: "center",
    gap: 52,
  },
  wordmark: {
    color: palette.silver100,
    fontFamily: fonts.medium,
    fontSize: 15,
    letterSpacing: tracking.title,
    paddingLeft: tracking.title,
  },
  sweepClip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: LOGO_SIZE / 2,
    overflow: "hidden",
  },
  sweep: {
    position: "absolute",
    top: -40,
    left: -50,
    width: 42,
    height: LOGO_SIZE + 80,
    backgroundColor: "rgba(255, 255, 255, 0.09)",
  },
  tagline: {
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 12,
    letterSpacing: tracking.label + 1,
    paddingLeft: tracking.label + 1,
    lineHeight: 24,
    textAlign: "center",
  },
});

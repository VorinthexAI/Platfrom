import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrainCore3D } from "@/components/three/BrainCore3D";
import { BRAIN_BUILD_MESSAGES } from "@/data/brain-build-messages";
import { durations, easings } from "@/theme/motion";
import { fonts, palette, tracking } from "@/theme/tokens";

Animated.addWhitelistedNativeProps({ text: true });
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);
const MESSAGE_INTERVAL_MS = 700;
const MESSAGE_STEP = 17;

/**
 * Building Your Brain: the monochrome neural brain assembles center-out
 * while a minimal progress line and percentage fill.
 */
export default function BuildingRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [messageIndex, setMessageIndex] = useState(() =>
    Math.floor(Math.random() * BRAIN_BUILD_MESSAGES.length),
  );

  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: durations.buildTotal,
      easing: easings.inOut,
    });
    const timer = setTimeout(() => router.replace("/brain"), durations.buildExitDelay);
    const messageTimer = setInterval(() => {
      setMessageIndex((current) => (current + MESSAGE_STEP) % BRAIN_BUILD_MESSAGES.length);
    }, MESSAGE_INTERVAL_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(messageTimer);
    };
  }, [progress, router]);

  const lineStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const percentProps = useAnimatedProps(() => {
    // `text` drives the native TextInput value directly (canonical
    // Reanimated pattern for animated numbers); it isn't in the JS prop types.
    return { text: `${Math.round(progress.value * 100)}%` } as unknown as Partial<
      import("react-native").TextInputProps
    >;
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 56 }]}>
      <Text style={styles.title}>{"BUILDING\nYOUR BRAIN"}</Text>

      <View style={styles.brainWrap}>
        <BrainCore3D
          durationMs={durations.buildTotal}
          style={{
            width: Math.min(width * 0.9, 360),
            height: Math.min(width * 0.9, 360) * 1.15,
          }}
        />
      </View>

      <View style={styles.progressBlock}>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, lineStyle]} />
        </View>
        <AnimatedTextInput
          editable={false}
          defaultValue="0%"
          animatedProps={percentProps}
          style={styles.percent}
          accessibilityLabel="Build progress"
        />
        <Text style={styles.status}>{BRAIN_BUILD_MESSAGES[messageIndex]}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.page,
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: palette.silver100,
    fontFamily: fonts.medium,
    fontSize: 16,
    letterSpacing: tracking.label + 2,
    paddingLeft: tracking.label + 2,
    lineHeight: 30,
    textAlign: "center",
  },
  brainWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  progressBlock: {
    width: "100%",
    alignItems: "center",
    gap: 14,
  },
  track: {
    width: 190,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: "rgba(60, 67, 74, 0.7)",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: palette.silver100,
  },
  percent: {
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 13,
    letterSpacing: 1,
    padding: 0,
    textAlign: "center",
  },
  status: {
    width: "86%",
    maxWidth: 320,
    height: 36,
    color: palette.silver500,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0,
    textAlign: "center",
    textAlignVertical: "center",
  },
});

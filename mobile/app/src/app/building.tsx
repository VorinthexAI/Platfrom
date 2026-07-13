import { useRouter } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NeuralBrain3D } from "@/components/three/NeuralBrain3D";
import { durations, easings } from "@/theme/motion";
import { fonts, palette, tracking } from "@/theme/tokens";

Animated.addWhitelistedNativeProps({ text: true });
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/**
 * Building Your Brain: the monochrome neural brain assembles center-out
 * while a minimal progress line and percentage fill.
 */
export default function BuildingRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: durations.buildTotal,
      easing: easings.inOut,
    });
    const timer = setTimeout(() => router.replace("/brain"), durations.buildExitDelay);
    return () => clearTimeout(timer);
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
        <NeuralBrain3D
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
    alignItems: "center",
    gap: 16,
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
});

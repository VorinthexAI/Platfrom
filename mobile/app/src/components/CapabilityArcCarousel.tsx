import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { VolumeIcon } from "@vorinthex/shared/ui/icons-mobile";

import { ChromeIcon } from "@/components/ChromeIcon";
import { PressableScale } from "@/components/PressableScale";
import { capabilityIconSource } from "@/data/capability-icons";
import type { Capability } from "@/data/registry";
import { useAppAudio } from "@/lib/app-audio";
import { springs } from "@/theme/motion";
import { fonts, palette, radii, tracking } from "@/theme/tokens";

const CAROUSEL_HEIGHT = 184;
const SWIPE_THRESHOLD = 42;

function wrap(index: number, count: number): number {
  return ((index % count) + count) % count;
}

type CapabilityArcCarouselProps = {
  capabilities: readonly Capability[];
  selectedIndex: number;
  width: number;
  onOpen: (capability: Capability) => void;
  onSelect: (index: number) => void;
};

export function CapabilityArcCarousel({
  capabilities,
  selectedIndex,
  width,
  onOpen,
  onSelect,
}: CapabilityArcCarouselProps) {
  const dragX = useSharedValue(0);
  const reveal = useSharedValue(1);
  const { playingBriefing, toggleBriefing } = useAppAudio();
  const count = capabilities.length;
  const selected = capabilities[selectedIndex];

  const move = useCallback(
    (step: number) => {
      if (count < 2) return;
      reveal.value = 0;
      onSelect(wrap(selectedIndex + step, count));
      reveal.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) });
    },
    [count, onSelect, reveal, selectedIndex],
  );

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-18, 18])
    .onChange((event) => {
      dragX.value = event.translationX;
    })
    .onEnd((event) => {
      const shouldMove =
        Math.abs(event.translationX) > SWIPE_THRESHOLD || Math.abs(event.velocityX) > 650;
      if (shouldMove) runOnJS(move)(event.translationX < 0 ? 1 : -1);
      dragX.value = withSpring(0, springs.snapBack);
    });

  const stageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value * 0.14 }],
  }));

  const currentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(reveal.value, [0, 1], [0.25, 1]),
    transform: [
      { perspective: 900 },
      { translateY: interpolate(reveal.value, [0, 1], [14, 0]) },
      { scale: interpolate(reveal.value, [0, 1], [0.92, 1]) },
      { rotateX: "-4deg" },
    ],
  }));

  if (!selected) return null;

  const previous = capabilities[wrap(selectedIndex - 1, count)];
  const next = capabilities[wrap(selectedIndex + 1, count)];
  const briefingPlaying = playingBriefing === selected.slug;

  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.root, { width, height: CAROUSEL_HEIGHT }]}>
        <Svg
          width={width}
          height={CAROUSEL_HEIGHT}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <Path
            d={`M 8 30 Q ${width / 2} 166 ${width - 8} 30`}
            stroke="rgba(221, 226, 229, 0.16)"
            strokeWidth={1}
            fill="none"
          />
          <Path
            d={`M 30 28 Q ${width / 2} 142 ${width - 30} 28`}
            stroke="rgba(255, 255, 255, 0.05)"
            strokeWidth={8}
            fill="none"
          />
        </Svg>

        <Animated.View style={[StyleSheet.absoluteFill, stageStyle]}>
          {count > 1 && previous ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Select ${previous.name}`}
              onPress={() => move(-1)}
              style={[styles.sideSlot, styles.leftSlot]}
            >
              <View style={[styles.glassCube, styles.sideCube, styles.leftCube]}>
                <View style={styles.specularEdge} />
                <ChromeIcon
                  source={capabilityIconSource[previous.slug]}
                  size={52}
                  glow={0.34}
                />
              </View>
            </PressableScale>
          ) : null}

          {count > 1 && next ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Select ${next.name}`}
              onPress={() => move(1)}
              style={[styles.sideSlot, styles.rightSlot]}
            >
              <View style={[styles.glassCube, styles.sideCube, styles.rightCube]}>
                <View style={styles.specularEdge} />
                <ChromeIcon
                  source={capabilityIconSource[next.slug]}
                  size={52}
                  glow={0.34}
                />
              </View>
            </PressableScale>
          ) : null}

          <Animated.View
            key={selected.slug}
            entering={FadeIn.duration(180)}
            style={[styles.currentSlot, currentStyle]}
          >
            <View style={[styles.glassCube, styles.currentCube]}>
              <View style={styles.specularEdge} />
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Open ${selected.name}`}
                onPress={() => onOpen(selected)}
                style={styles.currentInfo}
              >
                <ChromeIcon
                  source={capabilityIconSource[selected.slug]}
                  size={50}
                  glow={0.42}
                />
                <View style={styles.copy}>
                  <Text style={styles.name}>{selected.name.toUpperCase()}</Text>
                  <Text numberOfLines={3} style={styles.description}>
                    {selected.onboardingDescription}
                  </Text>
                </View>
              </PressableScale>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={
                  `${briefingPlaying ? "Stop" : "Play"} ${selected.name} briefing`
                }
                onPress={() => toggleBriefing(selected.slug)}
                style={styles.briefingButton}
              >
                <VolumeIcon size="sm" variant="inverse" />
                <Text style={styles.briefingText}>
                  {briefingPlaying ? "STOP BRIEFING" : "PLAY BRIEFING"}
                </Text>
              </PressableScale>
            </View>
          </Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: "center",
    overflow: "visible",
  },
  sideSlot: {
    position: "absolute",
    top: 20,
    zIndex: 1,
  },
  leftSlot: {
    left: 8,
  },
  rightSlot: {
    right: 8,
  },
  currentSlot: {
    position: "absolute",
    left: "50%",
    bottom: 0,
    width: 224,
    marginLeft: -112,
    zIndex: 2,
  },
  glassCube: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(221, 226, 229, 0.28)",
    backgroundColor: "rgba(16, 21, 28, 0.84)",
    shadowColor: palette.chromeWhite,
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  specularEdge: {
    position: "absolute",
    top: 0,
    left: 14,
    right: 14,
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.5)",
  },
  sideCube: {
    width: 80,
    height: 88,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(13, 17, 23, 0.72)",
  },
  leftCube: {
    transform: [{ perspective: 700 }, { rotateY: "22deg" }, { rotateZ: "-4deg" }],
  },
  rightCube: {
    transform: [{ perspective: 700 }, { rotateY: "-22deg" }, { rotateZ: "4deg" }],
  },
  currentCube: {
    width: 224,
    height: 148,
    padding: 14,
    borderRadius: radii.sm,
  },
  currentInfo: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  copy: {
    flex: 1,
  },
  name: {
    color: palette.silver50,
    fontFamily: fonts.medium,
    fontSize: 12,
    letterSpacing: tracking.micro,
  },
  description: {
    marginTop: 5,
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0,
  },
  briefingButton: {
    height: 34,
    marginTop: 10,
    borderRadius: 17,
    backgroundColor: palette.silver100,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  briefingText: {
    color: palette.page,
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: tracking.micro,
  },
});

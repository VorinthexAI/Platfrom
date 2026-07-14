import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { VolumeIcon } from "@vorinthex/shared/ui/icons-mobile";

import { BrandButton } from "@/components/BrandButton";
import { ChromeIcon } from "@/components/ChromeIcon";
import { ChromePanel } from "@/components/ChromePanel";
import { PressableScale } from "@/components/PressableScale";
import { capabilityIconSource } from "@/data/capability-icons";
import type { Capability } from "@/data/registry";
import { useAppAudio } from "@/lib/app-audio";
import { springs } from "@/theme/motion";
import { fonts, palette, radii } from "@/theme/tokens";

export const CAPABILITY_CAROUSEL_HEIGHT = 184;

const SWIPE_DISTANCE = 34;
const SWIPE_VELOCITY = 650;

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
  const { playingBriefing, toggleBriefing } = useAppAudio();
  const count = capabilities.length;
  const selected = capabilities[selectedIndex];
  const compact = width < 350;
  const currentWidth = compact ? 220 : 248;
  const sideWidth = compact ? 72 : 86;
  const sideHeight = compact ? 88 : 96;

  const move = useCallback(
    (step: number) => {
      if (count < 2) return;
      onSelect(wrap(selectedIndex + step, count));
      dragX.value = step > 0 ? 46 : -46;
      dragX.value = withSpring(0, springs.carousel);
    },
    [count, dragX, onSelect, selectedIndex],
  );

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-22, 22])
    .onChange((event) => {
      dragX.value = Math.max(-120, Math.min(120, event.translationX * 0.72));
    })
    .onEnd((event) => {
      const shouldMove =
        Math.abs(event.translationX) > SWIPE_DISTANCE ||
        Math.abs(event.velocityX) > SWIPE_VELOCITY;
      if (shouldMove) {
        const direction =
          Math.abs(event.velocityX) > SWIPE_VELOCITY
            ? Math.sign(event.velocityX)
            : Math.sign(event.translationX);
        runOnJS(move)(direction < 0 ? 1 : -1);
      } else {
        dragX.value = withSpring(0, springs.carousel);
      }
    });

  const stageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }],
  }));

  if (!selected) return null;

  const previous = capabilities[wrap(selectedIndex - 1, count)];
  const next = capabilities[wrap(selectedIndex + 1, count)];
  const briefingPlaying = playingBriefing === selected.slug;

  return (
    <GestureDetector gesture={pan}>
      <View
        collapsable={false}
        style={[styles.root, { width, height: CAPABILITY_CAROUSEL_HEIGHT }]}
      >
        <Svg
          width={width}
          height={CAPABILITY_CAROUSEL_HEIGHT}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <Path
            d={`M 8 27 Q ${width / 2} 170 ${width - 8} 27`}
            stroke="rgba(255, 255, 255, 0.12)"
            strokeWidth={1}
            fill="none"
          />
          <Path
            d={`M 28 28 Q ${width / 2} 148 ${width - 28} 28`}
            stroke="rgba(255, 255, 255, 0.03)"
            strokeWidth={8}
            fill="none"
          />
        </Svg>

        <Animated.View
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFill, stageStyle]}
        >
          {count > 1 && previous ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Select ${previous.name}`}
              hitSlop={16}
              onPress={() => move(-1)}
              style={[
                styles.sideSlot,
                styles.leftSlot,
                { width: sideWidth, height: sideHeight },
              ]}
            >
              <ChromePanel
                radius={radii.md}
                style={[
                  styles.cubeGlow,
                  styles.sideCube,
                  styles.leftCube,
                  { width: sideWidth, height: sideHeight },
                ]}
              >
                <ChromeIcon
                  source={capabilityIconSource[previous.slug]}
                  size={compact ? 50 : 56}
                  glow={0.34}
                />
              </ChromePanel>
            </PressableScale>
          ) : null}

          {count > 1 && next ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Select ${next.name}`}
              hitSlop={16}
              onPress={() => move(1)}
              style={[
                styles.sideSlot,
                styles.rightSlot,
                { width: sideWidth, height: sideHeight },
              ]}
            >
              <ChromePanel
                radius={radii.md}
                style={[
                  styles.cubeGlow,
                  styles.sideCube,
                  styles.rightCube,
                  { width: sideWidth, height: sideHeight },
                ]}
              >
                <ChromeIcon
                  source={capabilityIconSource[next.slug]}
                  size={compact ? 50 : 56}
                  glow={0.34}
                />
              </ChromePanel>
            </PressableScale>
          ) : null}

          <Animated.View
            style={[
              styles.currentSlot,
              { width: currentWidth, marginLeft: -currentWidth / 2 },
            ]}
          >
            <ChromePanel
              radius={radii.lg}
              style={[
                styles.cubeGlow,
                styles.currentCube,
                { width: currentWidth },
              ]}
            >
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Open ${selected.name}`}
                onPress={() => onOpen(selected)}
                style={styles.currentInfo}
              >
                <ChromeIcon
                  source={capabilityIconSource[selected.slug]}
                  size={44}
                  glow={0.42}
                />
                <View style={styles.copy}>
                  <Text style={styles.name}>{selected.name.toUpperCase()}</Text>
                  <Text numberOfLines={3} style={styles.description}>
                    {selected.onboardingDescription}
                  </Text>
                </View>
              </PressableScale>
              <BrandButton
                accessibilityLabel={`${briefingPlaying ? "Stop" : "Play"} ${selected.name} briefing`}
                compact
                icon={<VolumeIcon size="sm" variant="inverse" />}
                label={briefingPlaying ? "Stop Briefing" : "Play Briefing"}
                onPress={() => toggleBriefing(selected.slug)}
                style={styles.briefingButton}
                variant="primary"
              />
            </ChromePanel>
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
    top: 18,
    zIndex: 1,
  },
  leftSlot: {
    left: 4,
  },
  rightSlot: {
    right: 4,
  },
  currentSlot: {
    position: "absolute",
    left: "50%",
    bottom: 0,
    zIndex: 2,
  },
  cubeGlow: {
    shadowColor: palette.silver100,
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  sideCube: {
    alignItems: "center",
    justifyContent: "center",
  },
  leftCube: {
    transform: [
      { perspective: 1400 },
      { rotateY: "18deg" },
      { rotateZ: "-3deg" },
    ],
  },
  rightCube: {
    transform: [
      { perspective: 1400 },
      { rotateY: "-18deg" },
      { rotateZ: "3deg" },
    ],
  },
  currentCube: {
    height: 158,
    padding: 16,
    transform: [{ perspective: 1400 }, { rotateX: "1.3deg" }],
  },
  currentInfo: {
    minHeight: 72,
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
    fontSize: 15,
    lineHeight: 18,
    letterSpacing: 3.6,
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
    height: 38,
    marginTop: 12,
  },
});

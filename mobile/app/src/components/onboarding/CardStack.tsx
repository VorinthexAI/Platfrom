import { useCallback, useEffect, useRef } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { OnboardingCard } from "@/components/onboarding/OnboardingCard";
import { PressableScale } from "@/components/PressableScale";
import { CAPABILITIES, type Capability, type CapabilitySlug } from "@/data/registry";
import { useAppAudio } from "@/lib/app-audio";
import { completionHaptic, decisionHaptic } from "@/lib/haptics";
import { durations, easings, springs, swipe } from "@/theme/motion";
import { fonts, palette, radii, tracking } from "@/theme/tokens";
import { useOnboardingStore, type CapabilityDecision } from "@/state/onboarding";

const VISIBLE_DEPTH = 3;
const DEPTH_OFFSET_Y = -16;
const DEPTH_SCALE = 0.05;

type ExitFn = (decision: CapabilityDecision) => void;

type SwipeCardProps = {
  capability: Capability;
  index: number;
  depth: number;
  active: boolean;
  width: number;
  height: number;
  onCommit: (slug: CapabilitySlug, decision: CapabilityDecision) => void;
  registerExit: (fn: ExitFn) => void;
  briefingPlaying: boolean;
  onToggleBriefing: () => void;
};

function SwipeCard({
  capability,
  index,
  depth,
  active,
  width,
  height,
  onCommit,
  registerExit,
  briefingPlaying,
  onToggleBriefing,
}: SwipeCardProps) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const exiting = useSharedValue(0);
  const appear = useSharedValue(depth >= VISIBLE_DEPTH - 1 ? 0 : 1);

  // Rear cards reveal from behind; depth changes spring the card forward
  // so the next card pops from the stack instead of jumping.
  const depthValue = useDerivedValue(() => withSpring(depth, springs.promote), [depth]);

  useEffect(() => {
    appear.value = withTiming(1, { duration: durations.base });
  }, [appear]);

  const exitCard = useCallback(
    (decision: CapabilityDecision) => {
      if (exiting.value === 1) return;
      exiting.value = 1;
      decisionHaptic();
      const direction = decision === "enabled" ? 1 : -1;
      ty.value = withTiming(28, { duration: durations.cardExit, easing: easings.out });
      tx.value = withTiming(
        direction * width * 1.35,
        { duration: durations.cardExit, easing: easings.out },
        (finished) => {
          if (finished) runOnJS(onCommit)(capability.slug, decision);
        },
      );
    },
    [capability.slug, exiting, onCommit, tx, ty, width],
  );

  useEffect(() => {
    if (active) registerExit(exitCard);
  }, [active, exitCard, registerExit]);

  const pan = Gesture.Pan()
    .enabled(active)
    .onChange((event) => {
      if (exiting.value === 1) return;
      // Drag resistance: the card trails the finger slightly.
      tx.value = event.translationX * swipe.dragResistance;
      ty.value = event.translationY * 0.06;
    })
    .onEnd((event) => {
      if (exiting.value === 1) return;
      const passedDistance = Math.abs(tx.value) > width * swipe.distanceFactor;
      const passedVelocity = Math.abs(event.velocityX) > swipe.velocity;
      if (passedDistance || passedVelocity) {
        const direction = passedVelocity ? Math.sign(event.velocityX) : Math.sign(tx.value);
        runOnJS(exitCard)(direction > 0 ? "enabled" : "skipped");
      } else {
        // Cancelled drag: spring back to a perfectly frontal rest pose.
        tx.value = withSpring(0, springs.snapBack);
        ty.value = withSpring(0, springs.snapBack);
      }
    });

  const animatedStyle = useAnimatedStyle(() => {
    const d = depthValue.value;
    // Minimal rotation while actively dragging only — zero at rest.
    const rotation = interpolate(
      tx.value,
      [-width, 0, width],
      [-swipe.maxRotationDeg, 0, swipe.maxRotationDeg],
    );
    return {
      opacity: appear.value,
      transform: [
        { translateX: tx.value },
        { translateY: ty.value + d * DEPTH_OFFSET_Y },
        { scale: 1 - d * DEPTH_SCALE },
        { rotateZ: `${rotation}deg` },
      ],
    };
  });

  const dimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(depthValue.value, [0, 2], [0, 0.4], "clamp"),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.cardWrap, animatedStyle]}
        pointerEvents={active ? "auto" : "none"}
      >
        <OnboardingCard
          capability={capability}
          index={index}
          width={width}
          height={height}
          briefingPlaying={briefingPlaying}
          onToggleBriefing={onToggleBriefing}
        />
        <Animated.View pointerEvents="none" style={[styles.dim, dimStyle]} />
      </Animated.View>
    </GestureDetector>
  );
}

export type CardStackProps = {
  onComplete: () => void;
};

/**
 * Gesture-led onboarding stack. Swipe left to skip, right to enable;
 * decisions land in the Zustand store and the flow advances automatically
 * after the fifth card.
 */
export function CardStack({ onComplete }: CardStackProps) {
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = Math.min(Math.round(screenWidth * 0.82), 340);
  const cardHeight = Math.round(cardWidth * 1.48);

  const activeIndex = useOnboardingStore((state) => state.activeIndex);
  const decide = useOnboardingStore((state) => state.decide);
  const { playingBriefing, stopBriefing, toggleBriefing } = useAppAudio();

  const exitRef = useRef<ExitFn | null>(null);
  const completedRef = useRef(false);

  const registerExit = useCallback((fn: ExitFn) => {
    exitRef.current = fn;
  }, []);

  const handleCommit = useCallback(
    (slug: CapabilitySlug, decision: CapabilityDecision) => {
      stopBriefing();
      decide(slug, decision);
      if (
        useOnboardingStore.getState().activeIndex >= CAPABILITIES.length &&
        !completedRef.current
      ) {
        completedRef.current = true;
        completionHaptic();
        setTimeout(onComplete, 420);
      }
    },
    [decide, onComplete, stopBriefing],
  );

  const activeCapability = CAPABILITIES[activeIndex];

  return (
    <View style={styles.root}>
      <View style={[styles.stackArea, { width: cardWidth, height: cardHeight + 44 }]}>
        {CAPABILITIES.map((capability, index) => {
          const depth = index - activeIndex;
          if (depth < 0 || depth >= VISIBLE_DEPTH) return null;
          return { capability, index, depth };
        })
          .filter(
            (entry): entry is { capability: Capability; index: number; depth: number } =>
              entry !== null,
          )
          // Draw deepest first so the active card naturally sits on top.
          .sort((a, b) => b.depth - a.depth)
          .map(({ capability, index, depth }) => (
            <SwipeCard
              key={capability.slug}
              capability={capability}
              index={index}
              depth={depth}
              active={depth === 0}
              width={cardWidth}
              height={cardHeight}
              onCommit={handleCommit}
              registerExit={registerExit}
              briefingPlaying={playingBriefing === capability.slug}
              onToggleBriefing={() => toggleBriefing(capability.slug)}
            />
          ))}
      </View>

      <View style={styles.footer}>
        <View style={styles.fallbackRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={
              activeCapability ? `Skip ${activeCapability.name}` : "Skip capability"
            }
            onPress={() => exitRef.current?.("skipped")}
            style={[styles.fallbackButton, styles.skipButton]}
          >
            <Text style={styles.fallbackText}>SKIP</Text>
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={
              activeCapability ? `Enable ${activeCapability.name}` : "Enable capability"
            }
            onPress={() => exitRef.current?.("enabled")}
            style={[styles.fallbackButton, styles.enableButton]}
          >
            <Text style={styles.enableText}>ENABLE</Text>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 34,
  },
  stackArea: {
    justifyContent: "flex-end",
  },
  cardWrap: {
    position: "absolute",
    bottom: 0,
    left: 0,
  },
  dim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radii.xl,
    backgroundColor: palette.voidBlack,
  },
  footer: {
    alignItems: "center",
    paddingBottom: 26,
  },
  fallbackRow: {
    flexDirection: "row",
    gap: 14,
  },
  fallbackButton: {
    minWidth: 112,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  skipButton: {
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  enableButton: {
    backgroundColor: palette.silver100,
  },
  fallbackText: {
    color: palette.silver500,
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: tracking.micro,
  },
  enableText: {
    color: palette.page,
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: tracking.micro,
  },
});

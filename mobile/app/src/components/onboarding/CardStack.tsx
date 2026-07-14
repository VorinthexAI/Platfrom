import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { BrandButton } from "@/components/BrandButton";
import { OnboardingCard } from "@/components/onboarding/OnboardingCard";
import {
  CAPABILITIES,
  type Capability,
  type CapabilitySlug,
} from "@/data/registry";
import { useAppAudio } from "@/lib/app-audio";
import { completionHaptic, decisionHaptic } from "@/lib/haptics";
import { createRandom } from "@/lib/random";
import { durations, springs, swipe } from "@/theme/motion";
import { palette, radii } from "@/theme/tokens";
import {
  useOnboardingStore,
  type CapabilityDecision,
} from "@/state/onboarding";

const VISIBLE_DEPTH = 3;
const DEPTH_OFFSET_Y = -16;
const DEPTH_SCALE = 0.05;

type DustParticleSpec = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  delay: number;
  size: number;
};

const dustRandom = createRandom(947);
const DUST_PARTICLES: readonly DustParticleSpec[] = Array.from(
  { length: 68 },
  () => {
    const angle = dustRandom() * Math.PI * 2;
    const distance = 54 + dustRandom() * 150;
    return {
      x: dustRandom(),
      y: dustRandom(),
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance - 28 * dustRandom(),
      delay: dustRandom() * 0.03,
      size: 2 + dustRandom() * 4,
    };
  },
);

function DustParticle({
  decision,
  height,
  particle,
  progress,
  width,
}: {
  decision: CapabilityDecision | null;
  height: number;
  particle: DustParticleSpec;
  progress: SharedValue<number>;
  width: number;
}) {
  const style = useAnimatedStyle(() => {
    const localProgress = interpolate(
      progress.value,
      [particle.delay, 1],
      [0, 1],
      "clamp",
    );
    return {
      opacity: interpolate(localProgress, [0, 0.12, 0.62, 1], [0, 1, 0.72, 0]),
      transform: [
        { translateX: particle.dx * localProgress },
        { translateY: particle.dy * localProgress },
        { scale: interpolate(localProgress, [0, 0.4, 1], [0.5, 1.3, 0]) },
      ],
    };
  });

  const color = decision === "enabled" ? palette.silver50 : palette.silver500;
  return (
    <Animated.View
      style={[
        styles.dustParticle,
        {
          left: particle.x * width,
          top: particle.y * height,
          width: particle.size,
          height: particle.size,
          borderRadius: particle.size / 2,
          backgroundColor: color,
          shadowColor: color,
        },
        style,
      ]}
    />
  );
}

function DustBurst({
  decision,
  height,
  progress,
  width,
}: {
  decision: CapabilityDecision | null;
  height: number;
  progress: SharedValue<number>;
  width: number;
}) {
  return (
    <View pointerEvents="none" style={[styles.dustBurst, { width, height }]}>
      {DUST_PARTICLES.map((particle, index) => (
        <DustParticle
          key={index}
          decision={decision}
          height={height}
          particle={particle}
          progress={progress}
          width={width}
        />
      ))}
    </View>
  );
}

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
  const burst = useSharedValue(0);
  const [burstDecision, setBurstDecision] = useState<CapabilityDecision | null>(
    null,
  );

  // Rear cards reveal from behind; depth changes spring the card forward
  // so the next card pops from the stack instead of jumping.
  const depthValue = useDerivedValue(
    () => withSpring(depth, springs.promote),
    [depth],
  );

  useEffect(() => {
    appear.value = withTiming(1, { duration: durations.base });
  }, [appear]);

  const exitCard = useCallback(
    (decision: CapabilityDecision) => {
      if (exiting.value === 1) return;
      exiting.value = 1;
      decisionHaptic();
      setBurstDecision(decision);
      requestAnimationFrame(() => {
        burst.value = withTiming(
          1,
          { duration: durations.dustBurst, easing: Easing.linear },
          (finished) => {
            if (finished) scheduleOnRN(onCommit, capability.slug, decision);
          },
        );
      });
    },
    [burst, capability.slug, exiting, onCommit],
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
        const direction = passedVelocity
          ? Math.sign(event.velocityX)
          : Math.sign(tx.value);
        scheduleOnRN(exitCard, direction > 0 ? "enabled" : "skipped");
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

  const dissolveStyle = useAnimatedStyle(() => ({
    opacity: interpolate(burst.value, [0, 0.08, 0.55, 1], [1, 0.78, 0.08, 0]),
    transform: [
      {
        scale: interpolate(
          burst.value,
          [0, 0.2, 0.55, 1],
          [1, 1.02, 1.035, 0.96],
        ),
      },
    ],
  }));

  const shieldStyle = useAnimatedStyle(() => ({
    opacity: interpolate(burst.value, [0, 0.88, 1], [1, 1, 0]),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.cardWrap, animatedStyle]}
        pointerEvents={active ? "auto" : "none"}
      >
        <Animated.View
          pointerEvents="none"
          style={[styles.burstShield, shieldStyle]}
        />
        <Animated.View style={dissolveStyle}>
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
        <DustBurst
          decision={burstDecision}
          height={height}
          progress={burst}
          width={width}
        />
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
      <View
        style={[
          styles.stackArea,
          { width: cardWidth, height: cardHeight + 44 },
        ]}
      >
        {CAPABILITIES.map((capability, index) => {
          const depth = index - activeIndex;
          if (depth < 0 || depth >= VISIBLE_DEPTH) return null;
          return { capability, index, depth };
        })
          .filter(
            (
              entry,
            ): entry is {
              capability: Capability;
              index: number;
              depth: number;
            } => entry !== null,
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
          <BrandButton
            accessibilityLabel={
              activeCapability
                ? `Skip ${activeCapability.name}`
                : "Skip capability"
            }
            label="Skip"
            onPress={() => exitRef.current?.("skipped")}
            style={[styles.fallbackButton, styles.skipButton]}
            variant="secondary"
          />
          <BrandButton
            accessibilityLabel={
              activeCapability
                ? `Enable ${activeCapability.name}`
                : "Enable capability"
            }
            label="Enable"
            onPress={() => exitRef.current?.("enabled")}
            style={[styles.fallbackButton, styles.enableButton]}
            variant="primary"
          />
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
  dustBurst: {
    position: "absolute",
    top: 0,
    left: 0,
    overflow: "visible",
  },
  burstShield: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radii.xl,
    backgroundColor: palette.page,
  },
  dustParticle: {
    position: "absolute",
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
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
    minWidth: 128,
  },
  skipButton: {
    shadowOpacity: 0,
  },
  enableButton: {
    shadowOpacity: 0.18,
  },
});

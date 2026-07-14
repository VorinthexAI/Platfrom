import { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import Svg, {
  Defs,
  Ellipse,
  Path,
  RadialGradient,
  Stop,
} from "react-native-svg";

import { ChromeIcon } from "@/components/ChromeIcon";
import { ChromePanel } from "@/components/ChromePanel";
import { PressableScale } from "@/components/PressableScale";
import { capabilityIconSource } from "@/data/capability-icons";
import type { Capability } from "@/data/registry";
import { springs } from "@/theme/motion";
import { fonts, palette, radii } from "@/theme/tokens";

export const CAPABILITY_CAROUSEL_HEIGHT = 184;

const SWIPE_VELOCITY = 650;
const FACE_TOP = 22;
const MAX_VISIBLE = 2.35;
const ROTATE_PER_STEP = 34;
const ARC_RISE = 9;

function wrap(index: number, count: number): number {
  "worklet";
  return ((index % count) + count) % count;
}

/** Shortest signed distance from `value` to 0 on a ring of `count` items. */
function wrapSigned(value: number, count: number): number {
  "worklet";
  let distance = value % count;
  if (distance > count / 2) distance -= count;
  if (distance < -count / 2) distance += count;
  return distance;
}

type CapabilityArcCarouselProps = {
  capabilities: readonly Capability[];
  selectedIndex: number;
  width: number;
  onOpen: (capability: Capability) => void;
  onSelect: (index: number) => void;
};

/**
 * Wrapping 3D cube carousel: every capability is a chrome cube face on a
 * shared ring. A single continuous offset tracks the finger, faces rotate
 * away like cube walls, and the resting face carries a silver glow.
 */
export function CapabilityArcCarousel({
  capabilities,
  selectedIndex,
  width,
  onOpen,
  onSelect,
}: CapabilityArcCarouselProps) {
  const count = capabilities.length;
  const compact = width < 350;
  const faceWidth = compact ? 118 : 132;
  const faceHeight = compact ? 128 : 136;
  const spacing = compact ? 100 : 112;

  const offset = useSharedValue(selectedIndex);
  const panStart = useSharedValue(0);
  const committedRef = useRef(selectedIndex);

  const commit = (target: number) => {
    const index = wrap(Math.round(target), count);
    committedRef.current = index;
    if (index !== selectedIndex) onSelect(index);
  };

  useEffect(() => {
    if (committedRef.current === selectedIndex || count < 1) return;
    committedRef.current = selectedIndex;
    const current = offset.value;
    const rel = wrapSigned(selectedIndex - current, count);
    offset.value = withSpring(current + rel, springs.carousel);
  }, [count, offset, selectedIndex]);

  const pan = Gesture.Pan()
    .enabled(count > 1)
    .activeOffsetX([-8, 8])
    .failOffsetY([-22, 22])
    .onStart(() => {
      panStart.value = offset.value;
    })
    .onChange((event) => {
      offset.value = panStart.value - event.translationX / spacing;
    })
    .onEnd((event) => {
      let target = Math.round(offset.value);
      if (
        Math.abs(event.velocityX) > SWIPE_VELOCITY &&
        target === Math.round(panStart.value)
      ) {
        target += event.velocityX < 0 ? 1 : -1;
      }
      offset.value = withSpring(target, springs.carousel);
      runOnJS(commit)(target);
    });

  if (count === 0) return null;

  const pressFace = (index: number) => {
    const rel = wrapSigned(index - offset.value, count);
    if (Math.abs(rel) < 0.5) {
      const capability = capabilities[wrap(index, count)];
      if (capability) onOpen(capability);
      return;
    }
    const target = Math.round(offset.value + rel);
    offset.value = withSpring(target, springs.carousel);
    commit(target);
  };

  return (
    <GestureDetector gesture={pan}>
      <View
        collapsable={false}
        style={[styles.root, { width, height: CAPABILITY_CAROUSEL_HEIGHT }]}
      >
        <Svg
          width={width}
          height={CAPABILITY_CAROUSEL_HEIGHT}
          style={styles.rail}
          pointerEvents="none"
        >
          <Defs>
            <RadialGradient id="cubeUnderGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#DDE2E5" stopOpacity={0.16} />
              <Stop offset="0.6" stopColor="#DDE2E5" stopOpacity={0.06} />
              <Stop offset="1" stopColor="#DDE2E5" stopOpacity={0} />
            </RadialGradient>
          </Defs>
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
          <Ellipse
            cx={width / 2}
            cy={CAPABILITY_CAROUSEL_HEIGHT - 8}
            rx={width * 0.34}
            ry={30}
            fill="url(#cubeUnderGlow)"
          />
        </Svg>

        {capabilities.map((capability, index) => (
          <CubeFace
            key={capability.slug}
            capability={capability}
            count={count}
            faceHeight={faceHeight}
            faceWidth={faceWidth}
            index={index}
            offset={offset}
            spacing={spacing}
            stageWidth={width}
            onPress={() => pressFace(index)}
          />
        ))}
      </View>
    </GestureDetector>
  );
}

type CubeFaceProps = {
  capability: Capability;
  count: number;
  faceHeight: number;
  faceWidth: number;
  index: number;
  offset: SharedValue<number>;
  spacing: number;
  stageWidth: number;
  onPress: () => void;
};

function CubeFace({
  capability,
  count,
  faceHeight,
  faceWidth,
  index,
  offset,
  spacing,
  stageWidth,
  onPress,
}: CubeFaceProps) {
  const faceStyle = useAnimatedStyle(() => {
    const rel = wrapSigned(index - offset.value, count);
    const magnitude = Math.min(Math.abs(rel), MAX_VISIBLE);
    const clamped = Math.max(-MAX_VISIBLE, Math.min(MAX_VISIBLE, rel));
    return {
      opacity:
        Math.abs(rel) > MAX_VISIBLE ? 0 : 1 - 0.3 * Math.min(magnitude, 2),
      zIndex: 100 - Math.round(magnitude * 10),
      transform: [
        { perspective: 1200 },
        { translateX: clamped * spacing },
        { translateY: -Math.min(rel * rel, 4) * ARC_RISE },
        { rotateY: `${Math.max(-70, Math.min(70, -clamped * ROTATE_PER_STEP))}deg` },
        { scale: 1 - 0.13 * Math.min(magnitude, 2) },
      ],
    };
  });

  const focusStyle = useAnimatedStyle(() => {
    const rel = wrapSigned(index - offset.value, count);
    return { opacity: Math.max(0, 1 - Math.abs(rel) / 0.6) };
  });

  const glowStyle = useAnimatedStyle(() => {
    const rel = wrapSigned(index - offset.value, count);
    const focus = Math.max(0, 1 - Math.abs(rel) / 0.6);
    return { shadowOpacity: 0.08 + focus * 0.26 };
  });

  return (
    <Animated.View
      style={[
        styles.faceSlot,
        {
          width: faceWidth,
          height: faceHeight,
          left: stageWidth / 2 - faceWidth / 2,
          top: FACE_TOP,
        },
        faceStyle,
      ]}
    >
      <Animated.View style={[styles.faceGlow, glowStyle]}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Open ${capability.name}`}
          onPress={onPress}
          style={styles.facePress}
        >
          <ChromePanel radius={radii.md} style={styles.facePanel}>
            <ChromeIcon
              source={capabilityIconSource[capability.slug]}
              size={44}
              glow={0.4}
            />
            <Text numberOfLines={1} style={styles.name}>
              {capability.name.toUpperCase()}
            </Text>
            <Animated.Text
              numberOfLines={2}
              style={[styles.description, focusStyle]}
            >
              {capability.onboardingDescription}
            </Animated.Text>
            <Animated.View
              pointerEvents="none"
              style={[styles.activeBorder, focusStyle]}
            />
          </ChromePanel>
        </PressableScale>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: "center",
    overflow: "visible",
  },
  rail: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  faceSlot: {
    position: "absolute",
  },
  faceGlow: {
    flex: 1,
    shadowColor: palette.silver100,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  facePress: {
    flex: 1,
  },
  facePanel: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingTop: 12,
  },
  name: {
    marginTop: 8,
    color: palette.silver50,
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 2.2,
  },
  description: {
    marginTop: 4,
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 13,
    textAlign: "center",
  },
  activeBorder: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "rgba(221, 226, 229, 0.55)",
  },
});

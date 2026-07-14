import { useState, type ReactNode } from "react";
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import {
  PressableScale,
  type PressableScaleProps,
} from "@/components/PressableScale";
import { durations, easings } from "@/theme/motion";
import { fonts, palette } from "@/theme/tokens";

type BrandButtonVariant = "primary" | "secondary";

export type BrandButtonProps = Omit<
  PressableScaleProps,
  "children" | "style"
> & {
  compact?: boolean;
  icon?: ReactNode;
  label: string;
  style?: StyleProp<ViewStyle>;
  variant?: BrandButtonVariant;
};

/** Native equivalent of the web app's shared vui-button component. */
export function BrandButton({
  compact = false,
  disabled,
  icon,
  label,
  style,
  variant = "secondary",
  ...props
}: BrandButtonProps) {
  const primary = variant === "primary";
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Press stands in for the web hover: the chrome sheet slides on its own
  // 800ms clock while glow/border/text settle in 400ms.
  const slide = useSharedValue(0);
  const state = useSharedValue(0);

  const glowStyle = useAnimatedStyle(() => {
    if (!primary || disabled) {
      return { shadowOpacity: 0 };
    }
    return {
      shadowOpacity: 0.18 + state.value * 0.12,
      shadowRadius: 17 + state.value * 5,
    };
  });

  const secondaryFillStyle = useAnimatedStyle(() => ({
    backgroundColor: `rgba(255, 255, 255, ${0.03 + state.value * 0.03})`,
    borderColor: interpolateColor(
      state.value,
      [0, 1],
      ["rgba(221, 226, 229, 0.18)", "rgba(221, 226, 229, 0.4)"],
    ),
  }));

  const secondaryLabelStyle = useAnimatedStyle(() => ({
    color: disabled
      ? palette.muted
      : interpolateColor(
          state.value,
          [0, 1],
          [palette.silver100, palette.chromeWhite],
        ),
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== size.width || height !== size.height) {
      setSize({ width, height });
    }
  };

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      style={[
        styles.root,
        compact ? styles.compactRoot : styles.defaultRoot,
        disabled && styles.disabledRoot,
        style,
      ]}
      {...props}
      onLayout={(event) => {
        onLayout(event);
        props.onLayout?.(event);
      }}
      onPressIn={(event) => {
        slide.value = withTiming(1, {
          duration: durations.chromeSlide,
          easing: easings.luxury,
        });
        state.value = withTiming(1, {
          duration: durations.buttonState,
          easing: easings.luxury,
        });
        props.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        slide.value = withTiming(0, {
          duration: durations.chromeSlide,
          easing: easings.luxury,
        });
        state.value = withTiming(0, {
          duration: durations.buttonState,
          easing: easings.luxury,
        });
        props.onPressOut?.(event);
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.glowHost,
          primary && !disabled && styles.primaryShadow,
          glowStyle,
        ]}
      >
        {primary && !disabled ? (
          <ChromeFill height={size.height} slide={slide} width={size.width} />
        ) : (
          <Animated.View
            style={[
              styles.flatFill,
              disabled ? styles.disabledFill : secondaryFillStyle,
            ]}
          />
        )}
      </Animated.View>
      <View pointerEvents="none" style={styles.content}>
        {icon}
        <Animated.Text
          style={[
            styles.label,
            compact && styles.compactLabel,
            !primary && secondaryLabelStyle,
            primary && disabled && styles.disabledLabel,
          ]}
        >
          {label.toUpperCase()}
        </Animated.Text>
      </View>
    </PressableScale>
  );
}

/**
 * The web chrome sheet: --vui-gradient-chrome at background-size 200% 200%,
 * resting at position 0% 0% (light half of the sweep) and sliding to
 * 100% 100% while pressed. A 2x panel translates inside the clipped pill.
 */
function ChromeFill({
  height,
  slide,
  width,
}: {
  height: number;
  slide: SharedValue<number>;
  width: number;
}) {
  const slideStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: -width * slide.value },
      { translateY: -height * slide.value },
    ],
  }));

  if (width === 0 || height === 0) {
    return <View style={[styles.flatFill, styles.chromeFallback]} />;
  }

  // CSS `linear-gradient(135deg, ...)` runs at a fixed 45° regardless of
  // aspect ratio. Reproduce its gradient line over the 2x panel:
  // centered, length |W·sin| + |H·cos| with W = 2·width, H = 2·height.
  const x1 = (width - height) / 2;
  const y1 = (height - width) / 2;
  const x2 = width + (width + height) / 2;
  const y2 = height + (width + height) / 2;

  return (
    <View pointerEvents="none" style={styles.chromeClip}>
      <Animated.View style={[{ width: width * 2, height: height * 2 }, slideStyle]}>
        <Svg width={width * 2} height={height * 2}>
          <Defs>
            <LinearGradient
              id="buttonChrome"
              gradientUnits="userSpaceOnUse"
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
            >
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="0.18" stopColor="#AEB6BC" />
              <Stop offset="0.38" stopColor="#3C434A" />
              <Stop offset="0.55" stopColor="#F5F7F8" />
              <Stop offset="0.76" stopColor="#7B858C" />
              <Stop offset="1" stopColor="#FFFFFF" />
            </LinearGradient>
          </Defs>
          <Rect width={width * 2} height={height * 2} fill="url(#buttonChrome)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "relative",
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  defaultRoot: {
    minHeight: 42,
    paddingHorizontal: 26,
    paddingVertical: 12,
  },
  compactRoot: {
    height: 38,
    paddingHorizontal: 20,
  },
  primaryShadow: {
    shadowColor: palette.silver100,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  disabledRoot: {
    opacity: 0.7,
  },
  glowHost: {
    borderRadius: 999,
  },
  chromeClip: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 999,
    overflow: "hidden",
  },
  chromeFallback: {
    backgroundColor: palette.silver300,
  },
  flatFill: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "transparent",
  },
  disabledFill: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  content: {
    zIndex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  label: {
    color: palette.page,
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: 1.04,
  },
  compactLabel: {
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.8,
  },
  disabledLabel: {
    color: palette.muted,
  },
});

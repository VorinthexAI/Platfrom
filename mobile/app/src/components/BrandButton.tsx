import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

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

/**
 * Brushed-chrome pill in the brand silvers. Deliberately simple: one
 * corner-to-corner gradient (the most basic LinearGradient usage — no
 * measuring, no rotation, renders identically everywhere) built only from
 * light metal tones, so no dark band can appear at any button size.
 * Press feedback = the shared scale spring plus a soft white sheen.
 */
const CHROME_COLORS = [
  "#FFFFFF",
  "#DDE2E5",
  "#AEB6BC",
  "#C9CED2",
  "#F5F7F8",
] as const;
const CHROME_LOCATIONS = [0, 0.3, 0.58, 0.8, 1] as const;

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

  // Press stands in for the web hover; opacity-only animations.
  const press = useSharedValue(0);

  const glowStyle = useAnimatedStyle(() => {
    if (!primary || disabled) {
      return { shadowOpacity: 0 };
    }
    return {
      shadowOpacity: 0.18 + press.value * 0.12,
      shadowRadius: 17 + press.value * 5,
    };
  });

  const sheenStyle = useAnimatedStyle(() => ({
    opacity: press.value * 0.22,
  }));

  const secondaryFillStyle = useAnimatedStyle(() => ({
    backgroundColor: `rgba(255, 255, 255, ${0.03 + press.value * 0.03})`,
    borderColor: interpolateColor(
      press.value,
      [0, 1],
      ["rgba(221, 226, 229, 0.18)", "rgba(221, 226, 229, 0.4)"],
    ),
  }));

  const secondaryLabelStyle = useAnimatedStyle(() => ({
    color: disabled
      ? palette.muted
      : interpolateColor(
          press.value,
          [0, 1],
          [palette.silver100, palette.chromeWhite],
        ),
  }));

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
      onPressIn={(event) => {
        press.value = withTiming(1, {
          duration: durations.buttonState,
          easing: easings.luxury,
        });
        props.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        press.value = withTiming(0, {
          duration: durations.buttonState,
          easing: easings.luxury,
        });
        props.onPressOut?.(event);
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.fillHost,
          primary && !disabled && styles.primaryShadow,
          glowStyle,
        ]}
      >
        {primary && !disabled ? (
          <View style={styles.chromeClip}>
            <LinearGradient
              colors={CHROME_COLORS}
              locations={CHROME_LOCATIONS}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Animated.View style={[styles.sheen, sheenStyle]} />
          </View>
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
  disabledRoot: {
    opacity: 0.7,
  },
  fillHost: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 999,
  },
  primaryShadow: {
    shadowColor: palette.silver100,
    shadowOffset: { width: 0, height: 0 },
  },
  chromeClip: {
    flex: 1,
    borderRadius: 999,
    overflow: "hidden",
  },
  sheen: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#FFFFFF",
    opacity: 0,
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

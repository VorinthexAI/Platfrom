import type { ReactNode } from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import {
  PressableScale,
  type PressableScaleProps,
} from "@/components/PressableScale";
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
  icon,
  label,
  style,
  variant = "secondary",
  ...props
}: BrandButtonProps) {
  const primary = variant === "primary";

  return (
    <PressableScale
      accessibilityRole="button"
      style={[
        styles.root,
        compact ? styles.compactRoot : styles.defaultRoot,
        primary ? styles.primary : styles.secondary,
        style,
      ]}
      {...props}
    >
      {primary ? (
        <ChromeFill />
      ) : (
        <View pointerEvents="none" style={styles.secondaryFill} />
      )}
      <View pointerEvents="none" style={styles.content}>
        {icon}
        <Text
          style={[
            styles.label,
            !primary && styles.secondaryLabel,
            compact && styles.compactLabel,
          ]}
        >
          {label.toUpperCase()}
        </Text>
      </View>
    </PressableScale>
  );
}

function ChromeFill() {
  return (
    <Svg
      pointerEvents="none"
      width="100%"
      height="100%"
      style={StyleSheet.absoluteFill}
    >
      <Defs>
        <LinearGradient id="buttonChrome" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.18" stopColor="#AEB6BC" />
          <Stop offset="0.38" stopColor="#3C434A" />
          <Stop offset="0.55" stopColor="#F5F7F8" />
          <Stop offset="0.76" stopColor="#7B858C" />
          <Stop offset="1" stopColor="#FFFFFF" />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" rx={999} fill="url(#buttonChrome)" />
    </Svg>
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
  primary: {
    shadowColor: palette.silver100,
    shadowOpacity: 0.18,
    shadowRadius: 17,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  secondary: {
    borderWidth: 1,
    borderColor: "rgba(221, 226, 229, 0.18)",
    overflow: "hidden",
  },
  secondaryFill: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
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
  secondaryLabel: {
    color: palette.silver100,
  },
  compactLabel: {
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.8,
  },
});

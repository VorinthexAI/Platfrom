import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "danger"
  | "icon";

export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";

export type ButtonProps = PressableProps & {
  children?: ReactNode;
  contentMode?: "label" | "raw";
  icon?: ReactNode;
  loading?: boolean;
  pressFeedback?: "opacity" | "none";
  size?: ButtonSize;
  style?: PressableProps["style"];
  textStyle?: StyleProp<TextStyle>;
  variant?: ButtonVariant;
};

export function Button({
  accessibilityState,
  accessibilityLabel,
  children,
  contentMode = "label",
  disabled,
  icon,
  loading = false,
  pressFeedback = "opacity",
  size = "md",
  style,
  textStyle,
  variant = "secondary",
  ...props
}: ButtonProps) {
  const inactive = disabled || loading;
  const resolveStyle = (state: PressableStateCallbackType) =>
    typeof style === "function" ? style(state) : style;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ??
        (variant === "icon" && typeof children === "string" ? children : undefined)
      }
      accessibilityState={{
        ...accessibilityState,
        busy: loading || accessibilityState?.busy || undefined,
        disabled: inactive || undefined,
      }}
      disabled={inactive}
      style={(state) => [
        styles.root,
        sizeStyles[size],
        variantStyles[variant],
        variant === "icon" && iconSizeStyles[size],
        contentMode === "raw" && styles.rawContent,
        disabled && !loading && variant !== "primary" && styles.disabledNonPrimary,
        inactive && styles.disabled,
        loading && styles.loading,
        state.pressed &&
          !inactive &&
          pressFeedback === "opacity" &&
          styles.pressed,
        resolveStyle(state),
        styles.radius,
      ]}
      {...props}
    >
      {loading ? <ActivityIndicator color={variant === "primary" ? "#030507" : "#F5F7F8"} /> : icon}
      {contentMode === "raw" ? children : variant !== "icon" && (
        <Text style={[styles.text, textSizeStyles[size], textVariantStyles[variant], textStyle]}>
          {children}
        </Text>
      )}
    </Pressable>
  );
}

const BUTTON_RADIUS = 999;

const sizeStyles: Record<ButtonSize, ViewStyle> = {
  xs: { gap: 4, minHeight: 28, paddingHorizontal: 10, paddingVertical: 6 },
  sm: { gap: 6, minHeight: 34, paddingHorizontal: 16, paddingVertical: 8 },
  md: { gap: 8, minHeight: 42, paddingHorizontal: 26, paddingVertical: 12 },
  lg: { gap: 10, minHeight: 50, paddingHorizontal: 32, paddingVertical: 15 },
  xl: { gap: 12, minHeight: 58, paddingHorizontal: 38, paddingVertical: 18 },
};

const textSizeStyles: Record<ButtonSize, TextStyle> = {
  xs: { fontSize: 10, lineHeight: 12 },
  sm: { fontSize: 11, lineHeight: 14 },
  md: { fontSize: 13, lineHeight: 16 },
  lg: { fontSize: 14, lineHeight: 18 },
  xl: { fontSize: 15, lineHeight: 20 },
};

const iconSizeStyles: Record<ButtonSize, ViewStyle> = {
  xs: { height: 28, width: 28 },
  sm: { height: 34, width: 34 },
  md: { height: 42, width: 42 },
  lg: { height: 50, width: 50 },
  xl: { height: 58, width: 58 },
};

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: "#DDE2E5", borderColor: "#DDE2E5" },
  secondary: { backgroundColor: "rgba(255, 255, 255, 0.03)", borderColor: "rgba(221, 226, 229, 0.18)" },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  outline: { backgroundColor: "transparent", borderColor: "#262D36" },
  danger: { backgroundColor: "#B04A4A", borderColor: "#B04A4A" },
  icon: { backgroundColor: "transparent", borderColor: "#262D36", paddingHorizontal: 0, paddingVertical: 0 },
};

const textVariantStyles: Record<ButtonVariant, TextStyle> = {
  primary: { color: "#030507" },
  secondary: { color: "#DDE2E5" },
  ghost: { color: "#DDE2E5" },
  outline: { color: "#DDE2E5" },
  danger: { color: "#F5F7F8" },
  icon: { color: "#F5F7F8" },
};

const styles = StyleSheet.create({
  radius: {
    borderRadius: BUTTON_RADIUS,
  },
  root: {
    alignItems: "center",
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.8,
  },
  disabledNonPrimary: {
    backgroundColor: "#0D1117",
  },
  pressed: {
    opacity: 0.82,
  },
  loading: {
    opacity: 1,
  },
  rawContent: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  text: {
    fontFamily: "Fraunces",
    fontWeight: "500",
  },
});

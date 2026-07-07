import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "danger"
  | "icon";

export type ButtonProps = PressableProps & {
  children?: ReactNode;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: ButtonVariant;
};

export function Button({
  children,
  disabled,
  icon,
  style,
  variant = "secondary",
  ...props
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [
        styles.root,
        styles[variant],
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
      {...props}
    >
      {icon}
      {variant !== "icon" && (
        <Text style={[styles.text, styles[`${variant}Text`]]}>{children}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 26,
    paddingVertical: 12,
  },
  primary: {
    backgroundColor: "#DDE2E5",
    borderColor: "#DDE2E5",
  },
  secondary: {
    backgroundColor: "transparent",
    borderColor: "#262D36",
  },
  ghost: {
    backgroundColor: "transparent",
    borderColor: "transparent",
    minHeight: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  outline: {
    backgroundColor: "transparent",
    borderColor: "#262D36",
  },
  danger: {
    backgroundColor: "#B04A4A",
    borderColor: "#B04A4A",
  },
  icon: {
    backgroundColor: "transparent",
    borderColor: "#262D36",
    height: 42,
    paddingHorizontal: 0,
    width: 42,
  },
  disabled: {
    backgroundColor: "#0D1117",
    opacity: 0.7,
  },
  pressed: {
    opacity: 0.82,
  },
  text: {
    fontFamily: "Fraunces",
    fontSize: 15,
    fontWeight: "500",
  },
  primaryText: {
    color: "#030507",
  },
  secondaryText: {
    color: "#DDE2E5",
  },
  ghostText: {
    color: "#DDE2E5",
  },
  outlineText: {
    color: "#DDE2E5",
  },
  dangerText: {
    color: "#F5F7F8",
  },
  iconText: {
    color: "#F5F7F8",
  },
});

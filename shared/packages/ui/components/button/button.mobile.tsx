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
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 26,
    paddingVertical: 12,
  },
  primary: {
    backgroundColor: "#8B6F47",
    borderColor: "#8B6F47",
  },
  secondary: {
    backgroundColor: "transparent",
    borderColor: "#E3DCD0",
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
    borderColor: "#E3DCD0",
  },
  danger: {
    backgroundColor: "#7F2E2E",
    borderColor: "#7F2E2E",
  },
  icon: {
    backgroundColor: "transparent",
    borderColor: "#E3DCD0",
    height: 42,
    paddingHorizontal: 0,
    width: 42,
  },
  disabled: {
    backgroundColor: "#F0EBE2",
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
    color: "#FAF7F2",
  },
  secondaryText: {
    color: "#6B6358",
  },
  ghostText: {
    color: "#8B6F47",
  },
  outlineText: {
    color: "#6B6358",
  },
  dangerText: {
    color: "#FAF7F2",
  },
  iconText: {
    color: "#1C1A17",
  },
});

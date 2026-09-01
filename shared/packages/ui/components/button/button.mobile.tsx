import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { radii } from "../../tokens";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "danger"
  | "icon";

export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";
export type ButtonShape = "pill" | "rounded";

export type ButtonProps = PressableProps & {
  children?: ReactNode;
  contentMode?: "label" | "raw";
  icon?: ReactNode;
  iconOnly?: boolean;
  loading?: boolean;
  pressFeedback?: "opacity" | "none";
  shape?: ButtonShape;
  size?: ButtonSize;
  style?: PressableProps["style"];
  textStyle?: StyleProp<TextStyle>;
  variant?: ButtonVariant;
};

type ButtonSizeContextValue = { size: ButtonSize; forced: boolean };
const ButtonSizeContext = createContext<ButtonSizeContextValue | undefined>(undefined);

export function ButtonSizeProvider({ children, force = false, overrideParent = false, size }: { children: ReactNode; force?: boolean; overrideParent?: boolean; size: ButtonSize }) {
  const parent = useContext(ButtonSizeContext);
  const value = parent?.forced && !overrideParent ? parent : { size, forced: force };
  return <ButtonSizeContext.Provider value={value}>{children}</ButtonSizeContext.Provider>;
}

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReducedMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

function ButtonLoadingFill({ primary, reducedMotion }: { primary: boolean; reducedMotion: boolean }) {
  const [rise] = useState(() => new Animated.Value(0));

  useEffect(() => {
    rise.stopAnimation();
    if (reducedMotion) {
      rise.setValue(1);
      return;
    }

    rise.setValue(0);
    const animation = Animated.timing(rise, {
      duration: 1400,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reducedMotion, rise]);

  return (
    <Animated.View style={[styles.loadingFill, { transform: [{ scaleY: rise }] }]}>
      <View style={primary ? styles.primaryLoadingSurface : styles.darkLoadingSurface} />
    </Animated.View>
  );
}

export function Button({
  accessibilityState,
  accessibilityLabel,
  children,
  contentMode = "label",
  disabled,
  icon,
  iconOnly = false,
  loading = false,
  pressFeedback = "opacity",
  shape = "pill",
  size: requestedSize = "md",
  style,
  textStyle,
  variant = "secondary",
  ...props
}: ButtonProps) {
  const size = useContext(ButtonSizeContext)?.size ?? requestedSize;
  const inactive = disabled || loading;
  const reducedMotion = useReducedMotion();
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
      style={(state) => {
        const showPress = state.pressed && !inactive && pressFeedback === "opacity";
        return [
          styles.root,
          sizeStyles[size],
          variantStyles[variant],
          (variant === "icon" || iconOnly) && iconSizeStyles[size],
          contentMode === "raw" && styles.rawContent,
          contentMode === "raw" && variant === "primary" && iconSizeStyles[size],
          disabled && !loading && variant !== "primary" && styles.disabledNonPrimary,
          inactive && styles.disabled,
          loading && styles.loading,
          showPress && pressedVariantStyles[variant],
          showPress && !["primary", "secondary", "outline"].includes(variant) && styles.pressed,
          resolveStyle(state),
          shape === "rounded" ? styles.roundedRadius : styles.radius,
        ];
      }}
      {...props}
    >
      {({ pressed }) => {
        const showPress = pressed && !inactive && pressFeedback === "opacity";
        return (
          <>
            {loading && (
              <View pointerEvents="none" style={styles.surface}>
                <ButtonLoadingFill primary={variant === "primary"} reducedMotion={reducedMotion} />
              </View>
            )}
            {(!loading || variant !== "primary") && icon}
            {contentMode === "raw" ? children : variant !== "icon" && (
              <Text style={[
                styles.text,
                textSizeStyles[size],
                textVariantStyles[variant],
                showPress && pressedTextVariantStyles[variant],
                disabled && !loading && variant !== "primary" && styles.disabledText,
                textStyle,
              ]}>
                {children}
              </Text>
            )}
          </>
        );
      }}
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
  xs: { fontSize: 10, letterSpacing: 0.8, lineHeight: 12 },
  sm: { fontSize: 11, letterSpacing: 0.88, lineHeight: 14 },
  md: { fontSize: 13, letterSpacing: 1.04, lineHeight: 16 },
  lg: { fontSize: 14, letterSpacing: 1.12, lineHeight: 18 },
  xl: { fontSize: 15, letterSpacing: 1.2, lineHeight: 20 },
};

const iconSizeStyles: Record<ButtonSize, ViewStyle> = {
  xs: { height: 28, width: 28 },
  sm: { height: 34, width: 34 },
  md: { height: 42, width: 42 },
  lg: { height: 50, width: 50 },
  xl: { height: 58, width: 58 },
};

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: {
    backgroundColor: "#3C434A",
    borderColor: "#262D36",
  },
  secondary: { backgroundColor: "#030507", borderColor: "#262D36" },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  outline: { backgroundColor: "#030507", borderColor: "#262D36" },
  danger: { backgroundColor: "#030507", borderColor: "#262D36" },
  icon: { backgroundColor: "#030507", borderColor: "#262D36", paddingHorizontal: 0, paddingVertical: 0 },
};

const pressedVariantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: {
    opacity: 0.82,
  },
  secondary: { backgroundColor: "#080B0F", borderColor: "#262D36" },
  outline: { backgroundColor: "#080B0F", borderColor: "#262D36" },
  ghost: {},
  danger: { backgroundColor: "#080B0F", borderColor: "#262D36" },
  icon: { backgroundColor: "#080B0F", borderColor: "#262D36" },
};

const textVariantStyles: Record<ButtonVariant, TextStyle> = {
  primary: { color: "#DDE2E5" },
  secondary: { color: "#DDE2E5" },
  ghost: { color: "#DDE2E5" },
  outline: { color: "#DDE2E5" },
  danger: { color: "#F5F7F8" },
  icon: { color: "#F5F7F8" },
};

const pressedTextVariantStyles: Record<ButtonVariant, TextStyle> = {
  primary: {},
  secondary: { color: "#FFFFFF" },
  outline: { color: "#FFFFFF" },
  ghost: {},
  danger: {},
  icon: {},
};

const styles = StyleSheet.create({
  radius: {
    borderRadius: BUTTON_RADIUS,
  },
  roundedRadius: {
    borderRadius: radii.sm,
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
    backgroundColor: "#030507",
  },
  disabledText: { color: "#7B858C" },
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
    fontFamily: "Geist_600SemiBold",
  },
  surface: {
    bottom: 0,
    borderRadius: BUTTON_RADIUS,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: 0,
  },
  loadingFill: {
    bottom: 0,
    borderRadius: BUTTON_RADIUS,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: 0,
    transformOrigin: "bottom",
  },
  primaryLoadingSurface: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(221, 226, 229, 0.12)" },
  darkLoadingSurface: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "#080B0F" },
});

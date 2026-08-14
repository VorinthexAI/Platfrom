import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

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

function ChromeGradient({ muted = false }: { muted?: boolean }) {
  const gradientId = useId().replaceAll(":", "");
  const [size, setSize] = useState<{ width: number; height: number }>();
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setSize((current) => current?.width === width && current.height === height ? current : { width, height });
    }
  };
  const stops = muted
    ? [
      <Stop key="start" offset="0" stopColor="#DDE2E5" stopOpacity="0.08" />,
      <Stop key="middle" offset="0.5" stopColor="#DDE2E5" stopOpacity="0.22" />,
      <Stop key="end" offset="1" stopColor="#DDE2E5" stopOpacity="0.08" />,
    ]
    : [
      <Stop key="white-start" offset="0" stopColor="#FFFFFF" />,
      <Stop key="silver" offset="0.18" stopColor="#AEB6BC" />,
      <Stop key="graphite" offset="0.38" stopColor="#3C434A" />,
      <Stop key="white-middle" offset="0.55" stopColor="#F5F7F8" />,
      <Stop key="steel" offset="0.76" stopColor="#7B858C" />,
      <Stop key="white-end" offset="1" stopColor="#FFFFFF" />,
    ];
  return (
    <View onLayout={onLayout} pointerEvents="none" style={StyleSheet.absoluteFill}>
      {size ? (
        <Svg height={size.height} style={StyleSheet.absoluteFill} width={size.width}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
              {stops}
            </LinearGradient>
          </Defs>
          <Rect fill={`url(#${gradientId})`} height={size.height} width={size.width} />
        </Svg>
      ) : null}
    </View>
  );
}

function ButtonLoadingFill({ primary, reducedMotion }: { primary: boolean; reducedMotion: boolean }) {
  const rise = useRef(new Animated.Value(0)).current;

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
      <ChromeGradient muted={!primary} />
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
  loading = false,
  pressFeedback = "opacity",
  size = "md",
  style,
  textStyle,
  variant = "secondary",
  ...props
}: ButtonProps) {
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
          variant === "icon" && iconSizeStyles[size],
          contentMode === "raw" && styles.rawContent,
          contentMode === "raw" && variant === "primary" && iconSizeStyles[size],
          disabled && !loading && variant !== "primary" && styles.disabledNonPrimary,
          inactive && styles.disabled,
          loading && styles.loading,
          showPress && pressedVariantStyles[variant],
          showPress && !["primary", "secondary", "outline"].includes(variant) && styles.pressed,
          resolveStyle(state),
          styles.radius,
        ];
      }}
      {...props}
    >
      {({ pressed }) => {
        const showPress = pressed && !inactive && pressFeedback === "opacity";
        return (
          <>
            {(variant === "primary" || loading) && (
              <View pointerEvents="none" style={styles.surface}>
                {variant === "primary" && <ChromeGradient />}
                {loading && <ButtonLoadingFill primary={variant === "primary"} reducedMotion={reducedMotion} />}
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
    backgroundColor: "transparent",
    borderColor: "transparent",
    boxShadow: "0 0 34px rgba(221, 226, 229, 0.18)",
  },
  secondary: { backgroundColor: "rgba(255, 255, 255, 0.03)", borderColor: "rgba(221, 226, 229, 0.18)" },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  outline: { backgroundColor: "rgba(255, 255, 255, 0.03)", borderColor: "rgba(221, 226, 229, 0.18)" },
  danger: { backgroundColor: "#B04A4A", borderColor: "#B04A4A" },
  icon: { backgroundColor: "transparent", borderColor: "#262D36", paddingHorizontal: 0, paddingVertical: 0 },
};

const pressedVariantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: {
    boxShadow: "0 0 44px rgba(221, 226, 229, 0.3)",
    transform: [{ translateY: -1 }],
  },
  secondary: { backgroundColor: "rgba(255, 255, 255, 0.06)", borderColor: "rgba(221, 226, 229, 0.4)" },
  outline: { backgroundColor: "rgba(255, 255, 255, 0.06)", borderColor: "rgba(221, 226, 229, 0.4)" },
  ghost: {},
  danger: {},
  icon: {},
};

const textVariantStyles: Record<ButtonVariant, TextStyle> = {
  primary: { color: "#030507" },
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
    backgroundColor: "rgba(255, 255, 255, 0.04)",
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
});

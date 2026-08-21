import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, type LayoutChangeEvent, type ViewProps } from "react-native";

export type SkeletonProps = ViewProps & { children?: ReactNode };

export function Skeleton({ children, onLayout, style, ...props }: SkeletonProps) {
  const [width, setWidth] = useState(0);
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (width <= 0) return;
    let animation: Animated.CompositeAnimation | undefined;
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reducedMotion) => {
      if (!mounted) return;
      if (reducedMotion) {
        progress.setValue(0.5);
        return;
      }
      animation = Animated.loop(Animated.timing(progress, {
        duration: 1_350,
        easing: Easing.inOut(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }));
      animation.start();
    });
    return () => {
      mounted = false;
      animation?.stop();
      progress.stopAnimation();
      progress.setValue(0);
    };
  }, [progress, width]);

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
    onLayout?.(event);
  }

  const bandWidth = Math.max(56, width * 0.52);
  return <View onLayout={handleLayout} style={[styles.root, style]} {...props}>
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        styles.shimmer,
        {
          transform: [
            { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-bandWidth, width + bandWidth] }) },
            { skewX: "-18deg" },
          ],
          width: bandWidth,
        },
      ]}
    />
    {children}
  </View>;
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#141922",
    borderColor: "#262D36",
    borderRadius: 12,
    overflow: "hidden",
  },
  shimmer: {
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
  },
});

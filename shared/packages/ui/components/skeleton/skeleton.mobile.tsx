import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, type LayoutChangeEvent, type ViewProps } from "react-native";

export type SkeletonProps = ViewProps & { children?: ReactNode };

export function Skeleton({ children, onLayout, style, ...props }: SkeletonProps) {
  const [size, setSize] = useState({ height: 0, width: 0 });
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (size.height <= 0 || size.width <= 0) return;
    let animation: Animated.CompositeAnimation | undefined;
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reducedMotion) => {
      if (!mounted) return;
      if (reducedMotion) {
        progress.setValue(0.5);
        return;
      }
      progress.setValue(0);
      animation = Animated.loop(Animated.sequence([
        Animated.timing(progress, {
          duration: 1_800,
          easing: Easing.bezier(0.45, 0, 0.2, 1),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          duration: 0,
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.delay(180),
      ]), { resetBeforeIteration: false });
      animation.start();
    });
    return () => {
      mounted = false;
      animation?.stop();
      progress.stopAnimation();
      progress.setValue(0);
    };
  }, [progress, size.height, size.width]);

  function handleLayout(event: LayoutChangeEvent) {
    const { height, width } = event.nativeEvent.layout;
    setSize((current) => current.height === height && current.width === width ? current : { height, width });
    onLayout?.(event);
  }

  const bandWidth = Math.max(56, size.width * 0.46);
  return <View onLayout={handleLayout} style={[styles.root, style]} {...props}>
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        styles.shimmer,
        {
          height: size.height,
          opacity: progress.interpolate({ inputRange: [0, 0.16, 0.5, 0.84, 1], outputRange: [0, 0.2, 0.34, 0.16, 0] }),
          transform: [
            { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-bandWidth, size.width + bandWidth] }) },
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
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    left: 0,
    position: "absolute",
    top: 0,
  },
});

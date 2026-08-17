import { useEffect, useId, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from "react-native-svg";

export type LoadingTextProps = {
  style?: StyleProp<ViewStyle>;
  text: string;
};

export function LoadingText({ style, text }: LoadingTextProps) {
  const gradientId = useId().replaceAll(":", "");
  const [opacity] = useState(() => new Animated.Value(0.5));

  useEffect(() => {
    let animation: Animated.CompositeAnimation | undefined;
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reducedMotion) => {
      if (!mounted || reducedMotion) return;
      animation = Animated.loop(Animated.sequence([
        Animated.timing(opacity, { duration: 900, toValue: 1, useNativeDriver: true }),
        Animated.timing(opacity, { duration: 900, toValue: 0.5, useNativeDriver: true }),
      ]));
      animation.start();
    });
    return () => {
      mounted = false;
      animation?.stop();
      opacity.stopAnimation();
    };
  }, [opacity]);

  return <Animated.View accessibilityLabel={text} accessibilityRole="text" style={[styles.root, style, { opacity }]}>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.svg}>
      <Svg height="24" width="100%">
        <Defs>
          <LinearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
            <Stop offset="0" stopColor="#56616B" />
            <Stop offset="0.5" stopColor="#F5F7F8" />
            <Stop offset="1" stopColor="#56616B" />
          </LinearGradient>
        </Defs>
        <SvgText fill={`url(#${gradientId})`} fontFamily="Geist_400Regular" fontSize="13" x="0" y="17">{text}</SvgText>
      </Svg>
    </View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  root: { minHeight: 24, width: "100%" },
  svg: { flex: 1 },
});

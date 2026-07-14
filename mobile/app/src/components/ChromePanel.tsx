import { useState, type ReactNode } from "react";
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

export type ChromePanelProps = Omit<ViewProps, "style"> & {
  children?: ReactNode;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Native equivalent of the web chrome-border, gradient-panel, and
 * card-depth surface. The SVG surface is drawn with MEASURED pixel
 * dimensions, never percentages — percentage-sized rects render short of
 * the box on Android, leaving the panel fill smaller than its border.
 */
export function ChromePanel({
  children,
  radius = 24,
  style,
  ...props
}: ChromePanelProps) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (
      width > 0 &&
      height > 0 &&
      (size === null || size.width !== width || size.height !== height)
    ) {
      setSize({ width, height });
    }
  };

  return (
    <View
      onLayout={onLayout}
      style={[styles.root, { borderRadius: radius }, style]}
      {...props}
    >
      {size ? (
        <Svg
          pointerEvents="none"
          width={size.width}
          height={size.height}
          style={StyleSheet.absoluteFill}
        >
          <Defs>
            <LinearGradient id="panelFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#12161E" />
              <Stop offset="1" stopColor="#030507" />
            </LinearGradient>
            <LinearGradient id="panelBorder" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.42} />
              <Stop offset="0.5" stopColor="#7B858C" stopOpacity={0.18} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.12} />
            </LinearGradient>
          </Defs>
          <Rect
            x={0.75}
            y={0.75}
            width={size.width - 1.5}
            height={size.height - 1.5}
            rx={radius}
            fill="url(#panelFill)"
            stroke="url(#panelBorder)"
            strokeWidth={1.5}
          />
        </Svg>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "relative",
    shadowColor: "#000000",
    shadowOpacity: 0.85,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 22 },
    elevation: 14,
  },
});

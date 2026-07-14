import type { ReactNode } from "react";
import {
  StyleSheet,
  View,
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

/** Native equivalent of the web chrome-border, gradient-panel, and card-depth surface. */
export function ChromePanel({
  children,
  radius = 24,
  style,
  ...props
}: ChromePanelProps) {
  return (
    <View style={[styles.root, { borderRadius: radius }, style]} {...props}>
      <Svg
        pointerEvents="none"
        width="100%"
        height="100%"
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
          width="99.6%"
          height="99.6%"
          rx={radius}
          fill="url(#panelFill)"
          stroke="url(#panelBorder)"
          strokeWidth={1.5}
        />
      </Svg>
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

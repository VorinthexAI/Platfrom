import { Canvas as FiberCanvas } from "@react-three/fiber";
import type { ComponentProps, CSSProperties } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";

export type CanvasProps = Omit<ComponentProps<typeof FiberCanvas>, "style"> & {
  style?: StyleProp<ViewStyle>;
};

/**
 * Platform-split three.js canvas. This web variant flattens React Native
 * styles into CSS for @react-three/fiber's DOM renderer; native resolves
 * Canvas.native.tsx (expo-gl) via Metro instead.
 */
export function Canvas({ style, ...props }: CanvasProps) {
  const flattened = StyleSheet.flatten(style) as CSSProperties | undefined;
  return <FiberCanvas {...props} style={flattened} />;
}

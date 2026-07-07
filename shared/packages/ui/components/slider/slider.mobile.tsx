import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
export type SliderProps = ViewProps & { children?: ReactNode };
export function Slider({ style, ...props }: SliderProps) {
  return <View style={[styles.root, style]} {...props} />;
}
const styles = StyleSheet.create({
  root: {
    borderColor: "#262D36",
    borderRadius: 12,
  },
});

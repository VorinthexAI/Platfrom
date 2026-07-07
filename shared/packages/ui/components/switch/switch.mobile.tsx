import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
export type SwitchProps = ViewProps & { children?: ReactNode };
export function Switch({ style, ...props }: SwitchProps) {
  return <View style={[styles.root, style]} {...props} />;
}
const styles = StyleSheet.create({
  root: {
    borderColor: "#262D36",
    borderRadius: 12,
  },
});

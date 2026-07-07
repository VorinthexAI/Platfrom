import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
export type RadioGroupProps = ViewProps & { children?: ReactNode };
export function RadioGroup({ style, ...props }: RadioGroupProps) {
  return <View style={[styles.root, style]} {...props} />;
}
const styles = StyleSheet.create({
  root: {
    borderColor: "#262D36",
    borderRadius: 12,
  },
});

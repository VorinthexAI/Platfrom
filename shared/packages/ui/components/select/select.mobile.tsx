import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
export type SelectProps = ViewProps & { children?: ReactNode };
export function Select({ style, ...props }: SelectProps) {
  return <View style={[styles.root, style]} {...props} />;
}
const styles = StyleSheet.create({
  root: {
    borderColor: "#E3DCD0",
    borderRadius: 12,
  },
});

import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
export type AlertProps = ViewProps & { children?: ReactNode };
export function Alert({ style, ...props }: AlertProps) {
  return <View style={[styles.root, style]} {...props} />;
}
const styles = StyleSheet.create({
  root: {
    borderColor: "#E3DCD0",
    borderRadius: 12,
  },
});

import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
export type DrawerProps = ViewProps & { children?: ReactNode };
export function Drawer({ style, ...props }: DrawerProps) {
  return <View style={[styles.root, style]} {...props} />;
}
const styles = StyleSheet.create({
  root: {
    borderColor: "#262D36",
    borderRadius: 12,
  },
});

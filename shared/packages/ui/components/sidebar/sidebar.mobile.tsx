import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
export type SidebarProps = ViewProps & { children?: ReactNode };
export function Sidebar({ style, ...props }: SidebarProps) {
  return <View style={[styles.root, style]} {...props} />;
}
const styles = StyleSheet.create({
  root: {
    borderColor: "#E3DCD0",
    borderRadius: 12,
  },
});

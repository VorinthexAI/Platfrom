import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
export type ContextMenuProps = ViewProps & { children?: ReactNode };
export function ContextMenu({ style, ...props }: ContextMenuProps) {
  return <View style={[styles.root, style]} {...props} />;
}
const styles = StyleSheet.create({
  root: {
    borderColor: "#E3DCD0",
    borderRadius: 12,
  },
});

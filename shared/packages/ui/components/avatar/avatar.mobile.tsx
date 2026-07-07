import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
export type AvatarProps = ViewProps & { children?: ReactNode };
export function Avatar({ style, ...props }: AvatarProps) {
  return <View style={[styles.root, style]} {...props} />;
}
const styles = StyleSheet.create({
  root: {
    borderColor: "#262D36",
    borderRadius: 12,
  },
});

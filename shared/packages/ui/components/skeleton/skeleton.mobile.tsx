import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
export type SkeletonProps = ViewProps & { children?: ReactNode };
export function Skeleton({ style, ...props }: SkeletonProps) {
  return <View style={[styles.root, style]} {...props} />;
}
const styles = StyleSheet.create({
  root: {
    borderColor: "#E3DCD0",
    borderRadius: 12,
  },
});

import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
export type PopoverProps = ViewProps & { children?: ReactNode };
export function Popover({ style, ...props }: PopoverProps) {
  return <View style={[styles.root, style]} {...props} />;
}
const styles = StyleSheet.create({
  root: {
    borderColor: "#262D36",
    borderRadius: 12,
  },
});

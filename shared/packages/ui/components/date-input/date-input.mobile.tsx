import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { colors } from "../../tokens";
export type DateInputProps = ViewProps & { children?: ReactNode };
export function DateInput({ style, ...props }: DateInputProps) {
  return <View style={[styles.root, style, styles.background]} {...props} />;
}
const styles = StyleSheet.create({
  root: {
    borderColor: "#262D36",
    borderRadius: 12,
  },
  background: { backgroundColor: colors.page },
});

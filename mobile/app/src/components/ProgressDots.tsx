import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { palette } from "@/theme/tokens";

export type ProgressDotsProps = {
  count: number;
  activeIndex: number;
  style?: StyleProp<ViewStyle>;
};

/** Monochrome progress marker. */
export function ProgressDots({ count, activeIndex, style }: ProgressDotsProps) {
  return (
    <View style={[styles.row, style]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.dot, i === activeIndex && styles.active]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.silver700,
  },
  active: {
    width: 6,
    height: 6,
    backgroundColor: palette.silver100,
  },
});

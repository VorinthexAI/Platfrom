import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { fetchCapabilityContent } from "@/data/mock";
import { durations, easings } from "@/theme/motion";
import { fonts, palette, radii } from "@/theme/tokens";

function GoalRow({
  goal,
  note,
  progress,
  delay,
}: {
  goal: string;
  note: string;
  progress: number;
  delay: number;
}) {
  const fill = useSharedValue(0);

  useEffect(() => {
    fill.value = withDelay(
      delay,
      withTiming(progress, { duration: durations.reveal, easing: easings.out }),
    );
  }, [delay, fill, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fill.value * 100}%`,
  }));

  return (
    <View style={styles.row} accessibilityLabel={`${goal}: ${note}`}>
      <View style={styles.rowHeader}>
        <Text style={styles.goal}>{goal}</Text>
        <Text style={styles.note}>{note}</Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, fillStyle]} />
      </View>
    </View>
  );
}

export function AscendContent() {
  const { data } = useQuery({
    queryKey: ["capability", "ascend"],
    queryFn: () => fetchCapabilityContent("ascend"),
  });

  return (
    <View style={{ gap: 10 }}>
      {(data ?? []).map((item, index) => (
        <GoalRow
          key={item.id}
          goal={item.goal}
          note={item.note}
          progress={item.progress}
          delay={index * 120}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  goal: {
    color: palette.silver100,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  note: {
    color: palette.silver500,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: palette.gunmetal,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: palette.silver300,
  },
});

import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";
import { SignalIcon } from "@vorinthex/shared/ui/icons-mobile";

import { ListRow } from "@/components/ListRow";
import { SIGNAL_FILTERED_COUNT, fetchCapabilityContent } from "@/data/mock";
import { fonts, palette } from "@/theme/tokens";

export function SignalContent() {
  const { data } = useQuery({
    queryKey: ["capability", "signal"],
    queryFn: () => fetchCapabilityContent("signal"),
  });

  return (
    <View style={styles.root}>
      {(data ?? []).map((item) => (
        <ListRow
          key={item.id}
          icon={<SignalIcon size="sm" variant="accent" />}
          title={item.sender}
          subtitle={item.subject}
          right={<Text style={styles.time}>{item.time}</Text>}
        />
      ))}
      <Text style={styles.filtered}>
        {SIGNAL_FILTERED_COUNT} low-priority messages filtered today
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 10,
  },
  time: {
    color: palette.silver500,
    fontFamily: fonts.regular,
    fontSize: 11,
  },
  filtered: {
    marginTop: 10,
    textAlign: "center",
    color: palette.silver500,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
});

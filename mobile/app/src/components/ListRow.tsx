import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MoreHorizontalIcon } from "@vorinthex/shared/ui/icons-mobile";

import { PressableScale } from "@/components/PressableScale";
import { fonts, palette, radii } from "@/theme/tokens";

export type ListRowProps = {
  icon?: ReactNode;
  title: string;
  subtitle: string;
  right?: ReactNode;
};

/** Obsidian panel row used across capability content lists. */
export function ListRow({ icon, title, subtitle, right }: ListRowProps) {
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={title} style={styles.row}>
      {icon ? <View style={styles.iconWell}>{icon}</View> : null}
      <View style={styles.textBlock}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {right ?? <MoreHorizontalIcon size="sm" variant="muted" />}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  iconWell: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  textBlock: {
    flex: 1,
    gap: 3,
  },
  title: {
    color: palette.silver100,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  subtitle: {
    color: palette.silver500,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
});

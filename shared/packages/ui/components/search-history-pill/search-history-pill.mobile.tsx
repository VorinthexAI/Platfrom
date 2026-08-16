import { StyleSheet, Text, View, type ViewProps } from "react-native";

import { Badge } from "../badge/badge.mobile";
import { Button } from "../button/button.mobile";
import { CloseIcon } from "../../icons/close/close.mobile";

export type SearchHistoryPillProps = Omit<ViewProps, "children"> & {
  count: number;
  disabled?: boolean;
  onPress: () => void;
  onRemove: () => void;
  query: string;
  removing?: boolean;
};

export function SearchHistoryPill({ count, disabled, onPress, onRemove, query, removing = false, style, ...props }: SearchHistoryPillProps) {
  return (
    <View style={[styles.root, style]} {...props}>
      <Button accessibilityLabel={`Remove ${query} from search history`} contentMode="raw" disabled={disabled} loading={removing} onPress={onRemove} size="xs" style={styles.remove} variant="ghost"><CloseIcon size="sm" /></Button>
      <Button accessibilityLabel={`Search for ${query}`} contentMode="raw" disabled={disabled || removing} onPress={onPress} size="md" style={styles.queryButton} variant="ghost">
        <Text numberOfLines={1} style={styles.query}>{query}</Text>
        <Badge accessibilityLabel={`Used ${count} ${count === 1 ? "time" : "times"}`} style={styles.badge}><Text style={styles.badgeText}>{count}x</Text></Badge>
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%", minHeight: 48, padding: 3, flexDirection: "row", alignItems: "center", borderRadius: 999, borderColor: "rgba(221, 226, 229, 0.14)", borderWidth: 1, backgroundColor: "#0D1117" },
  remove: { width: 40, height: 40, paddingHorizontal: 0 },
  queryButton: { minWidth: 0, minHeight: 40, flex: 1, gap: 8, paddingLeft: 6, paddingRight: 8, flexDirection: "row", justifyContent: "space-between", overflow: "hidden" },
  query: { minWidth: 0, flex: 1, flexShrink: 1, color: "#F5F7F8", fontFamily: "Geist_500Medium", fontSize: 13 },
  badge: { minWidth: 30, height: 24, flexShrink: 0, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderColor: "rgba(221, 226, 229, 0.14)", borderWidth: 1, borderRadius: 999, backgroundColor: "#141922" },
  badgeText: { color: "#AEB6BC", fontFamily: "Geist_500Medium", fontSize: 10 },
});

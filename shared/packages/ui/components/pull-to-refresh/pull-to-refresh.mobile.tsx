import { RefreshControl, type StyleProp, type ViewStyle } from "react-native";
import type { ReactNode } from "react";
import { colors } from "../../tokens";

export interface PullToRefreshProps {
  children?: ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
  enabled?: boolean;
  progressViewOffset?: number;
  style?: StyleProp<ViewStyle>;
}

export function PullToRefresh({ children, enabled = true, onRefresh, progressViewOffset, refreshing, style }: PullToRefreshProps) {
  return (
    <RefreshControl
      colors={[colors.accent]}
      enabled={enabled}
      onRefresh={onRefresh}
      progressBackgroundColor={colors.panelRaised}
      progressViewOffset={progressViewOffset}
      refreshing={refreshing}
      style={style}
      tintColor={colors.accent}
      title={refreshing ? "Refreshing" : undefined}
      titleColor={colors.muted}
    >{children}</RefreshControl>
  );
}

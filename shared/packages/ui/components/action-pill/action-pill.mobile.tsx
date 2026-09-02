import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";

import { Button, ButtonSizeProvider } from "../button/button.mobile";

export type ActionPillProps = Omit<ViewProps, "children"> & {
  action?: ReactNode;
  actionLabel?: string;
  children: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  onAction?: () => void;
  onPress?: () => void;
  pressLabel?: string;
};

export function ActionPill({ action, actionLabel, children, compact = false, disabled, onAction, onPress, pressLabel, style, ...props }: ActionPillProps) {
  const pill = <View style={[styles.root, compact && styles.compactRoot, style]} {...props}>
    {onPress ? <Button accessibilityLabel={pressLabel} contentMode="raw" disabled={disabled} onPress={onPress} size="sm" style={[styles.main, compact && styles.compactMain]} variant="ghost">{children}</Button> : <View style={[styles.main, compact && styles.compactMain]}>{children}</View>}
    {action && onAction ? <Button accessibilityLabel={actionLabel} contentMode="raw" disabled={disabled} hitSlop={6} onPress={onAction} size="xs" style={[styles.action, compact && styles.compactAction]} variant="secondary">{action}</Button> : null}
  </View>;
  return compact ? <ButtonSizeProvider overrideParent size="sm">{pill}</ButtonSizeProvider> : pill;
}

const styles = StyleSheet.create({
  root: { width: "100%", minHeight: 48, padding: 2, flexDirection: "row", alignItems: "center", borderRadius: 999, borderColor: "rgba(221, 226, 229, 0.18)", borderWidth: 1, backgroundColor: "rgba(255, 255, 255, 0.03)" },
  main: { minWidth: 0, minHeight: 42, flex: 1, paddingHorizontal: 14, alignItems: "center", justifyContent: "flex-start", overflow: "hidden" },
  action: { width: 32, height: 32, marginRight: 6, paddingHorizontal: 0, paddingVertical: 0 },
  compactRoot: { height: 38, minHeight: 38, borderColor: "rgba(221, 226, 229, 0.14)", backgroundColor: "transparent" },
  compactMain: { height: 32, minHeight: 32, paddingHorizontal: 10 },
  compactAction: { width: 22, height: 22, minHeight: 22 },
});

import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";

import { Button, ButtonSizeProvider } from "../button/button.mobile";
import { colors } from "../../tokens";

export type ActionPillProps = Omit<ViewProps, "children"> & {
  action?: ReactNode;
  actionLabel?: string;
  actionSelected?: boolean;
  appearance?: "default" | "plain" | "reorder";
  children: ReactNode;
  compact?: boolean;
  dense?: boolean;
  disabled?: boolean;
  fitContent?: boolean;
  onAction?: () => void;
  onLongPress?: () => void;
  onPress?: () => void;
  pressLabel?: string;
  secondaryAction?: ReactNode;
  secondaryActionLabel?: string;
  secondaryActionSelected?: boolean;
  onSecondaryAction?: () => void;
};

export function ActionPill({ action, actionLabel, actionSelected, appearance = "default", children, compact = false, dense = false, disabled, fitContent = false, onAction, onLongPress, onPress, onSecondaryAction, pressLabel, secondaryAction, secondaryActionLabel, secondaryActionSelected, style, ...props }: ActionPillProps) {
  const reorder = appearance === "reorder";
  const plain = appearance === "plain";
  const pill = <View style={[styles.root, compact && styles.compactRoot, dense && styles.denseRoot, fitContent && styles.fitRoot, plain && styles.plainRoot, reorder && styles.reorderRoot, style]} {...props}>
    {onPress ? <Button accessibilityLabel={pressLabel} contentMode="raw" disabled={disabled} onLongPress={onLongPress} onPress={onPress} size="sm" style={[styles.main, compact && styles.compactMain, dense && styles.denseMain, fitContent && styles.fitMain, reorder && styles.reorderMain]} variant="ghost">{children}</Button> : <View style={[styles.main, styles.staticMain, compact && styles.compactMain, dense && styles.denseMain, fitContent && styles.fitMain, reorder && styles.reorderMain]}>{children}</View>}
    {action && onAction ? <Button accessibilityLabel={actionLabel} accessibilityState={{ selected: actionSelected }} contentMode="raw" disabled={disabled} hitSlop={6} onPress={onAction} size="xs" style={[styles.action, compact && styles.compactAction, dense && styles.denseAction, reorder && styles.reorderAction]} variant={actionSelected ? "primary" : plain ? "icon" : "secondary"}>{action}</Button> : null}
    {secondaryAction && onSecondaryAction ? <Button accessibilityLabel={secondaryActionLabel} accessibilityState={{ selected: secondaryActionSelected }} contentMode="raw" disabled={disabled} hitSlop={6} onPress={onSecondaryAction} size="xs" style={[styles.action, compact && styles.compactAction, dense && styles.denseAction, reorder && styles.reorderAction, reorder && styles.reorderLastAction]} variant={secondaryActionSelected ? "primary" : "secondary"}>{secondaryAction}</Button> : null}
  </View>;
  return compact ? <ButtonSizeProvider overrideParent size={dense ? "xs" : "sm"}>{pill}</ButtonSizeProvider> : pill;
}

const styles = StyleSheet.create({
  root: { width: "100%", minHeight: 48, padding: 2, flexDirection: "row", alignItems: "center", borderRadius: 999, borderColor: "rgba(221, 226, 229, 0.18)", borderWidth: 1, backgroundColor: "rgba(255, 255, 255, 0.03)" },
  main: { minWidth: 0, minHeight: 42, flex: 1, paddingHorizontal: 14, alignItems: "center", justifyContent: "flex-start", overflow: "hidden" },
  staticMain: { alignItems: "flex-start", justifyContent: "center" },
  action: { width: 32, height: 32, marginRight: 6, paddingHorizontal: 0, paddingVertical: 0 },
  compactRoot: { height: 38, minHeight: 38, borderColor: "rgba(221, 226, 229, 0.14)", backgroundColor: "transparent" },
  compactMain: { height: 32, minHeight: 32, paddingHorizontal: 10 },
  compactAction: { width: 22, height: 22, minHeight: 22 },
  denseRoot: { height: 28, minHeight: 28, padding: 1 },
  denseMain: { flexBasis: "auto", height: 24, minHeight: 24, paddingHorizontal: 8 },
  denseAction: { width: 22, height: 22, minHeight: 22, marginRight: 2 },
  fitRoot: { alignSelf: "flex-start", width: "auto" },
  fitMain: { flex: 0, flexBasis: "auto", flexShrink: 1, width: "auto" },
  plainRoot: { backgroundColor: "transparent", borderWidth: 0, padding: 0 },
  reorderRoot: { backgroundColor: colors.page, borderColor: colors.hairline, height: 48, minHeight: 48, padding: 0 },
  reorderMain: { height: 46, minHeight: 46, paddingLeft: 8, paddingRight: 12 },
  reorderAction: { backgroundColor: colors.page, height: 32, minHeight: 32, marginRight: 4, paddingHorizontal: 0, paddingVertical: 0, width: 32 },
  reorderLastAction: { marginRight: 8 },
});

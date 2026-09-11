import { Button } from "@vorinthex/shared/ui/button";
import { CloseIcon } from "@vorinthex/shared/ui/icons-mobile";
import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, palette, spacing } from "@/theme/tokens";

export function OnboardingStepLayout({
  action,
  children,
  closeDisabled = false,
  closeLabel,
  description,
  descriptionAfterChildren = false,
  icon,
  onClose,
  title,
}: {
  action: ReactNode;
  children?: ReactNode;
  closeDisabled?: boolean;
  closeLabel?: string;
  description: string;
  descriptionAfterChildren?: boolean;
  icon?: ReactNode;
  onClose?: () => void;
  title: string;
}) {
  const insets = useSafeAreaInsets();

  return <View style={[styles.root, { paddingBottom: Math.max(insets.bottom, spacing.md), paddingTop: Math.max(insets.top, spacing.md) }]}>
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {onClose ? <View style={styles.close}><Button accessibilityLabel={closeLabel ?? "Close"} contentMode="raw" disabled={closeDisabled} iconOnly onPress={onClose} size="md" variant="ghost"><CloseIcon size="sm" /></Button></View> : null}
    </View>
    <View style={styles.hero}>
      {icon ? <View style={styles.icon}><View style={styles.iconScale}>{icon}</View></View> : null}
      {!descriptionAfterChildren ? <Text style={styles.description}>{description}</Text> : null}
      {children}
      {descriptionAfterChildren ? <Text style={styles.description}>{description}</Text> : null}
    </View>
    <View style={styles.footer}>{action}</View>
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: palette.page, flex: 1, justifyContent: "space-between", paddingHorizontal: spacing.lg },
  header: { alignItems: "flex-start", justifyContent: "center", minHeight: 48, position: "relative" },
  close: { position: "absolute", right: -spacing.xs, top: 0, zIndex: 2 },
  hero: { alignItems: "center", flex: 1, gap: spacing.md, justifyContent: "center" },
  icon: { alignItems: "center", height: 88, justifyContent: "center", width: 88 },
  iconScale: { transform: [{ scale: 2 }] },
  title: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 20, lineHeight: 26, paddingRight: 48, textAlign: "left", width: "100%" },
  description: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, maxWidth: 350, textAlign: "center" },
  footer: { gap: spacing.sm },
});

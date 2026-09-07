import type { ReactNode } from "react";
import { Modal as NativeModal, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, ButtonSizeProvider } from "../button/button.mobile";
import { ToastViewport } from "../toast/toast.mobile";
import { CloseIcon } from "../../icons/close/close.mobile";
import { colors, radii, spacing } from "../../tokens";

export type DialogProps = {
  children?: ReactNode;
  description?: string;
  dismissible?: boolean;
  footer?: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
};

export function Dialog({ children, description, dismissible = true, footer, onOpenChange, open, title }: DialogProps) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const close = () => { if (dismissible) onOpenChange(false); };
  const availableHeight = height - insets.top - insets.bottom;

  return <NativeModal animationType="fade" onRequestClose={close} statusBarTranslucent transparent visible={open}>
    <ButtonSizeProvider force size="md">
      <View accessibilityViewIsModal style={[styles.viewport, { paddingBottom: insets.bottom, paddingTop: insets.top }]}>
        <Button accessibilityLabel={`Close ${title}`} contentMode="raw" disabled={!dismissible} iconOnly onPress={close} pressFeedback="none" size="md" style={StyleSheet.absoluteFill} variant="ghost" />
        <View style={[styles.surface, { height: availableHeight * 0.8, width: width * 0.8 }]}>
          <View style={styles.header}>
            <View style={styles.heading}><Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{title}</Text>{description ? <Text style={styles.description}>{description}</Text> : null}</View>
            <Button accessibilityLabel={`Close ${title}`} contentMode="raw" disabled={!dismissible} iconOnly onPress={close} size="md" variant="secondary"><CloseIcon size="sm" /></Button>
          </View>
          <View style={styles.content}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
        <ToastViewport />
      </View>
    </ButtonSizeProvider>
  </NativeModal>;
}

const styles = StyleSheet.create({
  viewport: { alignItems: "center", backgroundColor: "rgba(0, 0, 0, 0.72)", flex: 1, justifyContent: "center" },
  surface: { backgroundColor: colors.panelRaised, borderColor: colors.hairlineBright, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, maxHeight: "80%", maxWidth: "80%", overflow: "hidden" },
  header: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  heading: { flex: 1, gap: spacing.xs, minWidth: 0 },
  title: { color: colors.text, fontSize: 20, fontWeight: "600", lineHeight: 26 },
  description: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  content: { flex: 1, minHeight: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  footer: { gap: spacing.sm, padding: spacing.lg },
});

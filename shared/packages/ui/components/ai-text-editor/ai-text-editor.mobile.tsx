import { forwardRef } from "react";
import { Keyboard, StyleSheet, View, type StyleProp, type TextInput as NativeTextInput, type ViewStyle } from "react-native";

import { BrainIcon } from "../../icons/brain/brain.mobile";
import { ClockIcon } from "../../icons/clock/clock.mobile";
import { colors, radii, spacing } from "../../tokens";
import { Button } from "../button/button.mobile";
import { Skeleton } from "../skeleton/skeleton.mobile";
import { TextInput, type TextInputProps } from "../text-input/text-input.mobile";

export type AiTextEditorProps = TextInputProps & {
  containerStyle?: StyleProp<ViewStyle>;
  onOpenActions?: () => void;
  onOpenHistory?: () => void;
  transformation?: "enhance" | "translate";
  value: string;
};

export const AiTextEditor = forwardRef<NativeTextInput, AiTextEditorProps>(function AiTextEditor({ accessibilityLabel, containerStyle, onOpenActions, onOpenHistory, style, transformation, value, ...props }, ref) {
  const label = typeof accessibilityLabel === "string" ? accessibilityLabel : "Text";
  return <View style={[styles.root, containerStyle, styles.background]}>
    {transformation ? <View accessibilityLabel={`${transformation === "enhance" ? "Enhancing" : "Translating"} ${label.toLocaleLowerCase()}`} accessibilityRole="progressbar" style={styles.transformation}><Skeleton style={styles.skeleton} /></View> : <>
      <TextInput {...props} accessibilityLabel={accessibilityLabel} ref={ref} style={[styles.input, style]} value={value} />
      <View style={styles.actions}>{onOpenHistory ? <Button accessibilityLabel={`${label} history`} icon={<ClockIcon size="sm" />} iconOnly onPress={() => { Keyboard.dismiss(); onOpenHistory(); }} size="md" style={styles.aiButton} variant="icon" /> : null}{onOpenActions ? <Button accessibilityLabel={`${label} AI actions`} icon={<BrainIcon size="sm" />} iconOnly onPress={() => { Keyboard.dismiss(); onOpenActions(); }} size="md" style={styles.aiButton} variant="icon" /> : null}</View>
    </>}
  </View>;
});

const styles = StyleSheet.create({
  root: { width: "100%", height: 280, overflow: "hidden", borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.page },
  background: { backgroundColor: colors.page },
  input: { width: "100%", minHeight: 0, flex: 1, flexBasis: 0, borderWidth: 0, borderRadius: 0, backgroundColor: colors.page },
  actions: { width: "100%", height: 58, minHeight: 58, maxHeight: 58, flexShrink: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: spacing.xs },
  aiButton: { width: 42, height: 42, minHeight: 42, paddingHorizontal: 0, paddingVertical: 0 },
  transformation: { width: "100%", flex: 1 },
  skeleton: { width: "100%", height: "100%", borderRadius: 0, backgroundColor: colors.hairlineBright, opacity: 0.72 },
});

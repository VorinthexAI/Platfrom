import { forwardRef } from "react";
import { StyleSheet, View, type TextInput as NativeTextInput } from "react-native";

import { BrainIcon } from "../../icons/brain/brain.mobile";
import { colors, radii, spacing } from "../../tokens";
import { Button } from "../button/button.mobile";
import { Skeleton } from "../skeleton/skeleton.mobile";
import { TextInput, type TextInputProps } from "../text-input/text-input.mobile";

export type AiTextEditorProps = TextInputProps & {
  onOpenActions: () => void;
  transformation?: "enhance" | "translate";
  value: string;
};

export const AiTextEditor = forwardRef<NativeTextInput, AiTextEditorProps>(function AiTextEditor({ accessibilityLabel, onOpenActions, style, transformation, value, ...props }, ref) {
  const label = typeof accessibilityLabel === "string" ? accessibilityLabel : "Text";
  return <View style={styles.root}>
    {transformation ? <View accessibilityLabel={`${transformation === "enhance" ? "Enhancing" : "Translating"} ${label.toLocaleLowerCase()}`} accessibilityRole="progressbar" style={styles.transformation}><Skeleton style={styles.skeleton} /></View> : <TextInput {...props} accessibilityLabel={accessibilityLabel} ref={ref} style={[style, styles.input]} value={value} />}
    {!transformation ? <Button accessibilityLabel={`${label} AI actions`} contentMode="raw" disabled={!value.trim()} iconOnly onPress={onOpenActions} size="md" style={styles.aiButton} variant="secondary"><BrainIcon size="sm" /></Button> : null}
  </View>;
});

const styles = StyleSheet.create({
  root: { width: "100%", position: "relative" },
  input: { width: "100%", minHeight: 280, paddingBottom: 64, backgroundColor: colors.page },
  aiButton: { position: "absolute", right: spacing.sm, bottom: spacing.sm, width: 42, height: 42, paddingHorizontal: 0, paddingVertical: 0, zIndex: 2, elevation: 2 },
  transformation: { width: "100%", minHeight: 280 },
  skeleton: { width: "100%", minHeight: 280, borderRadius: radii.md, backgroundColor: colors.hairlineBright, opacity: 0.72 },
});

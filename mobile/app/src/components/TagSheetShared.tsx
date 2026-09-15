import type { ComponentRef, Ref } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { PlusIcon } from "@vorinthex/shared/ui/icons-mobile";
import { TextInput } from "@vorinthex/shared/ui/text-input";

import { fonts, palette, spacing } from "@/theme/tokens";

export function TagSheetEmptyState({ onCreate }: { onCreate: () => void }) {
  return <View style={styles.emptyState}><Text style={styles.empty}>No tags yet.</Text><Button accessibilityLabel="Create tag" contentMode="raw" onPress={onCreate} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button></View>;
}

type TagCreateSheetProps = {
  creating?: boolean;
  inputRef: Ref<ComponentRef<typeof TextInput>>;
  name: string;
  onClose: () => void;
  onCreate: () => void;
  onNameChange: (name: string) => void;
  open: boolean;
};

export function TagCreateSheet({ creating = false, inputRef, name, onClose, onCreate, onNameChange, open }: TagCreateSheetProps) {
  return <BottomSheet dismissible={!creating} footer={<View style={styles.footer}><Button disabled={!name.trim() || creating} loading={creating} onPress={onCreate} size="md" variant="primary">Create</Button><Button disabled={creating} onPress={onClose} size="md" variant="secondary">Close</Button></View>} height="full" onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} open={open} title="Create tag">
    <View style={styles.form}><Text style={styles.inputLabel}>Name</Text><TextInput accessibilityLabel="Name" autoFocusInBottomSheet={false} maxLength={120} onChangeText={onNameChange} onSubmitEditing={onCreate} placeholder="Tag name" ref={inputRef} returnKeyType="done" value={name} /></View>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  emptyState: { alignItems: "center", gap: spacing.sm },
  emptyPlusButton: { alignSelf: "center" },
  empty: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
  footer: { gap: spacing.sm },
  form: { gap: spacing.xs },
  inputLabel: { color: palette.text, fontFamily: fonts.medium, fontSize: 13 },
});

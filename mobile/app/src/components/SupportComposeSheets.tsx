import { randomUUID } from "expo-crypto";
import { useRef, useState } from "react";
import { View, StyleSheet, Text } from "react-native";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { TextInput } from "@vorinthex/shared/ui/text-input";

import { useAuthStore } from "@/state/auth";
import { fonts, palette, spacing } from "@/theme/tokens";

export type SupportComposeKind = "issue" | "feedback";

export function SupportComposeSheets({ compose, onClose, onSubmit }: { compose?: SupportComposeKind; onClose: () => void; onSubmit: (input: { kind: SupportComposeKind; message: string; requestKey: string }) => void }) {
  const teamKey = useAuthStore((state) => String(state.team?.key ?? ""));
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const [message, setMessage] = useState("");
  const request = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const label = compose === "issue" ? "Issue description" : "Suggestion";

  const submit = () => {
    const value = message.trim();
    if (!compose || !value || !teamKey || !scopeKey) return;
    const fingerprint = `${compose}:${value}`;
    const requestKey = request.current?.fingerprint === fingerprint ? request.current.key : randomUUID();
    request.current = undefined;
    setMessage("");
    onSubmit({ kind: compose, message: value, requestKey });
  };

  return <BottomSheet
    focusKey={`signal-compose-${compose ?? "closed"}`}
    footer={<><Button disabled={!message.trim() || !teamKey || !scopeKey} onPress={submit} size="md" variant="primary">Send</Button><Button onPress={onClose} size="md" variant="secondary">Close</Button></>}
    height="full"
    onOpenChange={(open) => { if (!open) onClose(); }}
    open={Boolean(compose)}
    title={compose === "issue" ? "Report an issue" : "Give us feedback"}
  >
    <View style={styles.form}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} maxLength={8_000} multiline onChangeText={(value) => { request.current = undefined; setMessage(value); }} placeholder={compose === "issue" ? "What happened?" : "What would make Vorinthex AI better?"} style={styles.input} textAlignVertical="top" value={message} /></View>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  form: { gap: spacing.sm },
  label: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 12, letterSpacing: 0.4, marginLeft: 2 },
  input: { minHeight: 180 },
});

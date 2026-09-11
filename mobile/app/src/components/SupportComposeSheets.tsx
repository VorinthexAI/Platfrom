import { randomUUID } from "expo-crypto";
import { useRef, useState } from "react";
import { View, StyleSheet, Text } from "react-native";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";

import { createFeedback, createSupportTicket } from "@/lib/profile-client";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, spacing } from "@/theme/tokens";

export type SupportComposeKind = "issue" | "feedback";

export function SupportComposeSheets({ compose, onClose, onCreated }: { compose?: SupportComposeKind; onClose: () => void; onCreated: (threadKey: string) => void }) {
  const { showToast } = useToast();
  const teamKey = useAuthStore((state) => String(state.team?.key ?? ""));
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const request = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const label = compose === "issue" ? "Issue description" : "Suggestion";

  const submit = async () => {
    const value = message.trim();
    if (!compose || !value || !teamKey || !scopeKey || submitting) return;
    const fingerprint = `${compose}:${value}`;
    const requestKey = request.current?.fingerprint === fingerprint ? request.current.key : randomUUID();
    request.current = { fingerprint, key: requestKey };
    setSubmitting(true);
    try {
      const result = compose === "issue"
        ? await createSupportTicket({ teamKey, scopeKey, message: value }, requestKey)
        : await createFeedback({ teamKey, scopeKey, message: value }, requestKey);
      request.current = undefined;
      setMessage("");
      onCreated(result.threadKey);
      showToast({ title: compose === "issue" ? "Issue report sent." : "Feedback sent. Thank you!", duration: 2_500 });
    } catch {
      showToast({ title: compose === "issue" ? "Your report could not be sent." : "Your feedback could not be sent.", duration: 2_500 });
    } finally {
      setSubmitting(false);
    }
  };

  return <BottomSheet
    dismissible={!submitting}
    focusKey={`signal-compose-${compose ?? "closed"}`}
    footer={<><Button disabled={submitting || !message.trim() || !teamKey || !scopeKey} loading={submitting} onPress={() => void submit()} size="md" variant="primary">Send</Button><Button disabled={submitting} onPress={onClose} size="md" variant="secondary">Close</Button></>}
    height="full"
    onOpenChange={(open) => { if (!open && !submitting) onClose(); }}
    open={Boolean(compose)}
    title={compose === "issue" ? "Report an issue" : "Give us feedback"}
  >
    <View style={styles.form}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} editable={!submitting} maxLength={8_000} multiline onChangeText={(value) => { request.current = undefined; setMessage(value); }} placeholder={compose === "issue" ? "What happened?" : "What would make Vorinthex AI better?"} style={styles.input} textAlignVertical="top" value={message} /></View>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  form: { gap: spacing.sm },
  label: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 12, letterSpacing: 0.4, marginLeft: 2 },
  input: { minHeight: 180 },
});

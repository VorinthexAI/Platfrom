import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Share as NativeShare, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Switch } from "@vorinthex/shared/ui/switch";
import { useToast } from "@vorinthex/shared/ui/toast";

import { subscribeAppEvent } from "@/lib/app-events";
import { subscribeBookChanged } from "@/lib/book-events";
import { fetchBookShareDetail, updateBookShare, type Book, type BookShare } from "@/lib/books-client";
import { fonts, palette, spacing } from "@/theme/tokens";

const shareWasCancelled = (error: unknown) => {
  const failure = error as { code?: unknown; message?: unknown };
  return failure?.code === "ECANCELLED" || failure?.code === "E_CANCELLED" || typeof failure?.message === "string" && /cancel(?:led|ed)/i.test(failure.message);
};

export function BookSharing({ book, onClose, open }: { book: Book; onClose: () => void; open: boolean }) {
  const { showToast } = useToast();
  const [share, setShare] = useState<BookShare>();
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);

  async function load() {
    const request = ++generation.current;
    setLoading(true);
    setError(undefined);
    try {
      const next = await fetchBookShareDetail(book.key);
      if (request !== generation.current) return;
      setShare(next);
      setActive(next.active);
    } catch {
      if (request === generation.current) setError("The share link could not be loaded.");
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  const loadEvent = useEffectEvent(load);

  useEffect(() => {
    generation.current += 1;
    const timer = open ? setTimeout(() => void loadEvent(), 0) : undefined;
    return () => { if (timer) clearTimeout(timer); generation.current += 1; };
  }, [book.key, open]);

  useEffect(() => subscribeAppEvent((event) => {
    if (open && !busy && event.type === "event-stream.connected") void loadEvent();
  }), [book.key, busy, open]);
  useEffect(() => subscribeBookChanged(() => { if (open && !busy) void loadEvent(); }), [book.key, busy, open]);

  async function shareBook() {
    if (!share || busy) return;
    const request = generation.current;
    setBusy(true);
    try {
      const current = active === share.active ? share : await updateBookShare(book.key, active);
      if (request !== generation.current) return;
      setShare(current);
      setActive(current.active);
      const result = await NativeShare.share({ title: `Share ${book.title}`, message: `Listen to ${book.title} with this secure link: ${current.url}`, url: current.url }, { dialogTitle: `Share ${book.title}` });
      if (result.action !== NativeShare.dismissedAction) showToast({ title: "Audio book shared", duration: 2_000 });
    } catch (failure) {
      if (request === generation.current && !shareWasCancelled(failure)) showToast({ title: "Audio book sharing failed", duration: 2_500 });
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }

  const footer = <><Button disabled={!share || loading || busy} loading={busy} onPress={() => void shareBook()} size="md" variant="primary">Share</Button><Button disabled={busy} onPress={onClose} size="md" variant="secondary">Close</Button></>;
  return <BottomSheet dismissible={!busy} footer={footer} height="full" onOpenChange={(next) => { if (!next) onClose(); }} open={open} title="Share audio book">
    {loading ? <View accessibilityLabel="Loading audio book share link" accessibilityRole="progressbar" style={styles.content}><Skeleton style={styles.linkSkeleton} /><Skeleton style={styles.switchSkeleton} /></View> : error ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Button onPress={() => void load()} size="md" variant="secondary">Retry</Button></View> : share ? <View style={styles.content}>
      <View style={styles.linkBlock}><Text style={styles.label}>SHARE LINK</Text><Text selectable style={styles.link}>{share.url}</Text></View>
      <View style={styles.switchRow}><Switch accessibilityLabel="Audio book share active" checked={active} disabled={busy} onCheckedChange={setActive} /><Text style={styles.meta}>Active</Text></View>
    </View> : null}
  </BottomSheet>;
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: spacing.lg },
  state: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  linkBlock: { gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: palette.panel },
  label: { color: palette.muted, fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1 },
  link: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  meta: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 12 },
  error: { color: palette.danger, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  switchRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  linkSkeleton: { width: "100%", height: 74 },
  switchSkeleton: { width: 120, height: 38 },
});

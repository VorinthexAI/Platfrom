import { File } from "expo-file-system";
import { Image } from "expo-image";
import type { CameraCapturedPicture } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@vorinthex/shared/ui/button";
import { CameraIcon, CloseIcon, TrashIcon } from "@vorinthex/shared/ui/icons-mobile";
import { BrandedCameraModal } from "@/components/capability/BrandedCameraModal";
import { normalizeCapturedJpeg } from "@/lib/captured-image";
import { palette, spacing } from "@/theme/tokens";

export type DocumentScanPage = { id: string; uri: string; sizeBytes: number };
export const MAX_DOCUMENT_SCAN_PAGES = 12;

type Props = {
  busy: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (pages: DocumentScanPage[]) => void;
};

export function DocumentScanModal({ busy, error, onClose, onSubmit }: Props) {
  const insets = useSafeAreaInsets();
  const [pages, setPages] = useState<DocumentScanPage[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(true);
  const [captureError, setCaptureError] = useState<string>();
  const pagesRef = useRef<DocumentScanPage[]>([]);

  const capture = async (picture: CameraCapturedPicture) => {
    if (capturing || busy || pages.length >= MAX_DOCUMENT_SCAN_PAGES) return;
    setCapturing(true);
    setCaptureError(undefined);
    try {
      const normalized = await normalizeCapturedJpeg(picture, { maxSide: 1800, compress: 0.76 });
      setPages((current) => {
        const next = current.length >= MAX_DOCUMENT_SCAN_PAGES ? current : [...current, { id: `${Date.now()}-${Math.random()}`, uri: normalized.uri, sizeBytes: normalized.sizeBytes }];
        pagesRef.current = next;
        return next;
      });
    } catch (cause) {
      setCaptureError(cause instanceof Error ? cause.message : "The page could not be captured.");
    } finally {
      setCapturing(false);
    }
  };

  useEffect(() => {
    return () => {
      for (const page of pagesRef.current) new File(page.uri).delete();
    };
  }, []);

  const remove = (id: string) => {
    const page = pages.find((candidate) => candidate.id === id);
    if (page) new File(page.uri).delete();
    setPages((current) => {
      const next = current.filter((candidate) => candidate.id !== id);
      pagesRef.current = next;
      return next;
    });
  };

  const close = () => {
    if (busy) return;
    onClose();
  };

  return <Modal animationType="slide" onRequestClose={close} presentationStyle="fullScreen" visible>
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }]}>
      <View style={styles.header}>
        <Button accessibilityLabel="Close document scanner" contentMode="raw" disabled={busy} onPress={close} size="sm" variant="icon"><CloseIcon size="sm" /></Button>
        <View style={styles.heading}><Text style={styles.title}>Scan documents</Text><Text accessibilityLiveRegion="polite" style={styles.count}>{pages.length} of {MAX_DOCUMENT_SCAN_PAGES} pages</Text></View>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.pages}>
        {pages.map((page, index) => <View key={page.id} style={styles.page}>
          <Image contentFit="cover" source={page.uri} style={styles.preview} />
          <Text style={styles.pageLabel}>Page {index + 1}</Text>
          <Button accessibilityLabel={`Remove page ${index + 1}`} contentMode="raw" disabled={busy} onPress={() => remove(page.id)} size="xs" style={styles.remove} variant="icon"><TrashIcon size="sm" /></Button>
        </View>)}
        {!pages.length && !capturing ? <Text style={styles.empty}>Capture the first page to begin.</Text> : null}
      </ScrollView>
      {error || captureError ? <Text accessibilityRole="alert" style={styles.error}>{error ?? captureError}</Text> : null}
      <View style={styles.actions}>
        <Button disabled={busy || capturing || pages.length >= MAX_DOCUMENT_SCAN_PAGES} icon={<CameraIcon size="sm" />} loading={capturing} onPress={() => setCameraOpen(true)} size="lg" variant="secondary">Capture next</Button>
        <Button disabled={busy || capturing || pages.length === 0} loading={busy} onPress={() => onSubmit(pages)} size="lg" variant="primary">Done</Button>
      </View>
      {cameraOpen ? <BrandedCameraModal count={pages.length} maximum={MAX_DOCUMENT_SCAN_PAGES} onCapture={capture} onClose={() => { if (pages.length) setCameraOpen(false); else close(); }} onDone={() => setCameraOpen(false)} title="Scan document" /> : null}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page, paddingHorizontal: spacing.md },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.md },
  heading: { alignItems: "center", gap: 2 },
  title: { color: palette.text, fontSize: 18, fontWeight: "700" },
  count: { color: palette.muted, fontSize: 12 },
  headerSpacer: { width: 40 },
  pages: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingBottom: spacing.md },
  page: { backgroundColor: palette.surface, borderRadius: 16, overflow: "hidden", width: "48%" },
  preview: { aspectRatio: 0.72, width: "100%" },
  pageLabel: { color: palette.text, fontSize: 12, padding: spacing.sm },
  remove: { position: "absolute", right: spacing.xs, top: spacing.xs },
  empty: { color: palette.muted, paddingVertical: 80, textAlign: "center", width: "100%" },
  error: { color: palette.danger, marginBottom: spacing.sm, textAlign: "center" },
  actions: { gap: spacing.sm },
});

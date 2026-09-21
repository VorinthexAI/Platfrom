import { File } from "expo-file-system";
import { Image } from "expo-image";
import type { CameraCapturedPicture } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@vorinthex/shared/ui/button";
import { CloseIcon } from "@vorinthex/shared/ui/icons-mobile";
import { BrandedCameraModal } from "@/components/capability/BrandedCameraModal";
import { normalizeCapturedPng } from "@/lib/captured-image";
import { appendScanPage, MAX_DOCUMENT_SCAN_PAGES, removeScanPage, type ScanSessionPage } from "@/lib/document-scan-session";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

export type DocumentScanPage = ScanSessionPage;

type Props = {
  busy: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (pages: DocumentScanPage[]) => void;
};

function deleteCapturedFile(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Camera cache files may already have been removed by the platform.
  }
}

export function DocumentScanModal({ busy, error, onClose, onSubmit }: Props) {
  const [pages, setPages] = useState<DocumentScanPage[]>([]);
  const [pending, setPending] = useState(0);
  const [captureError, setCaptureError] = useState<string>();
  const pagesRef = useRef<DocumentScanPage[]>([]);

  const capture = async (picture: CameraCapturedPicture) => {
    if (busy || pagesRef.current.length >= MAX_DOCUMENT_SCAN_PAGES) return;
    setCaptureError(undefined);
    const id = `${Date.now()}-${Math.random()}`;
    setPending((count) => count + 1);
    setPages((current) => {
      const next = appendScanPage(current, { id, uri: picture.uri, sizeBytes: Math.max(1, new File(picture.uri).size) });
      pagesRef.current = next;
      return next;
    });
    try {
      const normalized = await normalizeCapturedPng(picture, { maxSide: 1800, compress: 0.76 });
      setPages((current) => {
        const next = current.map((page) => page.id === id ? { ...page, uri: normalized.uri, sizeBytes: normalized.sizeBytes } : page);
        pagesRef.current = next;
        return next;
      });
      if (picture.uri !== normalized.uri) deleteCapturedFile(picture.uri);
    } catch (cause) {
      setCaptureError(cause instanceof Error ? cause.message : "The page could not be captured.");
    } finally {
      setPending((count) => Math.max(0, count - 1));
    }
  };

  useEffect(() => {
    return () => {
      for (const page of pagesRef.current) deleteCapturedFile(page.uri);
    };
  }, []);

  const remove = (id: string) => {
    const page = pages.find((candidate) => candidate.id === id);
    if (page) deleteCapturedFile(page.uri);
    setPages((current) => {
      const next = removeScanPage(current, id);
      pagesRef.current = next;
      return next;
    });
  };

  const drawer = <View style={styles.drawer}>
    <View style={styles.drawerHeading}>
      <Text style={styles.drawerTitle}>Pages</Text>
      <Text accessibilityLiveRegion="polite" style={styles.drawerCount}>{pages.length} / {MAX_DOCUMENT_SCAN_PAGES}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.pages} horizontal showsHorizontalScrollIndicator={false}>
      {pages.map((page, index) => <View key={page.id} style={styles.page}>
        <Image contentFit="cover" source={page.uri} style={styles.preview} />
        <Text style={styles.pageLabel}>{index + 1}</Text>
        <Button accessibilityLabel={`Remove page ${index + 1}`} contentMode="raw" disabled={busy} onPress={() => remove(page.id)} size="xs" style={styles.remove} variant="icon"><CloseIcon size="sm" /></Button>
      </View>)}
    </ScrollView>
  </View>;

  return <BrandedCameraModal bottomContent={drawer} count={pages.length} countUnit="pages" disabled={busy} doneLoading={busy || pending > 0} externalError={error ?? captureError} hint="" maximum={MAX_DOCUMENT_SCAN_PAGES} onCapture={capture} onClose={onClose} onDone={() => onSubmit(pages)} title="Scan documents" />;
}

const styles = StyleSheet.create({
  drawer: { gap: spacing.xs },
  drawerHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  drawerTitle: { color: palette.text, fontFamily: fonts.semibold, fontSize: 12 },
  drawerCount: { color: palette.muted, fontFamily: fonts.medium, fontSize: 11 },
  pages: { alignItems: "center", gap: spacing.xs, minHeight: 76 },
  page: { backgroundColor: palette.surface, borderColor: palette.hairline, borderRadius: radii.md, borderWidth: 1, height: 76, overflow: "hidden", width: 58 },
  preview: { height: 76, width: 58 },
  pageLabel: { backgroundColor: "rgba(3,5,7,0.78)", bottom: 0, color: palette.text, fontFamily: fonts.semibold, fontSize: 10, left: 0, paddingHorizontal: spacing.xs, paddingVertical: 2, position: "absolute" },
  remove: { position: "absolute", right: 2, top: 2 },
});

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Pdf from "react-native-pdf";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { BrainIcon } from "../../icons/brain/brain.mobile";
import { ChevronLeftIcon } from "../../icons/chevron-left/chevron-left.mobile";
import { ClockIcon } from "../../icons/clock/clock.mobile";
import { EditIcon } from "../../icons/edit/edit.mobile";
import { MoreHorizontalIcon } from "../../icons/more-horizontal/more-horizontal.mobile";
import { colors, radii, spacing } from "../../tokens";
import { Button } from "../button/button.mobile";

export type FileViewerProps = {
  error?: string;
  loading?: boolean;
  onAi?: () => void;
  onBack: () => void;
  onEdit?: () => void;
  onHistory?: () => void;
  onMenu: () => void;
  onRenderError?: (message: string) => void;
  htmlUri?: string;
  pdfUri?: string;
  title: string;
};

export function FileViewer({ error, htmlUri, loading = false, onAi, onBack, onEdit, onHistory, onMenu, onRenderError, pdfUri, title }: FileViewerProps) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.root, { paddingBottom: insets.bottom + 78 + spacing.md }]}>
    <View style={styles.header}>
      <Button accessibilityLabel="Back" contentMode="raw" onPress={onBack} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button>
      <Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>
      <Button accessibilityLabel={`Manage ${title}`} contentMode="raw" onPress={onMenu} size="sm" variant="icon"><MoreHorizontalIcon size="sm" /></Button>
    </View>
    {onEdit || onAi || onHistory ? <View style={styles.headerActions}>
      {onEdit ? <Button accessibilityLabel="Edit extracted text" contentMode="raw" onPress={onEdit} size="sm" variant="icon"><EditIcon size="sm" /></Button> : null}
      {onAi ? <Button accessibilityLabel="AI document actions" contentMode="raw" onPress={onAi} size="sm" variant="icon"><BrainIcon size="sm" /></Button> : null}
      {onHistory ? <Button accessibilityLabel="Document and audio versions" contentMode="raw" onPress={onHistory} size="sm" variant="icon"><ClockIcon size="sm" /></Button> : null}
    </View> : null}
    <View style={styles.documentArea}>
      {loading ? <View accessibilityLabel={`Loading ${title}`} accessibilityRole="progressbar" style={styles.loadingSkeleton} />
        : error ? <View style={styles.center}><Text accessibilityRole="alert" style={styles.error}>{error}</Text></View>
          : pdfUri ? <Pdf enableDoubleTapZoom={false} enablePaging={false} fitPolicy={0} horizontal={false} maxScale={3} minScale={1} onError={(cause) => onRenderError?.(cause.message || "The PDF could not be rendered.")} source={{ uri: pdfUri, cache: false }} style={styles.pdf} trustAllCerts={false} />
            : htmlUri ? <WebView allowFileAccess allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false} javaScriptEnabled={false} onError={() => onRenderError?.("The document preview could not be rendered.")} originWhitelist={["file://*"]} source={{ uri: htmlUri }} style={styles.html} />
            : <View style={styles.center}><Text style={styles.error}>Original preview unavailable.</Text></View>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md, backgroundColor: colors.page },
  header: { minHeight: 40, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  headerTitle: { flex: 1, minWidth: 0, color: colors.text, fontFamily: "Geist_500Medium", fontSize: 15, lineHeight: 20 },
  headerActions: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: spacing.xs },
  documentArea: { flex: 1, minWidth: 0, minHeight: 0, borderRadius: radii.xl, borderColor: colors.hairline, borderWidth: 1, overflow: "hidden", backgroundColor: colors.panelRaised },
  loadingSkeleton: { flex: 1, backgroundColor: colors.hairlineBright, opacity: 0.72 },
  center: { flex: 1, padding: spacing.lg, alignItems: "center", justifyContent: "center" },
  error: { color: colors.muted, fontFamily: "Geist_400Regular", fontSize: 14, lineHeight: 21, textAlign: "center" },
  pdf: { flex: 1, width: "100%", backgroundColor: colors.panelRaised },
  html: { flex: 1, backgroundColor: colors.panelRaised },
});

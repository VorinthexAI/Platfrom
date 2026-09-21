import { File } from "expo-file-system";
import { Image } from "expo-image";
import type { CameraCapturedPicture } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@vorinthex/shared/ui/button";
import { CloseIcon } from "@vorinthex/shared/ui/icons-mobile";

import { BrandedCameraModal } from "@/components/capability/BrandedCameraModal";
import { normalizeCapturedPng } from "@/lib/captured-image";
import { MAX_GALLERY_UPLOAD_IMAGES, type PreparedGalleryUpload } from "@/lib/gallery-client";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

export const MAX_GALLERY_CAPTURES = MAX_GALLERY_UPLOAD_IMAGES;

type Props = {
  onClose: () => void;
  onSubmit: (files: PreparedGalleryUpload[]) => void;
};

function deleteCapturedFile(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Camera cache files may already have been removed by the platform.
  }
}

export function GalleryCaptureModal({ onClose, onSubmit }: Props) {
  const [files, setFiles] = useState<PreparedGalleryUpload[]>([]);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string>();
  const filesRef = useRef<PreparedGalleryUpload[]>([]);
  const submitted = useRef(false);
  const active = useRef(true);

  const capture = async (picture: CameraCapturedPicture) => {
    if (filesRef.current.length >= MAX_GALLERY_CAPTURES) return;
    setError(undefined);
    const timestamp = Date.now();
    const clientKey = `${timestamp}-${Math.random().toString(36).slice(2)}`;
    const preview: PreparedGalleryUpload = { clientKey, filename: `gallery-${timestamp}.png`, uri: picture.uri, sizeBytes: Math.max(1, new File(picture.uri).size) };
    setPending((count) => count + 1);
    setFiles((current) => {
      const next = [...current, preview].slice(0, MAX_GALLERY_CAPTURES);
      filesRef.current = next;
      return next;
    });
    try {
      const normalized = await normalizeCapturedPng(picture, { maxSide: 2400, compress: 0.88 });
      if (!active.current) { deleteCapturedFile(normalized.uri); return; }
      setFiles((current) => {
        const next = current.map((file) => file.clientKey === clientKey ? { ...file, uri: normalized.uri, sizeBytes: normalized.sizeBytes, ...(normalized.latitude !== undefined && normalized.longitude !== undefined ? { latitude: normalized.latitude, longitude: normalized.longitude } : {}) } : file);
        filesRef.current = next;
        return next;
      });
      if (preview.uri !== normalized.uri) deleteCapturedFile(preview.uri);
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "The image could not be captured.");
    } finally {
      if (active.current) setPending((count) => Math.max(0, count - 1));
    }
  };

  useEffect(() => () => {
    active.current = false;
    if (!submitted.current) for (const file of filesRef.current) deleteCapturedFile(file.uri);
  }, []);

  const remove = (clientKey: string) => {
    const file = files.find((candidate) => candidate.clientKey === clientKey);
    if (file) deleteCapturedFile(file.uri);
    setFiles((current) => {
      const next = current.filter((candidate) => candidate.clientKey !== clientKey);
      filesRef.current = next;
      return next;
    });
  };

  const submit = () => {
    if (!files.length) return;
    submitted.current = true;
    onSubmit(files);
  };

  const drawer = <View style={styles.drawer}>
    <View style={styles.drawerHeading}>
      <Text style={styles.drawerTitle}>Images</Text>
      <Text accessibilityLiveRegion="polite" style={styles.drawerCount}>{files.length} / {MAX_GALLERY_CAPTURES}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.images} horizontal showsHorizontalScrollIndicator={false}>
      {files.map((file, index) => <View key={file.clientKey} style={styles.item}>
        <Image contentFit="cover" source={file.uri} style={styles.preview} />
        <Text style={styles.itemLabel}>{index + 1}</Text>
        <Button accessibilityLabel={`Remove image ${index + 1}`} contentMode="raw" onPress={() => remove(file.clientKey)} size="xs" style={styles.remove} variant="icon"><CloseIcon size="sm" /></Button>
      </View>)}
    </ScrollView>
  </View>;

  return <BrandedCameraModal bottomContent={drawer} count={files.length} countUnit="images" doneLoading={pending > 0} externalError={error} hint="" maximum={MAX_GALLERY_CAPTURES} onCapture={capture} onClose={onClose} onDone={submit} title="Capture for Gallery" />;
}

const styles = StyleSheet.create({
  drawer: { gap: spacing.xs },
  drawerHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  drawerTitle: { color: palette.text, fontFamily: fonts.semibold, fontSize: 12 },
  drawerCount: { color: palette.muted, fontFamily: fonts.medium, fontSize: 11 },
  images: { alignItems: "center", gap: spacing.xs, minHeight: 76 },
  item: { backgroundColor: palette.surface, borderColor: palette.hairline, borderRadius: radii.md, borderWidth: 1, height: 76, overflow: "hidden", width: 58 },
  preview: { height: 76, width: 58 },
  itemLabel: { backgroundColor: "rgba(3,5,7,0.78)", bottom: 0, color: palette.text, fontFamily: fonts.semibold, fontSize: 10, left: 0, paddingHorizontal: spacing.xs, paddingVertical: 2, position: "absolute" },
  remove: { position: "absolute", right: 2, top: 2 },
});

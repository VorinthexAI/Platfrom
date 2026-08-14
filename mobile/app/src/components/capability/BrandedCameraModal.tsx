import { CameraView, useCameraPermissions, type CameraCapturedPicture } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@vorinthex/shared/ui/button";
import { CameraIcon, CloseIcon } from "@vorinthex/shared/ui/icons-mobile";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

type Props = {
  title: string;
  hint?: string;
  count?: number;
  maximum?: number;
  onCapture: (picture: CameraCapturedPicture) => Promise<void> | void;
  onClose: () => void;
  onDone?: () => void;
};

export function BrandedCameraModal({ title, hint = "Keep the page flat and fill the frame", count = 0, maximum = 1, onCapture, onClose, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [torch, setTorch] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => { if (permission === null) void requestPermission(); }, [permission, requestPermission]);

  const takePicture = async () => {
    if (!camera.current || !ready || capturing || count >= maximum) return;
    setCapturing(true);
    setError(undefined);
    try {
      const picture = await camera.current.takePictureAsync({ quality: 1, skipProcessing: false });
      await onCapture(picture);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The photo could not be captured.");
    } finally {
      setCapturing(false);
    }
  };

  return <Modal animationType="fade" onRequestClose={onClose} presentationStyle="fullScreen" visible>
    <View style={styles.root}>
      {permission?.granted ? <>
        <CameraView active facing="back" enableTorch={torch} mode="picture" onCameraReady={() => setReady(true)} onMountError={({ message }) => setError(message)} ref={camera} responsiveOrientationWhenOrientationLocked style={StyleSheet.absoluteFill} />
        <View pointerEvents="box-none" style={[styles.overlay, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.topBar}>
            <Button accessibilityLabel="Close camera" contentMode="raw" disabled={capturing} onPress={onClose} size="sm" variant="icon"><CloseIcon size="sm" /></Button>
            <View style={styles.heading}><Text style={styles.title}>{title}</Text><Text accessibilityLiveRegion="polite" style={styles.count}>{count} of {maximum}</Text></View>
            <Button accessibilityLabel={`${torch ? "Turn off" : "Turn on"} camera light`} onPress={() => setTorch((value) => !value)} size="sm" variant={torch ? "primary" : "secondary"}>{torch ? "Light on" : "Light"}</Button>
          </View>
          <View style={styles.guide}><View style={styles.guideCornerTopLeft} /><View style={styles.guideCornerTopRight} /><View style={styles.guideCornerBottomLeft} /><View style={styles.guideCornerBottomRight} /></View>
          <View style={styles.bottomBar}>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Text style={styles.hint}>{count >= maximum ? "Capture limit reached" : hint}</Text>
            <View style={styles.controls}>
              <View style={styles.controlSide}>{onDone ? <Button disabled={capturing || count === 0} onPress={onDone} size="sm" variant="secondary">Done</Button> : null}</View>
              <Button accessibilityLabel="Take photo" contentMode="raw" disabled={!ready || capturing || count >= maximum} loading={capturing} onPress={() => void takePicture()} size="xl" style={styles.shutter} variant="primary"><CameraIcon size="md" /></Button>
              <View style={styles.controlSide}><Text style={styles.pageNumber}>{count < maximum ? `Next ${count + 1}` : `${maximum} pages`}</Text></View>
            </View>
          </View>
        </View>
      </> : <View style={[styles.permission, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <CameraIcon size="lg" variant="muted" />
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionText}>Allow camera access to capture documents and photos without leaving Vorinthex.</Text>
        <Button onPress={() => void requestPermission()} size="lg" variant="primary">Allow camera</Button>
        <Button onPress={onClose} size="md" variant="ghost">Not now</Button>
      </View>}
    </View>
  </Modal>;
}

const corner = { borderColor: palette.accentLight, height: 34, position: "absolute" as const, width: 34 };
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  overlay: { bottom: 0, justifyContent: "space-between", left: 0, paddingHorizontal: spacing.md, position: "absolute", right: 0, top: 0 },
  topBar: { alignItems: "center", backgroundColor: "rgba(3,5,7,0.78)", borderColor: palette.hairline, borderRadius: radii.xl, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", padding: spacing.sm },
  heading: { alignItems: "center", flex: 1 },
  title: { color: palette.text, fontFamily: fonts.semibold, fontSize: 15 },
  count: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, marginTop: 2 },
  guide: { alignSelf: "center", aspectRatio: 0.72, maxHeight: "62%", width: "82%" },
  guideCornerTopLeft: { ...corner, borderLeftWidth: 2, borderTopWidth: 2, left: 0, top: 0 },
  guideCornerTopRight: { ...corner, borderRightWidth: 2, borderTopWidth: 2, right: 0, top: 0 },
  guideCornerBottomLeft: { ...corner, borderBottomWidth: 2, borderLeftWidth: 2, bottom: 0, left: 0 },
  guideCornerBottomRight: { ...corner, borderBottomWidth: 2, borderRightWidth: 2, bottom: 0, right: 0 },
  bottomBar: { backgroundColor: "rgba(3,5,7,0.88)", borderColor: palette.hairline, borderRadius: radii.xl, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  hint: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, textAlign: "center" },
  controls: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  controlSide: { alignItems: "center", minWidth: 82 },
  shutter: { height: 72, width: 72 },
  pageNumber: { color: palette.muted, fontFamily: fonts.medium, fontSize: 11 },
  error: { color: palette.danger, fontFamily: fonts.regular, fontSize: 12, textAlign: "center" },
  permission: { alignItems: "center", flex: 1, gap: spacing.md, justifyContent: "center", paddingHorizontal: spacing.xl },
  permissionTitle: { color: palette.text, fontFamily: fonts.semibold, fontSize: 22 },
  permissionText: { color: palette.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: "center" },
});

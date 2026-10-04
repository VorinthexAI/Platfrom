import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useEvent } from "expo";
import { Image } from "expo-image";
import { useVideoPlayer } from "expo-video";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@vorinthex/shared/ui/button";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { CheckIcon, FileIcon, PlayIcon, SoundwaveIcon } from "@vorinthex/shared/ui/icons-mobile";
import { downloadContentFile, type ContentFile, type FileExtension } from "@/lib/content-client";
import { saveThumbnail } from "@/lib/content-thumbnails";
import { fonts, palette, radii } from "@/theme/tokens";

export const IMAGE_EXTENSIONS = new Set<FileExtension>(["jpg", "jpeg", "png", "webp", "gif"]);

export function displayContentFileName(file: Pick<ContentFile, "name" | "extension">) {
  if (file.name.toLowerCase().endsWith(`.${file.extension}`)) return file.name;
  return `${file.name}.${file.extension}`;
}

export function ContentFileCardLabel({ name, extension }: { name: string; extension: FileExtension }) {
  if (IMAGE_EXTENSIONS.has(extension) || extension === "mp4" || extension === "mov") return null;
  return <Text ellipsizeMode="tail" numberOfLines={1} style={styles.cardLabel}>{name}</Text>;
}

export function ContentFileCover({ file, localUri, thumbnailUri, coverKey = file.key, onReady }: { file: Pick<ContentFile, "key" | "extension" | "hasThumbnail">; localUri?: string; thumbnailUri?: string; coverKey?: string; onReady?: () => void }) {
  const [failedLocalUri, setFailedLocalUri] = useState<string>();
  const coverUri = localUri && localUri !== failedLocalUri ? localUri : undefined;
  const query = useQuery({
    queryKey: ["file-cover", file.key],
    queryFn: () => downloadContentFile(file.key),
    enabled: (Boolean(file.hasThumbnail) || !coverUri) && (IMAGE_EXTENSIONS.has(file.extension) || file.extension === "mp4" || file.extension === "mov"),
    staleTime: 60_000,
  });
  useEffect(() => { if (query.isError) onReady?.(); }, [onReady, query.isError]);
  if ((file.extension === "mp4" || file.extension === "mov") && thumbnailUri) return <View style={styles.mediaFill}><Image contentFit="cover" onError={onReady} onLoad={onReady} source={thumbnailUri} style={styles.cardMedia} /><View style={styles.videoPlay}><PlayIcon size="lg" /></View></View>;
  if (IMAGE_EXTENSIONS.has(file.extension) && thumbnailUri) return <Image contentFit="cover" onError={onReady} onLoad={onReady} source={thumbnailUri} style={styles.mediaFill} />;
  if ((file.extension === "mp4" || file.extension === "mov") && query.data?.thumbnailUrl) return <View style={styles.mediaFill}><Image contentFit="cover" onError={onReady} onLoad={onReady} source={query.data.thumbnailUrl} style={styles.cardMedia} /><View style={styles.videoPlay}><PlayIcon size="lg" /></View></View>;
  if (IMAGE_EXTENSIONS.has(file.extension) && query.data?.thumbnailUrl) return <Image contentFit="cover" onError={onReady} onLoad={onReady} source={query.data.thumbnailUrl} style={styles.mediaFill} />;
  if ((file.extension === "mp4" || file.extension === "mov") && coverUri) return <VideoCover cacheKey={coverKey} onError={() => { setFailedLocalUri(coverUri); onReady?.(); }} onReady={onReady} uri={coverUri} />;
  if (IMAGE_EXTENSIONS.has(file.extension) && coverUri) return <Image contentFit="cover" onError={() => { setFailedLocalUri(coverUri); onReady?.(); }} onLoad={onReady} source={coverUri} style={styles.mediaFill} />;
  if ((file.extension === "mp4" || file.extension === "mov") && query.data?.url) return <VideoCover cacheKey={coverKey} onReady={onReady} uri={query.data.url} />;
  if (IMAGE_EXTENSIONS.has(file.extension) && query.data?.url) {
    return <Image contentFit="cover" onError={onReady} onLoad={onReady} source={file.hasThumbnail ? query.data.thumbnailUrl ?? query.data.url : query.data.url} style={styles.mediaFill} />;
  }
  if (IMAGE_EXTENSIONS.has(file.extension)) return <View style={styles.mediaFill} />;
  if (file.extension === "mp4" || file.extension === "mov") return <PlayIcon size="lg" />;
  if (file.extension === "mp3") return <SoundwaveIcon size="lg" />;
  return <FileIcon size="lg" />;
}

function VideoCover({ cacheKey, uri, onError, onReady }: { cacheKey: string; uri: string; onError?: () => void; onReady?: () => void }) {
  const player = useVideoPlayer(uri);
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const [unavailableThumbnailUri, setUnavailableThumbnailUri] = useState<string>();
  const thumbnailQuery = useQuery({
    queryKey: ["video-thumbnail", cacheKey],
    queryFn: async () => {
      const time = player.duration > 4 ? 2 : Math.max(0, player.duration / 2);
      const [frame] = await player.generateThumbnailsAsync(time, { maxWidth: 512, maxHeight: 512 });
      if (!frame) throw new Error("No video frame was available.");
      return (await saveThumbnail(frame)).uri;
    },
    enabled: status === "readyToPlay",
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 2,
  });
  const { data: cachedThumbnailUri, isError, refetch } = thumbnailQuery;
  const thumbnailUri = cachedThumbnailUri !== unavailableThumbnailUri ? cachedThumbnailUri : undefined;
  useEffect(() => {
    if (unavailableThumbnailUri && status === "readyToPlay") void refetch();
  }, [refetch, status, unavailableThumbnailUri]);
  useEffect(() => { if ((status === "error" || isError) && !thumbnailUri) onError?.(); }, [isError, onError, status, thumbnailUri]);
  useEffect(() => { if (thumbnailUri || status === "error" || isError) onReady?.(); }, [isError, onReady, status, thumbnailUri]);
  return <View style={styles.mediaFill}>
    {thumbnailUri ? <Image contentFit="cover" onError={() => setUnavailableThumbnailUri(thumbnailUri)} source={thumbnailUri} style={styles.cardMedia} /> : null}
    <View style={styles.videoPlay}><PlayIcon size="lg" /></View>
  </View>;
}

export function ContentFileTile({ file, size, selected = false, busy = false, accessibilityLabel, coverFileKey, coverKey, localUri, thumbnailUri, onLongPress, onPress, revealWhenReady = false }: {
  file: Pick<ContentFile, "key" | "name" | "extension" | "hasThumbnail">;
  size: number;
  selected?: boolean;
  busy?: boolean;
  accessibilityLabel: string;
  coverFileKey?: string;
  coverKey?: string;
  localUri?: string;
  thumbnailUri?: string;
  onLongPress?: () => void;
  onPress: () => void;
  revealWhenReady?: boolean;
}) {
  const media = IMAGE_EXTENSIONS.has(file.extension) || file.extension === "mp4" || file.extension === "mov";
  const [coverReady, setCoverReady] = useState(!revealWhenReady || !media);
  const markCoverReady = useCallback(() => setCoverReady(true), []);
  useEffect(() => {
    if (!revealWhenReady || coverReady) return;
    const timeout = setTimeout(markCoverReady, 15_000);
    return () => clearTimeout(timeout);
  }, [coverReady, markCoverReady, revealWhenReady]);
  return <View style={[styles.card, selected && styles.cardSelected, { width: size, height: size }]}>
    <Button accessibilityLabel={accessibilityLabel} accessibilityState={{ selected, busy: busy || !coverReady }} contentMode="raw" onLongPress={coverReady ? onLongPress : undefined} onPress={() => { if (coverReady) onPress(); }} shape="rounded" size="xl" style={[styles.cardMain, media && styles.mediaCardMain]} variant="ghost">
      <ContentFileCover coverKey={coverKey} file={coverFileKey ? { key: coverFileKey, extension: file.extension, hasThumbnail: file.hasThumbnail } : file} localUri={localUri} onReady={revealWhenReady ? markCoverReady : undefined} thumbnailUri={thumbnailUri} />
      <ContentFileCardLabel extension={file.extension} name={displayContentFileName(file)} />
    </Button>
    {!coverReady ? <Skeleton accessibilityLabel={`Loading ${file.name}`} pointerEvents="none" style={StyleSheet.absoluteFill} /> : null}
    {selected ? <View pointerEvents="none" style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised, overflow: "hidden" },
  cardSelected: { borderColor: palette.silver50, borderWidth: 2 },
  selectionBadge: { position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.silver50 },
  cardMain: { height: "100%", width: "100%", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 0 },
  mediaCardMain: { paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden" },
  cardMedia: { width: "100%", height: "100%" },
  mediaFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  videoPlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  cardLabel: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
});

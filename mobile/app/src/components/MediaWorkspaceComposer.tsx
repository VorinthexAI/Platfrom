import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Button } from "@vorinthex/shared/ui/button";
import { AttachmentPillStrip } from "@vorinthex/shared/ui/attachment-pill-strip";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { CapabilityTabs, type CapabilityMode } from "@vorinthex/shared/ui/capability-tabs";
import { FolderTile } from "@vorinthex/shared/ui/folder-tile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { FileIcon, ImageIcon, PlusIcon } from "@vorinthex/shared/ui/icons-mobile";
import { ContentFileTile } from "@/components/ContentFileTile";
import { FilesPickerSheet } from "@/components/FilesPickerSheet";
import { ProfileHeaderRight } from "@/components/ProfileAvatarButton";
import { useSessionToast as useToast } from "@/hooks/use-session-toast";
import { apiClient } from "@/lib/api-client";
import { createContentMutationKey, downloadContentFile, type ContentFile, type ContentFolder } from "@/lib/content-client";
import { contentLocationQueryOptions, contentQueryKeys } from "@/lib/content-query-cache";
import { ensureSparkCapacity } from "@/lib/billing-client";
import { extractDomainErrorMessage, isSparkFundingError } from "@/lib/domain-error-observer";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

type Mode = "image" | "speech" | "video";
type Props = ComponentProps<typeof CoreComposer> & { mode: Mode; openOnMount?: boolean };
type PendingGeneration = { key: string; mode: Mode; folderKey?: string; startedAt: number; estimatedMs: number; file?: ContentFile; completedAt?: number };
const voices = ["eve", "ara", "rex", "sal", "leo"] as const;
const videoRatios = ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"] as const;
const imageRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9", "4:1", "1:4", "8:1", "1:8"] as const;
const MIN_VIDEO_DURATION = 5;
const MAX_VIDEO_DURATION = 15;
const imageReferenceExtensions = ["jpg", "jpeg", "png", "webp"] as const;
const imageReferences = new Set<string>(imageReferenceExtensions);
const imageFiles = new Set([...imageReferences, "gif"]);
const documentReferences = ["txt", "md", "docx", "pdf"] as const;
const documentExtensions = new Set<string>(documentReferences);

export function MediaWorkspaceComposer({ mode, openOnMount, ...props }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { width } = useWindowDimensions();
  const userKey = useAuthStore((state) => state.user?.key ?? "");
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const context = useMemo(() => ({ userKey, scopeKey }), [scopeKey, userKey]);
  const [folderStack, setFolderStack] = useState<ContentFolder[]>([]);
  const currentFolder = folderStack.at(-1);
  const currentFolderRef = useRef(currentFolder?.key);
  currentFolderRef.current = currentFolder?.key;
  const [input, setInput] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [composerKeyboardVisible, setComposerKeyboardVisible] = useState(false);
  const [voice, setVoice] = useState<(typeof voices)[number]>("ara");
  const [duration, setDuration] = useState(5);
  const [videoRatio, setVideoRatio] = useState<(typeof videoRatios)[number]>("16:9");
  const [imageRatio, setImageRatio] = useState<(typeof imageRatios)[number]>("1:1");
  const [references, setReferences] = useState<ContentFile[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const charging = useRef<string | undefined>(undefined);
  const pendingKey = useRef<string | undefined>(undefined);
  const draftRevision = useRef(0);
  useEffect(() => {
    setInput("");
    setReferences([]);
    pendingKey.current = undefined;
    draftRevision.current += 1;
  }, [mode]);
  useEffect(() => {
    setFolderStack([]);
    setReferences([]);
    pendingKey.current = undefined;
    draftRevision.current += 1;
  }, [scopeKey, userKey]);
  const cardSize = Math.floor((width - spacing.md * 2 - 24) / 4);
  const pendingQueryKey = useMemo(() => ["media-generation-pending", userKey, scopeKey] as const, [userKey, scopeKey]);
  const pendingQuery = useQuery<PendingGeneration[]>({ queryKey: pendingQueryKey, queryFn: async () => [], enabled: false, initialData: [], gcTime: Infinity });
  useEffect(() => {
    if (!pendingQuery.data.some((job) => !job.file)) return;
    const timer = setInterval(() => setClock(Date.now()), 500);
    return () => clearInterval(timer);
  }, [pendingQuery.data]);
  const locationQuery = useQuery({ ...contentLocationQueryOptions(context, currentFolder?.key, {}, { allFiles: true }), enabled: Boolean(scopeKey && userKey), refetchInterval: (query) => query.state.data?.files.some((file) => file.processing === "pending") ? 2_000 : false });
  useEffect(() => {
    if (!locationQuery.data || locationQuery.isFetching) return;
    const visibleKeys = new Set(locationQuery.data.files.map((file) => file.key));
    if (!pendingQuery.data.some((job) => job.file && job.folderKey === currentFolder?.key && job.completedAt && locationQuery.dataUpdatedAt > job.completedAt && !visibleKeys.has(job.file.key))) return;
    queryClient.setQueryData<PendingGeneration[]>(pendingQueryKey, (current) => (current ?? []).filter((job) => !job.file || job.folderKey !== currentFolder?.key || !job.completedAt || locationQuery.dataUpdatedAt <= job.completedAt || visibleKeys.has(job.file.key)));
  }, [currentFolder?.key, locationQuery.data, locationQuery.dataUpdatedAt, locationQuery.isFetching, pendingQuery.data, pendingQueryKey, queryClient]);
  const pending = pendingQuery.data.filter((job) => job.mode === mode && job.folderKey === currentFolder?.key);
  const readyKeys = new Set(pending.flatMap((job) => job.file ? [job.file.key] : []));
  const files = (locationQuery.data?.files ?? []).filter((file) => !readyKeys.has(file.key) && (mode === "image" ? imageFiles.has(file.extension) : file.extension === (mode === "video" ? "mp4" : "mp3")));
  const price = mode === "image" ? "15 Sparks/image" : mode === "video" ? "15 Sparks/second" : "1 Spark/100 characters";
  const cycleSetting = <T,>(items: readonly T[], current: T) => items[(items.indexOf(current) + 1) % items.length]!;
  const bumpDraft = () => { pendingKey.current = undefined; draftRevision.current += 1; };

  const submit = () => {
    const text = input.trim();
    if ((!text && (mode !== "speech" || !references.length)) || !scopeKey || charging.current) return;
    const folderKey = currentFolder?.key;
    const selected = references.filter((file) => mode === "speech" ? documentExtensions.has(file.extension) : imageReferences.has(file.extension));
    const requestKey = pendingKey.current ?? createContentMutationKey();
    charging.current = requestKey;
    pendingKey.current = undefined;
    const revision = ++draftRevision.current;
    const quote = mode === "image" ? 15 : mode === "video" ? duration * 15 : Math.max(1, Array.from(text).length / 100);
    const payload = mode === "image" ? { prompt: text, aspectRatio: imageRatio, referenceImageKeys: selected.map((file) => file.key), ...(folderKey ? { folderKey } : {}) }
      : mode === "video" ? { prompt: text, durationSeconds: duration, aspectRatio: videoRatio, ...(selected[0] ? { startFrameFileKey: selected[0].key } : {}), ...(folderKey ? { folderKey } : {}) }
      : { text, fileKeys: selected.map((file) => file.key), voice, ...(folderKey ? { folderKey } : {}) };
    const job = { key: requestKey, mode, folderKey, startedAt: Date.now(), estimatedMs: mode === "image" ? 10_000 : mode === "video" ? 60_000 : Math.max(2_000, 850 + Array.from(text).length * 12) };
    queryClient.setQueryData<PendingGeneration[]>(pendingQueryKey, (current) => [...(current ?? []), job]);
    setInput("");
    setReferences([]);
    void (async () => {
      let completed = false;
      try {
        await ensureSparkCapacity(Math.ceil(quote * 1_000_000));
        if (charging.current === requestKey) charging.current = undefined;
        const response = await apiClient.post<{ success: true; data: { files: ContentFile[] } }>(`/agent/generate/${mode}`, { scopeKey, input: payload }, { headers: { "Idempotency-Key": requestKey }, timeout: 12 * 60_000 });
        if (!response.data.success || !response.data.data.files.length) throw new Error("Generation returned no file.");
        const file = response.data.data.files[0]!;
        if (mode === "image" || mode === "video") {
          await Promise.race([
            queryClient.fetchQuery({ queryKey: ["file-cover", file.key], queryFn: () => downloadContentFile(file.key), staleTime: 60_000 }).then(async ({ url, thumbnailUrl }) => { if (mode === "image" || thumbnailUrl) await Image.prefetch(thumbnailUrl ?? url); }),
            new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
          ]).catch(() => undefined);
        }
        queryClient.setQueryData<PendingGeneration[]>(pendingQueryKey, (current) => (current ?? []).map((entry) => entry.key === requestKey ? { ...entry, file, completedAt: Date.now() } : entry));
        completed = true;
        void queryClient.invalidateQueries({ queryKey: contentQueryKeys.location(context, folderKey) }).catch(() => undefined);
        void queryClient.invalidateQueries({ queryKey: ["file-search", scopeKey] });
        showToast({ title: `${mode[0]!.toUpperCase() + mode.slice(1)} saved to Storage`, duration: 2_500 });
      } catch (error) {
        if (currentFolderRef.current === folderKey && draftRevision.current === revision) {
          setInput(text);
          setReferences(references);
          pendingKey.current = requestKey;
        }
        if (!isSparkFundingError(error)) showToast({ title: extractDomainErrorMessage(error) ?? `${mode} generation failed.`, duration: 3_000 });
      } finally {
        if (charging.current === requestKey) charging.current = undefined;
        if (!completed) queryClient.setQueryData<PendingGeneration[]>(pendingQueryKey, (current) => (current ?? []).filter(({ key }) => key !== requestKey));
      }
    })();
  };

  const toolbar = <View style={styles.toolbar}>
    {mode === "speech" ? <Button accessibilityLabel={`Voice: ${voice}`} onPress={() => { setVoice(cycleSetting(voices, voice)); bumpDraft(); }} size="xs" variant="secondary">{voice}</Button> : null}
    {mode === "video" ? <Button accessibilityLabel={`Duration: ${duration} seconds`} onPress={() => { setDuration((current) => current >= MAX_VIDEO_DURATION ? MIN_VIDEO_DURATION : current + 1); bumpDraft(); }} size="xs" variant="secondary">{duration}s</Button> : null}
    {mode === "image" || mode === "video" ? <Button accessibilityLabel={`Aspect ratio: ${mode === "image" ? imageRatio : videoRatio}`} onPress={() => { if (mode === "image") setImageRatio(cycleSetting(imageRatios, imageRatio)); else setVideoRatio(cycleSetting(videoRatios, videoRatio)); bumpDraft(); }} size="xs" variant="secondary">{mode === "image" ? imageRatio : videoRatio}</Button> : null}
  </View>;
  const grid = <ScrollView contentContainerStyle={styles.grid} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.scroll}>
    {currentFolder ? <FolderTile accessibilityLabel="Back to parent folder" label="Up" onPress={() => { setFolderStack((stack) => stack.slice(0, -1)); pendingKey.current = undefined; draftRevision.current += 1; }} parent size={cardSize} /> : null}
    {locationQuery.isPending ? Array.from({ length: currentFolder ? 3 : 4 }, (_, index) => <Skeleton key={index} style={[styles.card, styles.loading, { width: cardSize, height: cardSize }]} />) : <>
      {(locationQuery.data?.folders ?? []).map((folder) => <FolderTile accessibilityLabel={`Open ${folder.name}`} key={folder.key} label={folder.name} onPress={() => { setFolderStack((stack) => [...stack, folder]); pendingKey.current = undefined; draftRevision.current += 1; }} size={cardSize} />)}
      {files.map((file) => <ContentFileTile accessibilityLabel={`Open ${file.name}`} file={file} key={file.key} onPress={() => router.push({ pathname: "/file", params: { fileKey: file.key, fileTitle: file.name } } as unknown as Parameters<typeof router.push>[0])} size={cardSize} />)}
      {pending.map((job) => job.file ? <ContentFileTile accessibilityLabel={`Open ${job.file.name}`} file={locationQuery.data?.files.find((file) => file.key === job.file?.key) ?? job.file} key={job.key} onPress={() => router.push({ pathname: "/file", params: { fileKey: job.file!.key, fileTitle: job.file!.name } } as unknown as Parameters<typeof router.push>[0])} revealWhenReady size={cardSize} /> : <View accessibilityLabel={`Generating ${job.mode}: ${Math.max(0, Math.min(95, Math.floor((clock - job.startedAt) / job.estimatedMs * 100)))} percent`} accessibilityRole="progressbar" key={job.key} style={[styles.card, { width: cardSize, height: cardSize }]}><Skeleton style={StyleSheet.absoluteFill} /><Text style={styles.progress}>{Math.max(0, Math.min(95, Math.floor((clock - job.startedAt) / job.estimatedMs * 100)))}%</Text></View>)}
    </>}
    {locationQuery.isError ? <Text style={styles.empty}>Files could not be loaded.</Text> : null}
  </ScrollView>;
  const accessory = references.length ? <AttachmentPillStrip items={references.map((file) => ({ key: file.key, name: file.name, icon: imageReferences.has(file.extension) ? <ImageIcon size="sm" variant="muted" /> : <FileIcon size="sm" variant="muted" />, onOpen: () => router.push({ pathname: "/file", params: { fileKey: file.key, fileTitle: file.name } } as unknown as Parameters<typeof router.push>[0]), onRemove: () => { setReferences((items) => items.filter((item) => item.key !== file.key)); pendingKey.current = undefined; draftRevision.current += 1; } }))} /> : undefined;

  return <>
    <CoreComposer {...props} allowEmptySubmit={mode === "speech" && references.length > 0} disabled={!scopeKey} editable expandedAccessory={accessory} expandedFooter={composerKeyboardVisible ? undefined : <CapabilityTabs onValueChange={(next: CapabilityMode) => router.setParams({ mode: next })} value={mode} />} expandedLeading={<PlusIcon size="sm" />} expandedLeadingAccessory={<Text numberOfLines={1} style={styles.price}>{price}</Text>} expandedLeadingAccessibilityLabel={mode === "speech" ? "Select documents to narrate" : "Select reference images"} expandedToolbar={toolbar} expandedPrompts={[mode === "image" ? "Describe an image..." : mode === "speech" ? "Text to speak..." : "Describe a video..."]} focusOnOpenRequest={false} maxLength={mode === "speech" ? 15_000 : 4_000} message={grid} onChangeText={(text) => { setInput(text); pendingKey.current = undefined; draftRevision.current += 1; }} onExpandedKeyboardVisibilityChange={setComposerKeyboardVisible} onExpandedLeadingPress={() => setPickerOpen(true)} onSubmit={submit} openEnabled openRequest={openOnMount ? Math.max(props.openRequest ?? 0, 1) : props.openRequest} pageActions={undefined} pageIdentity={(close) => <View style={styles.identity}><View style={styles.identityMain}>{props.pageIdentity(close)}</View><ProfileHeaderRight /></View>} prompts={[mode === "image" ? "Describe an image..." : mode === "speech" ? "Text to speak..." : "Describe a video..."]} value={input} />
    <FilesPickerSheet acceptFile={(file) => mode === "speech" ? documentExtensions.has(file.extension) && file.hasExtractedText === true : imageReferences.has(file.extension)} allowedExtensions={mode === "speech" ? documentReferences : imageReferenceExtensions} context={context} onClose={() => setPickerOpen(false)} onDone={(selected) => { setReferences(selected); pendingKey.current = undefined; draftRevision.current += 1; }} open={pickerOpen} selectionLimit={mode === "speech" ? 20 : mode === "image" ? 8 : 1} title={mode === "speech" ? "Documents to narrate" : mode === "image" ? "Reference images" : "Starting image"} />
  </>;
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", gap: spacing.xs, alignItems: "center" },
  price: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 10, flexShrink: 1 },
  scroll: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, paddingTop: spacing.md, paddingBottom: spacing.lg },
  card: { borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised, overflow: "hidden" },
  loading: { backgroundColor: palette.hairlineBright },
  progress: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 14, textAlign: "center", textAlignVertical: "center", height: "100%" },
  empty: { color: palette.muted, fontSize: 13 },
  identity: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", width: "100%" },
  identityMain: { flex: 1 },
});

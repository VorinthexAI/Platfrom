import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { FileViewer } from "@vorinthex/shared/ui/file-viewer";
import { PullToRefresh } from "@vorinthex/shared/ui/pull-to-refresh";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Switch } from "@vorinthex/shared/ui/switch";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { ChevronLeftIcon, CloseIcon, FileIcon, FolderIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, SendIcon } from "@vorinthex/shared/ui/icons-mobile";
import { ChromeIcon } from "@/components/ChromeIcon";
import { PersistentCoreComposer as CoreComposer } from "@/components/PersistentCoreComposer";
import { ProfileHeaderRight } from "@/components/ProfileAvatarButton";
import { assistantIconSource } from "@/data/capability-icons";
import { useSessionToast as useToast } from "@/hooks/use-session-toast";
import {
  createContentFolder,
  createContentMutationKey,
  deleteContentFile,
  deleteContentFolder,
  downloadContentFile,
  FILE_EXTENSIONS,
  findContentFile,
  findContentFolder,
  isContentContextConfigured,
  moveContentFile,
  moveContentFolder,
  renameContentFile,
  renameContentFolder,
  searchContent,
  setContentFileFavorite,
  setContentFolderFavorite,
  uploadContentFiles,
  type ContentFile,
  type ContentFolder,
} from "@/lib/content-client";
import {
  addCachedContentFolder,
  contentQueryKeys,
  getContentLocation,
  invalidateContentLocations,
  refreshContentLocation,
  removeCachedContentFile,
  removeCachedContentFolder,
  replaceCachedContentFile,
  replaceCachedContentFolder,
  type ContentLocation,
} from "@/lib/content-query-cache";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

const CORE_PROMPTS = ["Find a file", "Summarize what I saved", "What is in this folder?"] as const;
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const TEXT_EXTENSIONS = new Set(["txt", "md"]);

function displayName(file: Pick<ContentFile, "name" | "extension">) {
  if (file.name.toLowerCase().endsWith(`.${file.extension}`)) return file.name;
  return `${file.name}.${file.extension}`;
}

export function FilesWorkspace({ initialFileKey, initialFileTitle, initialFolderKey, initialSearchQuery }: { initialFileKey?: string; initialFileTitle?: string; initialFolderKey?: string; initialSearchQuery?: string } = {}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardSize = Math.floor((width - spacing.md * 2 - 20) / 3);
  const scopeKey = useAuthStore((state) => typeof state.scope?.key === "string" ? state.scope.key : "");
  const userKey = useAuthStore((state) => state.user?.key ?? "");
  const contentContext = useMemo(() => ({ scopeKey, userKey }), [scopeKey, userKey]);
  const configured = isContentContextConfigured(contentContext);
  const [folderStack, setFolderStack] = useState<ContentFolder[]>([]);
  const [query, setQuery] = useState(initialSearchQuery ?? "");
  const [sheet, setSheet] = useState<"create" | "folder" | "file" | "rename" | "delete" | "move">();
  const [selectedFolder, setSelectedFolder] = useState<ContentFolder>();
  const [selectedFile, setSelectedFile] = useState<ContentFile>();
  const [preview, setPreview] = useState<{ title: string; pdfUri?: string; imageUri?: string; text?: string }>();
  const [nameDraft, setNameDraft] = useState("");
  const [moveTarget, setMoveTarget] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const initialHandled = useRef(false);
  const currentFolder = folderStack.at(-1);
  const locationQuery = useQuery({
    queryKey: contentQueryKeys.location(contentContext, currentFolder?.key),
    queryFn: () => getContentLocation(queryClient, contentContext, currentFolder?.key),
    enabled: configured,
  });
  const location: ContentLocation = locationQuery.data ?? { folders: [], files: [] };
  const searching = Boolean(query.trim());
  const searchQuery = useQuery({
    queryKey: ["file-search", contentContext.scopeKey, currentFolder?.key ?? null, query.trim()],
    queryFn: () => searchContent(query.trim(), currentFolder?.key),
    enabled: configured && searching,
  });
  const folders = searching ? (searchQuery.data?.folders ?? []) : location.folders;
  const files = searching ? (searchQuery.data?.files ?? []).map((file) => ({
    key: file.fileKey,
    scopeKey: contentContext.scopeKey,
    folderKey: file.folderKey,
    name: file.name,
    extension: file.extension ?? "txt",
    mimeType: "application/octet-stream",
    sizeBytes: 1,
    processing: "ready" as const,
    isFavorite: file.isFavorite,
    createdAt: "",
    updatedAt: "",
  })) : location.files;

  useEffect(() => {
    if (!configured || initialHandled.current) return;
    initialHandled.current = true;
    if (initialFolderKey) {
      void findContentFolder(initialFolderKey, contentContext).then((folder) => setFolderStack([folder])).catch(() => undefined);
    }
    if (initialFileKey) {
      void findContentFile(initialFileKey, contentContext).then((file) => openFile(file)).catch(() => {
        showToast({ title: initialFileTitle ? `${initialFileTitle} could not be opened.` : "The file could not be opened.", duration: 2_500 });
      });
    }
  }, [configured, contentContext, initialFileKey, initialFileTitle, initialFolderKey, showToast]);

  const refresh = useCallback(() => refreshContentLocation(queryClient, contentContext, currentFolder?.key), [contentContext, currentFolder?.key, queryClient]);

  const openFile = async (file: ContentFile) => {
    try {
      const download = await downloadContentFile(file.key);
      if (IMAGE_EXTENSIONS.has(file.extension)) {
        setPreview({ title: displayName(file), imageUri: download.url });
        return;
      }
      if (file.extension === "pdf") {
        setPreview({ title: displayName(file), pdfUri: download.url });
        return;
      }
      if (TEXT_EXTENSIONS.has(file.extension)) {
        const response = await fetch(download.url);
        setPreview({ title: displayName(file), text: await response.text() });
        return;
      }
      await Linking.openURL(download.url);
    } catch {
      showToast({ title: "The file could not be opened.", duration: 2_500 });
    }
  };

  const pickAndUpload = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: "*/*" });
    if (result.canceled) return;
    const accepted = result.assets.flatMap((asset) => {
      const name = asset.name ?? "file";
      const extension = name.toLowerCase().split(".").pop();
      if (!extension || !(FILE_EXTENSIONS as readonly string[]).includes(extension)) return [];
      return [{ name, type: asset.mimeType ?? "", size: asset.size ?? 0, uri: asset.uri }];
    });
    if (!accepted.length) {
      showToast({ title: "Choose txt, md, docx, pdf, image, mp3, or mp4 files.", duration: 2_500 });
      return;
    }
    setUploading(true);
    try {
      await uploadContentFiles(accepted, currentFolder?.key, contentContext, createContentMutationKey());
      await invalidateContentLocations(queryClient, contentContext, [currentFolder?.key]);
      await refresh();
    } catch {
      showToast({ title: "Files could not be uploaded.", duration: 2_500 });
    } finally {
      setUploading(false);
    }
  };

  const submitCreateFolder = async () => {
    const name = nameDraft.trim();
    if (!name) return;
    setSheet(undefined);
    try {
      const folder = await createContentFolder(name, currentFolder?.key);
      addCachedContentFolder(queryClient, contentContext, currentFolder?.key, folder);
      setNameDraft("");
    } catch {
      showToast({ title: "The folder could not be created.", duration: 2_500 });
    }
  };

  const submitRename = async () => {
    const name = nameDraft.trim();
    if (!name) return;
    setSheet(undefined);
    try {
      if (selectedFolder) replaceCachedContentFolder(queryClient, contentContext, await renameContentFolder(selectedFolder.key, name));
      if (selectedFile) replaceCachedContentFile(queryClient, contentContext, await renameContentFile(selectedFile.key, name));
    } catch {
      showToast({ title: "The name could not be updated.", duration: 2_500 });
    }
  };

  const submitDelete = async () => {
    setSheet(undefined);
    try {
      if (selectedFolder) {
        await deleteContentFolder(selectedFolder.key);
        removeCachedContentFolder(queryClient, contentContext, selectedFolder.key);
      }
      if (selectedFile) {
        await deleteContentFile(selectedFile.key);
        removeCachedContentFile(queryClient, contentContext, selectedFile.key);
      }
    } catch {
      showToast({ title: "The item could not be deleted.", duration: 2_500 });
    }
  };

  const submitMove = async () => {
    setSheet(undefined);
    try {
      if (selectedFolder) {
        replaceCachedContentFolder(queryClient, contentContext, await moveContentFolder(selectedFolder.key, moveTarget));
        await invalidateContentLocations(queryClient, contentContext, [currentFolder?.key, moveTarget]);
      }
      if (selectedFile) {
        replaceCachedContentFile(queryClient, contentContext, await moveContentFile(selectedFile.key, moveTarget));
        await invalidateContentLocations(queryClient, contentContext, [currentFolder?.key, moveTarget]);
      }
      await refresh();
    } catch {
      showToast({ title: "The item could not be moved.", duration: 2_500 });
    }
  };

  if (preview) {
    if (preview.pdfUri) return <FileViewer loading={false} onBack={() => setPreview(undefined)} onMenu={() => undefined} pdfUri={preview.pdfUri} title={preview.title} />;
    return <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Button accessibilityLabel="Back" contentMode="raw" onPress={() => setPreview(undefined)} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button>
        <Text numberOfLines={1} style={styles.previewTitle}>{preview.title}</Text>
        <View style={styles.headerSpacer} />
      </View>
      {preview.imageUri ? <Image contentFit="contain" source={preview.imageUri} style={styles.previewImage} /> : <ScrollView contentContainerStyle={styles.previewText}><Text selectable style={styles.bodyText}>{preview.text}</Text></ScrollView>}
    </View>;
  }

  return <View style={styles.root}>
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}><Text style={styles.brand}>Files</Text><ProfileHeaderRight /></View>
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" refreshControl={<PullToRefresh enabled={configured} onRefresh={refresh} refreshing={locationQuery.isRefetching} />} showsVerticalScrollIndicator={false}>
      <View style={styles.titleRow}>
        {currentFolder ? <Button accessibilityLabel="Back" contentMode="raw" onPress={() => setFolderStack((stack) => stack.slice(0, -1))} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button> : null}
        <Text numberOfLines={1} style={styles.title}>{currentFolder?.name ?? "Files"}</Text>
        <Button accessibilityLabel="Create or upload" contentMode="raw" onPress={() => setSheet("create")} size="xs" variant="icon"><PlusIcon size="sm" /></Button>
      </View>
      <View style={styles.search}>
        <SearchIcon size="sm" variant="muted" />
        <TextInput accessibilityLabel="Search files" onChangeText={setQuery} placeholder="Search..." style={styles.searchInput} value={query} />
        {query ? <Button accessibilityLabel="Clear search" contentMode="raw" iconOnly onPress={() => setQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}
      </View>
      {locationQuery.isPending && !searching ? <View style={styles.grid}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.card, { width: cardSize, height: cardSize }]} />)}</View> : <>
        <View style={styles.grid}>
          {folders.map((folder) => <View key={folder.key} style={[styles.card, { width: cardSize, height: cardSize }]}>
            <Button contentMode="raw" onLongPress={() => { setSelectedFolder(folder); setSelectedFile(undefined); setSheet("folder"); }} onPress={() => { setQuery(""); setFolderStack((stack) => [...stack, folder]); }} shape="rounded" size="xl" style={styles.cardMain} variant="ghost">
              <FolderIcon size="lg" />
              <Text ellipsizeMode="tail" numberOfLines={1} style={styles.cardLabel}>{folder.name}</Text>
            </Button>
          </View>)}
        </View>
        <View style={styles.fileList}>
          {uploading ? <Skeleton style={styles.fileSkeleton} /> : null}
          {files.map((file) => <Button contentMode="raw" key={file.key} onLongPress={() => { setSelectedFile(file); setSelectedFolder(undefined); setSheet("file"); }} onPress={() => void openFile(file)} size="sm" style={styles.fileButton} variant="secondary">
            <FileIcon size="sm" />
            <Text numberOfLines={1} style={styles.fileLabel}>{displayName(file)}</Text>
          </Button>)}
          {!folders.length && !files.length && !uploading ? <Text style={styles.empty}>No folders or files yet.</Text> : null}
        </View>
      </>}
    </ScrollView>
    <CoreComposer accessibilityLabel="Ask Core about your files" leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />} onChangeText={() => undefined} onSubmit={() => undefined} pageIdentity={(closeCore) => <Button accessibilityLabel="Close Core" contentMode="raw" onPress={closeCore} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button>} prompts={CORE_PROMPTS} sendIcon={<SendIcon size="sm" />} value="" />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "create"} title="">
      <BottomSheetMenu>
        <BottomSheetItem onPress={() => { setNameDraft(""); setSheet("rename"); setSelectedFolder(undefined); setSelectedFile(undefined); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">New folder</BottomSheetItem>
        <BottomSheetItem onPress={() => { setSheet(undefined); void pickAndUpload(); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Upload files</BottomSheetItem>
      </BottomSheetMenu>
    </BottomSheet>
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "folder" && Boolean(selectedFolder)} title="">
      <BottomSheetMenu>
        <BottomSheetItem onPress={() => { if (selectedFolder) void setContentFolderFavorite(selectedFolder.key, !selectedFolder.isFavorite).then((folder) => replaceCachedContentFolder(queryClient, contentContext, folder)); setSheet(undefined); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">{selectedFolder?.isFavorite ? "Unfavorite" : "Favorite"}</BottomSheetItem>
        <BottomSheetItem onPress={() => { setNameDraft(selectedFolder?.name ?? ""); setSheet("rename"); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Rename</BottomSheetItem>
        <BottomSheetItem onPress={() => { setMoveTarget(undefined); setSheet("move"); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Move</BottomSheetItem>
        <BottomSheetItem onPress={() => setSheet("delete")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Delete</BottomSheetItem>
      </BottomSheetMenu>
    </BottomSheet>
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "file" && Boolean(selectedFile)} title="">
      <BottomSheetMenu>
        <BottomSheetItem onPress={() => { if (selectedFile) void setContentFileFavorite(selectedFile.key, !selectedFile.isFavorite).then((file) => replaceCachedContentFile(queryClient, contentContext, file)); setSheet(undefined); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">{selectedFile?.isFavorite ? "Unfavorite" : "Favorite"}</BottomSheetItem>
        <BottomSheetItem onPress={() => { setNameDraft(selectedFile?.name ?? ""); setSheet("rename"); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Rename</BottomSheetItem>
        <BottomSheetItem onPress={() => { setMoveTarget(undefined); setSheet("move"); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Move</BottomSheetItem>
        <BottomSheetItem onPress={() => setSheet("delete")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Delete</BottomSheetItem>
      </BottomSheetMenu>
    </BottomSheet>
    <BottomSheet footer={<><Button disabled={!nameDraft.trim()} onPress={() => { if (!selectedFolder && !selectedFile) void submitCreateFolder(); else void submitRename(); }} size="md" variant="primary">Save</Button><Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "rename"} title={selectedFolder || selectedFile ? "Rename" : "New folder"}>
      <TextInput accessibilityLabel="Name" onChangeText={setNameDraft} placeholder="Name" value={nameDraft} />
    </BottomSheet>
    <BottomSheet footer={<><Button onPress={() => void submitDelete()} size="md" variant="primary">Delete</Button><Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "delete"} title="Delete?" />
    <BottomSheet footer={<><Button onPress={() => void submitMove()} size="md" variant="primary">Move</Button><Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "move"} title="Move to">
      <View style={styles.moveRow}><Switch accessibilityLabel="Move to Files root" checked={!moveTarget} onCheckedChange={(checked) => { if (checked) setMoveTarget(undefined); }} /><Text style={styles.moveLabel}>Files root</Text></View>
    </BottomSheet>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  header: { minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: palette.hairline, borderBottomWidth: 1 },
  brand: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 15 },
  headerSpacer: { width: 40 },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  titleRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, color: palette.silver50, fontFamily: fonts.medium, fontSize: 24 },
  previewTitle: { flex: 1, color: palette.silver50, fontFamily: fonts.medium, fontSize: 16 },
  search: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 12, paddingRight: 8, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1 },
  searchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: { borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised, overflow: "hidden" },
  cardMain: { height: "100%", width: "100%", flexDirection: "column", justifyContent: "center", gap: 10, paddingHorizontal: 8 },
  cardLabel: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  fileList: { gap: 7 },
  fileButton: { width: "100%", minHeight: 38, justifyContent: "flex-start", paddingHorizontal: 14 },
  fileLabel: { flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "left" },
  fileSkeleton: { width: "100%", minHeight: 38, borderRadius: 999 },
  empty: { paddingVertical: 24, color: palette.silver500, fontFamily: fonts.regular, textAlign: "center" },
  sheetAction: { justifyContent: "center" },
  sheetActionText: { width: "100%", textAlign: "center" },
  previewImage: { flex: 1, width: "100%" },
  previewText: { padding: spacing.md },
  bodyText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26 },
  moveRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  moveLabel: { color: palette.text, fontSize: 13 },
});

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef } from "react";
import { FlatList, Keyboard, ScrollView, Share as NativeShare, StyleSheet, Text, View, useWindowDimensions, type ListRenderItem, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { ActionPill } from "@vorinthex/shared/ui/action-pill";
import { Avatar } from "@vorinthex/shared/ui/avatar";
import { Button, ButtonSizeProvider } from "@vorinthex/shared/ui/button";
import { ChromeIcon } from "@vorinthex/shared/ui/chrome-icon";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { LoadingText } from "@vorinthex/shared/ui/loading-text";
import { StreamingRichText } from "@vorinthex/shared/ui/rich-text";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { RoleOptionCard } from "@vorinthex/shared/ui/role-option-card";
import { CapabilityTile } from "@vorinthex/shared/ui/capability-tile";
import { CapabilityTabs, type CapabilityMode } from "@vorinthex/shared/ui/capability-tabs";
import { Switch } from "@vorinthex/shared/ui/switch";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useSessionToast as useToast } from "@/hooks/use-session-toast";
import { useWholeSparkBalance } from "@/hooks/use-billing-summary";
import { ChatBubbleIcon, CloseIcon, FileIcon, FilterIcon, FolderIcon, ImageIcon, IncognitoIcon, MoreHorizontalIcon, PlayIcon, PlusIcon, RoleIcon, SearchIcon, SoundwaveIcon, UploadIcon, type RoleIconRole } from "@vorinthex/shared/ui/icons-mobile";

import { ContentFileTile, IMAGE_EXTENSIONS } from "@/components/ContentFileTile";
import { FilesPickerSheet } from "@/components/FilesPickerSheet";
import { AttachmentPillStrip } from "@vorinthex/shared/ui/attachment-pill-strip";
import { MediaWorkspaceComposer } from "@/components/MediaWorkspaceComposer";
import { SearchHistorySheet } from "@/components/SearchHistorySheet";
import { CORE_PLACEHOLDER_PROMPTS } from "@/data/core-prompts";
import type { ContentFile } from "@/lib/content-client";
import { ProfileHeaderRight } from "@/components/ProfileAvatarButton";

import {
  addConversationToUnfilteredLists,
  conversationAttachmentsForRender,
  conversationListMembershipKeys,
  conversationAttachmentDisplayKey,
  conversationMessages,
  conversationQueryKeys,
  createLocalConversationAttachments,
  invalidateConversationSearches,
  mergeConversationMessages,
  removeConversationFromLists,
  removeConversationMessages,
  replaceConversationInMatchingLists,
  replaceTurnMessages,
  restoreConversationMessages,
  restoreConversationToLists,
  settlePendingAttachmentOverlays,
  type ConversationDisplayAttachment,
  type OptimisticMessage,
} from "@/lib/conversation-cache";
import {
  CONVERSATION_MESSAGE_MAX_LENGTH,
  CONVERSATION_ATTACHMENT_MAX_FILES,

  conversationContextIdentity,
  createConversation,
  deleteConversation,
  deleteConversationMessage,
  isConversationContextCurrent,
  isConversationNotFoundError,
  listConversationMessages,
  listConversations,
  listConversationRoles,
  streamConversationContextSeed,
  streamConversationTurn,
  uploadConversationAttachments,
  updateConversation,
  type Conversation,
  type ConversationAttachmentReference,
  type ConversationMessage,
  type ConversationAttachmentFile,
} from "@/lib/conversation-client";
import { conversationFileView } from "@/lib/conversation-retrievals";
import { deleteContentSearchHistory, type ContentSearchHistoryItem } from "@/lib/content-client";
import { readConversationSelection, writeConversationSelection } from "@/lib/conversation-selection-vault";
import { getUserSearchHistory, promoteCachedUserSearchHistory, removeCachedUserSearchHistory, userSearchHistoryQueryKey } from "@/lib/user-search-history-cache";
import { ensureSparkCapacity } from "@/lib/billing-client";
import { extractDomainErrorMessage, isSparkFundingError } from "@/lib/domain-error-observer";
import { profileInitial } from "@/lib/auth-helpers";
import { useAuthStore } from "@/state/auth";
import { useAppsStore } from "@/state/apps";
import { useUiStore } from "@/state/ui";
import { assistantIconSource } from "@/data/capability-icons";
import { requestAgentGreeting } from "@/lib/agent-greeting-client";
import { palette, radii, spacing } from "@/theme/tokens";

type CoreComposerProps = ComponentProps<typeof CoreComposer>;
type Sheet = "attachments" | "attachmentActions" | "chats" | "filter" | "history" | "current" | "delete" | "newChat" | "chatContext" | "role" | "messageActions" | "deleteMessage";
type CreateOperation = { identity: string; optimistic: Conversation; promise: Promise<Conversation> };
type DraftAttachment = ConversationAttachmentFile & { kind: "image" | "document"; preparing?: true };
type DisplayMessage = OptimisticMessage & { renderKey?: string; persistenceToken?: string; persistenceKind?: "greeting" | "seed" };
type ConversationRestoreResult = "restored" | "empty" | "suppressed";

const now = () => new Date().toISOString();
const clientKey = (kind: string) => `optimistic-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const PRESERVE_MESSAGE_POSITION = { minIndexForVisible: 0 } as const;
const DOCUMENT_MIME_TYPES = ["text/plain", "text/markdown", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] as const;
const documentMimeType = (filename: string) => {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  return extension === "txt" ? "text/plain" : extension === "md" ? "text/markdown" : extension === "pdf" ? "application/pdf" : extension === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : undefined;
};
function displayAttachmentFilename(filename: string) {
  try { return decodeURIComponent(filename.replace(/\+/g, "%20")); }
  catch { return filename.replace(/\+/g, " "); }
}
function TaggedFileIcon({ file }: { file: ContentFile }) {
  if (IMAGE_EXTENSIONS.has(file.extension)) return <ImageIcon size="sm" variant="muted" />;
  if (file.extension === "mp4" || file.extension === "mov") return <PlayIcon size="sm" variant="muted" />;
  if (file.extension === "mp3") return <SoundwaveIcon size="sm" variant="muted" />;
  return <FileIcon size="sm" variant="muted" />;
}
function deleteTemporaryFile(uri: string) {
  try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Picker and camera cache files may already be gone. */ }
}
function notifyCoreOutput() { void Haptics.selectionAsync(); }

function MessageAttachment({ attachment, onOpen }: { attachment: ConversationDisplayAttachment; onOpen: (attachment: ConversationAttachmentReference) => void }) {
  if (attachment.kind === "image") return <ActionPill compact dense fitContent style={[styles.attachmentPill, styles.messageAttachmentPill]}><View style={styles.attachmentPillContent}><ImageIcon size="sm" variant="muted" /><Text numberOfLines={1} style={styles.attachmentName}>{displayAttachmentFilename(attachment.filename)}</Text></View></ActionPill>;
  if ("local" in attachment) return <ActionPill compact dense fitContent style={[styles.attachmentPill, styles.messageAttachmentPill]}><View style={styles.attachmentPillContent}><FileIcon size="sm" variant="muted" /><Text numberOfLines={1} style={styles.attachmentName}>{displayAttachmentFilename(attachment.filename)}</Text></View></ActionPill>;
  return <ActionPill compact dense fitContent onPress={() => onOpen(attachment)} pressLabel={`Open actions for ${displayAttachmentFilename(attachment.filename)}`} style={[styles.attachmentPill, styles.messageAttachmentPill]}><View style={styles.attachmentPillContent}><FileIcon size="sm" variant="muted" /><Text numberOfLines={1} style={styles.attachmentName}>{displayAttachmentFilename(attachment.filename)}</Text></View></ActionPill>;
}

function MessageAttachments({ message, onOpen }: { message: DisplayMessage; onOpen: (attachment: ConversationAttachmentReference) => void }) {
  const retained = useRef<ConversationDisplayAttachment[]>([]);
  retained.current = conversationAttachmentsForRender(retained.current, message);
  if (!retained.current.length) return null;
  return <View accessibilityLabel="Message attachments" style={styles.messageAttachments}>{retained.current.map((attachment) => <MessageAttachment attachment={attachment} key={conversationAttachmentDisplayKey(attachment)} onOpen={onOpen} />)}</View>;
}

function isExpectedCancellation(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  return error.name === "AbortError" || error.name === "CanceledError" || error.name === "CancelledError" || code === "ERR_CANCELED";
}

const MessageRow = memo(function MessageRow({ message, onStorageAction, onOpenActions, onOpenAttachment, onOpenTaggedFile, onOpenRetrievals }: { message: DisplayMessage; onStorageAction?: (action: StorageAction) => void; onOpenActions: (message: OptimisticMessage) => void; onOpenAttachment: (attachment: ConversationAttachmentReference) => void; onOpenTaggedFile: (file: NonNullable<ConversationMessage["workspaceFiles"]>[number]) => void; onOpenRetrievals: (message: OptimisticMessage) => void }) {
  const { width } = useWindowDimensions();
  const taggedCardSize = Math.floor((width - 20 * 2 - 2 - 8 * 3) / 4 * 0.75);
  const user = message.role === "user";
  const avatarUrl = useAuthStore((state) => state.user?.avatarUrl);
  const avatarFallback = useAuthStore((state) => profileInitial(state.user));
  const image = message.kind === "image";
  const pending = message.status === "PENDING";
  const failed = message.status === "FAILED";
  const interactive = !message.optimistic && !pending;
  const fileView = useMemo(() => !user && message.status === "COMPLETED" ? conversationFileView(message.retrievals) : undefined, [message.retrievals, message.status, user]);
  return <View style={[styles.messageRow, styles.assistantRow]}>
    {user ? <Avatar fallback={avatarFallback} size={20} style={styles.assistantMark} uri={avatarUrl} /> : <ChromeIcon glow={0.35} size={20} source={assistantIconSource} style={styles.assistantMark} />}
    <View style={[styles.messageContent, styles.assistantMessage]}><Button accessibilityLabel={interactive ? `Open actions for ${user ? "your message" : "Core response"}` : undefined} accessible={interactive} contentMode="raw" onPress={interactive ? () => onOpenActions(message) : undefined} pressFeedback="opacity" shape="rounded" size="xs" style={[styles.messageBox, styles.messageButton, failed && styles.failedMessage]} variant="ghost">{pending && !message.content ? <LoadingText style={[styles.thinkingText, styles.loadingTextRaised]} text="Thinking..." /> : failed ? <Text style={styles.messageText}>{image ? "Image generation is unavailable in Core." : "This response could not be completed."}</Text> : <StreamingRichText content={image ? message.imageSummaryText || "Image generation is unavailable in Core." : message.content} streaming={pending && !image} />}</Button>
    <MessageAttachments message={message} onOpen={onOpenAttachment} />
    {user && message.workspaceFiles?.length ? <ScrollView accessibilityLabel="Tagged files" contentContainerStyle={styles.taggedFileCards} horizontal showsHorizontalScrollIndicator={false} style={styles.taggedFileScroll}>{message.workspaceFiles.map((file) => <ContentFileTile accessibilityLabel={`Open ${file.name}`} file={file} key={file.key} onPress={() => onOpenTaggedFile(file)} size={taggedCardSize} />)}</ScrollView> : null}
    {fileView ? <ActionPill compact onPress={() => onOpenRetrievals(message)} pressLabel="View files"><Text numberOfLines={1} style={styles.retrievalSummary}>View files</Text></ActionPill> : null}
    {message.persistenceKind === "greeting" && message.status === "COMPLETED" && onStorageAction ? <WelcomeChoices onAction={onStorageAction} /> : null}
    </View>
  </View>;
});

function MessageSkeletons({ accessibilityLabel }: { accessibilityLabel: string }) {
  return <View accessibilityLabel={accessibilityLabel} accessibilityRole="progressbar" style={styles.olderSkeletons}>
    <View style={[styles.messageRow, styles.assistantRow]}><Skeleton style={[styles.messageSkeleton, styles.assistantSkeleton, styles.skeletonCard]} /></View>
    <View style={[styles.messageRow, styles.assistantRow]}><Skeleton style={[styles.messageSkeleton, styles.userSkeleton, styles.skeletonCard]} /></View>
  </View>;
}

function InitialMessageSkeletons() {
  return <MessageSkeletons accessibilityLabel="Loading messages" />;
}

function OlderMessageSkeletons() {
  return <MessageSkeletons accessibilityLabel="Loading older messages" />;
}

function ConversationWatermark() {
  return <View pointerEvents="none" style={styles.coreWatermark}><Text style={styles.coreWatermarkText}>Core</Text><View style={styles.coreWatermarkMark}><ChromeIcon glow={0.5} size={104} source={assistantIconSource} /></View><Text style={styles.coreWatermarkText}>Your personal AI for finding answers and natural conversation across Vorinthex AI</Text></View>;
}

const messageKey = ({ key, renderKey, role, turnKey }: OptimisticMessage & { renderKey?: string }) => renderKey ?? (turnKey ? `${turnKey}:${role}` : key);
const conversationKey = ({ key }: Conversation) => key;
const MessageSeparator = () => <View style={styles.messageSeparator} />;

type StorageAction = "open" | "create" | "upload";

export function PersistentCoreComposer({ generationMode = "chat", onStorageAction, ...props }: CoreComposerProps & { openOnMount?: boolean; generationMode?: "chat" | "image" | "speech" | "video"; onStorageAction?: (action: StorageAction) => void }) {
  return generationMode === "chat" ? <ChatCoreComposer {...props} onStorageAction={onStorageAction} /> : <MediaWorkspaceComposer {...props} mode={generationMode} />;
}

function WelcomeChoices({ onAction }: { onAction: (action: StorageAction) => void }) {
  const { width } = useWindowDimensions();
  const size = Math.floor((width - 20 * 2 - 2 - 8 * 2) / 3 * 0.75);
  return <View accessibilityLabel="Choose what to do" style={styles.welcomeChoices}>
      <CapabilityTile icon={<FileIcon size="lg" />} label="Open Storage" onPress={() => onAction("open")} size={size} />
      <CapabilityTile icon={<FolderIcon size="lg" />} label="Create Folder" onPress={() => onAction("create")} size={size} />
      <CapabilityTile icon={<UploadIcon size="lg" />} label="Upload Files" onPress={() => onAction("upload")} size={size} />
  </View>;
}

function ChatCoreComposer({ openOnMount, onStorageAction, ...props }: CoreComposerProps & { openOnMount?: boolean; onStorageAction?: (action: StorageAction) => void }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { showToast } = useToast();
  const userKey = useAuthStore((state) => state.user?.key ?? "");
  const coreFunded = (useWholeSparkBalance(userKey).data ?? 0) > 0;
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const context = useMemo(() => ({ userKey, scopeKey }), [scopeKey, userKey]);
  const identity = conversationContextIdentity(context);
  const configured = Boolean(userKey && scopeKey);
  const rolesQuery = useQuery({ queryKey: ["conversation-roles"], queryFn: ({ signal }) => listConversationRoles(signal), enabled: configured, staleTime: 60 * 60_000 });
  const greetingRequest = useUiStore((state) => state.agentGreetingRequest);
  const [sheet, setSheet] = useState<Sheet>();
  const [selected, setSelected] = useState<Conversation>();
  const [input, setInput] = useState("");
  const [composerKeyboardVisible, setComposerKeyboardVisible] = useState(false);
  const [replyMode, setReplyMode] = useState<"fast" | "reason">("fast");
  const [roleKey, setRoleKey] = useState("general");
  const [roleDraft, setRoleDraft] = useState("general");
  const [roleGridWidth, setRoleGridWidth] = useState(0);
  const [roleChanging, setRoleChanging] = useState(false);
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [hiddenOnly, setHiddenOnly] = useState(false);
  const [selectedConversationKeys, setSelectedConversationKeys] = useState<string[]>([]);
  const [actionConversation, setActionConversation] = useState<Conversation>();
  const [searchPending, setSearchPending] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<OptimisticMessage[]>([]);

  const [turning, setTurning] = useState(false);
  const [greetingMessage, setGreetingMessage] = useState<DisplayMessage>();
  const [coreOpenRequest, setCoreOpenRequest] = useState(openOnMount ? 1 : 0);
  const externalOpenRequest = useRef(props.openRequest ?? 0);
  const latestOpenRequest = useRef(coreOpenRequest);
  latestOpenRequest.current = Math.max(latestOpenRequest.current, coreOpenRequest, greetingRequest?.occasion === "onboarding" ? greetingRequest.id : 0);
  useEffect(() => {
    const request = props.openRequest ?? 0;
    if (request <= externalOpenRequest.current) return;
    externalOpenRequest.current = request;
    setCoreOpenRequest((current) => Math.max(current, latestOpenRequest.current) + 1);
  }, [props.openRequest]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [incognito, setIncognito] = useState(false);
  const [taggedFiles, setTaggedFiles] = useState<ContentFile[]>([]);
  const [routeFocused, setRouteFocused] = useState(false);
  const [coreFocused, setCoreFocused] = useState(false);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [removingHistoryQuery, setRemovingHistoryQuery] = useState<string>();
  const [selectedMessage, setSelectedMessage] = useState<OptimisticMessage>();
  const [selectedAttachment, setSelectedAttachment] = useState<Extract<ConversationAttachmentReference, { kind: "document" }>>();
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([]);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [turnScrollRequest, setTurnScrollRequest] = useState(0);
  const contextRef = useRef(context);
  const identityRef = useRef(identity);
  const selectedRef = useRef<Conversation | undefined>(undefined);
  const incognitoRef = useRef(false);
  const incognitoHasSent = useRef(false);
  const replyModeRef = useRef<"fast" | "reason">("fast");
  const roleKeyRef = useRef("general");
  const roleUpdateBusy = useRef(false);
  const contextConversationKeysRef = useRef<string[]>([]);
  const pickingContextRef = useRef(false);

  const listRef = useRef<FlatList<OptimisticMessage>>(null);
  const nearBottom = useRef(true);
  const followLatest = useRef(false);
  const turnController = useRef<AbortController | undefined>(undefined);
  const greetingController = useRef<AbortController | undefined>(undefined);
  const greetingGeneration = useRef(0);
  const greetingMessageRef = useRef<DisplayMessage | undefined>(undefined);
  const turnGeneration = useRef(0);
  const turnBusy = useRef(false);
  const createOperation = useRef<CreateOperation | undefined>(undefined);
  const historyController = useRef<AbortController | undefined>(undefined);
  const operationControllers = useRef(new Set<AbortController>());
  const mutationKeys = useRef(new Set<string>());
  const longPressedConversation = useRef<string | undefined>(undefined);
  const selectionRestoreGeneration = useRef(0);
  const ephemeralDraft = useRef(false);
  const coreFocusGeneration = useRef(0);
  const coreFocusedRef = useRef(false);
  const scrollFrame = useRef<number | undefined>(undefined);
  const scrollSettleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingScroll = useRef<{ animated: boolean } | undefined>(undefined);
  const deltaBuffer = useRef(new Map<string, string>());
  const deltaFrame = useRef<number | undefined>(undefined);
  const composerValueRef = useRef(input);
  const draftAttachmentsRef = useRef<DraftAttachment[]>([]);
  const submittedAttachmentTurns = useRef(new Map<string, readonly DraftAttachment[]>());
  const settlingAttachmentTurns = useRef(new Set<string>());
  const draftRevision = useRef(0);
  const olderFetchBusy = useRef(false);
  composerValueRef.current = input;
  incognitoRef.current = incognito;
  replyModeRef.current = replyMode;
  roleKeyRef.current = roleKey;

  const openMessageRetrievals = useCallback((message: OptimisticMessage) => {
    const view = conversationFileView(message.retrievals);
    if (!view) return;
    Keyboard.dismiss();
    router.push({ pathname: "/home", params: { fileView: JSON.stringify(view) } });
  }, [router]);
  const openMessageActions = useCallback((message: OptimisticMessage) => { Keyboard.dismiss(); setSelectedMessage(message); setSheet("messageActions"); }, []);
  const shareSelectedMessage = useCallback(() => {
    const message = selectedMessage?.content;
    if (!message) return;
    void NativeShare.share({ message }, { dialogTitle: "Share message" }).catch(() => showToast({ title: "The share sheet could not be opened.", duration: 2_500 }));
    setSheet(undefined);
    setSelectedMessage(undefined);
  }, [selectedMessage, showToast]);

  const listFilter = useMemo(() => ({ query: committedQuery, favoriteOnly, hiddenOnly }), [committedQuery, favoriteOnly, hiddenOnly]);
  const chatsQuery = useInfiniteQuery({
    queryKey: conversationQueryKeys.list(context, listFilter),
    queryFn: ({ pageParam, signal }) => listConversations(context, { cursor: pageParam, ...(committedQuery ? { query: committedQuery } : {}), favoriteOnly, hiddenOnly, recordHistory: false }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: ({ cursor }) => cursor ?? undefined,
    enabled: configured && (sheet === "chats" || sheet === "chatContext" || sheet === "filter") && !searchPending,
  });
  const conversations = useMemo(() => (chatsQuery.data?.pages.flatMap(({ conversations: page }) => page) ?? []).filter((conversation) => (!favoriteOnly || conversation.isFavorite) && (hiddenOnly ? conversation.isHidden : !conversation.isHidden)), [chatsQuery.data, favoriteOnly, hiddenOnly]);
  const messagesQuery = useInfiniteQuery({
    queryKey: conversationQueryKeys.messages(context, selected?.key ?? ""),
    queryFn: ({ pageParam, signal }) => listConversationMessages(context, selected!.key, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: ({ cursor }) => cursor ?? undefined,
    enabled: configured && Boolean(selected && !selected.key.startsWith("optimistic-")),
  });
  const persistedMessages = useMemo(() => conversationMessages(messagesQuery.data), [messagesQuery.data]);
  const dismissedFailedKeys = useRef(new Set<string>());
  const messages = useMemo(() => {
    const visible = (items: readonly OptimisticMessage[]) => items.filter(({ key, status }) => !(status === "FAILED" && dismissedFailedKeys.current.has(key)));
    const current = visible(mergeConversationMessages(persistedMessages, pendingMessages));
    return greetingMessage ? [greetingMessage, ...current] : current;
  }, [greetingMessage, pendingMessages, persistedMessages]);
  const timelineMessages = useMemo(() => [...messages].reverse(), [messages]);
  useEffect(() => { greetingMessageRef.current = greetingMessage; }, [greetingMessage]);
  useEffect(() => {
    const settled = settlePendingAttachmentOverlays(persistedMessages, pendingMessages);
    if (!settled.settledTurnKeys.length) return;
    for (const turnKey of settled.settledTurnKeys) {
      if (settlingAttachmentTurns.current.has(turnKey)) continue;
      settlingAttachmentTurns.current.add(turnKey);
      setPendingMessages((current) => current.filter((message) => !(message.turnKey === turnKey && message.role === "user" && message.attachments.some((attachment) => "local" in attachment))));
      deleteSubmittedAttachmentFiles(turnKey);
      settlingAttachmentTurns.current.delete(turnKey);
    }
  }, [pendingMessages, persistedMessages]);
  const latestMessageKey = messages.at(-1)?.key;
  const openMessageAttachment = useCallback((attachment: ConversationAttachmentReference) => {
    Keyboard.dismiss();
    if (attachment.kind === "document") { setSelectedAttachment(attachment); setSheet("attachmentActions"); }
  }, []);
  const openTaggedFile = useCallback((file: NonNullable<ConversationMessage["workspaceFiles"]>[number]) => {
    Keyboard.dismiss();
    router.push({ pathname: "/file", params: { fileKey: file.key, fileTitle: file.name } } as unknown as Parameters<typeof router.push>[0]);
  }, [router]);
  useEffect(() => {
    const stale = selected;
    if (!stale || !messagesQuery.isError || !isConversationNotFoundError(messagesQuery.error)) return;
    const capturedIdentity = identity;
    queueMicrotask(() => {
      if (!isConversationContextCurrent(capturedIdentity, identityRef) || selectedRef.current?.key !== stale.key) return;
      clearConversationState();
      removeConversationFromLists(queryClient, context, stale.key);
      queryClient.removeQueries({ queryKey: conversationQueryKeys.messages(context, stale.key), exact: true });
      setSelected(undefined); selectedRef.current = undefined;
      setSheet(undefined);
      void writeConversationSelection(context, undefined).catch(() => undefined);
      if (coreFocusedRef.current) useUiStore.getState().requestAgentGreeting("returning");
    });
  }, [context, identity, messagesQuery.error, messagesQuery.isError, queryClient, selected]);

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useFocusEffect(useCallback(() => {
    setRouteFocused(true);
    return () => setRouteFocused(false);
  }, []));

  useEffect(() => {
    const previousIdentity = identityRef.current;
    const previousContext = contextRef.current;
    const controllers = operationControllers.current;
    identityRef.current = identity;
    contextRef.current = context;
    if (previousIdentity !== identity) {
      turnGeneration.current += 1;
      turnController.current?.abort();
      greetingGeneration.current += 1;
      greetingController.current?.abort();
      historyController.current?.abort();
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      turnController.current = undefined;
      greetingController.current = undefined;
      historyController.current = undefined;
      createOperation.current = undefined;
      turnBusy.current = false;
      void queryClient.cancelQueries({ queryKey: conversationQueryKeys.all(previousContext) }).catch(() => undefined);
      queueMicrotask(() => {
        if (identityRef.current !== identity) return;
        for (const attachment of draftAttachmentsRef.current) deleteTemporaryFile(attachment.uri);
        clearSubmittedAttachmentFiles();
        draftAttachmentsRef.current = [];
        setSheet(undefined); setSelected(undefined); setInput(""); setQuery(""); setCommittedQuery(""); setFavoriteOnly(false); setHiddenOnly(false); setSelectedConversationKeys([]); setActionConversation(undefined); contextConversationKeysRef.current = [];
        setSearchPending(false); setPendingMessages([]); setGreetingMessage(undefined); setCoreOpenRequest(0); setTurning(false); setCreating(false);
        setHistory([]); setHistoryLoading(false); setHistoryError(undefined); setRemovingHistoryQuery(undefined);
        setSelectedMessage(undefined);
        setDraftAttachments([]); setIncognito(false); incognitoRef.current = false; incognitoHasSent.current = false; setReplyMode("fast"); replyModeRef.current = "fast"; setRoleKey("general"); roleKeyRef.current = "general"; setRoleDraft("general"); setRoleChanging(false); roleUpdateBusy.current = false;
        selectedRef.current = undefined; nearBottom.current = true; ephemeralDraft.current = false;
      });
    }
    return () => {
      turnGeneration.current += 1;
      turnController.current?.abort();
      greetingGeneration.current += 1;
      greetingController.current?.abort();
      historyController.current?.abort();
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      createOperation.current = undefined;
      turnBusy.current = false;
    };
  }, [context, identity, queryClient]);

  useEffect(() => () => {
    if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
    if (scrollSettleTimer.current !== undefined) clearTimeout(scrollSettleTimer.current);
    if (deltaFrame.current !== undefined) cancelAnimationFrame(deltaFrame.current);
    for (const attachment of draftAttachmentsRef.current) deleteTemporaryFile(attachment.uri);
    clearSubmittedAttachmentFiles();
    greetingController.current?.abort();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => { setCommittedQuery(query.trim()); setSearchPending(false); }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    if (!committedQuery || !chatsQuery.isSuccess || chatsQuery.isFetching) return;
    const capturedIdentity = identity;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
      void listConversations(context, { query: committedQuery, favoriteOnly: false, recordHistory: true }, controller.signal).catch(() => undefined);
    }, 800);
    return () => { clearTimeout(timeout); controller.abort(); if (!isConversationContextCurrent(capturedIdentity, identityRef)) controller.abort(); };
  }, [chatsQuery.isFetching, chatsQuery.isSuccess, committedQuery, context, identity]);

  function rememberConversation(conversation?: Conversation, capturedContext = context) { void writeConversationSelection(capturedContext, conversation).catch(() => undefined); }
  function hasStartedComposerDraft() { return Boolean(composerValueRef.current.trim() || draftAttachmentsRef.current.length); }
  async function restoreConversationSelection(): Promise<ConversationRestoreResult> {
    if (!configured) return "suppressed";
    if (selectedRef.current) return "restored";
    const restoreGeneration = ++selectionRestoreGeneration.current;
    const capturedIdentity = identity; const capturedContext = context;
    const cached = await readConversationSelection(capturedContext);
    if (restoreGeneration !== selectionRestoreGeneration.current || !isConversationContextCurrent(capturedIdentity, identityRef) || !coreFocusedRef.current) return "suppressed";
    if (selectedRef.current) return "restored";
    if (hasStartedComposerDraft()) return "suppressed";
    if (!cached || cached.key.startsWith("optimistic-")) return "empty";
    clearConversationState();
    ephemeralDraft.current = false;
    setSelected(cached); selectedRef.current = cached; setRoleKey(cached.roleKey); roleKeyRef.current = cached.roleKey;
    return "restored";
  }
  function openSheet(next?: Sheet) {
    Keyboard.dismiss();
    if (next === "chatContext") pickingContextRef.current = true;
    else if (next === "chats" || next === "newChat" || next === undefined) pickingContextRef.current = false;
    if (next === "chats") setSelectedConversationKeys([]);
    setSheet(next);
  }
  function applyRole() {
    const next = roleDraft;
    if (!rolesQuery.data?.some((role) => role.key === next)) return;
    const current = selectedRef.current;
    if (current && !current.key.startsWith("optimistic-") && (turnBusy.current || mutationKeys.current.has(current.key))) return;
    setRoleKey(next); roleKeyRef.current = next; openSheet(undefined);
    if (incognitoRef.current || !current || current.key.startsWith("optimistic-") || current.roleKey === next) return;
    const capturedIdentity = identity;
    const capturedContext = context;
    const optimistic = { ...current, roleKey: next, updatedAt: now() };
    mutationKeys.current.add(current.key);
    roleUpdateBusy.current = true; setRoleChanging(true);
    setSelected(optimistic); selectedRef.current = optimistic;
    replaceConversationInMatchingLists(queryClient, capturedContext, optimistic);
    rememberConversation(optimistic, capturedContext);
    const controller = operationController();
    void updateConversation(capturedContext, current.key, { roleKey: next }, controller.signal).then((canonical) => {
      if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
      setSelected((value) => value?.key === current.key ? canonical : value);
      if (selectedRef.current?.key === current.key) { selectedRef.current = canonical; rememberConversation(canonical, capturedContext); }
      replaceConversationInMatchingLists(queryClient, capturedContext, canonical);
      void invalidateConversationSearches(queryClient, capturedContext);
    }).catch((error) => {
      if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
      setSelected((value) => value?.key === current.key ? current : value);
      if (selectedRef.current?.key === current.key) { selectedRef.current = current; setRoleKey(current.roleKey); roleKeyRef.current = current.roleKey; rememberConversation(current, capturedContext); }
      replaceConversationInMatchingLists(queryClient, capturedContext, current);
      showToast({ title: extractDomainErrorMessage(error) ?? "Role could not be changed.", duration: 2_500 });
    }).finally(() => { mutationKeys.current.delete(current.key); operationControllers.current.delete(controller); roleUpdateBusy.current = false; if (isConversationContextCurrent(capturedIdentity, identityRef)) setRoleChanging(false); });
  }
  function stopGreetingGeneration() {
    greetingGeneration.current += 1;
    greetingController.current?.abort();
    greetingController.current = undefined;
  }
  function clearGreetingState() {
    stopGreetingGeneration();
    greetingMessageRef.current = undefined;
    setGreetingMessage(undefined);
  }
  function clearConversationState() {
    if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
    if (scrollSettleTimer.current !== undefined) clearTimeout(scrollSettleTimer.current);
    scrollFrame.current = undefined; scrollSettleTimer.current = undefined; pendingScroll.current = undefined;
    if (deltaFrame.current !== undefined) cancelAnimationFrame(deltaFrame.current);
    deltaFrame.current = undefined; deltaBuffer.current.clear();
    clearSubmittedAttachmentFiles(); setPendingMessages([]); clearGreetingState(); setSelectedMessage(undefined); nearBottom.current = true; followLatest.current = false;
  }
  function operationController() { const controller = new AbortController(); operationControllers.current.add(controller); return controller; }
  function appendDelta(key: string, text: string) {
    deltaBuffer.current.set(key, (deltaBuffer.current.get(key) ?? "") + text);
    if (deltaFrame.current !== undefined) return;
    deltaFrame.current = requestAnimationFrame(() => {
      deltaFrame.current = undefined;
      const buffered = new Map(deltaBuffer.current);
      deltaBuffer.current.clear();
      setPendingMessages((current) => current.map((message) => {
        const delta = buffered.get(message.key);
        return delta ? { ...message, content: message.content + delta } : message;
      }));
    });
  }
  function clearBufferedDeltas() {
    if (deltaFrame.current !== undefined) cancelAnimationFrame(deltaFrame.current);
    deltaFrame.current = undefined;
    deltaBuffer.current.clear();
  }
  const scheduleScrollToEnd = useCallback((animated: boolean, settle = !animated) => {
    pendingScroll.current = { animated };
    if (scrollFrame.current === undefined) {
      scrollFrame.current = requestAnimationFrame(() => {
        scrollFrame.current = undefined;
        const request = pendingScroll.current;
        if (!request || !listRef.current) return;
        pendingScroll.current = undefined;
        listRef.current.scrollToOffset({ animated: request.animated, offset: 0 });
      });
    }
    if (scrollSettleTimer.current !== undefined) {
      clearTimeout(scrollSettleTimer.current);
      scrollSettleTimer.current = undefined;
    }
    if (settle) {
      scrollSettleTimer.current = setTimeout(() => {
        scrollSettleTimer.current = undefined;
        listRef.current?.scrollToOffset({ animated: false, offset: 0 });
      }, 120);
    }
  }, []);
  useLayoutEffect(() => {
    if (!turnScrollRequest) return;
    scheduleScrollToEnd(false);
  }, [scheduleScrollToEnd, turnScrollRequest]);
  const closeCorePage = useRef<() => void>(() => undefined);
  const chooseStorage = useCallback((action: StorageAction) => { closeCorePage.current(); onStorageAction?.(action); }, [onStorageAction]);
  const renderMessage = useCallback<ListRenderItem<DisplayMessage>>(({ item }) => <MessageRow message={item} onStorageAction={onStorageAction ? chooseStorage : undefined} onOpenActions={openMessageActions} onOpenAttachment={openMessageAttachment} onOpenTaggedFile={openTaggedFile} onOpenRetrievals={openMessageRetrievals} />, [chooseStorage, onStorageAction, openMessageActions, openMessageAttachment, openTaggedFile, openMessageRetrievals]);
  useEffect(() => {
    if (!latestMessageKey) return;
    if (!followLatest.current && !nearBottom.current) return;
    nearBottom.current = true;
    scheduleScrollToEnd(false);
  }, [latestMessageKey, scheduleScrollToEnd]);
  useEffect(() => {
    if (!configured || !routeFocused || !coreFocused || !greetingRequest) return;
    const frame = requestAnimationFrame(() => {
      const request = useUiStore.getState().consumeAgentGreeting(greetingRequest.id);
      if (!request) return;
      useAppsStore.getState().enterCore();
      setCoreOpenRequest((current) => Math.max(current, latestOpenRequest.current) + 1);
      const focusGeneration = coreFocusGeneration.current;
      const capturedIdentity = identity;
      const loadingKey = `agent-greeting-${request.id}`;
      void (async () => {
        const restoreResult = request.policy === "restore-or-greet" ? await restoreConversationSelection() : "empty";
        if (focusGeneration !== coreFocusGeneration.current || !coreFocusedRef.current || !isConversationContextCurrent(capturedIdentity, identityRef)) return;
        if (restoreResult === "restored" || restoreResult === "suppressed") { setGreetingMessage(undefined); return; }
        clearConversationState();
        setSelected(undefined); selectedRef.current = undefined;
        ephemeralDraft.current = true;
        selectionRestoreGeneration.current += 1;
        setSheet(undefined);
        const generation = ++greetingGeneration.current;
        const controller = new AbortController();
        greetingController.current = controller;
        const createdAt = now();
        setGreetingMessage({ key: loadingKey, renderKey: loadingKey, conversationKey: "ephemeral", turnKey: loadingKey, kind: "text", role: "assistant", status: "PENDING", attachmentStatus: "NONE", content: "", attachments: [], retrievals: [], guideTopics: { status: "NONE" }, createdAt, optimistic: true });
        const { messageKey, message, persistenceToken } = await requestAgentGreeting(context, request.occasion, (event) => {
          if (generation !== greetingGeneration.current || focusGeneration !== coreFocusGeneration.current || !coreFocusedRef.current || !isConversationContextCurrent(capturedIdentity, identityRef)) return;
          setGreetingMessage((current) => current?.key === loadingKey ? { ...current, content: current.content + event.text } : current);
          scheduleScrollToEnd(false);
        }, controller.signal);
        if (generation !== greetingGeneration.current || focusGeneration !== coreFocusGeneration.current || !coreFocusedRef.current || !isConversationContextCurrent(capturedIdentity, identityRef)) return;
        const completed: DisplayMessage = { key: messageKey, renderKey: loadingKey, conversationKey: "ephemeral", turnKey: `opening:${messageKey}`, kind: "text", role: "assistant", status: "COMPLETED", attachmentStatus: "NONE", content: message, attachments: [], retrievals: [], guideTopics: { status: "NONE" }, persistenceToken, persistenceKind: "greeting", createdAt, completedAt: now(), optimistic: true };
        greetingMessageRef.current = completed;
        setGreetingMessage(completed);
        scheduleScrollToEnd(false);
      })().catch((error) => {
        if (focusGeneration !== coreFocusGeneration.current || !coreFocusedRef.current || !isConversationContextCurrent(capturedIdentity, identityRef) || isExpectedCancellation(error)) return;
        clearGreetingState();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [configured, context, coreFocused, greetingRequest, identity, routeFocused, scheduleScrollToEnd]);
  function handleCoreFocusChange(focused: boolean) {
    if (focused === coreFocusedRef.current) return;
    const apps = useAppsStore.getState();
    coreFocusedRef.current = focused;
    const focusGeneration = ++coreFocusGeneration.current;
    setCoreFocused(focused);
    if (focused) apps.enterCore();
    else apps.leaveCore();
    props.onFocusChange?.(focused);
    if (!focused) {
      if (incognitoRef.current) {
        turnGeneration.current += 1;
        turnController.current?.abort(); turnController.current = undefined;
        turnBusy.current = false; setTurning(false);
        clearConversationState();
        setIncognito(false); incognitoRef.current = false; incognitoHasSent.current = false;
        setRoleKey("general"); roleKeyRef.current = "general";
        draftAttachmentsRef.current.forEach((attachment) => deleteTemporaryFile(attachment.uri));
        draftAttachmentsRef.current = []; setDraftAttachments([]); setTaggedFiles([]); setInput("");
        selectedRef.current = undefined; setSelected(undefined); rememberConversation(undefined);
        ephemeralDraft.current = true;
        return;
      }
      if (hasStartedComposerDraft()) stopGreetingGeneration();
      else clearGreetingState();
      followLatest.current = false;
      return;
    }
    if (useUiStore.getState().agentGreetingRequest || greetingMessageRef.current) return;
    if (ephemeralDraft.current) {
      if (!hasStartedComposerDraft()) useUiStore.getState().requestAgentGreeting("returning");
      return;
    }
    void restoreConversationSelection().then((result) => {
      if (result === "empty" && focusGeneration === coreFocusGeneration.current && coreFocusedRef.current) useUiStore.getState().requestAgentGreeting("returning");
    });
  }

  function addDraftAttachments(files: DraftAttachment[]) {
    const available = Math.max(0, CONVERSATION_ATTACHMENT_MAX_FILES - draftAttachmentsRef.current.length);
    const accepted = files.slice(0, available);
    for (const file of files.slice(available)) deleteTemporaryFile(file.uri);
    const next = [...draftAttachmentsRef.current, ...accepted];
    draftAttachmentsRef.current = next;
    setDraftAttachments(next);
    if (files.length > available) showToast({ title: `Core accepts up to ${CONVERSATION_ATTACHMENT_MAX_FILES} attachments.`, duration: 2_000 });
    return accepted;
  }

  function replaceDraftAttachment(key: string, prepared: DraftAttachment) {
    if (!draftAttachmentsRef.current.some(({ clientKey: candidate }) => candidate === key)) return false;
    const next = draftAttachmentsRef.current.map((attachment) => attachment.clientKey === key ? prepared : attachment);
    draftAttachmentsRef.current = next;
    setDraftAttachments(next);
    return true;
  }

  function removeDraftAttachment(key: string) {
    const removed = draftAttachmentsRef.current.find(({ clientKey: candidate }) => candidate === key);
    if (removed) deleteTemporaryFile(removed.uri);
    const next = draftAttachmentsRef.current.filter(({ clientKey: candidate }) => candidate !== key);
    draftAttachmentsRef.current = next;
    setDraftAttachments(next);
  }

  function deleteSubmittedAttachmentFiles(turnKey: string) {
    const files = submittedAttachmentTurns.current.get(turnKey);
    if (!files) return;
    submittedAttachmentTurns.current.delete(turnKey);
    requestAnimationFrame(() => { for (const file of files) deleteTemporaryFile(file.uri); });
  }

  function clearSubmittedAttachmentFiles() {
    const turns = [...submittedAttachmentTurns.current.values()];
    submittedAttachmentTurns.current.clear();
    for (const files of turns) for (const file of files) deleteTemporaryFile(file.uri);
  }

  function restoreSentAttachments(turnKey: string, files: readonly DraftAttachment[]) {
    submittedAttachmentTurns.current.delete(turnKey);
    const currentKeys = new Set(draftAttachmentsRef.current.map(({ clientKey: key }) => key));
    const next = [...files.filter(({ clientKey: key }) => !currentKeys.has(key)), ...draftAttachmentsRef.current].slice(0, CONVERSATION_ATTACHMENT_MAX_FILES);
    draftAttachmentsRef.current = next;
    setDraftAttachments(next);
  }

  async function pickFiles() {
    openSheet(undefined);
    const remaining = CONVERSATION_ATTACHMENT_MAX_FILES - draftAttachmentsRef.current.length;
    if (remaining <= 0) return;
    const result = await DocumentPicker.getDocumentAsync({ type: [...DOCUMENT_MIME_TYPES], multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    const prepared: DraftAttachment[] = [];
    for (const asset of result.assets.slice(0, remaining)) {
      const mimeType = documentMimeType(asset.name);
      if (!mimeType) { deleteTemporaryFile(asset.uri); continue; }
      const file = new File(asset.uri);
      const filename = asset.name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 255);
      prepared.push({ clientKey: clientKey("attachment"), filename, mimeType, sizeBytes: file.size, uri: asset.uri, kind: "document" });
    }
    if (!prepared.length) showToast({ title: "Choose a TXT, MD, PDF, DOC, or DOCX file.", duration: 2_000 });
    else addDraftAttachments(prepared);
  }

  const mountMessageList = useCallback((list: FlatList<OptimisticMessage> | null) => { listRef.current = list; }, []);

  function toggleConversationSelection(conversationKey: string) {
    setSelectedConversationKeys((current) => current.includes(conversationKey) ? current.filter((key) => key !== conversationKey) : [...current, conversationKey]);
  }

  function handleConversationPress(conversation: Conversation) {
    if (sheet === "chatContext") {
      if (!conversation.key.startsWith("optimistic-") && !mutationKeys.current.has(conversation.key)) toggleConversationSelection(conversation.key);
      return;
    }
    selectConversation(conversation);
  }

  function patchConversation(conversation: Conversation, patch: { isFavorite?: boolean; isHidden?: boolean }, label: string) {
    if (conversation.key.startsWith("optimistic-") || mutationKeys.current.has(conversation.key)) return;
    const capturedIdentity = identity; const capturedContext = context;
    const memberships = conversationListMembershipKeys(queryClient, capturedContext, conversation.key);
    const optimistic = { ...conversation, ...patch, updatedAt: now() };
    mutationKeys.current.add(conversation.key);
    replaceConversationInMatchingLists(queryClient, capturedContext, optimistic);
    if (selectedRef.current?.key === conversation.key) { setSelected(optimistic); selectedRef.current = optimistic; rememberConversation(optimistic, capturedContext); }
    closeConversationAction();
    showToast({ title: label, duration: 2_000 });
    const controller = operationController();
    void updateConversation(capturedContext, conversation.key, patch, controller.signal).then((canonical) => {
      if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
      replaceConversationInMatchingLists(queryClient, capturedContext, canonical);
      if (selectedRef.current?.key === conversation.key) { setSelected(canonical); selectedRef.current = canonical; rememberConversation(canonical, capturedContext); }
      void invalidateConversationSearches(queryClient, capturedContext);
    }).catch(() => {
      if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
      restoreConversationToLists(queryClient, conversation, memberships);
      replaceConversationInMatchingLists(queryClient, capturedContext, conversation);
      if (selectedRef.current?.key === conversation.key) { setSelected(conversation); selectedRef.current = conversation; rememberConversation(conversation, capturedContext); }
      showToast({ title: "Chat could not be updated.", duration: 2_000 });
    }).finally(() => { mutationKeys.current.delete(conversation.key); operationControllers.current.delete(controller); });
  }

  function startContextSeed(conversationKeys: string[]) {
    if (!configured) return;
    contextConversationKeysRef.current = conversationKeys;
    openNewChat({ skipGreeting: true });
    if (!conversationKeys.length) return;
    const capturedIdentity = identity;
    const loadingKey = clientKey("seed");
    const createdAt = now();
    setGreetingMessage({ key: loadingKey, renderKey: loadingKey, conversationKey: "ephemeral", turnKey: loadingKey, kind: "text", role: "assistant", status: "PENDING", attachmentStatus: "NONE", content: "", attachments: [], retrievals: [], guideTopics: { status: "NONE" }, createdAt, optimistic: true, persistenceKind: "seed" });
    const generation = ++greetingGeneration.current;
    const controller = new AbortController();
    greetingController.current = controller;
    void streamConversationContextSeed(context, conversationKeys, (event) => {
      if (generation !== greetingGeneration.current || !isConversationContextCurrent(capturedIdentity, identityRef)) return;
      if (event.type === "start") {
        setGreetingMessage((current) => current?.key === loadingKey ? { ...current, key: event.assistantMessageKey } : current);
      } else if (event.type === "delta") {
        setGreetingMessage((current) => current && (current.key === loadingKey || current.key === event.assistantMessageKey) ? { ...current, content: current.content + event.text } : current);
      } else if (event.type === "done") {
        setGreetingMessage({ key: event.assistantMessageKey, renderKey: loadingKey, conversationKey: "ephemeral", turnKey: `opening:${event.assistantMessageKey}`, kind: "text", role: "assistant", status: "COMPLETED", attachmentStatus: "NONE", content: event.message, attachments: [], retrievals: [], guideTopics: { status: "NONE" }, persistenceToken: event.persistenceToken, persistenceKind: "seed", createdAt, completedAt: now(), optimistic: true });
      }
    }, controller.signal).catch((error) => {
      if (generation !== greetingGeneration.current || !isConversationContextCurrent(capturedIdentity, identityRef) || isExpectedCancellation(error)) return;
      setGreetingMessage(undefined);
      showToast({ title: extractDomainErrorMessage(error) ?? "Those chats could not be summarized.", duration: 2_000 });
    });
  }

  function openConversationActions(conversation: Conversation) {
    if (conversation.key.startsWith("optimistic-") || mutationKeys.current.has(conversation.key)) return;
    setActionConversation(conversation);
    openSheet("current");
  }

  function closeConversationAction() {
    setActionConversation(undefined);
    openSheet(undefined);
  }

  function selectConversation(conversation?: Conversation) {
    selectionRestoreGeneration.current += 1;
    turnGeneration.current += 1; turnController.current?.abort(); turnController.current = undefined; turnBusy.current = false;
    ephemeralDraft.current = false;
    setTurning(false); clearConversationState(); setIncognito(false); incognitoRef.current = false; incognitoHasSent.current = false; setRoleKey(conversation?.roleKey ?? "general"); roleKeyRef.current = conversation?.roleKey ?? "general"; setSelected(conversation); selectedRef.current = conversation; rememberConversation(conversation); openSheet(undefined);
  }

  function beginConversationCreation(openingGreeting?: DisplayMessage) {
    const current = createOperation.current;
    if (current?.identity === identity) return current;
    const capturedIdentity = identity;
    const capturedContext = context;
    const controller = operationController();
    const optimistic: Conversation = { key: clientKey("conversation"), name: "New chat", isFavorite: false, isHidden: false, roleKey: roleKeyRef.current, createdAt: now(), updatedAt: now() };
    setCreating(true);
    setSelected(optimistic); selectedRef.current = optimistic;
    const operation: CreateOperation = { identity: capturedIdentity, optimistic, promise: Promise.resolve(undefined as never) };
    operation.promise = createConversation(capturedContext, "New chat", controller.signal, openingGreeting?.persistenceKind === "seed" ? undefined : openingGreeting?.persistenceToken, openingGreeting?.persistenceKind === "seed" ? openingGreeting.persistenceToken : undefined, optimistic.roleKey).then((created) => {
      if (!isConversationContextCurrent(capturedIdentity, identityRef)) throw new DOMException("Stale identity", "AbortError");
      const openingMessage: ConversationMessage | undefined = openingGreeting ? { key: openingGreeting.key, conversationKey: created.key, turnKey: openingGreeting.turnKey ?? `opening:${openingGreeting.key}`, kind: "text", role: "assistant", status: "COMPLETED", attachmentStatus: "NONE", content: openingGreeting.content, attachments: [], retrievals: [], guideTopics: openingGreeting.guideTopics.status === "READY" ? openingGreeting.guideTopics : { status: "NONE" }, createdAt: openingGreeting.createdAt, completedAt: openingGreeting.completedAt ?? openingGreeting.createdAt } : undefined;
      queryClient.setQueryData(conversationQueryKeys.messages(capturedContext, created.key), { pages: [{ messages: openingMessage ? [openingMessage] : [], cursor: undefined }], pageParams: [undefined] });
      if (openingGreeting && greetingMessageRef.current?.key === openingGreeting.key) { greetingMessageRef.current = undefined; setGreetingMessage(undefined); }
      setSelected((value) => value?.key === optimistic.key ? created : value); selectedRef.current = selectedRef.current?.key === optimistic.key ? created : selectedRef.current;
      return created;
    }).catch((error) => {
      removeConversationFromLists(queryClient, capturedContext, optimistic.key);
      if (isConversationContextCurrent(capturedIdentity, identityRef)) { setSelected((value) => value?.key === optimistic.key ? undefined : value); if (selectedRef.current?.key === optimistic.key) selectedRef.current = undefined; }
      throw error;
    }).finally(() => { operationControllers.current.delete(controller); if (createOperation.current === operation) createOperation.current = undefined; if (isConversationContextCurrent(capturedIdentity, identityRef)) setCreating(false); });
    createOperation.current = operation;
    void operation.promise.catch(() => undefined);
    return operation;
  }

  function openNewChat(options?: { skipGreeting?: boolean }) {
    if (!configured) return;
    clearConversationState();
    setIncognito(false); incognitoRef.current = false; incognitoHasSent.current = false; setRoleKey("general"); roleKeyRef.current = "general";
    setSelected(undefined); selectedRef.current = undefined;
    ephemeralDraft.current = true;
    selectionRestoreGeneration.current += 1;
    rememberConversation(undefined);
    openSheet(undefined);
    if (!options?.skipGreeting) useUiStore.getState().requestAgentGreeting("returning");
  }

  function dismissFailedMessages() {
    for (const message of [...persistedMessages, ...pendingMessages]) {
      if (message.status === "FAILED") dismissedFailedKeys.current.add(message.key);
    }
    setPendingMessages((current) => current.filter(({ status }) => status !== "FAILED"));
  }

   async function submit() {
     const content = input.trim();
    if (!content || !configured) return;
    if (roleUpdateBusy.current) return;
     if (draftAttachmentsRef.current.some(({ preparing }) => preparing)) return;
    if (turnBusy.current) return;
    try {
      await ensureSparkCapacity(1);
    } catch (error) {
      if (isSparkFundingError(error)) return;
    }
    const openingGreeting = greetingMessageRef.current?.status === "COMPLETED" && greetingMessageRef.current.persistenceToken ? greetingMessageRef.current : undefined;
    if (openingGreeting) stopGreetingGeneration();
    else clearGreetingState();
    ephemeralDraft.current = false;
    const submittedDraftRevision = draftRevision.current;
     turnBusy.current = true; followLatest.current = false; setTurning(true); setInput(""); nearBottom.current = false;
    dismissFailedMessages();
    const capturedIdentity = identity; const capturedContext = context; const generation = ++turnGeneration.current;
    const requestKey = clientKey("turn"); const optimisticUserKey = clientKey("user"); const optimisticAssistantKey = clientKey("assistant");
     const submittedAttachments = [...draftAttachmentsRef.current];
     const submittedTaggedFiles = [...taggedFiles];
    const submittedTaggedFileKeys = submittedTaggedFiles.map((file) => file.key);
    const workspaceFiles = submittedTaggedFiles.map(({ key, name, extension }) => ({ key, name, extension }));
     draftAttachmentsRef.current = [];
     setDraftAttachments([]);
     setTaggedFiles([]);
    const incognitoTurn = incognitoRef.current;
    if (incognitoTurn) incognitoHasSent.current = true;
    const existing = incognitoTurn ? undefined : selectedRef.current;
    const operation = incognitoTurn || !existing || existing.key.startsWith("optimistic-") ? (incognitoTurn ? undefined : beginConversationCreation(openingGreeting)) : undefined;
    const pendingConversationKey = incognitoTurn ? "incognito" : existing?.key ?? operation?.optimistic.key ?? "pending";
    const optimisticAttachments = createLocalConversationAttachments(submittedAttachments);
    setPendingMessages((current) => [...current,
      { key: optimisticUserKey, conversationKey: pendingConversationKey, turnKey: requestKey, kind: "text", role: "user", status: "COMPLETED", attachmentStatus: submittedAttachments.length ? "PENDING" : "NONE", content, workspaceFiles, attachments: optimisticAttachments, retrievals: [], guideTopics: { status: "NONE" }, createdAt: now(), optimistic: true },
      { key: optimisticAssistantKey, conversationKey: pendingConversationKey, turnKey: requestKey, kind: "text", role: "assistant", status: "PENDING", attachmentStatus: "NONE", content: "", attachments: [], retrievals: [], guideTopics: { status: "NONE" }, createdAt: now(), optimistic: true },
    ]);
    if (submittedAttachments.length) submittedAttachmentTurns.current.set(requestKey, submittedAttachments);
    setTurnScrollRequest((current) => current + 1);
    let userMessageKey = optimisticUserKey; let assistantMessageKey = optimisticAssistantKey; let activeConversation: Conversation | undefined;
    try {
      activeConversation = incognitoTurn ? { key: "incognito", name: "New chat", isFavorite: false, isHidden: false, roleKey: roleKeyRef.current, createdAt: now(), updatedAt: now() } : operation ? await operation.promise : existing;
      if (!activeConversation || generation !== turnGeneration.current || !isConversationContextCurrent(capturedIdentity, identityRef)) { deleteSubmittedAttachmentFiles(requestKey); return; }
      const active = activeConversation;
      setPendingMessages((current) => current.map((message) => [optimisticUserKey, optimisticAssistantKey].includes(message.key) ? { ...message, conversationKey: active.key } : message));
      const controller = new AbortController(); turnController.current = controller;
      const uploaded = incognitoTurn || !submittedAttachments.length ? undefined : await uploadConversationAttachments(capturedContext, active.key, requestKey, submittedAttachments, controller.signal);
      const attachmentKeys = uploaded?.attachmentKeys ?? [];
      let authoritativeUser: ConversationMessage | undefined;
      const incognitoHistory = incognitoTurn ? [
        ...(greetingMessageRef.current?.status === "COMPLETED" && greetingMessageRef.current.content.trim() ? [{ role: "ASSISTANT" as const, content: greetingMessageRef.current.content }] : []),
        ...pendingMessages.filter((message) => message.status === "COMPLETED" && message.content.trim()).slice(-19).map((message) => ({ role: message.role === "user" ? "USER" as const : "ASSISTANT" as const, content: message.content })),
      ].slice(-20) : undefined;
       await streamConversationTurn(capturedContext, { ...(incognitoTurn ? { incognito: true, history: incognitoHistory } : { conversationKey: active.key }), roleKey: active.roleKey, replyMode: replyModeRef.current, contextConversationKeys: incognitoTurn ? [] : contextConversationKeysRef.current, message: content, requestKey, attachmentKeys: incognitoTurn ? [] : attachmentKeys, workspaceFileKeys: submittedTaggedFileKeys }, (event) => {
        if (generation !== turnGeneration.current || controller.signal.aborted || !isConversationContextCurrent(capturedIdentity, identityRef)) return;
        if (event.type === "start") {
          userMessageKey = event.userMessageKey; assistantMessageKey = event.assistantMessageKey;
          authoritativeUser = event.userMessage;
          if (!incognitoTurn) { addConversationToUnfilteredLists(queryClient, capturedContext, active); rememberConversation(active, capturedContext); }
          setPendingMessages((current) => current.map((message) => message.turnKey === requestKey && message.role === "assistant" ? { ...message, key: assistantMessageKey, conversationKey: event.conversationKey } : message.turnKey === requestKey && message.role === "user" ? { ...message, key: userMessageKey, conversationKey: event.conversationKey } : message));
        } else if (event.type === "delta") {
          appendDelta(assistantMessageKey, event.text);
        } else if (event.type === "done") {
          clearBufferedDeltas();
          followLatest.current = false;
          nearBottom.current = false;
          notifyCoreOutput();
          const currentConversation = selectedRef.current?.key === active.key ? selectedRef.current : active;
          const updated = { ...currentConversation, ...(event.name ? { name: event.name } : {}), updatedAt: event.message.completedAt ?? event.message.createdAt };
           const completedUser: OptimisticMessage = authoritativeUser ?? { key: userMessageKey, conversationKey: event.conversationKey, turnKey: requestKey, kind: "text", role: "user", status: "COMPLETED", attachmentStatus: submittedAttachments.length ? "PENDING" : "NONE", content, workspaceFiles, attachments: [], retrievals: [], guideTopics: { status: "NONE" }, createdAt: now(), completedAt: now() };
          if (incognitoTurn) {
            setPendingMessages((current) => current.map((message) => message.turnKey !== requestKey ? message : message.role === "user" ? { ...completedUser, optimistic: true } : { ...event.message, optimistic: true }));
            turnBusy.current = false; setTurning(false);
            return;
          }
          contextConversationKeysRef.current = [];
          setSelected(updated); selectedRef.current = updated; replaceConversationInMatchingLists(queryClient, capturedContext, updated);
          rememberConversation(updated, capturedContext);
              queryClient.setQueryData(conversationQueryKeys.messages(capturedContext, active.key), (data: typeof messagesQuery.data) => data ? { ...data, pages: data.pages.map((page, index) => index === 0 ? { ...page, messages: replaceTurnMessages(page.messages, completedUser, event.message, [optimisticUserKey, optimisticAssistantKey, userMessageKey, assistantMessageKey]) as ConversationMessage[] } : { ...page, messages: page.messages.filter((message) => message.turnKey !== requestKey) }) } : { pages: [{ messages: [completedUser, event.message] as ConversationMessage[], cursor: undefined }], pageParams: [undefined] });
              setPendingMessages((current) => current.filter((message) => message.turnKey !== requestKey || (submittedAttachments.length > 0 && message.role === "user")));
              turnBusy.current = false; setTurning(false);
        }
      }, controller.signal);
      if (!incognitoTurn && generation === turnGeneration.current && isConversationContextCurrent(capturedIdentity, identityRef)) { await invalidateConversationSearches(queryClient, capturedContext); void queryClient.invalidateQueries({ queryKey: conversationQueryKeys.messages(capturedContext, active.key), refetchType: "none" }); }
    } catch (error) {
      clearBufferedDeltas();
      if (generation !== turnGeneration.current || !isConversationContextCurrent(capturedIdentity, identityRef) || isExpectedCancellation(error)) { deleteSubmittedAttachmentFiles(requestKey); return; }
      followLatest.current = false;
      nearBottom.current = false;
      pendingScroll.current = undefined;
      if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
      if (scrollSettleTimer.current !== undefined) clearTimeout(scrollSettleTimer.current);
      scrollFrame.current = undefined;
      scrollSettleTimer.current = undefined;
        restoreSentAttachments(requestKey, submittedAttachments);
        if (draftRevision.current === submittedDraftRevision) setTaggedFiles((current) => current.length ? current : submittedTaggedFiles);
      const funding = isSparkFundingError(error);
      const message = extractDomainErrorMessage(error) ?? "Core could not complete this response.";
       if (draftRevision.current === submittedDraftRevision) setInput(content);
      setPendingMessages((current) => current.filter(({ key }) => ![optimisticUserKey, optimisticAssistantKey, userMessageKey, assistantMessageKey].includes(key)));
      if (activeConversation) void queryClient.invalidateQueries({ queryKey: conversationQueryKeys.messages(capturedContext, activeConversation.key) });
      if (!funding) showToast({ title: message, duration: 2_000 });
    } finally {
      if (generation === turnGeneration.current && isConversationContextCurrent(capturedIdentity, identityRef)) { turnBusy.current = false; setTurning(false); setTurnScrollRequest((current) => current + 1); turnController.current = undefined; followLatest.current = false; nearBottom.current = false; }
    }
  }

  function confirmDelete() {
    const deleted = actionConversation; if (!deleted || mutationKeys.current.has(deleted.key)) return;
    const capturedIdentity = identity; const capturedContext = context;
    const controller = operationController();
    const memberships = conversationListMembershipKeys(queryClient, capturedContext, deleted.key);
    mutationKeys.current.add(deleted.key);
    const deletingCurrent = selectedRef.current?.key === deleted.key;
    if (deletingCurrent) { turnGeneration.current += 1; turnController.current?.abort(); turnController.current = undefined; turnBusy.current = false; setTurning(false); }
    removeConversationFromLists(queryClient, capturedContext, deleted.key);
    if (deletingCurrent) { clearConversationState(); setSelected(undefined); selectedRef.current = undefined; rememberConversation(undefined, capturedContext); }
    setActionConversation(undefined); openSheet(undefined);
    void (async () => {
      let deletedPersisted = false;
      try {
        await deleteConversation(capturedContext, deleted.key, controller.signal);
        deletedPersisted = true;
        if (!deletingCurrent) { await invalidateConversationSearches(queryClient, capturedContext); return; }
        const result = await restoreConversationSelection();
        if (result === "empty" && coreFocusedRef.current) useUiStore.getState().requestAgentGreeting("returning");
        await invalidateConversationSearches(queryClient, capturedContext);
      } catch (error) {
        if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
        if (!deletedPersisted) {
          restoreConversationToLists(queryClient, deleted, memberships);
          if (deletingCurrent) { setSelected(deleted); selectedRef.current = deleted; rememberConversation(deleted, capturedContext); }
        } else {
          void queryClient.invalidateQueries({ queryKey: conversationQueryKeys.lists(capturedContext), refetchType: "active" });
        }
        if (!isExpectedCancellation(error)) showToast({ title: deletedPersisted ? `Chat deleted, but refresh failed: ${error instanceof Error ? error.message : "unknown error"}` : error instanceof Error ? error.message : "Chat could not be deleted.", duration: 2_000 });
      } finally { mutationKeys.current.delete(deleted.key); operationControllers.current.delete(controller); }
    })();
  }

  function confirmMessageDelete() {
    const conversation = selectedRef.current; const message = selectedMessage;
    if (!conversation || !message || turning || message.optimistic || message.status === "PENDING") return;
    const capturedIdentity = identity; const capturedContext = context; const controller = operationController();
    const queryKey = conversationQueryKeys.messages(capturedContext, conversation.key);
    setSelectedMessage(undefined); openSheet(undefined);
    void (async () => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      const optimistic = removeConversationMessages(queryClient.getQueryData(queryKey), (candidate) => message.turnKey ? candidate.turnKey === message.turnKey : candidate.key === message.key);
      queryClient.setQueryData(queryKey, optimistic.data);
      try {
        const { deletedKeys } = await deleteConversationMessage(capturedContext, conversation.key, message.key, controller.signal);
        if (!isConversationContextCurrent(capturedIdentity, identityRef) || selectedRef.current?.key !== conversation.key) return;
        const deleted = new Set(deletedKeys);
        queryClient.setQueryData(queryKey, (data: typeof messagesQuery.data) => removeConversationMessages(data, ({ key }) => deleted.has(key)).data);
      } catch (error) {
        if (isConversationContextCurrent(capturedIdentity, identityRef) && !isExpectedCancellation(error)) {
          queryClient.setQueryData(queryKey, (data: typeof messagesQuery.data) => restoreConversationMessages(data, optimistic.removed));
          showToast({ title: error instanceof Error ? error.message : "Message could not be deleted.", duration: 2_000 });
        }
      } finally {
        operationControllers.current.delete(controller);
      }
    })();
  }

  async function openSearchHistory() {
    const capturedIdentity = identity; const capturedContext = context; const key = userSearchHistoryQueryKey(capturedContext.userKey);
    const cached = queryClient.getQueryData<ContentSearchHistoryItem[]>(key); const invalidated = queryClient.getQueryState(key)?.isInvalidated === true;
    setHistory(cached ?? []); setHistoryLoading(!cached || invalidated); setHistoryError(undefined); openSheet("history");
    if (cached && !invalidated) return;
    try { const loaded = await getUserSearchHistory(queryClient, capturedContext); if (isConversationContextCurrent(capturedIdentity, identityRef)) setHistory(loaded); }
    catch (error) { if (isConversationContextCurrent(capturedIdentity, identityRef)) setHistoryError(error instanceof Error ? error.message : "Search history could not be loaded."); }
    finally { if (isConversationContextCurrent(capturedIdentity, identityRef)) setHistoryLoading(false); }
  }

  function useHistoryQuery(item: ContentSearchHistoryItem) {
    const promoted = promoteCachedUserSearchHistory(queryClient, context, item); setHistory((current) => [promoted, ...current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery)]);
    setQuery(item.query); setSearchPending(true); openSheet("chats");
  }

  async function removeHistoryQuery(item: ContentSearchHistoryItem) {
    if (removingHistoryQuery) return; const capturedIdentity = identity; const previous = removeCachedUserSearchHistory(queryClient, context, item.normalizedQuery);
    setHistory((current) => current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery)); setRemovingHistoryQuery(item.normalizedQuery);
    try { await deleteContentSearchHistory(item.normalizedQuery); }
    catch (error) { if (isConversationContextCurrent(capturedIdentity, identityRef)) { queryClient.setQueryData(userSearchHistoryQueryKey(context.userKey), previous); setHistory(previous); setHistoryError(error instanceof Error ? error.message : "Search history could not be updated."); } }
    finally { if (isConversationContextCurrent(capturedIdentity, identityRef)) setRemovingHistoryQuery(undefined); }
  }

  const { fetchNextPage: fetchOlderMessagesPage, hasNextPage: hasOlderMessages, isFetchNextPageError, isFetchingNextPage: isFetchingOlderMessages, refetch: refetchMessages } = messagesQuery;
  const fetchOlderMessages = useCallback(() => {
    if (!hasOlderMessages || isFetchingOlderMessages || olderFetchBusy.current) return;
    olderFetchBusy.current = true;
    void fetchOlderMessagesPage().finally(() => { olderFetchBusy.current = false; });
  }, [fetchOlderMessagesPage, hasOlderMessages, isFetchingOlderMessages]);
  const handleMessageScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    nearBottom.current = event.nativeEvent.contentOffset.y < 80;
  }, []);
  const handleMessageScrollBeginDrag = useCallback(() => {
    followLatest.current = false;
    nearBottom.current = false;
    pendingScroll.current = undefined;
    if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
    if (scrollSettleTimer.current !== undefined) clearTimeout(scrollSettleTimer.current);
    scrollFrame.current = undefined;
    scrollSettleTimer.current = undefined;
  }, []);
  const retryMessages = useCallback(() => void refetchMessages(), [refetchMessages]);
  const handleListContentSizeChange = useCallback(() => {
    if (turnBusy.current) return;
    if (followLatest.current) scheduleScrollToEnd(false);
  }, [scheduleScrollToEnd]);
  function changeQuery(value: string) { setSelectedConversationKeys([]); setQuery(value); setSearchPending(true); }

  const chatsInitialError = chatsQuery.isError && !chatsQuery.data;
  const chatsMoreError = chatsQuery.isError && Boolean(chatsQuery.data);
  const chatsLoading = searchPending || (configured && chatsQuery.isPending && chatsQuery.isFetching);
  const persistedSelection = Boolean(selected && !selected.key.startsWith("optimistic-"));
  const messagesLoading = persistedSelection && messagesQuery.isPending && messagesQuery.isFetching;
  const messagesInitialError = persistedSelection && messagesQuery.isError && !messagesQuery.data;
  const messageEmpty = !messagesLoading && !messagesInitialError && messages.length === 0;
  const showIncognito = incognito || (!selected && !messages.some((message) => message.role === "user"));
  const pageActions = <View style={styles.headerActions}><Button accessibilityLabel={incognito ? "Incognito on" : "Turn on incognito"} accessibilityHint={incognito && incognitoHasSent.current ? "Incognito cannot be turned off after sending a message" : undefined} accessibilityState={{ selected: incognito }} contentMode="raw" disabled={!showIncognito || turning || incognito && incognitoHasSent.current} onPress={() => { if (incognitoRef.current) { if (incognitoHasSent.current) return; setIncognito(false); incognitoRef.current = false; return; } if (!selectedRef.current && !turnBusy.current) { setIncognito(true); incognitoRef.current = true; } }} size="xs" style={incognito ? styles.incognitoActive : undefined} variant="icon"><IncognitoIcon size="sm" /></Button><Button accessibilityLabel="Open chats" contentMode="raw" onPress={() => openSheet("chats")} size="xs" variant="icon"><ChatBubbleIcon size="sm" /></Button>{selected && !selected.key.startsWith("optimistic-") && !incognito ? <Button accessibilityLabel="Current chat menu" contentMode="raw" disabled={turning || mutationKeys.current.has(selected.key)} onPress={() => openConversationActions(selected)} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button> : null}</View>;
  const attachmentsPreparing = draftAttachments.some(({ preparing }) => preparing);
  const composerBusy = turning || creating || roleChanging || attachmentsPreparing || messagesLoading || greetingMessage?.status === "PENDING";
  const olderMessagesHeader = useMemo(() => isFetchingOlderMessages ? <OlderMessageSkeletons /> : isFetchNextPageError ? <Button onPress={fetchOlderMessages} size="sm" variant="secondary">Retry older messages</Button> : null, [fetchOlderMessages, isFetchNextPageError, isFetchingOlderMessages]);
  const conversation = <View style={styles.conversation}>
    {messagesLoading ? <InitialMessageSkeletons /> : messagesInitialError ? <View style={styles.centerError}><Text accessibilityRole="alert" style={styles.error}>Messages could not be loaded.</Text><Button onPress={retryMessages} size="sm" variant="secondary">Retry</Button></View> : messageEmpty ? null : <FlatList contentContainerStyle={styles.messageList} data={timelineMessages} initialNumToRender={10} inverted ItemSeparatorComponent={MessageSeparator} keyExtractor={messageKey} ListFooterComponent={olderMessagesHeader} ListHeaderComponent={<View style={styles.messageListFooter} />} maintainVisibleContentPosition={PRESERVE_MESSAGE_POSITION} maxToRenderPerBatch={10} onContentSizeChange={handleListContentSizeChange} onEndReached={fetchOlderMessages} onEndReachedThreshold={0.25} onScroll={handleMessageScroll} onScrollBeginDrag={handleMessageScrollBeginDrag} ref={mountMessageList} removeClippedSubviews={false} renderItem={renderMessage} scrollEventThrottle={80} showsVerticalScrollIndicator={false} style={styles.messageListViewport} updateCellsBatchingPeriod={50} windowSize={7} />}
  </View>;
  const attachmentPills = draftAttachments.length || taggedFiles.length ? <AttachmentPillStrip disabled={turning} items={[...taggedFiles.map((file) => ({ key: file.key, name: file.name, icon: <TaggedFileIcon file={file} />, onOpen: () => openTaggedFile(file), onRemove: () => setTaggedFiles((current) => current.filter((item) => item.key !== file.key)) })), ...draftAttachments.map((attachment) => ({ key: attachment.clientKey, name: displayAttachmentFilename(attachment.filename), icon: attachment.kind === "image" ? <ImageIcon size="sm" variant="muted" /> : <FileIcon size="sm" variant="muted" />, onRemove: () => removeDraftAttachment(attachment.clientKey) }))]} /> : undefined;
  const roleLabel = rolesQuery.data?.find((role) => role.key === roleKey)?.label ?? roleKey[0]!.toUpperCase() + roleKey.slice(1);
  const roleToolbar = <View style={styles.roleControls}><Button accessibilityLabel={`Role: ${roleLabel}`} disabled={!configured || composerBusy} onPress={() => { setRoleDraft(roleKey); openSheet("role"); }} size="xs" variant="secondary">{roleLabel}</Button><Button accessibilityLabel={replyMode === "reason" ? "Reason mode" : "Fast mode"} accessibilityState={{ selected: replyMode === "reason" }} disabled={composerBusy} onPress={() => { const next = replyMode === "fast" ? "reason" : "fast"; setReplyMode(next); replyModeRef.current = next; }} size="xs" variant="secondary">{replyMode === "reason" ? "Reason" : "Fast"}</Button></View>;
  const modeTabs = !composerKeyboardVisible ? <CapabilityTabs disabled={composerBusy || incognito} onValueChange={(mode: CapabilityMode) => router.setParams({ mode })} value="chat" /> : undefined;
  const roleCardWidth = roleGridWidth ? Math.floor((roleGridWidth - 24) / 4) : 0;
  const chatList = (picking: boolean) => chatsLoading ? <View accessibilityLabel={query ? "Searching chats" : "Loading chats"} accessibilityRole="progressbar" style={styles.chatList}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.chatSkeleton, styles.skeletonCard]} />)}</View> : chatsInitialError ? <View style={styles.centerError}><Text accessibilityRole="alert" style={styles.error}>Chats could not be loaded.</Text><Button onPress={() => void chatsQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : <FlatList contentContainerStyle={[styles.chatList, conversations.length === 0 && styles.emptyChatList]} data={conversations} keyExtractor={conversationKey} ListEmptyComponent={<Text style={styles.emptyText}>{committedQuery || favoriteOnly || hiddenOnly ? "No matching chats." : "No chats yet."}</Text>} ListFooterComponent={chatsMoreError ? <Button onPress={() => void chatsQuery.fetchNextPage()} size="md" variant="secondary">Retry more chats</Button> : null} onEndReached={() => { if (chatsQuery.hasNextPage && !chatsQuery.isFetchingNextPage) void chatsQuery.fetchNextPage(); }} onEndReachedThreshold={0.4} renderItem={({ item }) => { const selectedChat = picking && selectedConversationKeys.includes(item.key); return <ActionPill compact onPress={() => handleConversationPress(item)} pressLabel={picking ? `${selectedChat ? "Deselect" : "Select"} ${item.name}` : `Open ${item.name}`} style={selectedChat ? styles.chatPillSelected : undefined}><View style={styles.chatPillContent}><Text numberOfLines={1} style={styles.chatName}>{item.name}</Text></View></ActionPill>; }} />;
  const chatSearch = (picking: boolean) => <View style={styles.searchActions}><View style={styles.search}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search chats" autoFocusInBottomSheet={false} maxLength={500} onChangeText={changeQuery} placeholder="Search..." style={styles.searchInput} value={query} />{query ? <ButtonSizeProvider overrideParent size="xs"><Button accessibilityLabel="Clear chat search" contentMode="raw" iconOnly onPress={() => changeQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button></ButtonSizeProvider> : null}</View><Button accessibilityLabel="Filter chats" contentMode="raw" onPress={() => openSheet("filter")} size="md" variant="icon"><FilterIcon size="sm" variant={favoriteOnly || hiddenOnly ? "accent" : "default"} /></Button></View>;

  return <>
    <CoreComposer {...props} accessibilityHint={coreFunded ? props.accessibilityHint : "Add Sparks to use Core"} disabled={!configured || composerBusy || !coreFunded} editable={configured && !turning && !sheet && coreFunded} expandedAccessory={attachmentPills} expandedFooter={modeTabs} expandedLeading={<PlusIcon size="sm" />} expandedLeadingAccessibilityLabel="Tag files" expandedLeadingDisabled={!configured || composerBusy || !coreFunded} expandedToolbar={roleToolbar} expandedPrompts={props.expandedPrompts ?? CORE_PLACEHOLDER_PROMPTS} focusOnOpenRequest={false} focusRequest={composerFocusRequest} loading={composerBusy} maxLength={CONVERSATION_MESSAGE_MAX_LENGTH} message={conversation} onChangeText={(value) => { draftRevision.current += 1; composerValueRef.current = value; setInput(value); }} onExpandedKeyboardVisibilityChange={setComposerKeyboardVisible} onExpandedLeadingPress={() => setPickerOpen(true)} onFocusChange={handleCoreFocusChange} onSubmit={() => void submit()} openEnabled={coreFunded} openRequest={coreFunded ? Math.max(coreOpenRequest, greetingRequest?.occasion === "onboarding" ? greetingRequest.id : 0) : 0} pageActions={pageActions} pageBackdrop={<ConversationWatermark />} pageIdentity={(closePage) => { closeCorePage.current = closePage; return <View style={styles.coreIdentity}><View style={styles.coreIdentityApp}>{props.pageIdentity(closePage)}</View><ProfileHeaderRight /></View>; }} value={input} />
    <BottomSheet description="Choose how Core approaches this chat." footer={<><Button disabled={!rolesQuery.data?.some((role) => role.key === roleDraft)} onPress={applyRole} size="md" variant="primary">Done</Button><Button onPress={() => openSheet(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open && sheet === "role") openSheet(undefined); }} open={sheet === "role"} title="Choose a role">
      {rolesQuery.isError ? <View style={styles.centerError}><Text style={styles.error}>Roles could not be loaded.</Text><Button onPress={() => void rolesQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : <ScrollView showsVerticalScrollIndicator={false}><View accessibilityLabel={rolesQuery.isPending ? "Loading roles" : undefined} accessibilityRole={rolesQuery.isPending ? "progressbar" : undefined} onLayout={({ nativeEvent }) => setRoleGridWidth(nativeEvent.layout.width)} style={styles.roleGrid}>{roleCardWidth ? rolesQuery.isPending ? Array.from({ length: 12 }, (_, index) => <Skeleton key={index} style={{ width: roleCardWidth, height: 94 }} />) : rolesQuery.data?.map((role) => <RoleOptionCard description={role.description} icon={<RoleIcon role={role.key as RoleIconRole} size="md" />} key={role.key} label={role.label} onPress={() => setRoleDraft(role.key)} selected={roleDraft === role.key} width={roleCardWidth} />) : null}</View></ScrollView>}
    </BottomSheet>
    <FilesPickerSheet context={context} onClose={() => setPickerOpen(false)} onDone={(files) => setTaggedFiles(files)} open={pickerOpen} />
    <BottomSheet footer={<><Button onPress={() => openSheet("newChat")} size="md" variant="primary">New chat</Button><Button onPress={() => openSheet(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open && sheet === "chats") setSheet(undefined); }} open={sheet === "chats" || (sheet === "filter" && !pickingContextRef.current)} title="Chats">
      {chatSearch(false)}
      {chatList(false)}
    </BottomSheet>
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open && sheet === "newChat") openSheet("chats"); }} open={sheet === "newChat"} title=""><BottomSheetMenu><BottomSheetItem onPress={() => { setSelectedConversationKeys([]); openSheet("chatContext"); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Add context from other chats</BottomSheetItem><BottomSheetItem onPress={() => openNewChat()} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Empty chat</BottomSheetItem></BottomSheetMenu></BottomSheet>
    <BottomSheet description="Choose chats to use as context in a new chat." footer={<><Button onPress={() => startContextSeed(selectedConversationKeys)} size="md" variant="primary">Create chat</Button><Button onPress={() => openSheet("newChat")} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open && sheet === "chatContext") openSheet("newChat"); }} open={sheet === "chatContext" || (sheet === "filter" && pickingContextRef.current)} title="New chat">
      {chatSearch(true)}
      {chatList(true)}
    </BottomSheet>
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) openSheet(pickingContextRef.current ? "chatContext" : "chats"); }} open={sheet === "filter"} title=""><View style={styles.filterContent}><View style={styles.filterRow}><Switch accessibilityLabel="Show favorite chats only" checked={favoriteOnly} onCheckedChange={(checked) => { setFavoriteOnly(checked); setHiddenOnly(false); openSheet(pickingContextRef.current ? "chatContext" : "chats"); }} /><Text style={styles.filterLabel}>Favorites</Text></View><View style={styles.filterRow}><Switch accessibilityLabel="Show hidden chats only" checked={hiddenOnly} onCheckedChange={(checked) => { setHiddenOnly(checked); if (checked) setFavoriteOnly(false); openSheet(pickingContextRef.current ? "chatContext" : "chats"); }} /><Text style={styles.filterLabel}>Hidden</Text></View><Button onPress={() => void openSearchHistory()} size="md" variant="secondary">Search history</Button></View></BottomSheet>
    <SearchHistorySheet error={historyError} history={history} loading={historyLoading} onClose={() => openSheet("chats")} onRemove={(item) => void removeHistoryQuery(item)} onSelect={useHistoryQuery} open={sheet === "history"} removingQuery={removingHistoryQuery} />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open && sheet === "current") closeConversationAction(); }} open={sheet === "current" && Boolean(actionConversation)} title=""><BottomSheetMenu>{actionConversation ? <><BottomSheetItem onPress={() => patchConversation(actionConversation, { isFavorite: !actionConversation.isFavorite }, actionConversation.isFavorite ? "Chat unfavorited." : "Chat favorited.")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">{actionConversation.isFavorite ? "Unfavorite" : "Favorite"}</BottomSheetItem><BottomSheetItem onPress={() => patchConversation(actionConversation, { isHidden: !actionConversation.isHidden }, actionConversation.isHidden ? "Chat revealed." : "Chat hidden.")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">{actionConversation.isHidden ? "Reveal" : "Hide"}</BottomSheetItem><BottomSheetItem onPress={() => openSheet("delete")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Delete</BottomSheetItem></> : null}</BottomSheetMenu></BottomSheet>
    <BottomSheet footer={<><Button onPress={confirmDelete} size="md" variant="primary">Delete</Button><Button onPress={() => openSheet("current")} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open && sheet === "delete") openSheet("current"); }} open={sheet === "delete" && Boolean(actionConversation)} title="Delete chat?" />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open && (sheet === "messageActions" || sheet === "deleteMessage")) { setSheet(undefined); setSelectedMessage(undefined); } }} open={sheet === "messageActions" || sheet === "deleteMessage"} title=""><BottomSheetMenu><BottomSheetItem onPress={shareSelectedMessage} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Share message</BottomSheetItem><BottomSheetItem onPress={() => openSheet("deleteMessage")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Delete</BottomSheetItem></BottomSheetMenu></BottomSheet>
    <BottomSheet footer={<><Button onPress={confirmMessageDelete} size="md" variant="primary">Delete</Button><Button onPress={() => openSheet("messageActions")} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open && sheet === "deleteMessage") openSheet("messageActions"); }} open={sheet === "deleteMessage" && Boolean(selectedMessage)} title="Delete message?" />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) { setSheet(undefined); setSelectedAttachment(undefined); } }} open={sheet === "attachmentActions" && Boolean(selectedAttachment)} title=""><BottomSheetMenu><BottomSheetItem onPress={() => { const attachment = selectedAttachment; setSheet(undefined); setSelectedAttachment(undefined); if (attachment) router.push({ pathname: "/file", params: { fileKey: attachment.key, fileTitle: attachment.filename } } as unknown as Parameters<typeof router.push>[0]); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Open file</BottomSheetItem></BottomSheetMenu></BottomSheet>
  </>;
}

const styles = StyleSheet.create({
  welcomeChoices: { flexDirection: "row", gap: spacing.xs },
  taggedFileScroll: { flexGrow: 0, marginTop: spacing.xs, maxWidth: "100%" },
  taggedFileCards: { alignItems: "center", gap: 8, paddingRight: spacing.sm },
  roleControls: { flexDirection: "row", alignItems: "center", gap: 7 },
  roleGrid: { width: "100%", minHeight: 94, flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", gap: 8, paddingBottom: spacing.xl },
  coreIdentity: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", width: "100%" }, coreIdentityApp: { minWidth: 0, flex: 1 }, headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs }, incognitoActive: { borderColor: "#F5F7F8" }, conversation: { flex: 1, minHeight: 0, position: "relative" }, coreWatermark: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.xl, transform: [{ translateY: -spacing.xxl }] }, coreWatermarkMark: { marginVertical: spacing.xs, opacity: 0.3 }, coreWatermarkText: { color: palette.muted, fontSize: 13, lineHeight: 19, maxWidth: 320, opacity: 0.3, textAlign: "center" }, messageList: { flexGrow: 1, zIndex: 1 }, messageSeparator: { height: spacing.md }, messageListFooter: { height: 24 },
  messageListViewport: { flex: 1 },
  messageRow: { width: "100%", flexDirection: "row", alignItems: "flex-start" }, assistantRow: { justifyContent: "flex-start", paddingRight: spacing.lg, gap: spacing.sm }, assistantMark: { marginTop: 4 }, messageContent: { minWidth: 0, gap: spacing.xs }, messageBox: { maxWidth: "100%", borderRadius: radii.md, paddingVertical: 4 }, messageButton: { minHeight: 0, alignItems: "stretch", borderWidth: 0, justifyContent: "flex-start" }, assistantMessage: { minWidth: 0, flex: 1, backgroundColor: "transparent" }, failedMessage: { borderWidth: 1, borderColor: palette.danger, paddingHorizontal: spacing.sm }, messageText: { color: palette.text, fontSize: 14, lineHeight: 20 }, messageAttachments: { alignItems: "flex-start", gap: spacing.xs, marginTop: spacing.xs }, retrievalSummary: { minWidth: 0, flex: 1, color: palette.muted, fontSize: 12 }, guideTopics: { gap: spacing.xs, marginTop: spacing.xs }, guideTopicLabel: { color: palette.text, minWidth: 0, flex: 1, fontSize: 13, lineHeight: 18, textAlign: "left" }, guideTopicsLoading: { marginTop: 2, opacity: 0.62 },
  olderSkeletons: { gap: spacing.md }, messageSkeleton: { height: 18, marginTop: 3, borderRadius: radii.sm }, assistantSkeleton: { width: "76%" }, userSkeleton: { width: "62%" }, thinkingText: { flex: 1 }, loadingTextRaised: { transform: [{ translateY: -3 }] }, skeletonCard: { borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.hairlineBright, opacity: 0.72, overflow: "hidden" }, error: { color: palette.danger, fontSize: 12, marginBottom: spacing.xs }, centerError: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm }, emptyText: { color: palette.muted, fontSize: 13, textAlign: "center" },
  searchActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs }, search: { minHeight: 44, flex: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 12, paddingRight: 8, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page }, searchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  bulkToolbar: { minHeight: 40, marginTop: spacing.sm, padding: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, backgroundColor: palette.panel }, bulkToolbarSelection: { flexDirection: "row", alignItems: "center", gap: 8 }, bulkToolbarClose: { height: 28, width: 28, paddingHorizontal: 0, paddingVertical: 0 }, bulkSelectionText: { color: palette.silver100, fontSize: 12 },
  chatList: { flexGrow: 1, gap: spacing.xs, paddingTop: spacing.md, paddingBottom: spacing.lg }, emptyChatList: { justifyContent: "center" },   chatPillSelected: { borderColor: "#F5F7F8" }, chatPillContent: { minWidth: 0, minHeight: 32, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }, chatName: { minWidth: 0, flex: 1, color: palette.text, lineHeight: 18, textAlign: "left", textAlignVertical: "center" }, chatSkeleton: { width: "100%", height: 38, borderRadius: 999 }, sheetAction: { justifyContent: "center" }, sheetActionText: { width: "100%", textAlign: "center" },
  filterContent: { gap: spacing.sm }, filterRow: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: spacing.sm }, filterLabel: { color: palette.text, fontSize: 13 }, editForm: { paddingTop: spacing.sm, gap: spacing.md }, favoriteRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm }, favoriteLabel: { color: palette.muted, fontSize: 13 },
  attachmentPill: { backgroundColor: palette.page, flexShrink: 0, maxWidth: 158 }, messageAttachmentPill: { alignSelf: "flex-start" }, attachmentPillContent: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", flexShrink: 1, gap: 5 }, attachmentName: { color: palette.text, flexShrink: 1, fontSize: 11, maxWidth: 88 },
});

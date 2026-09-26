import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef } from "react";
import { FlatList, Keyboard, ScrollView, Share as NativeShare, StyleSheet, Text, View, type ListRenderItem, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { ActionPill } from "@vorinthex/shared/ui/action-pill";
import { Avatar } from "@vorinthex/shared/ui/avatar";
import { Button, ButtonSizeProvider } from "@vorinthex/shared/ui/button";
import { ChromeIcon } from "@vorinthex/shared/ui/chrome-icon";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { LoadingText } from "@vorinthex/shared/ui/loading-text";
import { StreamingRichText } from "@vorinthex/shared/ui/rich-text";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Switch } from "@vorinthex/shared/ui/switch";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useSessionToast as useToast } from "@/hooks/use-session-toast";
import { useWholeSparkBalance } from "@/hooks/use-billing-summary";
import { ChatBubbleIcon, CloseIcon, FileIcon, FilterIcon, ImageIcon, MoreHorizontalIcon, PlusIcon, SearchIcon } from "@vorinthex/shared/ui/icons-mobile";

import { BrandedCameraModal } from "@/components/capability/BrandedCameraModal";
import { SearchHistorySheet } from "@/components/SearchHistorySheet";
import { ConversationRetrievalSheet } from "@/components/ConversationRetrievalSheet";
import { ProfileHeaderRight } from "@/components/ProfileAvatarButton";
import { actionToast } from "@/lib/action-toast";
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
  CONVERSATION_IMAGE_PROMPT_MAX_LENGTH,
  CONVERSATION_ATTACHMENT_MAX_FILES,
  CONVERSATION_NAME_MAX_LENGTH,
  conversationContextIdentity,
  createConversation,
  deleteConversation,
  deleteConversationMessage,
  enqueueConversationImageTurn,
  isConversationContextCurrent,
  isConversationNotFoundError,
  listConversationMessages,
  listConversations,
  streamConversationTurn,
  uploadConversationAttachments,
  updateConversation,
  type Conversation,
  type ConversationAttachmentReference,
  type ConversationMessage,
  type ConversationRetrieval,
  type ConversationAttachmentFile,
  type GuideTopic,
  type GuideTopicSelection,
} from "@/lib/conversation-client";
import { fetchGalleryOverview, searchGalleryImages, type GalleryImage } from "@/lib/gallery-client";
import { galleryQueryKeys } from "@/lib/workspace-query-cache";
import { normalizeCapturedJpeg } from "@/lib/captured-image";
import { conversationRetrievalDestination, formatConversationRetrievalSummary, mergeConversationRetrievalResults, type ConversationRetrievalResult } from "@/lib/conversation-retrievals";
import { deleteContentSearchHistory, type ContentSearchHistoryItem } from "@/lib/content-client";
import { readConversationSelection, writeConversationSelection } from "@/lib/conversation-selection-vault";
import { getUserSearchHistory, promoteCachedUserSearchHistory, removeCachedUserSearchHistory, userSearchHistoryQueryKey } from "@/lib/user-search-history-cache";
import { ensureSparkCapacity, IMAGE_GENERATE_MICRO_SPARKS } from "@/lib/billing-client";
import { extractDomainErrorMessage, isSparkFundingError } from "@/lib/domain-error-observer";
import { profileInitial } from "@/lib/auth-helpers";
import { useAuthStore } from "@/state/auth";
import { useAppsStore } from "@/state/apps";
import { useUiStore } from "@/state/ui";
import { assistantIconSource } from "@/data/capability-icons";
import { palette, radii, spacing } from "@/theme/tokens";
import { requestAgentGreeting, requestAgentGreetingTopics } from "@/lib/agent-greeting-client";
import { mapWithConcurrency } from "@/lib/bounded-concurrency";

type CoreComposerProps = ComponentProps<typeof CoreComposer>;
type Sheet = "attachments" | "attachmentActions" | "chats" | "filter" | "history" | "current" | "edit" | "delete" | "bulkActions" | "bulkDelete" | "retrievals" | "messageActions" | "deleteMessage" | "imageActions";
type CreateOperation = { identity: string; optimistic: Conversation; promise: Promise<Conversation> };
type DraftAttachment = ConversationAttachmentFile & { kind: "image" | "document"; preparing?: true };
type ComposerMode = "chat" | "image";
type DisplayMessage = OptimisticMessage & { renderKey?: string; showReferralCodeAction?: boolean; persistenceToken?: string; streamingGuideTopics?: GuideTopic[] };
type ConversationRestoreResult = "restored" | "empty" | "suppressed";

const now = () => new Date().toISOString();
const clientKey = (kind: string) => `optimistic-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const PRESERVE_MESSAGE_POSITION = { minIndexForVisible: 0 } as const;
const DOCUMENT_MIME_TYPES = ["text/plain", "text/markdown", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] as const;
const documentMimeType = (filename: string) => {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  return extension === "txt" ? "text/plain" : extension === "md" ? "text/markdown" : extension === "pdf" ? "application/pdf" : extension === "doc" ? "application/msword" : extension === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : undefined;
};
function displayAttachmentFilename(filename: string) {
  try { return decodeURIComponent(filename.replace(/\+/g, "%20")); }
  catch { return filename.replace(/\+/g, " "); }
}
function imageProgressText(content: string) {
  try { return typeof JSON.parse(content) === "object" ? "Image generation is in progress." : content; }
  catch { return content; }
}
function deleteTemporaryFile(uri: string) {
  try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Picker and camera cache files may already be gone. */ }
}
function notifyCoreOutput() { void Haptics.selectionAsync(); }

function GeneratedConversationImage({ contextIdentity, imageKey, onOpen }: { contextIdentity: string; imageKey?: string; onOpen: (collectionKey?: string) => void }) {
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const { data: image, isError, isPending, refetch } = useQuery({
    queryKey: ["conversation-generated-image-v2", contextIdentity, imageKey ?? "pending"],
    queryFn: async () => (await searchGalleryImages({ imageKey: imageKey! })).images.find(({ key }) => key === imageKey) ?? null,
    enabled: Boolean(imageKey),
  });
  const loaded = Boolean(image?.url && loadedUrl === image.url);
  const failed = Boolean(imageKey) && !isPending && (isError || !image);
  return <View style={styles.generatedImageFrame}>{image ? <Button accessibilityLabel="Open generated image actions" contentMode="raw" onPress={() => onOpen(image.collections?.find(({ name }) => name === "Core")?.key ?? image.collections?.[0]?.key)} shape="rounded" size="xl" style={styles.generatedImageButton} variant="ghost"><Image cachePolicy="memory-disk" contentFit="cover" onError={() => { setLoadedUrl(undefined); void refetch(); }} onLoad={() => setLoadedUrl(image.url)} recyclingKey={imageKey} source={image.url} style={styles.generatedImage} /></Button> : null}{!loaded && !failed ? <Skeleton accessibilityLabel={imageKey ? "Loading generated image" : "Generating image"} accessibilityRole="progressbar" pointerEvents="none" style={[styles.generatedImageOverlay, styles.skeletonCard]} /> : null}{failed ? <View style={[styles.generatedImageOverlay, styles.generatedImageFailure]}><Button onPress={() => void refetch()} size="sm" variant="secondary">Retry generated image</Button></View> : null}</View>;
}

const attachmentImageQueryKey = (contextIdentity: string, imageKey: string) => ["conversation-attachment-image-v2", contextIdentity, imageKey] as const;
const attachmentImageQuery = (contextIdentity: string, imageKey: string) => ({
  queryKey: attachmentImageQueryKey(contextIdentity, imageKey),
  queryFn: async () => (await searchGalleryImages({ imageKey })).images.find(({ key }) => key === imageKey) ?? null,
  staleTime: 10 * 60 * 1_000,
});
const galleryImageCollectionKey = (image: GalleryImage) => image.collections?.find(({ name }) => name === "Core")?.key ?? image.collections?.[0]?.key;

function ConversationImageAttachment({ attachment, contextIdentity, onOpen }: { attachment: ConversationDisplayAttachment; contextIdentity: string; onOpen: (image: GalleryImage) => void }) {
  const queryClient = useQueryClient();
  const local = "local" in attachment;
  const imageKey = local ? undefined : attachment.key;
  const displayKey = local ? attachment.clientKey : attachment.displayKey ?? attachment.key;
  const localUri = useRef<string | undefined>(undefined);
  if (local) localUri.current = attachment.uri;
  const { data: image, isPending, refetch } = useQuery({
    ...attachmentImageQuery(contextIdentity, imageKey ?? "pending"),
    enabled: Boolean(imageKey),
  });
  const source = local ? attachment.uri : image?.url ?? localUri.current;
  useEffect(() => {
    if (local || !image) return;
    const collectionKey = galleryImageCollectionKey(image);
    const galleryContext = { teamKey: contextIdentity.split(":")[1] ?? "", scopeKey: contextIdentity.split(":")[2] ?? "" };
    queryClient.setQueryData(galleryQueryKeys.image(galleryContext, collectionKey, image.key), { images: [image] });
    if (collectionKey) void queryClient.prefetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext, collectionKey), queryFn: () => fetchGalleryOverview(collectionKey, undefined, 100) });
  }, [contextIdentity, image, local, queryClient]);
  return <Button accessibilityLabel={!local && image ? `Open image ${displayAttachmentFilename(attachment.filename)}` : undefined} accessible={!local && Boolean(image)} contentMode="raw" onPress={!local && image ? () => onOpen(image) : undefined} shape="rounded" size="md" style={styles.messageAttachmentImageButton} variant="ghost">{source ? <Image cachePolicy="memory-disk" contentFit="cover" onError={() => { if (!local) void refetch(); }} recyclingKey={displayKey} source={source} style={styles.messageAttachmentImage} /> : isPending ? <Skeleton accessibilityLabel={`Loading ${displayAttachmentFilename(attachment.filename)}`} accessibilityRole="progressbar" style={[styles.messageAttachmentImage, styles.skeletonCard]} /> : <View style={styles.messageAttachmentFallback}><ImageIcon size="sm" variant="muted" /><Text numberOfLines={1} style={styles.messageAttachmentName}>{displayAttachmentFilename(attachment.filename)}</Text></View>}</Button>;
}

function MessageAttachment({ attachment, contextIdentity, onOpen }: { attachment: ConversationDisplayAttachment; contextIdentity: string; onOpen: (attachment: ConversationAttachmentReference, image?: GalleryImage) => void }) {
  if (attachment.kind === "image") return <ConversationImageAttachment attachment={attachment} contextIdentity={contextIdentity} onOpen={(image) => { if (!("local" in attachment)) onOpen(attachment, image); }} />;
  if ("local" in attachment) return <ActionPill compact dense fitContent style={[styles.attachmentPill, styles.messageAttachmentPill]}><View style={styles.attachmentPillContent}><FileIcon size="sm" variant="muted" /><Text numberOfLines={1} style={styles.attachmentName}>{displayAttachmentFilename(attachment.filename)}</Text></View></ActionPill>;
  return <ActionPill compact dense fitContent onPress={() => onOpen(attachment)} pressLabel={`Open actions for ${displayAttachmentFilename(attachment.filename)}`} style={[styles.attachmentPill, styles.messageAttachmentPill]}><View style={styles.attachmentPillContent}><FileIcon size="sm" variant="muted" /><Text numberOfLines={1} style={styles.attachmentName}>{displayAttachmentFilename(attachment.filename)}</Text></View></ActionPill>;
}

function MessageAttachments({ contextIdentity, message, onOpen }: { contextIdentity: string; message: DisplayMessage; onOpen: (attachment: ConversationAttachmentReference, image?: GalleryImage) => void }) {
  const retained = useRef<ConversationDisplayAttachment[]>([]);
  retained.current = conversationAttachmentsForRender(retained.current, message);
  if (!retained.current.length) return null;
  return <View accessibilityLabel="Message attachments" style={styles.messageAttachments}>{retained.current.map((attachment) => <MessageAttachment attachment={attachment} contextIdentity={contextIdentity} key={conversationAttachmentDisplayKey(attachment)} onOpen={onOpen} />)}</View>;
}

function isExpectedCancellation(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  return error.name === "AbortError" || error.name === "CanceledError" || error.name === "CancelledError" || code === "ERR_CANCELED";
}

const MessageRow = memo(function MessageRow({ contextIdentity, message, onGuideTopic, onOpenActions, onOpenAttachment, onOpenImage, onOpenReferralCode, onOpenRetrievals, showGuideTopics }: { contextIdentity: string; message: DisplayMessage; onGuideTopic: (message: DisplayMessage, topic: GuideTopic) => void; onOpenActions: (message: OptimisticMessage) => void; onOpenAttachment: (attachment: ConversationAttachmentReference) => void; onOpenImage: (imageKey: string, collectionKey?: string) => void; onOpenReferralCode: () => void; onOpenRetrievals: (message: OptimisticMessage) => void; showGuideTopics: boolean }) {
  const user = message.role === "user";
  const avatarUrl = useAuthStore((state) => state.user?.avatarUrl);
  const avatarFallback = useAuthStore((state) => profileInitial(state.user));
  const image = message.kind === "image";
  const pending = message.status === "PENDING";
  const failed = message.status === "FAILED";
  const interactive = !message.optimistic && !pending;
  const retrievalResults = useMemo(() => !user && message.status === "COMPLETED" ? mergeConversationRetrievalResults(message.retrievals) : [], [message.retrievals, message.status, user]);
  return <View style={[styles.messageRow, styles.assistantRow]}>
    {user ? <Avatar fallback={avatarFallback} size={20} style={styles.assistantMark} uri={avatarUrl} /> : <ChromeIcon glow={0.35} size={20} source={assistantIconSource} style={styles.assistantMark} />}
    <View style={[styles.messageContent, styles.assistantMessage]}>{image && !user && !failed ? <View style={styles.generatedImageResponse}><StreamingRichText content={imageProgressText(message.content)} streaming={false} style={pending ? styles.loadingTextRaised : undefined} /><GeneratedConversationImage contextIdentity={contextIdentity} imageKey={message.imageKey} onOpen={(collectionKey) => message.imageKey && onOpenImage(message.imageKey, collectionKey)} />{message.status === "COMPLETED" && message.imageSummaryText ? <StreamingRichText content={message.imageSummaryText} streaming={false} /> : null}</View> : <Button accessibilityLabel={interactive ? `Open actions for ${user ? "your message" : "Core response"}` : undefined} accessible={interactive} contentMode="raw" onPress={interactive ? () => onOpenActions(message) : undefined} pressFeedback="opacity" shape="rounded" size="xs" style={[styles.messageBox, styles.messageButton, failed && styles.failedMessage]} variant="ghost">{pending && !message.content ? <LoadingText style={[styles.thinkingText, styles.loadingTextRaised]} text="Thinking..." /> : failed ? <Text style={styles.messageText}>{image ? "Image generation failed." : "This response could not be completed."}</Text> : <StreamingRichText content={message.content} streaming={pending} />}</Button>}
    <MessageAttachments contextIdentity={contextIdentity} message={message} onOpen={onOpenAttachment} />
    {retrievalResults.length ? <ActionPill compact onPress={() => onOpenRetrievals(message)} pressLabel="Open search results"><Text numberOfLines={1} style={styles.retrievalSummary}>{formatConversationRetrievalSummary(retrievalResults)}</Text></ActionPill> : null}
    {!user && message.status === "COMPLETED" && message.showReferralCodeAction ? <ActionPill compact onPress={onOpenReferralCode} pressLabel="Use referral code"><Text numberOfLines={1} style={styles.retrievalSummary}>Use code</Text></ActionPill> : null}
    {showGuideTopics && (message.guideTopics.status === "READY" || message.streamingGuideTopics?.length) ? <View accessibilityLabel="Suggested topics" accessibilityLiveRegion="polite" style={styles.guideTopics}>{(message.guideTopics.status === "READY" ? message.guideTopics.topics : message.streamingGuideTopics ?? []).map((topic) => <ActionPill compact disabled={message.guideTopics.status !== "READY"} key={topic.key} onPress={() => onGuideTopic(message, topic)} pressLabel={`Ask: ${topic.label}`}><Text numberOfLines={1} style={styles.guideTopicLabel}>{topic.label}</Text></ActionPill>)}</View> : null}
    {showGuideTopics && message.guideTopics.status === "PENDING" ? <View accessibilityLabel="Loading suggested topics" accessibilityLiveRegion="polite" accessibilityRole="progressbar" style={styles.guideTopicsLoading}><LoadingText style={styles.loadingTextRaised} text="Finding topics..." /></View> : null}
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
  return <View pointerEvents="none" style={styles.coreWatermark}><Text style={styles.coreWatermarkText}>Core</Text><View style={styles.coreWatermarkMark}><ChromeIcon glow={0.5} size={104} source={assistantIconSource} /></View><Text style={styles.coreWatermarkText}>Your personal AI for finding answers, natural conversation, and image creation across Vorinthex AI</Text></View>;
}

const messageKey = ({ key, renderKey, role, turnKey }: OptimisticMessage & { renderKey?: string }) => renderKey ?? (turnKey ? `${turnKey}:${role}` : key);
const conversationKey = ({ key }: Conversation) => key;
const MessageSeparator = () => <View style={styles.messageSeparator} />;

export function PersistentCoreComposer(props: CoreComposerProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { showToast } = useToast();
  const userKey = useAuthStore((state) => state.user?.key ?? "");
  const coreFunded = (useWholeSparkBalance(userKey).data ?? 0) > 0;
  const teamKey = useAuthStore((state) => String(state.team?.key ?? ""));
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const context = useMemo(() => ({ userKey, teamKey, scopeKey }), [teamKey, scopeKey, userKey]);
  const identity = conversationContextIdentity(context);
  const configured = Boolean(userKey && teamKey && scopeKey);
  const greetingRequest = useUiStore((state) => state.agentGreetingRequest);
  const [sheet, setSheet] = useState<Sheet>();
  const [selected, setSelected] = useState<Conversation>();
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ComposerMode>("chat");
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [selectedConversationKeys, setSelectedConversationKeys] = useState<string[]>([]);
  const [actionConversation, setActionConversation] = useState<Conversation>();
  const [searchPending, setSearchPending] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<OptimisticMessage[]>([]);
  const [editName, setEditName] = useState("");
  const [editFavorite, setEditFavorite] = useState(false);
  const [turning, setTurning] = useState(false);
  const [greetingMessage, setGreetingMessage] = useState<DisplayMessage>();
  const [coreOpenRequest, setCoreOpenRequest] = useState(0);
  const [routeFocused, setRouteFocused] = useState(false);
  const [coreFocused, setCoreFocused] = useState(false);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [removingHistoryQuery, setRemovingHistoryQuery] = useState<string>();
  const [activeRetrievals, setActiveRetrievals] = useState<readonly ConversationRetrieval[]>();
  const [selectedMessage, setSelectedMessage] = useState<OptimisticMessage>();
  const [selectedAttachment, setSelectedAttachment] = useState<Extract<ConversationAttachmentReference, { kind: "document" }>>();
  const [selectedGeneratedImageKey, setSelectedGeneratedImageKey] = useState<string>();
  const [selectedGeneratedImageCollectionKey, setSelectedGeneratedImageCollectionKey] = useState<string>();
  const [editReferenceImageKey, setEditReferenceImageKey] = useState<string>();
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [turnScrollRequest, setTurnScrollRequest] = useState(0);
  const contextRef = useRef(context);
  const identityRef = useRef(identity);
  const selectedRef = useRef<Conversation | undefined>(undefined);
  const editInput = useRef<ComponentRef<typeof TextInput>>(null);
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
  const editReferenceImageKeyRef = useRef(editReferenceImageKey);
  const draftAttachmentsRef = useRef<DraftAttachment[]>([]);
  const submittedAttachmentTurns = useRef(new Map<string, readonly DraftAttachment[]>());
  const settlingAttachmentTurns = useRef(new Set<string>());
  const pendingImageHapticKeys = useRef(new Set<string>());
  const pendingTopicHapticKeys = useRef(new Set<string>());
  const draftRevision = useRef(0);
  const submitGuideTopicRef = useRef<(message: DisplayMessage, topic: GuideTopic) => void>(() => undefined);
  const olderFetchBusy = useRef(false);
  composerValueRef.current = input;
  editReferenceImageKeyRef.current = editReferenceImageKey;

  const openMessageRetrievals = useCallback((message: OptimisticMessage) => {
    if (!mergeConversationRetrievalResults(message.retrievals).length) return;
    Keyboard.dismiss();
    setActiveRetrievals(message.retrievals);
    setSheet("retrievals");
  }, []);
  const closeRetrievals = useCallback(() => { setSheet(undefined); setActiveRetrievals(undefined); }, []);
  const openMessageActions = useCallback((message: OptimisticMessage) => { Keyboard.dismiss(); setSelectedMessage(message); setSheet("messageActions"); }, []);
  const shareSelectedMessage = useCallback(() => {
    const message = selectedMessage?.content;
    if (!message) return;
    void NativeShare.share({ message }, { dialogTitle: "Share message" }).catch(() => showToast({ title: "The share sheet could not be opened.", duration: 2_500 }));
    setSheet(undefined);
    setSelectedMessage(undefined);
  }, [selectedMessage, showToast]);
  const navigateRetrievalResult = useCallback((result: ConversationRetrievalResult) => {
    const destination = conversationRetrievalDestination(result);
    if (!destination) return;
    closeRetrievals();
    router.push(destination);
  }, [closeRetrievals, router]);

  const listFilter = useMemo(() => ({ query: committedQuery, favoriteOnly: false }), [committedQuery]);
  const chatsQuery = useInfiniteQuery({
    queryKey: conversationQueryKeys.list(context, listFilter),
    queryFn: ({ pageParam, signal }) => listConversations(context, { cursor: pageParam, ...(committedQuery ? { query: committedQuery } : {}), favoriteOnly, recordHistory: false }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: ({ cursor }) => cursor ?? undefined,
    enabled: configured && sheet === "chats" && !searchPending,
  });
  const conversations = useMemo(() => (chatsQuery.data?.pages.flatMap(({ conversations: page }) => page) ?? []).filter((conversation) => !favoriteOnly || conversation.isFavorite), [chatsQuery.data, favoriteOnly]);
  const selectedConversations = useMemo(() => conversations.filter(({ key }) => selectedConversationKeys.includes(key)), [conversations, selectedConversationKeys]);
  const allSelectedConversationsFavorite = selectedConversations.length > 0 && selectedConversations.every(({ isFavorite }) => isFavorite);
  const openReferralCode = useCallback(() => {
    Keyboard.dismiss();
    setSheet(undefined);
    router.push({ pathname: "/settings", params: { sheet: "referral", mode: "redeem" } });
  }, [router]);
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
    const capturedIdentity = identity;
    for (const turnKey of settled.settledTurnKeys) {
      if (settlingAttachmentTurns.current.has(turnKey)) continue;
      settlingAttachmentTurns.current.add(turnKey);
      const authoritative = persistedMessages.find((message) => message.turnKey === turnKey && message.role === "user");
      const images = authoritative?.attachments.filter((attachment): attachment is Extract<ConversationAttachmentReference, { kind: "image" }> => attachment.kind === "image") ?? [];
      void Promise.all(images.map(async (attachment) => {
        const image = await queryClient.fetchQuery(attachmentImageQuery(identity, attachment.key));
        if (!image?.url || !await Image.prefetch(image.url, "memory-disk")) throw new Error("Conversation attachment image could not be preloaded.");
      })).then(() => {
        if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
        setPendingMessages((current) => current.filter((message) => !(message.turnKey === turnKey && message.role === "user" && message.attachments.some((attachment) => "local" in attachment))));
        deleteSubmittedAttachmentFiles(turnKey);
      }).catch(() => undefined).finally(() => {
        settlingAttachmentTurns.current.delete(turnKey);
      });
    }
  }, [identity, pendingMessages, persistedMessages, queryClient]);
  useEffect(() => {
    for (const message of persistedMessages) {
      if (!pendingImageHapticKeys.current.has(message.key) || message.kind !== "image" || message.role !== "assistant" || message.status === "PENDING") continue;
      pendingImageHapticKeys.current.delete(message.key);
      if (message.status === "COMPLETED") notifyCoreOutput();
    }
  }, [persistedMessages]);
  useEffect(() => {
    for (const message of persistedMessages) {
      if (!pendingTopicHapticKeys.current.has(message.key) || message.guideTopics.status === "PENDING") continue;
      pendingTopicHapticKeys.current.delete(message.key);
      if (message.guideTopics.status === "READY") notifyCoreOutput();
    }
  }, [persistedMessages]);
  const latestMessageKey = messages.at(-1)?.key;
  const openGeneratedImage = useCallback((imageKey: string, collectionKey?: string) => { Keyboard.dismiss(); setSelectedGeneratedImageKey(imageKey); setSelectedGeneratedImageCollectionKey(collectionKey); setSheet("imageActions"); }, []);
  const openMessageAttachment = useCallback((attachment: ConversationAttachmentReference, image?: GalleryImage) => {
    Keyboard.dismiss();
    if (attachment.kind === "document") { setSelectedAttachment(attachment); setSheet("attachmentActions"); }
    else {
      const collectionKey = image ? galleryImageCollectionKey(image) : undefined;
      router.push({ pathname: "/capability/[slug]", params: { slug: "gallery", imageKey: attachment.key, ...(collectionKey ? { assetKey: collectionKey } : {}) } });
    }
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
      setActiveRetrievals(undefined); setSheet(undefined);
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
        setSheet(undefined); setSelected(undefined); setInput(""); setMode("chat"); setQuery(""); setCommittedQuery(""); setFavoriteOnly(false); setSelectedConversationKeys([]); setActionConversation(undefined);
        setSearchPending(false); setPendingMessages([]); setGreetingMessage(undefined); setCoreOpenRequest(0); setEditName(""); setEditFavorite(false); setTurning(false); setCreating(false);
        setHistory([]); setHistoryLoading(false); setHistoryError(undefined); setRemovingHistoryQuery(undefined);
        setActiveRetrievals(undefined); setSelectedMessage(undefined); setSelectedGeneratedImageKey(undefined); setSelectedGeneratedImageCollectionKey(undefined); setEditReferenceImageKey(undefined);
        setDraftAttachments([]); setCameraOpen(false);
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

  useEffect(() => {
    if (sheet !== "edit") return;
    const timeout = setTimeout(() => editInput.current?.focus(), 360);
    return () => { clearTimeout(timeout); editInput.current?.blur(); };
  }, [sheet]);

  function rememberConversation(conversation?: Conversation, capturedContext = context) { void writeConversationSelection(capturedContext, conversation).catch(() => undefined); }
  function hasStartedComposerDraft() { return Boolean(composerValueRef.current.trim() || draftAttachmentsRef.current.length || editReferenceImageKeyRef.current); }
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
    setSelected(cached); selectedRef.current = cached;
    return "restored";
  }
  function openSheet(next?: Sheet) { Keyboard.dismiss(); setSheet(next); }
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
    clearSubmittedAttachmentFiles(); pendingImageHapticKeys.current.clear(); pendingTopicHapticKeys.current.clear(); setPendingMessages([]); clearGreetingState(); setSelectedMessage(undefined); setSelectedGeneratedImageKey(undefined); setSelectedGeneratedImageCollectionKey(undefined); setEditReferenceImageKey(undefined); nearBottom.current = true; followLatest.current = false;
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
  const submitGuideTopic = useCallback((message: DisplayMessage, topic: GuideTopic) => submitGuideTopicRef.current(message, topic), []);
  const renderMessage = useCallback<ListRenderItem<DisplayMessage>>(({ item }) => <MessageRow contextIdentity={identity} message={item} onGuideTopic={submitGuideTopic} onOpenActions={openMessageActions} onOpenAttachment={openMessageAttachment} onOpenImage={openGeneratedImage} onOpenReferralCode={openReferralCode} onOpenRetrievals={openMessageRetrievals} showGuideTopics={item.role === "assistant" && item.status === "COMPLETED"} />, [identity, openGeneratedImage, openMessageActions, openMessageAttachment, openMessageRetrievals, openReferralCode, submitGuideTopic]);
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
      setCoreOpenRequest((current) => current + 1);
      const focusGeneration = coreFocusGeneration.current;
      const capturedIdentity = identity;
      const loadingKey = `agent-greeting-${request.id}`;
      let activeGreetingGeneration: number | undefined;
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
        activeGreetingGeneration = generation;
        const controller = new AbortController();
        greetingController.current = controller;
        const createdAt = now();
        setGreetingMessage({ key: loadingKey, renderKey: loadingKey, conversationKey: "ephemeral", turnKey: loadingKey, kind: "text", role: "assistant", status: "PENDING", attachmentStatus: "NONE", content: "", attachments: [], retrievals: [], guideTopics: { status: "NONE" }, createdAt, optimistic: true });
        const { messageKey, message, showReferralCodeAction, topicsPending, persistenceToken } = await requestAgentGreeting(context, request.occasion, (event) => {
          if (generation !== greetingGeneration.current || focusGeneration !== coreFocusGeneration.current || !coreFocusedRef.current || !isConversationContextCurrent(capturedIdentity, identityRef)) return;
          setGreetingMessage((current) => current?.key === loadingKey ? { ...current, content: current.content + event.text } : current);
          scheduleScrollToEnd(false);
        }, controller.signal);
        if (generation !== greetingGeneration.current || focusGeneration !== coreFocusGeneration.current || !coreFocusedRef.current || !isConversationContextCurrent(capturedIdentity, identityRef)) return;
        notifyCoreOutput();
        const completed: DisplayMessage = { key: messageKey, renderKey: loadingKey, conversationKey: "ephemeral", turnKey: `opening:${messageKey}`, kind: "text", role: "assistant", status: "COMPLETED", attachmentStatus: "NONE", content: message, attachments: [], retrievals: [], guideTopics: topicsPending ? { status: "PENDING" } : { status: "NONE" }, persistenceToken, showReferralCodeAction, createdAt, completedAt: now(), optimistic: true };
        greetingMessageRef.current = completed;
        setGreetingMessage(completed);
        scheduleScrollToEnd(false);
        if (!topicsPending) return;
        try {
          const generated = await requestAgentGreetingTopics(context, persistenceToken, (event) => {
            if (generation !== greetingGeneration.current || focusGeneration !== coreFocusGeneration.current || !coreFocusedRef.current || !isConversationContextCurrent(capturedIdentity, identityRef)) return;
            setGreetingMessage((current) => current?.key === messageKey ? { ...current, streamingGuideTopics: [...(current.streamingGuideTopics ?? []), event.topic] } : current);
            scheduleScrollToEnd(false);
          }, controller.signal);
          if (generation !== greetingGeneration.current || focusGeneration !== coreFocusGeneration.current || !coreFocusedRef.current || !isConversationContextCurrent(capturedIdentity, identityRef)) return;
          notifyCoreOutput();
          const ready: DisplayMessage = { ...completed, guideTopics: { status: "READY", topics: generated.topics }, persistenceToken: generated.persistenceToken };
          greetingMessageRef.current = ready;
          setGreetingMessage(ready);
          scheduleScrollToEnd(false);
        } catch (error) {
          if (generation !== greetingGeneration.current || focusGeneration !== coreFocusGeneration.current || !coreFocusedRef.current || !isConversationContextCurrent(capturedIdentity, identityRef) || isExpectedCancellation(error)) return;
          const failed: DisplayMessage = { ...completed, guideTopics: { status: "FAILED" } };
          greetingMessageRef.current = failed;
          setGreetingMessage(failed);
        }
      })().catch((error) => {
        if (activeGreetingGeneration !== greetingGeneration.current || focusGeneration !== coreFocusGeneration.current || !coreFocusedRef.current || !isConversationContextCurrent(capturedIdentity, identityRef) || isExpectedCancellation(error)) return;
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

  async function pickImages() {
    openSheet(undefined);
    const remaining = CONVERSATION_ATTACHMENT_MAX_FILES - draftAttachmentsRef.current.length;
    if (remaining <= 0) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: remaining, quality: 1, exif: true });
    if (result.canceled) return;
    const selected = result.assets.map((asset, index) => {
      const stem = (asset.fileName ?? `image-${index + 1}`).replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 240) || "image";
      return { asset, draft: { clientKey: clientKey("attachment"), filename: `${stem}.jpg`, mimeType: "image/jpeg" as const, sizeBytes: 1, uri: asset.uri, kind: "image" as const, preparing: true as const } };
    });
    const acceptedKeys = new Set(addDraftAttachments(selected.map(({ draft }) => draft)).map(({ clientKey: key }) => key));
    let failures = 0;
    await mapWithConcurrency(selected.filter(({ draft }) => acceptedKeys.has(draft.clientKey)), 3, async ({ asset, draft }) => {
      try {
        const normalized = await normalizeCapturedJpeg(asset, { maxSide: 1600, compress: 0.82 });
        const { preparing: _preparing, ...placeholder } = draft;
        const prepared = { ...placeholder, sizeBytes: normalized.sizeBytes, uri: normalized.uri };
        if (!replaceDraftAttachment(draft.clientKey, prepared)) deleteTemporaryFile(normalized.uri);
      } catch {
        failures += 1;
        removeDraftAttachment(draft.clientKey);
      }
    });
    if (failures) showToast({ title: failures === 1 ? "An image could not be prepared." : `${failures} images could not be prepared.`, duration: 2_000 });
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

  function captureImage(picture: Parameters<NonNullable<ComponentProps<typeof BrandedCameraModal>["onCapture"]>>[0]) {
    const key = clientKey("attachment");
    const draft: DraftAttachment = { clientKey: key, filename: `capture-${Date.now()}.jpg`, mimeType: "image/jpeg", sizeBytes: 1, uri: picture.uri, kind: "image", preparing: true };
    setCameraOpen(false);
    if (!addDraftAttachments([draft]).length) return;
    void normalizeCapturedJpeg(picture, { maxSide: 1600, compress: 0.82 }).then((normalized) => {
      if (normalized.uri !== picture.uri) deleteTemporaryFile(picture.uri);
      const { preparing: _preparing, ...placeholder } = draft;
      if (!replaceDraftAttachment(key, { ...placeholder, sizeBytes: normalized.sizeBytes, uri: normalized.uri })) deleteTemporaryFile(normalized.uri);
    }).catch((error) => {
      removeDraftAttachment(key);
      showToast({ title: error instanceof Error ? error.message : "The photo could not be prepared.", duration: 2_000 });
    });
  }
  const mountMessageList = useCallback((list: FlatList<OptimisticMessage> | null) => { listRef.current = list; }, []);

  function toggleConversationSelection(conversationKey: string) {
    setSelectedConversationKeys((current) => current.includes(conversationKey) ? current.filter((key) => key !== conversationKey) : [...current, conversationKey]);
  }

  function handleConversationLongPress(conversation: Conversation, suppressPress = true) {
    if (conversation.key.startsWith("optimistic-") || mutationKeys.current.has(conversation.key)) return;
    if (suppressPress) {
      longPressedConversation.current = conversation.key;
      setTimeout(() => { if (longPressedConversation.current === conversation.key) longPressedConversation.current = undefined; }, 50);
    }
    const enteringSelection = selectedConversationKeys.length === 0 && !selectedConversationKeys.includes(conversation.key);
    toggleConversationSelection(conversation.key);
    if (enteringSelection) void Haptics.selectionAsync();
  }

  function handleConversationPress(conversation: Conversation) {
    if (longPressedConversation.current === conversation.key) { longPressedConversation.current = undefined; return; }
    if (selectedConversationKeys.length) { if (!conversation.key.startsWith("optimistic-") && !mutationKeys.current.has(conversation.key)) toggleConversationSelection(conversation.key); return; }
    selectConversation(conversation);
  }

  function openConversationActions(conversation: Conversation) {
    if (conversation.key.startsWith("optimistic-") || mutationKeys.current.has(conversation.key)) return;
    setActionConversation(conversation);
    openSheet("current");
  }

  function openConversationEdit() {
    if (!actionConversation) return;
    setEditName(actionConversation.name);
    setEditFavorite(actionConversation.isFavorite);
    openSheet("edit");
  }

  function closeConversationAction() {
    editInput.current?.blur();
    setActionConversation(undefined);
    openSheet(undefined);
  }

  function selectConversation(conversation?: Conversation) {
    selectionRestoreGeneration.current += 1;
    turnGeneration.current += 1; turnController.current?.abort(); turnController.current = undefined; turnBusy.current = false;
    ephemeralDraft.current = false;
    setTurning(false); clearConversationState(); setSelected(conversation); selectedRef.current = conversation; rememberConversation(conversation); setActiveRetrievals(undefined); openSheet(undefined);
  }

  function beginConversationCreation(openingGreeting?: DisplayMessage) {
    const current = createOperation.current;
    if (current?.identity === identity) return current;
    const capturedIdentity = identity;
    const capturedContext = context;
    const controller = operationController();
    const optimistic: Conversation = { key: clientKey("conversation"), name: "New chat", isFavorite: false, createdAt: now(), updatedAt: now() };
    setCreating(true);
    setSelected(optimistic); selectedRef.current = optimistic;
    const operation: CreateOperation = { identity: capturedIdentity, optimistic, promise: Promise.resolve(undefined as never) };
    operation.promise = createConversation(capturedContext, "New chat", controller.signal, openingGreeting?.persistenceToken).then((created) => {
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

  function openNewChat() {
    if (!configured) return;
    clearConversationState();
    setSelected(undefined); selectedRef.current = undefined;
    ephemeralDraft.current = true;
    selectionRestoreGeneration.current += 1;
    rememberConversation(undefined);
    openSheet(undefined);
    useUiStore.getState().requestAgentGreeting("returning");
  }

  function dismissFailedMessages() {
    for (const message of [...persistedMessages, ...pendingMessages]) {
      if (message.status === "FAILED") dismissedFailedKeys.current.add(message.key);
    }
    setPendingMessages((current) => current.filter(({ status }) => status !== "FAILED"));
  }

  async function submit(direct?: { content: string; guideTopicSelection: GuideTopicSelection }) {
    const content = (direct?.content ?? input).trim();
    if (!content || !configured) return;
    if (!direct && draftAttachmentsRef.current.some(({ preparing }) => preparing)) return;
    if (turnBusy.current) return;
    const useImageTurn = mode === "image" && !direct && draftAttachmentsRef.current.length === 0;
    try {
      await ensureSparkCapacity(useImageTurn ? IMAGE_GENERATE_MICRO_SPARKS : 1);
    } catch (error) {
      if (isSparkFundingError(error)) return;
    }
    const openingGreeting = greetingMessageRef.current?.status === "COMPLETED" && greetingMessageRef.current.persistenceToken ? greetingMessageRef.current : undefined;
    if (openingGreeting) stopGreetingGeneration();
    else clearGreetingState();
    ephemeralDraft.current = false;
    const submittedDraftRevision = draftRevision.current;
    turnBusy.current = true; followLatest.current = false; setTurning(true); if (!direct) setInput(""); nearBottom.current = false;
    dismissFailedMessages();
    const capturedIdentity = identity; const capturedContext = context; const generation = ++turnGeneration.current;
    const requestKey = clientKey("turn"); const optimisticUserKey = clientKey("user"); const optimisticAssistantKey = clientKey("assistant");
    const submittedAttachments = direct ? [] : [...draftAttachmentsRef.current];
    const submittedReferenceImageKey = direct ? undefined : editReferenceImageKey;
    if (!direct) {
      draftAttachmentsRef.current = [];
      setDraftAttachments([]);
      setEditReferenceImageKey(undefined);
    }
    const existing = selectedRef.current;
    const operation = !existing || existing.key.startsWith("optimistic-") ? beginConversationCreation(openingGreeting) : undefined;
    const pendingConversationKey = existing?.key ?? operation?.optimistic.key ?? "pending";
    const optimisticAttachments = createLocalConversationAttachments(submittedAttachments);
    setPendingMessages((current) => [...current,
      { key: optimisticUserKey, conversationKey: pendingConversationKey, turnKey: requestKey, kind: useImageTurn ? "image" : "text", role: "user", status: "COMPLETED", attachmentStatus: submittedAttachments.length ? "PENDING" : "NONE", content, attachments: optimisticAttachments, retrievals: [], guideTopics: { status: "NONE" }, createdAt: now(), optimistic: true },
      { key: optimisticAssistantKey, conversationKey: pendingConversationKey, turnKey: requestKey, kind: useImageTurn ? "image" : "text", role: "assistant", status: "PENDING", attachmentStatus: "NONE", content: useImageTurn ? JSON.stringify({ prompt: content }) : "", attachments: [], retrievals: [], guideTopics: { status: "NONE" }, createdAt: now(), optimistic: true },
    ]);
    if (submittedAttachments.length) submittedAttachmentTurns.current.set(requestKey, submittedAttachments);
    setTurnScrollRequest((current) => current + 1);
    let userMessageKey = optimisticUserKey; let assistantMessageKey = optimisticAssistantKey; let activeConversation: Conversation | undefined;
    try {
      activeConversation = operation ? await operation.promise : existing;
      if (!activeConversation || generation !== turnGeneration.current || !isConversationContextCurrent(capturedIdentity, identityRef)) { deleteSubmittedAttachmentFiles(requestKey); return; }
      const active = activeConversation;
      setPendingMessages((current) => current.map((message) => [optimisticUserKey, optimisticAssistantKey].includes(message.key) ? { ...message, conversationKey: active.key } : message));
      const controller = new AbortController(); turnController.current = controller;
      const persistTurn = (userMessage: ConversationMessage, assistantMessage: ConversationMessage) => {
        addConversationToUnfilteredLists(queryClient, capturedContext, active);
        rememberConversation(active, capturedContext);
        const currentConversation = selectedRef.current?.key === active.key ? selectedRef.current : active;
        const updated = { ...currentConversation, updatedAt: assistantMessage.completedAt ?? assistantMessage.createdAt };
        setSelected(updated); selectedRef.current = updated; replaceConversationInMatchingLists(queryClient, capturedContext, updated);
        rememberConversation(updated, capturedContext);
        queryClient.setQueryData(conversationQueryKeys.messages(capturedContext, active.key), (data: typeof messagesQuery.data) => data ? { ...data, pages: data.pages.map((page, index) => index === 0 ? { ...page, messages: replaceTurnMessages(page.messages, userMessage, assistantMessage, [optimisticUserKey, optimisticAssistantKey, userMessageKey, assistantMessageKey]) as ConversationMessage[] } : { ...page, messages: page.messages.filter((message) => message.turnKey !== requestKey) }) } : { pages: [{ messages: [userMessage, assistantMessage] as ConversationMessage[], cursor: undefined }], pageParams: [undefined] });
        setPendingMessages((current) => current.filter((message) => message.turnKey !== requestKey || (submittedAttachments.length > 0 && message.role === "user")));
        turnBusy.current = false; setTurning(false);
      };
      if (useImageTurn) {
        const result = await enqueueConversationImageTurn(capturedContext, { conversationKey: active.key, prompt: content.slice(0, CONVERSATION_IMAGE_PROMPT_MAX_LENGTH), requestKey, referenceImageKeys: submittedReferenceImageKey ? [submittedReferenceImageKey] : [] }, controller.signal);
        if (generation !== turnGeneration.current || controller.signal.aborted || !isConversationContextCurrent(capturedIdentity, identityRef)) return;
        userMessageKey = result.user.key; assistantMessageKey = result.assistant.key;
        if (result.assistant.status === "PENDING") pendingImageHapticKeys.current.add(result.assistant.key);
        else if (result.assistant.status === "COMPLETED") notifyCoreOutput();
        persistTurn(result.user, result.assistant);
      } else {
      const uploaded = submittedAttachments.length ? await uploadConversationAttachments(capturedContext, active.key, requestKey, submittedAttachments, controller.signal) : undefined;
      const attachmentKeys = uploaded?.attachmentKeys ?? [];
      let authoritativeUser: ConversationMessage | undefined;
      await streamConversationTurn(capturedContext, { conversationKey: active.key, message: content, requestKey, attachmentKeys, referenceImageKeys: submittedReferenceImageKey ? [submittedReferenceImageKey] : [], ...(direct ? { guideTopicSelection: direct.guideTopicSelection } : {}) }, (event) => {
        if (generation !== turnGeneration.current || controller.signal.aborted || !isConversationContextCurrent(capturedIdentity, identityRef)) return;
        if (event.type === "start") {
          userMessageKey = event.userMessageKey; assistantMessageKey = event.assistantMessageKey;
          authoritativeUser = event.userMessage;
          addConversationToUnfilteredLists(queryClient, capturedContext, active);
          rememberConversation(active, capturedContext);
          setPendingMessages((current) => current.map((message) => message.turnKey === requestKey && message.role === "assistant" ? { ...message, key: assistantMessageKey } : message));
        } else if (event.type === "delta") {
          appendDelta(assistantMessageKey, event.text);
        } else if (event.type === "done") {
          clearBufferedDeltas();
          followLatest.current = false;
          nearBottom.current = false;
          if (event.message.guideTopics.status === "PENDING") pendingTopicHapticKeys.current.add(event.message.key);
          if (event.message.kind === "image" && event.message.role === "assistant") {
            if (event.message.status === "PENDING") pendingImageHapticKeys.current.add(event.message.key);
            else if (event.message.status === "COMPLETED") notifyCoreOutput();
          } else notifyCoreOutput();
          const currentConversation = selectedRef.current?.key === active.key ? selectedRef.current : active;
          const updated = { ...currentConversation, ...(event.name ? { name: event.name } : {}), updatedAt: event.message.completedAt ?? event.message.createdAt };
           const completedUser: OptimisticMessage = authoritativeUser ?? { key: userMessageKey, conversationKey: active.key, turnKey: requestKey, kind: "text", role: "user", status: "COMPLETED", attachmentStatus: submittedAttachments.length ? "PENDING" : "NONE", content, attachments: [], retrievals: [], guideTopics: { status: "NONE" }, createdAt: now(), completedAt: now() };
          setSelected(updated); selectedRef.current = updated; replaceConversationInMatchingLists(queryClient, capturedContext, updated);
          rememberConversation(updated, capturedContext);
              queryClient.setQueryData(conversationQueryKeys.messages(capturedContext, active.key), (data: typeof messagesQuery.data) => data ? { ...data, pages: data.pages.map((page, index) => index === 0 ? { ...page, messages: replaceTurnMessages(page.messages, completedUser, event.message, [optimisticUserKey, optimisticAssistantKey, userMessageKey, assistantMessageKey]) as ConversationMessage[] } : { ...page, messages: page.messages.filter((message) => message.turnKey !== requestKey) }) } : { pages: [{ messages: [completedUser, event.message] as ConversationMessage[], cursor: undefined }], pageParams: [undefined] });
              setPendingMessages((current) => current.filter((message) => message.turnKey !== requestKey || (submittedAttachments.length > 0 && message.role === "user")));
              turnBusy.current = false; setTurning(false);
        }
      }, controller.signal);
      }
      if (generation === turnGeneration.current && isConversationContextCurrent(capturedIdentity, identityRef)) { await invalidateConversationSearches(queryClient, capturedContext); void queryClient.invalidateQueries({ queryKey: conversationQueryKeys.messages(capturedContext, active.key), refetchType: "none" }); }
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
      if (!direct) restoreSentAttachments(requestKey, submittedAttachments);
      if (!direct && submittedReferenceImageKey) setEditReferenceImageKey((current) => current ?? submittedReferenceImageKey);
      const funding = isSparkFundingError(error);
      const message = extractDomainErrorMessage(error) ?? "Core could not complete this response.";
      if (!direct && draftRevision.current === submittedDraftRevision) setInput(content);
      setPendingMessages((current) => current.filter(({ key }) => ![optimisticUserKey, optimisticAssistantKey, userMessageKey, assistantMessageKey].includes(key)));
      if (activeConversation) void queryClient.invalidateQueries({ queryKey: conversationQueryKeys.messages(capturedContext, activeConversation.key) });
      if (!funding) showToast({ title: message, duration: 2_000 });
    } finally {
      if (generation === turnGeneration.current && isConversationContextCurrent(capturedIdentity, identityRef)) { turnBusy.current = false; setTurning(false); setTurnScrollRequest((current) => current + 1); turnController.current = undefined; followLatest.current = false; nearBottom.current = false; }
    }
  }
  submitGuideTopicRef.current = (message, topic) => void submit({ content: topic.question, guideTopicSelection: { sourceAssistantMessageKey: message.key, topicKey: topic.key } });

  function updateSelectedConversationsFavorite() {
    const targets = selectedConversations.filter(({ key }) => !key.startsWith("optimistic-") && !mutationKeys.current.has(key));
    if (!targets.length) return;
    const capturedIdentity = identity; const capturedContext = context;
    const isFavorite = !targets.every((conversation) => conversation.isFavorite);
    const memberships = new Map(targets.map((conversation) => [conversation.key, conversationListMembershipKeys(queryClient, capturedContext, conversation.key)]));
    for (const conversation of targets) {
      mutationKeys.current.add(conversation.key);
      const optimistic = { ...conversation, isFavorite, updatedAt: now() };
      replaceConversationInMatchingLists(queryClient, capturedContext, optimistic);
      if (selectedRef.current?.key === conversation.key) { setSelected(optimistic); selectedRef.current = optimistic; rememberConversation(optimistic, capturedContext); }
    }
    setSelectedConversationKeys([]); openSheet("chats");
    showToast({ title: actionToast(targets.length, "Chat", "chats", isFavorite ? "favorited" : "unfavorited"), duration: 2_000 });
    void Promise.all(targets.map(async (conversation) => {
      const controller = operationController();
      try { return { conversation, updated: await updateConversation(capturedContext, conversation.key, { isFavorite }, controller.signal), succeeded: true as const }; }
      catch (error) { return { conversation, error, succeeded: false as const }; }
      finally { mutationKeys.current.delete(conversation.key); operationControllers.current.delete(controller); }
    })).then((outcomes) => {
      if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
      let failures = 0;
      for (const outcome of outcomes) {
        const result = outcome.succeeded ? outcome.updated : outcome.conversation;
        replaceConversationInMatchingLists(queryClient, capturedContext, result);
        if (!outcome.succeeded) { failures += 1; restoreConversationToLists(queryClient, outcome.conversation, memberships.get(outcome.conversation.key) ?? []); }
        if (selectedRef.current?.key === outcome.conversation.key) { setSelected(result); selectedRef.current = result; rememberConversation(result, capturedContext); }
      }
      if (failures) showToast({ title: failures === 1 ? "A chat could not be updated." : `${failures} chats could not be updated.`, duration: 2_500 });
      void invalidateConversationSearches(queryClient, capturedContext);
    });
  }

  function deleteSelectedConversations() {
    const targets = selectedConversations.filter(({ key }) => !key.startsWith("optimistic-") && !mutationKeys.current.has(key));
    if (!targets.length) return;
    const capturedIdentity = identity; const capturedContext = context;
    const deletedKeys = new Set(targets.map(({ key }) => key));
    const memberships = new Map(targets.map((conversation) => [conversation.key, conversationListMembershipKeys(queryClient, capturedContext, conversation.key)]));
    for (const conversation of targets) { mutationKeys.current.add(conversation.key); removeConversationFromLists(queryClient, capturedContext, conversation.key); }
    const deletingCurrent = selectedRef.current && deletedKeys.has(selectedRef.current.key);
    if (deletingCurrent) {
      turnGeneration.current += 1; turnController.current?.abort(); turnController.current = undefined; turnBusy.current = false; setTurning(false); clearConversationState();
      setSelected(undefined); selectedRef.current = undefined; rememberConversation(undefined, capturedContext);
    }
    setSelectedConversationKeys([]); openSheet("chats");
    showToast({ title: actionToast(targets.length, "Chat", "chats", "deleted"), duration: 2_000 });
    void Promise.all(targets.map(async (conversation) => {
      const controller = operationController();
      try { await deleteConversation(capturedContext, conversation.key, controller.signal); return { conversation, deleted: true as const }; }
      catch (error) { return { conversation, error }; }
      finally { mutationKeys.current.delete(conversation.key); operationControllers.current.delete(controller); }
    })).then(async (outcomes) => {
      if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
      const failures = outcomes.filter((outcome) => !("deleted" in outcome));
      for (const { conversation } of failures) restoreConversationToLists(queryClient, conversation, memberships.get(conversation.key) ?? []);
      if (failures.length) showToast({ title: failures.length === 1 ? "A chat could not be deleted." : `${failures.length} chats could not be deleted.`, duration: 2_500 });
      if (deletingCurrent) {
        const result = await restoreConversationSelection();
        if (result === "empty" && coreFocusedRef.current) useUiStore.getState().requestAgentGreeting("returning");
      }
      void invalidateConversationSearches(queryClient, capturedContext);
    });
  }

  function saveConversationEdit() {
    const current = actionConversation; if (!current || current.key.startsWith("optimistic-") || mutationKeys.current.has(current.key)) return;
    const capturedIdentity = identity; const capturedContext = context; const controller = operationController();
    const nextName = editName.trim();
    const nextFavorite = editFavorite;
    const optimistic = { ...current, name: nextName, isFavorite: nextFavorite, updatedAt: now() };
    mutationKeys.current.add(current.key);
    replaceConversationInMatchingLists(queryClient, capturedContext, optimistic);
    if (selectedRef.current?.key === current.key) { setSelected(optimistic); selectedRef.current = optimistic; rememberConversation(optimistic, capturedContext); }
    setActionConversation(undefined); openSheet(undefined);
    void (async () => {
      let canonical = current;
      try {
        if (nextName !== current.name) canonical = await updateConversation(capturedContext, current.key, { name: nextName }, controller.signal);
        if (nextFavorite !== current.isFavorite) canonical = await updateConversation(capturedContext, current.key, { isFavorite: nextFavorite }, controller.signal);
        if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
        setSelected((value) => value?.key === current.key ? canonical : value);
        if (selectedRef.current?.key === current.key) { selectedRef.current = canonical; rememberConversation(canonical, capturedContext); }
        replaceConversationInMatchingLists(queryClient, capturedContext, canonical);
        await invalidateConversationSearches(queryClient, capturedContext);
        await queryClient.invalidateQueries({ queryKey: conversationQueryKeys.lists(capturedContext), refetchType: "active" });
      } catch (error) {
        if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
        setSelected((value) => value?.key === current.key ? canonical : value);
        if (selectedRef.current?.key === current.key) { selectedRef.current = canonical; rememberConversation(canonical, capturedContext); }
        replaceConversationInMatchingLists(queryClient, capturedContext, canonical);
        showToast({ title: error instanceof Error ? error.message : "Chat could not be updated.", duration: 2_000 });
      } finally { mutationKeys.current.delete(current.key); operationControllers.current.delete(controller); }
    })();
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
    if (deletingCurrent) { clearConversationState(); setSelected(undefined); selectedRef.current = undefined; rememberConversation(undefined, capturedContext); setActiveRetrievals(undefined); }
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

  const pageActions = <View style={styles.headerActions}><Button accessibilityLabel="Open chats" contentMode="raw" onPress={() => openSheet("chats")} size="xs" variant="icon"><ChatBubbleIcon size="sm" /></Button>{selected && !selected.key.startsWith("optimistic-") ? <Button accessibilityLabel="Current chat menu" contentMode="raw" disabled={turning || mutationKeys.current.has(selected.key)} onPress={() => openConversationActions(selected)} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button> : null}</View>;
  const chatsInitialError = chatsQuery.isError && !chatsQuery.data;
  const chatsMoreError = chatsQuery.isError && Boolean(chatsQuery.data);
  const chatsLoading = searchPending || (configured && chatsQuery.isPending && chatsQuery.isFetching);
  const persistedSelection = Boolean(selected && !selected.key.startsWith("optimistic-"));
  const messagesLoading = persistedSelection && messagesQuery.isPending && messagesQuery.isFetching;
  const messagesInitialError = persistedSelection && messagesQuery.isError && !messagesQuery.data;
  const messageEmpty = !messagesLoading && !messagesInitialError && messages.length === 0;
  const attachmentsPreparing = draftAttachments.some(({ preparing }) => preparing);
  const composerBusy = turning || creating || attachmentsPreparing || messagesLoading || greetingMessage?.status === "PENDING";
  const olderMessagesHeader = useMemo(() => isFetchingOlderMessages ? <OlderMessageSkeletons /> : isFetchNextPageError ? <Button onPress={fetchOlderMessages} size="sm" variant="secondary">Retry older messages</Button> : null, [fetchOlderMessages, isFetchNextPageError, isFetchingOlderMessages]);
  const conversation = <View style={styles.conversation}>
    {messagesLoading ? <InitialMessageSkeletons /> : messagesInitialError ? <View style={styles.centerError}><Text accessibilityRole="alert" style={styles.error}>Messages could not be loaded.</Text><Button onPress={retryMessages} size="sm" variant="secondary">Retry</Button></View> : messageEmpty ? null : <FlatList contentContainerStyle={styles.messageList} data={timelineMessages} initialNumToRender={10} inverted ItemSeparatorComponent={MessageSeparator} keyExtractor={messageKey} ListFooterComponent={olderMessagesHeader} ListHeaderComponent={<View style={styles.messageListFooter} />} maintainVisibleContentPosition={PRESERVE_MESSAGE_POSITION} maxToRenderPerBatch={10} onContentSizeChange={handleListContentSizeChange} onEndReached={fetchOlderMessages} onEndReachedThreshold={0.25} onScroll={handleMessageScroll} onScrollBeginDrag={handleMessageScrollBeginDrag} ref={mountMessageList} removeClippedSubviews={false} renderItem={renderMessage} scrollEventThrottle={80} showsVerticalScrollIndicator={false} style={styles.messageListViewport} updateCellsBatchingPeriod={50} windowSize={7} />}
  </View>;
  const attachmentPills = draftAttachments.length || editReferenceImageKey ? <ScrollView accessibilityLabel="Draft attachments" alwaysBounceHorizontal={false} contentContainerStyle={styles.attachmentPills} horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} style={styles.attachmentPillsScroll}>{editReferenceImageKey ? <ActionPill action={<CloseIcon size="sm" />} actionLabel="Remove image to edit" compact dense disabled={turning} fitContent onAction={() => setEditReferenceImageKey(undefined)} style={styles.attachmentPill}><View style={styles.attachmentPillContent}><ImageIcon size="sm" variant="muted" /><Text numberOfLines={1} style={styles.attachmentName}>Image to edit</Text></View></ActionPill> : null}{draftAttachments.map((attachment) => <ActionPill action={<CloseIcon size="sm" />} actionLabel={`Remove ${displayAttachmentFilename(attachment.filename)}`} compact dense disabled={turning} fitContent key={attachment.clientKey} onAction={() => removeDraftAttachment(attachment.clientKey)} style={styles.attachmentPill}><View style={styles.attachmentPillContent}>{attachment.kind === "image" ? <ImageIcon size="sm" variant="muted" /> : <FileIcon size="sm" variant="muted" />}<Text numberOfLines={1} style={styles.attachmentName}>{displayAttachmentFilename(attachment.filename)}</Text></View></ActionPill>)}</ScrollView> : undefined;
  const modeSelector = <View style={styles.modeRow}><Tabs accessibilityLabel="Core mode" accessibilityRole="tablist" style={styles.modeTabs}><Button accessibilityRole="tab" accessibilityState={{ selected: mode === "chat" }} onPress={() => setMode("chat")} size="xs" style={styles.modeTab} variant={mode === "chat" ? "secondary" : "ghost"}>Chat</Button><Button accessibilityRole="tab" accessibilityState={{ selected: mode === "image" }} onPress={() => setMode("image")} size="xs" style={styles.modeTab} variant={mode === "image" ? "secondary" : "ghost"}>Image</Button></Tabs></View>;
  const chatBulkToolbar = selectedConversations.length ? <Tabs accessibilityLabel="Selected chat toolbar" style={styles.bulkToolbar}><View style={styles.bulkToolbarSelection}><Button accessibilityLabel="Clear chat selection" contentMode="raw" onPress={() => setSelectedConversationKeys([])} size="xs" style={styles.bulkToolbarClose} variant="secondary"><CloseIcon size="sm" /></Button><Text accessibilityLiveRegion="polite" style={styles.bulkSelectionText}>{selectedConversations.length} selected</Text></View><Button accessibilityLabel="Selected chat actions" contentMode="raw" onPress={() => openSheet("bulkActions")} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button></Tabs> : null;

  return <>
    <CoreComposer {...props} accessibilityHint={coreFunded ? props.accessibilityHint : "Add Sparks to use Core"} disabled={!configured || composerBusy || !coreFunded} editable={configured && !turning && !sheet && coreFunded} expandedAccessory={attachmentPills} expandedFooter={modeSelector} expandedLeading={<PlusIcon size="sm" />} expandedLeadingAccessibilityLabel="Add attachment" expandedLeadingDisabled={!configured || composerBusy || !coreFunded} expandedPrompts={editReferenceImageKey ? ["Edit this image..."] : mode === "image" ? ["Generate image..."] : undefined} focusOnOpenRequest={false} focusRequest={composerFocusRequest} loading={composerBusy} maxLength={CONVERSATION_MESSAGE_MAX_LENGTH} message={conversation} onChangeText={(value) => { draftRevision.current += 1; composerValueRef.current = value; setInput(value); }} onExpandedLeadingPress={() => openSheet("attachments")} onFocusChange={handleCoreFocusChange} onSubmit={() => void submit()} openEnabled={coreFunded} openRequest={coreFunded ? greetingRequest?.occasion === "onboarding" ? greetingRequest.id : coreOpenRequest : 0} pageActions={pageActions} pageBackdrop={<ConversationWatermark />} pageIdentity={(closePage) => <View style={styles.coreIdentity}><View style={styles.coreIdentityApp}>{props.pageIdentity(closePage)}</View><ProfileHeaderRight /></View>} value={input} />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "attachments"} title=""><BottomSheetMenu><BottomSheetItem onPress={() => void pickImages()} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Upload images</BottomSheetItem><BottomSheetItem onPress={() => void pickFiles()} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Upload files</BottomSheetItem><BottomSheetItem onPress={() => { openSheet(undefined); setCameraOpen(true); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Capture image</BottomSheetItem></BottomSheetMenu></BottomSheet>
    {cameraOpen ? <BrandedCameraModal count={0} maximum={1} onCapture={captureImage} onClose={() => setCameraOpen(false)} title="Capture for Core" /> : null}
    <BottomSheet footer={<><Button disabled={creating} onPress={openNewChat} size="md" variant="primary">New chat</Button><Button onPress={() => openSheet(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open && sheet === "chats") setSheet(undefined); }} open={sheet === "chats" || sheet === "filter" || sheet === "bulkActions" || sheet === "bulkDelete"} title="Chats">
      <View style={styles.searchActions}><View style={styles.search}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search chats" autoFocusInBottomSheet={false} maxLength={500} onChangeText={changeQuery} placeholder="Search..." style={styles.searchInput} value={query} />{query ? <ButtonSizeProvider overrideParent size="xs"><Button accessibilityLabel="Clear chat search" contentMode="raw" iconOnly onPress={() => changeQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button></ButtonSizeProvider> : null}</View><Button accessibilityLabel="Filter chats" contentMode="raw" onPress={() => openSheet("filter")} size="md" variant="icon"><FilterIcon size="sm" variant={favoriteOnly ? "accent" : "default"} /></Button></View>
      {chatBulkToolbar}
      {chatsLoading ? <View accessibilityLabel={query ? "Searching chats" : "Loading chats"} accessibilityRole="progressbar" style={styles.chatList}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.chatSkeleton, styles.skeletonCard]} />)}</View> : chatsInitialError ? <View style={styles.centerError}><Text accessibilityRole="alert" style={styles.error}>Chats could not be loaded.</Text><Button onPress={() => void chatsQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : <FlatList contentContainerStyle={[styles.chatList, conversations.length === 0 && styles.emptyChatList]} data={conversations} keyExtractor={conversationKey} ListEmptyComponent={<Text style={styles.emptyText}>{committedQuery || favoriteOnly ? "No matching chats." : "No chats yet."}</Text>} ListFooterComponent={chatsMoreError ? <Button onPress={() => void chatsQuery.fetchNextPage()} size="md" variant="secondary">Retry more chats</Button> : null} onEndReached={() => { if (chatsQuery.hasNextPage && !chatsQuery.isFetchingNextPage) void chatsQuery.fetchNextPage(); }} onEndReachedThreshold={0.4} renderItem={({ item }) => { const selectedChat = selectedConversationKeys.includes(item.key); return <ActionPill accessibilityActions={[{ name: "longpress", label: selectedChat ? `Deselect ${item.name}` : `Select ${item.name}` }]} accessibilityState={{ selected: selectedChat }} compact onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") handleConversationLongPress(item, false); }} onLongPress={() => handleConversationLongPress(item)} onPress={() => handleConversationPress(item)} pressLabel={selectedConversationKeys.length ? `${selectedChat ? "Deselect" : "Select"} ${item.name}` : `Open ${item.name}`} style={selectedChat ? styles.chatPillSelected : undefined}><View style={styles.chatPillContent}><Text numberOfLines={1} style={styles.chatName}>{item.name}</Text></View></ActionPill>; }} />}
    </BottomSheet>
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) openSheet("chats"); }} open={sheet === "bulkActions" && selectedConversations.length > 0} title=""><BottomSheetMenu><Button onPress={updateSelectedConversationsFavorite} size="md" variant="secondary">{allSelectedConversationsFavorite ? "Unfavorite" : "Favorite"}</Button><Button onPress={() => openSheet("bulkDelete")} size="md" variant="secondary">Delete</Button></BottomSheetMenu></BottomSheet>
    <BottomSheet footer={<><Button onPress={deleteSelectedConversations} size="md" variant="primary">Delete</Button><Button onPress={() => openSheet("chats")} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open) openSheet("chats"); }} open={sheet === "bulkDelete" && selectedConversations.length > 0} title={`Delete ${selectedConversations.length} ${selectedConversations.length === 1 ? "chat" : "chats"}?`} />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) openSheet("chats"); }} open={sheet === "filter"} title=""><View style={styles.filterContent}><View style={styles.filterRow}><Switch accessibilityLabel="Show favorite chats only" checked={favoriteOnly} onCheckedChange={(checked) => { setFavoriteOnly(checked); openSheet("chats"); }} /><Text style={styles.filterLabel}>Favorites</Text></View><Button onPress={() => void openSearchHistory()} size="md" variant="secondary">Search history</Button></View></BottomSheet>
    <SearchHistorySheet error={historyError} history={history} loading={historyLoading} onClose={() => openSheet("chats")} onRemove={(item) => void removeHistoryQuery(item)} onSelect={useHistoryQuery} open={sheet === "history"} removingQuery={removingHistoryQuery} />
    <ConversationRetrievalSheet onClose={closeRetrievals} onNavigate={navigateRetrievalResult} open={sheet === "retrievals" && Boolean(activeRetrievals)} retrievals={activeRetrievals ?? []} />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open && sheet === "current") closeConversationAction(); }} open={sheet === "current" && Boolean(actionConversation)} title=""><BottomSheetMenu><BottomSheetItem onPress={openConversationEdit} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Edit</BottomSheetItem><BottomSheetItem onPress={() => openSheet("delete")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Delete</BottomSheetItem></BottomSheetMenu></BottomSheet>
    <BottomSheet focusKey="editConversation" footer={<><Button disabled={!editName.trim()} onPress={saveConversationEdit} size="md" variant="primary">Save</Button><Button onPress={closeConversationAction} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open && sheet === "edit") closeConversationAction(); }} open={sheet === "edit" && Boolean(actionConversation)} title="Edit chat"><View style={styles.editForm}><TextInput accessibilityLabel="Chat name" autoFocusInBottomSheet={false} maxLength={CONVERSATION_NAME_MAX_LENGTH} onChangeText={setEditName} placeholder="Chat name" ref={editInput} value={editName} /><View style={styles.favoriteRow}><Switch accessibilityLabel="Favorite chat" checked={editFavorite} onCheckedChange={setEditFavorite} /><Text style={styles.favoriteLabel}>Favorite</Text></View></View></BottomSheet>
    <BottomSheet footer={<><Button onPress={confirmDelete} size="md" variant="primary">Delete</Button><Button onPress={() => openSheet("current")} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open && sheet === "delete") openSheet("current"); }} open={sheet === "delete" && Boolean(actionConversation)} title="Delete chat?" />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open && (sheet === "messageActions" || sheet === "deleteMessage")) { setSheet(undefined); setSelectedMessage(undefined); } }} open={sheet === "messageActions" || sheet === "deleteMessage"} title=""><BottomSheetMenu><BottomSheetItem onPress={shareSelectedMessage} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Share message</BottomSheetItem><BottomSheetItem onPress={() => openSheet("deleteMessage")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Delete</BottomSheetItem></BottomSheetMenu></BottomSheet>
    <BottomSheet footer={<><Button onPress={confirmMessageDelete} size="md" variant="primary">Delete</Button><Button onPress={() => openSheet("messageActions")} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open && sheet === "deleteMessage") openSheet("messageActions"); }} open={sheet === "deleteMessage" && Boolean(selectedMessage)} title="Delete message?" />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) { setSheet(undefined); setSelectedAttachment(undefined); } }} open={sheet === "attachmentActions" && Boolean(selectedAttachment)} title=""><BottomSheetMenu><BottomSheetItem onPress={() => { const attachment = selectedAttachment; setSheet(undefined); setSelectedAttachment(undefined); if (attachment) router.push({ pathname: "/capability/[slug]", params: { slug: "archive", documentKey: attachment.key, documentTitle: attachment.filename } }); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Open file</BottomSheetItem></BottomSheetMenu></BottomSheet>
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) { setSheet(undefined); setSelectedGeneratedImageKey(undefined); setSelectedGeneratedImageCollectionKey(undefined); } }} open={sheet === "imageActions" && Boolean(selectedGeneratedImageKey)} title=""><BottomSheetMenu><BottomSheetItem onPress={() => { if (selectedGeneratedImageKey) setEditReferenceImageKey(selectedGeneratedImageKey); openSheet(undefined); setSelectedGeneratedImageKey(undefined); setSelectedGeneratedImageCollectionKey(undefined); setComposerFocusRequest((current) => current + 1); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Edit image</BottomSheetItem><BottomSheetItem onPress={() => { const imageKey = selectedGeneratedImageKey; const assetKey = selectedGeneratedImageCollectionKey; openSheet(undefined); setSelectedGeneratedImageKey(undefined); setSelectedGeneratedImageCollectionKey(undefined); if (imageKey) router.push({ pathname: "/capability/[slug]", params: { slug: "gallery", imageKey, ...(assetKey ? { assetKey } : {}) } }); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Open image</BottomSheetItem></BottomSheetMenu></BottomSheet>
  </>;
}

const styles = StyleSheet.create({
  coreIdentity: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", width: "100%" }, coreIdentityApp: { minWidth: 0, flex: 1 }, headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs }, conversation: { flex: 1, minHeight: 0, position: "relative" }, coreWatermark: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.xl, transform: [{ translateY: -spacing.xxl }] }, coreWatermarkMark: { marginVertical: spacing.xs, opacity: 0.3 }, coreWatermarkText: { color: palette.muted, fontSize: 13, lineHeight: 19, maxWidth: 320, opacity: 0.3, textAlign: "center" }, messageList: { flexGrow: 1, zIndex: 1 }, messageSeparator: { height: spacing.md }, messageListFooter: { height: 24 },
  messageListViewport: { flex: 1 },
  messageRow: { width: "100%", flexDirection: "row", alignItems: "flex-start" }, assistantRow: { justifyContent: "flex-start", paddingRight: spacing.lg, gap: spacing.sm }, assistantMark: { marginTop: 4 }, messageContent: { minWidth: 0, gap: spacing.xs }, messageBox: { maxWidth: "100%", borderRadius: radii.md, paddingVertical: 4 }, messageButton: { minHeight: 0, alignItems: "stretch", borderWidth: 0, justifyContent: "flex-start" }, assistantMessage: { minWidth: 0, flex: 1, backgroundColor: "transparent" }, failedMessage: { borderWidth: 1, borderColor: palette.danger, paddingHorizontal: spacing.sm }, messageText: { color: palette.text, fontSize: 14, lineHeight: 20 }, messageAttachments: { alignItems: "flex-start", gap: spacing.xs, marginTop: spacing.xs }, messageAttachmentFallback: { maxWidth: 260, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, messageAttachmentName: { minWidth: 0, flexShrink: 1, color: palette.text, fontSize: 12 }, messageAttachmentImageButton: { minHeight: 0, width: 144, alignItems: "stretch", padding: 4 }, messageAttachmentLocalImage: { width: 144, alignItems: "stretch", padding: 4 }, messageAttachmentImage: { width: "100%", height: 88, borderRadius: radii.sm }, retrievalSummary: { minWidth: 0, flex: 1, color: palette.muted, fontSize: 12 }, guideTopics: { gap: spacing.xs, marginTop: spacing.xs }, guideTopicLabel: { color: palette.text, minWidth: 0, flex: 1, fontSize: 13, lineHeight: 18, textAlign: "left" }, guideTopicsLoading: { marginTop: 2, opacity: 0.62 },
  olderSkeletons: { gap: spacing.md }, messageSkeleton: { height: 18, marginTop: 3, borderRadius: radii.sm }, assistantSkeleton: { width: "76%" }, userSkeleton: { width: "62%" }, thinkingText: { flex: 1 }, loadingTextRaised: { transform: [{ translateY: -3 }] }, skeletonCard: { borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.hairlineBright, opacity: 0.72, overflow: "hidden" }, error: { color: palette.danger, fontSize: 12, marginBottom: spacing.xs }, centerError: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm }, emptyText: { color: palette.muted, fontSize: 13, textAlign: "center" },
  searchActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs }, search: { minHeight: 44, flex: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 12, paddingRight: 8, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page }, searchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  bulkToolbar: { minHeight: 40, marginTop: spacing.sm, padding: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, backgroundColor: palette.panel }, bulkToolbarSelection: { flexDirection: "row", alignItems: "center", gap: 8 }, bulkToolbarClose: { height: 28, width: 28, paddingHorizontal: 0, paddingVertical: 0 }, bulkSelectionText: { color: palette.silver100, fontSize: 12 },
  chatList: { flexGrow: 1, gap: spacing.xs, paddingTop: spacing.md, paddingBottom: spacing.lg }, emptyChatList: { justifyContent: "center" }, chatPillSelected: { borderColor: palette.silver50 }, chatPillContent: { minWidth: 0, minHeight: 32, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }, chatName: { minWidth: 0, flex: 1, color: palette.text, lineHeight: 18, textAlign: "left", textAlignVertical: "center" }, chatSkeleton: { width: "100%", height: 38, borderRadius: 999 }, sheetAction: { justifyContent: "center" }, sheetActionText: { width: "100%", textAlign: "center" },
  filterContent: { gap: spacing.md }, filterRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm }, filterLabel: { color: palette.text, fontSize: 13 }, editForm: { paddingTop: spacing.sm, gap: spacing.md }, favoriteRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm }, favoriteLabel: { color: palette.muted, fontSize: 13 },
  attachmentPillsScroll: { flexGrow: 0, flexShrink: 0, height: 28 }, attachmentPills: { alignItems: "center", gap: 6, paddingHorizontal: 2 }, attachmentPill: { backgroundColor: palette.page, flexShrink: 0, maxWidth: 158 }, messageAttachmentPill: { alignSelf: "flex-start" }, attachmentPillContent: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", flexShrink: 1, gap: 5 }, attachmentName: { color: palette.text, flexShrink: 1, fontSize: 11, maxWidth: 88 },
  modeRow: { alignItems: "center" }, modeTabs: { width: "100%", backgroundColor: palette.panel, borderColor: palette.hairline, borderWidth: 1, flexDirection: "row", gap: 4, padding: 3 }, modeTab: { flex: 1 },
  generatedImageResponse: { gap: spacing.sm, maxWidth: 320, width: "100%" }, generatedImageFrame: { alignItems: "center", height: 220, justifyContent: "center", maxWidth: 320, overflow: "hidden", width: "100%" }, generatedImageButton: { borderWidth: 0, height: 220, maxWidth: 320, overflow: "hidden", padding: 0, width: "100%" }, generatedImage: { borderRadius: radii.md, height: 220, width: "100%" }, generatedImageOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: radii.md }, generatedImageFailure: { alignItems: "center", backgroundColor: palette.page, justifyContent: "center" },
});

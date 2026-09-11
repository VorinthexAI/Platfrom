import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef } from "react";
import { FlatList, Keyboard, ScrollView, Share as NativeShare, StyleSheet, Text, View, type ListRenderItem, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { ActionPill } from "@vorinthex/shared/ui/action-pill";
import { Button, ButtonSizeProvider } from "@vorinthex/shared/ui/button";
import { ChromeIcon } from "@vorinthex/shared/ui/chrome-icon";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { LoadingText } from "@vorinthex/shared/ui/loading-text";
import { StreamingRichText } from "@vorinthex/shared/ui/rich-text";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Switch } from "@vorinthex/shared/ui/switch";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";
import { ChatBubbleIcon, CloseIcon, FileIcon, FilterIcon, ImageIcon, PlusIcon, SearchIcon } from "@vorinthex/shared/ui/icons-mobile";

import { BrandedCameraModal } from "@/components/capability/BrandedCameraModal";
import { SearchHistorySheet } from "@/components/SearchHistorySheet";
import { ConversationRetrievalSheet } from "@/components/ConversationRetrievalSheet";
import { ProfileHeaderRight } from "@/components/ProfileAvatarButton";
import {
  addConversationToUnfilteredLists,
  conversationMessages,
  conversationQueryKeys,
  createLocalConversationAttachments,
  invalidateConversationSearches,
  mergeConversationMessages,
  removeConversationFromLists,
  replaceConversationInMatchingLists,
  replaceTurnMessages,
  settlePendingAttachmentOverlays,
  type ConversationDisplayAttachment,
  type OptimisticMessage,
} from "@/lib/conversation-cache";
import {
  CONVERSATION_MESSAGE_MAX_LENGTH,
  CONVERSATION_ATTACHMENT_MAX_FILES,
  CONVERSATION_NAME_MAX_LENGTH,
  conversationContextIdentity,
  createConversation,
  deleteConversation,
  deleteConversationMessage,
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
} from "@/lib/conversation-client";
import { searchGalleryImages } from "@/lib/gallery-client";
import { normalizeCapturedPng } from "@/lib/captured-image";
import { formatConversationRetrievalSummary, mergeConversationRetrievalResults, type ConversationRetrievalResult } from "@/lib/conversation-retrievals";
import { deleteContentSearchHistory, type ContentSearchHistoryItem } from "@/lib/content-client";
import { readConversationSelection, writeConversationSelection } from "@/lib/conversation-selection-vault";
import { getUserSearchHistory, promoteCachedUserSearchHistory, removeCachedUserSearchHistory, userSearchHistoryQueryKey } from "@/lib/user-search-history-cache";
import { extractDomainErrorMessage, isSparkFundingError } from "@/lib/domain-error-observer";
import { useAuthStore } from "@/state/auth";
import { useAppsStore } from "@/state/apps";
import { useUiStore } from "@/state/ui";
import { assistantIconSource } from "@/data/capability-icons";
import { palette, radii, spacing } from "@/theme/tokens";
import { requestAgentGreeting } from "@/lib/agent-greeting-client";
import { mapWithConcurrency } from "@/lib/bounded-concurrency";

type CoreComposerProps = ComponentProps<typeof CoreComposer>;
type Sheet = "attachments" | "chats" | "filter" | "history" | "current" | "edit" | "delete" | "retrievals" | "messageActions" | "deleteMessage" | "imageActions";
type CreateOperation = { identity: string; optimistic: Conversation; promise: Promise<Conversation> };
type DraftAttachment = ConversationAttachmentFile & { kind: "image" | "document"; preparing?: true };
type ComposerMode = "chat" | "image";
type DisplayMessage = OptimisticMessage & { showReferralCodeAction?: boolean };

const now = () => new Date().toISOString();
const clientKey = (kind: string) => `optimistic-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

function GeneratedConversationImage({ contextIdentity, imageKey, onOpen }: { contextIdentity: string; imageKey?: string; onOpen: (collectionKey?: string) => void }) {
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const { data: image, isError, isPending, refetch } = useQuery({
    queryKey: ["conversation-generated-image-v2", contextIdentity, imageKey ?? "pending"],
    queryFn: async () => (await searchGalleryImages({ imageKey: imageKey! })).images.find(({ key }) => key === imageKey) ?? null,
    enabled: Boolean(imageKey),
  });
  if (!imageKey || isPending) return <View style={styles.generatedImageFrame}><Skeleton accessibilityLabel={imageKey ? "Loading generated image" : "Generating image"} accessibilityRole="progressbar" style={[styles.generatedImage, styles.skeletonCard]} /></View>;
  if (isError || !image) return <View style={styles.generatedImageFrame}><Button onPress={() => void refetch()} size="sm" variant="secondary">Retry generated image</Button></View>;
  const loaded = loadedUrl === image.url;
  return <View style={styles.generatedImageFrame}><Button accessibilityLabel="Open generated image actions" contentMode="raw" onPress={() => onOpen(image.collections?.find(({ name }) => name === "Core")?.key ?? image.collections?.[0]?.key)} shape="rounded" size="xl" style={styles.generatedImageButton} variant="ghost"><Image cachePolicy="memory-disk" contentFit="cover" onError={() => { setLoadedUrl(undefined); void refetch(); }} onLoad={() => setLoadedUrl(image.url)} recyclingKey={imageKey} source={image.url} style={[styles.generatedImage, !loaded && styles.generatedImageLoading]} />{!loaded ? <Skeleton accessibilityLabel="Loading generated image" accessibilityRole="progressbar" style={[styles.generatedImageOverlay, styles.skeletonCard]} /> : null}</Button></View>;
}

const attachmentImageQueryKey = (contextIdentity: string, imageKey: string) => ["conversation-attachment-image-v2", contextIdentity, imageKey] as const;
const attachmentImageQuery = (contextIdentity: string, imageKey: string) => ({
  queryKey: attachmentImageQueryKey(contextIdentity, imageKey),
  queryFn: async () => (await searchGalleryImages({ imageKey })).images.find(({ key }) => key === imageKey) ?? null,
  staleTime: 10 * 60 * 1_000,
});

function ConversationImageAttachment({ attachment, contextIdentity, onOpen }: { attachment: Extract<ConversationAttachmentReference, { kind: "image" }>; contextIdentity: string; onOpen: () => void }) {
  const { data: image, isPending, refetch } = useQuery({
    ...attachmentImageQuery(contextIdentity, attachment.key),
  });
  if (isPending) return <View style={styles.messageAttachmentLocalImage}><Skeleton accessibilityLabel={`Loading ${displayAttachmentFilename(attachment.filename)}`} accessibilityRole="progressbar" style={[styles.messageAttachmentImage, styles.skeletonCard]} /></View>;
  if (!image) return <View style={styles.messageAttachmentFallback}><ImageIcon size="sm" variant="muted" /><Text numberOfLines={1} style={styles.messageAttachmentName}>{displayAttachmentFilename(attachment.filename)}</Text></View>;
  return <Button accessibilityLabel={`Open image ${displayAttachmentFilename(attachment.filename)}`} contentMode="raw" onPress={onOpen} shape="rounded" size="md" style={styles.messageAttachmentImageButton} variant="ghost"><Image cachePolicy="memory-disk" contentFit="cover" onError={() => void refetch()} source={image.url} style={styles.messageAttachmentImage} /></Button>;
}

function MessageAttachment({ attachment, contextIdentity, onOpen }: { attachment: ConversationDisplayAttachment; contextIdentity: string; onOpen: (attachment: ConversationAttachmentReference) => void }) {
  if ("local" in attachment) return attachment.kind === "image"
    ? <View style={styles.messageAttachmentLocalImage}><Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={attachment.clientKey} source={attachment.uri} style={styles.messageAttachmentImage} /></View>
    : <View style={styles.messageAttachmentFallback}><FileIcon size="sm" variant="muted" /><Text numberOfLines={1} style={styles.messageAttachmentName}>{displayAttachmentFilename(attachment.filename)}</Text></View>;
  if (attachment.kind === "image") return <ConversationImageAttachment attachment={attachment} contextIdentity={contextIdentity} onOpen={() => onOpen(attachment)} />;
  return <Button accessibilityLabel={`Open ${attachment.kind} ${displayAttachmentFilename(attachment.filename)}`} contentMode="raw" onPress={() => onOpen(attachment)} shape="rounded" size="sm" style={styles.messageAttachmentFile} variant="secondary"><FileIcon size="sm" variant="muted" /><Text numberOfLines={1} style={styles.messageAttachmentName}>{displayAttachmentFilename(attachment.filename)}</Text></Button>;
}

const attachmentDisplayKey = (attachment: ConversationDisplayAttachment) => "local" in attachment ? attachment.clientKey : attachment.key;

const MessageRow = memo(function MessageRow({ contextIdentity, message, onOpenActions, onOpenAttachment, onOpenImage, onOpenReferralCode, onOpenRetrievals }: { contextIdentity: string; message: DisplayMessage; onOpenActions: (message: OptimisticMessage) => void; onOpenAttachment: (attachment: ConversationAttachmentReference) => void; onOpenImage: (imageKey: string, collectionKey?: string) => void; onOpenReferralCode: () => void; onOpenRetrievals: (message: OptimisticMessage) => void }) {
  const user = message.role === "user";
  const image = message.kind === "image";
  const pending = message.status === "PENDING";
  const failed = message.status === "FAILED";
  const retrievalResults = useMemo(() => !user && message.status === "COMPLETED" ? mergeConversationRetrievalResults(message.retrievals) : [], [message.retrievals, message.status, user]);
  return <View style={[styles.messageRow, user ? styles.userRow : styles.assistantRow]}>
    {!user ? <ChromeIcon glow={0.35} size={20} source={assistantIconSource} style={styles.assistantMark} /> : null}
    <View style={[styles.messageContent, user ? styles.userMessage : styles.assistantMessage]}>{image && !user && !failed ? <View style={styles.generatedImageResponse}><StreamingRichText content={imageProgressText(message.content)} streaming={false} /><GeneratedConversationImage contextIdentity={contextIdentity} imageKey={message.imageKey} onOpen={(collectionKey) => message.imageKey && onOpenImage(message.imageKey, collectionKey)} />{message.status === "COMPLETED" && message.imageSummaryText ? <StreamingRichText content={message.imageSummaryText} streaming={false} /> : null}</View> : pending && !message.content ? <LoadingText style={styles.thinkingText} text="Thinking..." /> : message.optimistic ? <View style={[styles.messageBox, failed && styles.failedMessage]}>
      {failed ? <Text style={styles.messageText}>{image ? "Image generation failed." : "This response could not be completed."}</Text> : <StreamingRichText content={message.content} streaming={pending} />}
    </View> : <Button accessibilityLabel={`Open actions for ${user ? "your message" : "Core response"}`} contentMode="raw" onPress={() => onOpenActions(message)} pressFeedback="opacity" shape="rounded" size="xs" style={[styles.messageBox, styles.messageButton, failed && styles.failedMessage]} variant="ghost">{failed ? <Text style={styles.messageText}>{image ? "Image generation failed." : "This response could not be completed."}</Text> : <StreamingRichText content={message.content} streaming={false} />}</Button>}
    {message.attachments.length ? <View accessibilityLabel="Message attachments" style={styles.messageAttachments}>{message.attachments.map((attachment) => <MessageAttachment attachment={attachment} contextIdentity={contextIdentity} key={attachmentDisplayKey(attachment)} onOpen={onOpenAttachment} />)}</View> : null}
    {retrievalResults.length ? <ActionPill compact onPress={() => onOpenRetrievals(message)} pressLabel="Open search results"><Text numberOfLines={1} style={styles.retrievalSummary}>{formatConversationRetrievalSummary(retrievalResults)}</Text></ActionPill> : null}
    {!user && message.status === "COMPLETED" && message.showReferralCodeAction ? <ActionPill compact onPress={onOpenReferralCode} pressLabel="Use referral code"><Text numberOfLines={1} style={styles.retrievalSummary}>Use code</Text></ActionPill> : null}</View>
  </View>;
});

function MessageSkeletons({ accessibilityLabel }: { accessibilityLabel: string }) {
  return <View accessibilityLabel={accessibilityLabel} accessibilityRole="progressbar" style={styles.olderSkeletons}>
    <View style={[styles.messageRow, styles.assistantRow]}><Skeleton style={[styles.messageSkeleton, styles.assistantSkeleton, styles.skeletonCard]} /></View>
    <View style={[styles.messageRow, styles.userRow]}><Skeleton style={[styles.messageSkeleton, styles.userSkeleton, styles.skeletonCard]} /></View>
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

const messageKey = ({ key, role, turnKey }: OptimisticMessage) => turnKey ? `${turnKey}:${role}` : key;
const conversationKey = ({ key }: Conversation) => key;
const MessageSeparator = () => <View style={styles.messageSeparator} />;

export function PersistentCoreComposer(props: CoreComposerProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { showToast } = useToast();
  const userKey = useAuthStore((state) => state.user?.key ?? "");
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
  const [searchPending, setSearchPending] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<OptimisticMessage[]>([]);
  const [turnError, setTurnError] = useState<string>();
  const [editName, setEditName] = useState("");
  const [editFavorite, setEditFavorite] = useState(false);
  const [turning, setTurning] = useState(false);
  const [greetingMessage, setGreetingMessage] = useState<DisplayMessage>();
  const [coreOpenRequest, setCoreOpenRequest] = useState(0);
  const [routeFocused, setRouteFocused] = useState(false);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [removingHistoryQuery, setRemovingHistoryQuery] = useState<string>();
  const [activeRetrievals, setActiveRetrievals] = useState<readonly ConversationRetrieval[]>();
  const [selectedMessage, setSelectedMessage] = useState<OptimisticMessage>();
  const [selectedGeneratedImageKey, setSelectedGeneratedImageKey] = useState<string>();
  const [selectedGeneratedImageCollectionKey, setSelectedGeneratedImageCollectionKey] = useState<string>();
  const [editReferenceImageKey, setEditReferenceImageKey] = useState<string>();
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const contextRef = useRef(context);
  const identityRef = useRef(identity);
  const selectedRef = useRef<Conversation | undefined>(undefined);
  const editInput = useRef<ComponentRef<typeof TextInput>>(null);
  const listRef = useRef<FlatList<OptimisticMessage>>(null);
  const nearBottom = useRef(true);
  const followLatest = useRef(false);
  const initialScrollPending = useRef(true);
  const turnController = useRef<AbortController | undefined>(undefined);
  const greetingController = useRef<AbortController | undefined>(undefined);
  const greetingGeneration = useRef(0);
  const turnGeneration = useRef(0);
  const turnBusy = useRef(false);
  const createOperation = useRef<CreateOperation | undefined>(undefined);
  const historyController = useRef<AbortController | undefined>(undefined);
  const operationControllers = useRef(new Set<AbortController>());
  const mutationKeys = useRef(new Set<string>());
  const selectionRestoreIdentity = useRef("");
  const selectionRestoreGeneration = useRef(0);
  const scrollFrame = useRef<number | undefined>(undefined);
  const scrollSettleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const followReleaseFrame = useRef<number | undefined>(undefined);
  const pendingScroll = useRef<{ animated: boolean } | undefined>(undefined);
  const draftAttachmentsRef = useRef<DraftAttachment[]>([]);
  const submittedAttachmentTurns = useRef(new Map<string, readonly DraftAttachment[]>());
  const settlingAttachmentTurns = useRef(new Set<string>());
  const draftRevision = useRef(0);

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
    const { collectionSlug, destinationCollectionSlug, destinationKey, key, retrieval } = result;
    const searchParams = retrieval.query ? { initialQuery: retrieval.query } : {};
    closeRetrievals();
    if (collectionSlug === "folders") router.push({ pathname: "/capability/[slug]", params: { slug: "archive", assetKey: key, ...(destinationCollectionSlug === "documents" || destinationCollectionSlug === "files" ? { collectionKind: destinationCollectionSlug } : {}), ...searchParams } });
    else if (collectionSlug === "documents" || collectionSlug === "files") router.push({ pathname: "/capability/[slug]", params: { slug: "archive", documentKey: key, documentTitle: result.label, ...searchParams } });
    else if (collectionSlug === "collections") router.push({ pathname: "/capability/[slug]", params: { slug: "gallery", assetKey: key, ...searchParams } });
    else if (collectionSlug === "images") router.push({ pathname: "/capability/[slug]", params: { slug: "gallery", ...(retrieval.filters?.collectionKey ? { assetKey: retrieval.filters.collectionKey } : {}), imageKey: key, ...searchParams } });
    else if (collectionSlug === "email-messages" && (destinationKey || retrieval.filters?.connectorKey)) router.push({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey: destinationKey ?? retrieval.filters!.connectorKey!, signalThreadKey: key, collectionKind: "email-messages", ...searchParams } });
    else if (collectionSlug === "trips") router.push({ pathname: "/capability/[slug]", params: { slug: "compass", tripKey: key, collectionKind: "trips", ...searchParams } });
    else if (collectionSlug === "inboxes" && destinationKey) router.push({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey: destinationKey, signalReturn: "root", ...(destinationCollectionSlug === "email-messages" || destinationCollectionSlug === "email-drafts" ? { collectionKind: destinationCollectionSlug, ...searchParams } : {}) } });
    else if (collectionSlug === "email-tones") router.push({ pathname: "/capability/[slug]", params: { slug: "signal", toneKey: key, collectionKind: "email-tones", ...searchParams } });
    else if (collectionSlug === "email-drafts" && (destinationKey || retrieval.filters?.connectorKey)) router.push({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey: destinationKey ?? retrieval.filters!.connectorKey!, draftKey: key, collectionKind: "email-drafts", ...searchParams } });
    else if (collectionSlug === "places") router.push({ pathname: "/capability/[slug]", params: { slug: "compass", placeKey: key, collectionKind: "places", ...searchParams } });
    else if (collectionSlug === "countries") router.push({ pathname: "/capability/[slug]", params: { slug: "compass", countryCode: key, collectionKind: "countries", ...searchParams } });
    else if (collectionSlug === "books") router.push({ pathname: "/capability/[slug]", params: { slug: "ascend", bookKey: key, ...searchParams } });
    else router.push({ pathname: "/capability/[slug]", params: { slug: "signal" } });
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
  const latestMessageKey = messages.at(-1)?.key;
  const openGeneratedImage = useCallback((imageKey: string, collectionKey?: string) => { Keyboard.dismiss(); setSelectedGeneratedImageKey(imageKey); setSelectedGeneratedImageCollectionKey(collectionKey); setSheet("imageActions"); }, []);
  const openMessageAttachment = useCallback((attachment: ConversationAttachmentReference) => {
    Keyboard.dismiss();
    if (attachment.kind === "document") router.push({ pathname: "/capability/[slug]", params: { slug: "archive", documentKey: attachment.key, documentTitle: attachment.filename } });
    else router.push({ pathname: "/capability/[slug]", params: { slug: "gallery", imageKey: attachment.key } });
  }, [router]);
  const renderMessage = useCallback<ListRenderItem<DisplayMessage>>(({ item }) => <MessageRow contextIdentity={identity} message={item} onOpenActions={openMessageActions} onOpenAttachment={openMessageAttachment} onOpenImage={openGeneratedImage} onOpenReferralCode={openReferralCode} onOpenRetrievals={openMessageRetrievals} />, [identity, openGeneratedImage, openMessageActions, openMessageAttachment, openMessageRetrievals, openReferralCode]);

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
      void queryClient.cancelQueries({ queryKey: conversationQueryKeys.all(previousContext) });
      queueMicrotask(() => {
        if (identityRef.current !== identity) return;
        for (const attachment of draftAttachmentsRef.current) deleteTemporaryFile(attachment.uri);
        clearSubmittedAttachmentFiles();
        draftAttachmentsRef.current = [];
        setSheet(undefined); setSelected(undefined); setInput(""); setMode("chat"); setQuery(""); setCommittedQuery(""); setFavoriteOnly(false);
        setSearchPending(false); setPendingMessages([]); setGreetingMessage(undefined); setCoreOpenRequest(0); setTurnError(undefined); setEditName(""); setEditFavorite(false); setTurning(false); setCreating(false);
        setHistory([]); setHistoryLoading(false); setHistoryError(undefined); setRemovingHistoryQuery(undefined);
        setActiveRetrievals(undefined); setSelectedMessage(undefined); setSelectedGeneratedImageKey(undefined); setSelectedGeneratedImageCollectionKey(undefined); setEditReferenceImageKey(undefined);
        setDraftAttachments([]); setCameraOpen(false);
        selectedRef.current = undefined; nearBottom.current = true; initialScrollPending.current = true; selectionRestoreIdentity.current = "";
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
    if (followReleaseFrame.current !== undefined) cancelAnimationFrame(followReleaseFrame.current);
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
    const timeout = setTimeout(() => editInput.current?.focus(), 300);
    return () => clearTimeout(timeout);
  }, [sheet]);

  function rememberConversation(conversation?: Conversation, capturedContext = context) { void writeConversationSelection(capturedContext, conversation).catch(() => undefined); }
  async function restoreConversationSelection() {
    if (!configured || selectedRef.current || selectionRestoreIdentity.current === identity) return;
    selectionRestoreIdentity.current = identity;
    const restoreGeneration = ++selectionRestoreGeneration.current;
    const capturedIdentity = identity; const capturedContext = context;
    try {
      const stored = await readConversationSelection(capturedContext);
      if (restoreGeneration !== selectionRestoreGeneration.current || !isConversationContextCurrent(capturedIdentity, identityRef) || selectedRef.current) return;
      if (stored) { clearConversationState(); setSelected(stored); selectedRef.current = stored; return; }
      const page = await listConversations(capturedContext, { favoriteOnly: false, recordHistory: false });
      if (restoreGeneration !== selectionRestoreGeneration.current || !isConversationContextCurrent(capturedIdentity, identityRef) || selectedRef.current) return;
      const latest = page.conversations.reduce<Conversation | undefined>((current, candidate) => !current || candidate.updatedAt > current.updatedAt ? candidate : current, undefined);
      if (latest) { clearConversationState(); setSelected(latest); selectedRef.current = latest; rememberConversation(latest, capturedContext); }
    } catch { if (restoreGeneration === selectionRestoreGeneration.current && isConversationContextCurrent(capturedIdentity, identityRef)) selectionRestoreIdentity.current = ""; }
  }
  function openSheet(next?: Sheet) { Keyboard.dismiss(); setSheet(next); }
  function clearConversationState() {
    if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
    if (scrollSettleTimer.current !== undefined) clearTimeout(scrollSettleTimer.current);
    if (followReleaseFrame.current !== undefined) cancelAnimationFrame(followReleaseFrame.current);
    scrollFrame.current = undefined; scrollSettleTimer.current = undefined; followReleaseFrame.current = undefined; pendingScroll.current = undefined;
    clearSubmittedAttachmentFiles(); setPendingMessages([]); setGreetingMessage(undefined); setTurnError(undefined); setSelectedMessage(undefined); setSelectedGeneratedImageKey(undefined); setSelectedGeneratedImageCollectionKey(undefined); setEditReferenceImageKey(undefined); nearBottom.current = true; followLatest.current = false; initialScrollPending.current = true;
  }
  function operationController() { const controller = new AbortController(); operationControllers.current.add(controller); return controller; }
  function appendDelta(key: string, text: string) {
    setPendingMessages((current) => current.map((message) => message.key === key ? { ...message, content: message.content + text } : message));
  }
  const scheduleScrollToEnd = useCallback((animated: boolean, settle = !animated) => {
    pendingScroll.current = { animated };
    if (scrollFrame.current === undefined) {
      scrollFrame.current = requestAnimationFrame(() => {
        scrollFrame.current = undefined;
        const request = pendingScroll.current;
        pendingScroll.current = undefined;
        if (!request || !listRef.current) return;
        listRef.current.scrollToEnd({ animated: request.animated });
      });
    }
    if (scrollSettleTimer.current !== undefined) {
      clearTimeout(scrollSettleTimer.current);
      scrollSettleTimer.current = undefined;
    }
    if (settle) {
      scrollSettleTimer.current = setTimeout(() => {
        scrollSettleTimer.current = undefined;
        listRef.current?.scrollToEnd({ animated: false });
      }, 120);
    }
  }, []);
  useEffect(() => {
    if (!latestMessageKey) return;
    if (!followLatest.current && !nearBottom.current) return;
    nearBottom.current = true;
    scheduleScrollToEnd(true);
  }, [latestMessageKey, scheduleScrollToEnd]);
  const releaseFollowLatest = useCallback(() => {
    if (followReleaseFrame.current !== undefined) cancelAnimationFrame(followReleaseFrame.current);
    followReleaseFrame.current = requestAnimationFrame(() => {
      followReleaseFrame.current = requestAnimationFrame(() => {
        followReleaseFrame.current = undefined;
        if (!followLatest.current) return;
        scheduleScrollToEnd(true);
        followLatest.current = false;
        nearBottom.current = true;
      });
    });
  }, [scheduleScrollToEnd]);
  useEffect(() => {
    if (!configured || !routeFocused || !greetingRequest) return;
    const frame = requestAnimationFrame(() => {
      const request = useUiStore.getState().consumeAgentGreeting(greetingRequest.id);
      if (!request) return;
      const generation = ++greetingGeneration.current;
      greetingController.current?.abort();
      const controller = new AbortController();
      greetingController.current = controller;
      const capturedIdentity = identity;
      clearConversationState();
      setSelected(undefined); selectedRef.current = undefined;
      selectionRestoreGeneration.current += 1;
      selectionRestoreIdentity.current = identity;
      setSheet(undefined);
      useAppsStore.getState().enterCore();
      setCoreOpenRequest((current) => current + 1);
      const createdAt = now();
      const key = `agent-greeting-${request.id}`;
      setGreetingMessage({ key, conversationKey: "ephemeral", turnKey: key, kind: "text", role: "assistant", status: "PENDING", attachmentStatus: "NONE", content: "", attachments: [], retrievals: [], createdAt, optimistic: true });
      void requestAgentGreeting(context, request.occasion, controller.signal).then(({ message, showReferralCodeAction }) => {
        if (generation !== greetingGeneration.current || !isConversationContextCurrent(capturedIdentity, identityRef)) return;
        setGreetingMessage({ key, conversationKey: "ephemeral", turnKey: key, kind: "text", role: "assistant", status: "COMPLETED", attachmentStatus: "NONE", content: message, attachments: [], retrievals: [], showReferralCodeAction, createdAt, completedAt: now(), optimistic: true });
        scheduleScrollToEnd(true);
      }).catch((error) => {
        if (generation !== greetingGeneration.current || !isConversationContextCurrent(capturedIdentity, identityRef) || (error instanceof Error && error.name === "AbortError")) return;
        setGreetingMessage(undefined);
        setTurnError("Core could not load an opening greeting.");
      }).finally(() => {
        if (generation === greetingGeneration.current) greetingController.current = undefined;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [configured, context, greetingRequest, identity, routeFocused, scheduleScrollToEnd]);
  function handleCoreFocusChange(focused: boolean) {
    const apps = useAppsStore.getState();
    if (focused) apps.enterCore();
    else apps.leaveCore();
    props.onFocusChange?.(focused);
    if (!focused) {
      followLatest.current = false;
      return;
    }
    void restoreConversationSelection();
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
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const remaining = CONVERSATION_ATTACHMENT_MAX_FILES - draftAttachmentsRef.current.length;
    if (remaining <= 0) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: remaining, quality: 1, exif: true });
    if (result.canceled) return;
    const selected = result.assets.map((asset, index) => {
      const stem = (asset.fileName ?? `image-${index + 1}`).replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 240) || "image";
      return { asset, draft: { clientKey: clientKey("attachment"), filename: `${stem}.png`, mimeType: "image/png" as const, sizeBytes: 1, uri: asset.uri, kind: "image" as const, preparing: true as const } };
    });
    const acceptedKeys = new Set(addDraftAttachments(selected.map(({ draft }) => draft)).map(({ clientKey: key }) => key));
    let failures = 0;
    await mapWithConcurrency(selected.filter(({ draft }) => acceptedKeys.has(draft.clientKey)), 3, async ({ asset, draft }) => {
      try {
        const normalized = await normalizeCapturedPng(asset, { maxSide: 2400, compress: 0.88 });
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
    const draft: DraftAttachment = { clientKey: key, filename: `capture-${Date.now()}.png`, mimeType: "image/png", sizeBytes: 1, uri: picture.uri, kind: "image", preparing: true };
    setCameraOpen(false);
    if (!addDraftAttachments([draft]).length) return;
    void normalizeCapturedPng(picture, { maxSide: 2400, compress: 0.88 }).then((normalized) => {
      if (normalized.uri !== picture.uri) deleteTemporaryFile(picture.uri);
      const { preparing: _preparing, ...placeholder } = draft;
      if (!replaceDraftAttachment(key, { ...placeholder, sizeBytes: normalized.sizeBytes, uri: normalized.uri })) deleteTemporaryFile(normalized.uri);
    }).catch((error) => {
      removeDraftAttachment(key);
      showToast({ title: error instanceof Error ? error.message : "The photo could not be prepared.", duration: 2_000 });
    });
  }
  const mountMessageList = useCallback((list: FlatList<OptimisticMessage> | null) => {
    listRef.current = list;
    if (!list) return;
    initialScrollPending.current = true;
    nearBottom.current = true;
  }, []);

  function selectConversation(conversation?: Conversation) {
    turnGeneration.current += 1; turnController.current?.abort(); turnController.current = undefined; turnBusy.current = false;
    setTurning(false); clearConversationState(); setSelected(conversation); selectedRef.current = conversation; rememberConversation(conversation); setActiveRetrievals(undefined); openSheet(undefined);
  }

  function beginConversationCreation() {
    const current = createOperation.current;
    if (current?.identity === identity) return current;
    const capturedIdentity = identity;
    const capturedContext = context;
    const controller = operationController();
    const optimistic: Conversation = { key: clientKey("conversation"), name: "New chat", isFavorite: false, createdAt: now(), updatedAt: now() };
    addConversationToUnfilteredLists(queryClient, capturedContext, optimistic);
    setCreating(true);
    setSelected(optimistic); selectedRef.current = optimistic;
    const operation: CreateOperation = { identity: capturedIdentity, optimistic, promise: Promise.resolve(undefined as never) };
    operation.promise = createConversation(capturedContext, "New chat", controller.signal).then((created) => {
      if (!isConversationContextCurrent(capturedIdentity, identityRef)) throw new DOMException("Stale identity", "AbortError");
      removeConversationFromLists(queryClient, capturedContext, optimistic.key);
      addConversationToUnfilteredLists(queryClient, capturedContext, created);
      queryClient.setQueryData(conversationQueryKeys.messages(capturedContext, created.key), { pages: [{ messages: [], cursor: undefined }], pageParams: [undefined] });
      void invalidateConversationSearches(queryClient, capturedContext);
      setSelected((value) => value?.key === optimistic.key ? created : value); selectedRef.current = selectedRef.current?.key === optimistic.key ? created : selectedRef.current;
      rememberConversation(created, capturedContext);
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
    if (!configured || createOperation.current) return;
    clearConversationState(); const operation = beginConversationCreation(); openSheet(undefined);
    void operation.promise.catch((error) => { if (isConversationContextCurrent(operation.identity, identityRef) && (!(error instanceof Error) || error.name !== "AbortError")) showToast({ title: error instanceof Error ? error.message : "Chat could not be created.", duration: 2_000 }); });
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
    if (draftAttachmentsRef.current.some(({ preparing }) => preparing)) return;
    if (turnBusy.current) return;
    const submittedDraftRevision = draftRevision.current;
    turnBusy.current = true; followLatest.current = true; setTurning(true); setInput(""); setTurnError(undefined); nearBottom.current = true;
    dismissFailedMessages();
    const capturedIdentity = identity; const capturedContext = context; const generation = ++turnGeneration.current;
    const requestKey = clientKey("turn"); const optimisticUserKey = clientKey("user"); const optimisticAssistantKey = clientKey("assistant");
    const submittedAttachments = [...draftAttachmentsRef.current];
    const submittedReferenceImageKey = editReferenceImageKey;
    draftAttachmentsRef.current = [];
    setDraftAttachments([]);
    setEditReferenceImageKey(undefined);
    const existing = selectedRef.current;
    const operation = !existing || existing.key.startsWith("optimistic-") ? beginConversationCreation() : undefined;
    const pendingConversationKey = existing?.key ?? operation?.optimistic.key ?? "pending";
    const optimisticAttachments = createLocalConversationAttachments(submittedAttachments);
    setPendingMessages((current) => [...current,
      { key: optimisticUserKey, conversationKey: pendingConversationKey, turnKey: requestKey, kind: "text", role: "user", status: "COMPLETED", attachmentStatus: submittedAttachments.length ? "PENDING" : "NONE", content, attachments: optimisticAttachments, retrievals: [], createdAt: now(), optimistic: true },
      { key: optimisticAssistantKey, conversationKey: pendingConversationKey, turnKey: requestKey, kind: "text", role: "assistant", status: "PENDING", attachmentStatus: "NONE", content: "", attachments: [], retrievals: [], createdAt: now(), optimistic: true },
    ]);
    if (submittedAttachments.length) submittedAttachmentTurns.current.set(requestKey, submittedAttachments);
    scheduleScrollToEnd(true);
    let userMessageKey = optimisticUserKey; let assistantMessageKey = optimisticAssistantKey; let activeConversation: Conversation | undefined;
    try {
      activeConversation = operation ? await operation.promise : existing;
      if (!activeConversation || generation !== turnGeneration.current || !isConversationContextCurrent(capturedIdentity, identityRef)) { deleteSubmittedAttachmentFiles(requestKey); return; }
      const active = activeConversation;
      setPendingMessages((current) => current.map((message) => [optimisticUserKey, optimisticAssistantKey].includes(message.key) ? { ...message, conversationKey: active.key } : message));
      const controller = new AbortController(); turnController.current = controller;
      const uploaded = submittedAttachments.length ? await uploadConversationAttachments(capturedContext, active.key, requestKey, submittedAttachments, controller.signal) : undefined;
      const attachmentKeys = uploaded?.attachmentKeys ?? [];
      let authoritativeUser: ConversationMessage | undefined;
      await streamConversationTurn(capturedContext, { conversationKey: active.key, message: content, requestKey, attachmentKeys, referenceImageKeys: submittedReferenceImageKey ? [submittedReferenceImageKey] : [] }, (event) => {
        if (generation !== turnGeneration.current || controller.signal.aborted || !isConversationContextCurrent(capturedIdentity, identityRef)) return;
        if (event.type === "start") {
          userMessageKey = event.userMessageKey; assistantMessageKey = event.assistantMessageKey;
          authoritativeUser = event.userMessage;
          setPendingMessages((current) => current.map((message) => message.turnKey === requestKey && message.role === "assistant" ? { ...message, key: assistantMessageKey } : message));
        } else if (event.type === "delta") {
          appendDelta(assistantMessageKey, event.text);
        } else if (event.type === "done") {
          const currentConversation = selectedRef.current?.key === active.key ? selectedRef.current : active;
          const updated = { ...currentConversation, ...(event.name ? { name: event.name } : {}), updatedAt: event.message.completedAt ?? event.message.createdAt };
           const completedUser: OptimisticMessage = authoritativeUser ?? { key: userMessageKey, conversationKey: active.key, turnKey: requestKey, kind: "text", role: "user", status: "COMPLETED", attachmentStatus: submittedAttachments.length ? "PENDING" : "NONE", content, attachments: [], retrievals: [], createdAt: now(), completedAt: now() };
          setSelected(updated); selectedRef.current = updated; replaceConversationInMatchingLists(queryClient, capturedContext, updated);
          rememberConversation(updated, capturedContext);
            queryClient.setQueryData(conversationQueryKeys.messages(capturedContext, active.key), (data: typeof messagesQuery.data) => data ? { ...data, pages: data.pages.map((page, index) => index === 0 ? { ...page, messages: replaceTurnMessages(page.messages, completedUser, event.message, [optimisticUserKey, optimisticAssistantKey, userMessageKey, assistantMessageKey]) as ConversationMessage[] } : { ...page, messages: page.messages.filter((message) => message.turnKey !== requestKey) }) } : { pages: [{ messages: [completedUser, event.message] as ConversationMessage[], cursor: undefined }], pageParams: [undefined] });
            setPendingMessages((current) => current.filter((message) => message.turnKey !== requestKey || (submittedAttachments.length > 0 && message.role === "user")));
           scheduleScrollToEnd(true);
        }
      }, controller.signal);
      if (generation === turnGeneration.current && isConversationContextCurrent(capturedIdentity, identityRef)) { await invalidateConversationSearches(queryClient, capturedContext); void queryClient.invalidateQueries({ queryKey: conversationQueryKeys.messages(capturedContext, active.key), refetchType: "none" }); }
    } catch (error) {
      if (generation !== turnGeneration.current || !isConversationContextCurrent(capturedIdentity, identityRef) || (error instanceof Error && error.name === "AbortError")) { deleteSubmittedAttachmentFiles(requestKey); return; }
      restoreSentAttachments(requestKey, submittedAttachments);
      if (submittedReferenceImageKey) setEditReferenceImageKey((current) => current ?? submittedReferenceImageKey);
      const message = extractDomainErrorMessage(error) ?? "Core could not complete this response.";
      if (draftRevision.current === submittedDraftRevision) setInput(content);
      setTurnError(message);
      setPendingMessages((current) => current.filter(({ key }) => ![optimisticUserKey, optimisticAssistantKey, userMessageKey, assistantMessageKey].includes(key)));
      if (activeConversation) void queryClient.invalidateQueries({ queryKey: conversationQueryKeys.messages(capturedContext, activeConversation.key) });
      if (!isSparkFundingError(error)) showToast({ title: message, duration: 2_000 });
      scheduleScrollToEnd(true);
    } finally {
      if (generation === turnGeneration.current && isConversationContextCurrent(capturedIdentity, identityRef)) { scheduleScrollToEnd(true); releaseFollowLatest(); turnBusy.current = false; setTurning(false); turnController.current = undefined; }
    }
  }

  function mutateConversation(action: "favorite" | "edit") {
    const current = selectedRef.current; if (!current || current.key.startsWith("optimistic-") || mutationKeys.current.has(current.key)) return;
    const capturedIdentity = identity; const capturedContext = context; const controller = operationController();
    const nextName = action === "edit" ? editName.trim() : current.name;
    const nextFavorite = action === "favorite" ? !current.isFavorite : editFavorite;
    const optimistic = { ...current, name: nextName, isFavorite: nextFavorite, updatedAt: now() };
    mutationKeys.current.add(current.key);
    setSelected(optimistic); selectedRef.current = optimistic; replaceConversationInMatchingLists(queryClient, capturedContext, optimistic); rememberConversation(optimistic, capturedContext); openSheet(undefined);
    void (async () => {
      let canonical = current;
      try {
        if (nextName !== current.name) canonical = await updateConversation(capturedContext, current.key, { name: nextName }, controller.signal);
        if (nextFavorite !== current.isFavorite) canonical = await updateConversation(capturedContext, current.key, { isFavorite: nextFavorite }, controller.signal);
        if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
        setSelected((value) => value?.key === current.key ? canonical : value);
        if (selectedRef.current?.key === current.key) selectedRef.current = canonical;
        replaceConversationInMatchingLists(queryClient, capturedContext, canonical); rememberConversation(canonical, capturedContext);
        await invalidateConversationSearches(queryClient, capturedContext);
        await queryClient.invalidateQueries({ queryKey: conversationQueryKeys.lists(capturedContext), refetchType: "active" });
      } catch (error) {
        if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
        setSelected((value) => value?.key === current.key ? canonical : value);
        if (selectedRef.current?.key === current.key) selectedRef.current = canonical;
        replaceConversationInMatchingLists(queryClient, capturedContext, canonical); rememberConversation(canonical, capturedContext);
        showToast({ title: error instanceof Error ? error.message : "Chat could not be updated.", duration: 2_000 });
      } finally { mutationKeys.current.delete(current.key); operationControllers.current.delete(controller); }
    })();
  }

  function confirmDelete() {
    const deleted = selectedRef.current; if (!deleted || mutationKeys.current.has(deleted.key)) return;
    const capturedIdentity = identity; const capturedContext = context;
    const controller = operationController();
    mutationKeys.current.add(deleted.key);
    turnGeneration.current += 1; turnController.current?.abort(); turnController.current = undefined; turnBusy.current = false; setTurning(false);
    removeConversationFromLists(queryClient, capturedContext, deleted.key); setSelected(undefined); selectedRef.current = undefined; rememberConversation(undefined, capturedContext); setActiveRetrievals(undefined); openSheet(undefined);
    void (async () => {
      let deletedPersisted = false;
      try {
        await deleteConversation(capturedContext, deleted.key, controller.signal);
        deletedPersisted = true;
        const fallbackPage = await listConversations(capturedContext, { favoriteOnly: false, recordHistory: false });
        if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
        queryClient.setQueryData(conversationQueryKeys.list(capturedContext, { query: "", favoriteOnly: false }), { pages: [fallbackPage], pageParams: [undefined] });
        const fallback = fallbackPage.conversations.reduce<Conversation | undefined>((current, candidate) => !current || candidate.updatedAt > current.updatedAt ? candidate : current, undefined);
        setSelected(fallback); selectedRef.current = fallback; rememberConversation(fallback, capturedContext);
        await invalidateConversationSearches(queryClient, capturedContext);
      } catch (error) {
        if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
        if (!deletedPersisted) {
          addConversationToUnfilteredLists(queryClient, capturedContext, deleted); setSelected(deleted); selectedRef.current = deleted; rememberConversation(deleted, capturedContext);
        } else {
          void queryClient.invalidateQueries({ queryKey: conversationQueryKeys.lists(capturedContext), refetchType: "active" });
        }
        if (!(error instanceof Error) || error.name !== "AbortError") showToast({ title: deletedPersisted ? `Chat deleted, but refresh failed: ${error instanceof Error ? error.message : "unknown error"}` : error instanceof Error ? error.message : "Chat could not be deleted.", duration: 2_000 });
      } finally { mutationKeys.current.delete(deleted.key); operationControllers.current.delete(controller); }
    })();
  }

  function confirmMessageDelete() {
    const conversation = selectedRef.current; const message = selectedMessage;
    if (!conversation || !message || turning || message.optimistic || message.status === "PENDING") return;
    const capturedIdentity = identity; const capturedContext = context; const controller = operationController();
    const queryKey = conversationQueryKeys.messages(capturedContext, conversation.key);
    const previous = queryClient.getQueryData<typeof messagesQuery.data>(queryKey);
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData(queryKey, (data: typeof messagesQuery.data) => data ? { ...data, pages: data.pages.map((page) => ({ ...page, messages: page.messages.filter((candidate) => message.turnKey ? candidate.turnKey !== message.turnKey : candidate.key !== message.key) })) } : data);
    setSelectedMessage(undefined); openSheet(undefined);
    void (async () => {
      try {
        const { deletedKeys } = await deleteConversationMessage(capturedContext, conversation.key, message.key, controller.signal);
        if (!isConversationContextCurrent(capturedIdentity, identityRef) || selectedRef.current?.key !== conversation.key) return;
        const deleted = new Set(deletedKeys);
        queryClient.setQueryData(queryKey, (data: typeof messagesQuery.data) => data ? { ...data, pages: data.pages.map((page) => ({ ...page, messages: page.messages.filter(({ key }) => !deleted.has(key)) })) } : data);
        void queryClient.invalidateQueries({ queryKey, exact: true });
      } catch (error) {
        if (isConversationContextCurrent(capturedIdentity, identityRef) && (!(error instanceof Error) || error.name !== "AbortError")) {
          queryClient.setQueryData(queryKey, previous);
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
    if (hasOlderMessages && !isFetchingOlderMessages) void fetchOlderMessagesPage();
  }, [fetchOlderMessagesPage, hasOlderMessages, isFetchingOlderMessages]);
  const handleMessageScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (initialScrollPending.current) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    nearBottom.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
    if (contentOffset.y < 180) fetchOlderMessages();
  }, [fetchOlderMessages]);
  const handleMessageScrollBeginDrag = useCallback(() => {
    followLatest.current = false;
    nearBottom.current = false;
    pendingScroll.current = undefined;
    if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
    if (scrollSettleTimer.current !== undefined) clearTimeout(scrollSettleTimer.current);
    if (followReleaseFrame.current !== undefined) cancelAnimationFrame(followReleaseFrame.current);
    scrollFrame.current = undefined;
    scrollSettleTimer.current = undefined;
    followReleaseFrame.current = undefined;
  }, []);
  const retryMessages = useCallback(() => void refetchMessages(), [refetchMessages]);
  const handleListContentSizeChange = useCallback(() => {
    if (initialScrollPending.current) { initialScrollPending.current = false; scheduleScrollToEnd(false); }
    else if (followLatest.current || nearBottom.current) scheduleScrollToEnd(!turning);
  }, [scheduleScrollToEnd, turning]);
  function changeQuery(value: string) { setQuery(value); setSearchPending(true); }

  const pageActions = <View style={styles.headerActions}><Button accessibilityLabel="Open chats" contentMode="raw" onPress={() => openSheet("chats")} size="xs" variant="icon"><ChatBubbleIcon size="sm" /></Button></View>;
  const chatsInitialError = chatsQuery.isError && !chatsQuery.data;
  const chatsMoreError = chatsQuery.isError && Boolean(chatsQuery.data);
  const chatsLoading = searchPending || (configured && chatsQuery.isPending && chatsQuery.isFetching);
  const persistedSelection = Boolean(selected && !selected.key.startsWith("optimistic-"));
  const messagesLoading = persistedSelection && messagesQuery.isPending && messagesQuery.isFetching;
  const messagesInitialError = persistedSelection && messagesQuery.isError && !messagesQuery.data;
  const messageEmpty = !messagesLoading && !messagesInitialError && messages.length === 0;
  const greetingPending = Boolean(greetingRequest) || greetingMessage?.status === "PENDING";
  const attachmentsPreparing = draftAttachments.some(({ preparing }) => preparing);
  const olderMessagesHeader = useMemo(() => isFetchingOlderMessages ? <OlderMessageSkeletons /> : isFetchNextPageError ? <Button onPress={fetchOlderMessages} size="sm" variant="secondary">Retry older messages</Button> : null, [fetchOlderMessages, isFetchNextPageError, isFetchingOlderMessages]);
  const conversation = useMemo(() => <View style={styles.conversation}>
    {turnError ? <Text accessibilityRole="alert" style={styles.error}>{turnError}</Text> : null}
    {messagesLoading ? <InitialMessageSkeletons /> : messagesInitialError ? <View style={styles.centerError}><Text accessibilityRole="alert" style={styles.error}>Messages could not be loaded.</Text><Button onPress={retryMessages} size="sm" variant="secondary">Retry</Button></View> : messageEmpty ? null : <FlatList contentContainerStyle={styles.messageList} data={messages} initialNumToRender={10} ItemSeparatorComponent={MessageSeparator} keyExtractor={messageKey} ListFooterComponent={<View style={styles.messageListFooter} />} ListHeaderComponent={olderMessagesHeader} maintainVisibleContentPosition={{ minIndexForVisible: 0 }} maxToRenderPerBatch={10} onContentSizeChange={handleListContentSizeChange} onScroll={handleMessageScroll} onScrollBeginDrag={handleMessageScrollBeginDrag} ref={mountMessageList} removeClippedSubviews={false} renderItem={renderMessage} scrollEventThrottle={80} showsVerticalScrollIndicator={false} updateCellsBatchingPeriod={50} windowSize={5} />}
  </View>, [handleMessageScroll, handleMessageScrollBeginDrag, handleListContentSizeChange, messageEmpty, messages, messagesInitialError, messagesLoading, mountMessageList, olderMessagesHeader, renderMessage, retryMessages, turnError]);
  const attachmentPills = draftAttachments.length || editReferenceImageKey ? <ScrollView accessibilityLabel="Draft attachments" contentContainerStyle={styles.attachmentPills} horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>{editReferenceImageKey ? <View style={styles.attachmentPill}><ImageIcon size="sm" variant="muted" /><Text numberOfLines={1} style={styles.attachmentName}>Image to edit</Text><Button accessibilityLabel="Remove image to edit" contentMode="raw" disabled={turning} onPress={() => setEditReferenceImageKey(undefined)} size="xs" style={styles.attachmentRemove} variant="icon"><CloseIcon size="sm" /></Button></View> : null}{draftAttachments.map((attachment) => <View key={attachment.clientKey} style={styles.attachmentPill}>{attachment.kind === "image" ? <ImageIcon size="sm" variant="muted" /> : <FileIcon size="sm" variant="muted" />}<Text numberOfLines={1} style={styles.attachmentName}>{displayAttachmentFilename(attachment.filename)}</Text><Button accessibilityLabel={`Remove ${displayAttachmentFilename(attachment.filename)}`} contentMode="raw" disabled={turning} onPress={() => removeDraftAttachment(attachment.clientKey)} size="xs" style={styles.attachmentRemove} variant="icon"><CloseIcon size="sm" /></Button></View>)}</ScrollView> : undefined;
  const modeSelector = <View style={styles.modeRow}><Tabs accessibilityLabel="Core mode" accessibilityRole="tablist" style={styles.modeTabs}><Button accessibilityRole="tab" accessibilityState={{ selected: mode === "chat" }} onPress={() => setMode("chat")} size="xs" style={styles.modeTab} variant={mode === "chat" ? "secondary" : "ghost"}>Chat</Button><Button accessibilityRole="tab" accessibilityState={{ selected: mode === "image" }} onPress={() => setMode("image")} size="xs" style={styles.modeTab} variant={mode === "image" ? "secondary" : "ghost"}>Images</Button></Tabs></View>;

  return <>
    <CoreComposer {...props} disabled={!configured || greetingPending || attachmentsPreparing || turning} editable={configured && !greetingPending && !turning && !sheet} expandedAccessory={attachmentPills} expandedFooter={modeSelector} expandedLeading={<PlusIcon size="sm" />} expandedLeadingAccessibilityLabel="Add attachment" expandedLeadingDisabled={!configured || greetingPending || turning} expandedPrompts={editReferenceImageKey ? ["Edit this image..."] : mode === "image" ? ["Generate image..."] : undefined} focusRequest={composerFocusRequest} loading={greetingPending || turning} maxLength={CONVERSATION_MESSAGE_MAX_LENGTH} message={conversation} onChangeText={(value) => { draftRevision.current += 1; setInput(value); }} onExpandedLeadingPress={() => openSheet("attachments")} onFocusChange={handleCoreFocusChange} onSubmit={() => void submit()} openRequest={greetingRequest?.id ?? coreOpenRequest} pageActions={pageActions} pageBackdrop={<ConversationWatermark />} pageIdentity={(closePage) => <View style={styles.coreIdentity}><View style={styles.coreIdentityApp}>{props.pageIdentity(closePage)}</View><ProfileHeaderRight /></View>} value={input} />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "attachments"} title=""><BottomSheetMenu><BottomSheetItem onPress={() => void pickImages()} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Upload images</BottomSheetItem><BottomSheetItem onPress={() => void pickFiles()} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Upload files</BottomSheetItem><BottomSheetItem onPress={() => { openSheet(undefined); setCameraOpen(true); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Capture image</BottomSheetItem></BottomSheetMenu></BottomSheet>
    {cameraOpen ? <BrandedCameraModal count={0} maximum={1} onCapture={captureImage} onClose={() => setCameraOpen(false)} showCaptureLoading={false} title="Capture for Core" /> : null}
    <BottomSheet footer={<><Button disabled={creating} onPress={openNewChat} size="md" variant="primary">New chat</Button><Button onPress={() => openSheet(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open && sheet === "chats") setSheet(undefined); }} open={sheet === "chats" || sheet === "filter"} title="Chats">
      <View style={styles.searchActions}><View style={styles.search}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search chats" autoFocusInBottomSheet={false} maxLength={500} onChangeText={changeQuery} placeholder="Search..." style={styles.searchInput} value={query} />{query ? <ButtonSizeProvider overrideParent size="xs"><Button accessibilityLabel="Clear chat search" contentMode="raw" iconOnly onPress={() => changeQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button></ButtonSizeProvider> : null}</View><Button accessibilityLabel="Filter chats" contentMode="raw" onPress={() => openSheet("filter")} size="md" variant="icon"><FilterIcon size="sm" variant={favoriteOnly ? "accent" : "default"} /></Button></View>
      <Tabs accessibilityLabel="Chat group" accessibilityRole="tablist" style={styles.chatGroupTabs}><Button accessibilityRole="tab" accessibilityState={{ selected: !favoriteOnly }} onPress={() => setFavoriteOnly(false)} size="xs" style={styles.modeTab} variant={!favoriteOnly ? "secondary" : "ghost"}>Chats</Button><Button accessibilityRole="tab" accessibilityState={{ selected: favoriteOnly }} onPress={() => setFavoriteOnly(true)} size="xs" style={styles.modeTab} variant={favoriteOnly ? "secondary" : "ghost"}>Favorites</Button></Tabs>
      {chatsLoading ? <View accessibilityLabel={query ? "Searching chats" : "Loading chats"} accessibilityRole="progressbar" style={styles.chatList}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.chatSkeleton, styles.skeletonCard]} />)}</View> : chatsInitialError ? <View style={styles.centerError}><Text accessibilityRole="alert" style={styles.error}>Chats could not be loaded.</Text><Button onPress={() => void chatsQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : <FlatList contentContainerStyle={[styles.chatList, conversations.length === 0 && styles.emptyChatList]} data={conversations} keyExtractor={conversationKey} ListEmptyComponent={<Text style={styles.emptyText}>{committedQuery ? "No chats matched this search." : favoriteOnly ? "No favorite chats." : "No chats yet."}</Text>} ListFooterComponent={chatsMoreError ? <Button onPress={() => void chatsQuery.fetchNextPage()} size="md" variant="secondary">Retry more chats</Button> : null} onEndReached={() => { if (chatsQuery.hasNextPage && !chatsQuery.isFetchingNextPage) void chatsQuery.fetchNextPage(); }} onEndReachedThreshold={0.4} renderItem={({ item }) => <ActionPill compact onPress={() => selectConversation(item)} pressLabel={`Open ${item.name}`}><View style={styles.chatPillContent}><Text numberOfLines={1} style={styles.chatName}>{item.name}</Text></View></ActionPill>} />}
    </BottomSheet>
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) openSheet("chats"); }} open={sheet === "filter"} title=""><View style={styles.filterContent}><View style={styles.filterRow}><Switch accessibilityLabel="Show favorite chats only" checked={favoriteOnly} onCheckedChange={(checked) => { setFavoriteOnly(checked); openSheet("chats"); }} /><Text style={styles.filterLabel}>Favorites</Text></View><Button onPress={() => void openSearchHistory()} size="md" variant="secondary">Search history</Button></View></BottomSheet>
    <SearchHistorySheet error={historyError} history={history} loading={historyLoading} onClose={() => openSheet("chats")} onRemove={(item) => void removeHistoryQuery(item)} onSelect={useHistoryQuery} open={sheet === "history"} removingQuery={removingHistoryQuery} />
    <ConversationRetrievalSheet contextIdentity={identity} onClose={closeRetrievals} onNavigate={navigateRetrievalResult} open={sheet === "retrievals" && Boolean(activeRetrievals)} retrievals={activeRetrievals ?? []} />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "current"} title=""><BottomSheetMenu><BottomSheetItem onPress={() => { setEditName(selected?.name ?? ""); setEditFavorite(Boolean(selected?.isFavorite)); openSheet("edit"); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Edit</BottomSheetItem><BottomSheetItem onPress={() => mutateConversation("favorite")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">{selected?.isFavorite ? "Unfavorite" : "Favorite"}</BottomSheetItem><BottomSheetItem onPress={() => openSheet("delete")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Delete</BottomSheetItem></BottomSheetMenu></BottomSheet>
    <BottomSheet focusKey="editConversation" footer={<><Button disabled={!editName.trim()} onPress={() => mutateConversation("edit")} size="md" variant="primary">Save</Button><Button onPress={() => openSheet(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "edit"} title="Edit chat"><View style={styles.editForm}><TextInput accessibilityLabel="Chat name" maxLength={CONVERSATION_NAME_MAX_LENGTH} onChangeText={setEditName} placeholder="Chat name" ref={editInput} value={editName} /><View style={styles.favoriteRow}><Switch accessibilityLabel="Favorite chat" checked={editFavorite} onCheckedChange={setEditFavorite} /><Text style={styles.favoriteLabel}>Favorite</Text></View></View></BottomSheet>
    <BottomSheet footer={<><Button onPress={confirmDelete} size="md" variant="primary">Delete</Button><Button onPress={() => openSheet(undefined)} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "delete"} title="Delete chat?" />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) { setSheet(undefined); setSelectedMessage(undefined); } }} open={sheet === "messageActions"} title=""><BottomSheetMenu><BottomSheetItem onPress={shareSelectedMessage} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Share message</BottomSheetItem><BottomSheetItem onPress={() => openSheet("deleteMessage")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Delete message</BottomSheetItem></BottomSheetMenu></BottomSheet>
    <BottomSheet footer={<><Button onPress={confirmMessageDelete} size="md" variant="primary">Delete</Button><Button onPress={() => openSheet("messageActions")} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open) { setSheet(undefined); setSelectedMessage(undefined); } }} open={sheet === "deleteMessage" && Boolean(selectedMessage)} title="Delete message?" />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) { setSheet(undefined); setSelectedGeneratedImageKey(undefined); setSelectedGeneratedImageCollectionKey(undefined); } }} open={sheet === "imageActions" && Boolean(selectedGeneratedImageKey)} title=""><BottomSheetMenu><BottomSheetItem onPress={() => { if (selectedGeneratedImageKey) setEditReferenceImageKey(selectedGeneratedImageKey); openSheet(undefined); setSelectedGeneratedImageKey(undefined); setSelectedGeneratedImageCollectionKey(undefined); setComposerFocusRequest((current) => current + 1); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Edit image</BottomSheetItem><BottomSheetItem onPress={() => { const imageKey = selectedGeneratedImageKey; const assetKey = selectedGeneratedImageCollectionKey; openSheet(undefined); setSelectedGeneratedImageKey(undefined); setSelectedGeneratedImageCollectionKey(undefined); if (imageKey) router.push({ pathname: "/capability/[slug]", params: { slug: "gallery", imageKey, ...(assetKey ? { assetKey } : {}) } }); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Open image</BottomSheetItem></BottomSheetMenu></BottomSheet>
  </>;
}

const styles = StyleSheet.create({
  coreIdentity: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", width: "100%" }, coreIdentityApp: { minWidth: 0, flex: 1 }, headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs }, conversation: { flex: 1, minHeight: 0, position: "relative" }, coreWatermark: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.xl, transform: [{ translateY: -spacing.xxl }] }, coreWatermarkMark: { marginVertical: spacing.xs, opacity: 0.3 }, coreWatermarkText: { color: palette.muted, fontSize: 13, lineHeight: 19, maxWidth: 320, opacity: 0.3, textAlign: "center" }, messageList: { flexGrow: 1, zIndex: 1 }, messageSeparator: { height: spacing.md }, messageListFooter: { height: 24 },
  messageRow: { width: "100%", flexDirection: "row", alignItems: "flex-start" }, assistantRow: { justifyContent: "flex-start", paddingRight: spacing.lg, gap: spacing.sm }, userRow: { justifyContent: "flex-end", paddingLeft: 52 }, assistantMark: { marginTop: 4 }, messageContent: { minWidth: 0, gap: spacing.xs }, messageBox: { maxWidth: "100%", borderRadius: radii.md, paddingVertical: 4 }, messageButton: { minHeight: 0, alignItems: "stretch", borderWidth: 0, justifyContent: "flex-start" }, assistantMessage: { minWidth: 0, flex: 1, backgroundColor: "transparent" }, userMessage: { backgroundColor: "transparent" }, failedMessage: { borderWidth: 1, borderColor: palette.danger, paddingHorizontal: spacing.sm }, messageText: { color: palette.text, fontSize: 14, lineHeight: 20 }, messageAttachments: { alignItems: "flex-end", gap: spacing.xs, marginTop: spacing.xs }, messageAttachmentFile: { maxWidth: 260, flexDirection: "row", gap: spacing.xs }, messageAttachmentFallback: { maxWidth: 260, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, messageAttachmentName: { minWidth: 0, flexShrink: 1, color: palette.text, fontSize: 12 }, messageAttachmentImageButton: { minHeight: 0, width: 144, alignItems: "stretch", padding: 4 }, messageAttachmentLocalImage: { width: 144, alignItems: "stretch", padding: 4 }, messageAttachmentImage: { width: "100%", height: 88, borderRadius: radii.sm }, retrievalSummary: { minWidth: 0, flex: 1, color: palette.muted, fontSize: 12 },
  olderSkeletons: { gap: spacing.md }, messageSkeleton: { height: 18, marginTop: 3, borderRadius: radii.sm }, assistantSkeleton: { width: "76%" }, userSkeleton: { width: "62%" }, thinkingText: { flex: 1, marginTop: 3 }, skeletonCard: { borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.hairlineBright, opacity: 0.72, overflow: "hidden" }, error: { color: palette.danger, fontSize: 12, marginBottom: spacing.xs }, centerError: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm }, emptyText: { color: palette.muted, fontSize: 13, textAlign: "center" },
  searchActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs }, search: { minHeight: 44, flex: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 12, paddingRight: 8, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page }, searchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  chatGroupTabs: { marginTop: spacing.sm, width: "100%", backgroundColor: palette.panel, borderColor: palette.hairline, borderWidth: 1, flexDirection: "row", gap: 4, padding: 3 }, chatList: { flexGrow: 1, gap: spacing.xs, paddingTop: spacing.md, paddingBottom: spacing.lg }, emptyChatList: { justifyContent: "center" }, chatPillContent: { minWidth: 0, minHeight: 32, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }, chatName: { minWidth: 0, flex: 1, color: palette.text, lineHeight: 18, textAlign: "left", textAlignVertical: "center" }, chatSkeleton: { width: "100%", height: 38, borderRadius: 999 }, sheetAction: { justifyContent: "center" }, sheetActionText: { width: "100%", textAlign: "center" },
  filterContent: { gap: spacing.md }, filterRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm }, filterLabel: { color: palette.text, fontSize: 13 }, editForm: { paddingTop: spacing.sm, gap: spacing.md }, favoriteRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm }, favoriteLabel: { color: palette.muted, fontSize: 13 },
  attachmentPills: { alignItems: "center", gap: spacing.xs, paddingHorizontal: 2 }, attachmentPill: { alignItems: "center", backgroundColor: palette.surface, borderColor: palette.hairline, borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 5, height: 30, maxWidth: 210, paddingLeft: spacing.sm, paddingRight: 2 }, attachmentName: { color: palette.text, flexShrink: 1, fontSize: 11, maxWidth: 140 }, attachmentRemove: { height: 24, minHeight: 24, minWidth: 24, paddingHorizontal: 0, paddingVertical: 0, width: 24 },
  modeRow: { alignItems: "center" }, modeTabs: { width: "100%", backgroundColor: palette.panel, borderColor: palette.hairline, borderWidth: 1, flexDirection: "row", gap: 4, padding: 3 }, modeTab: { flex: 1 },
  generatedImageResponse: { gap: spacing.sm, maxWidth: 320, width: "100%" }, generatedImageFrame: { alignItems: "center", height: 220, justifyContent: "center", maxWidth: 320, width: "100%" }, generatedImageButton: { borderWidth: 0, height: 220, maxWidth: 320, overflow: "hidden", padding: 0, width: "100%" }, generatedImage: { borderRadius: radii.md, height: 220, width: "100%" }, generatedImageLoading: { opacity: 0 }, generatedImageOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: radii.md },
});

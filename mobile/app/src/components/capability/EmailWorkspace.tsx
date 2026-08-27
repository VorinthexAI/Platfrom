import { forwardRef, useEffect, useEffectEvent, useRef, useState, type ComponentProps, type ComponentRef, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import {
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BottomSheet,
  BottomSheetItem,
} from "@vorinthex/shared/ui/bottom-sheet";
import { AiTextEditor } from "@vorinthex/shared/ui/ai-text-editor";
import { Button, ButtonSizeProvider } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import {
  BrainIcon,
  ChatBubbleIcon,
  CheckIcon,
  ChevronLeftIcon,
  ClockIcon,
  CloseIcon,
  FileIcon,
  FilterIcon,
  InboxIcon,
  MailIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
} from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput as SharedTextInput } from "@vorinthex/shared/ui/text-input";
import { Switch } from "@vorinthex/shared/ui/switch";
import { useToast } from "@vorinthex/shared/ui/toast";

import { ChromeIcon } from "@/components/ChromeIcon";
import { EmailAttachmentPicker, type EmailAttachmentImageUrls, type EmailAttachmentLabels } from "@/components/capability/EmailAttachmentPicker";
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { SearchHistorySheet } from "@/components/SearchHistorySheet";
import { assistantIconSource } from "@/data/capability-icons";
import { type CapabilitySlug } from "@/data/registry";
import { subscribeAppEvent } from "@/lib/app-events";
import { enhanceAppTextForContext, translateAppTextForContext } from "@/lib/app-transformation-client";
import { languageForCountryCode } from "@/lib/auth-helpers";
import { deleteContentSearchHistory, getContentContext, type ContentDocument, type ContentSearchHistoryItem } from "@/lib/content-client";
import { getContentDocument } from "@/lib/content-query-cache";
import { getUserSearchHistory, promoteCachedUserSearchHistory, removeCachedUserSearchHistory, userSearchHistoryQueryKey } from "@/lib/user-search-history-cache";
import {
  askEmailAssistantForContext,
  BUILT_IN_EMAIL_TONES,
  composeEmailDraftForContext,
  createEmailReplyContextForContext,
  createEmailToneForContext,
  createEmailDraftForContext,
  disconnectEmailForContext,
  deleteEmailDraftForContext,
  deleteEmailMessageSummariesForContext,
  deleteEmailMessageTranslationsForContext,
  deleteEmailReplyContextsForContext,
  deleteEmailToneForContext,
  exchangeEmailConnection,
  findSimilarEmailMessagesForContext,
  fetchEmailOverviewForContext,
  fetchEmailReplyContextsForContext,
  fetchEmailThreadForContext,
  getEmailContext,
  getEmailPermissions,
  launchEmailConnection,
  listEmailMessageSummariesForContext,
  listEmailMessageTranslationsForContext,
  sendEmailDraftForContext,
  searchEmailInboxesForContext,
  searchEmailDraftsForContext,
  searchEmailMessagesForContext,
  searchEmailTonesForContext,
  setEmailThreadsFavoriteForContext,
  setEmailThreadsReadStateForContext,
  summarizeEmailMessageForContext,
  translateEmailMessageForContext,
  trashEmailThreadsForContext,
  clearEmailTrashForContext,
  updateEmailInboxForContext,
  updateEmailReplyContextForContext,
  updateEmailToneForContext,
  updateEmailDraftForContext,
  type EmailAssistantResponse,
  type EmailAttachmentRef,
  type EmailDraft,
  type EmailConnector,
  type EmailFacet,
  type EmailMessage,
  type EmailOverview,
  type EmailOverviewQuery,
  type EmailReadState,
  type EmailReplyContext,
  type EmailReplyMode,
  type EmailThread,
  type EmailBulkThreadReport,
  type EmailSimilarResult,
  type EmailSummary,
  type EmailTone,
  type EmailToneRecord,
  type EmailTranslationVersion,
  emailAddressSchema,
  emailAddressListSchema,
  normalizeEmailOverviewQuery,
  retainEmailRequestKey,
  setEmailOverviewReadState,
  toggleEmailOverviewFacet,
} from "@/lib/email-client";
import { attachmentIdentity, latestSentEmailMessageKey } from "@/lib/email-attachment-picker";
import { clearableEmailTrashGroups, loadEmailTrashGroups, type EmailTrashGroup } from "@/lib/email-trash-aggregation";
import {
  patchSignalInbox,
  overlayPendingSignalThread,
  overlayPendingSignalThreads,
  reconcileSignalOverviewThreads,
  reconcileSignalSelectedThreads,
  reconcileSignalThreads,
  removeSignalOverviewThreadKeys,
  removeSignalThreadKeys,
  removeSignalSummaries,
  removeSignalTranslationVersions,
  restoreMissingSignalSummaries,
  restoreMissingSignalTranslationVersions,
  restoreSignalTrashCaches,
  restoreSignalToneIfStillRemoved,
  settleMatchingSignalRepairPendingFields,
  clearSignalTrashCaches,
  clearSignalThreadTombstones,
  commitSignalTrashCaches,
  filterSignalTombstonedOverview,
  galleryQueryKeys,
  isSignalThreadTombstoned,
  signalQueryKeys,
  tombstoneSignalThreadKeys,
  invalidateAssistantChanges,
  upsertSignalSummary,
  upsertSignalTone,
  upsertSignalTranslationVersion,
} from "@/lib/workspace-query-cache";
import { normalizeCapturedPng } from "@/lib/captured-image";
import { fetchGalleryOverview, fetchGalleryUploadStatus, getGalleryContext, searchGalleryImages, uploadGalleryImages, type GalleryCollection, type GalleryImage, type GalleryOverview } from "@/lib/gallery-client";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";
import { appendCursorItems, isNearScrollEnd } from "@vorinthex/shared/lib/pagination";

const signalInputStyle = StyleSheet.create({ input: { backgroundColor: palette.page } }).input;

const TextInput = forwardRef<ComponentRef<typeof SharedTextInput>, ComponentProps<typeof SharedTextInput>>(function SignalTextInput({ style, ...props }, ref) {
  return <SharedTextInput {...props} ref={ref} style={[style, signalInputStyle]} />;
});

type EmailEditorTarget = "newEmail" | "newEmailReview" | "draft" | "reply";
type EmailEditorTransformation = Readonly<{ target: EmailEditorTarget; action: "enhance" | "translate" }>;

type Sheet =
  "ai" | "plus" | "rootFilter" | "inboxFilter" | "rootCreate" | "searchHistory" | "connectForm" | "toneCreate" | "inboxEdit" | "toneEdit" | "toneDelete" | "account" | "disconnect" | "bulkActions" | "bulkTrash" | "trashRoot" | "clearTrash";
type RootTab = "inboxes" | "tones";
type InboxTab = EmailReadState | "drafts";
type FormSheet = "connectForm" | "toneCreate" | "inboxEdit" | "toneEdit";
type BusyAction =
  | "connect"
  | "toneCreate"
  | "metadata"
  | "sync"
  | "sort"
  | "send"
  | "favorite"
  | "disconnect"
  | "ai";
const INBOX_FACETS: readonly { facet: EmailFacet; label: string }[] = [
  { facet: "urgent", label: "Urgent" },
  { facet: "important", label: "Important" },
  { facet: "filtered", label: "Filtered" },
  { facet: "favorite", label: "Favorite" },
];
const defaultInboxQuery = () => normalizeEmailOverviewQuery();
type ReaderSheet = "translate" | "translationForm" | "translationReader" | "summaryVersions" | "summaryReader" | "replies" | "similar" | "delete";
type ReplyDraft = Extract<EmailDraft, { variant: "reply" }>;
type NewEmailDraft = Extract<EmailDraft, { variant: "new" }>;
type NewEmailToneOption = Readonly<{ label: string; value: EmailTone }>;
type NewEmailAlternative = Readonly<{ option: NewEmailToneOption; status: "pending" | "succeeded" | "failed"; draft?: NewEmailDraft; error?: string }>;
type GeneratedKind = "translation" | "summary";
type ReceivedAttachment =
  | Readonly<{ kind: "document"; ref: EmailAttachmentRef; document: ContentDocument; source: ReceivedAttachmentSource }>
  | Readonly<{ kind: "image"; ref: EmailAttachmentRef; image: GalleryImage; collection?: GalleryCollection; source: ReceivedAttachmentSource }>;
type ReceivedAttachmentSource = Readonly<{ threadKey: string; messageKey: string }>;
type GeneratedDeleteConfirmation = Readonly<{ kind: GeneratedKind; context: ReturnType<typeof getEmailContext>; threadKey: string; messageKey: string; keys: readonly string[]; generation: number }>;
function reconcileSelectedInboxSnapshots(selected: EmailConnector[], authoritative: readonly EmailConnector[]) {
  const byConnector = new Map(authoritative.map((account) => [account.connectorKey, account]));
  const next = selected.flatMap((account) => { const current = byConnector.get(account.connectorKey); return current ? [current] : []; });
  return next.length === selected.length && next.every((account, index) => account === selected[index]) ? selected : next;
}
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const SHEET_TRANSITION_DELAY_MS = 230;
const SHEET_INPUT_FOCUS_DELAY_MS = 300;
const CORE_PROMPTS = [
  "Show my urgent unread emails",
  "Which messages need action?",
  "Create a concise email draft",
] as const;

function useDelayedInputFocus(focusKey: string | undefined, inputRef: { current: ComponentRef<typeof TextInput> | null }, enabled = true) {
  useEffect(() => {
    if (!focusKey || !enabled) return;
    const timer = setTimeout(() => inputRef.current?.focus(), SHEET_INPUT_FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, focusKey, inputRef]);
}

function messageFor(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Email could not complete that request.";
}
function shortAddress(value?: string) {
  return value?.split("@")[0]?.replace(/[._-]+/g, " ") || "Unknown sender";
}
function parseAddresses(value: string) {
  return value
    .split(/[;,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
function sameAttachmentSelection(left: readonly EmailAttachmentRef[], right: readonly EmailAttachmentRef[]) {
  return left.length === right.length && left.every((ref, index) => attachmentIdentity(ref) === attachmentIdentity(right[index]!));
}
function formatEmailTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value)).replace(",", "");
}
export function EmailWorkspace({ initialConnectorKey, initialMessageKey, initialThreadKey, navigatedFromRoot = false, openAttachments = false }: { initialConnectorKey?: string; initialMessageKey?: string; initialThreadKey?: string; navigatedFromRoot?: boolean; openAttachments?: boolean }) {
  const organizationKey = useAuthStore((state) => typeof state.organization?.key === "string" ? state.organization.key : "");
  const scopeKey = useAuthStore((state) => typeof state.scope?.key === "string" ? state.scope.key : "");
  if (!organizationKey || !scopeKey) return null;
  const emailContext = { organizationKey, scopeKey };
  const sessionKey = `${emailContext.organizationKey}:${emailContext.scopeKey}:${initialConnectorKey ?? "root"}:${initialThreadKey ?? "inbox"}:${initialMessageKey ?? "latest"}:${openAttachments ? "attachments" : "reader"}`;
  return <EmailWorkspaceSession emailContext={emailContext} initialConnectorKey={initialConnectorKey} initialMessageKey={initialMessageKey} initialThreadKey={initialThreadKey} key={sessionKey} navigatedFromRoot={navigatedFromRoot} openAttachments={openAttachments} />;
}

function EmailWorkspaceSession({ emailContext, initialConnectorKey, initialMessageKey, initialThreadKey, navigatedFromRoot, openAttachments }: { emailContext: ReturnType<typeof getEmailContext>; initialConnectorKey?: string; initialMessageKey?: string; initialThreadKey?: string; navigatedFromRoot: boolean; openAttachments: boolean }) {
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { showToast } = useToast();
  const countryCode = useAuthStore((state) => state.user?.countryCode);
  const userKey = useAuthStore((state) => state.user?.key ?? "");
  const historyContext = { ...emailContext, userKey };
  const notify = (title: string) => {
    showToast({ title, duration: 2_000 });
  };
  const params = useLocalSearchParams<{
    connectorKey?: string;
    email_connection_code?: string;
    email_connection_error?: string;
  }>();
  const processedConnectionCode = useRef<string | undefined>(undefined);
  const rootSearchInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const sheetInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const readerInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const editorTranslationInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const newEmailRecipientInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const newEmailSubjectInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const rootSearchFocusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rootSearchRequest = useRef<AbortController | undefined>(undefined);
  const assistantGeneration = useRef(0);
  const overviewRequest = useRef(0);
  const overviewGeneration = useRef(0);
  const overviewPageGeneration = useRef(0);
  const historyGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const overviewLoadQuery = useRef<string | undefined>(undefined);
  const loadingOverview = useRef(false);
  const loadingMore = useRef(false);
  const loadingMoreThread = useRef(false);
  const restoredSignalReader = useRef(false);
  const restoredSignalAttachments = useRef(false);
  const receivedAttachmentsRequest = useRef(0);
  const metadataRequests = useRef(new Map<string, number>());
  const operationGeneration = useRef(0);
  const readerGeneration = useRef(0);
  const editorTransformationGeneration = useRef(0);
  const pendingTranslationReaderKey = useRef<string | undefined>(undefined);
  const generatedDeleteGeneration = useRef(0);
  const generatedDeleteInFlight = useRef(false);
  const longPressedGenerated = useRef<string | undefined>(undefined);
  const trashGeneration = useRef(0);
  const readerTargetKey = useRef<string | undefined>(undefined);
  const selectedThreadKeyRef = useRef<string | undefined>(undefined);
  const selectedMessageKeyRef = useRef<string | undefined>(undefined);
  const sendGeneration = useRef<number | undefined>(undefined);
  const newEmailGeneration = useRef(0);
  const newEmailGenerationOwner = useRef<string | undefined>(undefined);
  const newEmailToneRequests = useRef(new Map<string, { controller: AbortController; requestKey: string }>());
  const newEmailToneRequestKeys = useRef(new Map<string, { fingerprint: string; requestKey: string }>());
  const newEmailSendInFlight = useRef(false);
  const newEmailPreparation = useRef<{ fingerprint: string; requestKey: string } | undefined>(undefined);
  const newEmailFinalSend = useRef<{ fingerprint: string; requestKey: string } | undefined>(undefined);
  const savedDraftFinalSend = useRef<{ fingerprint: string; requestKey: string } | undefined>(undefined);
  const replyPreparation = useRef<{ fingerprint: string; requestKey: string } | undefined>(undefined);
  const replyFinalSend = useRef<{ fingerprint: string; requestKey: string } | undefined>(undefined);
  const selectedReplyKeyRef = useRef<string | undefined>(undefined);
  const favoriteGeneration = useRef(0);
  const favoriteInFlight = useRef(false);
  const readInFlight = useRef(new Set<string>());
  const bulkGeneration = useRef(0);
  const bulkInFlight = useRef(false);
  const trashInFlight = useRef(false);
  const selectionGeneration = useRef(0);
  const longPressedThread = useRef<string | undefined>(undefined);
  const pendingThreadFields = useRef(new Map<string, { favorite?: boolean; read?: boolean; trash?: boolean }>());
  const repairPendingThreadFields = useRef(new Map<string, Set<"favorite" | "read" | "trash">>());
  const formTransitionGeneration = useRef(0);
  const toneCreateInFlight = useRef(false);
  const metadataInFlight = useRef(false);
  const deleteToneInFlight = useRef(false);
  const metadataFormContext = useRef<typeof emailContext | undefined>(undefined);
  const committedInboxQuery = useRef<EmailOverviewQuery>(defaultInboxQuery());
  const requestedInboxQuery = useRef<EmailOverviewQuery>(committedInboxQuery.current);
  const allowNavigation = useRef(false);
  const [inboxView, setInboxView] = useState<{ overview?: EmailOverview; query: EmailOverviewQuery }>(() => ({ query: committedInboxQuery.current }));
  const { overview, query: inboxQuery } = inboxView;
  const [inboxControlsQuery, setInboxControlsQuery] = useState<EmailOverviewQuery>(requestedInboxQuery.current);
  const [inboxTab, setInboxTab] = useState<InboxTab>(requestedInboxQuery.current.readState);
  const [rootQuery, setRootQuery] = useState("");
  const [rootTab, setRootTab] = useState<RootTab>("inboxes");
  const [rootFavoritesOnly, setRootFavoritesOnly] = useState(false);
  const [rootSearchFocusable, setRootSearchFocusable] = useState(true);
  const [rootSearchResults, setRootSearchResults] = useState<{ tab: RootTab; inboxes?: EmailConnector[]; tones?: EmailToneRecord[] }>();
  const [rootSearching, setRootSearching] = useState(false);
  const [rootSearchError, setRootSearchError] = useState<string>();
  const [rootGridWidth, setRootGridWidth] = useState(0);
  const [selectedInboxes, setSelectedInboxes] = useState<EmailConnector[]>([]);
  const [rootBulkBusy, setRootBulkBusy] = useState(false);
  const [rootBulkMenuOpen, setRootBulkMenuOpen] = useState(false);
  const [rootDisconnectOpen, setRootDisconnectOpen] = useState(false);
  const rootLongPressedInbox = useRef<string | undefined>(undefined);
  const selectedInboxesRef = useRef<EmailConnector[]>([]);
  const rootSelectionGeneration = useRef(0);
  const [searchHistory, setSearchHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [searchHistoryLoading, setSearchHistoryLoading] = useState(false);
  const [searchHistoryError, setSearchHistoryError] = useState<string>();
  const [removingHistoryQuery, setRemovingHistoryQuery] = useState<string>();
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantResponse, setAssistantResponse] = useState<EmailAssistantResponse>();
  const [assistantError, setAssistantError] = useState<string>();
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantInputFocused, setAssistantInputFocused] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{
    thread: EmailThread;
    messages: EmailMessage[];
    nextCursor?: string | null;
    truncated?: boolean;
  }>();
  const [selectedMessageKey, setSelectedMessageKey] = useState<string>();
  const [readerSheet, setReaderSheet] = useState<ReaderSheet>("translate");
  const [readerSheetOpen, setReaderSheetOpen] = useState(false);
  const [threadSheetOpen, setThreadSheetOpen] = useState(false);
  const [threadPageLoading, setThreadPageLoading] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [receivedAttachments, setReceivedAttachments] = useState<ReceivedAttachment[]>([]);
  const [receivedAttachmentsLoading, setReceivedAttachmentsLoading] = useState(false);
  const [receivedAttachmentsError, setReceivedAttachmentsError] = useState<string>();
  const [receivedAttachmentGridWidth, setReceivedAttachmentGridWidth] = useState(0);
  const [readerLoading, setReaderLoading] = useState(false);
  const [readerGenerating, setReaderGenerating] = useState<"translation" | "summary" | undefined>(undefined);
  const [trashBusy, setTrashBusy] = useState(false);
  const [readBusy, setReadBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkActionsLoading, setBulkActionsLoading] = useState(false);
  const [selectedThreads, setSelectedThreads] = useState<EmailThread[]>([]);
  const [selectionNotice, setSelectionNotice] = useState<string>();
  const trashRootGeneration = useRef(0);
  const trashClearInFlight = useRef(false);
  const [trashGroups, setTrashGroups] = useState<EmailTrashGroup[]>([]);
  const [trashRootLoading, setTrashRootLoading] = useState(false);
  const [trashRootError, setTrashRootError] = useState<string>();
  const [trashClearBusy, setTrashClearBusy] = useState(false);
  const [readerError, setReaderError] = useState<string>();
  const [targetLanguage, setTargetLanguage] = useState(() => languageForCountryCode(countryCode));
  const [editorActionTarget, setEditorActionTarget] = useState<EmailEditorTarget>();
  const [editorTranslateTarget, setEditorTranslateTarget] = useState<EmailEditorTarget>();
  const [editorTargetLanguage, setEditorTargetLanguage] = useState(() => languageForCountryCode(countryCode));
  const [editorTransformation, setEditorTransformation] = useState<EmailEditorTransformation>();
  const [selectedTranslationKey, setSelectedTranslationKey] = useState<string>();
  const [selectedTranslationKeys, setSelectedTranslationKeys] = useState<string[]>([]);
  const [selectedSummaryKey, setSelectedSummaryKey] = useState<string>();
  const [selectedSummaryKeys, setSelectedSummaryKeys] = useState<string[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<ReplyDraft[]>([]);
  const [selectedReplyKey, setSelectedReplyKey] = useState<string>();
  const [replyBody, setReplyBody] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<EmailAttachmentRef[]>([]);
  const [replyAttachmentLabels, setReplyAttachmentLabels] = useState<EmailAttachmentLabels>({});
  const [replyAttachmentImageUrls, setReplyAttachmentImageUrls] = useState<EmailAttachmentImageUrls>({});
  const replyImageRefreshes = useRef(new Map<string, Promise<void>>());
  const draftCleanupInFlight = useRef(new Set<string>());
  const [replyAttachmentsOpen, setReplyAttachmentsOpen] = useState(false);
  const [replyEditorOpen, setReplyEditorOpen] = useState(false);
  const [replyModeOpen, setReplyModeOpen] = useState(false);
  const [emptyReply, setEmptyReply] = useState(false);
  const [replySending, setReplySending] = useState(false);
  const [generatedDeleteConfirmation, setGeneratedDeleteConfirmation] = useState<GeneratedDeleteConfirmation>();
  const [generatedDeleteBusy, setGeneratedDeleteBusy] = useState(false);
  const [similarResults, setSimilarResults] = useState<EmailSimilarResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [retryInboxQuery, setRetryInboxQuery] = useState<EmailOverviewQuery>();
  const [busy, setBusy] = useState<BusyAction>();
  const [openingThreadKey, setOpeningThreadKey] = useState<string>();
  const [sheet, setSheet] = useState<Sheet>("plus");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [replyContextsOpen, setReplyContextsOpen] = useState(false);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const [sheetError, setSheetError] = useState<string>();
  const [newEmailRecipientsOpen, setNewEmailRecipientsOpen] = useState(false);
  const [newEmailContentOpen, setNewEmailContentOpen] = useState(false);
  const [newEmailAlternativesOpen, setNewEmailAlternativesOpen] = useState(false);
  const [newEmailReviewOpen, setNewEmailReviewOpen] = useState(false);
  const [newEmailAttachmentsOpen, setNewEmailAttachmentsOpen] = useState(false);
  const [newEmailRecipientInput, setNewEmailRecipientInput] = useState("");
  const [newEmailRecipients, setNewEmailRecipients] = useState<string[]>([]);
  const [newEmailRecipientError, setNewEmailRecipientError] = useState<string>();
  const [newEmailSubject, setNewEmailSubject] = useState("");
  const [newEmailBody, setNewEmailBody] = useState("");
  const [newEmailAlternatives, setNewEmailAlternatives] = useState<NewEmailAlternative[]>([]);
  const [newEmailSelectedDraft, setNewEmailSelectedDraft] = useState<NewEmailDraft>();
  const [newEmailReviewSubject, setNewEmailReviewSubject] = useState("");
  const [newEmailReviewBody, setNewEmailReviewBody] = useState("");
  const [newEmailAttachments, setNewEmailAttachments] = useState<EmailAttachmentRef[]>([]);
  const [newEmailAttachmentLabels, setNewEmailAttachmentLabels] = useState<EmailAttachmentLabels>({});
  const [newEmailAttachmentImageUrls, setNewEmailAttachmentImageUrls] = useState<EmailAttachmentImageUrls>({});
  const [reviewAttachmentGridWidth, setReviewAttachmentGridWidth] = useState(0);
  const [newEmailSkipped, setNewEmailSkipped] = useState(false);
  const [newEmailSending, setNewEmailSending] = useState(false);
  const [newEmailError, setNewEmailError] = useState<string>();
  const [selectedInboxDraftKey, setSelectedInboxDraftKey] = useState<string>();
  const [draftBody, setDraftBody] = useState("");
  const [draftSending, setDraftSending] = useState(false);
  const [draftSearchResults, setDraftSearchResults] = useState<{ connectorKey: string; query: string; drafts: EmailDraft[] }>();
  const [draftSearching, setDraftSearching] = useState(false);
  const [draftSearchError, setDraftSearchError] = useState<string>();
  const [toneName, setToneName] = useState("");
  const [toneInstruction, setToneInstruction] = useState("");
  const [connectName, setConnectName] = useState("");
  const [connectDescription, setConnectDescription] = useState("");
  const [editingTone, setEditingTone] = useState<EmailToneRecord>();
  const [metadataName, setMetadataName] = useState("");
  const [metadataDescription, setMetadataDescription] = useState("");
  const [metadataInstruction, setMetadataInstruction] = useState("");
  const [metadataFavorite, setMetadataFavorite] = useState(false);
  const [metadataCoverAsset, setMetadataCoverAsset] = useState<ImagePicker.ImagePickerAsset | null>();
  const permissions = getEmailPermissions();
  const metadataQuery = useQuery({
    queryKey: signalQueryKeys.overview(emailContext),
    queryFn: () => fetchEmailOverviewForContext(emailContext),
  });
  const metadataOverview = metadataQuery.data;
  const metadataAccounts = metadataOverview?.accounts ?? overview?.accounts ?? [];
  const selectedAccount = initialConnectorKey ? metadataAccounts.find(({ connectorKey }) => connectorKey === initialConnectorKey) ?? overview?.selectedAccount ?? undefined : undefined;
  const toneRecords = metadataOverview?.tones ?? [];
  const tonesLoading = metadataQuery.isPending;
  const toneError = metadataQuery.error ? messageFor(metadataQuery.error) : undefined;
  const draftsQuery = useQuery({
    queryKey: signalQueryKeys.drafts(emailContext, initialConnectorKey ?? "inactive"),
    queryFn: async () => (await fetchEmailOverviewForContext(emailContext, { connectorKey: initialConnectorKey })).drafts,
    enabled: Boolean(initialConnectorKey) && inboxTab === "drafts",
  });
  const draftDetailQuery = useQuery({
    queryKey: signalQueryKeys.draftDetail(emailContext, initialConnectorKey ?? "inactive", selectedInboxDraftKey ?? "inactive"),
    queryFn: async () => {
      const drafts = await queryClient.fetchQuery({ queryKey: signalQueryKeys.drafts(emailContext, initialConnectorKey!), queryFn: async () => (await fetchEmailOverviewForContext(emailContext, { connectorKey: initialConnectorKey })).drafts });
      const saved = drafts.find(({ key }) => key === selectedInboxDraftKey);
      if (!saved) throw new Error("The saved draft is no longer available.");
      return saved;
    },
    enabled: Boolean(initialConnectorKey && selectedInboxDraftKey),
  });
  const inboxDrafts = draftsQuery.data ?? overview?.drafts ?? [];
  const normalizedInboxSearch = query.trim();
  const activeDraftSearchResults = draftSearchResults && draftSearchResults.connectorKey === initialConnectorKey && draftSearchResults.query === normalizedInboxSearch ? draftSearchResults : undefined;
  const visibleInboxDrafts = normalizedInboxSearch && activeDraftSearchResults ? activeDraftSearchResults.drafts : inboxDrafts;
  const selectedInboxDraft = draftDetailQuery.data;
  const inputSheet = sheet === "connectForm" || sheet === "toneCreate" || sheet === "inboxEdit" || sheet === "toneEdit";
  useDelayedInputFocus(sheetOpen && inputSheet ? sheet : undefined, sheetInputRef, sheet !== "toneEdit" || permissions.canMutate);
  useDelayedInputFocus(readerSheetOpen && replyEditorOpen ? "replyEditor" : undefined, readerInputRef, permissions.canMutate);
  useDelayedInputFocus(editorTranslateTarget ? "editorTranslateLanguage" : undefined, editorTranslationInputRef, !editorTransformation);
  useDelayedInputFocus(newEmailRecipientsOpen ? "newEmailRecipients" : undefined, newEmailRecipientInputRef, !newEmailSending);
  useDelayedInputFocus(newEmailContentOpen ? "newEmailSubject" : undefined, newEmailSubjectInputRef, !newEmailSending);
  const newEmailOpen = newEmailRecipientsOpen || newEmailContentOpen || newEmailAlternativesOpen || newEmailReviewOpen || newEmailAttachmentsOpen;
  const newEmailAlternativeError = newEmailError ?? newEmailAlternatives.find(({ status }) => status === "failed")?.error;
  const newEmailPendingAlternativeCount = newEmailAlternatives.filter(({ status }) => status === "pending").length;
  const newEmailAlternativeSkeletonCount = newEmailAlternatives.length > 0 && newEmailPendingAlternativeCount === newEmailAlternatives.length ? 3 : Math.min(3, newEmailPendingAlternativeCount);
  const availableNewEmailTones = [...BUILT_IN_EMAIL_TONES.map((value) => ({ label: `${value[0]?.toUpperCase()}${value.slice(1)}`, value })), ...toneRecords.map((record) => ({ label: record.name, value: record.slug ?? record.key }))]
    .filter((option, index, options) => options.findIndex((candidate) => candidate.value.toLocaleLowerCase() === option.value.toLocaleLowerCase()) === index);
  const rootCardSize = Math.floor(((rootGridWidth || width - spacing.md * 2) - 20) / 3);
  const reviewAttachmentCardSize = Math.floor(((reviewAttachmentGridWidth || width - 40) - 18) / 4);
  const receivedAttachmentCardSize = Math.floor(((receivedAttachmentGridWidth || width - 40) - 18) / 4);
  const normalizedRootQuery = rootQuery.trim();
  const searchedAccounts = normalizedRootQuery && rootSearchResults?.tab === "inboxes" ? rootSearchResults.inboxes ?? [] : metadataAccounts;
  const searchedTones = normalizedRootQuery && rootSearchResults?.tab === "tones" ? rootSearchResults.tones ?? [] : toneRecords;
  const visibleAccounts = searchedAccounts.filter(({ isFavorite }) => !rootFavoritesOnly || isFavorite);
  // Keep the removed projection bound while Metro retires pre-change render closures.
  const visibleUnassignedDrafts: EmailDraft[] = [];
  const visibleTones = searchedTones.filter(({ isFavorite }) => !rootFavoritesOnly || isFavorite);
  const selectedMessage = selected?.messages.find(({ key }) => key === selectedMessageKey)
    ?? [...(selected?.messages ?? [])].sort((left, right) => right.sentAt.localeCompare(left.sentAt) || right.key.localeCompare(left.key))[0];
  const orderedThreadMessages = [...(selected?.messages ?? [])].sort((left, right) => left.sentAt.localeCompare(right.sentAt) || left.key.localeCompare(right.key));
  const generatedMessageKey = selectedMessage?.key;
  const translationQuery = useQuery({
    queryKey: signalQueryKeys.translations(emailContext, generatedMessageKey ?? "inactive"),
    queryFn: () => listEmailMessageTranslationsForContext(emailContext, generatedMessageKey!),
    enabled: readerSheetOpen && Boolean(generatedMessageKey) && (readerSheet === "translate" || readerSheet === "translationReader"),
    staleTime: 0,
  });
  const summaryQuery = useQuery({
    queryKey: signalQueryKeys.summaries(emailContext, generatedMessageKey ?? "inactive"),
    queryFn: () => listEmailMessageSummariesForContext(emailContext, generatedMessageKey!),
    enabled: readerSheetOpen && Boolean(generatedMessageKey) && (readerSheet === "summaryVersions" || readerSheet === "summaryReader"),
    staleTime: 0,
  });
  const translations = [...(translationQuery.data?.versions ?? [])].sort((left, right) => right.version - left.version || left.key.localeCompare(right.key));
  const summaries = [...(summaryQuery.data?.summaries ?? [])].sort((left, right) => right.version - left.version || left.key.localeCompare(right.key));
  const selectedTranslation = translations.find(({ key }) => key === selectedTranslationKey);
  const selectedSummary = summaries.find(({ key }) => key === selectedSummaryKey);
  const selectedReply = replyDrafts.find(({ key }) => key === selectedReplyKey);
  const resetGeneratedBoundary = useEffectEvent(() => { clearGeneratedReaderState(); setReaderSheetOpen(false); });
  const clearGeneratedViewerSelection = useEffectEvent(() => { setSelectedTranslationKeys([]); setSelectedSummaryKeys([]); setGeneratedDeleteConfirmation(undefined); });
  const reconcileGeneratedQueryState = useEffectEvent(() => {
    setSelectedTranslationKeys((current) => { const next = current.filter((key) => translations.some((version) => version.key === key)); return next.length === current.length ? current : next; });
    setSelectedSummaryKeys((current) => { const next = current.filter((key) => summaries.some((summary) => summary.key === key)); return next.length === current.length ? current : next; });
    if (selectedTranslationKey && selectedTranslation) pendingTranslationReaderKey.current = undefined;
    if (readerSheet === "translationReader" && selectedTranslationKey && !selectedTranslation) {
      if (pendingTranslationReaderKey.current !== selectedTranslationKey) { setSelectedTranslationKey(undefined); setReaderSheet("translate"); }
    }
    if (readerSheet === "summaryReader" && selectedSummaryKey && !selectedSummary) { setSelectedSummaryKey(undefined); setReaderSheet("summaryVersions"); }
  });
  useEffect(() => {
    selectedThreadKeyRef.current = selected?.thread.key;
    selectedMessageKeyRef.current = selectedMessage?.key;
  }, [selected?.thread.key, selectedMessage?.key]);
  selectedInboxesRef.current = selectedInboxes;
  useEffect(() => {
    setSelectedInboxes((current) => reconcileSelectedInboxSnapshots(current, metadataAccounts));
  }, [metadataOverview?.accounts, overview?.accounts]);
  useEffect(() => {
    const timer = setTimeout(resetGeneratedBoundary, 0);
    return () => clearTimeout(timer);
  }, [emailContext.organizationKey, emailContext.scopeKey, selected?.thread.key, selectedMessage?.key]);
  useEffect(() => {
    if (permissions.canMutate) return;
    const timer = setTimeout(clearGeneratedViewerSelection, 0);
    return () => clearTimeout(timer);
  }, [permissions.canMutate]);
  useEffect(() => {
    const timer = setTimeout(reconcileGeneratedQueryState, 0);
    return () => clearTimeout(timer);
  }, [readerSheet, selectedSummaryKey, selectedTranslationKey, summaryQuery.data, translationQuery.data]);

  function contextIsCurrent(context: typeof emailContext) {
    try {
      const current = getEmailContext();
      return current.organizationKey === context.organizationKey && current.scopeKey === context.scopeKey;
    } catch {
      return false;
    }
  }
  function setOverview(next: SetStateAction<EmailOverview | undefined>) {
    setInboxView((current) => ({
      ...current,
      overview: typeof next === "function" ? next(current.overview) : next,
    }));
  }
  function setPendingThreadFields(threadKeys: readonly string[], fields: { favorite?: boolean; read?: boolean; trash?: boolean }) {
    for (const threadKey of threadKeys) pendingThreadFields.current.set(threadKey, { ...pendingThreadFields.current.get(threadKey), ...fields });
  }
  function clearPendingThreadFields(threadKeys: readonly string[], fields: readonly ("favorite" | "read" | "trash")[]) {
    for (const threadKey of threadKeys) {
      const current = pendingThreadFields.current.get(threadKey);
      if (!current) continue;
      const next = { ...current };
      for (const field of fields) delete next[field];
      const repairFields = repairPendingThreadFields.current.get(threadKey);
      for (const field of fields) repairFields?.delete(field);
      if (repairFields?.size === 0) repairPendingThreadFields.current.delete(threadKey);
      if (Object.keys(next).length) pendingThreadFields.current.set(threadKey, next);
      else pendingThreadFields.current.delete(threadKey);
    }
  }
  function readerOperationIsCurrent(generation: number, context: typeof emailContext, threadKey: string, messageKey: string) {
    return generation === readerGeneration.current && contextIsCurrent(context) && selectedThreadKeyRef.current === threadKey && selectedMessageKeyRef.current === messageKey;
  }
  function discardDrafts(drafts: readonly EmailDraft[], preserveDraftKey?: string) {
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    for (const draftKey of new Set(drafts.map(({ key }) => key))) {
      if (draftKey === preserveDraftKey || draftCleanupInFlight.current.has(draftKey)) continue;
      draftCleanupInFlight.current.add(draftKey);
      void deleteEmailDraftForContext(context, draftKey, randomUUID()).then(() => {
        queryClient.setQueriesData<EmailOverview>({ queryKey: signalQueryKeys.overviews(context) }, (current) => current ? { ...current, drafts: current.drafts.filter(({ key }) => key !== draftKey) } : current);
        setDraftSearchResults((current) => current ? { ...current, drafts: current.drafts.filter(({ key }) => key !== draftKey) } : current);
      }).catch(() => undefined).finally(() => { draftCleanupInFlight.current.delete(draftKey); });
    }
  }
  function clearGeneratedReaderState(preserveDraftKey?: string) {
    discardDrafts(replyDrafts, preserveDraftKey);
    generatedDeleteGeneration.current += 1;
    pendingTranslationReaderKey.current = undefined;
    setReaderGenerating(undefined);
    longPressedGenerated.current = undefined;
    setSelectedTranslationKey(undefined);
    setSelectedSummaryKey(undefined);
    setSelectedTranslationKeys([]);
    setSelectedSummaryKeys([]);
    setGeneratedDeleteConfirmation(undefined);
    setGeneratedDeleteBusy(false);
    setReplyDrafts([]);
    setSelectedReplyKey(undefined);
    selectedReplyKeyRef.current = undefined;
    replyPreparation.current = undefined;
    replyFinalSend.current = undefined;
    setReplyBody("");
    setReplyAttachments([]);
    setReplyAttachmentLabels({});
    setReplyAttachmentImageUrls({});
    setReplyAttachmentsOpen(false);
    setReplyEditorOpen(false);
    setReplyModeOpen(false);
    setEmptyReply(false);
    setReplySending(false);
  }
  async function loadOverviewForContext(context: typeof emailContext, connectorKey: string, nextQuery: EmailOverviewQuery) {
    const queryKey = signalQueryKeys.overview(context, connectorKey, nextQuery);
    const value = await queryClient.fetchQuery({
      queryKey,
      queryFn: async () => {
        if (!nextQuery.search) return filterSignalTombstonedOverview(context, connectorKey, await fetchEmailOverviewForContext(context, { connectorKey, readState: nextQuery.readState, facets: [...nextQuery.facets], limit: 50 }));
        const [base, threads] = await Promise.all([
          fetchEmailOverviewForContext(context, { connectorKey, readState: nextQuery.readState, facets: [...nextQuery.facets], limit: 50 }),
          searchEmailMessagesForContext(context, connectorKey, nextQuery, false),
        ]);
        return filterSignalTombstonedOverview(context, connectorKey, { ...base, threads, nextCursor: null });
      },
      staleTime: 0,
    });
    if (!contextIsCurrent(context)) return value;
    settleRepairPendingThreads(value.threads);
    const visibleValue = { ...value, threads: overlayPendingSignalThreads(value.threads, pendingThreadFields.current) };
    queryClient.setQueryData(queryKey, visibleValue);
    return visibleValue;
  }
  function closeReaderFlowPreservingDraft(preserveDraftKey?: string) {
    if (trashBusy || replySending) return;
    readerGeneration.current += 1;
    readerTargetKey.current = undefined;
    clearGeneratedReaderState(preserveDraftKey);
    setReaderSheetOpen(false);
    setSheetOpen(false);
    setReaderLoading(false);
  }
  function closeReaderFlow() {
    closeReaderFlowPreservingDraft();
  }
  function clearSelectedThread(preserveTrashOperation = false) {
    detailGeneration.current += 1;
    receivedAttachmentsRequest.current += 1;
    readerGeneration.current += 1;
    if (!preserveTrashOperation) trashGeneration.current += 1;
    selectedThreadKeyRef.current = undefined;
    selectedMessageKeyRef.current = undefined;
    readerTargetKey.current = undefined;
    clearGeneratedReaderState();
    setSelected(undefined);
    setSelectedMessageKey(undefined);
    setReaderSheetOpen(false);
    setThreadSheetOpen(false);
    setAttachmentsOpen(false);
    setReceivedAttachments([]);
    setReceivedAttachmentsError(undefined);
    setReaderLoading(false);
    if (!preserveTrashOperation) setTrashBusy(false);
  }

  async function load(nextQuery = inboxQuery, options: { cursor?: string; commitQuery?: boolean; recordHistory?: boolean } = {}) {
    const continuation = Boolean(options.cursor);
    const request = continuation ? overviewRequest.current : ++overviewRequest.current;
    const loadIdentity = initialConnectorKey ? `${nextQuery.readState}:${nextQuery.facets.join(",")}:${nextQuery.search}` : "root";
    if (!continuation && overviewLoadQuery.current !== loadIdentity) {
      overviewLoadQuery.current = loadIdentity;
      overviewGeneration.current += 1;
    }
    const generation = overviewGeneration.current;
    const pageGeneration = continuation ? overviewPageGeneration.current : ++overviewPageGeneration.current;
    if (!continuation) loadingOverview.current = true;
    if (!options.cursor) {
      setLoadError(undefined);
      setRetryInboxQuery(undefined);
    }
    try {
      const queryKey = options.cursor
        ? signalQueryKeys.overviewPage(emailContext, initialConnectorKey, nextQuery, options.cursor!)
        : signalQueryKeys.overview(emailContext, initialConnectorKey, initialConnectorKey ? nextQuery : undefined);
      const value = await queryClient.fetchQuery({
        queryKey,
        queryFn: async () => {
          const input = initialConnectorKey ? {
            connectorKey: initialConnectorKey,
            readState: nextQuery.readState,
            facets: [...nextQuery.facets],
            cursor: options.cursor,
            limit: 50,
          } : {};
          const base = await fetchEmailOverviewForContext(emailContext, input);
          if (!initialConnectorKey) return base;
          if (!nextQuery.search || options.cursor) return filterSignalTombstonedOverview(emailContext, initialConnectorKey, base);
          const threads = await searchEmailMessagesForContext(emailContext, initialConnectorKey, nextQuery, options.recordHistory ?? false);
          return filterSignalTombstonedOverview(emailContext, initialConnectorKey, { ...base, threads, nextCursor: null });
        },
      });
      settleRepairPendingThreads(value.threads);
      const visibleValue = { ...value, threads: overlayPendingSignalThreads(value.threads, pendingThreadFields.current) };
      queryClient.setQueryData(queryKey, visibleValue);
      if (initialConnectorKey) queryClient.setQueryData(signalQueryKeys.drafts(emailContext, initialConnectorKey), visibleValue.drafts);
      const active = generation === overviewGeneration.current
        && (!continuation ? request === overviewRequest.current : pageGeneration === overviewPageGeneration.current);
      if (active) {
        if (options.commitQuery) committedInboxQuery.current = nextQuery;
        setRetryInboxQuery(undefined);
        setSelectedThreads((current) => current.map((selectedThread) => visibleValue.threads.find(({ key }) => key === selectedThread.key) ?? selectedThread));
        setInboxView((current) => {
          const nextOverview = options.cursor && current.overview ? {
            ...current.overview,
            ...visibleValue,
            threads: appendCursorItems(current.overview.threads, visibleValue.threads, ({ key }) => key),
            nextCursor: visibleValue.nextCursor === options.cursor ? null : visibleValue.nextCursor,
          } : visibleValue;
          return { overview: nextOverview, query: options.commitQuery ? nextQuery : current.query };
        });
      }
      return active ? "applied" as const : "superseded" as const;
    } catch (failure) {
      const active = generation === overviewGeneration.current
        && (!continuation ? request === overviewRequest.current : pageGeneration === overviewPageGeneration.current);
      if (active) {
        setLoadError(messageFor(failure));
        if (initialConnectorKey) setRetryInboxQuery(nextQuery);
        if (options.commitQuery) {
          requestedInboxQuery.current = committedInboxQuery.current;
          setInboxControlsQuery(committedInboxQuery.current);
          setInboxTab((current) => current === nextQuery.readState ? committedInboxQuery.current.readState : current);
          setQuery(committedInboxQuery.current.search);
        }
      }
      return active ? "failed" as const : "superseded" as const;
    } finally {
      if (!continuation && request === overviewRequest.current) {
        loadingOverview.current = false;
        setLoading(false);
      }
    }
  }
  const loadLatest = useEffectEvent(() => load());
  const notifyLatest = useEffectEvent((title: string) => notify(title));
  function operationIsCurrent(generation: number, context: typeof emailContext) {
    if (generation !== operationGeneration.current) return false;
    try {
      const current = getEmailContext();
      return current.organizationKey === context.organizationKey && current.scopeKey === context.scopeKey;
    } catch {
      return false;
    }
  }
  function invalidateNewEmailAlternatives(preserveDraftKey?: string) {
    discardDrafts(newEmailAlternatives.flatMap(({ draft }) => draft ? [draft] : []), preserveDraftKey);
    newEmailGeneration.current += 1;
    newEmailGenerationOwner.current = undefined;
    for (const request of newEmailToneRequests.current.values()) request.controller.abort();
    newEmailToneRequests.current.clear();
    newEmailToneRequestKeys.current.clear();
    setNewEmailAlternatives([]);
    setNewEmailSelectedDraft(undefined);
    setNewEmailAlternativesOpen(false);
    setNewEmailReviewOpen(false);
    setNewEmailError(undefined);
  }
  function invalidateSignalMetadata(context: typeof emailContext) {
    return queryClient.invalidateQueries({ queryKey: signalQueryKeys.overviews(context), refetchType: "none" });
  }
  function completeConnection(connector: EmailConnector) {
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = ++operationGeneration.current;
    clearSignalThreadTombstones(context, connector.connectorKey);
    const rootRefresh = queryClient.fetchQuery({
      queryKey: signalQueryKeys.overview(context),
      queryFn: () => fetchEmailOverviewForContext(context),
      staleTime: 0,
    });
    void Promise.allSettled([rootRefresh]).then(([refreshResult]) => {
      if (!operationIsCurrent(generation, context)) return;
      if (refreshResult.status === "rejected")
        notify("Inbox connected. The inbox list will refresh automatically.");
    });
    if (operationIsCurrent(generation, context)) router.push({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey: connector.connectorKey, signalReturn: "root" } });
  }
  const completeConnectionFromEffect = useEffectEvent((connector: EmailConnector) => completeConnection(connector));
  const clearSelectedThreadFromEffect = useEffectEvent(() => clearSelectedThread());
  const refreshFromInboxEvent = useEffectEvent(async () => {
    await Promise.all([
      queryClient.cancelQueries({ queryKey: signalQueryKeys.overviews(emailContext) }),
      queryClient.cancelQueries({ queryKey: signalQueryKeys.details(emailContext) }),
      queryClient.cancelQueries({ queryKey: signalQueryKeys.generated(emailContext) }),
      ...(initialConnectorKey ? [queryClient.cancelQueries({ queryKey: signalQueryKeys.drafts(emailContext, initialConnectorKey), exact: true })] : []),
    ]);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: signalQueryKeys.overviews(emailContext), refetchType: "none" }),
      queryClient.invalidateQueries({ queryKey: signalQueryKeys.details(emailContext), refetchType: "none" }),
      queryClient.invalidateQueries({ queryKey: signalQueryKeys.generated(emailContext), refetchType: "none" }),
      queryClient.invalidateQueries({ queryKey: signalQueryKeys.draftDetails(emailContext), refetchType: "none" }),
      ...(initialConnectorKey ? [queryClient.invalidateQueries({ queryKey: signalQueryKeys.drafts(emailContext, initialConnectorKey), exact: true, refetchType: "none" })] : []),
    ]);
    const refreshQuery = requestedInboxQuery.current;
    void load(refreshQuery, { commitQuery: refreshQuery !== committedInboxQuery.current });
    if (initialConnectorKey) void queryClient.fetchQuery({
      queryKey: signalQueryKeys.overview(emailContext),
      queryFn: () => fetchEmailOverviewForContext(emailContext),
    });
    void queryClient.refetchQueries({ queryKey: signalQueryKeys.generated(emailContext), type: "active" });
    void queryClient.refetchQueries({ queryKey: signalQueryKeys.draftDetails(emailContext), type: "active" });
    if (selected) {
      const threadKey = selected.thread.key;
      const generation = ++detailGeneration.current;
      void queryClient.fetchQuery({
        queryKey: signalQueryKeys.detail(emailContext, initialConnectorKey, threadKey),
        queryFn: () => fetchEmailThreadForContext(emailContext, threadKey),
      }).then((detail) => {
        if (generation === detailGeneration.current) setSelected((current) => current?.thread.key === threadKey ? { ...detail, thread: overlayPendingSignalThread(detail.thread, pendingThreadFields.current) } : current);
      }).catch(() => undefined);
    }
    const refreshThreadKeys = [...new Set([...selectedThreads.map(({ key }) => key), ...repairPendingThreadFields.current.keys()])];
    if (initialConnectorKey && refreshThreadKeys.length) {
      const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
      const connectorKey = initialConnectorKey;
      const generation = ++selectionGeneration.current;
      void Promise.allSettled(refreshThreadKeys.map((key) => fetchEmailThreadForContext(context, key))).then((results) => {
        if (generation !== selectionGeneration.current || !contextIsCurrent(context) || initialConnectorKey !== connectorKey) return;
        const updates = results.flatMap((result) => result.status === "fulfilled" ? [result.value.thread] : []);
        if (updates.length) applyAuthoritativeThreads(context, connectorKey, updates);
      });
    }
  });

  useEffect(() => {
    overviewRequest.current += 1;
    overviewGeneration.current += 1;
    overviewPageGeneration.current += 1;
    overviewLoadQuery.current = undefined;
    loadingOverview.current = false;
    loadingMore.current = false;
    formTransitionGeneration.current += 1;
    pendingThreadFields.current.clear();
    repairPendingThreadFields.current.clear();
    selectionGeneration.current += 1;
    void Promise.resolve().then(() => {
      committedInboxQuery.current = defaultInboxQuery();
      requestedInboxQuery.current = committedInboxQuery.current;
      setInboxView({ query: committedInboxQuery.current });
      setInboxControlsQuery(committedInboxQuery.current);
      if (!initialThreadKey) clearSelectedThreadFromEffect();
      setQuery("");
      setLoadError(undefined);
      setLoading(true);
      setOpeningThreadKey(undefined);
      setLoadingMoreThreads(false);
      setSelectedThreads([]);
      setSelectedInboxes([]);
      setRootDisconnectOpen(false);
      setSelectionNotice(undefined);
      setTrashGroups([]);
      setTrashRootError(undefined);
      void loadLatest();
    });
  }, [emailContext.organizationKey, emailContext.scopeKey, initialConnectorKey]);
  useEffect(() => {
    const generation = ++operationGeneration.current;
    const activeReadOperations = readInFlight.current;
    const toneRequests = newEmailToneRequests.current;
    const toneRequestKeys = newEmailToneRequestKeys.current;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    invalidateNewEmailAlternatives();
    sendGeneration.current = undefined;
    newEmailSendInFlight.current = false;
    const requests = metadataRequests.current;
    requests.clear();
    toneCreateInFlight.current = false;
    metadataInFlight.current = false;
    deleteToneInFlight.current = false;
    readInFlight.current.clear();
    bulkInFlight.current = false;
    trashInFlight.current = false;
    trashClearInFlight.current = false;
    metadataFormContext.current = undefined;
    void Promise.resolve().then(() => {
      if (generation !== operationGeneration.current) return;
      setAssistantInput("");
      setAssistantResponse(undefined);
      setAssistantError(undefined);
      setAssistantBusy(false);
      setEditingTone(undefined);
      setBusy(undefined);
      setTrashBusy(false);
      setReadBusy(false);
      setBulkBusy(false);
      setBulkActionsLoading(false);
      setTrashRootLoading(false);
      setTrashClearBusy(false);
      setSheet("plus");
      setSheetOpen(false);
      setReplyContextsOpen(false);
      setSheetError(undefined);
    });
    return () => {
      operationGeneration.current += 1;
      assistantGeneration.current += 1;
      trashGeneration.current += 1;
      bulkGeneration.current += 1;
      selectionGeneration.current += 1;
      trashRootGeneration.current += 1;
      favoriteGeneration.current += 1;
      favoriteInFlight.current = false;
      newEmailGeneration.current += 1;
      newEmailGenerationOwner.current = undefined;
      for (const request of toneRequests.values()) request.controller.abort();
      toneRequests.clear();
      toneRequestKeys.clear();
      sendGeneration.current = undefined;
      newEmailSendInFlight.current = false;
      requests.clear();
      toneCreateInFlight.current = false;
      metadataInFlight.current = false;
      deleteToneInFlight.current = false;
      activeReadOperations.clear();
      bulkInFlight.current = false;
      trashInFlight.current = false;
      trashClearInFlight.current = false;
      metadataFormContext.current = undefined;
      void Promise.all([
        queryClient.cancelQueries({ queryKey: signalQueryKeys.overviews(context) }),
        queryClient.cancelQueries({ queryKey: signalQueryKeys.details(context) }),
      ]);
      clearSignalThreadTombstones(context);
    };
  }, [emailContext.organizationKey, emailContext.scopeKey, queryClient]);
  useEffect(() => () => {
    if (rootSearchFocusTimer.current) clearTimeout(rootSearchFocusTimer.current);
    rootSearchRequest.current?.abort();
  }, []);
  useEffect(() => {
    const query = rootQuery.trim();
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    rootSearchRequest.current?.abort();
    if (!query) {
      setRootSearchResults(undefined);
      setRootSearching(false);
      setRootSearchError(undefined);
      return;
    }
    const controller = new AbortController();
    rootSearchRequest.current = controller;
    setRootSearchResults(undefined);
    setRootSearchError(undefined);
    const timeout = setTimeout(() => {
      setRootSearching(true);
      const request = rootTab === "inboxes"
        ? searchEmailInboxesForContext(context, query, false, controller.signal).then(({ inboxes }) => { if (!controller.signal.aborted) setRootSearchResults({ tab: rootTab, inboxes }); })
        : searchEmailTonesForContext(context, query, false, controller.signal).then(({ tones }) => { if (!controller.signal.aborted) setRootSearchResults({ tab: rootTab, tones }); });
      void request.catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setRootSearchResults(rootTab === "inboxes" ? { tab: rootTab, inboxes: [] } : { tab: rootTab, tones: [] });
          setRootSearchError(messageFor(failure));
        }
      }).finally(() => {
        if (!controller.signal.aborted) setRootSearching(false);
      });
    }, 300);
    const historyTimeout = setTimeout(() => {
      const request = rootTab === "inboxes"
        ? searchEmailInboxesForContext(context, query, true, controller.signal)
        : searchEmailTonesForContext(context, query, true, controller.signal);
      void request.catch(() => undefined);
    }, 800);
    return () => { clearTimeout(timeout); clearTimeout(historyTimeout); controller.abort(); };
  }, [emailContext.organizationKey, emailContext.scopeKey, rootQuery, rootTab]);
  useEffect(() => {
    if (!initialConnectorKey) return;
    const next = query.trim();
    if (!next) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const controller = new AbortController();
    const historyTimeout = setTimeout(() => {
      if (inboxTab === "drafts") void searchEmailDraftsForContext(context, initialConnectorKey, next, true, controller.signal).catch(() => undefined);
      else {
        const nextQuery = normalizeEmailOverviewQuery({ ...requestedInboxQuery.current, search: next });
        void searchEmailMessagesForContext(context, initialConnectorKey, nextQuery, true, controller.signal).catch(() => undefined);
      }
    }, 800);
    return () => { clearTimeout(historyTimeout); controller.abort(); };
  }, [emailContext.organizationKey, emailContext.scopeKey, initialConnectorKey, inboxTab, query]);
  useEffect(() => {
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    return navigation.addListener("focus", () => {
      void queryClient.cancelQueries({ queryKey: signalQueryKeys.overview(context), exact: true }).then(() => {
        void queryClient.invalidateQueries({ queryKey: signalQueryKeys.overview(context), exact: true, refetchType: "active" });
      });
    });
  }, [emailContext.organizationKey, emailContext.scopeKey, navigation, queryClient]);
  useEffect(() => subscribeAppEvent((event) => {
    if (event.type === "inbox.changed" || event.type === "event-stream.connected") refreshFromInboxEvent();
  }), []);
  useEffect(() => {
    const code =
      typeof params.email_connection_code === "string"
        ? params.email_connection_code
        : undefined;
    if (!code || processedConnectionCode.current === code) return;
    processedConnectionCode.current = code;
    setBusy("connect");
    void exchangeEmailConnection(code)
      .then(
        (connector) => completeConnectionFromEffect(connector),
        (failure: unknown) => notifyLatest(messageFor(failure)),
      )
      .finally(() => setBusy(undefined));
  }, [params.email_connection_code]);
  useEffect(() => {
    if (params.email_connection_error)
      notifyLatest("Email connection was not completed.");
  }, [params.email_connection_error]);
  function resetNewEmail(preserveDraftKey?: string) {
    invalidateNewEmailAlternatives(preserveDraftKey);
    newEmailPreparation.current = undefined;
    newEmailFinalSend.current = undefined;
    newEmailSendInFlight.current = false;
    sendGeneration.current = undefined;
    setNewEmailRecipientsOpen(false);
    setNewEmailContentOpen(false);
    setNewEmailAttachmentsOpen(false);
    setNewEmailRecipientInput("");
    setNewEmailRecipients([]);
    setNewEmailRecipientError(undefined);
    setNewEmailSubject("");
    setNewEmailBody("");
    setNewEmailReviewSubject("");
    setNewEmailReviewBody("");
    setNewEmailAttachments([]);
    setNewEmailAttachmentLabels({});
    setNewEmailAttachmentImageUrls({});
    setNewEmailSkipped(false);
    setNewEmailSending(false);
    setNewEmailError(undefined);
  }
  function returnToSignalRoot() {
    clearSelectedThread();
    allowNavigation.current = true;
    if (navigatedFromRoot && router.canGoBack()) router.back();
    else router.replace({ pathname: "/capability/[slug]", params: { slug: "signal" } });
  }
  function openNewEmail() {
    if (trashBusy || sendGeneration.current !== undefined || busy === "send") return;
    resetNewEmail();
    setNewEmailRecipientsOpen(true);
  }
  function requestExit(destination: "inbox" | CapabilitySlug) {
    if (sendGeneration.current !== undefined || busy === "send") return false;
    if (newEmailOpen) resetNewEmail();
    if (sheet === "connectForm" || sheet === "toneCreate" || sheet === "inboxEdit" || sheet === "toneEdit") closeForm();
    return true;
  }

  async function transitionToForm(nextSheet: FormSheet, prepare: () => void) {
    const generation = ++formTransitionGeneration.current;
    if (sheetOpen) {
      setSheetOpen(false);
      await wait(SHEET_TRANSITION_DELAY_MS);
    }
    if (generation !== formTransitionGeneration.current) return;
    prepare();
    setSheetError(undefined);
    setSheet(nextSheet);
    setSheetOpen(true);
  }
  function openToneCreate() {
    void transitionToForm("toneCreate", () => {
      setToneName("");
      setToneInstruction("");
      metadataFormContext.current = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    });
  }
  function openConnectForm() {
    void transitionToForm("connectForm", () => {
      setConnectName("");
      setConnectDescription("");
    });
  }
  function openReplyContexts() {
    setSheetOpen(false);
    setReplyContextsOpen(true);
  }
  async function openSearchHistory() {
    const generation = ++historyGeneration.current;
    const key = userSearchHistoryQueryKey(historyContext.userKey);
    const cached = queryClient.getQueryData<ContentSearchHistoryItem[]>(key);
    const invalidated = queryClient.getQueryState(key)?.isInvalidated === true;
    setSearchHistory(cached ?? []);
    setSearchHistoryError(undefined);
    setSearchHistoryLoading(!cached || invalidated);
    setRemovingHistoryQuery(undefined);
    setSheetOpen(false);
    await wait(180);
    if (generation !== historyGeneration.current) return;
    setSheet("searchHistory");
    setSheetOpen(true);
    if (cached && !invalidated) return;
    try {
      const history = await getUserSearchHistory(queryClient, historyContext);
      if (generation === historyGeneration.current) setSearchHistory(history);
    } catch (cause) {
      if (generation === historyGeneration.current) setSearchHistoryError(cause instanceof Error ? cause.message : "Search history could not be loaded.");
    } finally {
      if (generation === historyGeneration.current) setSearchHistoryLoading(false);
    }
  }
  function closeSearchHistory() {
    historyGeneration.current += 1;
    setSheetOpen(false);
  }
  function applySearchHistory(item: ContentSearchHistoryItem) {
    const promoted = promoteCachedUserSearchHistory(queryClient, historyContext, item);
    setSearchHistory((current) => [promoted, ...current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery)]);
    closeSearchHistory();
    if (initialConnectorKey) void search(item.query, false);
    else setRootQuery(item.query);
  }
  async function removeSearchHistory(item: ContentSearchHistoryItem) {
    const previous = removeCachedUserSearchHistory(queryClient, historyContext, item.normalizedQuery);
    setRemovingHistoryQuery(item.normalizedQuery);
    setSearchHistory((current) => current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery));
    try {
      await deleteContentSearchHistory(item.normalizedQuery);
    } catch (cause) {
      queryClient.setQueryData(userSearchHistoryQueryKey(historyContext.userKey), previous);
      setSearchHistory(previous);
      setSearchHistoryError(cause instanceof Error ? cause.message : "Search history could not be updated.");
    } finally {
      setRemovingHistoryQuery(undefined);
    }
  }
  function openInboxEdit() {
    const inbox = selectedAccount;
    if (!inbox) return;
    void transitionToForm("inboxEdit", () => {
      setMetadataName(inbox.name);
      setMetadataDescription(inbox.description ?? "");
      setMetadataInstruction("");
      setMetadataFavorite(inbox.isFavorite);
      setMetadataCoverAsset(undefined);
      metadataFormContext.current = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    });
  }
  function openToneEdit(record: EmailToneRecord) {
    setEditingTone(record);
    setMetadataName(record.name);
    setMetadataInstruction(record.instruction);
    setMetadataFavorite(record.isFavorite);
    setMetadataCoverAsset(undefined);
    metadataFormContext.current = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    setSheetError(undefined);
    setSheet("toneEdit");
    setSheetOpen(true);
  }
  function closeForm() {
    setEditingTone(undefined);
    setSheetOpen(false);
  }
  function requestFormClose() {
    if (busy) return;
    closeForm();
  }
  async function chooseMetadataCover() {
    setSheetError(undefined);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: false, quality: 1 });
      if (!result.canceled && result.assets[0]) setMetadataCoverAsset(result.assets[0]);
    } catch (failure) {
      setSheetError(messageFor(failure));
    }
  }
  function replaceInbox(inbox: EmailConnector, context = emailContext) {
    setOverview((current) => current ? {
      ...current,
      accounts: current.accounts.map((candidate) => candidate.connectorKey === inbox.connectorKey ? inbox : candidate),
      selectedAccount: current.selectedAccount?.connectorKey === inbox.connectorKey ? inbox : current.selectedAccount,
    } : current);
    patchSignalInbox(queryClient, context, inbox);
  }
  function replaceInboxIfCurrent(expected: EmailConnector, inbox: EmailConnector, context: typeof emailContext) {
    setOverview((current) => current ? {
      ...current,
      accounts: current.accounts.map((candidate) => candidate === expected ? inbox : candidate),
      selectedAccount: current.selectedAccount === expected ? inbox : current.selectedAccount,
    } : current);
    queryClient.setQueriesData<EmailOverview>({ queryKey: signalQueryKeys.overviews(context) }, (current) => current ? {
      ...current,
      accounts: current.accounts.map((candidate) => candidate === expected ? inbox : candidate),
      selectedAccount: current.selectedAccount === expected ? inbox : current.selectedAccount,
    } : current);
  }
  function replaceTone(record: EmailToneRecord, context = emailContext) {
    upsertSignalTone(queryClient, context, record);
  }
  function replaceToneIfCurrent(expected: EmailToneRecord, record: EmailToneRecord, context: typeof emailContext) {
    queryClient.setQueryData<EmailOverview>(signalQueryKeys.overview(context), (current) => current ? { ...current, tones: current.tones.map((candidate) => candidate === expected ? record : candidate) } : current);
  }
  async function connect() {
    if (busy || !permissions.canManageConnector) return;
    const name = connectName.trim();
    const description = connectDescription.trim();
    if (!name) return;
    setBusy("connect");
    setSheetError(undefined);
    let connector: EmailConnector | null = null;
    try {
      connector = await launchEmailConnection({ name, ...(description ? { description } : {}) });
    } catch (failure) {
      setSheetError(messageFor(failure));
    } finally {
      setBusy(undefined);
    }
    if (connector) {
      setSheetOpen(false);
      completeConnection(connector);
    }
  }
  async function createTone() {
    if (toneCreateInFlight.current) return;
    const name = toneName.trim();
    const instruction = toneInstruction.trim();
    if (!name || !instruction) return;
    const context = metadataFormContext.current;
    if (!context || context.organizationKey !== emailContext.organizationKey || context.scopeKey !== emailContext.scopeKey) return;
    const generation = operationGeneration.current;
    const requestKey = randomUUID();
    toneCreateInFlight.current = true;
    setBusy("toneCreate");
    setSheetError(undefined);
    const temporaryKey = `optimistic-tone-${Date.now()}`;
    const timestamp = new Date().toISOString();
    const optimistic: EmailToneRecord = { key: temporaryKey, name, instruction, isFavorite: false, createdAt: timestamp, updatedAt: timestamp };
    replaceTone(optimistic, context);
    setSheetOpen(false);
    notify("Email tone created");
    try {
      if (!operationIsCurrent(generation, context)) {
        void invalidateSignalMetadata(context);
        return;
      }
      const created = await createEmailToneForContext(context, { name, instruction }, requestKey);
      if (!operationIsCurrent(generation, context)) {
        void invalidateSignalMetadata(context);
        return;
      }
      replaceToneIfCurrent(optimistic, created, context);
      void invalidateSignalMetadata(context);
    } catch (failure) {
      if (!operationIsCurrent(generation, context)) {
        void invalidateSignalMetadata(context);
        return;
      }
      queryClient.setQueryData<EmailOverview>(signalQueryKeys.overview(context), (current) => current ? { ...current, tones: current.tones.filter((candidate) => candidate !== optimistic) } : current);
      notify(messageFor(failure));
      void invalidateSignalMetadata(context);
    } finally {
      if (generation === operationGeneration.current) {
        toneCreateInFlight.current = false;
        setBusy(undefined);
      }
    }
  }
  async function saveMetadata() {
    if (metadataInFlight.current) return;
    const toneRecord = sheet === "toneEdit" ? editingTone : undefined;
    const inbox = sheet === "inboxEdit" ? selectedAccount : undefined;
    const name = metadataName.trim();
    const writingInstruction = metadataInstruction.trim();
    if (!name || toneRecord && !writingInstruction || !toneRecord && !inbox) return;
    const context = metadataFormContext.current;
    if (!context || context.organizationKey !== emailContext.organizationKey || context.scopeKey !== emailContext.scopeKey) return;
    const generation = operationGeneration.current;
    const requestKey = randomUUID();
    metadataInFlight.current = true;
    setBusy("metadata");
    setSheetError(undefined);
    const targetKey = `${context.organizationKey}:${context.scopeKey}:${toneRecord ? `tone:${toneRecord.key}` : `inbox:${inbox!.connectorKey}`}`;
    const request = (metadataRequests.current.get(targetKey) ?? 0) + 1;
    metadataRequests.current.set(targetKey, request);
    const coverChange = inbox ? metadataCoverAsset : undefined;
    const description = metadataDescription.trim() || undefined;
    const optimisticTone = toneRecord ? { ...toneRecord, name, instruction: writingInstruction, isFavorite: metadataFavorite } : undefined;
    const optimisticInbox = inbox ? { ...inbox, name, description, isFavorite: metadataFavorite, ...(coverChange !== undefined ? { coverUrl: coverChange?.uri } : {}) } : undefined;
    if (optimisticTone) replaceTone(optimisticTone, context);
    else replaceInbox(optimisticInbox!, context);
    setSheetOpen(false);
    notify(toneRecord ? "Email tone saved" : "Inbox saved");
    try {
      let coverImageKey: string | null | undefined;
      if (coverChange === null) coverImageKey = null;
      if (coverChange) {
        if (!operationIsCurrent(generation, context)) {
          void invalidateSignalMetadata(context);
          return;
        }
        const normalized = await normalizeCapturedPng(coverChange, { maxSide: 2400, compress: 0.88 });
        if (!operationIsCurrent(generation, context)) {
          void invalidateSignalMetadata(context);
          return;
        }
        const upload = await uploadGalleryImages([{ clientKey: `${Date.now()}-${targetKey}`, filename: `signal-cover-${Date.now()}.png`, uri: normalized.uri, sizeBytes: normalized.sizeBytes, processingMode: "cover" }]);
        const job = upload.jobs[0];
        if (!job) throw new Error("The cover upload could not be started.");
        let status = job.status;
        for (let attempt = 0; status !== "completed" && status !== "failed" && attempt < 40; attempt += 1) {
          await wait(3_000);
          if (!operationIsCurrent(generation, context)) {
            void invalidateSignalMetadata(context);
            return;
          }
          status = (await fetchGalleryUploadStatus([job.key])).jobs[0]?.status ?? status;
        }
        if (status !== "completed") throw new Error("The cover could not be processed.");
        if (metadataRequests.current.get(targetKey) !== request || !operationIsCurrent(generation, context)) {
          void invalidateSignalMetadata(context);
          return;
        }
        coverImageKey = job.imageKey;
      }
      if (metadataRequests.current.get(targetKey) !== request || !operationIsCurrent(generation, context)) {
        void invalidateSignalMetadata(context);
        return;
      }
      const updated = toneRecord
        ? await updateEmailToneForContext(context, { toneKey: toneRecord.key, name, instruction: writingInstruction, isFavorite: metadataFavorite }, requestKey)
        : await updateEmailInboxForContext(context, { connectorKey: inbox!.connectorKey, name, description: description ?? null, isFavorite: metadataFavorite, ...(coverChange !== undefined ? { coverImageKey } : {}) }, requestKey);
      if (metadataRequests.current.get(targetKey) !== request || !operationIsCurrent(generation, context)) {
        void invalidateSignalMetadata(context);
        return;
      }
      if (toneRecord) replaceToneIfCurrent(optimisticTone!, updated as EmailToneRecord, context);
      else replaceInboxIfCurrent(optimisticInbox!, updated as EmailConnector, context);
      void invalidateSignalMetadata(context);
    } catch (failure) {
      if (metadataRequests.current.get(targetKey) !== request || !operationIsCurrent(generation, context)) {
        void invalidateSignalMetadata(context);
        return;
      }
      if (toneRecord) replaceToneIfCurrent(optimisticTone!, toneRecord, context);
      else replaceInboxIfCurrent(optimisticInbox!, inbox!, context);
      notify(messageFor(failure));
      void invalidateSignalMetadata(context);
    } finally {
      if (generation === operationGeneration.current) {
        metadataInFlight.current = false;
        setBusy(undefined);
      }
    }
  }
  async function deleteTone() {
    const record = editingTone;
    if (!record || record.slug || deleteToneInFlight.current) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = operationGeneration.current;
    const requestKey = randomUUID();
    deleteToneInFlight.current = true;
    queryClient.setQueryData<EmailOverview>(signalQueryKeys.overview(context), (current) => current ? { ...current, tones: current.tones.filter(({ key }) => key !== record.key) } : current);
    setSheetOpen(false);
    setEditingTone(undefined);
    notify("Email tone deleted");
    try {
      const result = await deleteEmailToneForContext(context, record.key, requestKey);
      if (!operationIsCurrent(generation, context) || result.deletedKey !== record.key) return;
      void invalidateSignalMetadata(context);
    } catch (failure) {
      if (operationIsCurrent(generation, context)) {
        queryClient.setQueryData<EmailOverview>(signalQueryKeys.overview(context), (current) => current ? { ...current, tones: restoreSignalToneIfStillRemoved(current.tones, record) ?? current.tones } : current);
        notify(messageFor(failure));
      }
    } finally {
      if (generation === operationGeneration.current) deleteToneInFlight.current = false;
    }
  }
  async function changeInboxQuery(next: EmailOverviewQuery) {
    requestedInboxQuery.current = next;
    setInboxControlsQuery(next);
    const result = await load(next, { commitQuery: true });
    if (result === "applied") clearSelectedThread();
    return result;
  }
  function chooseReadState(readState: EmailReadState) {
    setInboxTab(readState);
    if (readState === requestedInboxQuery.current.readState) return;
    void changeInboxQuery(setEmailOverviewReadState(requestedInboxQuery.current, readState));
  }
  function openInboxDraft(saved: EmailDraft) {
    if (!initialConnectorKey) return;
    queryClient.setQueryData(signalQueryKeys.draftDetail(emailContext, initialConnectorKey, saved.key), saved);
    setDraftBody(saved.finalContent ?? saved.generatedContent);
    setSelectedInboxDraftKey(saved.key);
  }
  async function sendInboxDraft() {
    const saved = selectedInboxDraft;
    const connectorKey = initialConnectorKey;
    const finalContent = draftBody.trim();
    if (!saved || !connectorKey || draftSending || !finalContent) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    setDraftSending(true);
    try {
      if (finalContent !== (saved.finalContent ?? saved.generatedContent).trim()) {
        const updated = await updateEmailDraftForContext(context, saved.key, finalContent, randomUUID());
        queryClient.setQueryData(signalQueryKeys.draftDetail(context, connectorKey, saved.key), updated);
        queryClient.setQueryData<EmailDraft[]>(signalQueryKeys.drafts(context, connectorKey), (current) => current?.map((draft) => draft.key === updated.key ? updated : draft));
        queryClient.setQueriesData<EmailOverview>({ queryKey: signalQueryKeys.overviews(context) }, (current) => current ? { ...current, drafts: current.drafts.map((draft) => draft.key === updated.key ? updated : draft) } : current);
        setOverview((current) => current ? { ...current, drafts: current.drafts.map((draft) => draft.key === updated.key ? updated : draft) } : current);
      }
      const replyMode = saved.variant === "reply" ? saved.replyMode : undefined;
      const sendFingerprint = JSON.stringify([saved.key, connectorKey, replyMode, finalContent, saved.attachments ?? []]);
      savedDraftFinalSend.current = retainEmailRequestKey(savedDraftFinalSend.current, sendFingerprint, randomUUID);
      await sendEmailDraftForContext(context, saved.key, savedDraftFinalSend.current.requestKey, replyMode);
      savedDraftFinalSend.current = undefined;
      queryClient.setQueryData<EmailDraft[]>(signalQueryKeys.drafts(context, connectorKey), (current) => current?.filter(({ key }) => key !== saved.key));
      queryClient.removeQueries({ queryKey: signalQueryKeys.draftDetail(context, connectorKey, saved.key), exact: true });
      queryClient.setQueriesData<EmailOverview>({ queryKey: signalQueryKeys.overviews(context) }, (current) => current ? { ...current, drafts: current.drafts.filter(({ key }) => key !== saved.key) } : current);
      setOverview((current) => current ? { ...current, drafts: current.drafts.filter(({ key }) => key !== saved.key) } : current);
      setDraftSearchResults((current) => current ? { ...current, drafts: current.drafts.filter(({ key }) => key !== saved.key) } : current);
      setSelectedInboxDraftKey(undefined);
      setDraftBody("");
      notify("Email sent");
    } catch (failure) {
      notify(messageFor(failure));
    } finally {
      setDraftSending(false);
    }
  }
  function toggleFacet(facet: EmailFacet) {
    setSheetOpen(false);
    void changeInboxQuery(toggleEmailOverviewFacet(requestedInboxQuery.current, facet));
  }
  async function search(nextQuery = query, recordHistory = true, signal?: AbortSignal) {
    const next = nextQuery.trim();
    setQuery(next);
    if (inboxTab === "drafts") {
      if (!next || !initialConnectorKey) {
        setDraftSearchResults(undefined);
        setDraftSearchError(undefined);
        return;
      }
      setDraftSearching(true);
      setDraftSearchError(undefined);
      try {
        const drafts = await searchEmailDraftsForContext(emailContext, initialConnectorKey, next, recordHistory, signal);
        if (!signal?.aborted) setDraftSearchResults({ connectorKey: initialConnectorKey, query: next, drafts });
      } catch (failure) {
        if (!signal?.aborted) setDraftSearchError(messageFor(failure));
      } finally {
        if (!signal?.aborted) setDraftSearching(false);
      }
      return;
    }
    requestedInboxQuery.current = normalizeEmailOverviewQuery({ ...requestedInboxQuery.current, search: next });
    setInboxControlsQuery(requestedInboxQuery.current);
    const result = await load(requestedInboxQuery.current, { commitQuery: true, recordHistory: Boolean(next) && recordHistory });
    if (result === "applied") clearSelectedThread();
  }
  const searchLatest = useEffectEvent(search);
  useEffect(() => {
    if (!initialConnectorKey) return;
    const next = query.trim();
    if (!next) {
      if (inboxTab === "drafts") {
        setDraftSearchResults(undefined);
        setDraftSearching(false);
        setDraftSearchError(undefined);
      } else if (requestedInboxQuery.current.search) void searchLatest("", false);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => { void searchLatest(next, false, controller.signal); }, 300);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [emailContext.organizationKey, emailContext.scopeKey, initialConnectorKey, inboxTab, query]);
  async function loadMore() {
    const cursor = overview?.nextCursor;
    if (!cursor || loadingMore.current || loadingOverview.current || loading || loadError) return;
    loadingMore.current = true;
    setLoadingMoreThreads(true);
    try {
      await load(inboxQuery, { cursor });
    } finally {
      loadingMore.current = false;
      setLoadingMoreThreads(false);
    }
  }
  async function openThread(thread: EmailThread) {
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const connectorKey = initialConnectorKey;
    if (!connectorKey) return;
    const generation = ++detailGeneration.current;
    const detailKey = signalQueryKeys.detail(context, connectorKey, thread.key);
    const cached = queryClient.getQueryData<Awaited<ReturnType<typeof fetchEmailThreadForContext>>>(detailKey);
    setSelected(cached ?? { thread, messages: [] });
    setSelectedMessageKey(cached ? [...cached.messages].sort((left, right) => right.sentAt.localeCompare(left.sentAt) || right.key.localeCompare(left.key))[0]?.key : undefined);
    setOpeningThreadKey(thread.key);
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: detailKey,
        queryFn: () => fetchEmailThreadForContext(context, thread.key),
      });
      if (generation !== detailGeneration.current || !contextIsCurrent(context) || initialConnectorKey !== connectorKey) return;
      if (isSignalThreadTombstoned(context, connectorKey, detail.thread.key)) return;
      setSelected(detail);
      applyAuthoritativeThreads(context, connectorKey, [detail.thread]);
      setSelectedMessageKey([...detail.messages].sort((left, right) => right.sentAt.localeCompare(left.sentAt) || right.key.localeCompare(left.key))[0]?.key);
    } catch {
      if (generation === detailGeneration.current && contextIsCurrent(context) && initialConnectorKey === connectorKey) {
        if (!cached) setSelected((current) => current?.thread.key === thread.key ? undefined : current);
      }
    } finally {
      if (generation === detailGeneration.current) setOpeningThreadKey(undefined);
    }
  }
  async function loadMoreThreadMessages() {
    const cursor = selected?.nextCursor;
    const threadKey = selected?.thread.key;
    if (!cursor || !threadKey || loadingMoreThread.current) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = detailGeneration.current;
    loadingMoreThread.current = true;
    setThreadPageLoading(true);
    try {
      const page = await fetchEmailThreadForContext(context, threadKey, cursor);
      if (generation !== detailGeneration.current || selectedThreadKeyRef.current !== threadKey || !contextIsCurrent(context)) return;
      setSelected((current) => current?.thread.key === threadKey ? {
        ...current,
        thread: page.thread,
        messages: appendCursorItems(current.messages, page.messages, ({ key }) => key),
        nextCursor: page.nextCursor === cursor ? null : page.nextCursor,
        truncated: page.truncated,
      } : current);
      queryClient.setQueryData(signalQueryKeys.detail(context, initialConnectorKey, threadKey), (current: Awaited<ReturnType<typeof fetchEmailThreadForContext>> | undefined) => current ? {
        ...current,
        thread: page.thread,
        messages: appendCursorItems(current.messages, page.messages, ({ key }) => key),
        nextCursor: page.nextCursor === cursor ? null : page.nextCursor,
        truncated: page.truncated,
      } : page);
    } catch (failure) {
      notify(messageFor(failure));
    } finally {
      loadingMoreThread.current = false;
      setThreadPageLoading(false);
    }
  }
  async function restoreSignalReader() {
    if (!initialConnectorKey || !initialThreadKey || restoredSignalReader.current) return;
    restoredSignalReader.current = true;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = ++detailGeneration.current;
    const detailKey = signalQueryKeys.detail(context, initialConnectorKey, initialThreadKey);
    setOpeningThreadKey(initialThreadKey);
    try {
      let detail = initialMessageKey
        ? await fetchEmailThreadForContext(context, initialThreadKey)
        : await queryClient.fetchQuery({ queryKey: detailKey, queryFn: () => fetchEmailThreadForContext(context, initialThreadKey), staleTime: 0 });
      if (generation !== detailGeneration.current || !contextIsCurrent(context)) return;
      if (initialMessageKey) {
        const seenCursors = new Set<string>();
        while (!detail.messages.some(({ key }) => key === initialMessageKey) && detail.nextCursor && !seenCursors.has(detail.nextCursor)) {
          const cursor = detail.nextCursor;
          seenCursors.add(cursor);
          const page = await fetchEmailThreadForContext(context, initialThreadKey, cursor);
          if (generation !== detailGeneration.current || !contextIsCurrent(context)) return;
          detail = {
            ...detail,
            thread: page.thread,
            messages: appendCursorItems(detail.messages, page.messages, ({ key }) => key),
            nextCursor: page.nextCursor,
            truncated: page.truncated,
          };
        }
        if (detail.nextCursor && seenCursors.has(detail.nextCursor)) detail = { ...detail, nextCursor: null };
        queryClient.setQueryData(detailKey, detail);
      }
      setSelected(detail);
      setSelectedMessageKey(initialMessageKey && detail.messages.some(({ key }) => key === initialMessageKey) ? initialMessageKey : [...detail.messages].sort((left, right) => right.sentAt.localeCompare(left.sentAt))[0]?.key);
    } catch (failure) {
      if (generation === detailGeneration.current && contextIsCurrent(context)) notify(messageFor(failure));
    } finally {
      if (generation === detailGeneration.current) setOpeningThreadKey(undefined);
    }
  }
  const restoreLatestSignalReader = useEffectEvent(restoreSignalReader);
  useEffect(() => { void restoreLatestSignalReader(); }, [initialConnectorKey, initialMessageKey, initialThreadKey, openAttachments]);
  const openLatestReceivedAttachments = useEffectEvent(() => openReceivedAttachments(initialMessageKey));
  useEffect(() => {
    if (!openAttachments || !selectedMessage || restoredSignalAttachments.current) return;
    restoredSignalAttachments.current = true;
    void openLatestReceivedAttachments();
  }, [openAttachments, selectedMessage?.key]);

  async function resolveGalleryAttachment(ref: EmailAttachmentRef & { type: "image" }) {
    const galleryContext = getGalleryContext();
    const root = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext), queryFn: () => fetchGalleryOverview(), staleTime: 0 });
    const direct = root.images.find(({ key }) => key === ref.key) ?? (await searchGalleryImages({ imageKey: ref.key })).images.find(({ key }) => key === ref.key);
    if (!direct) throw new Error("A Gallery attachment is no longer available.");
    const cachedCollection = root.collections.find((collection) => queryClient.getQueryData<GalleryOverview>(galleryQueryKeys.overview(galleryContext, collection.key))?.images.some(({ key }) => key === ref.key));
    if (cachedCollection) return { kind: "image", ref, image: direct, collection: cachedCollection } as const;
    const locations = await Promise.all(root.collections.map(async (collection) => ({
      collection,
      overview: await queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext, collection.key), queryFn: () => fetchGalleryOverview(collection.key) }),
      exact: await searchGalleryImages({ imageKey: ref.key, collectionKey: collection.key }),
    })));
    const collection = locations.find(({ exact, overview }) => overview.images.some(({ key }) => key === ref.key) || exact.images.some(({ key }) => key === ref.key))?.collection;
    return { kind: "image", ref, image: direct, collection } as const;
  }
  async function openReceivedAttachments(preferredMessageKey?: string) {
    const message = selected?.messages.find(({ key }) => key === preferredMessageKey) ?? selectedMessage;
    if (!message) return;
    const refs = message.attachments ?? [];
    const threadKey = selected?.thread.key;
    if (!threadKey) return;
    const source = { threadKey, messageKey: message.key };
    const contentContext = getContentContext();
    const generation = detailGeneration.current;
    const request = ++receivedAttachmentsRequest.current;
    const requestIsCurrent = () => request === receivedAttachmentsRequest.current
      && generation === detailGeneration.current
      && selectedThreadKeyRef.current === source.threadKey
      && selectedMessageKeyRef.current === source.messageKey;
    setAttachmentsOpen(true);
    setReceivedAttachments([]);
    setReceivedAttachmentsError(undefined);
    setReceivedAttachmentsLoading(refs.length > 0);
    if (!refs.length) return;
    const settled = await Promise.allSettled(refs.map((ref): Promise<ReceivedAttachment> => ref.type === "document"
      ? getContentDocument(queryClient, contentContext, ref.key).then((document) => ({ kind: "document", ref, document, source } as const))
      : resolveGalleryAttachment({ ...ref, type: "image" }).then((attachment) => ({ ...attachment, source }))));
    if (!requestIsCurrent()) return;
    const resolved = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    setReceivedAttachments(resolved);
    const failures = settled.length - resolved.length;
    if (failures) setReceivedAttachmentsError(`${failures} attachment${failures === 1 ? "" : "s"} could not be loaded.`);
    setReceivedAttachmentsLoading(false);
  }
  function openReceivedAttachment(attachment: ReceivedAttachment) {
    if (!initialConnectorKey) return;
    const returnParams = { returnSignalConnectorKey: initialConnectorKey, returnSignalThreadKey: attachment.source.threadKey, returnSignalMessageKey: attachment.source.messageKey };
    setAttachmentsOpen(false);
    if (attachment.kind === "document") router.replace({ pathname: "/capability/[slug]", params: { slug: "archive", assetKey: attachment.document.folderKey, documentKey: attachment.document.key, ...returnParams } });
    else router.replace({ pathname: "/capability/[slug]", params: { slug: "gallery", ...(attachment.collection ? { assetKey: attachment.collection.key } : {}), imageKey: attachment.image.key, ...returnParams } });
  }
  function toggleRootInboxSelection(account: EmailConnector) {
    if (!permissions.canMutate || rootBulkBusy) return;
    rootSelectionGeneration.current += 1;
    setSelectedInboxes((current) => current.some(({ connectorKey }) => connectorKey === account.connectorKey) ? current.filter(({ connectorKey }) => connectorKey !== account.connectorKey) : [...current, account]);
  }
  function clearRootInboxSelection() {
    rootSelectionGeneration.current += 1;
    setSelectedInboxes([]);
  }
  function handleRootInboxLongPress(account: EmailConnector) {
    rootLongPressedInbox.current = account.connectorKey;
    toggleRootInboxSelection(account);
    void Haptics.selectionAsync();
  }
  function handleRootInboxPress(account: EmailConnector) {
    if (rootLongPressedInbox.current === account.connectorKey) {
      rootLongPressedInbox.current = undefined;
      return;
    }
    if (selectedInboxes.length) toggleRootInboxSelection(account);
    else router.push({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey: account.connectorKey, signalReturn: "root" } });
  }
  async function openRootBulkActions() {
    if (!selectedInboxesRef.current.length || rootBulkBusy) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = ++rootSelectionGeneration.current;
    try {
      const authoritative = await queryClient.fetchQuery({ queryKey: signalQueryKeys.overview(context), queryFn: () => fetchEmailOverviewForContext(context), staleTime: 0 });
      if (generation !== rootSelectionGeneration.current || !contextIsCurrent(context)) return;
      const reconciled = reconcileSelectedInboxSnapshots(selectedInboxesRef.current, authoritative.accounts);
      setSelectedInboxes(reconciled);
      if (reconciled.length) setRootBulkMenuOpen(true);
    } catch (failure) {
      if (generation === rootSelectionGeneration.current && contextIsCurrent(context)) notify(messageFor(failure));
    }
  }
  async function setSelectedInboxesFavorite() {
    if (!selectedInboxes.length || rootBulkBusy || !permissions.canMutate) return;
    const snapshot = reconcileSelectedInboxSnapshots(selectedInboxes, metadataAccounts);
    if (!snapshot.length) { setSelectedInboxes([]); return; }
    const isFavorite = !snapshot.every((account) => account.isFavorite);
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const requests = new Map(snapshot.map((account) => {
      const targetKey = `${context.organizationKey}:${context.scopeKey}:inbox:${account.connectorKey}`;
      const request = (metadataRequests.current.get(targetKey) ?? 0) + 1;
      metadataRequests.current.set(targetKey, request);
      return [account.connectorKey, { targetKey, request }] as const;
    }));
    setRootBulkBusy(true);
    for (const account of snapshot) patchSignalInbox(queryClient, context, { ...account, isFavorite });
    setSelectedInboxes([]);
    notify(isFavorite ? `${snapshot.length} inbox${snapshot.length === 1 ? "" : "es"} favorited` : `${snapshot.length} inbox${snapshot.length === 1 ? "" : "es"} unfavorited`);
    const results = await Promise.allSettled(snapshot.map((account) => updateEmailInboxForContext(context, { connectorKey: account.connectorKey, isFavorite }, randomUUID())));
    if (!contextIsCurrent(context)) return;
    results.forEach((result, index) => {
      const account = snapshot[index]!;
      const owner = requests.get(account.connectorKey)!;
      if (result.status === "fulfilled" && metadataRequests.current.get(owner.targetKey) === owner.request) patchSignalInbox(queryClient, context, result.value);
    });
    const failures = results.filter(({ status }) => status === "rejected").length;
    if (failures) notify(`${failures} inbox${failures === 1 ? "" : "es"} could not be updated`);
    setRootBulkBusy(false);
    void queryClient.fetchQuery({ queryKey: signalQueryKeys.overview(context), queryFn: () => fetchEmailOverviewForContext(context), staleTime: 0 });
  }
  function removeRootInboxFromCaches(context: typeof emailContext, connectorKey: string) {
    queryClient.setQueriesData<EmailOverview>({ queryKey: signalQueryKeys.overviews(context) }, (current) => current ? {
      ...current,
      accounts: current.accounts.filter((account) => account.connectorKey !== connectorKey),
      selectedAccount: current.selectedAccount?.connectorKey === connectorKey ? null : current.selectedAccount,
    } : current);
  }
  async function performRootInboxDisconnect() {
    if (!selectedInboxes.length || rootBulkBusy || !permissions.canManageConnector) return;
    const snapshot = reconcileSelectedInboxSnapshots(selectedInboxes, metadataAccounts);
    if (!snapshot.length) { setSelectedInboxes([]); return; }
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    setRootDisconnectOpen(false);
    setRootBulkBusy(true);
    snapshot.forEach(({ connectorKey }) => removeRootInboxFromCaches(context, connectorKey));
    setSelectedInboxes([]);
    notify(snapshot.length === 1 ? "Inbox disconnected" : `${snapshot.length} inboxes disconnected`);
    const results = await Promise.allSettled(snapshot.map(({ connectorKey }) => disconnectEmailForContext(context, connectorKey)));
    if (!contextIsCurrent(context)) return;
    const failures = results.filter(({ status }) => status === "rejected").length;
    if (failures) notify(`${failures} inbox${failures === 1 ? "" : "es"} could not be disconnected`);
    setRootBulkBusy(false);
    void queryClient.fetchQuery({ queryKey: signalQueryKeys.overview(context), queryFn: () => fetchEmailOverviewForContext(context), staleTime: 0 });
  }
  function toggleThreadSelection(thread: EmailThread) {
    if (bulkActionsLoading) return;
    setSelectionNotice(undefined);
    setSelectedThreads((current) => {
      if (current.some(({ key }) => key === thread.key)) return current.filter(({ key }) => key !== thread.key);
      if (current.length >= 50) {
        setSelectionNotice("You can select up to 50 email threads.");
        return current;
      }
      return [...current, thread];
    });
  }
  function handleThreadLongPress(thread: EmailThread) {
    if (bulkBusy || bulkActionsLoading) return;
    longPressedThread.current = thread.key;
    toggleThreadSelection(thread);
    void Haptics.selectionAsync();
  }
  function handleThreadPress(thread: EmailThread) {
    if (bulkActionsLoading) return;
    if (longPressedThread.current === thread.key) {
      longPressedThread.current = undefined;
      return;
    }
    if (selectedThreads.length) toggleThreadSelection(thread);
    else void openThread(thread);
  }
  function clearThreadSelection() {
    selectionGeneration.current += 1;
    setBulkActionsLoading(false);
    setSelectedThreads([]);
    setSelectionNotice(undefined);
  }
  function successfulThreads(report: EmailBulkThreadReport) {
    return report.items.flatMap((item) => item.status === "succeeded" ? [item.thread] : []);
  }
  function applyDeletedThreadKeys(context: typeof emailContext, connectorKey: string, threadKeys: readonly string[], previousThreads: readonly EmailThread[] = []) {
    if (!threadKeys.length) return;
    const deleted = new Set(threadKeys);
    tombstoneSignalThreadKeys(context, connectorKey, threadKeys);
    void Promise.all([
      queryClient.cancelQueries({ queryKey: signalQueryKeys.accountOverviews(context, connectorKey) }),
      ...threadKeys.map((threadKey) => queryClient.cancelQueries({ queryKey: signalQueryKeys.detail(context, connectorKey, threadKey), exact: true })),
    ]);
    clearPendingThreadFields(threadKeys, ["favorite", "read", "trash"]);
    removeSignalThreadKeys(queryClient, context, connectorKey, threadKeys, previousThreads);
    setInboxView((current) => ({ ...current, overview: current.overview ? removeSignalOverviewThreadKeys(current.overview, threadKeys, previousThreads) : current.overview }));
    setSelectedThreads((current) => current.filter(({ key }) => !deleted.has(key)));
    if (selectedThreadKeyRef.current && deleted.has(selectedThreadKeyRef.current)) clearSelectedThread(true);
  }
  function retainRepairPendingField(threadKey: string, field: "favorite" | "read" | "trash") {
    repairPendingThreadFields.current.set(threadKey, new Set([...(repairPendingThreadFields.current.get(threadKey) ?? []), field]));
  }
  function settleRepairPendingThreads(updates: readonly EmailThread[]) {
    const settled = settleMatchingSignalRepairPendingFields(pendingThreadFields.current, repairPendingThreadFields.current, updates);
    pendingThreadFields.current = settled.pending;
    repairPendingThreadFields.current = settled.repairPending;
    if (settled.settledThreadKeys.length) {
      const keys = new Set(settled.settledThreadKeys);
      setSelectedThreads((current) => current.filter(({ key }) => !keys.has(key)));
    }
  }
  function applyAuthoritativeThreads(context: typeof emailContext, connectorKey: string, updates: readonly EmailThread[]) {
    if (!updates.length) return;
    settleRepairPendingThreads(updates);
    applySignalThreads(context, connectorKey, updates);
  }
  function applyOptimisticThreads(context: typeof emailContext, connectorKey: string, updates: readonly EmailThread[]) {
    if (!updates.length) return;
    applySignalThreads(context, connectorKey, updates);
  }
  function applySignalThreads(context: typeof emailContext, connectorKey: string, updates: readonly EmailThread[]) {
    const reconciled = reconcileSignalThreads(queryClient, context, connectorKey, updates, pendingThreadFields.current);
    setInboxView((current) => ({ ...current, overview: current.overview ? reconcileSignalOverviewThreads(current.overview, reconciled.updates, current.query, null, true, reconciled.previous) : current.overview }));
    const byKey = new Map(reconciled.updates.map((thread) => [thread.key, thread]));
    setSelected((current) => current && byKey.has(current.thread.key) ? { ...current, thread: byKey.get(current.thread.key)! } : current);
    setSelectedThreads((current) => reconcileSignalSelectedThreads(current, reconciled.updates));
  }
  async function openBulkActions() {
    if (!initialConnectorKey || !selectedThreads.length || bulkBusy || bulkInFlight.current) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const connectorKey = initialConnectorKey;
    const generation = ++selectionGeneration.current;
    const snapshot = [...selectedThreads];
    bulkInFlight.current = true;
    setBulkActionsLoading(true);
    setSelectionNotice(undefined);
    try {
      const details = await Promise.all(snapshot.map(({ key }) => fetchEmailThreadForContext(context, key)));
      if (generation !== selectionGeneration.current || !contextIsCurrent(context) || initialConnectorKey !== connectorKey) return;
      applyAuthoritativeThreads(context, connectorKey, details.map(({ thread }) => thread));
      setSheetError(undefined);
      setSheet("bulkActions");
      setSheetOpen(true);
    } catch (failure) {
      if (generation === selectionGeneration.current && contextIsCurrent(context) && initialConnectorKey === connectorKey) setSelectionNotice(messageFor(failure));
    } finally {
      bulkInFlight.current = false;
      if (generation === selectionGeneration.current) setBulkActionsLoading(false);
    }
  }
  async function toggleReadState() {
    const thread = selected?.thread;
    const messageKey = selectedMessageKeyRef.current;
    if (!thread || !messageKey || readBusy || trashBusy || readInFlight.current.has(thread.key)) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const connectorKey = initialConnectorKey;
    if (!connectorKey) return;
    const requestKey = randomUUID();
    const nextRead = !thread.isRead;
    const optimistic = { ...thread, isRead: nextRead, unread: !nextRead };
    readInFlight.current.add(thread.key);
    setReadBusy(true);
    setSheetError(undefined);
    setPendingThreadFields([thread.key], { read: nextRead });
    applyOptimisticThreads(context, connectorKey, [optimistic]);
    setSheetOpen(false);
    notify(nextRead ? "Marked read" : "Marked unread");
    try {
      const report = await setEmailThreadsReadStateForContext(context, [thread.key], nextRead, requestKey);
      if (!readInFlight.current.has(thread.key) || !contextIsCurrent(context)) return;
      const item = report.items[0];
      if (item?.status === "succeeded") {
        clearPendingThreadFields([thread.key], ["read"]);
        applyAuthoritativeThreads(context, connectorKey, [item.thread]);
      } else if (item?.status === "deleted") {
        applyDeletedThreadKeys(context, connectorKey, [thread.key], [thread]);
      } else if (item?.status === "repairPending") {
        retainRepairPendingField(thread.key, "read");
        notify("Email read update is pending repair.");
      } else {
        clearPendingThreadFields([thread.key], ["read"]);
        applyOptimisticThreads(context, connectorKey, [thread]);
        notify(item?.error ?? "Email read state was not updated.");
      }
      setSheetOpen(false);
    } catch (failure) {
      if (readInFlight.current.has(thread.key) && contextIsCurrent(context)) {
        clearPendingThreadFields([thread.key], ["read"]);
        applyOptimisticThreads(context, connectorKey, [thread]);
        notify(messageFor(failure));
      }
    } finally {
      readInFlight.current.delete(thread.key);
      setReadBusy(false);
    }
  }
  async function runBulkAction(action: "favorite" | "read" | "trash") {
    if (!initialConnectorKey || !selectedThreads.length || bulkBusy || bulkInFlight.current) return;
    const snapshot = [...selectedThreads];
    const threadKeys = snapshot.map(({ key }) => key);
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const connectorKey = initialConnectorKey;
    const generation = ++bulkGeneration.current;
    const requestKey = randomUUID();
    const isFavorite = !snapshot.every((thread) => thread.isFavorite);
    const isRead = !snapshot.every((thread) => thread.isRead);
    const optimistic = snapshot.map((thread) => action === "favorite"
      ? { ...thread, isFavorite }
      : action === "read"
        ? { ...thread, isRead, unread: !isRead }
        : { ...thread, labels: [...new Set([...(thread.labels ?? []), "TRASH"])], inInbox: false });
    if (action === "read" && threadKeys.some((key) => readInFlight.current.has(key))) return;
    bulkInFlight.current = true;
    if (action === "read") threadKeys.forEach((key) => readInFlight.current.add(key));
    setBulkBusy(true);
    setSheetError(undefined);
    const pendingField = action === "favorite" ? { favorite: isFavorite } : action === "read" ? { read: isRead } : { trash: true };
    setPendingThreadFields(threadKeys, pendingField);
    applyOptimisticThreads(context, connectorKey, optimistic);
    clearThreadSelection();
    setSheetOpen(false);
    notify(action === "trash" ? `${snapshot.length} moved to trash` : action === "favorite" ? (isFavorite ? `${snapshot.length} favorited` : `${snapshot.length} unfavorited`) : (isRead ? `${snapshot.length} marked read` : `${snapshot.length} marked unread`));
    try {
      const report = action === "favorite"
        ? await setEmailThreadsFavoriteForContext(context, threadKeys, isFavorite, requestKey)
        : action === "read"
          ? await setEmailThreadsReadStateForContext(context, threadKeys, isRead, requestKey)
          : await trashEmailThreadsForContext(context, threadKeys, requestKey);
      if (generation !== bulkGeneration.current || !contextIsCurrent(context) || initialConnectorKey !== connectorKey) return;
      const succeeded = successfulThreads(report);
      const succeededKeys = new Set(succeeded.map(({ key }) => key));
      const deletedKeys = report.items.flatMap((item) => item.status === "deleted" ? [item.threadKey] : []);
      const failedKeys = report.items.flatMap((item) => item.status === "failed" ? [item.threadKey] : []);
      const repairPendingKeys = report.items.flatMap((item) => item.status === "repairPending" ? [item.threadKey] : []);
      for (const threadKey of repairPendingKeys) retainRepairPendingField(threadKey, action);
      const completedKeys = [...succeededKeys, ...deletedKeys, ...failedKeys];
      clearPendingThreadFields(completedKeys, [action]);
      applyAuthoritativeThreads(context, connectorKey, succeeded);
      applyDeletedThreadKeys(context, connectorKey, deletedKeys, snapshot);
      applyOptimisticThreads(context, connectorKey, snapshot.filter(({ key }) => failedKeys.includes(key)));
      if (report.repairPending) notify("Email update is pending repair.");
    } catch (failure) {
      if (generation === bulkGeneration.current && contextIsCurrent(context) && initialConnectorKey === connectorKey) {
        clearPendingThreadFields(threadKeys, [action]);
        applyOptimisticThreads(context, connectorKey, snapshot);
        notify(messageFor(failure));
      }
    } finally {
      if (action === "read") threadKeys.forEach((key) => readInFlight.current.delete(key));
      bulkInFlight.current = false;
      if (generation === bulkGeneration.current) setBulkBusy(false);
    }
  }
  async function toggleFavorite() {
    if (!selected || !initialConnectorKey || trashBusy || favoriteInFlight.current) return;
    const generation = ++favoriteGeneration.current;
    favoriteInFlight.current = true;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const connectorKey = initialConnectorKey;
    const threadKey = selected.thread.key;
    const requestKey = randomUUID();
    const nextFavorite = !selected.thread.isFavorite;
    const previous = selected.thread;
    const optimistic = { ...previous, isFavorite: nextFavorite };
    setBusy("favorite");
    setSheetError(undefined);
    setPendingThreadFields([threadKey], { favorite: nextFavorite });
    applyOptimisticThreads(context, connectorKey, [optimistic]);
    setSheetOpen(false);
    notify(nextFavorite ? "Favorited" : "Unfavorited");
    try {
      const report = await setEmailThreadsFavoriteForContext(context, [threadKey], nextFavorite, requestKey);
      if (generation !== favoriteGeneration.current || !contextIsCurrent(context) || initialConnectorKey !== connectorKey) return;
      const item = report.items[0];
      if (item?.status === "succeeded") {
        clearPendingThreadFields([threadKey], ["favorite"]);
        applyAuthoritativeThreads(context, connectorKey, [item.thread]);
      } else if (item?.status === "deleted") {
        applyDeletedThreadKeys(context, connectorKey, [threadKey], [previous]);
      } else if (item?.status === "repairPending") {
        retainRepairPendingField(threadKey, "favorite");
        void queryClient.invalidateQueries({ queryKey: signalQueryKeys.accountOverviews(context, connectorKey), refetchType: "none" });
        notify("Email favorite update is pending repair.");
      } else {
        clearPendingThreadFields([threadKey], ["favorite"]);
        applyOptimisticThreads(context, connectorKey, [previous]);
        notify(item?.error ?? "Email favorite was not updated.");
      }
    } catch (failure) {
      if (generation === favoriteGeneration.current && contextIsCurrent(context) && initialConnectorKey === connectorKey) {
        clearPendingThreadFields([threadKey], ["favorite"]);
        applyOptimisticThreads(context, connectorKey, [previous]);
        notify(messageFor(failure));
      }
    } finally {
      if (generation === favoriteGeneration.current) {
        favoriteInFlight.current = false;
        setBusy(undefined);
      }
    }
  }

  function commitNewEmailRecipients(value = newEmailRecipientInput) {
    const candidates = parseAddresses(value);
    if (!candidates.length) return newEmailRecipients.length > 0;
    const parsed = candidates.map((candidate) => emailAddressSchema.safeParse(candidate));
    if (parsed.some((result) => !result.success)) {
      setNewEmailRecipientError("Enter valid email addresses separated by commas, semicolons, or spaces.");
      return false;
    }
    const seen = new Set(newEmailRecipients.map((address) => address.toLocaleLowerCase()));
    const next = [...newEmailRecipients];
    for (const result of parsed) {
      const address = result.data!;
      const normalized = address.toLocaleLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        next.push(address);
      }
    }
    if (!emailAddressListSchema.safeParse(next).success) {
      setNewEmailRecipientError("You can add up to 50 recipients.");
      return false;
    }
    setNewEmailRecipients(next);
    setNewEmailRecipientInput("");
    setNewEmailRecipientError(undefined);
    return next.length > 0;
  }
  function changeNewEmailRecipientInput(value: string) {
    setNewEmailRecipientInput(value);
    setNewEmailRecipientError(undefined);
    if (/[,;\s]$/.test(value) || emailAddressSchema.safeParse(value.trim()).success) commitNewEmailRecipients(value);
  }
  function advanceNewEmailRecipients() {
    if (!commitNewEmailRecipients()) return;
    setNewEmailRecipientsOpen(false);
    setNewEmailContentOpen(true);
  }
  function closeNewEmailRecipients() {
    resetNewEmail();
  }
  function removeNewEmailRecipient(address: string) {
    setNewEmailRecipients((current) => current.filter((candidate) => candidate.toLocaleLowerCase() !== address.toLocaleLowerCase()));
  }
  function returnToNewEmailContent() {
    setNewEmailAlternativesOpen(false);
    setNewEmailContentOpen(true);
  }
  function changeNewEmailContent(field: "subject" | "body", value: string) {
    invalidateNewEmailAlternatives();
    if (field === "subject") setNewEmailSubject(value);
    else setNewEmailBody(value);
  }
  function emailEditorText(target: EmailEditorTarget) {
    if (target === "newEmail") return newEmailBody;
    if (target === "newEmailReview") return newEmailReviewBody;
    if (target === "draft") return draftBody;
    return replyBody;
  }
  function applyEmailEditorText(target: EmailEditorTarget, value: string) {
    if (target === "newEmail") changeNewEmailContent("body", value);
    else if (target === "newEmailReview") setNewEmailReviewBody(value);
    else if (target === "draft") setDraftBody(value);
    else setReplyBody(value);
  }
  function openEmailEditorActions(target: EmailEditorTarget) {
    if (editorTransformation || !emailEditorText(target).trim()) return;
    setEditorActionTarget(target);
  }
  function openEmailEditorTranslation() {
    const target = editorActionTarget;
    if (!target) return;
    setEditorTargetLanguage(languageForCountryCode(countryCode));
    setEditorActionTarget(undefined);
    setEditorTranslateTarget(target);
  }
  async function transformEmailEditor(target: EmailEditorTarget, action: EmailEditorTransformation["action"]) {
    if (editorTransformation) return;
    const text = emailEditorText(target).trim();
    const language = editorTargetLanguage.trim();
    if (!text || action === "translate" && language.length < 2) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = ++editorTransformationGeneration.current;
    setEditorActionTarget(undefined);
    setEditorTranslateTarget(undefined);
    setEditorTransformation({ target, action });
    try {
      const result = action === "enhance"
        ? await enhanceAppTextForContext(context, text)
        : await translateAppTextForContext(context, text, language);
      if (generation === editorTransformationGeneration.current && contextIsCurrent(context)) applyEmailEditorText(target, result.text);
    } catch (failure) {
      if (generation === editorTransformationGeneration.current && contextIsCurrent(context)) notify(messageFor(failure));
    } finally {
      if (generation === editorTransformationGeneration.current) setEditorTransformation(undefined);
    }
  }
  function newEmailGenerationIsCurrent(generation: number, owner: string, context: typeof emailContext) {
    return generation === newEmailGeneration.current && owner === newEmailGenerationOwner.current && contextIsCurrent(context);
  }
  function generateNewEmailAlternatives(options: NewEmailToneOption[]) {
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = ++newEmailGeneration.current;
    const owner = randomUUID();
    newEmailGenerationOwner.current = owner;
    const targets = options;
    setNewEmailError(undefined);
    setNewEmailAlternatives(options.map((option) => ({ option, status: "pending" })));
    const operations = targets.map(async (option) => {
      const previous = newEmailToneRequests.current.get(option.value);
      const fingerprint = JSON.stringify([initialConnectorKey, newEmailRecipients, newEmailSubject, newEmailBody, option.value]);
      const retained = newEmailToneRequestKeys.current.get(option.value);
      const requestKey = retained?.fingerprint === fingerprint ? retained.requestKey : randomUUID();
      newEmailToneRequestKeys.current.set(option.value, { fingerprint, requestKey });
      previous?.controller.abort();
      const controller = new AbortController();
      newEmailToneRequests.current.set(option.value, { controller, requestKey });
      try {
        const created = await composeEmailDraftForContext(context, {
          ...(initialConnectorKey ? { connectorKey: initialConnectorKey } : {}),
          to: newEmailRecipients,
          generationMode: "generate",
          subject: newEmailSubject,
          authoredBody: newEmailBody,
          tone: option.value,
        }, requestKey, controller.signal);
        if (!newEmailGenerationIsCurrent(generation, owner, context) || created.variant !== "new") {
          discardDrafts([created]);
          return;
        }
        newEmailToneRequestKeys.current.delete(option.value);
        setNewEmailAlternatives((current) => current.map((alternative) => alternative.option.value === option.value ? { option, status: "succeeded", draft: created } : alternative));
      } catch (failure) {
        if (!controller.signal.aborted && newEmailGenerationIsCurrent(generation, owner, context)) setNewEmailAlternatives((current) => current.map((alternative) => alternative.option.value === option.value ? { option, status: "failed", error: messageFor(failure) } : alternative));
      } finally {
        if (newEmailToneRequests.current.get(option.value)?.controller === controller) newEmailToneRequests.current.delete(option.value);
      }
    });
    void Promise.allSettled(operations);
  }
  function retryNewEmailAlternative(option: NewEmailToneOption) {
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = newEmailGeneration.current;
    const owner = newEmailGenerationOwner.current;
    if (!owner || newEmailToneRequests.current.has(option.value)) return;
    const controller = new AbortController();
    const fingerprint = JSON.stringify([initialConnectorKey, newEmailRecipients, newEmailSubject, newEmailBody, option.value]);
    const retained = newEmailToneRequestKeys.current.get(option.value);
    const requestKey = retained?.fingerprint === fingerprint ? retained.requestKey : randomUUID();
    newEmailToneRequestKeys.current.set(option.value, { fingerprint, requestKey });
    newEmailToneRequests.current.set(option.value, { controller, requestKey });
    setNewEmailAlternatives((current) => current.map((alternative) => alternative.option.value === option.value ? { option, status: "pending" } : alternative));
    void composeEmailDraftForContext(context, {
      ...(initialConnectorKey ? { connectorKey: initialConnectorKey } : {}),
      to: newEmailRecipients,
      generationMode: "generate",
      subject: newEmailSubject,
      authoredBody: newEmailBody,
      tone: option.value,
    }, requestKey, controller.signal).then((created) => {
      if (newEmailGenerationIsCurrent(generation, owner, context) && created.variant === "new") {
        newEmailToneRequestKeys.current.delete(option.value);
        setNewEmailAlternatives((current) => current.map((alternative) => alternative.option.value === option.value ? { option, status: "succeeded", draft: created } : alternative));
      } else discardDrafts([created]);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted && newEmailGenerationIsCurrent(generation, owner, context)) setNewEmailAlternatives((current) => current.map((alternative) => alternative.option.value === option.value ? { option, status: "failed", error: messageFor(failure) } : alternative));
    }).finally(() => {
      if (newEmailToneRequests.current.get(option.value)?.controller === controller) newEmailToneRequests.current.delete(option.value);
    });
  }
  function openNewEmailAlternatives() {
    if (tonesLoading) return;
    setNewEmailContentOpen(false);
    setNewEmailAlternativesOpen(true);
    if (newEmailGenerationOwner.current) return;
    const snapshot = availableNewEmailTones.map((option) => ({ ...option }));
    generateNewEmailAlternatives(snapshot);
  }
  function openNewEmailReview(draft?: NewEmailDraft) {
    setNewEmailSelectedDraft(draft);
    setNewEmailSkipped(!draft);
    setNewEmailReviewSubject(draft?.subject ?? newEmailSubject);
    setNewEmailReviewBody(draft ? draft.finalContent ?? draft.generatedContent : newEmailBody);
    setNewEmailAttachments(draft?.attachments ?? []);
    setNewEmailAttachmentLabels({});
    setNewEmailAttachmentImageUrls({});
    setNewEmailError(undefined);
    setNewEmailAlternativesOpen(false);
    setNewEmailReviewOpen(true);
  }
  async function refreshNewEmailImageUrls() {
    const refs = newEmailAttachments.filter((ref): ref is EmailAttachmentRef & { type: "image" } => ref.type === "image");
    if (!refs.length) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const results = await Promise.allSettled(refs.map((ref) => searchGalleryImages({ imageKey: ref.key }).then(({ images }) => [ref.key, images.find(({ key }) => key === ref.key)?.url] as const)));
    if (!contextIsCurrent(context)) return;
    setNewEmailAttachmentImageUrls((current) => Object.fromEntries([
      ...Object.entries(current),
      ...results.flatMap((result) => result.status === "fulfilled" && result.value[1] ? [[`image:${result.value[0]}`, result.value[1]] as const] : []),
    ]));
  }
  const refreshLatestNewEmailImageUrls = useEffectEvent(refreshNewEmailImageUrls);
  useEffect(() => {
    if (!newEmailReviewOpen || !newEmailAttachments.some(({ type }) => type === "image")) return;
    void refreshLatestNewEmailImageUrls();
    const interval = setInterval(() => void refreshLatestNewEmailImageUrls(), 4 * 60_000);
    return () => clearInterval(interval);
  }, [newEmailAttachments, newEmailReviewOpen]);
  function closeNewEmailReview() {
    if (newEmailSending) return;
    setNewEmailReviewOpen(false);
    setNewEmailAlternativesOpen(true);
    setNewEmailError(undefined);
  }
  function openNewEmailAttachments() {
    if (!newEmailSending) setNewEmailAttachmentsOpen(true);
  }
  function finishNewEmailAttachments(selection: EmailAttachmentRef[], labels: EmailAttachmentLabels, imageUrls: EmailAttachmentImageUrls) {
    setNewEmailAttachments(selection);
    setNewEmailAttachmentLabels(labels);
    setNewEmailAttachmentImageUrls(imageUrls);
    if (!sameAttachmentSelection(selection, newEmailSelectedDraft?.attachments ?? [])) setNewEmailSkipped(true);
    setNewEmailAttachmentsOpen(false);
  }
  function removeAllNewEmailAttachments() {
    setNewEmailAttachments([]);
    setNewEmailAttachmentLabels({});
    setNewEmailAttachmentImageUrls({});
    setNewEmailSkipped(true);
  }
  const closeLatestNewEmailRecipients = useEffectEvent(closeNewEmailRecipients);
  const closeLatestNewEmailReview = useEffectEvent(closeNewEmailReview);
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (sendGeneration.current !== undefined || busy === "send") {
          event.preventDefault();
          return;
        }
        if (allowNavigation.current) {
          allowNavigation.current = false;
          return;
        }
        if (sheetOpen && (sheet === "connectForm" || sheet === "toneCreate" || sheet === "inboxEdit" || sheet === "toneEdit")) {
          event.preventDefault();
          if (!busy) closeForm();
          return;
        }
        if (newEmailAttachmentsOpen) {
          event.preventDefault();
          setNewEmailAttachmentsOpen(false);
          return;
        }
        if (newEmailReviewOpen) {
          event.preventDefault();
          closeLatestNewEmailReview();
          return;
        }
        if (newEmailAlternativesOpen) {
          event.preventDefault();
          returnToNewEmailContent();
          return;
        }
        if (newEmailContentOpen) {
          event.preventDefault();
          invalidateNewEmailAlternatives();
          setNewEmailContentOpen(false);
          setNewEmailRecipientsOpen(true);
          return;
        }
        if (newEmailRecipientsOpen) {
          event.preventDefault();
          closeLatestNewEmailRecipients();
          return;
        }
        if (selected) {
          event.preventDefault();
          clearSelectedThreadFromEffect();
          return;
        }
        if (initialConnectorKey && (!navigatedFromRoot || !router.canGoBack())) {
          event.preventDefault();
          allowNavigation.current = true;
          router.replace({ pathname: "/capability/[slug]", params: { slug: "signal" } });
        }
      }),
    [navigation, busy, initialConnectorKey, navigatedFromRoot, newEmailAlternativesOpen, newEmailAttachmentsOpen, newEmailContentOpen, newEmailRecipientsOpen, newEmailReviewOpen, router, selected, sheet, sheetOpen],
  );
  async function sendNewEmail() {
    if (newEmailSendInFlight.current || newEmailSending) return;
    const selectedDraft = newEmailSelectedDraft;
    if (!newEmailSkipped && !selectedDraft) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = ++newEmailGeneration.current;
    sendGeneration.current = generation;
    newEmailSendInFlight.current = true;
    setNewEmailSending(true);
    setNewEmailError(undefined);
    try {
      let prepared: NewEmailDraft;
      if (!selectedDraft || newEmailReviewSubject !== selectedDraft.subject) {
        const fingerprint = JSON.stringify(["compose", initialConnectorKey, newEmailRecipients, newEmailReviewSubject, newEmailReviewBody, newEmailAttachments]);
        const requestKey = newEmailPreparation.current?.fingerprint === fingerprint ? newEmailPreparation.current.requestKey : randomUUID();
        newEmailPreparation.current = { fingerprint, requestKey };
        const created = await composeEmailDraftForContext(context, {
          ...(initialConnectorKey ? { connectorKey: initialConnectorKey } : {}),
          to: newEmailRecipients,
          generationMode: "preserve",
          subject: newEmailReviewSubject,
          authoredBody: newEmailReviewBody,
          attachments: newEmailAttachments,
        }, requestKey);
        newEmailPreparation.current = undefined;
        if (created.variant !== "new") throw new Error("The email draft could not be prepared.");
        prepared = created;
      } else {
        const bodyChanged = newEmailReviewBody !== (selectedDraft.finalContent ?? selectedDraft.generatedContent);
        const attachmentsChanged = !sameAttachmentSelection(newEmailAttachments, selectedDraft.attachments ?? []);
        if (bodyChanged || attachmentsChanged) {
          const fingerprint = JSON.stringify(["update", selectedDraft.key, bodyChanged ? newEmailReviewBody : null, attachmentsChanged ? newEmailAttachments : null]);
          const requestKey = newEmailPreparation.current?.fingerprint === fingerprint ? newEmailPreparation.current.requestKey : randomUUID();
          newEmailPreparation.current = { fingerprint, requestKey };
          const updated = await updateEmailDraftForContext(context, selectedDraft.key, { ...(bodyChanged ? { finalContent: newEmailReviewBody } : {}), ...(attachmentsChanged ? { attachments: newEmailAttachments } : {}) }, requestKey);
          newEmailPreparation.current = undefined;
          if (updated.variant !== "new") throw new Error("The email draft could not be updated.");
          prepared = updated;
        } else prepared = selectedDraft;
      }
      if (generation !== newEmailGeneration.current || !contextIsCurrent(context)) return;
      setNewEmailSelectedDraft(prepared);
      setNewEmailSkipped(false);
      const sendFingerprint = JSON.stringify([prepared.key, newEmailReviewSubject, newEmailReviewBody, newEmailAttachments]);
      newEmailFinalSend.current = retainEmailRequestKey(newEmailFinalSend.current, sendFingerprint, randomUUID);
      await sendEmailDraftForContext(context, prepared.key, newEmailFinalSend.current.requestKey);
      newEmailFinalSend.current = undefined;
      if (generation !== newEmailGeneration.current || !contextIsCurrent(context)) return;
      notify("Email sent");
      newEmailSendInFlight.current = false;
      sendGeneration.current = undefined;
      resetNewEmail(prepared.key);
      void queryClient.invalidateQueries({ queryKey: signalQueryKeys.all(context) });
      void load();
    } catch (failure) {
      if (generation === newEmailGeneration.current && contextIsCurrent(context)) {
        const notification = messageFor(failure);
        setNewEmailError(notification);
        notify(notification);
      }
    } finally {
      if (sendGeneration.current === generation) sendGeneration.current = undefined;
      if (generation === newEmailGeneration.current) {
        newEmailSendInFlight.current = false;
        setNewEmailSending(false);
      }
    }
  }
  function setGeneratedSelection(kind: GeneratedKind, next: string[] | ((current: string[]) => string[])) {
    if (kind === "translation") setSelectedTranslationKeys(next);
    else setSelectedSummaryKeys(next);
  }
  function toggleGeneratedSelection(kind: GeneratedKind, key: string) {
    if (!permissions.canMutate || generatedDeleteInFlight.current) return;
    setGeneratedSelection(kind, (current) => {
      if (current.includes(key)) return current.filter((candidate) => candidate !== key);
      if (current.length >= 50) {
        notify("You can select up to 50 saved versions.");
        return current;
      }
      return [...current, key];
    });
  }
  function handleGeneratedLongPress(kind: GeneratedKind, key: string) {
    if (!permissions.canMutate) return;
    longPressedGenerated.current = `${kind}:${key}`;
    setTimeout(() => { if (longPressedGenerated.current === `${kind}:${key}`) longPressedGenerated.current = undefined; }, 50);
    toggleGeneratedSelection(kind, key);
    void Haptics.selectionAsync();
  }
  function handleGeneratedPress(kind: GeneratedKind, key: string) {
    const token = `${kind}:${key}`;
    const longPress = longPressedGenerated.current;
    longPressedGenerated.current = undefined;
    if (longPress === token) return;
    const selection = kind === "translation" ? selectedTranslationKeys : selectedSummaryKeys;
    if (selection.length && permissions.canMutate) toggleGeneratedSelection(kind, key);
    else {
      if (kind === "translation") { setSelectedTranslationKey(key); setReaderSheet("translationReader"); }
      else { setSelectedSummaryKey(key); setReaderSheet("summaryReader"); }
    }
  }
  function openGeneratedDeleteConfirmation(kind: GeneratedKind) {
    if (!permissions.canMutate || generatedDeleteInFlight.current) return;
    const threadKey = selectedThreadKeyRef.current;
    const messageKey = readerTargetKey.current;
    const selectedKeys = kind === "translation" ? selectedTranslationKeys : selectedSummaryKeys;
    const records = kind === "translation" ? translations : summaries;
    const keys = selectedKeys.filter((key) => records.some((record) => record.key === key)).slice(0, 50);
    if (!threadKey || !messageKey || !keys.length) return;
    const generation = ++generatedDeleteGeneration.current;
    setGeneratedDeleteConfirmation(Object.freeze({ kind, context: { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey }, threadKey, messageKey, keys: Object.freeze([...keys]), generation }));
  }
  async function deleteGeneratedRecords() {
    const operation = generatedDeleteConfirmation;
    if (!operation || generatedDeleteInFlight.current) return;
    const current = () => operation.generation === generatedDeleteGeneration.current && contextIsCurrent(operation.context) && selectedThreadKeyRef.current === operation.threadKey && selectedMessageKeyRef.current === operation.messageKey;
    const queryKey = operation.kind === "translation" ? signalQueryKeys.translations(operation.context, operation.messageKey) : signalQueryKeys.summaries(operation.context, operation.messageKey);
    generatedDeleteInFlight.current = true;
    setGeneratedDeleteBusy(true);
    await queryClient.cancelQueries({ queryKey, exact: true });
    if (!current()) {
      generatedDeleteInFlight.current = false;
      setGeneratedDeleteBusy(false);
      return;
    }
    const requestKey = randomUUID();
    const snapshot = queryClient.getQueryData<{ messageKey: string; versions: EmailTranslationVersion[] } | { messageKey: string; summaries: EmailSummary[] }>(queryKey);
    const snapshotRecords = operation.kind === "translation" ? (snapshot as { versions?: EmailTranslationVersion[] } | undefined)?.versions ?? [] : (snapshot as { summaries?: EmailSummary[] } | undefined)?.summaries ?? [];
    const requestedKeys = operation.keys.filter((key) => snapshotRecords.some((record) => record.key === key));
    if (!requestedKeys.length) {
      setGeneratedDeleteConfirmation(undefined);
      generatedDeleteInFlight.current = false;
      setGeneratedDeleteBusy(false);
      return;
    }
    if (operation.kind === "translation") queryClient.setQueryData(queryKey, (value: { messageKey: string; versions: EmailTranslationVersion[] } | undefined) => removeSignalTranslationVersions(value, requestedKeys));
    else queryClient.setQueryData(queryKey, (value: { messageKey: string; summaries: EmailSummary[] } | undefined) => removeSignalSummaries(value, requestedKeys));
    setGeneratedDeleteConfirmation(undefined);
    setGeneratedSelection(operation.kind, []);
    if (operation.kind === "translation" && selectedTranslationKey && requestedKeys.includes(selectedTranslationKey)) { setSelectedTranslationKey(undefined); setReaderSheet("translate"); }
    if (operation.kind === "summary" && selectedSummaryKey && requestedKeys.includes(selectedSummaryKey)) { setSelectedSummaryKey(undefined); setReaderSheet("summaryVersions"); }
    notify(`${requestedKeys.length} ${operation.kind}${requestedKeys.length === 1 ? "" : "s"} deleted`);
    try {
      const result = operation.kind === "translation"
        ? await deleteEmailMessageTranslationsForContext(operation.context, { messageKey: operation.messageKey, translationKeys: requestedKeys }, requestKey)
        : await deleteEmailMessageSummariesForContext(operation.context, { messageKey: operation.messageKey, summaryKeys: requestedKeys }, requestKey);
      if (!current()) {
        void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "active" });
        return;
      }
      if (result.messageKey !== operation.messageKey) throw new Error("Generated email deletion returned the wrong message.");
      const requested = new Set(requestedKeys);
      const deletedKeys = [...new Set(result.deletedKeys.filter((key) => requested.has(key)))];
      const deleted = new Set(deletedKeys);
      const failedKeys = requestedKeys.filter((key) => !deleted.has(key));
      if (failedKeys.length) {
        if (operation.kind === "translation") queryClient.setQueryData(queryKey, (value: { messageKey: string; versions: EmailTranslationVersion[] } | undefined) => restoreMissingSignalTranslationVersions(value, snapshotRecords as EmailTranslationVersion[], failedKeys));
        else queryClient.setQueryData(queryKey, (value: { messageKey: string; summaries: EmailSummary[] } | undefined) => restoreMissingSignalSummaries(value, snapshotRecords as EmailSummary[], failedKeys));
        setGeneratedSelection(operation.kind, failedKeys);
        notify(deletedKeys.length ? `${deletedKeys.length} deleted, ${failedKeys.length} could not be deleted` : `${failedKeys.length} ${operation.kind}${failedKeys.length === 1 ? "" : "s"} could not be deleted`);
      }
    } catch (failure) {
      if (current()) {
        if (operation.kind === "translation") queryClient.setQueryData(queryKey, (value: { messageKey: string; versions: EmailTranslationVersion[] } | undefined) => restoreMissingSignalTranslationVersions(value, snapshotRecords as EmailTranslationVersion[], requestedKeys));
        else queryClient.setQueryData(queryKey, (value: { messageKey: string; summaries: EmailSummary[] } | undefined) => restoreMissingSignalSummaries(value, snapshotRecords as EmailSummary[], requestedKeys));
        setGeneratedSelection(operation.kind, requestedKeys);
        notify(messageFor(failure));
      }
    } finally {
      void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "active" });
      generatedDeleteInFlight.current = false;
      if (operation.generation === generatedDeleteGeneration.current) setGeneratedDeleteBusy(false);
    }
  }
  function openReaderFlow(next: ReaderSheet) {
    if (trashBusy) return;
    const message = selectedMessage;
    const threadKey = selected?.thread.key;
    if (!message || !threadKey) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const messageKey = message.key;
    const generation = ++readerGeneration.current;
    readerTargetKey.current = messageKey;
    setReaderError(undefined);
    setSheetOpen(false);
    setReaderGenerating(undefined);
    if (next === "translate" || next === "summaryVersions") setReaderLoading(true);
    setReaderSheet(next);
    setReaderSheetOpen(true);
    if (next === "translate") { setSelectedTranslationKey(undefined); setSelectedTranslationKeys([]); }
    if (next === "summaryVersions") { setSelectedSummaryKey(undefined); setSelectedSummaryKeys([]); }
    requestAnimationFrame(() => { void (async () => {
      try {
        if (next === "translate") {
          const result = await queryClient.fetchQuery({ queryKey: signalQueryKeys.translations(context, messageKey), queryFn: () => listEmailMessageTranslationsForContext(context, messageKey), staleTime: 0 });
          if (!readerOperationIsCurrent(generation, context, threadKey, result.messageKey) || readerTargetKey.current !== result.messageKey) return;
        } else if (next === "summaryVersions") {
          const result = await queryClient.fetchQuery({ queryKey: signalQueryKeys.summaries(context, messageKey), queryFn: () => listEmailMessageSummariesForContext(context, messageKey), staleTime: 0 });
          if (!readerOperationIsCurrent(generation, context, threadKey, result.messageKey) || readerTargetKey.current !== result.messageKey) return;
      } else if (next === "similar") await loadSimilar({ generation, context, threadKey, messageKey });
      } catch (failure) {
        if (readerOperationIsCurrent(generation, context, threadKey, messageKey) && readerTargetKey.current === messageKey) setReaderError(messageFor(failure));
      } finally {
        if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) setReaderLoading(false);
      }
    })(); });
  }
  function hasAdditionalReplyParticipants() {
    const ownAddress = selectedAccount?.email.toLowerCase();
    if (!ownAddress || !selected) return false;
    const participants = new Set(selected.messages.flatMap((message) => [message.from, ...message.to, ...(message.cc ?? [])]).map((address) => address.toLowerCase()).filter((address) => address !== ownAddress));
    return participants.size > 1;
  }
  function openReplySuggestions() {
    if (!permissions.canMutate || trashBusy) return;
    const threadKey = selected?.thread.key;
    const messageKey = selectedMessage?.key;
    if (!threadKey || !messageKey) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = ++readerGeneration.current;
    readerTargetKey.current = messageKey;
    setReaderError(undefined);
    setReplyDrafts([]);
    setSelectedReplyKey(undefined);
    setReplyBody("");
    setReaderLoading(true);
    setSheetOpen(false);
    setReaderSheet("replies");
    setReaderSheetOpen(true);
    requestAnimationFrame(() => { void (async () => {
      try {
        const records = (await queryClient.fetchQuery({
          queryKey: signalQueryKeys.overview(context),
          queryFn: () => fetchEmailOverviewForContext(context),
        })).tones;
        if (!readerOperationIsCurrent(generation, context, threadKey, messageKey)) return;
        const selectors = records.length
          ? records.map((record) => ({ label: record.name, tone: record.slug ?? record.key }))
          : BUILT_IN_EMAIL_TONES.map((tone) => ({ label: tone, tone }));
        const generated = await Promise.allSettled(selectors.map(async ({ label, tone }) => {
          const created = await createEmailDraftForContext(context, { threadKey, replyMode: "reply", tone }, randomUUID());
          if (created.variant !== "reply") throw new Error(`${label} did not create a reply draft.`);
          return created;
        }));
        const drafts = generated.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        if (!readerOperationIsCurrent(generation, context, threadKey, messageKey)) {
          discardDrafts(drafts);
          return;
        }
        const firstFailure = generated.find((result): result is PromiseRejectedResult => result.status === "rejected");
        setReplyDrafts(drafts);
        if (!drafts.length) throw firstFailure?.reason ?? new Error("Replies could not be generated.");
        if (drafts.length !== selectors.length) setReaderError(`${selectors.length - drafts.length} replies could not be generated. ${firstFailure ? messageFor(firstFailure.reason) : ""}`.trim());
      } catch (failure) {
        if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) setReaderError(messageFor(failure));
      } finally {
        if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) setReaderLoading(false);
      }
    })(); });
  }
  function openReplyDraft(draft: ReplyDraft) {
    setSelectedReplyKey(draft.key);
    selectedReplyKeyRef.current = draft.key;
    replyPreparation.current = undefined;
    replyFinalSend.current = undefined;
    setReplyBody(draft.finalContent ?? draft.generatedContent);
    setReplyAttachments(draft.attachments ?? []);
    setReplyAttachmentLabels({});
    setReplyAttachmentImageUrls({});
    setEmptyReply(false);
    setReaderError(undefined);
    setReplyEditorOpen(true);
  }
  function openEmptyReply() {
    setSelectedReplyKey(undefined);
    selectedReplyKeyRef.current = undefined;
    replyPreparation.current = undefined;
    replyFinalSend.current = undefined;
    setReplyBody("");
    setReplyAttachments([]);
    setReplyAttachmentLabels({});
    setReplyAttachmentImageUrls({});
    setEmptyReply(true);
    setReplyEditorOpen(true);
  }
  function closeReplyEditor() {
    if (replySending) return;
    setReplyAttachmentsOpen(false);
    setReplyModeOpen(false);
    setReplyEditorOpen(false);
    setSelectedReplyKey(undefined);
    selectedReplyKeyRef.current = undefined;
    replyPreparation.current = undefined;
    replyFinalSend.current = undefined;
    setReplyBody("");
    setReplyAttachments([]);
    setReplyAttachmentLabels({});
    setReplyAttachmentImageUrls({});
    setEmptyReply(false);
  }
  function finishReplyAttachments(selection: EmailAttachmentRef[], labels: EmailAttachmentLabels, imageUrls: EmailAttachmentImageUrls) {
    setReplyAttachments(selection);
    setReplyAttachmentLabels(labels);
    setReplyAttachmentImageUrls(imageUrls);
    setReplyAttachmentsOpen(false);
  }
  function removeAllReplyAttachments() {
    setReplyAttachments([]);
    setReplyAttachmentLabels({});
    setReplyAttachmentImageUrls({});
  }
  async function refreshReplyImageUrl(ref: EmailAttachmentRef) {
    if (ref.type !== "image") return;
    const identity = attachmentIdentity(ref);
    const active = replyImageRefreshes.current.get(identity);
    if (active) return active;
    const draftKey = selectedReplyKeyRef.current;
    const threadKey = selectedThreadKeyRef.current;
    const messageKey = selectedMessageKeyRef.current;
    const generation = readerGeneration.current;
    if (!draftKey || !threadKey || !messageKey) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const request = searchGalleryImages({ imageKey: ref.key }).then(({ images }) => {
      const url = images.find(({ key }) => key === ref.key)?.url;
      if (!url || !readerOperationIsCurrent(generation, context, threadKey, messageKey) || selectedReplyKeyRef.current !== draftKey) return;
      setReplyAttachmentImageUrls((current) => ({ ...current, [identity]: url }));
    }).finally(() => { if (replyImageRefreshes.current.get(identity) === request) replyImageRefreshes.current.delete(identity); });
    replyImageRefreshes.current.set(identity, request);
    return request;
  }
  async function refreshReplyImageUrls() {
    await Promise.all(replyAttachments.filter((ref): ref is EmailAttachmentRef & { type: "image" } => ref.type === "image").map(refreshReplyImageUrl));
  }
  const refreshLatestReplyImageUrls = useEffectEvent(refreshReplyImageUrls);
  useEffect(() => {
    if (!readerSheetOpen || !replyEditorOpen || !replyAttachments.some(({ type }) => type === "image")) return;
    void refreshLatestReplyImageUrls();
    const interval = setInterval(() => void refreshLatestReplyImageUrls(), 4 * 60_000);
    return () => clearInterval(interval);
  }, [readerSheetOpen, replyAttachments, replyEditorOpen]);
  async function sendSuggestedReply(mode: EmailReplyMode) {
    let current = selectedReply;
    const threadKey = selected?.thread.key;
    if ((!current && !emptyReply) || !threadKey || replySending || !replyBody.trim()) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = readerGeneration.current;
    setReplyModeOpen(false);
    setReplySending(true);
    setReaderError(undefined);
    try {
      if (!current) {
        const created = await createEmailDraftForContext(context, { threadKey, replyMode: mode, tone: "casual" }, randomUUID());
        if (created.variant !== "reply") throw new Error("The empty reply draft could not be created.");
        current = created;
      }
      const bodyChanged = replyBody.trim() !== (current.finalContent ?? current.generatedContent).trim();
      const attachmentsChanged = !sameAttachmentSelection(replyAttachments, current.attachments ?? []);
      let prepared = current;
      if (bodyChanged || attachmentsChanged) {
        const preparationFingerprint = JSON.stringify([current.key, bodyChanged ? replyBody.trim() : null, attachmentsChanged ? replyAttachments : null]);
        replyPreparation.current = retainEmailRequestKey(replyPreparation.current, preparationFingerprint, randomUUID);
        const updated = await updateEmailDraftForContext(context, current.key, { ...(bodyChanged ? { finalContent: replyBody.trim() } : {}), ...(attachmentsChanged ? { attachments: replyAttachments } : {}) }, replyPreparation.current.requestKey);
        replyPreparation.current = undefined;
        if (updated.variant !== "reply") throw new Error("The reply draft could not be updated.");
        prepared = updated;
      }
      if (generation !== readerGeneration.current || !contextIsCurrent(context)) return;
      const sendFingerprint = JSON.stringify([prepared.key, mode, replyBody.trim(), replyAttachments]);
      replyFinalSend.current = retainEmailRequestKey(replyFinalSend.current, sendFingerprint, randomUUID);
      const sent = await sendEmailDraftForContext(context, prepared.key, replyFinalSend.current.requestKey, mode);
      replyFinalSend.current = undefined;
      if (generation !== readerGeneration.current || !contextIsCurrent(context)) return;
      notify("Reply sent");
      setReplySending(false);
      closeReaderFlowPreservingDraft(prepared.key);
      void queryClient.invalidateQueries({ queryKey: signalQueryKeys.all(context) });
      const detailGenerationValue = ++detailGeneration.current;
      void queryClient.fetchQuery({ queryKey: signalQueryKeys.detail(context, initialConnectorKey, threadKey), queryFn: () => fetchEmailThreadForContext(context, threadKey) }).then((detail) => {
        if (detailGenerationValue === detailGeneration.current && contextIsCurrent(context)) {
          if (initialConnectorKey) applyAuthoritativeThreads(context, initialConnectorKey, [detail.thread]);
          setSelected((currentSelected) => currentSelected?.thread.key === threadKey ? detail : currentSelected);
          setSelectedMessageKey(sent.messageKey ?? latestSentEmailMessageKey(detail.messages));
        }
      }).catch(() => undefined);
    } catch (failure) {
      if (generation === readerGeneration.current && contextIsCurrent(context)) notify(messageFor(failure));
    } finally {
      if (generation === readerGeneration.current) setReplySending(false);
    }
  }
  function requestSuggestedReplySend() {
    if (hasAdditionalReplyParticipants()) setReplyModeOpen(true);
    else void sendSuggestedReply("reply");
  }
  async function generateTranslation() {
    const messageKey = readerTargetKey.current;
    const threadKey = selectedThreadKeyRef.current;
    if (!messageKey || !threadKey || !targetLanguage.trim()) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = ++readerGeneration.current;
    const requestKey = randomUUID();
    setReaderSheet("translate");
    setReaderGenerating("translation");
    setReaderLoading(true);
    setReaderError(undefined);
    try {
      const result = await translateEmailMessageForContext(context, messageKey, { targetLanguage: targetLanguage.trim() }, requestKey);
      if (!readerOperationIsCurrent(generation, context, threadKey, result.messageKey) || readerTargetKey.current !== result.messageKey) return;
      pendingTranslationReaderKey.current = result.version.key;
      upsertSignalTranslationVersion(queryClient, context, messageKey, result.version);
      setSelectedTranslationKey(result.version.key);
      setReaderSheet("translationReader");
    } catch (failure) {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) setReaderError(messageFor(failure));
    } finally {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) { setReaderGenerating(undefined); setReaderLoading(false); }
    }
  }
  async function generateSummary() {
    const messageKey = readerTargetKey.current;
    const threadKey = selectedThreadKeyRef.current;
    if (!messageKey || !threadKey) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = ++readerGeneration.current;
    const requestKey = randomUUID();
    setReaderGenerating("summary");
    setReaderLoading(true);
    setReaderError(undefined);
    try {
      const result = await summarizeEmailMessageForContext(context, messageKey, {}, requestKey);
      if (!readerOperationIsCurrent(generation, context, threadKey, result.messageKey) || readerTargetKey.current !== result.messageKey) return;
      upsertSignalSummary(queryClient, context, messageKey, result.summary);
    } catch (failure) {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) setReaderError(messageFor(failure));
    } finally {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) { setReaderGenerating(undefined); setReaderLoading(false); }
    }
  }
  async function loadSimilar(captured?: { generation: number; context: typeof emailContext; threadKey: string; messageKey: string }) {
    const messageKey = captured?.messageKey ?? readerTargetKey.current;
    const threadKey = captured?.threadKey ?? selectedThreadKeyRef.current;
    if (!messageKey || !threadKey) return;
    const context = captured?.context ?? { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = captured?.generation ?? ++readerGeneration.current;
    setSimilarResults([]);
    setReaderLoading(true);
    setReaderError(undefined);
    try {
      const result = await findSimilarEmailMessagesForContext(context, messageKey, { limit: 10 });
      if (readerOperationIsCurrent(generation, context, threadKey, result.messageKey) && readerTargetKey.current === result.messageKey) setSimilarResults(result.items);
    } catch (failure) {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey) && readerTargetKey.current === messageKey) setReaderError(messageFor(failure));
    } finally {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) setReaderLoading(false);
    }
  }
  async function openSimilarResult(result: EmailSimilarResult) {
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const connectorKey = initialConnectorKey;
    const sourceThreadKey = selectedThreadKeyRef.current;
    const sourceMessageKey = readerTargetKey.current;
    if (!connectorKey || !sourceThreadKey || !sourceMessageKey) return;
    const generation = ++detailGeneration.current;
    setReaderLoading(true);
    setReaderError(undefined);
    try {
      const detail = await queryClient.fetchQuery({ queryKey: signalQueryKeys.detail(context, connectorKey, result.threadKey), queryFn: () => fetchEmailThreadForContext(context, result.threadKey) });
      if (generation !== detailGeneration.current || !contextIsCurrent(context) || initialConnectorKey !== connectorKey || selectedThreadKeyRef.current !== sourceThreadKey || readerTargetKey.current !== sourceMessageKey) return;
      setSelected(detail);
      setSelectedMessageKey(detail.messages.some(({ key }) => key === result.key) ? result.key : [...detail.messages].sort((left, right) => right.sentAt.localeCompare(left.sentAt))[0]?.key);
      setReaderSheetOpen(false);
      setSheetOpen(false);
    } catch (failure) {
      if (generation === detailGeneration.current && contextIsCurrent(context) && initialConnectorKey === connectorKey && selectedThreadKeyRef.current === sourceThreadKey && readerTargetKey.current === sourceMessageKey) setReaderError(messageFor(failure));
    } finally {
      if (generation === detailGeneration.current && contextIsCurrent(context)) setReaderLoading(false);
    }
  }
  async function trashThread() {
    const previousThread = selected?.thread;
    if (!previousThread || !selectedMessageKeyRef.current || !initialConnectorKey || trashInFlight.current) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const connectorKey = initialConnectorKey;
    const threadKey = previousThread.key;
    const generation = ++trashGeneration.current;
    const requestKey = randomUUID();
    const optimistic = { ...previousThread, labels: [...new Set([...(previousThread.labels ?? []), "TRASH"])], inInbox: false };
    trashInFlight.current = true;
    setTrashBusy(true);
    setReaderError(undefined);
    setPendingThreadFields([threadKey], { trash: true });
    applyOptimisticThreads(context, connectorKey, [optimistic]);
    setReaderSheetOpen(false);
    clearSelectedThread(true);
    notify("Thread moved to Trash");
    try {
      const report = await trashEmailThreadsForContext(context, [threadKey], requestKey);
      if (generation !== trashGeneration.current || !contextIsCurrent(context)) return;
      const item = report.items[0];
      if (item?.status === "succeeded") {
        clearPendingThreadFields([threadKey], ["trash"]);
        applyAuthoritativeThreads(context, connectorKey, [item.thread]);
      } else if (item?.status === "deleted") {
        applyDeletedThreadKeys(context, connectorKey, [threadKey], [previousThread]);
      } else if (item?.status === "repairPending") {
        retainRepairPendingField(threadKey, "trash");
        void queryClient.invalidateQueries({ queryKey: signalQueryKeys.accountOverviews(context, connectorKey), refetchType: "none" });
        notify("Trash update is pending repair.");
      } else {
        clearPendingThreadFields([threadKey], ["trash"]);
        applyOptimisticThreads(context, connectorKey, [previousThread]);
        notify(item?.error ?? "Email thread was not moved to Trash.");
      }
    } catch (failure) {
      if (generation === trashGeneration.current && contextIsCurrent(context)) {
        clearPendingThreadFields([threadKey], ["trash"]);
        applyOptimisticThreads(context, connectorKey, [previousThread]);
        notify(messageFor(failure));
      }
    } finally {
      trashInFlight.current = false;
      if (generation === trashGeneration.current) setTrashBusy(false);
    }
  }
  async function openTrashRoot() {
    if (!initialConnectorKey) return;
    const accounts = metadataAccounts.filter(({ connectorKey }) => connectorKey === initialConnectorKey);
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = ++trashRootGeneration.current;
    setSheetOpen(false);
    await wait(180);
    if (generation !== trashRootGeneration.current || !contextIsCurrent(context)) return;
    setTrashGroups([]);
    setTrashRootError(undefined);
    setTrashRootLoading(true);
    setSheet("trashRoot");
    setSheetOpen(true);
    try {
      const current = () => generation === trashRootGeneration.current && contextIsCurrent(context);
      const groups = await loadEmailTrashGroups(accounts, (connectorKey, cursor) => fetchEmailOverviewForContext(context, { connectorKey, filter: "trash", cursor, limit: 50 }), current, messageFor);
      if (groups && current()) {
        setTrashGroups(groups);
        const error = groups.find((group) => group.error)?.error;
        if (error) setTrashRootError(error);
      }
    } catch (failure) {
      if (generation === trashRootGeneration.current && contextIsCurrent(context)) setTrashRootError(messageFor(failure));
    } finally {
      if (generation === trashRootGeneration.current) setTrashRootLoading(false);
    }
  }
  async function clearTrash() {
    const clearable = clearableEmailTrashGroups(trashGroups);
    if (trashClearBusy || trashClearInFlight.current || !clearable.length) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = ++trashRootGeneration.current;
    const groups = [...clearable];
    const requestKeys = new Map(groups.map(({ connector }) => [connector.connectorKey, randomUUID()]));
    const cacheRemovals = new Map<string, ReturnType<typeof clearSignalTrashCaches>>();
    const failures = new Map<string, string>();
    let cleared = 0;
    trashClearInFlight.current = true;
    setTrashClearBusy(true);
    setSheetError(undefined);
    await Promise.all([
      ...groups.map(({ connector }) => queryClient.cancelQueries({ queryKey: signalQueryKeys.accountOverviews(context, connector.connectorKey) })),
      queryClient.cancelQueries({ queryKey: signalQueryKeys.details(context) }),
    ]);
    if (generation !== trashRootGeneration.current || !contextIsCurrent(context)) {
      trashClearInFlight.current = false;
      return;
    }
    setTrashGroups((current) => current.filter((group) => !groups.some(({ connector }) => connector.connectorKey === group.connector.connectorKey)));
    setSheet("trashRoot");
    for (const group of groups) cacheRemovals.set(group.connector.connectorKey, clearSignalTrashCaches(queryClient, context, group.connector.connectorKey));
    for (const group of groups) {
      try {
        const result = await clearEmailTrashForContext(context, group.connector.connectorKey, requestKeys.get(group.connector.connectorKey)!);
        if (generation !== trashRootGeneration.current || !contextIsCurrent(context)) {
          trashClearInFlight.current = false;
          return;
        }
        const removal = cacheRemovals.get(group.connector.connectorKey);
        if (removal) {
          commitSignalTrashCaches(queryClient, removal, group.threads.map(({ key }) => key));
        }
        cleared += result.threadsDeleted;
      } catch (failure) {
        failures.set(group.connector.connectorKey, messageFor(failure));
      }
    }
    if (generation === trashRootGeneration.current && contextIsCurrent(context)) {
      const attempted = new Set(groups.map(({ connector }) => connector.connectorKey));
      setTrashGroups((current) => [
        ...current.filter((group) => !attempted.has(group.connector.connectorKey)),
        ...groups.flatMap((group) => {
          const error = failures.get(group.connector.connectorKey);
          return error ? [{ ...group, error, errorKind: "clear" as const }] : [];
        }),
      ]);
      if (failures.size) {
        for (const connectorKey of failures.keys()) {
          const removal = cacheRemovals.get(connectorKey);
          if (removal && !restoreSignalTrashCaches(queryClient, removal)) void queryClient.invalidateQueries({ queryKey: signalQueryKeys.accountOverviews(context, connectorKey), refetchType: "active" });
        }
      }
      setSheet("trashRoot");
      setSheetError(undefined);
      if (failures.size) notify(`${cleared} trashed thread${cleared === 1 ? "" : "s"} permanently deleted, ${failures.size} inbox${failures.size === 1 ? "" : "es"} failed`);
      else notify("Trash cleared");
      setTrashClearBusy(false);
    }
    trashClearInFlight.current = false;
  }
  async function disconnect() {
    if (!initialConnectorKey) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const connectorKey = initialConnectorKey;
    const generation = ++operationGeneration.current;
    setBusy("disconnect");
    setSheetError(undefined);
    setSheetOpen(false);
    notify("Disconnecting inbox");
    try {
      await disconnectEmailForContext(context, connectorKey);
      if (!operationIsCurrent(generation, context) || initialConnectorKey !== connectorKey) return;
      await queryClient.invalidateQueries({
        queryKey: signalQueryKeys.all(context),
      });
      if (!operationIsCurrent(generation, context) || initialConnectorKey !== connectorKey) return;
      clearSelectedThread();
      await queryClient.fetchQuery({ queryKey: signalQueryKeys.overview(context), queryFn: () => fetchEmailOverviewForContext(context), staleTime: 0 });
      if (!operationIsCurrent(generation, context) || initialConnectorKey !== connectorKey) return;
      router.replace({ pathname: "/capability/[slug]", params: { slug: "signal" } });
    } catch (failure) {
      if (operationIsCurrent(generation, context) && initialConnectorKey === connectorKey) notify(messageFor(failure));
    } finally {
      if (generation === operationGeneration.current) setBusy(undefined);
    }
  }

  async function askAssistant() {
    const message = assistantInput.trim();
    if (!message || assistantBusy) return;
    const generation = ++assistantGeneration.current;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    setAssistantBusy(true);
    setAssistantError(undefined);
    setAssistantResponse(undefined);
    try {
      const result = await askEmailAssistantForContext(context, message, randomUUID());
      if (generation !== assistantGeneration.current || !contextIsCurrent(context)) return;
      await invalidateAssistantChanges(queryClient, context, result.changes);
      if (generation !== assistantGeneration.current || !contextIsCurrent(context)) return;
      setAssistantInput("");
      setAssistantResponse(result);
    } catch (failure) {
      if (generation === assistantGeneration.current && contextIsCurrent(context)) setAssistantError(messageFor(failure));
    } finally {
      if (generation === assistantGeneration.current) setAssistantBusy(false);
    }
  }

  const overviewSelectedAccount = overview?.selectedAccount;
  const activeSelectedAccount = overviewSelectedAccount?.connectorKey === initialConnectorKey ? overviewSelectedAccount : selectedAccount;
  const initialSyncPending = Boolean(initialConnectorKey && activeSelectedAccount && !activeSelectedAccount.initialSyncCompleted && activeSelectedAccount.syncStatus !== "error");
  const connected = Boolean(activeSelectedAccount);
  const newEmailBodyTransformation = editorTransformation?.target === "newEmail" ? editorTransformation.action : undefined;
  const newEmailReviewTransformation = editorTransformation?.target === "newEmailReview" ? editorTransformation.action : undefined;
  const draftTransformation = editorTransformation?.target === "draft" ? editorTransformation.action : undefined;
  const replyTransformation = editorTransformation?.target === "reply" ? editorTransformation.action : undefined;
  const inboxQueryPending = inboxControlsQuery !== inboxQuery;
  const inboxEmpty = inboxTab === "drafts"
    ? !draftsQuery.isPending && !draftSearching && !draftSearchError && !visibleInboxDrafts.length
    : !loading && !inboxQueryPending && !initialSyncPending && !loadError && !overview?.threads.length;
  const rootEmpty = rootTab === "inboxes"
    ? !loading && !loadError && !rootSearchError && !(normalizedRootQuery && (rootSearching || rootSearchResults?.tab !== "inboxes")) && !visibleAccounts.length && !visibleUnassignedDrafts.length
    : !tonesLoading && !toneError && !rootSearchError && !(normalizedRootQuery && (rootSearching || rootSearchResults?.tab !== "tones")) && !visibleTones.length;
  const workspaceBusy = Boolean(busy || bulkBusy);
  const sheetTransitionGeneration = formTransitionGeneration.current;
  const formSheet = sheet === "connectForm" || sheet === "toneCreate" || sheet === "inboxEdit" || sheet === "toneEdit";
  const menuSheet = sheet === "rootCreate" || sheet === "plus";
  const hideSheetHeading = menuSheet || sheet === "ai" || sheet === "bulkActions" || sheet === "account" || sheet === "rootFilter" || sheet === "inboxFilter";
  const selectionActive = selectedThreads.length > 0;
  const bulkToolbar = selectionActive ? <Tabs accessibilityLabel="Selected email toolbar" style={styles.bulkToolbar}><View style={styles.bulkToolbarSelection}><Button accessibilityLabel="Clear email selection" contentMode="raw" disabled={bulkBusy} hitSlop={8} onPress={clearThreadSelection} size="xs" style={styles.bulkToolbarClose} variant="secondary"><CloseIcon size="sm" /></Button><Text accessibilityLiveRegion="polite" style={styles.bulkSelectionText}>{selectedThreads.length} selected</Text></View><Button accessibilityLabel="Selected email actions" contentMode="raw" disabled={bulkBusy || bulkActionsLoading} hitSlop={8} onPress={() => void openBulkActions()} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button></Tabs> : null;
  const rootBulkToolbar = selectedInboxes.length ? <Tabs accessibilityLabel="Selected inbox toolbar" style={styles.rootBulkToolbar}><View style={styles.bulkToolbarSelection}><Button accessibilityLabel="Clear inbox selection" contentMode="raw" disabled={rootBulkBusy} hitSlop={8} onPress={clearRootInboxSelection} size="xs" style={styles.bulkToolbarClose} variant="secondary"><CloseIcon size="sm" /></Button><Text accessibilityLiveRegion="polite" style={styles.bulkSelectionText}>{selectedInboxes.length} selected</Text></View><Button accessibilityLabel="Selected inbox actions" contentMode="raw" disabled={rootBulkBusy} hitSlop={8} onPress={() => void openRootBulkActions()} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button></Tabs> : null;
  const inboxActionItems = <>
    {connected && permissions.canMutate ? <BottomSheetItem onPress={openInboxEdit} style={styles.sheetAction} variant="secondary">Edit</BottomSheetItem> : null}
    {connected && permissions.canMutate ? <BottomSheetItem onPress={() => void openTrashRoot()} style={styles.sheetAction} variant="secondary">Trash</BottomSheetItem> : null}
    {!connected && permissions.canManageConnector ? <BottomSheetItem disabled={Boolean(busy)} onPress={openConnectForm} style={styles.sheetAction} variant="secondary">Connect Gmail</BottomSheetItem> : null}
    {connected && permissions.canManageConnector ? <BottomSheetItem onPress={() => { if (newEmailOpen) resetNewEmail(); setSheet("disconnect"); }} style={styles.sheetAction} variant="secondary">Disconnect inbox</BottomSheetItem> : null}
  </>;
  const formFooter = formSheet ? <>
    {sheet !== "toneEdit" || permissions.canMutate ? <Button
      disabled={Boolean(busy) || (sheet === "connectForm" ? !connectName.trim() || !permissions.canManageConnector : sheet === "toneCreate" ? !toneName.trim() || !toneInstruction.trim() || !permissions.canMutate : !metadataName.trim() || !permissions.canMutate || sheet === "toneEdit" && !metadataInstruction.trim())}
      onPress={() => void (sheet === "connectForm" ? connect() : sheet === "toneCreate" ? createTone() : saveMetadata())}
      size="md"
      variant="primary"
    >
      {sheet === "connectForm" ? "Connect" : sheet === "toneCreate" ? "Create tone" : "Save"}
    </Button> : null}
    {sheet === "toneEdit" && permissions.canMutate && !editingTone?.slug ? <Button disabled={Boolean(busy)} onPress={() => setSheet("toneDelete")} size="md" variant="danger">Delete tone</Button> : null}
    <Button disabled={Boolean(busy)} onPress={requestFormClose} size="md" variant="secondary">Close</Button>
  </> : undefined;
  const sheetFooter = sheet === "bulkTrash" ? <>
    <Button disabled={bulkBusy} onPress={() => void runBulkAction("trash")} size="md" variant="primary">Move to trash</Button>
    <Button disabled={bulkBusy} onPress={() => setSheet("bulkActions")} size="md" variant="secondary">Cancel</Button>
  </> : sheet === "trashRoot" ? <>
    {permissions.canManageConnector ? <Button disabled={trashRootLoading || trashClearBusy || !clearableEmailTrashGroups(trashGroups).length} onPress={() => setSheet("clearTrash")} size="md" variant="primary">Clear trash</Button> : null}
    <Button disabled={trashRootLoading || trashClearBusy} onPress={() => setSheetOpen(false)} size="md" variant="secondary">Close</Button>
  </> : formFooter;
  const readerFooter = readerSheet === "translate" ? <>
    <Button disabled={readerLoading} onPress={() => { setTargetLanguage(languageForCountryCode(countryCode)); setReaderSheet("translationForm"); }} size="md" variant="primary">Translate</Button>
    <Button disabled={trashBusy} onPress={closeReaderFlow} size="md" variant="secondary">Close</Button>
  </> : readerSheet === "translationForm" ? <>
    <Button disabled={!permissions.canMutate || readerLoading || targetLanguage.trim().length < 2} onPress={() => void generateTranslation()} size="md" variant="primary">Translate</Button>
    <Button disabled={trashBusy} onPress={closeReaderFlow} size="md" variant="secondary">Close</Button>
  </> : readerSheet === "summaryVersions" ? <>
    <Button disabled={!permissions.canMutate || readerLoading} onPress={() => void generateSummary()} size="md" variant="primary">Summarize</Button>
    <Button disabled={trashBusy} onPress={closeReaderFlow} size="md" variant="secondary">Close</Button>
  </> : readerSheet === "replies" ? <>
    <Button disabled={replySending} onPress={openEmptyReply} size="md" variant="primary">Empty reply</Button>
    <Button disabled={replySending} onPress={closeReaderFlow} size="md" variant="secondary">Close</Button>
  </> : readerSheet === "translationReader" || readerSheet === "summaryReader" || readerSheet === "similar" ? <Button disabled={trashBusy} onPress={closeReaderFlow} size="md" variant="secondary">Close</Button> : undefined;
  const replyEditorFooter = <>
    <Button disabled={replySending || Boolean(replyTransformation) || !replyBody.trim()} onPress={requestSuggestedReplySend} size="md" variant="primary">Reply</Button>
    <Button disabled={replySending || Boolean(replyTransformation)} onPress={closeReplyEditor} size="md" variant="secondary">Close</Button>
  </>;
  return (
    <KeyboardAvoidingView
      behavior={assistantInputFocused ? "height" : Platform.OS === "ios" ? "padding" : undefined}
      style={styles.root}
    >
      <View accessibilityElementsHidden={readerSheetOpen} importantForAccessibility={readerSheetOpen ? "no-hide-descendants" : "auto"} pointerEvents={readerSheetOpen ? "none" : "auto"} style={styles.workspaceSurface}>
      <View style={[styles.globalHeader, { paddingTop: insets.top + 6 }]}>
        <WorkspaceAppSwitcher
          active="signal"
          onBeforeSelect={(slug) => requestExit(slug)}
        />
      </View>
      {initialConnectorKey ? <View style={[styles.localHeader, !selected && styles.inboxHeader]}>
          <Button
            accessibilityLabel={selected ? "Back to inbox" : "Back to Signal root"}
            contentMode="raw"
            hitSlop={6}
            onPress={() => {
              if (selected) {
                if (requestExit("inbox")) clearSelectedThread();
              } else if (requestExit("signal")) returnToSignalRoot();
            }}
            size="xs"
            variant="icon"
          >
            <ChevronLeftIcon size="sm" />
          </Button>

        <Text
          numberOfLines={1}
          style={[styles.localTitle, !selected && styles.inboxTitle, selected && styles.threadHeaderTitle]}
        >
          {selected ? selectedMessage?.subject ?? selected.thread.subject : initialConnectorKey ? selectedAccount?.name ?? "" : "Signal"}
        </Text>
        {!selected ? <View style={styles.localActions}>
          <>
            <Button accessibilityLabel="More inbox actions" contentMode="raw" hitSlop={6} onPress={() => { setSheet("account"); setSheetOpen(true); }} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button>
            <Button
              accessibilityLabel="New email"
              contentMode="raw"
              hitSlop={6}
              onPress={() => {
                setSheet("plus");
                setSheetOpen(true);
              }}
              size="xs"
              variant="icon"
            >
              <PlusIcon size="sm" />
            </Button>
          </>
        </View> : <Button accessibilityLabel="More email actions" contentMode="raw" hitSlop={6} onPress={() => { setSheet("account"); setSheetOpen(true); }} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button>}
      </View> : null}
      {!initialConnectorKey ? (
        <View style={styles.signalRoot}>
          <View style={styles.rootTitleRow}>
            <WorkspaceAppSwitcher active="signal" onBeforeSelect={(slug) => requestExit(slug)} trigger="back" />
            <Text numberOfLines={1} style={styles.rootTitle}>Signal</Text>
            <Button accessibilityLabel="Create in Signal" contentMode="raw" onPress={() => { setSheetError(undefined); setSheet("rootCreate"); setSheetOpen(true); }} size="xs" variant="icon">
              <PlusIcon size="sm" />
            </Button>
          </View>
          {rootBulkToolbar}
          <View style={styles.rootActions}>
            <View style={styles.rootSearch}>
              <SearchIcon size="sm" variant="muted" />
              <TextInput
                accessibilityLabel="Search Signal inboxes and tones"
                editable={rootSearchFocusable}
                focusable={rootSearchFocusable}
                maxLength={500}
                onChangeText={setRootQuery}
                onSubmitEditing={() => setRootQuery((current) => current.trim())}
                placeholder="Search..."
                ref={rootSearchInputRef}
                returnKeyType="search"
                style={styles.searchInput}
                value={rootQuery}
              />
              {rootQuery ? (
                <Button accessibilityLabel="Clear Signal search" contentMode="raw" hitSlop={8} iconOnly onPress={() => setRootQuery("")} size="xs" variant="secondary">
                  <CloseIcon size="sm" />
                </Button>
              ) : null}
            </View>
            <Button accessibilityLabel="Filter Signal" contentMode="raw" onPress={() => { setSheetError(undefined); setSheet("rootFilter"); setSheetOpen(true); }} size="sm" style={styles.rootMenuButton} variant="icon">
              <FilterIcon size="sm" variant={rootFavoritesOnly ? "accent" : "default"} />
            </Button>
          </View>
          <View style={styles.rootContent}>
            <Tabs accessibilityLabel="Signal root categories" accessibilityRole="tablist" style={styles.rootTabs}>
              <Button accessibilityRole="tab" accessibilityState={{ selected: rootTab === "inboxes" }} onPress={() => setRootTab("inboxes")} size="xs" style={styles.rootTab} variant={rootTab === "inboxes" ? "secondary" : "ghost"}>Inboxes</Button>
              <Button accessibilityRole="tab" accessibilityState={{ selected: rootTab === "tones" }} onPress={() => setRootTab("tones")} size="xs" style={styles.rootTab} variant={rootTab === "tones" ? "secondary" : "ghost"}>Tones</Button>
            </Tabs>
          <ScrollView
            accessibilityLabel={rootTab === "inboxes" ? "Signal inboxes" : "Signal tones"}
            contentContainerStyle={[styles.rootGrid, { paddingBottom: insets.bottom + spacing.xl }, rootTab === "inboxes"
              ? !loading && !loadError && !visibleAccounts.length && styles.emptyGrid
              : !tonesLoading && !toneError && !visibleTones.length && styles.emptyGrid]}
            onLayout={({ nativeEvent }) => setRootGridWidth(nativeEvent.layout.width)}
            scrollEnabled={!rootEmpty}
            showsVerticalScrollIndicator={false}
            style={styles.rootScroll}
          >
            {rootTab === "inboxes" ? loading || normalizedRootQuery && (rootSearching || rootSearchResults?.tab !== "inboxes") ? Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Loading Signal cards" accessibilityRole="progressbar" key={index} style={[styles.rootCardSkeleton, { width: rootCardSize, height: rootCardSize }]} />) : (
              <>
                {loadError ? <View accessibilityRole="alert" style={styles.rootInlineNotice}><Text style={styles.inlineNoticeText}>{loadError}</Text><Button onPress={() => void load()} size="md" variant="secondary">Retry</Button></View> : null}
                {rootSearchError ? <View accessibilityRole="alert" style={styles.rootInlineNotice}><Text style={styles.inlineNoticeText}>{rootSearchError}</Text></View> : null}
                {visibleAccounts.map((account) => { const accountSelected = selectedInboxes.some(({ connectorKey }) => connectorKey === account.connectorKey); return (
                  <View key={account.key} style={[styles.rootCard, accountSelected && styles.rootCardSelected, { width: rootCardSize, height: rootCardSize }]}>
                    {account.coverUrl ? <Image contentFit="cover" source={account.coverUrl} style={StyleSheet.absoluteFill} /> : null}
                  <Button
                    accessibilityActions={permissions.canMutate ? [{ name: "longpress", label: accountSelected ? `Deselect ${account.name}` : `Select ${account.name}` }] : undefined}
                    accessibilityLabel={`${selectedInboxes.length ? accountSelected ? "Deselect" : "Select" : "Open"} ${account.email} inbox${account.isFavorite ? ", Favorite" : ""}`}
                    accessibilityState={{ selected: accountSelected }}
                    contentMode="raw"
                    disabled={rootBulkBusy}
                    onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") handleRootInboxLongPress(account); }}
                    onLongPress={permissions.canMutate ? () => handleRootInboxLongPress(account) : undefined}
                    onPress={() => handleRootInboxPress(account)}
                    shape="rounded"
                    size="xl"
                    style={[styles.rootCardMain, account.coverUrl && styles.coveredCardMain]}
                    variant="ghost"
                  >
                    {account.coverUrl ? null : <InboxIcon size="lg" />}
                    <Text ellipsizeMode="tail" numberOfLines={1} style={[styles.rootCardTitle, account.coverUrl && styles.coveredCardLabel]}>{account.name}</Text>
                  </Button>
                  </View>
                ); })}
                {!loadError && !rootSearchError && !visibleAccounts.length && normalizedRootQuery ? <Text style={styles.rootEmpty}>No inboxes matched this search.</Text> : null}
                {!loadError && !visibleAccounts.length && !normalizedRootQuery ? (
                  <View style={styles.rootEmptyState}>
                    <Text style={styles.rootEmpty}>{rootFavoritesOnly ? "No favorite inboxes." : "No connected inbox yet."}</Text>
                    {permissions.canManageConnector ? <Button accessibilityLabel="Connect Gmail" contentMode="raw" onPress={openConnectForm} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : <Text style={styles.rootEmptyHelp}>Ask an organization administrator to connect an inbox.</Text>}
                  </View>
                ) : null}
              </>
            ) : tonesLoading || normalizedRootQuery && (rootSearching || rootSearchResults?.tab !== "tones") ? Array.from({ length: 3 }, (_, index) => (
              <Skeleton accessibilityLabel="Loading Signal tones" accessibilityRole="progressbar" key={index} style={{ width: rootCardSize, height: rootCardSize }} />
            )) : rootSearchError ? <View accessibilityRole="alert" style={styles.rootToneError}><Text style={styles.rootEmpty}>{rootSearchError}</Text></View> : toneError && !toneRecords.length ? (
              <View accessibilityRole="alert" style={styles.rootToneError}>
                <Text style={styles.rootEmpty}>{toneError}</Text>
                <Button onPress={() => void metadataQuery.refetch()} size="md" variant="secondary">Retry tones</Button>
              </View>
            ) : <>{toneError ? <View accessibilityRole="alert" style={styles.rootToneError}><Text style={styles.rootEmpty}>{toneError}</Text><Button onPress={() => void metadataQuery.refetch()} size="md" variant="secondary">Retry tones</Button></View> : null}{visibleTones.length ? visibleTones.map((record) => (
              <View key={record.key} style={[styles.rootCard, { width: rootCardSize, height: rootCardSize }]}>
              <Button
                accessibilityLabel={`${permissions.canMutate ? "Edit" : "View"} ${record.name} email tone${record.isFavorite ? ", Favorite" : ""}`}
                contentMode="raw"
                disabled={record.key.startsWith("optimistic-tone-")}
                onPress={() => openToneEdit(record)}
                shape="rounded"
                size="xl"
                style={styles.rootCardMain}
                variant="ghost"
              >
                <MailIcon size="lg" />
                <Text ellipsizeMode="tail" numberOfLines={1} style={styles.rootCardTitle}>{record.name}</Text>
              </Button>
              </View>
            )) : normalizedRootQuery ? <Text style={styles.rootEmpty}>No tones matched this search.</Text> : (
              <View style={styles.rootEmptyState}>
                <Text style={styles.rootEmpty}>{rootFavoritesOnly ? "No favorite tones." : "No tones yet."}</Text>
                {permissions.canMutate ? <Button accessibilityLabel="Create email tone" contentMode="raw" onPress={openToneCreate} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : <Text style={styles.rootEmptyHelp}>Ask a scope moderator to create an email tone.</Text>}
              </View>
            )}</>}
          </ScrollView>
          </View>
        </View>
      ) : null}

      {initialConnectorKey && !selected ? (
        <View style={styles.inbox}>
          <View style={styles.inboxActions}>
            <View accessibilityState={{ busy: busy === "sync" }} style={styles.searchBox}>
              <SearchIcon size="sm" variant="muted" />
              <TextInput accessibilityLabel={inboxTab === "drafts" ? "Search drafts" : "Search email"} editable={!workspaceBusy} onChangeText={setQuery} onSubmitEditing={() => void search(query, false)} placeholder="Search..." returnKeyType="search" style={styles.searchInput} value={query} />
              {query.trim() ? <Button accessibilityLabel="Clear email search" contentMode="raw" hitSlop={8} iconOnly onPress={() => { setQuery(""); void search("", false); }} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}
            </View>
            <Button accessibilityLabel="Filter inbox" contentMode="raw" onPress={() => { setSheet("inboxFilter"); setSheetOpen(true); }} size="sm" style={styles.inboxFilterButton} variant="icon"><FilterIcon size="sm" variant={inboxControlsQuery.facets.length ? "accent" : "default"} /></Button>
          </View>
          {bulkToolbar}
          <View style={styles.categoryTabsFrame}>
            <Tabs accessibilityLabel="Email read state" accessibilityRole="tablist" style={styles.categoryTabs}>
              {(["read", "unread"] as const).map((readState) => <Button accessibilityRole="tab" accessibilityState={{ selected: inboxTab === readState }} key={readState} onPress={() => chooseReadState(readState)} size="xs" style={styles.categoryTab} variant={inboxTab === readState ? "secondary" : "ghost"}>{readState === "read" ? "Read" : "Unread"}</Button>)}
              <Button accessibilityRole="tab" accessibilityState={{ selected: inboxTab === "drafts" }} onPress={() => { setInboxTab("drafts"); setSelectedThreads([]); }} size="xs" style={styles.categoryTab} variant={inboxTab === "drafts" ? "secondary" : "ghost"}>Drafts</Button>
            </Tabs>
          </View>
          {inboxTab !== "drafts" && loadError ? <View accessibilityRole="alert" style={styles.inlineNotice}><Text style={styles.inlineNoticeText}>{loadError}</Text>{retryInboxQuery ? <Button onPress={() => void changeInboxQuery(retryInboxQuery)} size="md" variant="secondary">Retry</Button> : null}</View> : null}
          {inboxTab !== "drafts" && activeSelectedAccount?.syncStatus === "error" && !activeSelectedAccount.initialSyncCompleted ? <View accessibilityRole="alert" style={styles.inlineNotice}><Text style={styles.inlineNoticeText}>{activeSelectedAccount.syncError ?? "Initial inbox sync failed and will retry automatically."}</Text></View> : null}
          {inboxTab === "drafts" && draftsQuery.error ? <View accessibilityRole="alert" style={styles.inlineNotice}><Text style={styles.inlineNoticeText}>{messageFor(draftsQuery.error)}</Text><Button onPress={() => void draftsQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : null}
          {inboxTab === "drafts" && draftSearchError ? <View accessibilityRole="alert" style={styles.inlineNotice}><Text style={styles.inlineNoticeText}>{draftSearchError}</Text></View> : null}
          {selectionNotice ? <Text accessibilityLiveRegion="assertive" style={styles.selectionNotice}>{selectionNotice}</Text> : null}
          <ScrollView
            contentContainerStyle={[
              styles.threadList,
              { paddingBottom: insets.bottom + spacing.xl },
            ]}
            onScroll={({ nativeEvent }) => {
              if (inboxTab !== "drafts" && isNearScrollEnd({ offset: nativeEvent.contentOffset.y, viewport: nativeEvent.layoutMeasurement.height, content: nativeEvent.contentSize.height })) void loadMore();
            }}
            scrollEnabled={!inboxEmpty}
            scrollEventThrottle={120}
            showsVerticalScrollIndicator={false}
          >
            {inboxTab === "drafts" ? draftsQuery.isPending || draftSearching || Boolean(normalizedInboxSearch && !activeDraftSearchResults) ? Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Loading drafts" accessibilityRole="progressbar" key={index} style={styles.threadRowSkeleton} />) : visibleInboxDrafts.map((saved) => <Button accessibilityLabel={`${saved.variant === "new" ? saved.subject : "Reply"}, to ${saved.to.join(", ")}`} contentMode="raw" key={saved.key} onPress={() => openInboxDraft(saved)} shape="pill" size="sm" style={styles.threadCard} variant="secondary"><MailIcon size="sm" /><View style={styles.threadBody}><Text numberOfLines={1} style={styles.subject}>{saved.variant === "new" ? saved.subject : "Reply"}</Text><Text numberOfLines={1} style={styles.rowSubtitle}>To: {saved.to.join(", ")}</Text></View></Button>) : loading || inboxQueryPending || initialSyncPending ? Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Loading inbox messages" accessibilityRole="progressbar" key={index} style={styles.threadRowSkeleton} />) : overview?.threads.map((thread) => (
              <Button
                accessibilityActions={[{ name: "longpress", label: selectedThreads.some(({ key }) => key === thread.key) ? `Deselect ${thread.subject}` : `Select ${thread.subject}` }]}
                accessibilityLabel={`${!thread.isRead ? "Unread, " : ""}${shortAddress(thread.latestFrom)}, ${thread.subject}`}
                accessibilityState={{ selected: selectedThreads.some(({ key }) => key === thread.key) }}
                contentMode="raw"
                disabled={bulkBusy}
                key={thread.key}
                onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") { toggleThreadSelection(thread); void Haptics.selectionAsync(); } }}
                onLongPress={() => handleThreadLongPress(thread)}
                onPress={() => handleThreadPress(thread)}
                shape="pill"
                size="sm"
                style={[
                  styles.threadCard,
                  selectedThreads.some(({ key }) => key === thread.key) && styles.threadCardSelected,
                ]}
                variant={selectedThreads.some(({ key }) => key === thread.key) ? "ghost" : "secondary"}
              >
                <MailIcon size="sm" />
                <View style={styles.threadBody}>
                  <Text numberOfLines={1} style={[styles.subject, !thread.isRead && styles.subjectUnread]}>
                    {thread.subject}
                  </Text>
                </View>
              </Button>
            ))}
            {inboxTab === "drafts" && !draftsQuery.isPending && !draftSearching && !draftsQuery.error && !draftSearchError && !visibleInboxDrafts.length ? <View style={styles.empty}><Text style={styles.centerText}>{normalizedInboxSearch ? "No drafts matched this search." : "No drafts here yet."}</Text></View> : null}
            {inboxTab !== "drafts" && !loading && !inboxQueryPending && !initialSyncPending && !loadError && !overview?.threads.length ? (
              <View style={styles.empty}>
                <Text style={styles.centerText}>
                  {inboxQuery.search
                    ? "No messages matched this search."
                    : inboxQuery.facets.length === 0 ? "Choose one or more facets to show messages." : "No messages match these filters."}
                </Text>
              </View>
            ) : null}
            {inboxTab !== "drafts" && loadingMoreThreads ? <Skeleton accessibilityLabel="Loading more messages" accessibilityRole="progressbar" style={styles.paginationSkeleton} /> : null}
          </ScrollView>
        </View>
      ) : null}

      {selected ? (
        <View style={styles.detail}>
          <View style={styles.detailContent}>
            <View style={styles.readerActions}><Button accessibilityLabel="Open Signal AI Brain menu" contentMode="raw" onPress={() => { setSheetError(undefined); setSheet("ai"); setSheetOpen(true); }} size="sm" variant="icon"><BrainIcon size="sm" /></Button>{selected.messages.length > 1 ? <Button accessibilityLabel={`Open thread with ${selected.messages.length} messages`} contentMode="raw" onPress={() => setThreadSheetOpen(true)} size="sm" variant="icon"><ChatBubbleIcon size="sm" /></Button> : null}<Button accessibilityLabel="Open received attachments" contentMode="raw" onPress={() => void openReceivedAttachments()} size="sm" variant="icon"><FileIcon size="sm" /></Button></View>
            {openingThreadKey === selected.thread.key && !selectedMessage ? <View accessibilityLabel={`Loading ${selected.thread.subject}`} accessibilityRole="progressbar" style={[styles.readerDocument, styles.readerSkeleton]}><Skeleton style={styles.readerBodySkeleton} /></View> : selectedMessage ? <View accessibilityLabel={`Email: ${selectedMessage.subject}`} style={styles.readerDocument}>
              <ScrollView contentContainerStyle={[styles.readerDocumentContent, { paddingBottom: insets.bottom + spacing.lg }]} showsVerticalScrollIndicator={false}>
                <View style={styles.messageHeader}><Text selectable style={styles.messageAddress}>{selectedMessage.from}</Text><Text accessibilityLabel={`Sent ${formatEmailTimestamp(selectedMessage.sentAt)}`} style={styles.messageTime}>{formatEmailTimestamp(selectedMessage.sentAt)}</Text></View>
                <Text selectable style={styles.messageSubject}>{selectedMessage.subject}</Text>
                <Text selectable style={styles.readerBody}>{selectedMessage.body}</Text>
                {selectedMessage.attachmentAvailability === "truncated" || selectedMessage.attachmentAvailability === "failed" || (selectedMessage.hasAttachments && !selectedMessage.attachments?.length) ? <View accessibilityLabel="Some email attachment details are unavailable" style={styles.attachmentLabel}><FileIcon size="sm" variant="muted" /><Text style={styles.attachmentText}>{selectedMessage.unavailableAttachmentCount ? `${selectedMessage.unavailableAttachmentCount} attachment${selectedMessage.unavailableAttachmentCount === 1 ? "" : "s"} unavailable` : "Attachment details unavailable"}</Text></View> : null}
              </ScrollView>
            </View> : null}
          </View>
        </View>
      ) : null}

      <CoreComposer
        accessibilityHint="Ask a question or describe an action for your Signal email workspace"
        accessibilityLabel="Ask Core about your Signal"
        disabled={assistantBusy}
        editable={!assistantBusy}
        leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />}
        loading={assistantBusy}
        maxLength={8_000}
        message={<>
          {assistantError ? <Text accessibilityRole="alert" style={styles.aiComposerError}>{assistantError}</Text> : null}
          {assistantResponse ? <Text numberOfLines={4} style={styles.aiResponse}>{assistantResponse.message}</Text> : null}
        </>}
        onChangeText={(value) => { setAssistantInput(value); if (assistantError) setAssistantError(undefined); }}
        onFocusChange={(focused) => {
          if (rootSearchFocusTimer.current) clearTimeout(rootSearchFocusTimer.current);
          rootSearchInputRef.current?.blur();
          Keyboard.dismiss();
          setRootSearchFocusable(false);
          if (!focused) {
            rootSearchFocusTimer.current = setTimeout(() => {
              rootSearchInputRef.current?.blur();
              Keyboard.dismiss();
              setRootSearchFocusable(true);
            }, 300);
          }
          setAssistantInputFocused(focused);
          if (!focused) {
            setAssistantResponse(undefined);
            setAssistantError(undefined);
          }
        }}
        onSubmit={() => void askAssistant()}
        prompts={CORE_PROMPTS}
        sendIcon={<SendIcon size="sm" variant="inverse" />}
        style={styles.signalComposer}
        value={assistantInput}
      />

      <BottomSheet footer={<Button disabled={threadPageLoading} onPress={() => setThreadSheetOpen(false)} size="md" variant="secondary">Close</Button>} height="full" onOpenChange={(open) => setThreadSheetOpen(open)} open={threadSheetOpen && Boolean(selected)} title="Thread">
        <ScrollView accessibilityLabel="Email thread messages" accessibilityLiveRegion="polite" accessibilityState={{ busy: threadPageLoading }} contentContainerStyle={[styles.threadMessageList, !threadPageLoading && !orderedThreadMessages.length && styles.sheetEmptyContent]} onScroll={({ nativeEvent }) => { if (isNearScrollEnd({ offset: nativeEvent.contentOffset.y, viewport: nativeEvent.layoutMeasurement.height, content: nativeEvent.contentSize.height })) void loadMoreThreadMessages(); }} scrollEventThrottle={120} showsVerticalScrollIndicator={false}>
          {orderedThreadMessages.map((message) => { const current = message.key === selectedMessage?.key; return <Button accessibilityLabel={`${current ? "Current message, " : ""}${message.fromName ?? shortAddress(message.from)}, ${message.subject}, ${formatEmailTimestamp(message.sentAt)}`} accessibilityState={{ selected: current }} contentMode="raw" key={message.key} onPress={() => { setSelectedMessageKey(message.key); setThreadSheetOpen(false); }} shape="pill" size="md" style={[styles.threadMessagePill, current && styles.threadMessagePillSelected]} variant={current ? "ghost" : "secondary"}><MailIcon size="sm" /><View style={styles.threadMessageCopy}><View style={styles.threadMessageMeta}><Text numberOfLines={1} style={styles.threadMessageSender}>{message.fromName ?? shortAddress(message.from)}</Text><Text style={styles.threadMessageTime}>{formatEmailTimestamp(message.sentAt)}</Text></View><Text numberOfLines={1} style={styles.threadMessageSubject}>{message.subject}</Text></View></Button>; })}
          {threadPageLoading ? <Skeleton accessibilityLabel="Loading more thread messages" accessibilityRole="progressbar" style={styles.threadMessageSkeleton} /> : null}
          {!threadPageLoading && !orderedThreadMessages.length ? <Text style={styles.centerText}>No messages in this thread.</Text> : null}
        </ScrollView>
      </BottomSheet>

      <BottomSheet footer={<Button disabled={receivedAttachmentsLoading} onPress={() => setAttachmentsOpen(false)} size="md" variant="secondary">Close</Button>} height="full" onOpenChange={(open) => setAttachmentsOpen(open)} open={attachmentsOpen && Boolean(selectedMessage)} title="Received attachments">
        <ScrollView accessibilityLabel="Received email attachments" accessibilityLiveRegion="polite" accessibilityState={{ busy: receivedAttachmentsLoading }} contentContainerStyle={[styles.receivedAttachmentContent, !receivedAttachmentsLoading && !receivedAttachmentsError && !receivedAttachments.length && styles.sheetEmptyContent]} showsVerticalScrollIndicator={false}>
          {receivedAttachmentsError ? <View accessibilityRole="alert" style={styles.sheetError}><Text style={styles.sheetErrorText}>{receivedAttachmentsError}</Text><Button onPress={() => void openReceivedAttachments()} size="md" variant="secondary">Retry</Button></View> : null}
          <View onLayout={({ nativeEvent }) => setReceivedAttachmentGridWidth(nativeEvent.layout.width)} style={styles.receivedAttachmentGrid}>
          {receivedAttachmentsLoading ? Array.from({ length: 4 }, (_, index) => <Skeleton accessibilityLabel="Loading received attachments" accessibilityRole="progressbar" key={index} style={[styles.receivedAttachmentCard, { width: receivedAttachmentCardSize, height: receivedAttachmentCardSize }]} />) : receivedAttachments.map((attachment) => { const label = attachment.kind === "document" ? attachment.document.name : attachment.image.filename; return <Button accessibilityLabel={`Open ${attachment.kind === "document" ? "Archive" : "Gallery"} attachment ${label}`} contentMode="raw" key={attachmentIdentity(attachment.ref)} onPress={() => openReceivedAttachment(attachment)} shape="rounded" size="md" style={[styles.receivedAttachmentCard, { width: receivedAttachmentCardSize, height: receivedAttachmentCardSize }]} variant="ghost">{attachment.kind === "image" ? <Image contentFit="cover" source={attachment.image.url} style={styles.receivedAttachmentImage} transition={150} /> : <FileIcon size="lg" />}<Text ellipsizeMode="tail" numberOfLines={1} style={[styles.receivedAttachmentLabel, attachment.kind === "image" && styles.receivedAttachmentImageLabel]}>{label}</Text></Button>; })}
          </View>
          {!receivedAttachmentsLoading && !receivedAttachmentsError && !receivedAttachments.length ? <Text style={styles.centerText}>No received attachments.</Text> : null}
        </ScrollView>
      </BottomSheet>

      <BottomSheet hideHeading onOpenChange={setRootBulkMenuOpen} open={rootBulkMenuOpen && selectedInboxes.length > 0} title="Selected inbox actions"><View style={styles.sheetItems}><BottomSheetItem disabled={rootBulkBusy || !permissions.canMutate} onPress={() => { setRootBulkMenuOpen(false); void setSelectedInboxesFavorite(); }} style={styles.sheetAction} variant="secondary">{selectedInboxes.every(({ isFavorite }) => isFavorite) ? "Unfavorite" : "Favorite"}</BottomSheetItem>{permissions.canManageConnector ? <BottomSheetItem disabled={rootBulkBusy} onPress={() => { setRootBulkMenuOpen(false); setRootDisconnectOpen(true); }} style={styles.sheetAction} variant="secondary">Disconnect</BottomSheetItem> : null}</View></BottomSheet>
      <BottomSheet dismissible={!rootBulkBusy} onOpenChange={(open) => { if (!open && !rootBulkBusy) setRootDisconnectOpen(false); }} open={rootDisconnectOpen && selectedInboxes.length > 0} title={`Disconnect ${selectedInboxes.length === 1 ? "inbox" : `${selectedInboxes.length} inboxes`}?`}><View style={styles.sheetItems}><Text style={styles.confirmText}>This removes the selected Signal inbox connection and local Signal data. It does not delete messages from Gmail.</Text><Button disabled={rootBulkBusy} onPress={() => void performRootInboxDisconnect()} size="md" variant="danger">Disconnect</Button><Button disabled={rootBulkBusy} onPress={() => setRootDisconnectOpen(false)} size="md" variant="secondary">Cancel</Button></View></BottomSheet>

      <SearchHistorySheet error={searchHistoryError} history={searchHistory} loading={searchHistoryLoading} onClose={closeSearchHistory} onRemove={(item) => void removeSearchHistory(item)} onSelect={applySearchHistory} open={sheetOpen && sheet === "searchHistory"} removingQuery={removingHistoryQuery} />
      <BottomSheet
        description={selectedInboxDraft ? `To: ${selectedInboxDraft.to.join(", ")}` : undefined}
        dismissible={!draftSending && !draftTransformation}
        footer={<><Button disabled={draftSending || Boolean(draftTransformation) || !selectedInboxDraft || !draftBody.trim()} onPress={() => void sendInboxDraft()} size="md" variant="primary">Send</Button><Button disabled={draftSending || Boolean(draftTransformation)} onPress={() => { setSelectedInboxDraftKey(undefined); setDraftBody(""); }} size="md" variant="secondary">Close</Button></>}
        height="full"
        onOpenChange={(open) => { if (!open && !draftSending && !draftTransformation) { setSelectedInboxDraftKey(undefined); setDraftBody(""); } }}
        open={Boolean(selectedInboxDraftKey)}
        title={selectedInboxDraft?.variant === "new" ? selectedInboxDraft.subject : "Reply"}
      >
        {draftDetailQuery.isPending ? <Skeleton accessibilityLabel="Loading draft" accessibilityRole="progressbar" style={styles.readerBodySkeleton} /> : draftDetailQuery.error ? <View accessibilityRole="alert" style={styles.sheetError}><Text style={styles.sheetErrorText}>{messageFor(draftDetailQuery.error)}</Text></View> : <ScrollView contentContainerStyle={styles.generatedReader} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><AiTextEditor accessibilityLabel="Draft email text" editable={!draftSending && !draftTransformation} maxLength={50_000} multiline onChangeText={setDraftBody} onOpenActions={() => openEmailEditorActions("draft")} style={styles.draftEditor} textAlignVertical="top" transformation={draftTransformation} value={draftBody} /></ScrollView>}
      </BottomSheet>
      <BottomSheet
        dismissible={!busy && !trashRootLoading && !trashClearBusy}
        footer={sheetFooter}
        hideCloseButton={menuSheet}
        hideHeading={hideSheetHeading}
        height={sheet === "trashRoot" || formSheet ? "full" : undefined}
        key={sheetTransitionGeneration}
        onOpenChange={(open) => {
          if (sheetTransitionGeneration !== formTransitionGeneration.current) return;
          if (!open && formSheet) requestFormClose();
          else setSheetOpen(open);
        }}
        open={sheetOpen && sheet !== "searchHistory"}
        title={
          sheet === "toneCreate"
                ? "Create email tone"
                : sheet === "connectForm"
                  ? "Connect Gmail"
                : sheet === "inboxEdit"
                  ? "Edit inbox"
                : sheet === "toneEdit"
                    ? permissions.canMutate ? "Edit email tone" : "View email tone"
                : sheet === "toneDelete"
                  ? "Delete email tone?"
             : sheet === "ai"
              ? "AI actions"
              : sheet === "plus"
                ? "Create"
                : sheet === "disconnect"
                    ? "Disconnect inbox?"
                    : sheet === "bulkActions" ? ""
                        : sheet === "bulkTrash" ? "Move to Trash?"
                          : sheet === "trashRoot" ? "Trash"
                            : sheet === "clearTrash" ? "Clear trash?"
                               : sheet === "rootCreate" ? "Create" : sheet === "rootFilter" || sheet === "inboxFilter" ? "" : sheet === "account" ? "" : selected ? "Email actions" : "Inbox actions"
        }
      >
        {sheetError ? (
          <View accessibilityRole="alert" style={styles.sheetError}>
            <Text style={styles.sheetErrorText}>{sheetError}</Text>
          </View>
        ) : null}
        {sheet === "inboxFilter" ? (
          <View style={styles.rootFilterPanel}>
            {INBOX_FACETS.map(({ facet, label }) => <View key={facet} style={styles.favoriteRow}><Switch accessibilityLabel={`Filter ${label} email`} checked={inboxControlsQuery.facets.includes(facet)} onCheckedChange={() => toggleFacet(facet)} /><Text style={styles.favoriteLabel}>{label}</Text></View>)}
            <Button onPress={() => void openSearchHistory()} size="md" style={styles.searchHistoryOption} variant="secondary">Search history</Button>
          </View>
        ) : sheet === "rootFilter" ? (
          <View style={styles.rootFilterPanel}>
            <View style={styles.favoriteRow}>
              <Switch accessibilityLabel="Show only favorite Signal items" checked={rootFavoritesOnly} onCheckedChange={(checked) => { setRootFavoritesOnly(checked); setSheetOpen(false); }} />
              <Text style={styles.favoriteLabel}>Favorites</Text>
            </View>
            <Button onPress={() => void openSearchHistory()} size="md" style={styles.searchHistoryOption} variant="secondary">Search history</Button>
          </View>
        ) : sheet === "toneDelete" ? (
          <View style={styles.sheetItems}><Text style={styles.confirmText}>This permanently deletes the custom email tone.</Text><Button onPress={() => void deleteTone()} size="md" variant="danger">Delete tone</Button><Button onPress={() => setSheet("toneEdit")} size="md" variant="secondary">Cancel</Button></View>
        ) : sheet === "rootCreate" ? (
          <View style={styles.sheetItems}>
            <BottomSheetItem disabled={!permissions.canMutate} onPress={openToneCreate} style={styles.sheetAction} variant="secondary">Create email tone</BottomSheetItem>
            <BottomSheetItem onPress={openReplyContexts} style={styles.sheetAction} variant="secondary">Reply context</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(busy) || !permissions.canManageConnector} onPress={openConnectForm} style={styles.sheetAction} variant="secondary">Connect Gmail</BottomSheetItem>
          </View>
        ) : sheet === "trashRoot" ? (
          <ScrollView contentContainerStyle={styles.trashRootContent} showsVerticalScrollIndicator={false}>
            {trashRootError ? <View accessibilityRole="alert" style={styles.sheetError}><Text style={styles.sheetErrorText}>{trashRootError}</Text><Button onPress={() => void openTrashRoot()} size="md" variant="secondary">Retry</Button></View> : null}
            {trashRootLoading ? Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Loading Trash" accessibilityRole="progressbar" key={index} style={styles.threadRowSkeleton} />) : null}
            {!trashRootLoading && !trashRootError && !trashGroups.some(({ threads, error }) => threads.length || error) ? <View style={styles.empty}><Text style={styles.centerText}>Trash is empty.</Text></View> : null}
            {trashGroups.flatMap(({ threads }) => threads).map((thread) => <Button accessibilityLabel={`${!thread.isRead ? "Unread, " : ""}${shortAddress(thread.latestFrom)}, ${thread.subject}`} contentMode="raw" key={thread.key} onPress={() => { setSheetOpen(false); void openThread(thread); }} shape="pill" size="sm" style={styles.threadCard} variant="secondary"><MailIcon size="sm" /><View style={styles.threadBody}><Text numberOfLines={1} style={[styles.subject, !thread.isRead && styles.subjectUnread]}>{thread.subject}</Text></View></Button>)}
          </ScrollView>
        ) : sheet === "clearTrash" ? (
          <View style={styles.sheetItems}><Button disabled={trashClearBusy} onPress={() => void clearTrash()} size="md" variant="primary">Clear trash</Button><Button disabled={trashClearBusy} onPress={() => setSheet("trashRoot")} size="md" variant="secondary">Close</Button></View>
        ) : sheet === "connectForm" ? (
          <ScrollView contentContainerStyle={styles.metadataForm} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.formScroll}>
            <Text style={styles.inputLabel}>Inbox name</Text>
            <TextInput accessibilityLabel="Inbox name" editable={!busy} maxLength={255} onChangeText={setConnectName} placeholder="Inbox name" ref={sheetInputRef} value={connectName} />
            <Text style={styles.inputLabel}>Description (Optional)</Text>
            <TextInput accessibilityLabel="Inbox description" editable={!busy} maxLength={10000} multiline onChangeText={setConnectDescription} placeholder="What belongs in this inbox?" style={styles.metadataDescriptionInput} textAlignVertical="top" value={connectDescription} />
          </ScrollView>
        ) : sheet === "toneCreate" ? (
          <ScrollView contentContainerStyle={styles.metadataForm} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.formScroll}>
            <Text style={styles.inputLabel}>Tone name</Text>
            <TextInput accessibilityLabel="Tone name" editable={!busy} maxLength={255} onChangeText={setToneName} placeholder="Tone name" ref={sheetInputRef} value={toneName} />
            <Text style={styles.inputLabel}>Writing instruction</Text>
            <TextInput accessibilityLabel="Tone writing instruction" editable={!busy} maxLength={20000} multiline onChangeText={setToneInstruction} placeholder="Describe how emails should be written" style={styles.metadataInstructionInput} textAlignVertical="top" value={toneInstruction} />
          </ScrollView>
        ) : sheet === "inboxEdit" || sheet === "toneEdit" ? (
          <ScrollView contentContainerStyle={[styles.metadataForm, sheet === "inboxEdit" && styles.inboxEditForm]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.inputLabel}>{sheet === "inboxEdit" ? "Inbox name" : "Tone name"}</Text>
            <TextInput accessibilityLabel={sheet === "inboxEdit" ? "Inbox name" : "Tone name"} editable={permissions.canMutate && !busy} maxLength={255} onChangeText={setMetadataName} placeholder={sheet === "inboxEdit" ? "Inbox name" : "Tone name"} ref={sheetInputRef} value={metadataName} />
            {sheet === "inboxEdit" ? <>
              <Text style={styles.inputLabel}>Description (Optional)</Text>
              <TextInput accessibilityLabel="Inbox description" editable={permissions.canMutate && !busy} maxLength={10000} multiline onChangeText={setMetadataDescription} placeholder="Description" style={styles.metadataDescriptionInput} textAlignVertical="top" value={metadataDescription} />
            </> : null}
            {sheet === "toneEdit" ? <>
              <Text style={styles.inputLabel}>Writing instruction</Text>
              <TextInput accessibilityLabel="Tone writing instruction" editable={permissions.canMutate && !busy} maxLength={20000} multiline onChangeText={setMetadataInstruction} placeholder="Describe how emails should be written" style={styles.metadataInstructionInput} textAlignVertical="top" value={metadataInstruction} />
            </> : null}
            {sheet === "inboxEdit" ? <View style={styles.metadataCoverControl}>
              <Button accessibilityLabel={(metadataCoverAsset === undefined ? selectedAccount?.coverUrl : metadataCoverAsset?.uri) ? "Change cover" : "Set cover"} contentMode="raw" disabled={Boolean(busy) || !permissions.canMutate} onPress={() => void chooseMetadataCover()} shape="rounded" size="md" style={styles.metadataCoverButton} variant="secondary">
                {(metadataCoverAsset === undefined ? selectedAccount?.coverUrl : metadataCoverAsset?.uri)
                  ? <Image contentFit="cover" source={metadataCoverAsset === undefined ? selectedAccount?.coverUrl : metadataCoverAsset?.uri} style={StyleSheet.absoluteFill} />
                  : <InboxIcon size="lg" />}
              </Button>
              {(metadataCoverAsset === undefined ? selectedAccount?.coverUrl : metadataCoverAsset?.uri) ? <Button accessibilityLabel="Remove cover" contentMode="raw" disabled={Boolean(busy) || !permissions.canMutate} iconOnly onPress={() => setMetadataCoverAsset(null)} size="md" style={styles.metadataCoverRemove} variant="secondary"><CloseIcon size="sm" /></Button> : null}
            </View> : null}
            <View style={styles.favoriteRow}><Switch accessibilityLabel={sheet === "toneEdit" ? "Favorite tone" : "Favorite inbox"} checked={metadataFavorite} disabled={!permissions.canMutate || Boolean(busy)} onCheckedChange={setMetadataFavorite} /><Text style={styles.favoriteLabel}>Favorite</Text></View>
          </ScrollView>
        ) : sheet === "ai" ? (
          <View style={styles.sheetItems}>
            {selected ? (
              <>
                <BottomSheetItem disabled={Boolean(busy)} onPress={() => void openReaderFlow("translate")} style={styles.sheetAction} variant="secondary">Translate</BottomSheetItem>
                <BottomSheetItem disabled={Boolean(busy)} onPress={() => void openReaderFlow("summaryVersions")} style={styles.sheetAction} variant="secondary">Summarize</BottomSheetItem>
              </>
            ) : permissions.canMutate ? (
              <BottomSheetItem
                onPress={() => {
                  setSheetOpen(false);
                  openNewEmail();
                }}
                style={styles.sheetAction}
                variant="secondary"
              >
                Write email
              </BottomSheetItem>
            ) : null}
          </View>
        ) : sheet === "plus" ? (
          <View style={styles.sheetItems}>
            {permissions.canMutate ? (
              <BottomSheetItem
                onPress={() => {
                  setSheetOpen(false);
                  openNewEmail();
                }}
                style={styles.sheetAction}
                variant="secondary"
              >
                New email
              </BottomSheetItem>
            ) : null}
            <BottomSheetItem disabled={!permissions.canMutate} onPress={openToneCreate} style={styles.sheetAction} variant="secondary">Create email tone</BottomSheetItem>
            <BottomSheetItem onPress={openReplyContexts} style={styles.sheetAction} variant="secondary">Reply context</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(busy) || !permissions.canManageConnector} onPress={openConnectForm} style={styles.sheetAction} variant="secondary">Connect Gmail</BottomSheetItem>
          </View>
        ) : sheet === "bulkActions" ? (
          <View style={styles.sheetItems}>
            <BottomSheetItem disabled={bulkBusy} onPress={() => void runBulkAction("favorite")} style={styles.sheetAction} variant="secondary">{selectedThreads.every((thread) => thread.isFavorite) ? "Unfavorite" : "Favorite"}</BottomSheetItem>
            <BottomSheetItem disabled={bulkBusy} onPress={() => void runBulkAction("read")} style={styles.sheetAction} variant="secondary">{selectedThreads.every((thread) => thread.isRead) ? "Mark unread" : "Mark read"}</BottomSheetItem>
            <BottomSheetItem disabled={bulkBusy || selectedThreads.every((thread) => thread.labels?.includes("TRASH"))} onPress={() => setSheet("bulkTrash")} style={styles.sheetAction} variant="secondary">Move to trash</BottomSheetItem>
          </View>
        ) : sheet === "bulkTrash" ? null : sheet === "account" ? (
          <View style={styles.sheetItems}>
            {selected ? <>
              {permissions.canMutate ? <BottomSheetItem disabled={trashBusy} onPress={openReplySuggestions} style={styles.sheetAction} variant="secondary">Reply</BottomSheetItem> : null}
              <BottomSheetItem disabled={!permissions.canMutate || trashBusy || Boolean(busy)} onPress={() => void toggleFavorite()} style={styles.sheetAction} variant="secondary">{selected.thread.isFavorite ? "Unfavorite" : "Favorite"}</BottomSheetItem>
              <BottomSheetItem disabled={!permissions.canMutate || readBusy || trashBusy} onPress={() => void toggleReadState()} style={styles.sheetAction} variant="secondary">{selected.thread.isRead ? "Mark unread" : "Mark read"}</BottomSheetItem>
              <BottomSheetItem onPress={() => void openReaderFlow("similar")} style={styles.sheetAction} variant="secondary">Find similar</BottomSheetItem>
              {!selected.thread.labels?.includes("TRASH") ? <BottomSheetItem disabled={!permissions.canMutate || trashBusy} onPress={() => void openReaderFlow("delete")} style={styles.sheetAction} variant="secondary">Move to trash</BottomSheetItem> : null}
            </> : inboxActionItems}
          </View>
        ) : sheet === "disconnect" ? (
          <View style={styles.sheetItems}>
            <Button
              disabled={Boolean(busy)}
              onPress={() => void disconnect()}
              size="md"
              variant="primary"
            >
              Disconnect inbox
            </Button>
            <Button
              disabled={Boolean(busy)}
              onPress={() => setSheet("account")}
              size="md"
              variant="secondary"
            >
              Close
            </Button>
          </View>
        ) : null}
      </BottomSheet>
      </View>
      <BottomSheet
        dismissible={!newEmailSending}
        footer={<><Button disabled={newEmailSending || !newEmailRecipients.length && !newEmailRecipientInput.trim()} onPress={advanceNewEmailRecipients} size="md" variant="primary">Next</Button><Button disabled={newEmailSending} onPress={closeNewEmailRecipients} size="md" variant="secondary">Close</Button></>}
        height="full"
        onOpenChange={(open) => { if (!open && !newEmailSending && !newEmailContentOpen && !newEmailAlternativesOpen && !newEmailReviewOpen) closeNewEmailRecipients(); }}
        open={newEmailRecipientsOpen}
        title="Recipients"
      >
        <ScrollView contentContainerStyle={styles.newEmailForm} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.inputLabel}>Email addresses</Text>
          <TextInput accessibilityLabel="Email recipients" autoCapitalize="none" autoCorrect={false} editable={!newEmailSending} keyboardType="email-address" onBlur={() => { if (newEmailRecipientInput.trim()) commitNewEmailRecipients(); }} onChangeText={changeNewEmailRecipientInput} onSubmitEditing={() => commitNewEmailRecipients()} placeholder="Email address" ref={newEmailRecipientInputRef} value={newEmailRecipientInput} />
          {newEmailRecipientError ? <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.inlineError}><Text style={styles.inlineErrorText}>{newEmailRecipientError}</Text></View> : null}
          <ButtonSizeProvider overrideParent size="xs"><View accessibilityLabel="Committed email recipients" style={styles.recipientChips}>{newEmailRecipients.map((address) => <View key={address.toLocaleLowerCase()} style={[styles.recipientChip, styles.recipientChipCompact]}><Button accessibilityLabel={`Focus recipient input for ${address}`} contentMode="raw" disabled={newEmailSending} onPress={() => newEmailRecipientInputRef.current?.focus()} size="xs" style={styles.recipientChipMain} variant="ghost"><Text style={styles.recipientChipText}>{address}</Text></Button><Button accessibilityLabel={`Remove recipient ${address}`} contentMode="raw" disabled={newEmailSending} hitSlop={10} iconOnly onPress={() => removeNewEmailRecipient(address)} shape="pill" size="xs" style={[styles.recipientChipRemove, styles.recipientChipRemoveCompact]} variant="secondary"><CloseIcon size="xs" /></Button></View>)}</View></ButtonSizeProvider>
        </ScrollView>
      </BottomSheet>
      <BottomSheet
        dismissible={!newEmailSending && !newEmailBodyTransformation}
        footer={<><Button disabled={newEmailSending || Boolean(newEmailBodyTransformation) || tonesLoading} onPress={openNewEmailAlternatives} size="md" variant="primary">Next</Button><Button disabled={newEmailSending || Boolean(newEmailBodyTransformation)} onPress={() => { invalidateNewEmailAlternatives(); setNewEmailContentOpen(false); setNewEmailRecipientsOpen(true); }} size="md" variant="secondary">Close</Button></>}
        height="full"
        onOpenChange={(open) => { if (!open && !newEmailSending && !newEmailBodyTransformation && !newEmailAlternativesOpen && !newEmailReviewOpen) { invalidateNewEmailAlternatives(); setNewEmailContentOpen(false); setNewEmailRecipientsOpen(true); } }}
        open={newEmailContentOpen}
        title="Write email"
      >
        <ScrollView contentContainerStyle={styles.newEmailForm} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.inputLabel}>Subject</Text>
          <TextInput accessibilityLabel="Email subject" editable={!newEmailSending && !newEmailBodyTransformation} maxLength={998} onChangeText={(value) => changeNewEmailContent("subject", value)} placeholder="Subject" ref={newEmailSubjectInputRef} value={newEmailSubject} />
          <Text style={styles.inputLabel}>Message</Text>
          <AiTextEditor accessibilityLabel="Email body" editable={!newEmailSending && !newEmailBodyTransformation} maxLength={50_000} multiline onChangeText={(value) => changeNewEmailContent("body", value)} onOpenActions={() => openEmailEditorActions("newEmail")} placeholder="Message" style={styles.newEmailBodyInput} textAlignVertical="top" transformation={newEmailBodyTransformation} value={newEmailBody} />
        </ScrollView>
      </BottomSheet>
      <BottomSheet
        dismissible={!newEmailSending}
        footer={<><Button disabled={newEmailSending} onPress={() => openNewEmailReview()} size="md" variant="primary">Skip</Button><Button disabled={newEmailSending} onPress={returnToNewEmailContent} size="md" variant="secondary">Close</Button></>}
        height="full"
        onOpenChange={(open) => { if (!open && !newEmailSending && !newEmailReviewOpen) returnToNewEmailContent(); }}
        open={newEmailAlternativesOpen}
        title="Choose a tone"
      >
        <ScrollView contentContainerStyle={styles.alternativeList} showsVerticalScrollIndicator={false}>
          {newEmailAlternativeError ? <View accessibilityRole="alert" style={styles.sheetError}><Text style={styles.sheetErrorText}>{newEmailAlternativeError}</Text></View> : null}
          {Array.from({ length: newEmailAlternativeSkeletonCount }, (_, index) => <Skeleton accessibilityLabel="Generating email alternatives" accessibilityRole="progressbar" key={index} style={styles.newEmailAlternativeSkeleton} />)}
          {newEmailAlternatives.flatMap((alternative) => alternative.status === "succeeded" && alternative.draft ? [<Button contentMode="raw" key={alternative.option.value} onPress={() => openNewEmailReview(alternative.draft)} shape="pill" size="md" style={styles.newEmailAlternative} variant="secondary"><View style={styles.newEmailAlternativeCopy}><Text numberOfLines={1} style={styles.rowTitle}>{alternative.option.label}</Text><Text numberOfLines={1} style={styles.newEmailAlternativePreview}>{alternative.draft.finalContent ?? alternative.draft.generatedContent}</Text></View></Button>] : alternative.status === "failed" ? [<Button accessibilityLabel={`Retry ${alternative.option.label} email alternative`} key={alternative.option.value} onPress={() => retryNewEmailAlternative(alternative.option)} size="md" style={styles.newEmailAlternative} variant="secondary">Retry {alternative.option.label}</Button>] : [])}
        </ScrollView>
      </BottomSheet>
      <BottomSheet
        dismissible={!newEmailSending && !newEmailReviewTransformation}
        footer={<><Button disabled={newEmailSending || Boolean(newEmailReviewTransformation) || !newEmailRecipients.length} onPress={() => void sendNewEmail()} size="md" variant="primary">Send</Button><Button disabled={newEmailSending || Boolean(newEmailReviewTransformation)} onPress={closeNewEmailReview} size="md" variant="secondary">Close</Button></>}
        height="full"
        onOpenChange={(open) => { if (!open && !newEmailSending && !newEmailReviewTransformation && !newEmailAttachmentsOpen) closeNewEmailReview(); }}
        open={newEmailReviewOpen}
        title="Email draft"
      >
        <ScrollView contentContainerStyle={styles.newEmailForm} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {newEmailError ? <View accessibilityRole="alert" style={styles.sheetError}><Text style={styles.sheetErrorText}>{newEmailError}</Text></View> : null}
          <TextInput accessibilityLabel="Review email subject" editable={!newEmailSending && !newEmailReviewTransformation} maxLength={998} onChangeText={(value) => { setNewEmailReviewSubject(value); if (newEmailSelectedDraft && value !== newEmailSubject) setNewEmailSkipped(true); }} placeholder="Subject" value={newEmailReviewSubject} />
          <AiTextEditor accessibilityLabel="Review email body" editable={!newEmailSending && !newEmailReviewTransformation} maxLength={50_000} multiline onChangeText={setNewEmailReviewBody} onOpenActions={() => openEmailEditorActions("newEmailReview")} placeholder="Message" style={styles.newEmailBodyInput} textAlignVertical="top" transformation={newEmailReviewTransformation} value={newEmailReviewBody} />
          <ButtonSizeProvider overrideParent size="xs"><View style={styles.attachmentActions}><View style={[styles.recipientChip, styles.attachmentChip]}><Button accessibilityLabel="Open attachments" contentMode="raw" disabled={newEmailSending || Boolean(newEmailReviewTransformation)} onPress={openNewEmailAttachments} size="xs" style={[styles.recipientChipMain, styles.attachmentChipMain]} variant="ghost"><Text style={[styles.recipientChipText, styles.attachmentChipText]}>Attachments</Text></Button><Button accessibilityLabel="Add attachments" contentMode="raw" disabled={newEmailSending || Boolean(newEmailReviewTransformation)} hitSlop={10} iconOnly onPress={openNewEmailAttachments} shape="pill" size="xs" style={[styles.recipientChipRemove, styles.attachmentChipRemove]} variant="secondary"><PlusIcon size="xs" /></Button></View>{newEmailAttachments.length ? <View style={[styles.recipientChip, styles.attachmentChip]}><Button contentMode="raw" disabled={newEmailSending || Boolean(newEmailReviewTransformation)} onPress={removeAllNewEmailAttachments} size="xs" style={[styles.recipientChipMain, styles.attachmentChipMain]} variant="ghost"><Text style={[styles.recipientChipText, styles.attachmentChipText]}>Remove all</Text></Button><Button accessibilityLabel="Remove all attachments" contentMode="raw" disabled={newEmailSending || Boolean(newEmailReviewTransformation)} hitSlop={10} iconOnly onPress={removeAllNewEmailAttachments} shape="pill" size="xs" style={[styles.recipientChipRemove, styles.attachmentChipRemove]} variant="secondary"><CloseIcon size="xs" /></Button></View> : null}</View></ButtonSizeProvider>
          {newEmailAttachments.length ? <View accessibilityLabel={`${newEmailAttachments.length} email attachments`} onLayout={({ nativeEvent }) => setReviewAttachmentGridWidth(nativeEvent.layout.width)} style={styles.reviewAttachmentGrid}>{newEmailAttachments.map((ref) => { const identity = attachmentIdentity(ref); const label = newEmailAttachmentLabels[identity] ?? (ref.type === "document" ? "Archive document" : "Gallery image"); const imageUrl = ref.type === "image" ? newEmailAttachmentImageUrls[identity] : undefined; return <Button accessibilityLabel={`Edit attachment ${label}`} contentMode="raw" disabled={newEmailSending || Boolean(newEmailReviewTransformation)} key={identity} onPress={openNewEmailAttachments} shape="rounded" size="md" style={[styles.reviewAttachmentCard, { width: reviewAttachmentCardSize, height: reviewAttachmentCardSize }]} variant="ghost">{imageUrl ? <Image contentFit="cover" onError={() => void refreshNewEmailImageUrls()} source={imageUrl} style={styles.reviewAttachmentImage} transition={150} /> : <><FileIcon size="lg" /><Text ellipsizeMode="tail" numberOfLines={1} style={styles.reviewAttachmentLabel}>{label}</Text></>}</Button>; })}</View> : null}
        </ScrollView>
      </BottomSheet>
      {newEmailAttachmentsOpen ? <EmailAttachmentPicker context={historyContext} contextKey={`${emailContext.organizationKey}:${emailContext.scopeKey}:new-email`} imageUrls={newEmailAttachmentImageUrls} labels={newEmailAttachmentLabels} onClose={() => setNewEmailAttachmentsOpen(false)} onDone={finishNewEmailAttachments} open selection={newEmailAttachments} /> : null}
      <BottomSheet
        description={readerSheet === "translate" || readerSheet === "translationReader" ? "View saved translations or create a new one." : readerSheet === "translationForm" ? "Choose the language for this email translation." : readerSheet === "summaryVersions" || readerSheet === "summaryReader" ? "View saved summaries or create a new one." : readerSheet === "replies" ? "Choose a generated response to review." : undefined}
        dismissible={!trashBusy && !generatedDeleteBusy && !replySending && !replyAttachmentsOpen && !replyEditorOpen}
        footer={readerFooter}
        height="full"
        onOpenChange={(open) => { if (!open) closeReaderFlow(); }}
        open={readerSheetOpen && readerSheet !== "delete"}
        title={readerSheet === "translate" || readerSheet === "translationReader" ? "Translations" : readerSheet === "translationForm" ? "Translate email" : readerSheet === "summaryVersions" || readerSheet === "summaryReader" ? "Summaries" : readerSheet === "replies" ? "Replies" : readerSheet === "similar" ? "Similar email" : "Move to Trash?"}
      >
        {readerError ? <View accessibilityRole="alert" style={styles.sheetError}><Text style={styles.sheetErrorText}>{readerError}</Text></View> : null}
        {readerSheet === "translate" || readerSheet === "translationReader" ? <View style={[styles.versionPanel, !readerLoading && translations.length === 0 && styles.sheetEmptyContent]}>
          {permissions.canMutate && selectedTranslationKeys.length ? <Tabs accessibilityLabel="Selected translations toolbar" style={styles.generatedBulkToolbar}><View style={styles.generatedBulkToolbarSelection}><Button accessibilityLabel="Clear translation selection" contentMode="raw" disabled={generatedDeleteBusy} onPress={() => setSelectedTranslationKeys([])} size="md" style={styles.generatedBulkToolbarClose} variant="secondary"><CloseIcon size="sm" /></Button><Text accessibilityLiveRegion="polite" style={styles.generatedBulkSelectionText}>{selectedTranslationKeys.length} selected</Text></View><Button disabled={generatedDeleteBusy} onPress={() => openGeneratedDeleteConfirmation("translation")} size="md" style={styles.generatedBulkDeleteAction} textStyle={styles.generatedBulkDeleteText} variant="secondary">Delete</Button></Tabs> : null}
          {readerLoading && readerGenerating !== "translation" ? Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Loading translation versions" accessibilityRole="progressbar" key={index} style={styles.versionSkeleton} />) : <>{translations.map((version) => { const selectedVersion = selectedTranslationKeys.includes(version.key); return <View key={version.key} style={styles.versionRow}><Button accessibilityActions={permissions.canMutate ? [{ name: "longpress", label: selectedVersion ? "Deselect translation" : "Select translation" }] : undefined} accessibilityLabel={`Translation ${version.version}`} accessibilityState={{ selected: selectedVersion }} contentMode="raw" disabled={generatedDeleteBusy} onAccessibilityAction={permissions.canMutate ? ({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") toggleGeneratedSelection("translation", version.key); } : undefined} onLongPress={permissions.canMutate ? () => handleGeneratedLongPress("translation", version.key) : undefined} onPress={() => handleGeneratedPress("translation", version.key)} size="md" style={[styles.versionMain, selectedVersion && styles.generatedVersionSelected]} variant="secondary"><ClockIcon size="sm" variant="accent" /><Text numberOfLines={1} style={styles.rowTitle}>Translation {version.version}</Text>{selectedVersion ? <View pointerEvents="none" style={styles.generatedSelectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</Button></View>; })}{readerGenerating === "translation" ? <Skeleton accessibilityLabel="Generating translation" accessibilityRole="progressbar" style={styles.versionSkeleton} /> : translations.length === 0 ? <Text style={styles.centerText}>No translations yet.</Text> : null}</>}
        </View> : null}
        {readerSheet === "translationForm" ? <View style={styles.transformationForm}><Text style={styles.inputLabel}>Language</Text><TextInput accessibilityLabel="Translation language" editable={!readerLoading} maxLength={100} onChangeText={setTargetLanguage} placeholder="Language" ref={readerInputRef} value={targetLanguage} /></View> : null}
        {readerSheet === "summaryVersions" || readerSheet === "summaryReader" ? <View style={styles.summaryVersionPanel}>
          {permissions.canMutate && selectedSummaryKeys.length ? <Tabs accessibilityLabel="Selected summaries toolbar" style={styles.generatedBulkToolbar}><View style={styles.generatedBulkToolbarSelection}><Button accessibilityLabel="Clear summary selection" contentMode="raw" disabled={generatedDeleteBusy} onPress={() => setSelectedSummaryKeys([])} size="md" style={styles.generatedBulkToolbarClose} variant="secondary"><CloseIcon size="sm" /></Button><Text accessibilityLiveRegion="polite" style={styles.generatedBulkSelectionText}>{selectedSummaryKeys.length} selected</Text></View><Button disabled={generatedDeleteBusy} onPress={() => openGeneratedDeleteConfirmation("summary")} size="md" style={styles.generatedBulkDeleteAction} textStyle={styles.generatedBulkDeleteText} variant="secondary">Delete</Button></Tabs> : null}
          <ScrollView contentContainerStyle={[styles.versionList, !readerLoading && summaries.length === 0 && styles.sheetEmptyContent]} showsVerticalScrollIndicator={false} style={styles.sheetList}>
            {readerLoading && readerGenerating !== "summary" ? Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Loading summary versions" accessibilityRole="progressbar" key={index} style={styles.versionSkeleton} />) : <>{summaries.map((summary) => { const selectedVersion = selectedSummaryKeys.includes(summary.key); return <Button accessibilityActions={permissions.canMutate ? [{ name: "longpress", label: selectedVersion ? "Deselect summary" : "Select summary" }] : undefined} accessibilityLabel={`Summary ${summary.version}`} accessibilityState={{ selected: selectedVersion }} contentMode="raw" disabled={generatedDeleteBusy} key={summary.key} onAccessibilityAction={permissions.canMutate ? ({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") toggleGeneratedSelection("summary", summary.key); } : undefined} onLongPress={permissions.canMutate ? () => handleGeneratedLongPress("summary", summary.key) : undefined} onPress={() => handleGeneratedPress("summary", summary.key)} size="md" style={[styles.versionMain, selectedVersion && styles.generatedVersionSelected]} variant="secondary"><FileIcon size="sm" /><Text numberOfLines={1} style={styles.rowTitle}>Summary {summary.version}</Text>{selectedVersion ? <View pointerEvents="none" style={styles.generatedSelectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</Button>; })}{readerGenerating === "summary" ? <Skeleton accessibilityLabel="Generating summary" accessibilityRole="progressbar" style={styles.versionSkeleton} /> : summaries.length === 0 ? <Text style={styles.centerText}>No summaries yet.</Text> : null}</>}
          </ScrollView>
        </View> : null}
        {readerSheet === "replies" ? <ScrollView contentContainerStyle={[styles.versionList, !readerLoading && !readerError && replyDrafts.length === 0 && styles.sheetEmptyContent]} showsVerticalScrollIndicator={false} style={styles.sheetList}>
          {readerLoading ? Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Generating reply options" accessibilityRole="progressbar" key={index} style={styles.newEmailAlternativeSkeleton} />) : replyDrafts.map((reply) => <Button contentMode="raw" key={reply.key} onPress={() => openReplyDraft(reply)} shape="pill" size="md" style={styles.newEmailAlternative} variant="secondary"><View style={styles.newEmailAlternativeCopy}><Text numberOfLines={1} style={styles.rowTitle}>{reply.tone ?? "Reply"}</Text><Text numberOfLines={1} style={styles.newEmailAlternativePreview}>{reply.finalContent ?? reply.generatedContent}</Text></View></Button>)}
          {!readerLoading && !readerError && replyDrafts.length === 0 ? <Text style={styles.centerText}>No replies available.</Text> : null}
        </ScrollView> : null}
        {readerSheet === "similar" ? <View style={styles.similarFlow}>
          <ScrollView contentContainerStyle={styles.similarResults} showsVerticalScrollIndicator={false}>{readerLoading ? Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Finding similar email" accessibilityRole="progressbar" key={index} style={styles.versionSkeleton} />) : !similarResults.length ? <Text style={styles.centerText}>No similar emails found.</Text> : similarResults.map((result) => <Button contentMode="raw" key={result.key} onPress={() => void openSimilarResult(result)} size="md" style={styles.similarResult} variant="secondary"><MailIcon size="sm" /><Text ellipsizeMode="tail" numberOfLines={1} style={styles.similarResultText}>{result.subject}</Text></Button>)}</ScrollView>
       </View> : null}
       <BottomSheet footer={<Button onPress={() => { setSelectedTranslationKey(undefined); setReaderSheet("translate"); }} size="md" variant="secondary">Close</Button>} height="full" onOpenChange={(open) => { if (!open) { setSelectedTranslationKey(undefined); setReaderSheet("translate"); } }} open={readerSheetOpen && readerSheet === "translationReader" && Boolean(selectedTranslation)} title={`Translation ${selectedTranslation?.version ?? ""}`}><ScrollView contentContainerStyle={styles.generatedReader} showsVerticalScrollIndicator={false}><Text selectable style={styles.readerBody}>{selectedTranslation?.content}</Text></ScrollView></BottomSheet>
       <BottomSheet footer={<Button onPress={() => { setSelectedSummaryKey(undefined); setReaderSheet("summaryVersions"); }} size="md" variant="secondary">Close</Button>} height="full" onOpenChange={(open) => { if (!open) { setSelectedSummaryKey(undefined); setReaderSheet("summaryVersions"); } }} open={readerSheetOpen && readerSheet === "summaryReader" && Boolean(selectedSummary)} title={`Summary ${selectedSummary?.version ?? ""}`}><ScrollView contentContainerStyle={styles.generatedReader} showsVerticalScrollIndicator={false}><Text selectable style={styles.readerBody}>{selectedSummary?.summary}</Text></ScrollView></BottomSheet>
        <BottomSheet dismissible={!generatedDeleteBusy} onOpenChange={(next) => { if (!next && !generatedDeleteBusy) setGeneratedDeleteConfirmation(undefined); }} open={Boolean(generatedDeleteConfirmation)} title={generatedDeleteConfirmation ? `Delete ${generatedDeleteConfirmation.keys.length === 1 ? generatedDeleteConfirmation.kind : `${generatedDeleteConfirmation.keys.length} ${generatedDeleteConfirmation.kind}s`}?` : "Delete saved versions?"}>
          <View style={styles.generatedDeleteConfirmation}><Text style={styles.confirmText}>This permanently deletes the selected saved {generatedDeleteConfirmation?.kind === "translation" ? "translation" : "summary"}{generatedDeleteConfirmation?.keys.length === 1 ? "" : "s"}. This cannot be undone.</Text><Button disabled={generatedDeleteBusy} onPress={() => void deleteGeneratedRecords()} size="md" variant="danger">Delete</Button><Button disabled={generatedDeleteBusy} onPress={() => setGeneratedDeleteConfirmation(undefined)} size="md" variant="secondary">Close</Button></View>
        </BottomSheet>
        <BottomSheet dismissible={!replySending && !replyTransformation && !replyAttachmentsOpen} footer={replyEditorFooter} height="full" onOpenChange={(open) => { if (!open) closeReplyEditor(); }} open={readerSheetOpen && replyEditorOpen} title={emptyReply ? "Reply" : selectedReply?.tone ?? "Reply"}>
          <ScrollView contentContainerStyle={styles.newEmailForm} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <AiTextEditor accessibilityLabel="Reply text" editable={!replySending && !replyTransformation} maxLength={50_000} multiline onChangeText={setReplyBody} onOpenActions={() => openEmailEditorActions("reply")} ref={readerInputRef} style={styles.newEmailBodyInput} textAlignVertical="top" transformation={replyTransformation} value={replyBody} />
            <ButtonSizeProvider overrideParent size="xs">
              <View style={styles.attachmentActions}>
                <View style={[styles.recipientChip, styles.attachmentChip]}>
                  <Button accessibilityLabel="Open reply attachments" contentMode="raw" disabled={replySending || Boolean(replyTransformation)} onPress={() => setReplyAttachmentsOpen(true)} size="xs" style={[styles.recipientChipMain, styles.attachmentChipMain]} variant="ghost"><Text style={[styles.recipientChipText, styles.attachmentChipText]}>Attachments</Text></Button>
                  <Button accessibilityLabel="Add reply attachments" contentMode="raw" disabled={replySending || Boolean(replyTransformation)} hitSlop={10} iconOnly onPress={() => setReplyAttachmentsOpen(true)} shape="pill" size="xs" style={[styles.recipientChipRemove, styles.attachmentChipRemove]} variant="secondary"><PlusIcon size="xs" /></Button>
                </View>
                {replyAttachments.length ? <View style={[styles.recipientChip, styles.attachmentChip]}>
                  <Button contentMode="raw" disabled={replySending || Boolean(replyTransformation)} onPress={removeAllReplyAttachments} size="xs" style={[styles.recipientChipMain, styles.attachmentChipMain]} variant="ghost"><Text style={[styles.recipientChipText, styles.attachmentChipText]}>Remove all</Text></Button>
                  <Button accessibilityLabel="Remove all reply attachments" contentMode="raw" disabled={replySending || Boolean(replyTransformation)} hitSlop={10} iconOnly onPress={removeAllReplyAttachments} shape="pill" size="xs" style={[styles.recipientChipRemove, styles.attachmentChipRemove]} variant="secondary"><CloseIcon size="xs" /></Button>
                </View> : null}
              </View>
            </ButtonSizeProvider>
            {replyAttachments.length ? <View accessibilityLabel={`${replyAttachments.length} reply attachments`} onLayout={({ nativeEvent }) => setReviewAttachmentGridWidth(nativeEvent.layout.width)} style={styles.reviewAttachmentGrid}>{replyAttachments.map((ref) => { const identity = attachmentIdentity(ref); const label = replyAttachmentLabels[identity] ?? (ref.type === "document" ? "Archive document" : "Gallery image"); const imageUrl = ref.type === "image" ? replyAttachmentImageUrls[identity] : undefined; return <Button accessibilityLabel={`Edit reply attachment ${label}`} contentMode="raw" disabled={replySending || Boolean(replyTransformation)} key={identity} onPress={() => setReplyAttachmentsOpen(true)} shape="rounded" size="md" style={[styles.reviewAttachmentCard, { width: reviewAttachmentCardSize, height: reviewAttachmentCardSize }]} variant="ghost">{imageUrl ? <Image contentFit="cover" onError={() => { if (ref.type === "image") void refreshReplyImageUrl(ref); }} source={imageUrl} style={styles.reviewAttachmentImage} transition={150} /> : <><FileIcon size="lg" /><Text ellipsizeMode="tail" numberOfLines={1} style={styles.reviewAttachmentLabel}>{label}</Text></>}</Button>; })}</View> : null}
          </ScrollView>
        </BottomSheet>
        <BottomSheet dismissible={!replySending} hideHeading onOpenChange={(open) => { if (!open && !replySending) setReplyModeOpen(false); }} open={readerSheetOpen && replyModeOpen} title="Choose reply recipients"><View style={styles.sheetItems}><BottomSheetItem disabled={replySending} onPress={() => void sendSuggestedReply("reply")} style={styles.sheetAction} variant="secondary">Reply</BottomSheetItem><BottomSheetItem disabled={replySending} onPress={() => void sendSuggestedReply("reply_all")} style={styles.sheetAction} variant="secondary">Reply all</BottomSheetItem></View></BottomSheet>
        {replyAttachmentsOpen && replyEditorOpen ? <EmailAttachmentPicker context={historyContext} contextKey={`${emailContext.organizationKey}:${emailContext.scopeKey}:reply:${selectedReply?.key ?? selected?.thread.key ?? "empty"}`} imageUrls={replyAttachmentImageUrls} labels={replyAttachmentLabels} onClose={() => setReplyAttachmentsOpen(false)} onDone={finishReplyAttachments} open selection={replyAttachments} /> : null}
      </BottomSheet>
      <BottomSheet dismissible={!trashBusy} footer={<><Button disabled={trashBusy} onPress={() => void trashThread()} size="md" variant="primary">Move to trash</Button><Button disabled={trashBusy} onPress={closeReaderFlow} size="md" variant="secondary">Cancel</Button></>} onOpenChange={(open) => { if (!open) closeReaderFlow(); }} open={readerSheetOpen && readerSheet === "delete"} title="Move to Trash?" />
      <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setEditorActionTarget(undefined); }} open={Boolean(editorActionTarget)} title="AI actions">
        <View style={styles.sheetItems}>
          <BottomSheetItem onPress={() => { const target = editorActionTarget; if (target) void transformEmailEditor(target, "enhance"); }} style={styles.sheetAction} variant="secondary">Enhance</BottomSheetItem>
          <BottomSheetItem onPress={openEmailEditorTranslation} style={styles.sheetAction} variant="secondary">Translate</BottomSheetItem>
        </View>
      </BottomSheet>
      <BottomSheet
        footer={<><Button disabled={editorTargetLanguage.trim().length < 2} onPress={() => { const target = editorTranslateTarget; if (target) void transformEmailEditor(target, "translate"); }} size="md" variant="primary">Translate</Button><Button onPress={() => setEditorTranslateTarget(undefined)} size="md" variant="secondary">Close</Button></>}
        height="full"
        onOpenChange={(open) => { if (!open) setEditorTranslateTarget(undefined); }}
        open={Boolean(editorTranslateTarget)}
        title="Translate email text"
      >
        <View style={styles.transformationForm}><Text style={styles.inputLabel}>Language</Text><TextInput accessibilityLabel="Email text translation language" maxLength={100} onChangeText={setEditorTargetLanguage} placeholder="Language" ref={editorTranslationInputRef} value={editorTargetLanguage} /></View>
      </BottomSheet>
      <View accessibilityElementsHidden={readerSheetOpen} importantForAccessibility={readerSheetOpen ? "no-hide-descendants" : "auto"} pointerEvents={readerSheetOpen ? "none" : "auto"}>
      <ReplyContextSheets canMutate={permissions.canMutate} context={emailContext} onClose={() => setReplyContextsOpen(false)} open={replyContextsOpen} />
      </View>
    </KeyboardAvoidingView>
  );
}

function ReplyContextSheets({ canMutate, context, onClose, open }: { canMutate: boolean; context: ReturnType<typeof getEmailContext>; onClose: () => void; open: boolean }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const contextGeneration = useRef(0);
  const createInFlight = useRef(false);
  const updateInFlight = useRef(false);
  const deleteInFlight = useRef(false);
  const longPressedNote = useRef<string | undefined>(undefined);
  const editorInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; note: EmailReplyContext }>();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [editorError, setEditorError] = useState<string>();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const capturedContext = { organizationKey: context.organizationKey, scopeKey: context.scopeKey };
  const queryKey = signalQueryKeys.replyContexts(capturedContext);
  const notesQuery = useQuery({
    enabled: open,
    queryKey,
    queryFn: () => fetchEmailReplyContextsForContext(capturedContext),
    staleTime: 0,
  });
  const notes = notesQuery.data ?? [];
  const activeSelectedKeys = selectedKeys.filter((key) => notes.some((note) => note.key === key));
  useDelayedInputFocus(open && editor ? editor.mode : undefined, editorInputRef, canMutate);

  useEffect(() => {
    contextGeneration.current += 1;
    createInFlight.current = false;
    updateInFlight.current = false;
    deleteInFlight.current = false;
    void Promise.resolve().then(() => {
      setSelectedKeys([]);
      setEditor(undefined);
      setDeleteConfirmOpen(false);
      setSaving(false);
      setDeleting(false);
    });
  }, [context.organizationKey, context.scopeKey]);
  useEffect(() => {
    if (!open) {
      void Promise.resolve().then(() => {
        setSelectedKeys([]);
        setEditor(undefined);
        setDeleteConfirmOpen(false);
      });
    }
  }, [open]);

  function operationIsCurrent(generation: number, operationContext: typeof capturedContext) {
    if (generation !== contextGeneration.current) return false;
    try {
      const current = getEmailContext();
      return current.organizationKey === operationContext.organizationKey && current.scopeKey === operationContext.scopeKey;
    } catch {
      return false;
    }
  }
  function invalidate(operationContext = capturedContext) {
    return queryClient.invalidateQueries({ queryKey: signalQueryKeys.replyContexts(operationContext), refetchType: "active" });
  }
  function toggleSelection(key: string) {
    setSelectedKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key]);
  }
  function handleLongPress(key: string) {
    if (!canMutate) return;
    longPressedNote.current = key;
    toggleSelection(key);
    void Haptics.selectionAsync();
  }
  function openEditor(note?: EmailReplyContext) {
    setName(note?.name ?? "");
    setText(note?.text ?? "");
    setEditorError(undefined);
    setEditor(note ? { mode: "edit", note } : { mode: "create" });
  }
  function handlePress(note: EmailReplyContext) {
    const longPress = longPressedNote.current;
    longPressedNote.current = undefined;
    if (longPress === note.key) return;
    if (activeSelectedKeys.length) toggleSelection(note.key);
    else openEditor(note);
  }
  function closeEditor() {
    setEditor(undefined);
    setEditorError(undefined);
  }
  function requestEditorClose() {
    if (saving) return;
    closeEditor();
  }
  async function saveNote() {
    if (!editor || saving || !canMutate || !name.trim() || !text.trim()) return;
    if (editor.mode === "create" && createInFlight.current || editor.mode === "edit" && updateInFlight.current) return;
    const operationContext = { ...capturedContext };
    const generation = contextGeneration.current;
    const requestKey = randomUUID();
    const timestamp = new Date().toISOString();
    const before = queryClient.getQueryData<EmailReplyContext[]>(signalQueryKeys.replyContexts(operationContext)) ?? [];
    const optimisticKey = `optimistic-reply-context-${timestamp}`;
    const expected = editor.mode === "create"
      ? [...before, { key: optimisticKey, name: name.trim(), text: text.trim(), createdAt: timestamp, updatedAt: timestamp }]
      : before.map((note) => note.key === editor.note.key ? { ...editor.note, name: name.trim(), text: text.trim(), updatedAt: timestamp } : note);
    if (editor.mode === "create") createInFlight.current = true;
    else updateInFlight.current = true;
    setSaving(true);
    setEditorError(undefined);
    queryClient.setQueryData(signalQueryKeys.replyContexts(operationContext), expected);
    const actionLabel = editor.mode === "create" ? "Context note created" : "Context note saved";
    if (editor.mode === "create") onClose();
    else closeEditor();
    showToast({ title: actionLabel, duration: 2_000 });
    try {
      const saved = editor.mode === "create"
        ? await createEmailReplyContextForContext(operationContext, { name: name.trim(), text: text.trim() }, requestKey)
        : await updateEmailReplyContextForContext(operationContext, { noteKey: editor.note.key, name: name.trim(), text: text.trim() }, requestKey);
      if (!operationIsCurrent(generation, operationContext)) {
        void invalidate(operationContext);
        return;
      }
      if (queryClient.getQueryData(signalQueryKeys.replyContexts(operationContext)) === expected) {
        queryClient.setQueryData<EmailReplyContext[]>(signalQueryKeys.replyContexts(operationContext), (current) => editor.mode === "create"
          ? current?.map((note) => note.key === optimisticKey ? saved : note)
          : current?.map((note) => note.key === saved.key ? saved : note));
      } else void invalidate(operationContext);
    } catch (failure) {
      if (!operationIsCurrent(generation, operationContext)) {
        void invalidate(operationContext);
        return;
      }
      if (queryClient.getQueryData(signalQueryKeys.replyContexts(operationContext)) === expected) queryClient.setQueryData(signalQueryKeys.replyContexts(operationContext), before);
      else void invalidate(operationContext);
      showToast({ title: messageFor(failure), duration: 2_000 });
    } finally {
      if (generation === contextGeneration.current) {
        createInFlight.current = false;
        updateInFlight.current = false;
        setSaving(false);
      }
    }
  }
  async function deleteSelected() {
    if (!canMutate || deleting || deleteInFlight.current || !activeSelectedKeys.length) return;
    const keys = [...activeSelectedKeys];
    const operationContext = { ...capturedContext };
    const generation = contextGeneration.current;
    const requestKey = randomUUID();
    const before = queryClient.getQueryData<EmailReplyContext[]>(signalQueryKeys.replyContexts(operationContext)) ?? [];
    const expected = before.filter((note) => !keys.includes(note.key));
    deleteInFlight.current = true;
    setDeleting(true);
    queryClient.setQueryData(signalQueryKeys.replyContexts(operationContext), expected);
    setDeleteConfirmOpen(false);
    showToast({ title: keys.length === 1 ? "Context note deleted" : `${keys.length} context notes deleted`, duration: 2_000 });
    try {
      const result = await deleteEmailReplyContextsForContext(operationContext, keys, requestKey);
      if (!operationIsCurrent(generation, operationContext)) {
        void invalidate(operationContext);
        return;
      }
      const deleted = new Set(result.deletedNoteKeys);
      const converged = before.filter(({ key }) => !deleted.has(key));
      if (queryClient.getQueryData(signalQueryKeys.replyContexts(operationContext)) === expected) queryClient.setQueryData(signalQueryKeys.replyContexts(operationContext), converged);
      else void invalidate(operationContext);
      setSelectedKeys(keys.filter((key) => !deleted.has(key)));
      if (deleted.size !== keys.length) showToast({ title: deleted.size ? `${deleted.size} deleted, ${keys.length - deleted.size} failed` : "No context notes were deleted", duration: 2_000 });
    } catch (failure) {
      if (!operationIsCurrent(generation, operationContext)) {
        void invalidate(operationContext);
        return;
      }
      if (queryClient.getQueryData(signalQueryKeys.replyContexts(operationContext)) === expected) queryClient.setQueryData(signalQueryKeys.replyContexts(operationContext), before);
      else void invalidate(operationContext);
      setDeleteConfirmOpen(false);
      showToast({ title: messageFor(failure), duration: 2_000 });
    } finally {
      if (generation === contextGeneration.current) {
        deleteInFlight.current = false;
        setDeleting(false);
      }
    }
  }

  return <>
    <BottomSheet footer={<View style={styles.replyContextFooter}>{canMutate ? <Button disabled={deleting} onPress={() => openEditor()} size="md" variant="primary">Create context note</Button> : null}<Button disabled={deleting} onPress={onClose} size="md" variant="secondary">Close</Button></View>} height="full" onOpenChange={(nextOpen) => { if (!nextOpen && open && !deleting) onClose(); }} open={open} title="Reply context">
      <ScrollView accessibilityLabel="Reply context notes" accessibilityLiveRegion="polite" accessibilityState={{ busy: notesQuery.isPending || deleting }} contentContainerStyle={[styles.replyContextList, !notesQuery.isPending && !notesQuery.error && !notes.length && styles.replyContextEmpty]} showsVerticalScrollIndicator={false}>
        {activeSelectedKeys.length ? <Tabs accessibilityLabel="Context note selection toolbar" style={styles.replyContextSelectionToolbar}><View style={styles.replyContextSelectionCount}><Button accessibilityLabel="Clear context note selection" contentMode="raw" disabled={deleting} onPress={() => setSelectedKeys([])} size="md" style={styles.replyContextSelectionClear} variant="secondary"><CloseIcon size="sm" /></Button><Text style={styles.replyContextSelectionText}>{activeSelectedKeys.length} selected</Text></View><Button disabled={deleting} onPress={() => setDeleteConfirmOpen(true)} size="md" variant="danger">Delete</Button></Tabs> : null}
        {notesQuery.isPending ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.replyContextPillSkeleton} />) : notesQuery.error ? <View style={styles.replyContextEmpty}><Text style={styles.rootEmpty}>{messageFor(notesQuery.error)}</Text><Button onPress={() => void notesQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : notes.map((note) => { const selected = activeSelectedKeys.includes(note.key); return <Button accessibilityActions={canMutate ? [{ name: "longpress", label: selected ? `Deselect ${note.name}` : `Select ${note.name}` }] : undefined} accessibilityLabel={activeSelectedKeys.length ? `${selected ? "Deselect" : "Select"} ${note.name}` : `Open ${note.name}`} accessibilityState={{ selected }} contentMode="raw" disabled={deleting} key={note.key} onAccessibilityAction={canMutate ? ({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") toggleSelection(note.key); } : undefined} onLongPress={canMutate ? () => handleLongPress(note.key) : undefined} onPress={() => handlePress(note)} shape="pill" size="md" style={[styles.replyContextPill, selected && styles.replyContextPillSelected]} variant="secondary"><Text numberOfLines={1} style={styles.replyContextPillText}>{note.name}</Text></Button>; })}
        {!notesQuery.isPending && !notesQuery.error && !notes.length ? <View style={styles.replyContextEmpty}><Text style={styles.rootEmpty}>No context notes yet.</Text>{canMutate ? <Button accessibilityLabel="Create context note" contentMode="raw" onPress={() => openEditor()} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : null}</View> : null}
      </ScrollView>
    </BottomSheet>
    <BottomSheet dismissible={!saving} footer={<View style={styles.replyContextFooter}>{canMutate ? <Button disabled={saving || !name.trim() || !text.trim()} onPress={() => void saveNote()} size="md" variant="primary">{editor?.mode === "create" ? "Create" : "Save"}</Button> : null}<Button disabled={saving} onPress={requestEditorClose} size="md" variant="secondary">Close</Button></View>} height="full" onOpenChange={(nextOpen) => { if (!nextOpen && editor) requestEditorClose(); }} open={open && Boolean(editor)} title={editor?.mode === "create" ? "New context note" : "Edit context note"}>
      <ScrollView contentContainerStyle={styles.replyContextEditor} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.formScroll}>{editorError ? <View accessibilityRole="alert" style={styles.sheetError}><Text style={styles.sheetErrorText}>{editorError}</Text></View> : null}<Text style={styles.inputLabel}>Name</Text><TextInput accessibilityLabel="Context note name" editable={canMutate && !saving} maxLength={255} onChangeText={setName} placeholder="Context note name" ref={editorInputRef} value={name} /><Text style={styles.inputLabel}>Context</Text><TextInput accessibilityLabel="Context note text" editable={canMutate && !saving} maxLength={4000} multiline onChangeText={setText} placeholder="Add information that should shape email replies" style={styles.replyContextTextInput} textAlignVertical="top" value={text} /></ScrollView>
    </BottomSheet>
    <BottomSheet dismissible={!deleting} onOpenChange={(nextOpen) => { if (!nextOpen && !deleting) setDeleteConfirmOpen(false); }} open={open && deleteConfirmOpen && activeSelectedKeys.length > 0} title={`Delete ${activeSelectedKeys.length === 1 ? "context note" : `${activeSelectedKeys.length} context notes`}?`}><View style={styles.replyContextFooter}><Text style={styles.confirmText}>This permanently deletes the selected reply context.</Text><Button disabled={deleting} onPress={() => void deleteSelected()} size="md" variant="danger">Delete</Button><Button disabled={deleting} onPress={() => setDeleteConfirmOpen(false)} size="md" variant="secondary">Close</Button></View></BottomSheet>
  </>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.voidBlack },
  workspaceSurface: { flex: 1 },
  globalHeader: {
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingBottom: 7,
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
    backgroundColor: palette.page,
  },
  localHeader: {
    minHeight: 44,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: palette.page,
  },
  localTitle: {
    minWidth: 0,
    flex: 1,
    color: palette.silver50,
    fontFamily: fonts.medium,
    fontSize: 21,
    letterSpacing: -0.3,
  },
  inboxHeader: { minHeight: 48 },
  inboxTitle: { fontSize: 24, letterSpacing: 0 },
  threadHeaderTitle: { fontSize: 15, lineHeight: 20, letterSpacing: 0 },
  localActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: spacing.xl,
  },
  centerText: {
    maxWidth: 340,
    color: palette.silver500,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  signalGlyph: {
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.hairlineBright,
    borderRadius: 34,
    backgroundColor: palette.panelRaised,
  },
  emptyHero: { color: palette.silver50, fontFamily: fonts.light, fontSize: 31 },
  inbox: { flex: 1, gap: spacing.md, paddingTop: spacing.md - spacing.xs },
  signalRoot: { flex: 1, gap: spacing.md, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  rootTitleRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  rootTitle: { minWidth: 0, flex: 1, color: palette.silver50, fontFamily: fonts.medium, fontSize: 24 },
  rootActions: { minHeight: 52, marginTop: -spacing.xs, flexDirection: "row", alignItems: "center", gap: 8 },
  rootMenuButton: { width: 44, height: 44 },
  rootFilterPanel: { gap: spacing.sm },
  searchHistoryOption: { backgroundColor: palette.page },
  rootSearch: {
    minHeight: 44,
    flex: 1,
    paddingLeft: 12,
    paddingRight: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: 999,
    backgroundColor: palette.page,
  },
  rootContent: { minHeight: 0, flex: 1, gap: spacing.md },
  rootTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel },
  rootTab: { flex: 1 },
  rootScroll: { flex: 1 },
  rootGrid: { flexGrow: 1, alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10, paddingBottom: spacing.xl },
  emptyGrid: { minHeight: 360, alignContent: "center", alignItems: "center", justifyContent: "center" },
  rootCard: { position: "relative", overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panelRaised },
  rootCardSelected: { borderColor: palette.silver50, borderWidth: 1, backgroundColor: "transparent" },
  rootCardSkeleton: { borderRadius: radii.md, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  rootCardMain: { width: "100%", height: "100%", paddingHorizontal: 8, paddingVertical: 10, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 },
  coveredCardMain: { justifyContent: "flex-end", paddingBottom: 10 },
  coveredCardLabel: { width: "auto", maxWidth: "100%", paddingHorizontal: 5, paddingVertical: 4, overflow: "hidden", borderRadius: radii.sm, backgroundColor: "rgba(0,0,0,0.68)", color: palette.silver50 },
  rootCardTitle: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, lineHeight: 15, textAlign: "center" },
  rootEmptyState: { width: "100%", flex: 1, minHeight: 360, alignItems: "center", justifyContent: "center", gap: 14 },
  rootEmpty: { width: "100%", color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
  rootEmptyHelp: { maxWidth: 300, color: palette.silver700, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, textAlign: "center" },
  emptyPlusButton: { width: 44, height: 44 },
  replyContextFooter: { width: "100%", gap: spacing.sm },
  replyContextList: { flexGrow: 1, gap: spacing.sm, paddingBottom: spacing.xl },
  replyContextEmpty: { flex: 1, minHeight: 320, alignItems: "center", justifyContent: "center", gap: spacing.md },
  replyContextPill: { width: "100%", justifyContent: "flex-start", paddingHorizontal: spacing.md },
  replyContextPillSelected: { borderColor: palette.silver50 },
  replyContextPillText: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 13, textAlign: "left" },
  replyContextPillSkeleton: { width: "100%", height: 44, borderRadius: 999 },
  replyContextSelectionToolbar: { width: "100%", minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  replyContextSelectionCount: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  replyContextSelectionClear: { width: 44, height: 44, paddingHorizontal: 0 },
  replyContextSelectionText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 13 },
  replyContextEditor: { flexGrow: 1, gap: 12, paddingBottom: spacing.xl },
  replyContextTextInput: { minHeight: 120 },
  rootToneError: { width: "100%", alignItems: "center", paddingHorizontal: spacing.lg },
  rootInlineNotice: { width: "100%", minHeight: 44, paddingLeft: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panel },
  inboxActions: { minHeight: 52, marginHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  inboxFilterButton: { width: 44, height: 44, minHeight: 44 },
  categoryTabsFrame: { marginHorizontal: spacing.md },
  categoryTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel },
  categoryTab: { minHeight: 28, flex: 1 },
  facetRow: { minHeight: 44, marginHorizontal: spacing.md, marginTop: 8, flexDirection: "row", alignItems: "center", gap: 4 },
  facetButton: { minWidth: 0, minHeight: 44, flex: 1, paddingHorizontal: 4 },
  inlineNotice: { minHeight: 38, marginHorizontal: spacing.md, marginTop: spacing.sm, paddingLeft: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panel },
  inlineNoticeText: { minWidth: 0, flex: 1, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  aiComposerError: { paddingHorizontal: spacing.sm, color: "#D98B8B", fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  aiResponse: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, borderRadius: radii.md, backgroundColor: palette.panel },
  signalComposer: { backgroundColor: palette.page },
  searchBox: {
    minHeight: 44,
    flex: 1,
    paddingLeft: 12,
    paddingRight: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: 999,
    backgroundColor: palette.page,
  },
  searchInput: {
    minHeight: 40,
    flex: 1,
    paddingHorizontal: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    fontSize: 13,
  },
  accountLine: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
  },
  accountText: {
    minWidth: 0,
    flex: 1,
    color: palette.silver700,
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  selectionNotice: { marginHorizontal: spacing.md, color: palette.silver300, fontFamily: fonts.medium, fontSize: 12 },
  bulkToolbar: { minHeight: 40, marginHorizontal: spacing.md, padding: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, backgroundColor: palette.panel },
  rootBulkToolbar: { minHeight: 40, padding: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, backgroundColor: palette.panel },
  bulkToolbarSelection: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  bulkToolbarClose: { height: 28, width: 28, paddingHorizontal: 0, paddingVertical: 0 },
  bulkSelectionText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  threadList: { paddingHorizontal: spacing.md, gap: spacing.sm },
  threadRowSkeleton: { width: "100%", height: 38, borderRadius: 999 },
  paginationSkeleton: { width: "100%", height: 38, borderRadius: 999 },
  threadCard: {
    width: "100%",
    minHeight: 38,
    justifyContent: "flex-start",
    paddingHorizontal: 14,
  },
  threadCardSelected: { borderColor: palette.silver50, borderWidth: 1, backgroundColor: "transparent" },
  priorityBar: {
    width: 3,
    alignSelf: "stretch",
    backgroundColor: "transparent",
  },
  priorityUrgent: { backgroundColor: palette.silver50 },
  priorityHigh: { backgroundColor: palette.silver500 },
  threadBody: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center" },
  subject: {
    minWidth: 0,
    flex: 1,
    color: palette.silver100,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  subjectUnread: { color: palette.silver50, fontFamily: fonts.medium },
  threadFooter: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  state: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: palette.silver700,
    color: palette.silver100,
    fontFamily: fonts.semibold,
    fontSize: 8,
    letterSpacing: 1.2,
  },
  intent: {
    minWidth: 0,
    flex: 1,
    color: palette.silver700,
    fontFamily: fonts.medium,
    fontSize: 9,
    textTransform: "uppercase",
  },
  empty: { alignItems: "center", paddingVertical: 70, gap: 9 },
  detail: { minHeight: 0, flex: 1 },
  detailContent: { minHeight: 0, flex: 1, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  readerActions: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: spacing.sm },
  threadMessageList: { flexGrow: 1, gap: spacing.sm, paddingBottom: spacing.xl },
  threadMessagePill: { width: "100%", minHeight: 64, justifyContent: "flex-start", paddingHorizontal: 14 },
  threadMessagePillSelected: { borderColor: palette.silver50, borderWidth: 1, backgroundColor: "transparent" },
  threadMessageCopy: { minWidth: 0, flex: 1, gap: 3 },
  threadMessageMeta: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  threadMessageSender: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "left" },
  threadMessageTime: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 10 },
  threadMessageSubject: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, textAlign: "left" },
  threadMessageSkeleton: { width: "100%", height: 64, borderRadius: 999 },
  readerDocument: { minHeight: 0, width: "100%", flex: 1, overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.xl, backgroundColor: palette.page },
  readerSkeleton: { padding: spacing.md },
  readerBodySkeleton: { width: "100%", flex: 1, borderRadius: radii.lg },
  readerDocumentContent: { flexGrow: 1, padding: spacing.md, gap: spacing.md },
  messageHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  messageAddress: { minWidth: 0, flex: 1, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  messageTime: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, textAlign: "right" },
  messageSubject: { width: "100%", color: palette.silver50, fontFamily: fonts.semibold, fontSize: 20, lineHeight: 27 },
  readerBody: { width: "100%", color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26, textAlign: "left", writingDirection: "ltr" },
  attachmentLabel: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  attachmentText: {
    color: palette.silver500,
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  incomingAttachments: { marginTop: spacing.sm, gap: spacing.xs },
  incomingAttachment: { width: "100%", justifyContent: "flex-start", paddingHorizontal: spacing.sm },
  incomingAttachmentStatic: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panel },
  incomingAttachmentText: { minWidth: 0, flex: 1, color: palette.silver300, fontFamily: fonts.medium, fontSize: 12, textAlign: "left" },
  receivedAttachmentContent: { flexGrow: 1, gap: spacing.sm, paddingBottom: spacing.xl },
  receivedAttachmentGrid: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  receivedAttachmentCard: { position: "relative", overflow: "hidden", flexDirection: "column", justifyContent: "center", gap: 8, paddingHorizontal: 6, borderWidth: 1, borderColor: palette.hairline, backgroundColor: palette.panelRaised },
  receivedAttachmentImage: StyleSheet.absoluteFill,
  receivedAttachmentLabel: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 11, textAlign: "center" },
  receivedAttachmentImageLabel: { position: "absolute", right: 4, bottom: 4, left: 4, width: "auto", paddingHorizontal: 4, paddingVertical: 3, overflow: "hidden", borderRadius: radii.sm, backgroundColor: "rgba(0,0,0,0.68)", color: palette.silver50 },
  sheetError: {
    marginBottom: 10,
    padding: 10,
    borderRadius: radii.md,
    backgroundColor: "rgba(64,20,20,0.9)",
  },
  sheetErrorText: {
    color: palette.silver100,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  sheetItems: { gap: 10 },
  trashRootContent: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  metadataForm: { flexGrow: 1, gap: 12, paddingBottom: spacing.xl },
  inboxEditForm: { gap: spacing.lg },
  formScroll: { flex: 1 },
  metadataDescriptionInput: { minHeight: 120 },
  metadataInstructionInput: { minHeight: 170 },
  metadataCoverControl: { width: 88, height: 88, position: "relative", alignSelf: "flex-start" },
  metadataCoverButton: { width: 88, height: 88, paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden" },
  metadataCoverRemove: { width: 42, height: 42, minHeight: 42, paddingHorizontal: 0, paddingVertical: 0, position: "absolute", right: -12, top: -12 },
  favoriteRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  favoriteLabel: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12 },
  newEmailForm: { flexGrow: 1, gap: spacing.sm, paddingBottom: spacing.xl },
  newEmailBodyInput: { minHeight: 280, paddingTop: 12, lineHeight: 22 },
  inlineError: { paddingHorizontal: 2 },
  inlineErrorText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  recipientChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  recipientChip: { alignSelf: "flex-start", minHeight: 42, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "rgba(221, 226, 229, 0.18)", borderRadius: 999, backgroundColor: "rgba(255, 255, 255, 0.03)" },
  recipientChipCompact: { minHeight: 34 },
  recipientChipMain: { minWidth: 0, flexShrink: 1, justifyContent: "flex-start", paddingLeft: spacing.sm, paddingRight: 0 },
  recipientChipRemove: { width: 42, height: 42, paddingHorizontal: 0, paddingVertical: 0 },
  recipientChipRemoveCompact: { width: 24, minWidth: 24, maxWidth: 24, height: 24, minHeight: 24, maxHeight: 24, marginRight: 3, borderRadius: 12 },
  recipientChipText: { minWidth: 0, flexShrink: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  attachmentChipMain: { justifyContent: "center", paddingLeft: 7 },
  attachmentChip: { minHeight: 34 },
  attachmentChipRemove: { width: 24, minWidth: 24, maxWidth: 24, height: 24, minHeight: 24, maxHeight: 24, marginRight: 3, borderRadius: 12 },
  attachmentChipText: { textAlign: "center" },
  attachmentActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs },
  reviewAttachmentGrid: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  reviewAttachmentCard: { width: "100%", height: "100%", position: "relative", overflow: "hidden", flexDirection: "column", justifyContent: "center", gap: 8, paddingHorizontal: 6, borderWidth: 1, borderColor: palette.hairline, backgroundColor: palette.panelRaised },
  reviewAttachmentImage: StyleSheet.absoluteFill,
  reviewAttachmentLabel: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  alternativeList: { flexGrow: 1, gap: spacing.xs, paddingBottom: spacing.xl },
  newEmailAlternative: { width: "100%", justifyContent: "flex-start", paddingHorizontal: spacing.md, backgroundColor: palette.page },
  newEmailAlternativeCopy: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  newEmailAlternativePreview: { minWidth: 0, flex: 1, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11 },
  newEmailAlternativeSkeleton: { width: "100%", height: 38, borderRadius: 999 },
  fieldLabel: {
    color: palette.silver500,
    fontFamily: fonts.semibold,
    fontSize: 9,
    letterSpacing: tracking.micro,
  },
  inputLabel: { marginLeft: 2, color: palette.silver300, fontFamily: fonts.medium, fontSize: 12, letterSpacing: 0.4 },
  sheetAction: { justifyContent: "center", backgroundColor: palette.voidBlack },
  flexAction: { minWidth: 0, flex: 1 },
  confirmText: {
    paddingVertical: 8,
    color: palette.silver100,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  readerFlowContent: { flexGrow: 1, gap: spacing.md, paddingBottom: spacing.xl },
  transformationForm: { flex: 1, gap: spacing.sm },
  generatedReader: { flexGrow: 1, paddingVertical: spacing.md, paddingBottom: spacing.xl },
  draftEditor: { minHeight: 320 },
  languageChoices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  versionPanel: { gap: 6 },
  versionSkeleton: { width: "100%", height: 42, borderRadius: 999 },
  versionRow: { flexDirection: "row", alignItems: "stretch", gap: 6 },
  versionMain: { flex: 1, justifyContent: "flex-start", paddingHorizontal: 14 },
  sheetEmptyContent: { flexGrow: 1, alignContent: "center", alignItems: "center", justifyContent: "center" },
  sheetList: { flex: 1 },
  versionList: { gap: 6, paddingBottom: spacing.xl },
  summaryVersionPanel: { flex: 1, minHeight: 0, gap: spacing.md },
  generatedVersionSelected: { borderColor: palette.silver50, borderWidth: 2 },
  generatedSelectionBadge: { position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.silver50 },
  generatedBulkToolbar: { width: "100%", minHeight: 36, marginBottom: spacing.xs, padding: 3, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, backgroundColor: palette.panel },
  generatedBulkToolbarSelection: { flexDirection: "row", alignItems: "center", gap: 8 },
  generatedBulkToolbarClose: { height: 42, width: 42, paddingHorizontal: 0, paddingVertical: 0 },
  generatedBulkSelectionText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  generatedBulkDeleteAction: { minWidth: 68, paddingHorizontal: 12 },
  generatedBulkDeleteText: { fontFamily: fonts.regular, fontSize: 11, letterSpacing: 0.4 },
  generatedDeleteConfirmation: { gap: spacing.sm },
  resultText: { minWidth: 0, flex: 1, gap: 3 },
  rowTitle: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 14, textAlign: "left" },
  rowSubtitle: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, textAlign: "left" },
  similarFlow: { flex: 1, minHeight: 0, gap: spacing.md },
  similarResults: { flexGrow: 1, gap: spacing.sm, paddingBottom: spacing.xl },
  similarResult: { width: "100%", minHeight: 42, justifyContent: "flex-start", paddingHorizontal: 14, gap: spacing.sm },
  similarResultText: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14, textAlign: "left" },
});

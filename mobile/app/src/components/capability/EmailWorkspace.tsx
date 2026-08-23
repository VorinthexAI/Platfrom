import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import {
  KeyboardAvoidingView,
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
import { Button } from "@vorinthex/shared/ui/button";
import {
  BrainIcon,
  ChevronLeftIcon,
  CloseIcon,
  FileIcon,
  InboxIcon,
  MailIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SortIcon,
  StarIcon,
  TrashIcon,
} from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { Switch } from "@vorinthex/shared/ui/switch";
import { useToast } from "@vorinthex/shared/ui/toast";

import { EmailAttachmentPicker } from "@/components/capability/EmailAttachmentPicker";
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { type CapabilitySlug } from "@/data/registry";
import { subscribeAppEvent } from "@/lib/app-events";
import {
  assignEmailDraft,
  BUILT_IN_EMAIL_TONES,
  composeEmailDraftForContext,
  createEmailReplyContextForContext,
  createEmailToneForContext,
  createEmailDraftForContext,
  disconnectEmail,
  deleteEmailReplyContextsForContext,
  exchangeEmailConnection,
  findSimilarEmailMessagesForContext,
  fetchEmailOverviewForContext,
  fetchEmailReplyContextsForContext,
  fetchEmailThreadForContext,
  fetchEmailTonesForContext,
  getEmailContext,
  getEmailPermissions,
  launchEmailConnection,
  listEmailMessageSummariesForContext,
  listEmailMessageTranslationsForContext,
  sendEmailDraftForContext,
  setEmailThreadFavorite,
  sortEmailInboxForContext,
  subscribeEmail,
  summarizeEmailMessageForContext,
  syncEmail,
  translateEmailMessageForContext,
  trashEmailThreadForContext,
  updateEmailInboxForContext,
  updateEmailReplyContextForContext,
  updateEmailToneForContext,
  updateEmailDraftForContext,
  type EmailAttachmentRef,
  type EmailDraft,
  type EmailConnector,
  type EmailFilter,
  type EmailInboxCategory,
  type EmailMessage,
  type EmailOverview,
  type EmailReplyContext,
  type EmailThread,
  type EmailSimilarResult,
  type EmailSummary,
  type EmailSummaryStyle,
  type EmailTone,
  type EmailToneRecord,
  type EmailTranslationVersion,
} from "@/lib/email-client";
import {
  patchSignalInbox,
  patchSignalThread,
  moveSignalThreadToFiltered,
  reconcileSignalTrashedThread,
  signalQueryKeys,
  upsertSignalSummary,
  upsertSignalTone,
  upsertSignalTranslationVersion,
} from "@/lib/workspace-query-cache";
import { normalizeCapturedJpeg } from "@/lib/captured-image";
import { fetchGalleryUploadStatus, uploadGalleryImages } from "@/lib/gallery-client";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";
import { appendCursorItems, isNearScrollEnd } from "@vorinthex/shared/lib/pagination";

type Sheet =
  "ai" | "plus" | "rootMenu" | "connectForm" | "toneCreate" | "inboxEdit" | "toneEdit" | "account" | "assignDraft" | "drafts" | "disconnect" | "discard" | "composer";
type RootTab = "inboxes" | "tones";
type ComposerMode = "new" | "reply";
type FormSheet = "connectForm" | "toneCreate" | "inboxEdit" | "toneEdit";
type BusyAction =
  | "connect"
  | "toneCreate"
  | "metadata"
  | "sync"
  | "sort"
  | "draft"
  | "save"
  | "send"
  | "favorite"
  | "assign"
  | "disconnect"
  | "ai";
const INBOX_CATEGORIES: { category: EmailInboxCategory; filter: EmailFilter }[] = [
  { category: "Urgent", filter: "urgent" },
  { category: "Important", filter: "important" },
  { category: "Filtered", filter: "filtered" },
];
type ReaderSheet = "translate" | "translationReader" | "summary" | "summaryReader" | "similar" | "delete";
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

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
function formatTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function stateLabel(thread: EmailThread) {
  return thread.priority === "urgent"
    ? "URGENT"
    : thread.priority === "high"
      ? "HIGH"
      : thread.state === "needs_action"
        ? "ACTION"
        : thread.state.replace("_", " ").toUpperCase();
}
function inboxCategoryCount(overview: EmailOverview | undefined, category: EmailInboxCategory) {
  return category === "Urgent" ? overview?.counts.urgent ?? 0 : category === "Important" ? overview?.counts.important ?? 0 : overview?.counts.filtered ?? 0;
}

export function EmailWorkspace({ initialConnectorKey }: { initialConnectorKey?: string }) {
  const queryClient = useQueryClient();
  const emailContext = getEmailContext();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { showToast } = useToast();
  const notify = (title: string) => showToast({ title, duration: 2_000 });
  const params = useLocalSearchParams<{
    connectorKey?: string;
    email_connection_code?: string;
    email_connection_error?: string;
  }>();
  const processedConnectionCode = useRef<string | undefined>(undefined);
  const overviewRequest = useRef(0);
  const overviewGeneration = useRef(0);
  const overviewPageGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const overviewLoadQuery = useRef<{ filter: EmailFilter; search: string } | undefined>(undefined);
  const overviewQuery = useRef<{ filter: EmailFilter; search: string }>({ filter: "important", search: "" });
  const loadingOverview = useRef(false);
  const loadingMore = useRef(false);
  const toneRequest = useRef(0);
  const metadataRequests = useRef(new Map<string, number>());
  const operationGeneration = useRef(0);
  const readerGeneration = useRef(0);
  const readerTargetKey = useRef<string | undefined>(undefined);
  const selectedThreadKeyRef = useRef<string | undefined>(undefined);
  const selectedMessageKeyRef = useRef<string | undefined>(undefined);
  const composerOperationGeneration = useRef(0);
  const composerBusyGeneration = useRef<number | undefined>(undefined);
  const sendGeneration = useRef<number | undefined>(undefined);
  const formBaseline = useRef<{ sheet: FormSheet; value: string } | undefined>(undefined);
  const toneCreateInFlight = useRef(false);
  const metadataInFlight = useRef(false);
  const metadataFormContext = useRef<typeof emailContext | undefined>(undefined);
  const toneContext = useRef({ organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey });
  const nativeNavigationAction = useRef<
    Parameters<typeof navigation.dispatch>[0] | undefined
  >(undefined);
  const allowNavigation = useRef(false);
  const [overview, setOverview] = useState<EmailOverview>();
  const [rootQuery, setRootQuery] = useState("");
  const [rootTab, setRootTab] = useState<RootTab>("inboxes");
  const [rootGridWidth, setRootGridWidth] = useState(0);
  const [filter, setFilter] = useState<EmailFilter>("important");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selected, setSelected] = useState<{
    thread: EmailThread;
    messages: EmailMessage[];
  }>();
  const [selectedMessageKey, setSelectedMessageKey] = useState<string>();
  const [readerSheet, setReaderSheet] = useState<ReaderSheet>("translate");
  const [readerSheetOpen, setReaderSheetOpen] = useState(false);
  const [readerLoading, setReaderLoading] = useState(false);
  const [readerError, setReaderError] = useState<string>();
  const [targetLanguage, setTargetLanguage] = useState("");
  const [translations, setTranslations] = useState<EmailTranslationVersion[]>([]);
  const [selectedTranslation, setSelectedTranslation] = useState<EmailTranslationVersion>();
  const [summaryTopic, setSummaryTopic] = useState("");
  const [summaryStyle, setSummaryStyle] = useState<EmailSummaryStyle>("brief");
  const [summaries, setSummaries] = useState<EmailSummary[]>([]);
  const [selectedSummary, setSelectedSummary] = useState<EmailSummary>();
  const [similarCategory, setSimilarCategory] = useState<EmailInboxCategory>("Important");
  const [similarResults, setSimilarResults] = useState<EmailSimilarResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [busy, setBusy] = useState<BusyAction>();
  const [openingThreadKey, setOpeningThreadKey] = useState<string>();
  const [sheet, setSheet] = useState<Sheet>("plus");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [replyContextsOpen, setReplyContextsOpen] = useState(false);
  const [pendingExit, setPendingExit] = useState<
    "inbox" | "native" | "disconnect" | CapabilitySlug
  >();
  const [returnToComposer, setReturnToComposer] = useState(false);
  const [discardFormSheet, setDiscardFormSheet] = useState<FormSheet>();
  const [discardFormNative, setDiscardFormNative] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>("new");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCopies, setShowCopies] = useState(false);
  const [subject, setSubject] = useState("");
  const [tone, setTone] = useState<EmailTone>("concise");
  const [toneRecords, setToneRecords] = useState<EmailToneRecord[]>([]);
  const [tonesLoading, setTonesLoading] = useState(true);
  const [toneError, setToneError] = useState<string>();
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<EmailDraft>();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<EmailAttachmentRef[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheetError, setSheetError] = useState<string>();
  const [unassignedDraft, setUnassignedDraft] = useState<EmailDraft>();
  const [connectName, setConnectName] = useState("");
  const [connectDescription, setConnectDescription] = useState("");
  const [toneName, setToneName] = useState("");
  const [toneDescription, setToneDescription] = useState("");
  const [toneInstruction, setToneInstruction] = useState("");
  const [editingTone, setEditingTone] = useState<EmailToneRecord>();
  const [metadataName, setMetadataName] = useState("");
  const [metadataDescription, setMetadataDescription] = useState("");
  const [metadataInstruction, setMetadataInstruction] = useState("");
  const [metadataFavorite, setMetadataFavorite] = useState(false);
  const [metadataCoverAsset, setMetadataCoverAsset] = useState<ImagePicker.ImagePickerAsset | null>();
  const permissions = getEmailPermissions();
  const composerDirty = Boolean(
    draft ||
    to.trim() ||
    cc.trim() ||
    bcc.trim() ||
    subject.trim() ||
    tone !== "concise" ||
    instruction.trim() ||
    body.trim() ||
    attachments.length,
  );
  const formSnapshot = (target: FormSheet) => JSON.stringify(target === "connectForm"
    ? [connectName, connectDescription]
    : target === "toneCreate"
      ? [toneName, toneDescription, toneInstruction]
      : [metadataName, metadataDescription, metadataInstruction, metadataFavorite, metadataCoverAsset === undefined ? "unchanged" : metadataCoverAsset?.uri ?? null]);
  const formDirty = Boolean(formBaseline.current && formBaseline.current.sheet === sheet && formBaseline.current.value !== formSnapshot(sheet as FormSheet));

  const tones = toneRecords.length
    ? toneRecords.map((record) => ({ label: record.name, value: record.slug ?? record.key }))
    : BUILT_IN_EMAIL_TONES.map((value) => ({ label: `${value[0]?.toUpperCase()}${value.slice(1)}`, value }));
  const rootCardSize = Math.floor(((rootGridWidth || width - spacing.md * 2) - 16) / 3);
  const normalizedRootQuery = rootQuery.trim().toLowerCase();
  const visibleAccounts = (overview?.accounts ?? []).filter(({ email, name, description }) =>
    [email, name, description ?? ""].some((value) => value.toLowerCase().includes(normalizedRootQuery)),
  );
  const visibleUnassignedDrafts = (overview?.unassignedDrafts ?? []).filter(({ subject }) =>
    (subject ?? "Untitled draft").toLowerCase().includes(normalizedRootQuery),
  );
  const visibleTones = toneRecords.filter(({ name, description, instruction }) =>
    [name, description ?? "", instruction].some((value) => value.toLowerCase().includes(normalizedRootQuery)),
  );
  const selectedMessage = selected?.messages.find(({ key }) => key === selectedMessageKey)
    ?? [...(selected?.messages ?? [])].sort((left, right) => right.sentAt.localeCompare(left.sentAt) || right.key.localeCompare(left.key))[0];
  useEffect(() => {
    selectedThreadKeyRef.current = selected?.thread.key;
    selectedMessageKeyRef.current = selectedMessage?.key;
  }, [selected?.thread.key, selectedMessage?.key]);

  function contextIsCurrent(context: typeof emailContext) {
    try {
      const current = getEmailContext();
      return current.organizationKey === context.organizationKey && current.scopeKey === context.scopeKey;
    } catch {
      return false;
    }
  }
  function readerOperationIsCurrent(generation: number, context: typeof emailContext, threadKey: string, messageKey: string) {
    return generation === readerGeneration.current && contextIsCurrent(context) && selectedThreadKeyRef.current === threadKey && selectedMessageKeyRef.current === messageKey;
  }
  function loadOverviewForContext(context: typeof emailContext, connectorKey: string, nextFilter: EmailFilter, nextSearch: string) {
    return queryClient.fetchQuery({
      queryKey: signalQueryKeys.overview(context, connectorKey, nextFilter, nextSearch),
      queryFn: () => fetchEmailOverviewForContext(context, { connectorKey, filter: nextFilter, search: nextSearch || undefined, limit: 50 }),
      staleTime: 0,
    });
  }
  function closeReaderFlow() {
    readerGeneration.current += 1;
    readerTargetKey.current = undefined;
    setReaderSheetOpen(false);
    setReaderLoading(false);
  }
  function clearSelectedThread() {
    detailGeneration.current += 1;
    readerGeneration.current += 1;
    selectedThreadKeyRef.current = undefined;
    selectedMessageKeyRef.current = undefined;
    readerTargetKey.current = undefined;
    setSelected(undefined);
    setSelectedMessageKey(undefined);
    setReaderSheetOpen(false);
    setReaderLoading(false);
  }

  async function load(nextFilter = overviewQuery.current.filter, nextQuery = overviewQuery.current.search, options: { cursor?: string } = {}) {
    const continuation = Boolean(options.cursor);
    const request = continuation ? overviewRequest.current : ++overviewRequest.current;
    if (!continuation && (overviewLoadQuery.current?.filter !== nextFilter || overviewLoadQuery.current.search !== nextQuery)) {
      overviewLoadQuery.current = { filter: nextFilter, search: nextQuery };
      overviewGeneration.current += 1;
    }
    const generation = overviewGeneration.current;
    const pageGeneration = continuation ? overviewPageGeneration.current : ++overviewPageGeneration.current;
    if (!continuation) loadingOverview.current = true;
    if (!options.cursor) setLoadError(undefined);
    try {
      const value = await queryClient.fetchQuery({
        queryKey: options.cursor
          ? signalQueryKeys.overviewPage(emailContext, initialConnectorKey, nextFilter, nextQuery, options.cursor)
          : signalQueryKeys.overview(emailContext, initialConnectorKey, nextFilter, nextQuery),
        queryFn: () =>
          fetchEmailOverviewForContext(emailContext, {
            connectorKey: initialConnectorKey,
            filter: nextFilter,
            search: nextQuery || undefined,
            cursor: options.cursor,
            limit: 50,
          }),
        staleTime: 0,
      });
      const currentQuery = overviewQuery.current;
      const active = generation === overviewGeneration.current
        && (!continuation ? request === overviewRequest.current : pageGeneration === overviewPageGeneration.current)
        && currentQuery.filter === nextFilter
        && currentQuery.search === nextQuery;
      if (active) setOverview((current) => {
        if (options.cursor && current) return {
          ...current,
          ...value,
          threads: appendCursorItems(current.threads, value.threads, ({ key }) => key),
          nextCursor: value.nextCursor === options.cursor ? null : value.nextCursor,
        };
        return value;
      });
      return active ? "applied" as const : "superseded" as const;
    } catch (failure) {
      const currentQuery = overviewQuery.current;
      const active = generation === overviewGeneration.current
        && (!continuation ? request === overviewRequest.current : pageGeneration === overviewPageGeneration.current)
        && currentQuery.filter === nextFilter
        && currentQuery.search === nextQuery;
      if (active)
        setLoadError(messageFor(failure));
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
  const loadToneRecords = () => {
    const request = ++toneRequest.current;
    const context = toneContext.current;
    setTonesLoading(true);
    setToneError(undefined);
    return queryClient.fetchQuery({
      queryKey: signalQueryKeys.tones(context),
      queryFn: () => fetchEmailTonesForContext(context),
      staleTime: 0,
    }).then((records) => {
      if (request === toneRequest.current && context.organizationKey === toneContext.current.organizationKey && context.scopeKey === toneContext.current.scopeKey) {
        setToneRecords(records);
        setTonesLoading(false);
      }
    }).catch((failure: unknown) => {
      if (request === toneRequest.current && context.organizationKey === toneContext.current.organizationKey && context.scopeKey === toneContext.current.scopeKey) {
        setToneRecords([]);
        setToneError(messageFor(failure));
        setTonesLoading(false);
      }
    });
  };
  const loadToneRecordsLatest = useEffectEvent(() => loadToneRecords());
  function operationIsCurrent(generation: number, context: typeof emailContext) {
    if (generation !== operationGeneration.current) return false;
    try {
      const current = getEmailContext();
      return current.organizationKey === context.organizationKey && current.scopeKey === context.scopeKey;
    } catch {
      return false;
    }
  }
  function composerOperationIsCurrent(generation: number, context: typeof emailContext) {
    if (generation !== composerOperationGeneration.current) return false;
    try {
      const current = getEmailContext();
      return current.organizationKey === context.organizationKey && current.scopeKey === context.scopeKey;
    } catch {
      return false;
    }
  }
  function invalidateComposerOperation() {
    composerOperationGeneration.current += 1;
    if (composerBusyGeneration.current !== undefined) {
      composerBusyGeneration.current = undefined;
      setBusy(undefined);
    }
  }
  function invalidateSignalMetadata(context: typeof emailContext) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: signalQueryKeys.overviews(context), refetchType: "none" }),
      queryClient.invalidateQueries({ queryKey: signalQueryKeys.tones(context), refetchType: "none" }),
    ]);
  }
  function completeConnection(connector: EmailConnector) {
    const rootRefresh = queryClient.fetchQuery({
      queryKey: signalQueryKeys.overview(emailContext),
      queryFn: () => fetchEmailOverviewForContext(emailContext),
      staleTime: 0,
    });
    void Promise.allSettled([
      syncEmail(connector.connectorKey),
      subscribeEmail(connector.connectorKey),
      rootRefresh,
    ]).then(([syncResult, subscribeResult, refreshResult]) => {
      if (syncResult.status === "rejected" || subscribeResult.status === "rejected")
        notify("Gmail connected. Initial sync or live updates need another try.");
      else if (refreshResult.status === "rejected")
        notify("Gmail connected. The inbox list will refresh automatically.");
    });
    router.replace({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey: connector.connectorKey } });
  }
  const completeConnectionFromEffect = useEffectEvent((connector: EmailConnector) => completeConnection(connector));
  const refreshFromInboxEvent = useEffectEvent(async () => {
    await Promise.all([
      queryClient.cancelQueries({ queryKey: signalQueryKeys.overviews(emailContext) }),
      queryClient.cancelQueries({ queryKey: signalQueryKeys.details(emailContext) }),
      queryClient.cancelQueries({ queryKey: signalQueryKeys.tones(emailContext) }),
    ]);
    void load();
    if (initialConnectorKey) void queryClient.fetchQuery({
      queryKey: signalQueryKeys.overview(emailContext),
      queryFn: () => fetchEmailOverviewForContext(emailContext),
      staleTime: 0,
    });
    void loadToneRecords();
    if (selected) {
      const threadKey = selected.thread.key;
      const generation = ++detailGeneration.current;
      void queryClient.fetchQuery({
        queryKey: signalQueryKeys.detail(emailContext, initialConnectorKey, threadKey),
        queryFn: () => fetchEmailThreadForContext(emailContext, threadKey),
      }).then((detail) => {
        if (generation === detailGeneration.current) setSelected((current) => current?.thread.key === threadKey ? detail : current);
      }).catch(() => undefined);
    }
  });

  useEffect(() => {
    overviewRequest.current += 1;
    overviewGeneration.current += 1;
    overviewPageGeneration.current += 1;
    overviewLoadQuery.current = undefined;
    overviewQuery.current = { filter: "important", search: "" };
    loadingOverview.current = false;
    loadingMore.current = false;
    toneRequest.current += 1;
    toneContext.current = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    void Promise.resolve().then(() => {
      setOverview(undefined);
      clearSelectedThread();
      setFilter("important");
      setQuery("");
      setSubmittedQuery("");
      setLoadError(undefined);
      setLoading(true);
      setOpeningThreadKey(undefined);
      setLoadingMoreThreads(false);
      void loadLatest();
      void loadToneRecordsLatest();
    });
  }, [emailContext.organizationKey, emailContext.scopeKey, initialConnectorKey]);
  useEffect(() => {
    const generation = ++operationGeneration.current;
    invalidateComposerOperation();
    sendGeneration.current = undefined;
    const requests = metadataRequests.current;
    requests.clear();
    toneCreateInFlight.current = false;
    metadataInFlight.current = false;
    metadataFormContext.current = undefined;
    void Promise.resolve().then(() => {
      if (generation !== operationGeneration.current) return;
      setEditingTone(undefined);
      setBusy(undefined);
      setSheet("plus");
      setSheetOpen(false);
      setReplyContextsOpen(false);
      setDiscardFormSheet(undefined);
      setDiscardFormNative(false);
      setSheetError(undefined);
    });
    return () => {
      operationGeneration.current += 1;
      composerOperationGeneration.current += 1;
      composerBusyGeneration.current = undefined;
      sendGeneration.current = undefined;
      requests.clear();
      toneCreateInFlight.current = false;
      metadataInFlight.current = false;
      metadataFormContext.current = undefined;
    };
  }, [emailContext.organizationKey, emailContext.scopeKey]);
  useEffect(() => {
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    return navigation.addListener("focus", () => {
      void queryClient.cancelQueries({ queryKey: signalQueryKeys.tones(context) }).then(() => {
        void queryClient.invalidateQueries({ queryKey: signalQueryKeys.tones(context), refetchType: "none" });
        void loadToneRecordsLatest();
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
      notifyLatest("Gmail connection was not completed.");
  }, [params.email_connection_error]);
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
        if (formDirty) {
          event.preventDefault();
          if (!busy) {
            nativeNavigationAction.current = event.data.action;
            setDiscardFormNative(true);
            setDiscardFormSheet(sheet as FormSheet);
            setSheet("discard");
            setSheetOpen(true);
          }
          return;
        }
        if (composerDirty) {
          event.preventDefault();
          nativeNavigationAction.current = event.data.action;
          setPendingExit("native");
          setReturnToComposer(sheet === "composer");
          setSheet("discard");
          setSheetOpen(true);
          return;
        }
        if (selected) {
          event.preventDefault();
          clearSelectedThread();
          return;
        }
        if (initialConnectorKey) {
          event.preventDefault();
          allowNavigation.current = true;
          router.replace({ pathname: "/capability/[slug]", params: { slug: "signal" } });
        }
      }),
    [navigation, busy, composerDirty, formDirty, initialConnectorKey, router, selected, sheet],
  );

  function resetComposer() {
    invalidateComposerOperation();
    setDraft(undefined);
    setTo("");
    setCc("");
    setBcc("");
    setShowCopies(false);
    setSubject("");
    setTone("concise");
    setInstruction("");
    setBody("");
    setAttachments([]);
    setSheetError(undefined);
  }
  function completeNativeBack(action: Parameters<typeof navigation.dispatch>[0]) {
    if (selected) {
      clearSelectedThread();
      return;
    }
    allowNavigation.current = true;
    if (initialConnectorKey)
      router.replace({ pathname: "/capability/[slug]", params: { slug: "signal" } });
    else navigation.dispatch(action);
  }
  function openComposer(mode: ComposerMode) {
    if (sendGeneration.current !== undefined || busy === "send") return;
    resetComposer();
    setComposerMode(mode);
    setSheet("composer");
    setSheetOpen(true);
  }
  async function openSavedDraft(saved: EmailDraft) {
    invalidateComposerOperation();
    setBusy("draft");
    setSheetError(undefined);
    try {
      if (saved.variant === "reply") {
        if (!saved.threadKey)
          throw new Error("The draft conversation is unavailable.");
        const threadKey = saved.threadKey;
        const generation = ++detailGeneration.current;
        const detail = await queryClient.fetchQuery({
          queryKey: signalQueryKeys.detail(emailContext, initialConnectorKey, threadKey),
          queryFn: () => fetchEmailThreadForContext(emailContext, threadKey),
        });
        if (generation !== detailGeneration.current) return;
        setSelected(detail);
        setSelectedMessageKey([...detail.messages].sort((left, right) => right.sentAt.localeCompare(left.sentAt) || right.key.localeCompare(left.key))[0]?.key);
        setComposerMode("reply");
      } else {
        setComposerMode("new");
        setTo(saved.to?.join(", ") ?? "");
        setCc(saved.cc?.join(", ") ?? "");
        setBcc(saved.bcc?.join(", ") ?? "");
        setShowCopies(Boolean(saved.cc?.length || saved.bcc?.length));
        setSubject(saved.subject ?? "");
      }
      setDraft(saved);
      setTone(saved.tone ?? "concise");
      setInstruction(saved.instruction ?? "");
      setAttachments(saved.attachments ?? []);
      setBody(saved.finalContent ?? saved.generatedContent);
      setSheet("composer");
    } catch (failure) {
      setSheetError(messageFor(failure));
    } finally {
      setBusy(undefined);
    }
  }
  function requestExit(destination: "inbox" | CapabilitySlug) {
    if (sendGeneration.current !== undefined || busy === "send") return false;
    if (!composerDirty) return true;
    setPendingExit(destination);
    setReturnToComposer(sheet === "composer");
    setSheet("discard");
    setSheetOpen(true);
    return false;
  }
  function requestComposerClose() {
    if (sendGeneration.current !== undefined || busy === "send") return;
    if (!composerDirty) {
      setSheetOpen(false);
      return;
    }
    setPendingExit(undefined);
    setReturnToComposer(true);
    setSheet("discard");
  }
  function discardComposer() {
    if (sendGeneration.current !== undefined || busy === "send") return;
    const destination = pendingExit;
    resetComposer();
    setPendingExit(undefined);
    setReturnToComposer(false);
    setSheetOpen(false);
    if (destination === "disconnect") {
      setSheet("disconnect");
      setSheetOpen(true);
    } else if (destination === "inbox") clearSelectedThread();
    else if (destination === "native" && nativeNavigationAction.current) {
      const action = nativeNavigationAction.current;
      nativeNavigationAction.current = undefined;
      completeNativeBack(action);
    } else if (destination) {
      if (destination === "signal") clearSelectedThread();
      allowNavigation.current = true;
      router.replace({
        pathname: "/capability/[slug]",
        params: { slug: destination },
      });
    }
  }

  function openConnectForm() {
    setConnectName("");
    setConnectDescription("");
    formBaseline.current = { sheet: "connectForm", value: JSON.stringify(["", ""]) };
    setSheetError(undefined);
    setSheet("connectForm");
    setSheetOpen(true);
  }
  function openToneCreate() {
    setToneName("");
    setToneDescription("");
    setToneInstruction("");
    formBaseline.current = { sheet: "toneCreate", value: JSON.stringify(["", "", ""]) };
    metadataFormContext.current = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    setSheetError(undefined);
    setSheet("toneCreate");
    setSheetOpen(true);
  }
  function openReplyContexts() {
    setSheetOpen(false);
    setReplyContextsOpen(true);
  }
  function openInboxEdit() {
    const inbox = overview?.selectedAccount;
    if (!inbox) return;
    setMetadataName(inbox.name);
    setMetadataDescription(inbox.description ?? "");
    setMetadataInstruction("");
    setMetadataFavorite(inbox.isFavorite);
    setMetadataCoverAsset(undefined);
    formBaseline.current = { sheet: "inboxEdit", value: JSON.stringify([inbox.name, inbox.description ?? "", "", inbox.isFavorite, "unchanged"]) };
    metadataFormContext.current = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    setSheetError(undefined);
    setSheet("inboxEdit");
  }
  function openToneEdit(record: EmailToneRecord) {
    setEditingTone(record);
    setMetadataName(record.name);
    setMetadataDescription(record.description ?? "");
    setMetadataInstruction(record.instruction);
    setMetadataFavorite(record.isFavorite);
    setMetadataCoverAsset(undefined);
    formBaseline.current = { sheet: "toneEdit", value: JSON.stringify([record.name, record.description ?? "", record.instruction, record.isFavorite, "unchanged"]) };
    metadataFormContext.current = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    setSheetError(undefined);
    setSheet("toneEdit");
    setSheetOpen(true);
  }
  function closeForm() {
    formBaseline.current = undefined;
    setDiscardFormSheet(undefined);
    setDiscardFormNative(false);
    setEditingTone(undefined);
    setSheetOpen(false);
  }
  function requestFormClose() {
    if (busy) return;
    if (formDirty) {
      setDiscardFormNative(false);
      setDiscardFormSheet(sheet as FormSheet);
      setSheet("discard");
      setSheetOpen(true);
    } else closeForm();
  }
  function discardFormChanges() {
    const action = discardFormNative ? nativeNavigationAction.current : undefined;
    closeForm();
    if (action) {
      nativeNavigationAction.current = undefined;
      allowNavigation.current = true;
      navigation.dispatch(action);
    }
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
    setToneRecords((current) => current.some(({ key }) => key === record.key)
      ? current.map((candidate) => candidate.key === record.key ? record : candidate)
      : [...current, record]);
    upsertSignalTone(queryClient, context, record);
  }
  function replaceToneIfCurrent(expected: EmailToneRecord, record: EmailToneRecord, context: typeof emailContext) {
    setToneRecords((current) => current.map((candidate) => candidate === expected ? record : candidate));
    queryClient.setQueryData<EmailToneRecord[]>(signalQueryKeys.tones(context), (current) => current?.map((candidate) => candidate === expected ? record : candidate));
  }
  async function connect() {
    const name = connectName.trim();
    if (!name) return;
    setBusy("connect");
    setSheetError(undefined);
    let connector: EmailConnector | null = null;
    try {
      connector = await launchEmailConnection({ name, ...(connectDescription.trim() ? { description: connectDescription.trim() } : {}) });
    } catch (failure) {
      setSheetError(messageFor(failure));
    } finally {
      setBusy(undefined);
    }
    if (connector) completeConnection(connector);
  }
  async function createTone() {
    if (toneCreateInFlight.current) return;
    const name = toneName.trim();
    const instruction = toneInstruction.trim();
    if (!name || !instruction) return;
    const context = metadataFormContext.current;
    if (!context || context.organizationKey !== emailContext.organizationKey || context.scopeKey !== emailContext.scopeKey) return;
    const generation = operationGeneration.current;
    toneCreateInFlight.current = true;
    setBusy("toneCreate");
    setSheetError(undefined);
    const temporaryKey = `optimistic-tone-${Date.now()}`;
    const timestamp = new Date().toISOString();
    const optimistic: EmailToneRecord = { key: temporaryKey, name, ...(toneDescription.trim() ? { description: toneDescription.trim() } : {}), instruction, isFavorite: false, createdAt: timestamp, updatedAt: timestamp };
    replaceTone(optimistic, context);
    try {
      if (!operationIsCurrent(generation, context)) {
        void invalidateSignalMetadata(context);
        return;
      }
      const created = await createEmailToneForContext(context, { name, ...(toneDescription.trim() ? { description: toneDescription.trim() } : {}), instruction });
      if (!operationIsCurrent(generation, context)) {
        void invalidateSignalMetadata(context);
        return;
      }
      replaceToneIfCurrent(optimistic, created, context);
      formBaseline.current = undefined;
      setSheetOpen(false);
      void invalidateSignalMetadata(context);
      void loadToneRecords();
    } catch (failure) {
      if (!operationIsCurrent(generation, context)) {
        void invalidateSignalMetadata(context);
        return;
      }
      setToneRecords((current) => current.filter((candidate) => candidate !== optimistic));
      queryClient.setQueryData<EmailToneRecord[]>(signalQueryKeys.tones(context), (current) => current?.filter((candidate) => candidate !== optimistic));
      setSheetError(messageFor(failure));
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
    const inbox = sheet === "inboxEdit" ? overview?.selectedAccount : undefined;
    const name = metadataName.trim();
    const writingInstruction = metadataInstruction.trim();
    if (!name || toneRecord && !writingInstruction || !toneRecord && !inbox) return;
    const context = metadataFormContext.current;
    if (!context || context.organizationKey !== emailContext.organizationKey || context.scopeKey !== emailContext.scopeKey) return;
    const generation = operationGeneration.current;
    metadataInFlight.current = true;
    setBusy("metadata");
    setSheetError(undefined);
    const targetKey = `${context.organizationKey}:${context.scopeKey}:${toneRecord ? `tone:${toneRecord.key}` : `inbox:${inbox!.connectorKey}`}`;
    const request = (metadataRequests.current.get(targetKey) ?? 0) + 1;
    metadataRequests.current.set(targetKey, request);
    const coverChange = metadataCoverAsset;
    const description = metadataDescription.trim() || undefined;
    const optimisticTone = toneRecord ? { ...toneRecord, name, description, instruction: writingInstruction, isFavorite: metadataFavorite, ...(coverChange !== undefined ? { coverUrl: coverChange?.uri } : {}) } : undefined;
    const optimisticInbox = inbox ? { ...inbox, name, description, isFavorite: metadataFavorite, ...(coverChange !== undefined ? { coverUrl: coverChange?.uri } : {}) } : undefined;
    if (optimisticTone) replaceTone(optimisticTone, context);
    else replaceInbox(optimisticInbox!, context);
    try {
      let coverImageKey: string | null | undefined;
      if (coverChange === null) coverImageKey = null;
      if (coverChange) {
        if (!operationIsCurrent(generation, context)) {
          void invalidateSignalMetadata(context);
          return;
        }
        const normalized = await normalizeCapturedJpeg(coverChange, { maxSide: 2400, compress: 0.88 });
        if (!operationIsCurrent(generation, context)) {
          void invalidateSignalMetadata(context);
          return;
        }
        const upload = await uploadGalleryImages([{ clientKey: `${Date.now()}-${targetKey}`, filename: `signal-cover-${Date.now()}.jpg`, uri: normalized.uri, sizeBytes: normalized.sizeBytes, processingMode: "cover" }]);
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
        ? await updateEmailToneForContext(context, { toneKey: toneRecord.key, name, description: description ?? null, instruction: writingInstruction, isFavorite: metadataFavorite, ...(coverChange !== undefined ? { coverImageKey } : {}) })
        : await updateEmailInboxForContext(context, { connectorKey: inbox!.connectorKey, name, description: description ?? null, isFavorite: metadataFavorite, ...(coverChange !== undefined ? { coverImageKey } : {}) });
      if (metadataRequests.current.get(targetKey) !== request || !operationIsCurrent(generation, context)) {
        void invalidateSignalMetadata(context);
        return;
      }
      if (toneRecord) replaceToneIfCurrent(optimisticTone!, updated as EmailToneRecord, context);
      else replaceInboxIfCurrent(optimisticInbox!, updated as EmailConnector, context);
      formBaseline.current = undefined;
      setSheetOpen(false);
      void invalidateSignalMetadata(context);
    } catch (failure) {
      if (metadataRequests.current.get(targetKey) !== request || !operationIsCurrent(generation, context)) {
        void invalidateSignalMetadata(context);
        return;
      }
      if (toneRecord) replaceToneIfCurrent(optimisticTone!, toneRecord, context);
      else replaceInboxIfCurrent(optimisticInbox!, inbox!, context);
      setSheetError(messageFor(failure));
      void invalidateSignalMetadata(context);
    } finally {
      if (generation === operationGeneration.current) {
        metadataInFlight.current = false;
        setBusy(undefined);
      }
    }
  }
  async function synchronize() {
    if (!initialConnectorKey) return;
    setBusy("sync");
    try {
      await syncEmail(initialConnectorKey);
      await load();
      setSheetOpen(false);
      notify("Signal synced");
    } catch (failure) {
      setSheetError(messageFor(failure));
    } finally {
      setBusy(undefined);
    }
  }
  async function assignDraft(connectorKey: string) {
    if (!unassignedDraft) return;
    setBusy("assign");
    setSheetError(undefined);
    try {
      await assignEmailDraft(unassignedDraft.key, connectorKey);
      await queryClient.invalidateQueries({ queryKey: signalQueryKeys.overviews(emailContext), refetchType: "none" });
      await queryClient.fetchQuery({ queryKey: signalQueryKeys.overview(emailContext), queryFn: () => fetchEmailOverviewForContext(emailContext), staleTime: 0 });
      setSheetOpen(false);
      setUnassignedDraft(undefined);
      router.replace({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey } });
      notify("Draft assigned to inbox");
    } catch (failure) {
      setSheetError(messageFor(failure));
    } finally {
      setBusy(undefined);
    }
  }
  async function sortInbox() {
    if (!initialConnectorKey) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const connectorKey = initialConnectorKey;
    const generation = ++operationGeneration.current;
    const nextFilter = overviewQuery.current.filter;
    const nextSearch = overviewQuery.current.search;
    setBusy("sort");
    setSheetError(undefined);
    try {
      const result = await sortEmailInboxForContext(context, connectorKey);
      if (!operationIsCurrent(generation, context)) return;
      await queryClient.invalidateQueries({ queryKey: signalQueryKeys.accountOverviews(context, connectorKey), refetchType: "none" });
      if (!operationIsCurrent(generation, context)) return;
      const refreshed = await loadOverviewForContext(context, connectorKey, nextFilter, nextSearch);
      if (!operationIsCurrent(generation, context)) return;
      setOverview(refreshed);
      setSheetOpen(false);
      notify(`Sorted ${result.messagesProcessed} message${result.messagesProcessed === 1 ? "" : "s"}`);
    } catch (failure) {
      if (operationIsCurrent(generation, context)) setSheetError(messageFor(failure));
    } finally {
      if (generation === operationGeneration.current) setBusy(undefined);
    }
  }
  async function chooseFilter(next: EmailFilter) {
    setBusy("sync");
    const previous = { filter, search: submittedQuery };
    const candidate = { filter: next, search: submittedQuery };
    overviewQuery.current = candidate;
    try {
      const result = await load(next, submittedQuery);
      if (result !== "failed" && overviewQuery.current === candidate) {
        setFilter(next);
        clearSelectedThread();
      } else if (result === "failed" && overviewQuery.current === candidate) overviewQuery.current = previous;
    } catch (failure) {
      if (overviewQuery.current === candidate) overviewQuery.current = previous;
      throw failure;
    } finally {
      setBusy(undefined);
    }
  }
  async function search() {
    setBusy("sync");
    const next = query.trim();
    const previous = { filter, search: submittedQuery };
    const candidate = { filter, search: next };
    overviewQuery.current = candidate;
    try {
      const result = await load(filter, next);
      if (result !== "failed" && overviewQuery.current === candidate) {
        setSubmittedQuery(next);
        clearSelectedThread();
      } else if (result === "failed" && overviewQuery.current === candidate) overviewQuery.current = previous;
    } catch (failure) {
      if (overviewQuery.current === candidate) overviewQuery.current = previous;
      throw failure;
    } finally {
      setBusy(undefined);
    }
  }
  async function loadMore() {
    const cursor = overview?.nextCursor;
    if (!cursor || loadingMore.current || loadingOverview.current || loading || loadError) return;
    loadingMore.current = true;
    setLoadingMoreThreads(true);
    try {
      await load(overviewQuery.current.filter, overviewQuery.current.search, { cursor });
    } finally {
      loadingMore.current = false;
      setLoadingMoreThreads(false);
    }
  }
  async function openThread(thread: EmailThread) {
    const generation = ++detailGeneration.current;
    setOpeningThreadKey(thread.key);
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: signalQueryKeys.detail(emailContext, initialConnectorKey, thread.key),
        queryFn: () => fetchEmailThreadForContext(emailContext, thread.key),
      });
      const becameRead = Boolean(thread.unread && !detail.thread.unread);
      if (generation !== detailGeneration.current) return;
      setSelected(detail);
      setSelectedMessageKey([...detail.messages].sort((left, right) => right.sentAt.localeCompare(left.sentAt) || right.key.localeCompare(left.key))[0]?.key);
      setOverview((current) =>
        current
          ? {
              ...current,
              threads: current.threads
                .map((item) => (item.key === thread.key ? detail.thread : item))
                .filter((item) => filter !== "unread" || item.unread),
              counts: {
                ...current.counts,
                unread: Math.max(
                  0,
                  current.counts.unread - (becameRead ? 1 : 0),
                ),
              },
            }
          : current,
      );
    } catch (failure) {
      notify(messageFor(failure));
    } finally {
      setOpeningThreadKey(undefined);
    }
  }
  async function toggleFavorite() {
    if (!selected) return;
    const generation = ++detailGeneration.current;
    const threadKey = selected.thread.key;
    setBusy("favorite");
    try {
      const updated = await setEmailThreadFavorite(
        selected.thread.key,
        !selected.thread.isFavorite,
      );
      const delta = updated.isFavorite ? 1 : -1;
      if (generation === detailGeneration.current) setSelected((current) =>
        current?.thread.key === threadKey ? { ...current, thread: updated } : current,
      );
      if (initialConnectorKey) patchSignalThread(queryClient, emailContext, initialConnectorKey, updated);
      await queryClient.invalidateQueries({
        queryKey: signalQueryKeys.overviews(emailContext),
        refetchType: "none",
      });
      setOverview((current) =>
        current
          ? {
              ...current,
              threads: current.threads
                .map((item) => (item.key === updated.key ? updated : item))
                .filter((item) => filter !== "favorite" || item.isFavorite),
              counts: {
                ...current.counts,
                favorite: Math.max(0, current.counts.favorite + delta),
              },
            }
          : current,
      );
    } catch (failure) {
      notify(messageFor(failure));
    } finally {
      setBusy(undefined);
    }
  }

  function composeInput() {
    return {
      to: parseAddresses(to),
      ...(cc.trim() ? { cc: parseAddresses(cc) } : {}),
      ...(bcc.trim() ? { bcc: parseAddresses(bcc) } : {}),
      subject: subject.trim(),
      tone,
      ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
      ...(attachments.length ? { attachments } : {}),
    };
  }
  async function prepareDraft(operation: { context: typeof emailContext; generation: number }, force = false) {
    if (!composerOperationIsCurrent(operation.generation, operation.context)) return;
    if (draft && !force) return draft;
    const created =
      composerMode === "reply"
        ? await createEmailDraftForContext(operation.context, {
            threadKey: selected!.thread.key,
            tone,
            ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
            ...(attachments.length ? { attachments } : {}),
          })
        : await composeEmailDraftForContext(operation.context, { ...composeInput(), connectorKey: initialConnectorKey });
    if (!composerOperationIsCurrent(operation.generation, operation.context)) return;
    setDraft(created);
    setBody(created.finalContent ?? created.generatedContent);
    return created;
  }
  function beginComposerOperation(action: "draft" | "save" | "send") {
    if (composerBusyGeneration.current !== undefined) return undefined;
    const generation = ++composerOperationGeneration.current;
    const operation = {
      context: { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey },
      generation,
    };
    composerBusyGeneration.current = generation;
    if (action === "send") sendGeneration.current = generation;
    setBusy(action);
    setSheetError(undefined);
    return operation;
  }
  function finishComposerOperation(operation: { generation: number }) {
    if (sendGeneration.current === operation.generation) sendGeneration.current = undefined;
    if (composerBusyGeneration.current !== operation.generation) return;
    composerBusyGeneration.current = undefined;
    setBusy(undefined);
  }
  async function generateDraft() {
    const operation = beginComposerOperation("draft");
    if (!operation) return;
    try {
      setDraft(undefined);
      await prepareDraft(operation, true);
    } catch (failure) {
      if (composerOperationIsCurrent(operation.generation, operation.context)) setSheetError(messageFor(failure));
    } finally {
      finishComposerOperation(operation);
    }
  }
  async function saveDraft() {
    const operation = beginComposerOperation("save");
    if (!operation) return;
    try {
      const created = await prepareDraft(operation);
      if (!created || !composerOperationIsCurrent(operation.generation, operation.context)) return;
      const saved =
        body.trim() &&
        body.trim() !==
          (created.finalContent ?? created.generatedContent).trim()
          ? await updateEmailDraftForContext(operation.context, created.key, body.trim())
          : created;
      if (!composerOperationIsCurrent(operation.generation, operation.context)) return;
      setDraft(saved);
      setBody(saved.finalContent ?? saved.generatedContent);
      notify("Draft saved");
    } catch (failure) {
      if (composerOperationIsCurrent(operation.generation, operation.context)) setSheetError(messageFor(failure));
    } finally {
      finishComposerOperation(operation);
    }
  }
  async function send() {
    const operation = beginComposerOperation("send");
    if (!operation) return;
    try {
      const created = await prepareDraft(operation);
      if (!created || !composerOperationIsCurrent(operation.generation, operation.context)) return;
      const prepared =
        body.trim() &&
        body.trim() !==
          (created.finalContent ?? created.generatedContent).trim()
          ? await updateEmailDraftForContext(operation.context, created.key, body.trim())
          : created;
      if (!composerOperationIsCurrent(operation.generation, operation.context)) return;
      await sendEmailDraftForContext(operation.context, prepared.key);
      if (!composerOperationIsCurrent(operation.generation, operation.context)) return;
      const sentMode = composerMode;
      const sentThreadKey = composerMode === "reply" ? selected?.thread.key : undefined;
      notify(composerMode === "reply" ? "Reply sent" : "Email sent");
      finishComposerOperation(operation);
      setSheetOpen(false);
      resetComposer();
      void queryClient.invalidateQueries({
        queryKey: signalQueryKeys.all(operation.context),
      });
      void load();
      if (sentMode === "reply" && sentThreadKey) {
        const threadKey = sentThreadKey;
        const generation = ++detailGeneration.current;
        void fetchEmailThreadForContext(operation.context, threadKey).then((detail) => {
          if (generation === detailGeneration.current) setSelected((current) => current?.thread.key === threadKey ? detail : current);
        }).catch(() => undefined);
      }
    } catch (failure) {
      if (composerOperationIsCurrent(operation.generation, operation.context)) setSheetError(messageFor(failure));
    } finally {
      finishComposerOperation(operation);
    }
  }
  async function openReaderFlow(next: ReaderSheet) {
    const message = selectedMessage;
    const threadKey = selected?.thread.key;
    if (!message || !threadKey) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const messageKey = message.key;
    const generation = ++readerGeneration.current;
    setSheetOpen(false);
    await wait(180);
    if (!readerOperationIsCurrent(generation, context, threadKey, messageKey)) return;
    readerTargetKey.current = messageKey;
    setReaderError(undefined);
    setReaderSheet(next);
    setReaderSheetOpen(true);
    if (next === "translate") { setTranslations([]); setSelectedTranslation(undefined); }
    if (next === "summary") { setSummaries([]); setSelectedSummary(undefined); }
    if (next === "translate" || next === "summary") setReaderLoading(true);
    try {
      if (next === "translate") {
        const result = await queryClient.fetchQuery({ queryKey: signalQueryKeys.translations(context, messageKey), queryFn: () => listEmailMessageTranslationsForContext(context, messageKey), staleTime: 0 });
        if (readerOperationIsCurrent(generation, context, threadKey, result.messageKey) && readerTargetKey.current === result.messageKey) setTranslations(result.versions);
      } else if (next === "summary") {
        const result = await queryClient.fetchQuery({ queryKey: signalQueryKeys.summaries(context, messageKey), queryFn: () => listEmailMessageSummariesForContext(context, messageKey), staleTime: 0 });
        if (readerOperationIsCurrent(generation, context, threadKey, result.messageKey) && readerTargetKey.current === result.messageKey) setSummaries(result.summaries);
      } else if (next === "similar") await loadSimilar("Important", { generation, context, threadKey, messageKey });
    } catch (failure) {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey) && readerTargetKey.current === messageKey) setReaderError(messageFor(failure));
    } finally {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) setReaderLoading(false);
    }
  }
  async function generateTranslation() {
    const messageKey = readerTargetKey.current;
    const threadKey = selectedThreadKeyRef.current;
    if (!messageKey || !threadKey || !targetLanguage.trim()) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = ++readerGeneration.current;
    setReaderLoading(true);
    setReaderError(undefined);
    try {
      const result = await translateEmailMessageForContext(context, messageKey, { targetLanguage: targetLanguage.trim() });
      if (!readerOperationIsCurrent(generation, context, threadKey, result.messageKey) || readerTargetKey.current !== result.messageKey) return;
      upsertSignalTranslationVersion(queryClient, context, messageKey, result.version);
      setTranslations(queryClient.getQueryData<{ versions: EmailTranslationVersion[] }>(signalQueryKeys.translations(context, messageKey))?.versions ?? [result.version]);
      setSelectedTranslation(result.version);
      setReaderSheet("translationReader");
    } catch (failure) {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) setReaderError(messageFor(failure));
    } finally {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) setReaderLoading(false);
    }
  }
  async function generateSummary() {
    const messageKey = readerTargetKey.current;
    const threadKey = selectedThreadKeyRef.current;
    if (!messageKey || !threadKey) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = ++readerGeneration.current;
    setReaderLoading(true);
    setReaderError(undefined);
    try {
      const result = await summarizeEmailMessageForContext(context, messageKey, { topic: summaryTopic.trim() || undefined, style: summaryStyle });
      if (!readerOperationIsCurrent(generation, context, threadKey, result.messageKey) || readerTargetKey.current !== result.messageKey) return;
      upsertSignalSummary(queryClient, context, messageKey, result.summary);
      setSummaries(queryClient.getQueryData<{ summaries: EmailSummary[] }>(signalQueryKeys.summaries(context, messageKey))?.summaries ?? [result.summary]);
      setSelectedSummary(result.summary);
      setReaderSheet("summaryReader");
    } catch (failure) {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) setReaderError(messageFor(failure));
    } finally {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) setReaderLoading(false);
    }
  }
  async function loadSimilar(category: EmailInboxCategory, captured?: { generation: number; context: typeof emailContext; threadKey: string; messageKey: string }) {
    const messageKey = captured?.messageKey ?? readerTargetKey.current;
    const threadKey = captured?.threadKey ?? selectedThreadKeyRef.current;
    if (!messageKey || !threadKey) return;
    const context = captured?.context ?? { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const generation = captured?.generation ?? ++readerGeneration.current;
    setSimilarCategory(category);
    setSimilarResults([]);
    setReaderLoading(true);
    setReaderError(undefined);
    try {
      const result = await findSimilarEmailMessagesForContext(context, messageKey, { categories: [category], limit: 20 });
      if (readerOperationIsCurrent(generation, context, threadKey, result.messageKey) && readerTargetKey.current === result.messageKey) setSimilarResults(result.items);
    } catch (failure) {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey) && readerTargetKey.current === messageKey) setReaderError(messageFor(failure));
    } finally {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) setReaderLoading(false);
    }
  }
  async function openSimilarResult(result: EmailSimilarResult) {
    const generation = ++detailGeneration.current;
    setReaderLoading(true);
    setReaderError(undefined);
    try {
      const detail = await queryClient.fetchQuery({ queryKey: signalQueryKeys.detail(emailContext, initialConnectorKey, result.threadKey), queryFn: () => fetchEmailThreadForContext(emailContext, result.threadKey), staleTime: 0 });
      if (generation !== detailGeneration.current) return;
      setSelected(detail);
      setSelectedMessageKey(detail.messages.some(({ key }) => key === result.key) ? result.key : [...detail.messages].sort((left, right) => right.sentAt.localeCompare(left.sentAt))[0]?.key);
      setReaderSheetOpen(false);
    } catch (failure) {
      if (generation === detailGeneration.current) setReaderError(messageFor(failure));
    } finally {
      if (generation === detailGeneration.current) setReaderLoading(false);
    }
  }
  async function trashThread() {
    const previousThread = selected?.thread;
    const messageKey = selectedMessageKeyRef.current;
    if (!previousThread || !messageKey || !initialConnectorKey) return;
    const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    const connectorKey = initialConnectorKey;
    const threadKey = previousThread.key;
    const generation = ++readerGeneration.current;
    const activeFilter = overviewQuery.current.filter;
    const activeSearch = overviewQuery.current.search;
    setReaderLoading(true);
    setReaderError(undefined);
    try {
      const result = await trashEmailThreadForContext(context, threadKey);
      if (!readerOperationIsCurrent(generation, context, threadKey, messageKey)) return;
      reconcileSignalTrashedThread(queryClient, context, connectorKey, result);
      setOverview((current) => current ? moveSignalThreadToFiltered(current, result, activeFilter, activeSearch || null) : current);
      await queryClient.invalidateQueries({ queryKey: signalQueryKeys.accountOverviews(context, connectorKey), refetchType: "none" });
      if (!readerOperationIsCurrent(generation, context, threadKey, messageKey)) return;
      clearSelectedThread();
      notify("Thread moved to Gmail Trash");
    } catch (failure) {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) setReaderError(messageFor(failure));
    } finally {
      if (readerOperationIsCurrent(generation, context, threadKey, messageKey)) setReaderLoading(false);
    }
  }
  async function disconnect() {
    if (!initialConnectorKey) return;
    setBusy("disconnect");
    setSheetError(undefined);
    try {
      await disconnectEmail(initialConnectorKey);
      await queryClient.invalidateQueries({
        queryKey: signalQueryKeys.all(emailContext),
      });
      setSheetOpen(false);
      clearSelectedThread();
      await queryClient.fetchQuery({ queryKey: signalQueryKeys.overview(emailContext), queryFn: () => fetchEmailOverviewForContext(emailContext), staleTime: 0 });
      router.replace({ pathname: "/capability/[slug]", params: { slug: "signal" } });
      notify("Gmail disconnected");
    } catch (failure) {
      setSheetError(messageFor(failure));
    } finally {
      setBusy(undefined);
    }
  }

  const connected = Boolean(overview?.selectedAccount);
  const hasThreads = Boolean(overview?.threads.length);
  const showInbox = Boolean(initialConnectorKey) && (connected || hasThreads || Boolean(overview?.drafts.length));
  const workspaceBusy = Boolean(busy || openingThreadKey);
  const formSheet = sheet === "connectForm" || sheet === "toneCreate" || sheet === "inboxEdit" || sheet === "toneEdit";
  const menuSheet = sheet === "rootMenu" || sheet === "plus" || sheet === "account" || sheet === "ai";
  const formFooter = formSheet ? <>
    {sheet !== "toneEdit" || permissions.canMutate ? <Button
      disabled={Boolean(busy) || (sheet === "connectForm" ? !connectName.trim() || !permissions.canManageConnector : sheet === "toneCreate" ? !toneName.trim() || !toneInstruction.trim() || !permissions.canMutate : !metadataName.trim() || !permissions.canMutate || sheet === "toneEdit" && !metadataInstruction.trim())}
      loading={sheet === "connectForm" ? busy === "connect" : sheet === "toneCreate" ? busy === "toneCreate" : busy === "metadata"}
      onPress={() => void (sheet === "connectForm" ? connect() : sheet === "toneCreate" ? createTone() : saveMetadata())}
      size="md"
      variant="primary"
    >
      {sheet === "connectForm" ? "Connect" : sheet === "toneCreate" ? "Create tone" : "Save"}
    </Button> : null}
    <Button disabled={Boolean(busy)} onPress={requestFormClose} size="md" variant="secondary">Close</Button>
  </> : undefined;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.root}
    >
      <View accessibilityElementsHidden={readerSheetOpen} importantForAccessibility={readerSheetOpen ? "no-hide-descendants" : "auto"} pointerEvents={readerSheetOpen ? "none" : "auto"} style={styles.workspaceSurface}>
      <View style={[styles.globalHeader, { paddingTop: insets.top + 6 }]}>
        <WorkspaceAppSwitcher
          active="signal"
          onBeforeSelect={(slug) => requestExit(slug)}
        />
      </View>
      <View style={styles.localHeader}>
        {initialConnectorKey ? (
          <Button
            accessibilityLabel={selected ? "Back to inbox" : "Back to Signal root"}
            contentMode="raw"
            onPress={() => {
              if (selected) {
                if (requestExit("inbox")) clearSelectedThread();
              } else if (requestExit("signal")) {
                clearSelectedThread();
                router.replace({ pathname: "/capability/[slug]", params: { slug: "signal" } });
              }
            }}
            size="md"
            variant="icon"
          >
            <ChevronLeftIcon size="sm" />
          </Button>
        ) : (
          <WorkspaceAppSwitcher
            active="signal"
            backSize="sm"
            onBeforeSelect={(slug) => requestExit(slug)}
            trigger="back"
          />
        )}
        <Text
          numberOfLines={1}
          style={[styles.localTitle, selected && styles.threadHeaderTitle]}
        >
          {selected?.thread.subject ?? "Signal"}
        </Text>
        <View style={styles.localActions}>
          {!initialConnectorKey ? (
            <Button
              accessibilityLabel="New Signal folder-like item"
              contentMode="raw"
              onPress={() => { setSheetError(undefined); setSheet("rootMenu"); setSheetOpen(true); }}
              size="md"
              variant="icon"
            >
              <PlusIcon size="sm" />
            </Button>
          ) : <>
          <Button
            accessibilityLabel="Open Signal AI Brain menu"
            contentMode="raw"
            onPress={() => {
              setSheetError(undefined);
              setSheet("ai");
              setSheetOpen(true);
            }}
            size="md"
            variant="icon"
          >
            <BrainIcon size="sm" />
          </Button>
          {selected ? (
            <>
              <Button
                accessibilityLabel="More email actions"
                contentMode="raw"
                onPress={() => {
                  setSheet("account");
                  setSheetOpen(true);
                }}
                size="md"
                variant="icon"
              >
                <MoreHorizontalIcon size="sm" />
              </Button>
            </>
          ) : (
            <Button
              accessibilityLabel="New Signal action"
              contentMode="raw"
              onPress={() => {
                setSheet("plus");
                setSheetOpen(true);
              }}
              size="md"
              variant="icon"
            >
              <PlusIcon size="sm" />
            </Button>
          )}
          </>}
        </View>
      </View>

      {loading ? (
        <View
          accessibilityLabel="Loading email"
          accessibilityRole="progressbar"
          style={styles.skeletonList}
        >
          <Skeleton style={styles.tabsSkeleton} />
          <Skeleton style={styles.searchSkeleton} />
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} style={styles.threadSkeleton} />
          ))}
        </View>
      ) : null}
      {!loading && loadError ? (
        <View style={styles.center}>
          <InboxIcon size="lg" variant="muted" />
          <Text style={styles.centerText}>{loadError}</Text>
          <Button
            onPress={() => {
              setLoading(true);
              void load();
            }}
            size="md"
            variant="secondary"
          >
            Retry
          </Button>
        </View>
      ) : null}
      {!loading && !loadError && initialConnectorKey && !showInbox ? (
        <View style={styles.center}>
          <View style={styles.signalGlyph}>
            <MailIcon size="lg" />
          </View>
          <Text style={styles.emptyHero}>See what needs you.</Text>
          <Text style={styles.centerText}>
            Signal will show Archive-backed conversations here. Connect Gmail to
            sync live mail.
          </Text>
          {permissions.canManageConnector ? (
            <Button
              loading={busy === "connect"}
              onPress={openConnectForm}
              size="lg"
              variant="primary"
            >
              Connect Gmail
            </Button>
          ) : null}
        </View>
      ) : null}

      {!loading && !loadError && !initialConnectorKey ? (
        <View style={styles.signalRoot}>
          <View style={styles.rootSearch}>
            <SearchIcon size="sm" variant="muted" />
            <TextInput
              accessibilityLabel="Search Signal inboxes and tones"
              onChangeText={setRootQuery}
              placeholder="Search Signal"
              style={styles.searchInput}
              value={rootQuery}
            />
            {rootQuery ? (
              <Button accessibilityLabel="Clear Signal search" contentMode="raw" iconOnly onPress={() => setRootQuery("")} size="xs" variant="secondary">
                <CloseIcon size="sm" />
              </Button>
            ) : null}
          </View>
          <Tabs accessibilityLabel="Signal root categories" accessibilityRole="tablist" style={styles.rootTabs}>
            <Button accessibilityRole="tab" accessibilityState={{ selected: rootTab === "inboxes" }} onPress={() => setRootTab("inboxes")} size="xs" style={styles.rootTab} variant={rootTab === "inboxes" ? "secondary" : "ghost"}>Inboxes</Button>
            <Button accessibilityRole="tab" accessibilityState={{ selected: rootTab === "tones" }} onPress={() => setRootTab("tones")} size="xs" style={styles.rootTab} variant={rootTab === "tones" ? "secondary" : "ghost"}>Tones</Button>
          </Tabs>
          <ScrollView
            accessibilityLabel={rootTab === "inboxes" ? "Signal inboxes" : "Signal tones"}
            contentContainerStyle={[styles.rootGrid, rootTab === "inboxes"
              ? !visibleAccounts.length && !visibleUnassignedDrafts.length && styles.emptyGrid
              : !tonesLoading && !visibleTones.length && styles.emptyGrid]}
            onLayout={({ nativeEvent }) => setRootGridWidth(nativeEvent.layout.width)}
            showsVerticalScrollIndicator={false}
          >
            {rootTab === "inboxes" ? (
              <>
                {visibleAccounts.map((account) => (
                  <View key={account.key} style={[styles.rootCard, { width: rootCardSize, height: rootCardSize }]}>
                    {account.coverUrl ? <Image contentFit="cover" source={account.coverUrl} style={StyleSheet.absoluteFill} /> : null}
                  <Button
                    accessibilityLabel={`Open ${account.email} inbox`}
                    contentMode="raw"
                    onPress={() => router.replace({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey: account.connectorKey } })}
                    shape="rounded"
                    size="xl"
                    style={[styles.rootCardMain, account.coverUrl && styles.coveredCardMain]}
                    variant="ghost"
                  >
                    {account.coverUrl ? null : <InboxIcon size="lg" />}
                    <Text ellipsizeMode="tail" numberOfLines={1} style={[styles.rootCardTitle, account.coverUrl && styles.coveredCardLabel]}>{account.name}</Text>
                  </Button>
                    {account.isFavorite ? <View pointerEvents="none" style={styles.favoriteBadge}><StarIcon size="sm" variant="accent" /></View> : null}
                  </View>
                ))}
                {visibleUnassignedDrafts.map((saved) => (
                  <Button
                    accessibilityLabel={`Assign ${saved.subject ?? "Untitled draft"} to an inbox`}
                    contentMode="raw"
                    key={saved.key}
                    onPress={() => {
                      setSheetError(undefined);
                      setUnassignedDraft(saved);
                      setSheet("assignDraft");
                      setSheetOpen(true);
                    }}
                    shape="rounded"
                    size="xl"
                    style={[styles.rootDraftCard, { width: rootCardSize, height: rootCardSize }]}
                    variant="secondary"
                  >
                    <FileIcon size="md" />
                    <Text numberOfLines={2} style={styles.rootCardTitle}>{saved.subject ?? "Untitled draft"}</Text>
                    <Text style={styles.rootCardMeta}>DRAFT</Text>
                  </Button>
                ))}
                {!visibleAccounts.length && !visibleUnassignedDrafts.length && normalizedRootQuery ? <Text style={styles.rootEmpty}>No inboxes or drafts matched this search.</Text> : null}
                {!visibleAccounts.length && !visibleUnassignedDrafts.length && !normalizedRootQuery ? (
                  <View style={styles.rootEmptyState}>
                    <Text style={styles.rootEmpty}>No inboxes yet.</Text>
                    {permissions.canManageConnector ? <Button accessibilityLabel="Connect inbox" contentMode="raw" onPress={openConnectForm} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : <Text style={styles.rootEmptyHelp}>Ask an organization administrator to connect Gmail.</Text>}
                  </View>
                ) : null}
              </>
            ) : tonesLoading ? Array.from({ length: 3 }, (_, index) => (
              <Skeleton accessibilityLabel="Loading Signal tones" accessibilityRole="progressbar" key={index} style={{ width: rootCardSize, height: rootCardSize }} />
            )) : toneError ? (
              <View style={styles.rootToneError}>
                <Text style={styles.rootEmpty}>{toneError}</Text>
                <Button onPress={() => void loadToneRecords()} size="md" variant="secondary">Retry tones</Button>
              </View>
            ) : visibleTones.length ? visibleTones.map((record) => (
              <View key={record.key} style={[styles.rootCard, { width: rootCardSize, height: rootCardSize }]}>
                {record.coverUrl ? <Image contentFit="cover" source={record.coverUrl} style={StyleSheet.absoluteFill} /> : null}
              <Button
                accessibilityLabel={`${permissions.canMutate ? "Edit" : "View"} ${record.name} email tone`}
                contentMode="raw"
                disabled={record.key.startsWith("optimistic-tone-")}
                onPress={() => openToneEdit(record)}
                shape="rounded"
                size="xl"
                style={[styles.rootCardMain, record.coverUrl && styles.coveredCardMain]}
                variant="ghost"
              >
                {record.coverUrl ? null : <MailIcon size="lg" />}
                <Text ellipsizeMode="tail" numberOfLines={1} style={[styles.rootCardTitle, record.coverUrl && styles.coveredCardLabel]}>{record.name}</Text>
              </Button>
                {record.isFavorite ? <View pointerEvents="none" style={styles.favoriteBadge}><StarIcon size="sm" variant="accent" /></View> : null}
              </View>
            )) : normalizedRootQuery ? <Text style={styles.rootEmpty}>No tones matched this search.</Text> : (
              <View style={styles.rootEmptyState}>
                <Text style={styles.rootEmpty}>No tones yet.</Text>
                {permissions.canMutate ? <Button accessibilityLabel="Create email tone" contentMode="raw" onPress={openToneCreate} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : <Text style={styles.rootEmptyHelp}>Ask a scope moderator to create an email tone.</Text>}
              </View>
            )}
          </ScrollView>
        </View>
      ) : null}

      {!loading && !loadError && initialConnectorKey && showInbox && !selected ? (
        <View style={styles.inbox}>
          <View style={styles.categoryTabsFrame}>
            <Tabs accessibilityLabel="Signal inbox categories" accessibilityRole="tablist" style={styles.categoryTabs}>
              {INBOX_CATEGORIES.map((item) => <Button accessibilityRole="tab" accessibilityState={{ selected: filter === item.filter }} disabled={workspaceBusy} key={item.category} onPress={() => void chooseFilter(item.filter)} size="xs" style={styles.categoryTab} variant={filter === item.filter ? "secondary" : "ghost"}>{item.category} · {inboxCategoryCount(overview, item.category)}</Button>)}
            </Tabs>
          </View>
          <View style={styles.searchBox}>
            <SearchIcon size="sm" variant="muted" />
            <TextInput
              accessibilityLabel="Search email"
              editable={!workspaceBusy}
              onChangeText={setQuery}
              onSubmitEditing={() => void search()}
              placeholder="Search Signal"
              returnKeyType="search"
              style={styles.searchInput}
              value={query}
            />
            <Button
              accessibilityLabel="Search email"
              contentMode="raw"
              loading={busy === "sync"}
              onPress={() => void search()}
              size="md"
              variant="icon"
            >
              <SearchIcon size="sm" />
            </Button>
          </View>
          <View style={styles.accountLine}>
            <Text numberOfLines={1} style={styles.accountText}>
              {overview?.selectedAccount?.email ?? "Archive conversations"}
            </Text>
            <Button
              accessibilityLabel="Signal account and filters"
              contentMode="raw"
              onPress={() => {
                setSheet("account");
                setSheetOpen(true);
              }}
              size="md"
              variant="icon"
            >
              <MoreHorizontalIcon size="sm" />
            </Button>
          </View>
          <ScrollView
            contentContainerStyle={[
              styles.threadList,
              { paddingBottom: insets.bottom + spacing.xl },
            ]}
            onScroll={({ nativeEvent }) => {
              if (isNearScrollEnd({ offset: nativeEvent.contentOffset.y, viewport: nativeEvent.layoutMeasurement.height, content: nativeEvent.contentSize.height })) void loadMore();
            }}
            scrollEventThrottle={120}
            showsVerticalScrollIndicator={false}
          >
            {overview?.threads.map((thread) => (
              <Button
                accessibilityLabel={`${thread.unread ? "Unread, " : ""}${shortAddress(thread.latestFrom)}, ${thread.subject}`}
                contentMode="raw"
                disabled={Boolean(openingThreadKey)}
                key={thread.key}
                loading={openingThreadKey === thread.key}
                onPress={() => void openThread(thread)}
                size="xl"
                style={[
                  styles.threadCard,
                  thread.unread && styles.threadCardUnread,
                ]}
                variant="ghost"
              >
                <View
                  style={[
                    styles.priorityBar,
                    thread.priority === "urgent"
                      ? styles.priorityUrgent
                      : thread.priority === "high"
                        ? styles.priorityHigh
                        : null,
                  ]}
                />
                <View style={styles.threadBody}>
                  <View style={styles.threadTop}>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.sender,
                        thread.unread && styles.senderUnread,
                      ]}
                    >
                      {shortAddress(thread.latestFrom)}
                    </Text>
                    <Text style={styles.time}>
                      {formatTime(thread.lastMessageAt)}
                    </Text>
                  </View>
                  <Text numberOfLines={1} style={styles.subject}>
                    {thread.subject}
                  </Text>
                  <Text numberOfLines={2} style={styles.snippet}>
                    {thread.snippet ?? thread.summary}
                  </Text>
                  <View style={styles.threadFooter}>
                    <Text style={styles.state}>{stateLabel(thread)}</Text>
                    <Text numberOfLines={1} style={styles.intent}>
                      {thread.intent}
                    </Text>
                    {thread.isFavorite || thread.starred ? (
                      <StarIcon size="sm" variant="accent" />
                    ) : null}
                  </View>
                </View>
              </Button>
            ))}
            {!overview?.threads.length ? (
              <View style={styles.empty}>
                <InboxIcon size="lg" variant="muted" />
                <Text style={styles.emptyTitle}>No messages in this view</Text>
                <Text style={styles.centerText}>
                  {submittedQuery
                    ? "No messages matched this search."
                    : "Try another inbox category or sync Gmail."}
                </Text>
              </View>
            ) : null}
            {loadingMoreThreads ? <Skeleton accessibilityLabel="Loading more messages" accessibilityRole="progressbar" style={styles.threadSkeleton} /> : null}
          </ScrollView>
        </View>
      ) : null}

      {!loading && !loadError && selected ? (
        <View style={styles.detail}>
          <ScrollView
            contentContainerStyle={[
              styles.detailContent,
              {
                paddingBottom:
                  insets.bottom + (permissions.canMutate ? 100 : 24),
              },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.detailEyebrow}>{selected.thread.inboxCategory.toUpperCase()} · {stateLabel(selected.thread)}</Text>
            <View style={styles.brief}>
              <Text style={styles.briefLabel}>SIGNAL BRIEF</Text>
              <Text style={styles.briefText}>{selected.thread.summary}</Text>
              {selected.thread.action ? (
                <Text style={styles.briefAction}>{selected.thread.action}</Text>
              ) : null}
            </View>
            {selected.messages.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false}><Tabs accessibilityLabel="Conversation messages" accessibilityRole="tablist" style={styles.conversationTabs}>{[...selected.messages].sort((left, right) => left.sentAt.localeCompare(right.sentAt) || left.key.localeCompare(right.key)).map((message, index) => <Button accessibilityRole="tab" accessibilityState={{ selected: selectedMessage?.key === message.key }} key={message.key} onPress={() => { readerGeneration.current += 1; selectedMessageKeyRef.current = message.key; setSelectedMessageKey(message.key); }} size="xs" variant={selectedMessage?.key === message.key ? "secondary" : "ghost"}>{index + 1} · {message.direction === "outbound" ? "You" : shortAddress(message.from)}</Button>)}</Tabs></ScrollView> : null}
            {selectedMessage ? <View style={styles.readerDocument}>
              <Text selectable style={styles.readerTitle}>{selectedMessage.subject}</Text>
              <View style={styles.messageHeader}><View style={styles.messageIdentity}><Text selectable style={styles.messageSender}>{selectedMessage.direction === "outbound" ? "You" : shortAddress(selectedMessage.from)}</Text><Text selectable style={styles.messageAddress}>{selectedMessage.from}</Text></View><Text style={styles.time}>{new Date(selectedMessage.sentAt).toLocaleString()}</Text></View>
              <Text selectable style={styles.readerMetadata}>To: {selectedMessage.to.join(", ")}{selectedMessage.cc?.length ? `\nCc: ${selectedMessage.cc.join(", ")}` : ""}</Text>
              <Text selectable style={styles.readerBody}>{selectedMessage.body}</Text>
              {selectedMessage.hasAttachments ? <View style={styles.attachmentLabel}><FileIcon size="sm" variant="muted" /><Text style={styles.attachmentText}>ATTACHMENTS</Text></View> : null}
            </View> : null}
          </ScrollView>
          {permissions.canMutate ? (
            <View
              style={[
                styles.replyDock,
                { paddingBottom: Math.max(insets.bottom, 12) },
              ]}
            >
              <Button
                icon={<SendIcon size="sm" variant="inverse" />}
                onPress={() => openComposer("reply")}
                size="lg"
                variant="primary"
              >
                Draft reply
              </Button>
            </View>
          ) : null}
        </View>
      ) : null}

      <BottomSheet
        description={
          sheet === "composer"
            ? composerMode === "new"
              ? "Write, generate, attach, save, and send from one place."
              : "Shape a reply and review every word before sending."
            : undefined
        }
        dismissible={!busy && sheet !== "composer"}
        footer={formFooter}
        hideCloseButton={menuSheet}
        hideHeading={menuSheet}
        height={sheet === "composer" || formSheet ? "full" : undefined}
        onOpenChange={(open) => {
          if (!open && sheet === "composer") requestComposerClose();
          else if (!open && formSheet) requestFormClose();
          else {
            setSheetOpen(open);
            if (!open && sheet === "assignDraft") setUnassignedDraft(undefined);
          }
        }}
        open={sheetOpen}
        title={
          sheet === "composer"
            ? composerMode === "new"
              ? "New email"
              : "Reply"
            : sheet === "connectForm"
              ? "Connect inbox"
              : sheet === "toneCreate"
                ? "Create email tone"
                : sheet === "inboxEdit"
                  ? "Edit inbox"
                : sheet === "toneEdit"
                    ? permissions.canMutate ? "Edit email tone" : "View email tone"
            : sheet === "ai"
              ? "Signal AI"
              : sheet === "plus"
                ? "Create"
                : sheet === "drafts"
                  ? "Drafts"
                  : sheet === "assignDraft"
                    ? "Choose an inbox"
                  : sheet === "disconnect"
                    ? "Disconnect Gmail?"
                    : sheet === "discard"
                       ? discardFormSheet ? "Discard changes?" : "Discard email?"
                      : sheet === "rootMenu" ? "Signal actions" : "Signal options"
        }
      >
        {sheetError ? (
          <View accessibilityRole="alert" style={styles.sheetError}>
            <Text style={styles.sheetErrorText}>{sheetError}</Text>
          </View>
        ) : null}
        {sheet === "rootMenu" ? (
          <View style={styles.sheetItems}>
            <BottomSheetItem disabled={!permissions.canManageConnector} onPress={openConnectForm}>Connect inbox</BottomSheetItem>
            <BottomSheetItem disabled={!permissions.canMutate} onPress={openToneCreate}>Create email tone</BottomSheetItem>
            <BottomSheetItem onPress={openReplyContexts}>Add context note</BottomSheetItem>
          </View>
        ) : sheet === "connectForm" ? (
          <ScrollView contentContainerStyle={styles.metadataForm} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.formScroll}>
            <Text style={styles.fieldLabel}>Inbox name</Text>
            <TextInput accessibilityLabel="Inbox name" autoFocus editable={!busy} maxLength={255} onChangeText={setConnectName} placeholder="Inbox name" value={connectName} />
            <Text style={styles.fieldLabel}>Description (Optional)</Text>
            <TextInput accessibilityLabel="Inbox description" editable={!busy} maxLength={10000} multiline onChangeText={setConnectDescription} placeholder="What belongs in this inbox?" style={styles.metadataDescriptionInput} textAlignVertical="top" value={connectDescription} />
          </ScrollView>
        ) : sheet === "toneCreate" ? (
          <ScrollView contentContainerStyle={styles.metadataForm} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.formScroll}>
            <Text style={styles.fieldLabel}>Tone name</Text>
            <TextInput accessibilityLabel="Tone name" autoFocus editable={!busy} maxLength={255} onChangeText={setToneName} placeholder="Tone name" value={toneName} />
            <Text style={styles.fieldLabel}>Description (Optional)</Text>
            <TextInput accessibilityLabel="Tone description" editable={!busy} maxLength={10000} multiline onChangeText={setToneDescription} placeholder="When should this tone be used?" style={styles.metadataDescriptionInput} textAlignVertical="top" value={toneDescription} />
            <Text style={styles.fieldLabel}>Writing instruction</Text>
            <TextInput accessibilityLabel="Tone writing instruction" editable={!busy} maxLength={20000} multiline onChangeText={setToneInstruction} placeholder="Describe how emails should be written" style={styles.metadataInstructionInput} textAlignVertical="top" value={toneInstruction} />
          </ScrollView>
        ) : sheet === "inboxEdit" || sheet === "toneEdit" ? (
          <ScrollView contentContainerStyle={styles.metadataForm} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <TextInput accessibilityLabel={sheet === "inboxEdit" ? "Inbox name" : "Tone name"} editable={permissions.canMutate && !busy} maxLength={255} onChangeText={setMetadataName} placeholder={sheet === "inboxEdit" ? "Inbox name" : "Tone name"} value={metadataName} />
            <Text style={styles.fieldLabel}>Description (Optional)</Text>
            <TextInput accessibilityLabel={sheet === "inboxEdit" ? "Inbox description" : "Tone description"} editable={permissions.canMutate && !busy} maxLength={10000} multiline onChangeText={setMetadataDescription} placeholder="Description" style={styles.metadataDescriptionInput} textAlignVertical="top" value={metadataDescription} />
            {sheet === "toneEdit" ? <>
              <Text style={styles.fieldLabel}>Writing instruction</Text>
              <TextInput accessibilityLabel="Tone writing instruction" editable={permissions.canMutate && !busy} maxLength={20000} multiline onChangeText={setMetadataInstruction} placeholder="Describe how emails should be written" style={styles.metadataInstructionInput} textAlignVertical="top" value={metadataInstruction} />
            </> : null}
            <View style={styles.metadataCoverControl}>
              <Button accessibilityLabel={(metadataCoverAsset === undefined ? (sheet === "toneEdit" ? editingTone?.coverUrl : overview?.selectedAccount?.coverUrl) : metadataCoverAsset?.uri) ? "Change cover" : "Set cover"} contentMode="raw" disabled={Boolean(busy) || !permissions.canMutate} onPress={() => void chooseMetadataCover()} shape="rounded" size="md" style={styles.metadataCoverButton} variant="secondary">
                {(metadataCoverAsset === undefined ? (sheet === "toneEdit" ? editingTone?.coverUrl : overview?.selectedAccount?.coverUrl) : metadataCoverAsset?.uri)
                  ? <Image contentFit="cover" source={metadataCoverAsset === undefined ? (sheet === "toneEdit" ? editingTone?.coverUrl : overview?.selectedAccount?.coverUrl) : metadataCoverAsset?.uri} style={StyleSheet.absoluteFill} />
                  : sheet === "toneEdit" ? <MailIcon size="lg" /> : <InboxIcon size="lg" />}
              </Button>
              {(metadataCoverAsset === undefined ? (sheet === "toneEdit" ? editingTone?.coverUrl : overview?.selectedAccount?.coverUrl) : metadataCoverAsset?.uri) ? <Button accessibilityLabel="Remove cover" contentMode="raw" disabled={Boolean(busy) || !permissions.canMutate} iconOnly onPress={() => setMetadataCoverAsset(null)} size="md" style={styles.metadataCoverRemove} variant="secondary"><CloseIcon size="sm" /></Button> : null}
            </View>
            <View style={styles.favoriteRow}><Switch accessibilityLabel={sheet === "toneEdit" ? "Favorite tone" : "Favorite inbox"} checked={metadataFavorite} disabled={!permissions.canMutate || Boolean(busy)} onCheckedChange={setMetadataFavorite} /><Text style={styles.favoriteLabel}>Favorite</Text></View>
          </ScrollView>
        ) : sheet === "assignDraft" ? (
          <View style={styles.sheetItems}>
            {overview?.accounts.length ? overview.accounts.map((account) => (
              <BottomSheetItem
                disabled={Boolean(busy)}
                key={account.key}
                loading={busy === "assign"}
                onPress={() => void assignDraft(account.connectorKey)}
              >
                {account.email}
              </BottomSheetItem>
            )) : (
              <>
                <Text style={styles.confirmText}>Connect Gmail before assigning this draft to an inbox.</Text>
                {permissions.canManageConnector ? (
                  <Button onPress={() => { setUnassignedDraft(undefined); openConnectForm(); }} size="md" variant="primary">Connect inbox</Button>
                ) : <Text style={styles.centerText}>Ask an organization administrator to connect Gmail.</Text>}
              </>
            )}
          </View>
        ) : sheet === "composer" ? (
          <ScrollView
            contentContainerStyle={styles.composer}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.composerScroll}
          >
            {composerMode === "new" ? (
              <>
                <TextInput
                  accessibilityLabel="Email recipients"
                  autoCapitalize="none"
                  editable={!busy}
                  keyboardType="email-address"
                  onChangeText={(value) => {
                    invalidateComposerOperation();
                    setTo(value);
                    setDraft(undefined);
                  }}
                  placeholder="To"
                  value={to}
                />
                <Button
                  disabled={Boolean(busy)}
                  onPress={() => setShowCopies((value) => !value)}
                  size="md"
                  variant="ghost"
                >
                  {showCopies ? "Hide Cc/Bcc" : "Add Cc/Bcc"}
                </Button>
                {showCopies ? (
                  <>
                    <TextInput
                      accessibilityLabel="Cc recipients"
                      autoCapitalize="none"
                      editable={!busy}
                      keyboardType="email-address"
                      onChangeText={(value) => {
                        invalidateComposerOperation();
                        setCc(value);
                        setDraft(undefined);
                      }}
                      placeholder="Cc"
                      value={cc}
                    />
                    <TextInput
                      accessibilityLabel="Bcc recipients"
                      autoCapitalize="none"
                      editable={!busy}
                      keyboardType="email-address"
                      onChangeText={(value) => {
                        invalidateComposerOperation();
                        setBcc(value);
                        setDraft(undefined);
                      }}
                      placeholder="Bcc"
                      value={bcc}
                    />
                  </>
                ) : null}
                <TextInput
                  accessibilityLabel="Email subject"
                  editable={!busy}
                  onChangeText={(value) => {
                    invalidateComposerOperation();
                    setSubject(value);
                    setDraft(undefined);
                  }}
                  placeholder="Subject"
                  value={subject}
                />
              </>
            ) : (
              <View style={styles.replyContext}>
                <Text style={styles.replyLabel}>REPLYING TO</Text>
                <Text numberOfLines={1} style={styles.replySubject}>
                  {selected?.thread.subject}
                </Text>
              </View>
            )}
            <Text style={styles.fieldLabel}>TONE</Text>
            <View style={styles.toneRow}>
              {tones.map((item) => (
                <Button
                  accessibilityState={{ selected: tone === item.value }}
                  disabled={Boolean(busy)}
                  key={item.value}
                  onPress={() => {
                    invalidateComposerOperation();
                    setTone(item.value);
                    setDraft(undefined);
                  }}
                  size="md"
                  variant={tone === item.value ? "secondary" : "ghost"}
                >
                  {item.label}
                </Button>
              ))}
            </View>
            <TextInput
              accessibilityLabel="AI writing instruction"
              editable={!busy}
              multiline
              onChangeText={(value) => {
                invalidateComposerOperation();
                setInstruction(value);
                setDraft(undefined);
              }}
              placeholder="Optional AI instruction"
              style={styles.instructionInput}
              textAlignVertical="top"
              value={instruction}
            />
            <Button
              disabled={
                Boolean(busy) ||
                (composerMode === "new" &&
                  (!parseAddresses(to).length || !subject.trim()))
              }
              loading={busy === "draft"}
              onPress={() => void generateDraft()}
              size="md"
              variant="secondary"
            >
              Generate with AI
            </Button>
            <TextInput
              accessibilityLabel="Email body"
              editable={!busy}
              multiline
              onChangeText={(value) => {
                invalidateComposerOperation();
                setBody(value);
              }}
              placeholder="Write your message or generate a draft"
              style={styles.bodyInput}
              textAlignVertical="top"
              value={body}
            />
            <Button
              disabled={Boolean(busy)}
              icon={<PlusIcon size="sm" />}
              onPress={() => setPickerOpen(true)}
              size="md"
              variant="secondary"
            >
              Attachments{attachments.length ? ` · ${attachments.length}` : ""}
            </Button>
            <View style={styles.composerActions}>
              <Button
                disabled={
                  Boolean(busy) ||
                  (composerMode === "new" &&
                    (!parseAddresses(to).length || !subject.trim()))
                }
                loading={busy === "save"}
                onPress={() => void saveDraft()}
                size="md"
                style={styles.flexAction}
                variant="secondary"
              >
                Save draft
              </Button>
              <Button
                disabled={
                  Boolean(busy) ||
                  !body.trim() ||
                  (composerMode === "new" &&
                    (!parseAddresses(to).length || !subject.trim()))
                }
                icon={<SendIcon size="sm" variant="inverse" />}
                loading={busy === "send"}
                onPress={() => void send()}
                size="md"
                style={styles.flexAction}
                variant="primary"
              >
                Send
              </Button>
            </View>
            <Button
              disabled={Boolean(busy)}
              onPress={requestComposerClose}
              size="md"
              variant="ghost"
            >
              Close
            </Button>
          </ScrollView>
        ) : sheet === "ai" ? (
          <View style={styles.sheetItems}>
            {selected ? (
              <>
                <BottomSheetItem disabled={Boolean(busy)} icon={<MailIcon size="md" />} onPress={() => void openReaderFlow("translate")}>Translate</BottomSheetItem>
                <BottomSheetItem disabled={Boolean(busy)} icon={<BrainIcon size="md" />} onPress={() => void openReaderFlow("summary")}>Summary</BottomSheetItem>
                {permissions.canMutate ? (
                  <BottomSheetItem
                    icon={<SendIcon size="md" />}
                    onPress={() => { setSheetOpen(false); openComposer("reply"); }}
                  >
                    Draft reply
                  </BottomSheetItem>
                ) : null}
              </>
            ) : permissions.canMutate ? (
              <BottomSheetItem
                icon={<MailIcon size="md" />}
                onPress={() => {
                  setSheetOpen(false);
                  openComposer("new");
                }}
              >
                Write email
              </BottomSheetItem>
            ) : null}
          </View>
        ) : sheet === "plus" ? (
          <View style={styles.sheetItems}>
            {permissions.canMutate ? (
              <BottomSheetItem
                icon={<MailIcon size="md" />}
                onPress={() => {
                  setSheetOpen(false);
                  openComposer("new");
                }}
              >
                New email
              </BottomSheetItem>
            ) : null}
            {overview?.drafts.length ? (
              <BottomSheetItem
                icon={<FileIcon size="md" />}
                onPress={() => setSheet("drafts")}
              >
                Drafts · {overview.drafts.length}
              </BottomSheetItem>
            ) : null}
            <BottomSheetItem
              icon={<MoreHorizontalIcon size="md" />}
              onPress={() => setSheet("account")}
            >
              Account and filters
            </BottomSheetItem>
          </View>
        ) : sheet === "drafts" ? (
          <View style={styles.sheetItems}>
            {overview?.drafts.map((saved) => (
              <BottomSheetItem
                disabled={Boolean(busy)}
                key={saved.key}
                loading={busy === "draft"}
                onPress={() => void openSavedDraft(saved)}
              >
                {saved.variant === "new" ? saved.subject : "Saved reply"}
              </BottomSheetItem>
            ))}
          </View>
        ) : sheet === "account" ? (
          <View style={styles.sheetItems}>
            {selected ? <>
              <BottomSheetItem disabled={!permissions.canMutate || Boolean(busy)} icon={<StarIcon size="md" />} loading={busy === "favorite"} onPress={() => void toggleFavorite()}>{selected.thread.isFavorite ? "Unfavorite" : "Favorite"}</BottomSheetItem>
              <BottomSheetItem icon={<SearchIcon size="md" />} onPress={() => void openReaderFlow("similar")}>Find similar</BottomSheetItem>
              <BottomSheetItem disabled={!permissions.canMutate} icon={<TrashIcon size="md" />} onPress={() => void openReaderFlow("delete")}>Delete</BottomSheetItem>
            </> : <>
            {connected && permissions.canMutate ? <BottomSheetItem onPress={openInboxEdit}>Edit</BottomSheetItem> : null}
            {connected ? <BottomSheetItem onPress={openReplyContexts}>Reply context</BottomSheetItem> : null}
            {connected && permissions.canMutate ? (
              <>
              <BottomSheetItem
                disabled={Boolean(busy)}
                loading={busy === "sync"}
                onPress={() => void synchronize()}
              >
                Sync Gmail
              </BottomSheetItem>
              <BottomSheetItem disabled={Boolean(busy)} icon={<SortIcon size="md" />} loading={busy === "sort"} onPress={() => void sortInbox()}>Sort inbox</BottomSheetItem>
              </>
            ) : null}
            {!connected && permissions.canManageConnector ? (
              <BottomSheetItem
                disabled={Boolean(busy)}
                loading={busy === "connect"}
                onPress={openConnectForm}
              >
                Connect Gmail
              </BottomSheetItem>
            ) : null}
            {connected && permissions.canManageConnector ? (
              <BottomSheetItem
                onPress={() => {
                  if (composerDirty) {
                    setPendingExit("disconnect");
                    setSheet("discard");
                  } else setSheet("disconnect");
                }}
              >
                Disconnect Gmail
              </BottomSheetItem>
            ) : null}
            </>}
          </View>
        ) : sheet === "disconnect" ? (
          <View style={styles.sheetItems}>
            <Text style={styles.confirmText}>
              This stops new sync and sending for this inbox. Synced mail stays
              stored in Archive; reconnect this inbox to access it in Signal.
              Nothing is deleted from Gmail.
            </Text>
            <Button
              onPress={() => setSheet("account")}
              size="md"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              loading={busy === "disconnect"}
              onPress={() => void disconnect()}
              size="md"
              variant="danger"
            >
              Disconnect Gmail
            </Button>
          </View>
        ) : (
          <View style={styles.sheetItems}>
            <Text style={styles.confirmText}>{discardFormSheet ? "Your unsaved text, cover, and favorite changes will be lost." : "Your recipients, instructions, body, and attachments will be lost."}</Text>
            <Button
              disabled={busy === "send"}
              onPress={() => {
                if (discardFormSheet) {
                  setSheet(discardFormSheet);
                  setDiscardFormSheet(undefined);
                  setDiscardFormNative(false);
                  nativeNavigationAction.current = undefined;
                } else {
                  setPendingExit(undefined);
                  setSheet(returnToComposer ? "composer" : "account");
                }
              }}
              size="md"
              variant="secondary"
            >
              Keep editing
            </Button>
            <Button disabled={busy === "send"} onPress={discardFormSheet ? discardFormChanges : discardComposer} size="md" variant="danger">
              {discardFormSheet ? "Discard changes" : "Discard email"}
            </Button>
          </View>
        )}
      </BottomSheet>
      </View>
      {readerSheetOpen ? <View accessibilityViewIsModal style={[styles.readerFlow, { paddingTop: insets.top + spacing.sm, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <View style={styles.readerFlowHeader}>
          {readerSheet === "translationReader" || readerSheet === "summaryReader" ? <Button accessibilityLabel="Back to saved versions" contentMode="raw" disabled={readerLoading} onPress={() => setReaderSheet(readerSheet === "translationReader" ? "translate" : "summary")} size="md" variant="icon"><ChevronLeftIcon size="sm" /></Button> : null}
          <Text numberOfLines={1} style={styles.readerFlowTitle}>{readerSheet === "translate" ? "Translations" : readerSheet === "translationReader" ? selectedTranslation?.label ?? "Translation" : readerSheet === "summary" ? "Summaries" : readerSheet === "summaryReader" ? selectedSummary?.topic ?? `Summary ${selectedSummary?.version ?? ""}` : readerSheet === "similar" ? "Similar email" : "Move to Trash?"}</Text>
          <Button accessibilityLabel="Close email reader flow" contentMode="raw" onPress={closeReaderFlow} size="md" variant="icon"><CloseIcon size="sm" /></Button>
        </View>
        {readerError ? <View accessibilityRole="alert" style={styles.sheetError}><Text style={styles.sheetErrorText}>{readerError}</Text></View> : null}
        {readerSheet === "translate" ? <ScrollView contentContainerStyle={styles.readerFlowContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.fieldLabel}>TARGET LANGUAGE</Text>
          <TextInput accessibilityLabel="Translation target language" editable={!readerLoading} maxLength={100} onChangeText={setTargetLanguage} placeholder="French, Spanish, Japanese..." value={targetLanguage} />
          <View style={styles.languageChoices}>{["English", "Spanish", "French", "German", "Japanese"].map((language) => <Button accessibilityState={{ selected: targetLanguage === language }} disabled={readerLoading} key={language} onPress={() => setTargetLanguage(language)} size="md" variant={targetLanguage === language ? "secondary" : "ghost"}>{language}</Button>)}</View>
          <Button disabled={!permissions.canMutate || readerLoading || targetLanguage.trim().length < 2} loading={readerLoading} onPress={() => void generateTranslation()} size="md" variant="primary">Translate</Button>
          <Text style={styles.fieldLabel}>SAVED TRANSLATIONS</Text>
          {!readerLoading && !translations.length ? <Text style={styles.centerText}>No translations yet.</Text> : translations.map((version) => <Button contentMode="raw" key={version.key} onPress={() => { setSelectedTranslation(version); setReaderSheet("translationReader"); }} size="md" style={styles.versionButton} variant="secondary"><FileIcon size="sm" /><View style={styles.resultText}><Text numberOfLines={1} style={styles.rowTitle}>{version.label ?? version.language ?? `Translation ${version.version}`}</Text><Text style={styles.rowSubtitle}>Version {version.version} · {new Date(version.createdAt).toLocaleString()}</Text></View></Button>)}
        </ScrollView> : null}
        {readerSheet === "translationReader" ? <ScrollView contentContainerStyle={styles.generatedReader} showsVerticalScrollIndicator={false}><Text selectable style={styles.readerBody}>{selectedTranslation?.content}</Text></ScrollView> : null}
        {readerSheet === "summary" ? <ScrollView contentContainerStyle={styles.readerFlowContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.fieldLabel}>TOPIC (OPTIONAL)</Text><TextInput accessibilityLabel="Summary topic" editable={!readerLoading} maxLength={500} onChangeText={setSummaryTopic} placeholder="Decision, next steps, key points..." value={summaryTopic} />
          <Text style={styles.fieldLabel}>STYLE</Text><View style={styles.summaryStyles}>{(["brief", "detailed", "executive", "bullet-points", "technical"] as EmailSummaryStyle[]).map((style) => <Button accessibilityState={{ selected: summaryStyle === style }} disabled={readerLoading} key={style} onPress={() => setSummaryStyle(style)} size="md" variant={summaryStyle === style ? "secondary" : "ghost"}>{style.replace("-", " ")}</Button>)}</View>
          <Button disabled={!permissions.canMutate || readerLoading} loading={readerLoading} onPress={() => void generateSummary()} size="md" variant="primary">Generate summary</Button>
          <Text style={styles.fieldLabel}>SAVED SUMMARIES</Text>
          {!readerLoading && !summaries.length ? <Text style={styles.centerText}>No summaries yet.</Text> : summaries.map((summary) => <Button contentMode="raw" key={summary.key} onPress={() => { setSelectedSummary(summary); setReaderSheet("summaryReader"); }} size="md" style={styles.versionButton} variant="secondary"><FileIcon size="sm" /><View style={styles.resultText}><Text numberOfLines={1} style={styles.rowTitle}>{summary.topic ?? `Summary ${summary.version}`}</Text><Text style={styles.rowSubtitle}>{summary.style.replace("-", " ")} · Version {summary.version}</Text></View></Button>)}
        </ScrollView> : null}
        {readerSheet === "summaryReader" ? <ScrollView contentContainerStyle={styles.generatedReader} showsVerticalScrollIndicator={false}><Text selectable style={styles.readerBody}>{selectedSummary?.summary}</Text></ScrollView> : null}
        {readerSheet === "similar" ? <View style={styles.similarFlow}>
          <Tabs accessibilityLabel="Similar email categories" accessibilityRole="tablist" style={styles.categoryTabs}>{INBOX_CATEGORIES.map((item) => <Button accessibilityRole="tab" accessibilityState={{ selected: similarCategory === item.category }} disabled={readerLoading} key={item.category} onPress={() => void loadSimilar(item.category)} size="xs" style={styles.categoryTab} variant={similarCategory === item.category ? "secondary" : "ghost"}>{item.category}</Button>)}</Tabs>
          <ScrollView contentContainerStyle={styles.similarResults} showsVerticalScrollIndicator={false}>{readerLoading ? <Skeleton accessibilityLabel="Finding similar email" accessibilityRole="progressbar" style={styles.threadSkeleton} /> : !similarResults.length ? <Text style={styles.centerText}>No similar email in {similarCategory}.</Text> : similarResults.map((result) => <Button contentMode="raw" key={result.key} onPress={() => void openSimilarResult(result)} size="md" style={styles.similarResult} variant="secondary"><View style={styles.resultText}><Text numberOfLines={1} style={styles.rowTitle}>{result.subject}</Text><Text numberOfLines={2} style={styles.rowSubtitle}>{shortAddress(result.from)} · {Math.round(result.similarity * 100)}% similar · {result.summary}</Text></View></Button>)}</ScrollView>
        </View> : null}
        {readerSheet === "delete" ? <View style={styles.deleteFlow}><TrashIcon size="lg" variant="muted" /><Text style={styles.confirmText}>This moves the entire Gmail thread to Trash. It remains synchronized and visible under Filtered.</Text><Button disabled={readerLoading} loading={readerLoading} onPress={() => void trashThread()} size="md" variant="danger">Move to Trash</Button><Button onPress={closeReaderFlow} size="md" variant="secondary">Cancel</Button></View> : null}
      </View> : null}
      <View accessibilityElementsHidden={readerSheetOpen} importantForAccessibility={readerSheetOpen ? "no-hide-descendants" : "auto"} pointerEvents={readerSheetOpen ? "none" : "auto"}>
      <ReplyContextSheets canMutate={permissions.canMutate} context={emailContext} onClose={() => setReplyContextsOpen(false)} open={replyContextsOpen} />
      {pickerOpen ? (
        <EmailAttachmentPicker
          onClose={() => setPickerOpen(false)}
          onDone={(next) => {
            invalidateComposerOperation();
            setAttachments(next);
            setDraft(undefined);
            setPickerOpen(false);
          }}
          open
          selection={attachments}
        />
      ) : null}
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
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; note: EmailReplyContext }>();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [editorError, setEditorError] = useState<string>();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
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
  const editorDirty = Boolean(editor && (name !== (editor.mode === "edit" ? editor.note.name : "") || text !== (editor.mode === "edit" ? editor.note.text : "")));

  useEffect(() => {
    contextGeneration.current += 1;
    createInFlight.current = false;
    updateInFlight.current = false;
    deleteInFlight.current = false;
    void Promise.resolve().then(() => {
      setSelectedKeys([]);
      setEditor(undefined);
      setDeleteConfirmOpen(false);
      setDiscardConfirmOpen(false);
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
        setDiscardConfirmOpen(false);
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
    setDiscardConfirmOpen(false);
  }
  function requestEditorClose() {
    if (saving) return;
    if (editorDirty && canMutate) setDiscardConfirmOpen(true);
    else closeEditor();
  }
  async function saveNote() {
    if (!editor || saving || !canMutate || !name.trim() || !text.trim()) return;
    if (editor.mode === "create" && createInFlight.current || editor.mode === "edit" && updateInFlight.current) return;
    const operationContext = { ...capturedContext };
    const generation = contextGeneration.current;
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
    try {
      const saved = editor.mode === "create"
        ? await createEmailReplyContextForContext(operationContext, { name: name.trim(), text: text.trim() })
        : await updateEmailReplyContextForContext(operationContext, { noteKey: editor.note.key, name: name.trim(), text: text.trim() });
      if (!operationIsCurrent(generation, operationContext)) {
        void invalidate(operationContext);
        return;
      }
      if (queryClient.getQueryData(signalQueryKeys.replyContexts(operationContext)) === expected) {
        queryClient.setQueryData<EmailReplyContext[]>(signalQueryKeys.replyContexts(operationContext), (current) => editor.mode === "create"
          ? current?.map((note) => note.key === optimisticKey ? saved : note)
          : current?.map((note) => note.key === saved.key ? saved : note));
      } else void invalidate(operationContext);
      closeEditor();
      showToast({ title: editor.mode === "create" ? "Context note created" : "Context note saved", duration: 2_000 });
    } catch (failure) {
      if (!operationIsCurrent(generation, operationContext)) {
        void invalidate(operationContext);
        return;
      }
      if (queryClient.getQueryData(signalQueryKeys.replyContexts(operationContext)) === expected) queryClient.setQueryData(signalQueryKeys.replyContexts(operationContext), before);
      else void invalidate(operationContext);
      setEditorError(messageFor(failure));
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
    const before = queryClient.getQueryData<EmailReplyContext[]>(signalQueryKeys.replyContexts(operationContext)) ?? [];
    const expected = before.filter((note) => !keys.includes(note.key));
    deleteInFlight.current = true;
    setDeleting(true);
    queryClient.setQueryData(signalQueryKeys.replyContexts(operationContext), expected);
    try {
      const result = await deleteEmailReplyContextsForContext(operationContext, keys);
      if (!operationIsCurrent(generation, operationContext)) {
        void invalidate(operationContext);
        return;
      }
      const deleted = new Set(result.deletedNoteKeys);
      const converged = before.filter(({ key }) => !deleted.has(key));
      if (queryClient.getQueryData(signalQueryKeys.replyContexts(operationContext)) === expected) queryClient.setQueryData(signalQueryKeys.replyContexts(operationContext), converged);
      else void invalidate(operationContext);
      setSelectedKeys(keys.filter((key) => !deleted.has(key)));
      setDeleteConfirmOpen(false);
      showToast({ title: deleted.size === 1 ? "Context note deleted" : `${deleted.size} context notes deleted`, duration: 2_000 });
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
    <BottomSheet footer={<View style={styles.replyContextFooter}>{canMutate ? <Button disabled={deleting} onPress={() => openEditor()} size="md" variant="primary">New context note</Button> : null}<Button disabled={deleting} onPress={onClose} size="md" variant="secondary">Close</Button></View>} height="full" onOpenChange={(nextOpen) => { if (!nextOpen && open && !deleting) onClose(); }} open={open} title="Reply context">
      <ScrollView accessibilityLabel="Reply context notes" accessibilityLiveRegion="polite" accessibilityState={{ busy: notesQuery.isPending || deleting }} contentContainerStyle={[styles.replyContextList, !notesQuery.isPending && !notesQuery.error && !notes.length && styles.replyContextEmpty]} showsVerticalScrollIndicator={false}>
        {activeSelectedKeys.length ? <Tabs accessibilityLabel="Context note selection toolbar" style={styles.replyContextSelectionToolbar}><View style={styles.replyContextSelectionCount}><Button accessibilityLabel="Clear context note selection" contentMode="raw" disabled={deleting} onPress={() => setSelectedKeys([])} size="md" style={styles.replyContextSelectionClear} variant="secondary"><CloseIcon size="sm" /></Button><Text style={styles.replyContextSelectionText}>{activeSelectedKeys.length} selected</Text></View><Button disabled={deleting} onPress={() => setDeleteConfirmOpen(true)} size="md" variant="danger">Delete</Button></Tabs> : null}
        {notesQuery.isPending ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.replyContextPillSkeleton} />) : notesQuery.error ? <View style={styles.replyContextEmpty}><Text style={styles.rootEmpty}>{messageFor(notesQuery.error)}</Text><Button onPress={() => void notesQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : notes.map((note) => { const selected = activeSelectedKeys.includes(note.key); return <Button accessibilityActions={canMutate ? [{ name: "longpress", label: selected ? `Deselect ${note.name}` : `Select ${note.name}` }] : undefined} accessibilityLabel={activeSelectedKeys.length ? `${selected ? "Deselect" : "Select"} ${note.name}` : `Open ${note.name}`} accessibilityState={{ selected }} contentMode="raw" disabled={deleting} key={note.key} onAccessibilityAction={canMutate ? ({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") toggleSelection(note.key); } : undefined} onLongPress={canMutate ? () => handleLongPress(note.key) : undefined} onPress={() => handlePress(note)} shape="pill" size="md" style={[styles.replyContextPill, selected && styles.replyContextPillSelected]} variant="secondary"><Text numberOfLines={1} style={styles.replyContextPillText}>{note.name}</Text></Button>; })}
        {!notesQuery.isPending && !notesQuery.error && !notes.length ? <View style={styles.replyContextEmpty}><Text style={styles.rootEmpty}>No context notes yet.</Text>{canMutate ? <Button accessibilityLabel="New context note" contentMode="raw" onPress={() => openEditor()} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : null}</View> : null}
      </ScrollView>
    </BottomSheet>
    <BottomSheet dismissible={!saving} footer={<View style={styles.replyContextFooter}>{canMutate ? <Button disabled={saving || !name.trim() || !text.trim()} loading={saving} onPress={() => void saveNote()} size="md" variant="primary">{editor?.mode === "create" ? "Create" : "Save"}</Button> : null}<Button disabled={saving} onPress={requestEditorClose} size="md" variant="secondary">Close</Button></View>} height="full" onOpenChange={(nextOpen) => { if (!nextOpen && editor) requestEditorClose(); }} open={open && Boolean(editor)} title={editor?.mode === "create" ? "New context note" : "Edit context note"}>
      <ScrollView contentContainerStyle={styles.replyContextEditor} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.formScroll}>{editorError ? <View accessibilityRole="alert" style={styles.sheetError}><Text style={styles.sheetErrorText}>{editorError}</Text></View> : null}<Text style={styles.fieldLabel}>Name</Text><TextInput accessibilityLabel="Context note name" autoFocus={canMutate} editable={canMutate && !saving} maxLength={255} onChangeText={setName} placeholder="Context note name" value={name} /><Text style={styles.fieldLabel}>Context</Text><TextInput accessibilityLabel="Context note text" editable={canMutate && !saving} maxLength={4000} multiline onChangeText={setText} placeholder="Add information that should shape email replies" style={styles.replyContextTextInput} textAlignVertical="top" value={text} /></ScrollView>
    </BottomSheet>
    <BottomSheet dismissible={!deleting} onOpenChange={(nextOpen) => { if (!nextOpen && !deleting) setDeleteConfirmOpen(false); }} open={open && deleteConfirmOpen && activeSelectedKeys.length > 0} title={`Delete ${activeSelectedKeys.length === 1 ? "context note" : `${activeSelectedKeys.length} context notes`}?`}><View style={styles.replyContextFooter}><Text style={styles.confirmText}>This permanently deletes the selected reply context.</Text><Button disabled={deleting} loading={deleting} onPress={() => void deleteSelected()} size="md" variant="danger">Delete</Button><Button disabled={deleting} onPress={() => setDeleteConfirmOpen(false)} size="md" variant="secondary">Close</Button></View></BottomSheet>
    <BottomSheet onOpenChange={(nextOpen) => { if (!nextOpen) setDiscardConfirmOpen(false); }} open={open && discardConfirmOpen} title="Discard context note changes?"><View style={styles.replyContextFooter}><Text style={styles.confirmText}>Your unsaved context note changes will be lost.</Text><Button onPress={() => setDiscardConfirmOpen(false)} size="md" variant="secondary">Keep editing</Button><Button onPress={closeEditor} size="md" variant="danger">Discard changes</Button></View></BottomSheet>
  </>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.voidBlack },
  workspaceSurface: { flex: 1 },
  globalHeader: {
    minHeight: 62,
    paddingHorizontal: spacing.md,
    paddingBottom: 7,
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
    backgroundColor: palette.page,
  },
  localHeader: {
    minHeight: 54,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
    backgroundColor: palette.page,
  },
  localTitle: {
    minWidth: 0,
    flex: 1,
    color: palette.silver50,
    fontFamily: fonts.medium,
    fontSize: 20,
    letterSpacing: -0.3,
  },
  threadHeaderTitle: { fontSize: 14 },
  localActions: { flexDirection: "row", alignItems: "center", gap: 2 },
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
  skeletonList: { flex: 1, padding: spacing.md, gap: 9 },
  tabsSkeleton: { height: 42, borderRadius: radii.md },
  searchSkeleton: { height: 48, borderRadius: radii.lg },
  threadSkeleton: { height: 122, borderRadius: radii.lg },
  inbox: { flex: 1 },
  signalRoot: { flex: 1, paddingHorizontal: spacing.md },
  rootSearch: {
    minHeight: 48,
    marginTop: spacing.md,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: radii.lg,
    backgroundColor: palette.panel,
  },
  rootTabs: { marginTop: 10, flexDirection: "row" },
  rootTab: { minWidth: 0, flex: 1 },
  rootGrid: { flexGrow: 1, alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 12, paddingBottom: spacing.xl },
  emptyGrid: { minHeight: 360, alignContent: "center", alignItems: "center", justifyContent: "center" },
  rootCard: { position: "relative", overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  rootDraftCard: { paddingHorizontal: 8, paddingVertical: 10, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: palette.panelRaised },
  rootCardMain: { width: "100%", height: "100%", paddingHorizontal: 8, paddingVertical: 10, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7 },
  coveredCardMain: { justifyContent: "flex-end", paddingBottom: 8 },
  coveredCardLabel: { width: "auto", maxWidth: "100%", paddingHorizontal: 7, paddingVertical: 4, overflow: "hidden", borderRadius: 999, backgroundColor: "rgba(0,0,0,0.72)", color: palette.silver50 },
  favoriteBadge: { position: "absolute", top: 6, right: 6, width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "rgba(0,0,0,0.72)" },
  rootCardTitle: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 11, lineHeight: 15, textAlign: "center" },
  rootCardMeta: { color: palette.silver700, fontFamily: fonts.semibold, fontSize: 8, letterSpacing: 0.8 },
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
  replyContextEditor: { flexGrow: 1, gap: spacing.md, paddingBottom: spacing.xl },
  replyContextTextInput: { minHeight: 280, paddingTop: 12, lineHeight: 22 },
  rootToneError: { width: "100%", alignItems: "center", paddingHorizontal: spacing.lg },
  categoryTabsFrame: { marginHorizontal: spacing.md, marginTop: spacing.md, marginBottom: 10 },
  categoryTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel },
  categoryTab: { flex: 1 },
  searchBox: {
    minHeight: 48,
    marginHorizontal: spacing.md,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: radii.lg,
    backgroundColor: palette.panel,
  },
  searchInput: {
    minHeight: 42,
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
  threadList: { paddingHorizontal: spacing.md, gap: 8 },
  threadCard: {
    width: "100%",
    height: "auto",
    minHeight: 122,
    paddingHorizontal: 0,
    paddingVertical: 0,
    alignItems: "stretch",
    justifyContent: "flex-start",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: radii.lg,
    backgroundColor: palette.panel,
  },
  threadCardUnread: {
    borderColor: palette.hairlineBright,
    backgroundColor: palette.panelRaised,
  },
  priorityBar: {
    width: 3,
    alignSelf: "stretch",
    backgroundColor: "transparent",
  },
  priorityUrgent: { backgroundColor: palette.silver50 },
  priorityHigh: { backgroundColor: palette.silver500 },
  threadBody: { minWidth: 0, flex: 1, padding: 13 },
  threadTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sender: {
    minWidth: 0,
    flex: 1,
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 12,
    textTransform: "capitalize",
  },
  senderUnread: { color: palette.silver50, fontFamily: fonts.semibold },
  time: { color: palette.silver700, fontFamily: fonts.regular, fontSize: 10 },
  subject: {
    marginTop: 6,
    color: palette.silver100,
    fontFamily: fonts.medium,
    fontSize: 15,
  },
  snippet: {
    marginTop: 4,
    color: palette.silver500,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
  },
  threadFooter: {
    marginTop: 8,
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
  emptyTitle: {
    color: palette.silver300,
    fontFamily: fonts.medium,
    fontSize: 15,
  },
  detail: { flex: 1 },
  detailContent: { padding: spacing.md, gap: 12 },
  detailEyebrow: {
    color: palette.silver500,
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: tracking.micro,
  },
  brief: {
    padding: 16,
    borderLeftWidth: 2,
    borderLeftColor: palette.silver300,
    backgroundColor: palette.panel,
  },
  briefLabel: {
    color: palette.silver500,
    fontFamily: fonts.semibold,
    fontSize: 8,
    letterSpacing: tracking.micro,
  },
  briefText: {
    marginTop: 8,
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
  },
  briefAction: {
    marginTop: 10,
    color: palette.silver50,
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  conversationTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel },
  readerDocument: { minHeight: 360, width: "100%", padding: spacing.md, gap: spacing.md, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.xl, backgroundColor: palette.page },
  readerTitle: { color: palette.silver50, fontFamily: fonts.light, fontSize: 28, lineHeight: 36 },
  messageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  messageIdentity: { minWidth: 0, flex: 1 },
  messageSender: {
    color: palette.silver100,
    fontFamily: fonts.medium,
    fontSize: 13,
    textTransform: "capitalize",
  },
  messageAddress: {
    marginTop: 2,
    color: palette.silver700,
    fontFamily: fonts.regular,
    fontSize: 9,
  },
  readerMetadata: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 11, lineHeight: 18 },
  readerBody: { width: "100%", color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26, textAlign: "left", writingDirection: "ltr" },
  attachmentLabel: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  attachmentText: {
    color: palette.silver500,
    fontFamily: fonts.semibold,
    fontSize: 8,
    letterSpacing: tracking.micro,
  },
  replyDock: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
    backgroundColor: "rgba(0,0,0,0.96)",
  },
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
  metadataForm: { flexGrow: 1, gap: spacing.lg, paddingBottom: spacing.xl },
  formScroll: { flex: 1 },
  metadataDescriptionInput: { minHeight: 120 },
  metadataInstructionInput: { minHeight: 170 },
  metadataCoverControl: { width: 88, height: 88, position: "relative", alignSelf: "flex-start" },
  metadataCoverButton: { width: 88, height: 88, paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden" },
  metadataCoverRemove: { width: 42, height: 42, minHeight: 42, paddingHorizontal: 0, paddingVertical: 0, position: "absolute", right: -12, top: -12 },
  favoriteRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  favoriteLabel: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12 },
  composerScroll: { flex: 1 },
  composer: { gap: 12, paddingBottom: 16 },
  replyContext: {
    padding: 12,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: radii.md,
    backgroundColor: palette.panel,
  },
  replyLabel: {
    color: palette.silver700,
    fontFamily: fonts.semibold,
    fontSize: 8,
    letterSpacing: tracking.micro,
  },
  replySubject: {
    marginTop: 5,
    color: palette.silver100,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  fieldLabel: {
    color: palette.silver500,
    fontFamily: fonts.semibold,
    fontSize: 9,
    letterSpacing: tracking.micro,
  },
  toneRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  instructionInput: { minHeight: 88, paddingTop: 12 },
  bodyInput: { minHeight: 220, paddingTop: 12, lineHeight: 22 },
  composerActions: { flexDirection: "row", gap: 8 },
  flexAction: { minWidth: 0, flex: 1 },
  confirmText: {
    paddingVertical: 8,
    color: palette.silver100,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  readerFlow: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 20, paddingHorizontal: spacing.md, gap: spacing.md, backgroundColor: palette.page },
  readerFlowHeader: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.hairline },
  readerFlowTitle: { minWidth: 0, flex: 1, color: palette.silver50, fontFamily: fonts.medium, fontSize: 18 },
  readerFlowContent: { flexGrow: 1, gap: spacing.md, paddingBottom: spacing.xl },
  generatedReader: { flexGrow: 1, paddingVertical: spacing.md, paddingBottom: spacing.xl },
  languageChoices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  summaryStyles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  versionButton: { width: "100%", justifyContent: "flex-start", paddingHorizontal: 14 },
  resultText: { minWidth: 0, flex: 1, gap: 3 },
  rowTitle: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 14, textAlign: "left" },
  rowSubtitle: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, textAlign: "left" },
  similarFlow: { flex: 1, minHeight: 0, gap: spacing.md },
  similarResults: { flexGrow: 1, gap: spacing.sm, paddingBottom: spacing.xl },
  similarResult: { width: "100%", minHeight: 64, justifyContent: "flex-start", paddingHorizontal: 14 },
  deleteFlow: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
});

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
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
  StarIcon,
} from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";

import { EmailAttachmentPicker } from "@/components/capability/EmailAttachmentPicker";
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { type CapabilitySlug } from "@/data/registry";
import { subscribeAppEvent } from "@/lib/app-events";
import {
  assignEmailDraft,
  askEmailAssistant,
  BUILT_IN_EMAIL_TONES,
  composeEmailDraft,
  createEmailDraft,
  disconnectEmail,
  exchangeEmailConnection,
  fetchEmailOverview,
  fetchEmailThread,
  fetchEmailTones,
  getEmailContext,
  getEmailPermissions,
  launchEmailConnection,
  sendEmailDraft,
  setEmailThreadFavorite,
  subscribeEmail,
  syncEmail,
  updateEmailDraft,
  type EmailAttachmentRef,
  type EmailDraft,
  type EmailConnector,
  type EmailFilter,
  type EmailMessage,
  type EmailOverview,
  type EmailThread,
  type EmailTone,
  type EmailToneRecord,
} from "@/lib/email-client";
import {
  patchSignalThread,
  signalQueryKeys,
} from "@/lib/workspace-query-cache";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";
import { appendCursorItems, isNearScrollEnd } from "@vorinthex/shared/lib/pagination";

type Sheet =
  "ai" | "plus" | "account" | "assignDraft" | "drafts" | "disconnect" | "discard" | "composer";
type RootTab = "inboxes" | "tones";
type ComposerMode = "new" | "reply";
type BusyAction =
  | "connect"
  | "sync"
  | "draft"
  | "save"
  | "send"
  | "favorite"
  | "assign"
  | "disconnect"
  | "ai";
const PRIMARY_FILTERS: { key: EmailFilter; label: string }[] = [
  { key: "all", label: "Inbox" },
  { key: "important", label: "Important" },
  { key: "needs_action", label: "Action" },
  { key: "unread", label: "Unread" },
  { key: "favorite", label: "Favorites" },
];

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
  const overviewQuery = useRef<{ filter: EmailFilter; search: string }>({ filter: "all", search: "" });
  const loadingOverview = useRef(false);
  const loadingMore = useRef(false);
  const toneRequest = useRef(0);
  const toneContext = useRef({ organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey });
  const nativeNavigationAction = useRef<
    Parameters<typeof navigation.dispatch>[0] | undefined
  >(undefined);
  const allowNavigation = useRef(false);
  const [overview, setOverview] = useState<EmailOverview>();
  const [rootQuery, setRootQuery] = useState("");
  const [rootTab, setRootTab] = useState<RootTab>("inboxes");
  const [rootGridWidth, setRootGridWidth] = useState(0);
  const [filter, setFilter] = useState<EmailFilter>("all");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selected, setSelected] = useState<{
    thread: EmailThread;
    messages: EmailMessage[];
  }>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [busy, setBusy] = useState<BusyAction>();
  const [openingThreadKey, setOpeningThreadKey] = useState<string>();
  const [sheet, setSheet] = useState<Sheet>("plus");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingExit, setPendingExit] = useState<
    "inbox" | "native" | "disconnect" | CapabilitySlug
  >();
  const [returnToComposer, setReturnToComposer] = useState(false);
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
  const permissions = getEmailPermissions();
  const composerDirty = Boolean(
    draft ||
    to.trim() ||
    cc.trim() ||
    bcc.trim() ||
    subject.trim() ||
    instruction.trim() ||
    body.trim() ||
    attachments.length,
  );

  const tones = toneRecords.length ? toneRecords.map(({ slug }) => slug) : BUILT_IN_EMAIL_TONES;
  const rootCardSize = Math.floor(((rootGridWidth || width - spacing.md * 2) - 16) / 3);
  const normalizedRootQuery = rootQuery.trim().toLowerCase();
  const visibleAccounts = (overview?.accounts ?? []).filter(({ email }) => email.toLowerCase().includes(normalizedRootQuery));
  const visibleUnassignedDrafts = (overview?.unassignedDrafts ?? []).filter(({ subject }) =>
    (subject ?? "Untitled draft").toLowerCase().includes(normalizedRootQuery),
  );
  const showConnectCard = permissions.canManageConnector && (!normalizedRootQuery || "connect gmail".includes(normalizedRootQuery));
  const visibleTones = toneRecords.filter(({ name, description, instruction }) =>
    [name, description, instruction].some((value) => value.toLowerCase().includes(normalizedRootQuery)),
  );

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
          fetchEmailOverview({
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
      queryKey: signalQueryKeys.tones(emailContext),
      queryFn: fetchEmailTones,
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
  function completeConnection(connector: EmailConnector) {
    const rootRefresh = queryClient.fetchQuery({
      queryKey: signalQueryKeys.overview(emailContext),
      queryFn: () => fetchEmailOverview(),
      staleTime: 0,
    });
    void Promise.allSettled([
      syncEmail(connector.key),
      subscribeEmail(connector.key),
      rootRefresh,
    ]).then(([syncResult, subscribeResult, refreshResult]) => {
      if (syncResult.status === "rejected" || subscribeResult.status === "rejected")
        notify("Gmail connected. Initial sync or live updates need another try.");
      else if (refreshResult.status === "rejected")
        notify("Gmail connected. The inbox list will refresh automatically.");
    });
    router.replace({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey: connector.key } });
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
      queryFn: () => fetchEmailOverview(),
      staleTime: 0,
    });
    void loadToneRecords();
    if (selected) {
      const threadKey = selected.thread.key;
      const generation = ++detailGeneration.current;
      void queryClient.fetchQuery({
        queryKey: signalQueryKeys.detail(emailContext, initialConnectorKey, threadKey),
        queryFn: () => fetchEmailThread(threadKey),
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
    overviewQuery.current = { filter: "all", search: "" };
    loadingOverview.current = false;
    loadingMore.current = false;
    toneRequest.current += 1;
    toneContext.current = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey };
    void Promise.resolve().then(() => {
      setOverview(undefined);
      clearSelectedThread();
      setFilter("all");
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
        if (allowNavigation.current) {
          allowNavigation.current = false;
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
    [navigation, composerDirty, initialConnectorKey, router, selected, sheet],
  );

  function resetComposer() {
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
  function clearSelectedThread() {
    detailGeneration.current += 1;
    setSelected(undefined);
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
    resetComposer();
    setComposerMode(mode);
    setSheet("composer");
    setSheetOpen(true);
  }
  async function openSavedDraft(saved: EmailDraft) {
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
          queryFn: () => fetchEmailThread(threadKey),
        });
        if (generation !== detailGeneration.current) return;
        setSelected(detail);
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
    if (!composerDirty) return true;
    setPendingExit(destination);
    setReturnToComposer(sheet === "composer");
    setSheet("discard");
    setSheetOpen(true);
    return false;
  }
  function requestComposerClose() {
    if (!composerDirty) {
      setSheetOpen(false);
      return;
    }
    setPendingExit(undefined);
    setReturnToComposer(true);
    setSheet("discard");
  }
  function discardComposer() {
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

  async function connect() {
    setBusy("connect");
    let connector: EmailConnector | null = null;
    try {
      connector = await launchEmailConnection();
    } catch (failure) {
      notify(messageFor(failure));
    } finally {
      setBusy(undefined);
    }
    if (connector) completeConnection(connector);
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
      await queryClient.fetchQuery({ queryKey: signalQueryKeys.overview(emailContext), queryFn: () => fetchEmailOverview(), staleTime: 0 });
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
  function openToneDocument(record: EmailToneRecord) {
    setSheetOpen(false);
    router.push({ pathname: "/capability/[slug]", params: { slug: "archive", documentKey: record.key } });
  }
  async function openThread(thread: EmailThread) {
    const generation = ++detailGeneration.current;
    setOpeningThreadKey(thread.key);
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: signalQueryKeys.detail(emailContext, initialConnectorKey, thread.key),
        queryFn: () => fetchEmailThread(thread.key),
      });
      const becameRead = Boolean(thread.unread && !detail.thread.unread);
      if (generation !== detailGeneration.current) return;
      setSelected(detail);
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
  async function prepareDraft(force = false) {
    if (draft && !force) return draft;
    const created =
      composerMode === "reply"
        ? await createEmailDraft({
            threadKey: selected!.thread.key,
            tone,
            ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
            ...(attachments.length ? { attachments } : {}),
          })
        : await composeEmailDraft({ ...composeInput(), connectorKey: initialConnectorKey });
    setDraft(created);
    setBody(created.finalContent ?? created.generatedContent);
    return created;
  }
  async function generateDraft() {
    setBusy("draft");
    setSheetError(undefined);
    try {
      setDraft(undefined);
      await prepareDraft(true);
    } catch (failure) {
      setSheetError(messageFor(failure));
    } finally {
      setBusy(undefined);
    }
  }
  async function saveDraft() {
    setBusy("save");
    setSheetError(undefined);
    try {
      const created = await prepareDraft();
      const saved =
        body.trim() &&
        body.trim() !==
          (created.finalContent ?? created.generatedContent).trim()
          ? await updateEmailDraft(created.key, body.trim())
          : created;
      setDraft(saved);
      setBody(saved.finalContent ?? saved.generatedContent);
      notify("Draft saved");
    } catch (failure) {
      setSheetError(messageFor(failure));
    } finally {
      setBusy(undefined);
    }
  }
  async function send() {
    setBusy("send");
    setSheetError(undefined);
    try {
      const created = await prepareDraft();
      const prepared =
        body.trim() &&
        body.trim() !==
          (created.finalContent ?? created.generatedContent).trim()
          ? await updateEmailDraft(created.key, body.trim())
          : created;
      await sendEmailDraft(prepared.key);
      notify(composerMode === "reply" ? "Reply sent" : "Email sent");
      setSheetOpen(false);
      resetComposer();
      await queryClient.invalidateQueries({
        queryKey: signalQueryKeys.all(emailContext),
      });
      await load();
      if (composerMode === "reply" && selected) {
        const threadKey = selected.thread.key;
        const generation = ++detailGeneration.current;
        const detail = await fetchEmailThread(threadKey);
        if (generation === detailGeneration.current) setSelected((current) => current?.thread.key === threadKey ? detail : current);
      }
    } catch (failure) {
      setSheetError(messageFor(failure));
    } finally {
      setBusy(undefined);
    }
  }
  async function runAiAction(action: "summarize" | "reply") {
    setBusy("ai");
    setSheetError(undefined);
    try {
      if (action === "reply") {
        setSheetOpen(false);
        openComposer("reply");
        return;
      }
      if (!selected) return;
      const result = await askEmailAssistant(
        `Summarize email thread ${selected.thread.key} and identify the next action.`,
        `signal-summary-${selected.thread.key}-${Date.now()}`,
      );
      notify(result.message);
      setSheetOpen(false);
    } catch (failure) {
      setSheetError(messageFor(failure));
    } finally {
      setBusy(undefined);
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
      await queryClient.fetchQuery({ queryKey: signalQueryKeys.overview(emailContext), queryFn: () => fetchEmailOverview(), staleTime: 0 });
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.root}
    >
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
        {initialConnectorKey ? <View style={styles.localActions}>
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
                accessibilityLabel={
                  selected.thread.isFavorite
                    ? "Remove from favorites"
                    : "Add to favorites"
                }
                contentMode="raw"
                disabled={!permissions.canMutate}
                loading={busy === "favorite"}
                onPress={() => void toggleFavorite()}
                size="md"
                variant="icon"
              >
                <StarIcon
                  size="sm"
                  variant={selected.thread.isFavorite ? "accent" : "muted"}
                />
              </Button>
              <Button
                accessibilityLabel="Thread actions"
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
        </View> : null}
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
              onPress={() => void connect()}
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
            contentContainerStyle={[styles.rootGrid, rootTab === "tones" && !visibleTones.length && styles.emptyGrid]}
            onLayout={({ nativeEvent }) => setRootGridWidth(nativeEvent.layout.width)}
            showsVerticalScrollIndicator={false}
          >
            {rootTab === "inboxes" ? (
              <>
                {visibleAccounts.map((account) => (
                  <Button
                    accessibilityLabel={`Open ${account.email} inbox`}
                    contentMode="raw"
                    key={account.key}
                    onPress={() => router.replace({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey: account.key } })}
                    shape="rounded"
                    size="xl"
                    style={[styles.rootCard, { width: rootCardSize, height: rootCardSize }]}
                    variant="secondary"
                  >
                    <InboxIcon size="md" />
                    <Text numberOfLines={2} style={styles.rootCardTitle}>{account.email}</Text>
                    <Text style={styles.rootCardMeta}>{account.status === "active" ? account.syncStatus.toUpperCase() : account.status.toUpperCase()}</Text>
                  </Button>
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
                    style={[styles.rootCard, { width: rootCardSize, height: rootCardSize }]}
                    variant="secondary"
                  >
                    <FileIcon size="md" />
                    <Text numberOfLines={2} style={styles.rootCardTitle}>{saved.subject ?? "Untitled draft"}</Text>
                    <Text style={styles.rootCardMeta}>DRAFT</Text>
                  </Button>
                ))}
                {showConnectCard ? (
                  <Button
                    accessibilityLabel="Connect Gmail"
                    contentMode="raw"
                    loading={busy === "connect"}
                    onPress={() => void connect()}
                    shape="rounded"
                    size="xl"
                    style={[styles.rootCard, styles.connectCard, { width: rootCardSize, height: rootCardSize }]}
                    variant="secondary"
                  >
                    <PlusIcon size="md" />
                    <Text style={styles.rootCardTitle}>Connect Gmail</Text>
                    <Text style={styles.rootCardMeta}>ADD INBOX</Text>
                  </Button>
                ) : null}
                {!visibleAccounts.length && !visibleUnassignedDrafts.length && normalizedRootQuery && !showConnectCard ? <Text style={styles.rootEmpty}>No inboxes or drafts matched this search.</Text> : null}
                {!visibleAccounts.length && !visibleUnassignedDrafts.length && !normalizedRootQuery && !permissions.canManageConnector ? <Text style={styles.rootEmpty}>No Signal inboxes are connected. Ask an organization administrator to connect Gmail.</Text> : null}
              </>
            ) : tonesLoading ? Array.from({ length: 3 }, (_, index) => (
              <Skeleton accessibilityLabel="Loading Signal tones" accessibilityRole="progressbar" key={index} style={{ width: rootCardSize, height: rootCardSize }} />
            )) : toneError ? (
              <View style={styles.rootToneError}>
                <Text style={styles.rootEmpty}>{toneError}</Text>
                <Button onPress={() => void loadToneRecords()} size="md" variant="secondary">Retry tones</Button>
              </View>
            ) : visibleTones.length ? visibleTones.map((record) => (
              <Button
                accessibilityLabel={`Open ${record.name} tone in Archive`}
                contentMode="raw"
                key={record.key}
                onPress={() => openToneDocument(record)}
                shape="rounded"
                size="xl"
                style={[styles.rootCard, { width: rootCardSize, height: rootCardSize }]}
                variant="secondary"
              >
                <Text numberOfLines={2} style={styles.rootCardTitle}>{record.name}</Text>
                <Text numberOfLines={3} style={styles.rootCardDescription}>{record.description}</Text>
              </Button>
            )) : <Text style={styles.rootEmpty}>{normalizedRootQuery ? "No tones matched this search." : "Tone documents are unavailable."}</Text>}
          </ScrollView>
        </View>
      ) : null}

      {!loading && !loadError && initialConnectorKey && showInbox && !selected ? (
        <View style={styles.inbox}>
          <Tabs
            accessibilityLabel="Signal inbox filters"
            accessibilityRole="tablist"
            style={styles.filterTabs}
          >
            {PRIMARY_FILTERS.map((item) => (
              <Button
                accessibilityRole="tab"
                accessibilityState={{ selected: filter === item.key }}
                disabled={workspaceBusy}
                key={item.key}
                onPress={() => void chooseFilter(item.key)}
                size="xs"
                style={styles.filterTab}
                variant={filter === item.key ? "secondary" : "ghost"}
              >
                {item.label}
              </Button>
            ))}
          </Tabs>
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
                    : filter !== "all"
                      ? "Try another inbox filter."
                      : "This inbox is empty. Sync Gmail to check for new messages."}
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
            <Text style={styles.detailEyebrow}>
              {stateLabel(selected.thread)} ·{" "}
              {selected.thread.category?.toUpperCase() ?? "PRIMARY"}
            </Text>
            <View style={styles.brief}>
              <Text style={styles.briefLabel}>SIGNAL BRIEF</Text>
              <Text style={styles.briefText}>{selected.thread.summary}</Text>
              {selected.thread.action ? (
                <Text style={styles.briefAction}>{selected.thread.action}</Text>
              ) : null}
            </View>
            {selected.messages.map((message) => (
              <View
                key={message.key}
                style={[
                  styles.message,
                  message.direction === "outbound" && styles.messageOutbound,
                ]}
              >
                <View style={styles.messageHeader}>
                  <View style={styles.messageIdentity}>
                    <Text numberOfLines={1} style={styles.messageSender}>
                      {message.direction === "outbound"
                        ? "You"
                        : shortAddress(message.from)}
                    </Text>
                    <Text numberOfLines={1} style={styles.messageAddress}>
                      {message.from}
                    </Text>
                  </View>
                  <Text style={styles.time}>{formatTime(message.sentAt)}</Text>
                </View>
                <Text selectable style={styles.messageBody}>
                  {message.body}
                </Text>
                {message.hasAttachments ? (
                  <View style={styles.attachmentLabel}>
                    <FileIcon size="sm" variant="muted" />
                    <Text style={styles.attachmentText}>ATTACHMENTS</Text>
                  </View>
                ) : null}
              </View>
            ))}
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
        height={sheet === "composer" ? "full" : undefined}
        onOpenChange={(open) => {
          if (!open && sheet === "composer") requestComposerClose();
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
                      ? "Discard email?"
                      : "Signal options"
        }
      >
        {sheetError ? (
          <View accessibilityRole="alert" style={styles.sheetError}>
            <Text style={styles.sheetErrorText}>{sheetError}</Text>
          </View>
        ) : null}
        {sheet === "assignDraft" ? (
          <View style={styles.sheetItems}>
            {overview?.accounts.length ? overview.accounts.map((account) => (
              <BottomSheetItem
                disabled={Boolean(busy)}
                key={account.key}
                loading={busy === "assign"}
                onPress={() => void assignDraft(account.key)}
              >
                {account.email}
              </BottomSheetItem>
            )) : (
              <>
                <Text style={styles.confirmText}>Connect Gmail before assigning this draft to an inbox.</Text>
                {permissions.canManageConnector ? (
                  <Button onPress={() => { setSheetOpen(false); setUnassignedDraft(undefined); void connect(); }} size="md" variant="primary">Connect Gmail</Button>
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
                  keyboardType="email-address"
                  onChangeText={(value) => {
                    setTo(value);
                    setDraft(undefined);
                  }}
                  placeholder="To"
                  value={to}
                />
                <Button
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
                      keyboardType="email-address"
                      onChangeText={(value) => {
                        setCc(value);
                        setDraft(undefined);
                      }}
                      placeholder="Cc"
                      value={cc}
                    />
                    <TextInput
                      accessibilityLabel="Bcc recipients"
                      autoCapitalize="none"
                      keyboardType="email-address"
                      onChangeText={(value) => {
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
                  onChangeText={(value) => {
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
                  accessibilityState={{ selected: tone === item }}
                  disabled={Boolean(busy)}
                  key={item}
                  onPress={() => {
                    setTone(item);
                    setDraft(undefined);
                  }}
                  size="md"
                  variant={tone === item ? "secondary" : "ghost"}
                >
                  {item[0]?.toUpperCase()}
                  {item.slice(1)}
                </Button>
              ))}
            </View>
            <TextInput
              accessibilityLabel="AI writing instruction"
              editable={!busy}
              multiline
              onChangeText={(value) => {
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
              onChangeText={setBody}
              placeholder="Write your message or generate a draft"
              style={styles.bodyInput}
              textAlignVertical="top"
              value={body}
            />
            <Button
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
                <BottomSheetItem
                  disabled={Boolean(busy)}
                  icon={<BrainIcon size="md" />}
                  loading={busy === "ai"}
                  onPress={() => void runAiAction("summarize")}
                >
                  Summarize thread
                </BottomSheetItem>
                {permissions.canMutate ? (
                  <BottomSheetItem
                    icon={<SendIcon size="md" />}
                    onPress={() => void runAiAction("reply")}
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
            <BottomSheetItem
              accessibilityState={{ selected: filter === "urgent" }}
              onPress={() => {
                setSheetOpen(false);
                void chooseFilter("urgent");
              }}
            >
              Urgent
            </BottomSheetItem>
            <BottomSheetItem
              accessibilityState={{ selected: filter === "filtered" }}
              onPress={() => {
                setSheetOpen(false);
                void chooseFilter("filtered");
              }}
            >
              Filtered
            </BottomSheetItem>
            {connected && permissions.canMutate ? (
              <BottomSheetItem
                disabled={Boolean(busy)}
                loading={busy === "sync"}
                onPress={() => void synchronize()}
              >
                Sync Gmail
              </BottomSheetItem>
            ) : null}
            {!connected && permissions.canManageConnector ? (
              <BottomSheetItem
                disabled={Boolean(busy)}
                loading={busy === "connect"}
                onPress={() => void connect()}
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
            <Text style={styles.confirmText}>
              Your recipients, instructions, body, and attachments will be lost.
            </Text>
            <Button
              onPress={() => {
                setPendingExit(undefined);
                setSheet(returnToComposer ? "composer" : "account");
              }}
              size="md"
              variant="secondary"
            >
              Keep editing
            </Button>
            <Button onPress={discardComposer} size="md" variant="danger">
              Discard email
            </Button>
          </View>
        )}
      </BottomSheet>
      {pickerOpen ? (
        <EmailAttachmentPicker
          onClose={() => setPickerOpen(false)}
          onDone={(next) => {
            setAttachments(next);
            setDraft(undefined);
            setPickerOpen(false);
          }}
          open
          selection={attachments}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.voidBlack },
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
  emptyGrid: { justifyContent: "center" },
  rootCard: { paddingHorizontal: 8, paddingVertical: 10, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: palette.panelRaised },
  connectCard: { borderStyle: "dashed", backgroundColor: palette.panel },
  rootCardTitle: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 11, lineHeight: 15, textAlign: "center" },
  rootCardDescription: { width: "100%", color: palette.silver500, fontFamily: fonts.regular, fontSize: 9, lineHeight: 13, textAlign: "center" },
  rootCardMeta: { color: palette.silver700, fontFamily: fonts.semibold, fontSize: 8, letterSpacing: 0.8 },
  rootEmpty: { width: "100%", paddingVertical: 40, color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
  rootToneError: { width: "100%", alignItems: "center", paddingHorizontal: spacing.lg },
  filterTabs: { margin: spacing.md, marginBottom: 10, flexDirection: "row" },
  filterTab: { minWidth: 0, flex: 1, paddingHorizontal: 4 },
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
  message: {
    padding: 16,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: radii.lg,
    backgroundColor: palette.panel,
  },
  messageOutbound: {
    marginLeft: 20,
    borderColor: palette.hairlineBright,
    backgroundColor: palette.panelRaised,
  },
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
  messageBody: {
    marginTop: 16,
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
  },
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
});

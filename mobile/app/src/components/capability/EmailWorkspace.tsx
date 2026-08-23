import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
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
import {
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
  syncEmail,
  updateEmailDraft,
  type EmailAttachmentRef,
  type EmailDraft,
  type EmailFilter,
  type EmailMessage,
  type EmailOverview,
  type EmailThread,
  type EmailTone,
} from "@/lib/email-client";
import {
  patchSignalThread,
  signalQueryKeys,
} from "@/lib/workspace-query-cache";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";

type Sheet =
  "ai" | "plus" | "account" | "drafts" | "disconnect" | "discard" | "composer";
type ComposerMode = "new" | "reply";
type BusyAction =
  | "connect"
  | "sync"
  | "draft"
  | "save"
  | "send"
  | "favorite"
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

export function EmailWorkspace() {
  const queryClient = useQueryClient();
  const emailContext = getEmailContext();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const notify = (title: string) => showToast({ title, duration: 2_000 });
  const params = useLocalSearchParams<{
    email_connection_code?: string;
    email_connection_error?: string;
  }>();
  const processedConnectionCode = useRef<string | undefined>(undefined);
  const overviewRequest = useRef(0);
  const nativeNavigationAction = useRef<
    Parameters<typeof navigation.dispatch>[0] | undefined
  >(undefined);
  const allowNavigation = useRef(false);
  const [overview, setOverview] = useState<EmailOverview>();
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
  const [tones, setTones] = useState<EmailTone[]>(BUILT_IN_EMAIL_TONES);
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<EmailDraft>();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<EmailAttachmentRef[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheetError, setSheetError] = useState<string>();
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

  async function load(nextFilter = filter, nextQuery = submittedQuery) {
    const request = ++overviewRequest.current;
    setLoadError(undefined);
    try {
      const value = await queryClient.fetchQuery({
        queryKey: signalQueryKeys.overview(emailContext, nextFilter, nextQuery),
        queryFn: () =>
          fetchEmailOverview({
            filter: nextFilter,
            search: nextQuery || undefined,
          }),
      });
      if (request === overviewRequest.current) setOverview(value);
      return true;
    } catch (failure) {
      if (request === overviewRequest.current)
        setLoadError(messageFor(failure));
      return false;
    } finally {
      if (request === overviewRequest.current) setLoading(false);
    }
  }
  const loadLatest = useEffectEvent(() => load());
  const notifyLatest = useEffectEvent((title: string) => notify(title));

  useEffect(() => {
    void Promise.resolve().then(() => loadLatest());
    void fetchEmailTones().then(setTones);
  }, [emailContext.organizationKey, emailContext.scopeKey]);
  useEffect(() => {
    const code =
      typeof params.email_connection_code === "string"
        ? params.email_connection_code
        : undefined;
    if (!code || processedConnectionCode.current === code) return;
    processedConnectionCode.current = code;
    setBusy("connect");
    void exchangeEmailConnection(code)
      .then(syncEmail)
      .then(() => loadLatest())
      .catch((failure: unknown) => notifyLatest(messageFor(failure)))
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
        if (!composerDirty) return;
        event.preventDefault();
        nativeNavigationAction.current = event.data.action;
        setPendingExit("native");
        setReturnToComposer(sheet === "composer");
        setSheet("discard");
        setSheetOpen(true);
      }),
    [navigation, composerDirty, sheet],
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
        const detail = await queryClient.fetchQuery({
          queryKey: signalQueryKeys.detail(emailContext, threadKey),
          queryFn: () => fetchEmailThread(threadKey),
        });
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
    } else if (destination === "inbox") setSelected(undefined);
    else if (destination === "native" && nativeNavigationAction.current) {
      const action = nativeNavigationAction.current;
      nativeNavigationAction.current = undefined;
      allowNavigation.current = true;
      navigation.dispatch(action);
    } else if (destination) {
      allowNavigation.current = true;
      router.replace({
        pathname: "/capability/[slug]",
        params: { slug: destination },
      });
    }
  }

  async function connect() {
    setBusy("connect");
    try {
      if (await launchEmailConnection()) {
        await syncEmail();
        await load();
      }
    } catch (failure) {
      notify(messageFor(failure));
    } finally {
      setBusy(undefined);
    }
  }
  async function synchronize() {
    setBusy("sync");
    try {
      await syncEmail();
      await load();
      setSheetOpen(false);
      notify("Signal synced");
    } catch (failure) {
      setSheetError(messageFor(failure));
    } finally {
      setBusy(undefined);
    }
  }
  async function chooseFilter(next: EmailFilter) {
    setBusy("sync");
    try {
      if (await load(next, submittedQuery)) {
        setFilter(next);
        setSelected(undefined);
      }
    } finally {
      setBusy(undefined);
    }
  }
  async function search() {
    setBusy("sync");
    const next = query.trim();
    try {
      if (await load(filter, next)) {
        setSubmittedQuery(next);
        setSelected(undefined);
      }
    } finally {
      setBusy(undefined);
    }
  }
  async function openThread(thread: EmailThread) {
    setOpeningThreadKey(thread.key);
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: signalQueryKeys.detail(emailContext, thread.key),
        queryFn: () => fetchEmailThread(thread.key),
      });
      const becameRead = Boolean(thread.unread && !detail.thread.unread);
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
    setBusy("favorite");
    try {
      const updated = await setEmailThreadFavorite(
        selected.thread.key,
        !selected.thread.isFavorite,
      );
      const delta = updated.isFavorite ? 1 : -1;
      setSelected((current) =>
        current ? { ...current, thread: updated } : current,
      );
      patchSignalThread(queryClient, emailContext, updated);
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
        : await composeEmailDraft(composeInput());
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
      if (composerMode === "reply" && selected)
        setSelected(await fetchEmailThread(selected.thread.key));
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
    setBusy("disconnect");
    setSheetError(undefined);
    try {
      await disconnectEmail();
      await queryClient.invalidateQueries({
        queryKey: signalQueryKeys.all(emailContext),
      });
      setSheetOpen(false);
      setSelected(undefined);
      setOverview(
        await fetchEmailOverview({
          filter,
          search: submittedQuery || undefined,
        }),
      );
      notify("Gmail disconnected");
    } catch (failure) {
      setSheetError(messageFor(failure));
    } finally {
      setBusy(undefined);
    }
  }

  const connected = Boolean(overview?.connector && overview.account);
  const hasThreads = Boolean(overview?.threads.length);
  const showInbox = connected || hasThreads || Boolean(overview?.drafts.length);
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
        {selected ? (
          <Button
            accessibilityLabel="Back to inbox"
            contentMode="raw"
            onPress={() => {
              if (requestExit("inbox")) setSelected(undefined);
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
      {!loading && !loadError && !showInbox ? (
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

      {!loading && !loadError && showInbox && !selected ? (
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
              {overview?.account?.email ?? "Archive conversations"}
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
                  Try another filter or connect an account from the menu.
                </Text>
              </View>
            ) : null}
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
          else setSheetOpen(open);
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
        {sheet === "composer" ? (
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
              This removes synced mail from Signal. Nothing is deleted from
              Gmail.
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
  filterTabs: { margin: spacing.md, marginBottom: 10 },
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

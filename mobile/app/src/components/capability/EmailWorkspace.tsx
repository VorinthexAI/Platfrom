import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { ChevronLeftIcon, InboxIcon, MailIcon, MoreHorizontalIcon, SearchIcon, SendIcon, StarIcon } from "@vorinthex/shared/ui/icons-mobile";
import { TextInput } from "@vorinthex/shared/ui/text-input";

import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { ChromeIcon } from "@/components/ChromeIcon";
import { assistantIconSource } from "@/data/capability-icons";
import { type CapabilitySlug } from "@/data/registry";
import {
  createEmailDraft,
  askEmailAssistant,
  disconnectEmail,
  exchangeEmailConnection,
  fetchEmailOverview,
  fetchEmailThread,
  getEmailContext,
  getEmailPermissions,
  launchEmailConnection,
  sendEmailDraft,
  setEmailThreadFavorite,
  syncEmail,
  updateEmailDraft,
  type EmailDraft,
  type EmailFilter,
  type EmailMessage,
  type EmailOverview,
  type EmailThread,
  type EmailTone,
} from "@/lib/email-client";
import { invalidateAssistantChanges, patchSignalThread, signalQueryKeys } from "@/lib/workspace-query-cache";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";

type Sheet = "reply" | "account" | "disconnect" | "discard";
type BusyAction = "connect" | "sync" | "draft" | "send" | "favorite" | "disconnect";
const FILTERS: { key: EmailFilter; label: string; count: keyof EmailOverview["counts"] }[] = [
  { key: "all", label: "Inbox", count: "all" },
  { key: "important", label: "Important", count: "important" },
  { key: "urgent", label: "Urgent", count: "urgent" },
  { key: "needs_action", label: "Action", count: "needsAction" },
  { key: "unread", label: "Unread", count: "unread" },
  { key: "filtered", label: "Filtered", count: "filtered" },
  { key: "favorite", label: "Favorites", count: "favorite" },
];
const TONES: EmailTone[] = ["concise", "warm", "formal", "direct"];

function messageFor(error: unknown) { return error instanceof Error ? error.message : "Email could not complete that request."; }
function shortAddress(value?: string) { return value?.split("@")[0]?.replace(/[._-]+/g, " ") || "Unknown sender"; }
function formatTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function stateLabel(thread: EmailThread) {
  return thread.priority === "urgent" ? "URGENT" : thread.priority === "high" ? "HIGH" : thread.priority === "low" ? "LOW" : thread.state === "needs_action" ? "ACTION" : thread.state.replace("_", " ").toUpperCase();
}
const EMPTY_COUNTS: EmailOverview["counts"] = { all: 0, important: 0, urgent: 0, needsAction: 0, filtered: 0, unread: 0, favorite: 0 };

export function EmailWorkspace() {
  const queryClient = useQueryClient();
  const emailContext = getEmailContext();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email_connection_code?: string; email_connection_error?: string }>();
  const processedConnectionCode = useRef<string | undefined>(undefined);
  const assistantRequestKey = useRef<string | undefined>(undefined);
  const overviewRequest = useRef(0);
  const [overview, setOverview] = useState<EmailOverview>();
  const [filter, setFilter] = useState<EmailFilter>("all");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selected, setSelected] = useState<{ thread: EmailThread; messages: EmailMessage[] }>();
  const [draft, setDraft] = useState<EmailDraft>();
  const [draftText, setDraftText] = useState("");
  const [instruction, setInstruction] = useState("");
  const [tone, setTone] = useState<EmailTone>("concise");
  const [sheet, setSheet] = useState<Sheet>("reply");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyAction>();
  const [refreshing, setRefreshing] = useState<"filter" | "search">();
  const [pendingFilter, setPendingFilter] = useState<EmailFilter>();
  const [openingThreadKey, setOpeningThreadKey] = useState<string>();
  const [pendingExit, setPendingExit] = useState<"inbox" | "native" | "disconnect" | CapabilitySlug>();
  const [loadError, setLoadError] = useState<string>();
  const [error, setError] = useState<string | undefined>(params.email_connection_error ? "Gmail connection was not completed." : undefined);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessage, setAssistantMessage] = useState<string>();
  const [assistantBusy, setAssistantBusy] = useState(false);
  const nativeNavigationAction = useRef<Parameters<typeof navigation.dispatch>[0] | undefined>(undefined);
  const allowNavigation = useRef(false);
  const replyDirty = Boolean(draft || draftText.trim() || instruction.trim());
  const permissions = getEmailPermissions();

  async function load(nextFilter = filter, nextQuery = submittedQuery) {
    const request = ++overviewRequest.current;
    setLoadError(undefined);
    try {
      const value = await queryClient.fetchQuery({ queryKey: signalQueryKeys.overview(emailContext, nextFilter, nextQuery), queryFn: () => fetchEmailOverview({ filter: nextFilter, search: nextQuery || undefined }) });
      if (request === overviewRequest.current) setOverview(value);
      return true;
    } catch (failure) {
      if (request === overviewRequest.current) {
        const nextError = messageFor(failure);
        if (overview) setError(nextError);
        else setLoadError(nextError);
      }
      return false;
    }
    finally { if (request === overviewRequest.current) setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    const request = ++overviewRequest.current;
    void queryClient.fetchQuery({ queryKey: signalQueryKeys.overview(emailContext), queryFn: () => fetchEmailOverview() }).then((value) => { if (active && request === overviewRequest.current) setOverview(value); }).catch((failure: unknown) => { if (active && request === overviewRequest.current) setLoadError(messageFor(failure)); }).finally(() => { if (active && request === overviewRequest.current) setLoading(false); });
    return () => { active = false; };
  }, [emailContext.organizationKey, emailContext.scopeKey, queryClient]);

  useEffect(() => {
    const code = typeof params.email_connection_code === "string" ? params.email_connection_code : undefined;
    if (!code || processedConnectionCode.current === code) return;
    processedConnectionCode.current = code;
    setLoading(true);
    setBusy("connect");
    const request = ++overviewRequest.current;
    void exchangeEmailConnection(code).then(() => syncEmail()).then(() => fetchEmailOverview()).then((value) => { if (request === overviewRequest.current) setOverview(value); }).catch((failure: unknown) => setError(messageFor(failure))).finally(() => { if (request === overviewRequest.current) setLoading(false); setBusy(undefined); });
  }, [params.email_connection_code]);

  useEffect(() => navigation.addListener("beforeRemove", (event) => {
    if (allowNavigation.current) { allowNavigation.current = false; return; }
    if (!replyDirty) return;
    event.preventDefault();
    nativeNavigationAction.current = event.data.action;
    setPendingExit("native"); setSheet("discard"); setSheetOpen(true);
  }), [navigation, replyDirty]);

  async function connect() {
    setBusy("connect"); setError(undefined);
    try { if (await launchEmailConnection()) { await syncEmail(); await load(); } }
    catch (failure) { setError(messageFor(failure)); }
    finally { setBusy(undefined); }
  }
  async function synchronize() {
    setBusy("sync"); setError(undefined);
    try { await syncEmail(); return await load(); }
    catch (failure) { setError(messageFor(failure)); return false; }
    finally { setBusy(undefined); }
  }
  async function chooseFilter(next: EmailFilter) {
    setPendingFilter(next); setRefreshing("filter"); setError(undefined);
    try { if (await load(next, submittedQuery)) { setFilter(next); setSelected(undefined); } }
    finally { setPendingFilter(undefined); setRefreshing(undefined); }
  }
  async function search() {
    const next = query.trim(); setRefreshing("search"); setError(undefined);
    try { if (await load(filter, next)) { setSubmittedQuery(next); setSelected(undefined); } }
    finally { setRefreshing(undefined); }
  }
  async function openThread(thread: EmailThread) {
    setOpeningThreadKey(thread.key); setError(undefined);
    try {
      const detail = await queryClient.fetchQuery({ queryKey: signalQueryKeys.detail(emailContext, thread.key), queryFn: () => fetchEmailThread(thread.key) });
      setDraft(undefined); setDraftText(""); setInstruction(""); setTone("concise");
      setSelected(detail);
      const becameRead = Boolean(thread.unread && !detail.thread.unread);
      setOverview((current) => current ? { ...current, threads: current.threads.map((item) => item.key === thread.key ? detail.thread : item).filter((item) => filter !== "unread" || item.unread), counts: { ...current.counts, unread: Math.max(0, current.counts.unread - (becameRead ? 1 : 0)) } } : current);
    } catch (failure) { setError(messageFor(failure)); }
    finally { setOpeningThreadKey(undefined); }
  }
  function openReply() {
    setError(undefined); setSheet("reply"); setSheetOpen(true);
  }
  function resetReply() {
    setDraft(undefined); setDraftText(""); setInstruction(""); setTone("concise");
  }
  function requestExit(destination: "inbox" | CapabilitySlug) {
    if (!replyDirty) return true;
    setPendingExit(destination); setSheet("discard"); setSheetOpen(true);
    return false;
  }
  function requestDisconnect() {
    if (replyDirty) { setPendingExit("disconnect"); setSheet("discard"); }
    else setSheet("disconnect");
  }
  function discardReply() {
    const destination = pendingExit;
    resetReply(); setPendingExit(undefined);
    if (destination === "disconnect") { setSheet("disconnect"); return; }
    setSheetOpen(false);
    if (destination === "inbox") setSelected(undefined);
    else if (destination === "native" && nativeNavigationAction.current) {
      const action = nativeNavigationAction.current;
      nativeNavigationAction.current = undefined; allowNavigation.current = true; navigation.dispatch(action);
    } else if (destination) {
      allowNavigation.current = true;
      router.replace({ pathname: "/capability/[slug]", params: { slug: destination } });
    }
  }
  async function toggleFavorite() {
    if (!selected) return;
    setBusy("favorite"); setError(undefined);
    try {
      const updated = await setEmailThreadFavorite(selected.thread.key, !selected.thread.isFavorite);
      const delta = updated.isFavorite ? 1 : -1;
      setSelected((current) => current ? { ...current, thread: updated } : current);
      patchSignalThread(queryClient, emailContext, updated);
      await queryClient.invalidateQueries({ queryKey: signalQueryKeys.overviews(emailContext), refetchType: "none" });
      setOverview((current) => current ? {
        ...current,
        threads: current.threads.map((thread) => thread.key === updated.key ? updated : thread).filter((thread) => filter !== "favorite" || thread.isFavorite),
        counts: { ...current.counts, favorite: Math.max(0, current.counts.favorite + delta) },
      } : current);
    } catch (failure) { setError(messageFor(failure)); }
    finally { setBusy(undefined); }
  }
  async function generateDraft() {
    if (!selected) return;
    setBusy("draft"); setError(undefined);
    try {
      const generated = await createEmailDraft({ threadKey: selected.thread.key, tone, instruction: instruction.trim() || undefined });
      setDraft(generated); setDraftText(generated.generatedContent);
    } catch (failure) { setError(messageFor(failure)); }
    finally { setBusy(undefined); }
  }
  async function sendReply() {
    if (!draft || !draftText.trim()) return;
    setBusy("send"); setError(undefined);
    try {
      const prepared = draftText.trim() === (draft.finalContent ?? draft.generatedContent).trim() ? draft : await updateEmailDraft(draft.key, draftText.trim());
      await sendEmailDraft(prepared.key);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: signalQueryKeys.overviews(emailContext) }),
        selected ? queryClient.invalidateQueries({ queryKey: signalQueryKeys.detail(emailContext, selected.thread.key), exact: true }) : Promise.resolve(),
      ]);
      setSheetOpen(false); resetReply();
      const threadKey = selected?.thread.key;
      try {
        if (threadKey) setSelected(await fetchEmailThread(threadKey));
        const request = ++overviewRequest.current;
        const value = await fetchEmailOverview({ filter, search: submittedQuery || undefined });
        if (request === overviewRequest.current) setOverview(value);
      } catch { setError("Reply sent. Sync to refresh this conversation."); }
    } catch (failure) { setError(messageFor(failure)); }
    finally { setBusy(undefined); }
  }
  async function disconnect() {
    setBusy("disconnect"); setError(undefined);
    try {
      await disconnectEmail();
      await queryClient.invalidateQueries({ queryKey: signalQueryKeys.all(emailContext) });
      setSheetOpen(false); setSelected(undefined); resetReply();
      setFilter("all"); setPendingFilter(undefined); setQuery(""); setSubmittedQuery("");
      setOverview({ account: null, connector: null, threads: [], counts: EMPTY_COUNTS });
      try { setOverview(await fetchEmailOverview()); }
      catch { setError("Gmail was disconnected. Refresh Signal to confirm the latest account state."); }
    } catch (failure) { setError(messageFor(failure)); }
    finally { setBusy(undefined); }
  }
  async function askAssistant() {
    const value = assistantInput.trim();
    if (!value) return;
    setAssistantBusy(true); setAssistantMessage(undefined);
    try {
      assistantRequestKey.current ??= `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await askEmailAssistant(value, assistantRequestKey.current);
      assistantRequestKey.current = undefined;
      await invalidateAssistantChanges(queryClient, emailContext, result.changes);
      setAssistantMessage(result.message);
      setAssistantInput("");
      if (result.changes?.some(({ workspace }) => workspace === "signal")) {
        await load();
        if (selected) setSelected(await queryClient.fetchQuery({ queryKey: signalQueryKeys.detail(emailContext, selected.thread.key), queryFn: () => fetchEmailThread(selected.thread.key) }));
      }
    } catch (failure) { setAssistantMessage(messageFor(failure)); }
    finally { setAssistantBusy(false); }
  }

  const connected = Boolean(overview?.connector && overview.account);
  const workspaceBusy = Boolean(busy || refreshing || openingThreadKey);
  const sheetTitle = sheet === "reply" ? "Shape a reply" : sheet === "disconnect" ? "Disconnect Gmail?" : sheet === "discard" ? "Discard reply?" : "Gmail connection";
  const sheetDescription = sheet === "reply"
    ? "Choose a tone, add direction, then review every word before sending."
    : sheet === "disconnect"
      ? "This removes synced mail from Signal. Nothing is deleted from Gmail."
      : sheet === "discard"
        ? "Your instructions and unsent draft will be lost."
      : overview?.account?.email;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6, paddingLeft: Math.max(insets.left, spacing.md), paddingRight: Math.max(insets.right, spacing.md) }]}>
        <WorkspaceAppSwitcher active="signal" onBeforeSelect={(slug) => requestExit(slug)} />
        <View style={styles.headerActions}>
          {connected && selected && permissions.canMutate ? <Button accessibilityLabel={selected.thread.isFavorite ? "Remove email from favorites" : "Add email to favorites"} contentMode="raw" disabled={workspaceBusy} loading={busy === "favorite"} onPress={() => void toggleFavorite()} size="md" variant="icon"><StarIcon size="sm" variant={selected.thread.isFavorite ? "accent" : "muted"} /></Button> : null}
          {connected && (permissions.canMutate || permissions.canManageConnector) ? <Button accessibilityLabel="Email account settings" contentMode="raw" disabled={workspaceBusy} onPress={() => { setSheet("account"); setSheetOpen(true); }} size="md" variant="icon"><MoreHorizontalIcon size="sm" /></Button> : null}
        </View>
      </View>

      {loading ? <View accessible accessibilityLabel="Loading email" accessibilityLiveRegion="polite" accessibilityRole="progressbar" accessibilityValue={{ text: "Loading email" }} style={styles.inboxSkeleton}>
        <View style={styles.accountSkeleton} />
        <View style={styles.filterSkeletonRow}>{Array.from({ length: 4 }, (_, index) => <View key={index} style={styles.filterSkeleton} />)}</View>
        <View style={styles.searchSkeleton} />
        <View style={styles.threadSkeletonList}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={styles.threadSkeleton} />)}</View>
      </View> : null}
      {!loading && loadError ? <View accessibilityRole="alert" style={styles.center}><InboxIcon size="lg" variant="muted" /><Text style={styles.centerText}>{loadError}</Text><Button onPress={() => { setLoading(true); void load(); }} size="sm" variant="secondary">Retry</Button></View> : null}
      {!loading && !loadError && !connected ? <ScrollView contentContainerStyle={[styles.connectScene, { paddingBottom: insets.bottom + 60 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.signalGlyph}><MailIcon size="lg" /></View>
        <Text style={styles.eyebrow}>PRIVATE MAIL SIGNAL</Text>
        <Text style={styles.connectTitle}>See what needs you.</Text>
        <Text style={styles.connectCopy}>Connect Gmail to sort the noise, surface urgent conversations, and shape replies in your voice.</Text>
        {error ? <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}
        {permissions.canManageConnector ? <Button disabled={Boolean(busy)} loading={busy === "connect"} onPress={() => void connect()} size="lg" variant="primary">Connect Gmail</Button> : <Text style={styles.securityCopy}>An organization owner or admin can connect Gmail.</Text>}
        <Text style={styles.securityCopy}>Tokens are encrypted and remain on Vorinthex servers.</Text>
      </ScrollView> : null}

      {!loading && !loadError && connected && !selected ? <View style={styles.inboxScene}>
        <View style={styles.accountLine}><View style={styles.liveDot} /><Text numberOfLines={1} style={styles.accountText}>{overview?.account?.email}</Text><Text style={styles.accountMeta}>{overview?.account?.lastSyncedAt ? formatTime(overview.account.lastSyncedAt) : "Not synced"}</Text></View>
        <ScrollView contentContainerStyle={styles.filterRail} horizontal showsHorizontalScrollIndicator={false}>
          {FILTERS.map((item) => <Button accessibilityState={{ selected: filter === item.key }} disabled={workspaceBusy} key={item.key} loading={refreshing === "filter" && pendingFilter === item.key} onPress={() => void chooseFilter(item.key)} size="xs" variant={filter === item.key ? "primary" : "secondary"}>{item.label} {overview?.counts[item.count] ?? 0}</Button>)}
        </ScrollView>
        <View style={styles.searchBox}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search email" editable={!workspaceBusy} onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder="Search subject or summary" returnKeyType="search" style={styles.searchInput} value={query} /><Button accessibilityLabel="Search email" contentMode="raw" disabled={workspaceBusy} loading={refreshing === "search"} onPress={() => void search()} size="sm" variant="icon"><SearchIcon size="sm" /></Button></View>
        {error ? <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.inlineError}><Text style={styles.errorText}>{error}</Text></View> : null}
        <ScrollView contentContainerStyle={[styles.threadList, { paddingBottom: insets.bottom + spacing.xl }]} showsVerticalScrollIndicator={false}>
          {overview?.threads.map((thread) => <Button accessibilityLabel={`${thread.unread ? "Unread, " : ""}${thread.isFavorite || thread.starred ? "Favorite, " : ""}${shortAddress(thread.latestFrom)}, ${thread.subject}. ${stateLabel(thread)}, ${thread.intent}, ${formatTime(thread.lastMessageAt)}`} contentMode="raw" disabled={Boolean(openingThreadKey)} key={thread.key} loading={openingThreadKey === thread.key} onPress={() => void openThread(thread)} size="xl" style={[styles.threadCard, thread.unread && styles.threadCardUnread]} variant="ghost">
            <View style={[styles.priorityBar, thread.priority === "urgent" ? styles.priorityUrgent : thread.priority === "high" ? styles.priorityHigh : styles.priorityNormal]} />
            <View style={styles.threadBody}>
              <View style={styles.threadTop}><View style={styles.senderLine}>{thread.unread ? <View style={styles.unreadDot} /> : null}<Text numberOfLines={1} style={[styles.sender, thread.unread && styles.senderUnread]}>{shortAddress(thread.latestFrom)}</Text></View><Text style={styles.time}>{formatTime(thread.lastMessageAt)}</Text></View>
              <Text numberOfLines={1} style={styles.subject}>{thread.subject}</Text>
              <Text numberOfLines={2} style={styles.snippet}>{thread.snippet ?? thread.summary}</Text>
              <View style={styles.threadFooter}><Text style={styles.state}>{stateLabel(thread)}</Text><Text numberOfLines={1} style={styles.intent}>{thread.intent}</Text>{thread.isFavorite || thread.starred ? <StarIcon size="sm" variant="accent" /> : null}</View>
            </View>
          </Button>)}
          {overview?.threads.length === 0 ? <View style={styles.empty}><InboxIcon size="lg" variant="muted" /><Text style={styles.emptyTitle}>No messages in this view</Text><Text style={styles.emptyCopy}>Try another triage filter or sync Gmail.</Text></View> : null}
        </ScrollView>
      </View> : null}

      {!loading && !loadError && connected && selected ? <View style={styles.detailScene}>
        <ScrollView contentContainerStyle={[styles.detailContent, { paddingBottom: insets.bottom + (permissions.canMutate ? 110 : 24) }]} showsVerticalScrollIndicator={false}>
          <Button accessibilityLabel="Back to inbox" disabled={workspaceBusy} icon={<ChevronLeftIcon size="sm" />} onPress={() => { if (requestExit("inbox")) setSelected(undefined); }} size="sm" style={styles.detailBack} variant="ghost">Inbox</Button>
          <Text style={styles.detailEyebrow}>{stateLabel(selected.thread)} · {selected.thread.category?.toUpperCase() ?? "PRIMARY"}</Text>
          <Text style={styles.detailTitle}>{selected.thread.subject}</Text>
          <View style={styles.brief}><Text style={styles.briefLabel}>SIGNAL BRIEF</Text><Text style={styles.briefText}>{selected.thread.summary}</Text>{selected.thread.action ? <Text style={styles.briefAction}>{selected.thread.action}</Text> : null}</View>
          {selected.messages.map((message) => <View key={message.key} style={[styles.message, message.direction === "outbound" && styles.messageOutbound]}>
            <View style={styles.messageHeader}><View style={styles.messageIdentity}><Text numberOfLines={1} style={styles.messageSender}>{message.direction === "outbound" ? "You" : shortAddress(message.from)}</Text><Text numberOfLines={1} style={styles.messageAddress}>{message.from}</Text></View><Text style={styles.time}>{formatTime(message.sentAt)}</Text></View>
            <Text selectable style={styles.messageBody}>{message.body}</Text>
            {message.hasAttachments ? <Text style={styles.attachment}>ATTACHMENT</Text> : null}
          </View>)}
        </ScrollView>
        {error && !sheetOpen ? <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={[styles.inlineError, styles.detailError]}><Text style={styles.errorText}>{error}</Text></View> : null}
        {permissions.canMutate ? <View style={[styles.replyDock, { paddingBottom: Math.max(insets.bottom, 12) }]}><Button disabled={Boolean(busy)} icon={<SendIcon size="sm" variant="inverse" />} onPress={openReply} size="lg" variant="primary">Draft reply</Button></View> : null}
      </View> : null}

      {!loading && !loadError && connected ? <View style={styles.assistantDock}>
        <CoreComposer
          accessibilityLabel="Ask Core about Signal"
          disabled={assistantBusy || workspaceBusy}
          editable={!assistantBusy && !workspaceBusy}
          leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />}
          loading={assistantBusy}
          message={assistantMessage ? <Text style={styles.assistantMessage}>{assistantMessage}</Text> : null}
          onChangeText={(value) => { setAssistantInput(value); assistantRequestKey.current = undefined; }}
          onSubmit={() => void askAssistant()}
          prompts={["Show urgent messages", "Sync my inbox", "Draft a warm reply"]}
          sendIcon={<SendIcon size="sm" />}
          value={assistantInput}
        />
      </View> : null}

      <BottomSheet description={sheetDescription} dismissible={!busy} height={sheet === "reply" ? "full" : undefined} onOpenChange={(open) => { setSheetOpen(open); if (!open && sheet === "discard") setPendingExit(undefined); }} open={sheetOpen} title={sheetTitle}>
        <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={sheet === "reply" ? styles.fullSheetScroll : undefined}>
          {error ? <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.inlineError}><Text style={styles.errorText}>{error}</Text></View> : null}
          {sheet === "reply" ? <>
            <Text style={styles.sheetLabel}>TONE</Text>
            <View style={styles.toneRow}>{TONES.map((item) => <Button accessibilityState={{ selected: tone === item }} disabled={Boolean(busy)} key={item} onPress={() => setTone(item)} size="sm" variant={tone === item ? "primary" : "secondary"}>{item[0]?.toUpperCase()}{item.slice(1)}</Button>)}</View>
            {!draft ? <>
              <TextInput accessibilityLabel="Reply instructions" editable={!busy} multiline onChangeText={setInstruction} placeholder="Optional direction, facts, or outcome" style={styles.instructionInput} textAlignVertical="top" value={instruction} />
              <Button disabled={Boolean(busy)} loading={busy === "draft"} onPress={() => void generateDraft()} size="lg" variant="primary">Generate draft</Button>
            </> : <>
              <Text style={styles.sheetLabel}>REVIEW</Text>
              <TextInput accessibilityLabel="Reply draft" editable={!busy} multiline onChangeText={setDraftText} style={styles.draftInput} textAlignVertical="top" value={draftText} />
              <Button disabled={Boolean(busy) || !draftText.trim()} icon={<SendIcon size="sm" variant="inverse" />} loading={busy === "send"} onPress={() => void sendReply()} size="lg" variant="primary">Send reply</Button>
              <Button disabled={Boolean(busy)} onPress={() => { setDraft(undefined); setDraftText(""); }} size="sm" variant="ghost">Start again</Button>
            </>}
          </> : sheet === "account" ? <>
            {permissions.canMutate ? <BottomSheetItem disabled={Boolean(busy)} icon={<MailIcon size="md" />} loading={busy === "sync"} onPress={() => void synchronize().then((synced) => { if (synced) setSheetOpen(false); })}>Sync Gmail</BottomSheetItem> : null}
            {permissions.canManageConnector ? <BottomSheetItem disabled={Boolean(busy)} icon={<InboxIcon size="md" variant="danger" />} onPress={requestDisconnect}>Disconnect account</BottomSheetItem> : null}
          </> : sheet === "disconnect" ? <>
            <Text style={styles.confirmText}>Disconnect {overview?.account?.email ?? "this Gmail account"} from Signal?</Text>
            <Button disabled={Boolean(busy)} onPress={() => setSheet("account")} size="md" variant="secondary">Cancel</Button>
            <Button disabled={Boolean(busy)} loading={busy === "disconnect"} onPress={() => void disconnect()} size="md" variant="danger">Disconnect Gmail</Button>
          </> : <>
            <Text style={styles.confirmText}>{pendingExit === "disconnect" ? "Discard this unsent reply before disconnecting Gmail?" : "Discard this unsent reply and leave the conversation?"}</Text>
            <Button onPress={() => { nativeNavigationAction.current = undefined; setPendingExit(undefined); setSheet("reply"); }} size="md" variant="secondary">Keep editing</Button>
            <Button onPress={discardReply} size="md" variant="danger">Discard reply</Button>
          </>}
        </ScrollView>
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.voidBlack },
  header: { minHeight: 64, paddingBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: palette.hairline, backgroundColor: palette.page, zIndex: 4 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  assistantDock: { backgroundColor: palette.page },
  assistantMessage: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: spacing.xl },
  centerText: { maxWidth: 320, color: palette.silver300, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, textAlign: "center" },
  connectScene: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.xl },
  signalGlyph: { width: 72, height: 72, alignItems: "center", justifyContent: "center", marginBottom: 30, borderWidth: 1, borderColor: palette.hairlineBright, borderRadius: 36, backgroundColor: palette.panelRaised },
  eyebrow: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.label },
  connectTitle: { maxWidth: 330, marginTop: 14, color: palette.silver50, fontFamily: fonts.light, fontSize: 40, lineHeight: 44 },
  connectCopy: { maxWidth: 430, marginTop: 18, marginBottom: 26, color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23 },
  securityCopy: { marginTop: 14, color: palette.silver700, fontFamily: fonts.regular, fontSize: 11, textAlign: "center" },
  inboxScene: { flex: 1 },
  inboxSkeleton: { flex: 1, paddingTop: 0 },
  accountSkeleton: { height: 34, borderBottomWidth: 1, borderBottomColor: palette.hairline, backgroundColor: palette.panelRaised, opacity: 0.72 },
  filterSkeletonRow: { height: 58, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: 7 },
  filterSkeleton: { width: 72, height: 32, borderRadius: 999, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  searchSkeleton: { height: 44, marginHorizontal: spacing.md, marginBottom: 10, borderRadius: radii.lg, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  threadSkeletonList: { paddingHorizontal: spacing.md, gap: 7 },
  threadSkeleton: { width: "100%", height: 128, borderRadius: radii.lg, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  accountLine: { height: 34, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderBottomColor: palette.hairline },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: palette.silver100 },
  accountText: { minWidth: 0, flex: 1, color: palette.silver300, fontFamily: fonts.medium, fontSize: 11 },
  accountMeta: { color: palette.silver700, fontFamily: fonts.regular, fontSize: 10 },
  filterRail: { gap: 7, paddingHorizontal: spacing.md, paddingVertical: 12 },
  searchBox: { minHeight: 44, marginHorizontal: spacing.md, marginBottom: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panel },
  searchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  threadList: { paddingHorizontal: spacing.md, gap: 7 },
  threadCard: { width: "100%", height: "auto", minHeight: 128, paddingHorizontal: 0, paddingVertical: 0, alignItems: "stretch", justifyContent: "flex-start", overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panel },
  threadCardUnread: { borderColor: palette.hairlineBright, backgroundColor: palette.panelRaised },
  priorityBar: { width: 3, alignSelf: "stretch" },
  priorityUrgent: { backgroundColor: palette.silver50 },
  priorityHigh: { backgroundColor: palette.silver500 },
  priorityNormal: { backgroundColor: "transparent" },
  threadBody: { minWidth: 0, flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
  threadTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  senderLine: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center", gap: 7 },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.chromeWhite },
  sender: { flex: 1, color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, textTransform: "capitalize" },
  senderUnread: { color: palette.silver50, fontFamily: fonts.semibold },
  time: { color: palette.silver700, fontFamily: fonts.regular, fontSize: 10 },
  subject: { marginTop: 7, color: palette.silver100, fontFamily: fonts.medium, fontSize: 15 },
  snippet: { marginTop: 4, color: palette.silver500, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  threadFooter: { marginTop: 9, flexDirection: "row", alignItems: "center", gap: 8 },
  state: { paddingHorizontal: 7, paddingVertical: 3, overflow: "hidden", borderRadius: 999, backgroundColor: palette.silver700, color: palette.silver100, fontFamily: fonts.semibold, fontSize: 8, letterSpacing: 1.2 },
  intent: { minWidth: 0, flex: 1, color: palette.silver700, fontFamily: fonts.medium, fontSize: 9, letterSpacing: 0.5, textTransform: "uppercase" },
  empty: { alignItems: "center", paddingVertical: 70, gap: 8 },
  emptyTitle: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 15 },
  emptyCopy: { color: palette.silver700, fontFamily: fonts.regular, fontSize: 12 },
  detailScene: { flex: 1 },
  detailContent: { paddingHorizontal: spacing.md, paddingTop: 24, gap: 12 },
  detailBack: { alignSelf: "flex-start", paddingHorizontal: 0 },
  detailEyebrow: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 9, letterSpacing: tracking.micro },
  detailTitle: { maxWidth: 620, color: palette.silver50, fontFamily: fonts.light, fontSize: 30, lineHeight: 36 },
  brief: { marginTop: 8, padding: 16, borderLeftWidth: 2, borderLeftColor: palette.silver300, backgroundColor: palette.panel },
  briefLabel: { color: palette.silver500, fontFamily: fonts.semibold, fontSize: 8, letterSpacing: tracking.micro },
  briefText: { marginTop: 8, color: palette.silver300, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  briefAction: { marginTop: 10, color: palette.silver50, fontFamily: fonts.medium, fontSize: 12 },
  message: { marginTop: 7, padding: 16, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panel },
  messageOutbound: { marginLeft: 20, borderColor: palette.hairlineBright, backgroundColor: palette.panelRaised },
  messageHeader: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  messageIdentity: { minWidth: 0, flex: 1 },
  messageSender: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 13, textTransform: "capitalize" },
  messageAddress: { marginTop: 2, color: palette.silver700, fontFamily: fonts.regular, fontSize: 9 },
  messageBody: { marginTop: 16, color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22 },
  attachment: { marginTop: 14, color: palette.silver500, fontFamily: fonts.semibold, fontSize: 8, letterSpacing: tracking.micro },
  replyDock: { position: "absolute", right: 0, bottom: 0, left: 0, paddingHorizontal: spacing.md, paddingTop: 12, borderTopWidth: 1, borderTopColor: palette.hairline, backgroundColor: "rgba(0,0,0,0.95)" },
  inlineError: { marginHorizontal: spacing.md, marginBottom: 8, padding: 10, borderWidth: 1, borderColor: "rgba(176,74,74,0.45)", borderRadius: radii.md, backgroundColor: "rgba(64,20,20,0.9)" },
  detailError: { position: "absolute", right: 0, bottom: 90, left: 0 },
  errorText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  sheetContent: { gap: 12, paddingBottom: 8 },
  fullSheetScroll: { flex: 1 },
  sheetLabel: { marginTop: 3, color: palette.silver500, fontFamily: fonts.semibold, fontSize: 9, letterSpacing: tracking.micro },
  toneRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  instructionInput: { minHeight: 110, paddingTop: 12 },
  draftInput: { minHeight: 240, paddingTop: 12, lineHeight: 22 },
  confirmText: { paddingVertical: 8, color: palette.silver100, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: "center" },
});

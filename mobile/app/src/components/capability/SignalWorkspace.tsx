import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { ChevronLeftIcon, CloseIcon, FilterIcon, MailIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, SendIcon } from "@vorinthex/shared/ui/icons-mobile";
import { PullToRefresh } from "@vorinthex/shared/ui/pull-to-refresh";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useSessionToast as useToast } from "@/hooks/use-session-toast";
import { useErrorFeedback } from "@/hooks/use-error-feedback";
import { isNearScrollEnd } from "@vorinthex/shared/lib/pagination";

import { ChromeIcon } from "@/components/ChromeIcon";
import { PersistentCoreComposer as CoreComposer } from "@/components/PersistentCoreComposer";
import { ProfileHeaderRight } from "@/components/ProfileAvatarButton";
import { SupportComposeSheets, type SupportComposeKind } from "@/components/SupportComposeSheets";
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { assistantIconSource } from "@/data/capability-icons";
import { subscribeAppEvent } from "@/lib/app-events";
import { communicationQueryKeys, listCommunicationThreads, MANAGED_INBOX_PAGE_SIZE, markCommunicationThreadRead, type CommunicationContext, type CommunicationReadState, type CommunicationTab, type CommunicationThread } from "@/lib/communication-client";
import { createSupportTicket } from "@/lib/profile-client";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

const CORE_PROMPTS = ["Show my unread notifications", "What tickets have I sent?"] as const;
const tabs: readonly { key: CommunicationTab; label: string }[] = [{ key: "unread", label: "Unread" }, { key: "read", label: "Read" }, { key: "sent", label: "Sent" }];
const readStateOptions: readonly { key: CommunicationReadState; label: string }[] = [{ key: "unread", label: "Unread" }, { key: "read", label: "Read" }];

function displayTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)).replace(",", "");
}

function isOptimisticThreadKey(key: string) {
  return key.startsWith("optimistic:");
}

function optimisticSupportThread(kind: SupportComposeKind, message: string, key: string, createdAt: string): CommunicationThread {
  return { key, kind, subject: kind === "issue" ? "Support issue" : "Product feedback", preview: message.slice(0, 8_000), isRead: true, updatedAt: createdAt };
}

export function SignalWorkspace({ initialCompose, initialTab = "unread", initialThreadKey }: { initialCompose?: SupportComposeKind; initialTab?: CommunicationTab; initialThreadKey?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const userKey = useAuthStore((state) => String(state.user?.key ?? ""));
  const teamKey = useAuthStore((state) => String(state.team?.key ?? ""));
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const context: CommunicationContext = useMemo(() => ({ userKey, teamKey, scopeKey }), [userKey, teamKey, scopeKey]);
  const [tab, setTab] = useState<CommunicationTab>(initialTab === "unread" || initialTab === "read" || initialTab === "sent" ? initialTab : "unread");
  const [query, setQuery] = useState("");
  const normalizedQuery = useDeferredValue(query.trim());
  const [compose, setCompose] = useState<SupportComposeKind | undefined>(initialCompose);
  const [selected, setSelected] = useState<CommunicationThread>();
  const [sheet, setSheet] = useState<"plus" | "filter" | "bulk">();
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [longPressedKey, setLongPressedKey] = useState<string>();
  const [pendingSent, setPendingSent] = useState<CommunicationThread[]>([]);
  const enabled = Boolean(userKey && teamKey && scopeKey);
  const listQuery = useInfiniteQuery({
    queryKey: communicationQueryKeys.list(context, tab, normalizedQuery),
    queryFn: ({ pageParam }) => listCommunicationThreads({ tab, limit: MANAGED_INBOX_PAGE_SIZE, query: normalizedQuery || undefined, ...(pageParam ? { cursor: pageParam } : {}) }, context),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage, _pages, lastPageParam, pageParams) => {
      const nextCursor = lastPage.nextCursor ?? undefined;
      return nextCursor && nextCursor !== lastPageParam && !pageParams.includes(nextCursor) ? nextCursor : undefined;
    },
    enabled,
  });
  const listedThreads = [...new Map((listQuery.data?.pages.flatMap(({ items }) => items) ?? []).map((thread) => [thread.key, thread])).values()];
  useErrorFeedback([listQuery.error]);
  const threads = [...(tab === "sent" ? pendingSent.filter((pending) => !listedThreads.some((thread) => thread.key === pending.key || (thread.kind === pending.kind && thread.preview === pending.preview && thread.subject === pending.subject))) : []), ...listedThreads];
  const selectedThreads = selectedKeys.flatMap((key) => { const thread = threads.find((item) => item.key === key); return thread ? [thread] : []; });
  const opened = selected ?? (initialThreadKey ? threads.find((thread) => thread.key === initialThreadKey) : undefined);

  useEffect(() => subscribeAppEvent((event) => {
    if (event.type === "communication.changed" || event.type === "event-stream.connected") void queryClient.invalidateQueries({ queryKey: communicationQueryKeys.all(context), refetchType: "active" });
  }), [context, queryClient]);

  useEffect(() => {
    if (!opened || opened.kind !== "notification" || opened.isRead) return;
    void markCommunicationThreadRead(opened.key, context).then((updated) => {
      setSelected(updated);
      void queryClient.invalidateQueries({ queryKey: communicationQueryKeys.lists(context) });
    }).catch(() => undefined);
  }, [context, opened, queryClient]);

  const setRoute = (params: Record<string, string | undefined>) => router.setParams({ inbox: "internal", compose: undefined, thread: undefined, ...params });
  const openThread = (thread: CommunicationThread) => { setSelected(thread); setSelectedKeys([]); setRoute({ tab, thread: thread.key }); };
  const closeThread = () => { setSelected(undefined); setRoute({ tab }); };
  const chooseTab = (next: CommunicationTab) => { setTab(next); setSelected(undefined); setSelectedKeys([]); setRoute({ tab: next }); };
  const chooseReadState = (next: CommunicationReadState) => { setTab(next); setSelectedKeys([]); setSheet(undefined); setRoute({ tab: next }); };
  const loadMore = async () => {
    if (!listQuery.hasNextPage || listQuery.isFetchingNextPage) return;
    const result = await listQuery.fetchNextPage();
    if (result.isError) showToast({ title: "More messages could not be loaded.", duration: 2_500 });
  };
  const toggleSelection = (key: string) => setSelectedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const markSelected = async (read: boolean) => {
    if (!selectedThreads.length || bulkBusy || tab === "sent") return;
    setBulkBusy(true);
    setSheet(undefined);
    showToast({ title: selectedThreads.length === 1 ? `Message marked ${read ? "read" : "unread"}.` : `${selectedThreads.length} messages marked ${read ? "read" : "unread"}.`, duration: 2_500 });
    try {
      const results = await Promise.allSettled(selectedThreads.map((thread) => markCommunicationThreadRead(thread.key, context, read)));
      const failedKeys = selectedThreads.filter((_, index) => results[index]?.status === "rejected").map(({ key }) => key);
      setSelectedKeys(failedKeys);
      await queryClient.invalidateQueries({ queryKey: communicationQueryKeys.all(context), refetchType: "active" });
      if (failedKeys.length) showToast({ title: `${selectedThreads.length - failedKeys.length} updated, ${failedKeys.length} failed`, duration: 2_500 });
    } finally { setBulkBusy(false); }
  };
  const openCompose = (kind: SupportComposeKind) => {
    setSheet(undefined);
    requestAnimationFrame(() => { setCompose(kind); setRoute({ tab, compose: kind }); });
  };
  const sendSupport = ({ kind, message, requestKey }: { kind: SupportComposeKind; message: string; requestKey: string }) => {
    const optimisticKey = `optimistic:${requestKey}`;
    const createdAt = new Date().toISOString();
    setPendingSent((current) => [optimisticSupportThread(kind, message, optimisticKey, createdAt), ...current.filter((thread) => thread.key !== optimisticKey)]);
    setQuery("");
    setSelectedKeys([]);
    setSelected(undefined);
    setTab("sent");
    setCompose(undefined);
    setRoute({ tab: "sent" });
    showToast({ title: kind === "issue" ? "Issue report sent." : "Feedback sent. Thank you!", duration: 2_500 });
    void createSupportTicket({ teamKey, scopeKey, message, kind }, requestKey).then((result) => {
      setPendingSent((current) => current.map((thread) => thread.key === optimisticKey ? { ...thread, key: result.key } : thread));
      void queryClient.invalidateQueries({ queryKey: communicationQueryKeys.lists(context) });
    }).catch(() => {
      setPendingSent((current) => current.filter((thread) => thread.key !== optimisticKey));
      showToast({ title: kind === "issue" ? "Your report could not be sent." : "Your feedback could not be sent.", duration: 2_500 });
    });
  };

  return <View style={styles.root}>
    <View style={styles.workspaceSurface}>
    <View style={[styles.globalHeader, { paddingTop: insets.top + 6 }]}><WorkspaceAppSwitcher active="signal" /><ProfileHeaderRight /></View>
    <View style={[styles.localHeader, styles.inboxHeader]}>
      <Button accessibilityLabel={opened ? "Back to Vorinthex AI inbox" : "Back to Signal root"} contentMode="raw" hitSlop={6} iconOnly onPress={opened ? closeThread : () => router.replace({ pathname: "/capability/[slug]", params: { slug: "signal" } })} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button>
      <Text numberOfLines={1} style={[styles.localTitle, styles.inboxTitle]}>{opened?.subject ?? "Vorinthex AI"}</Text>
      {opened ? null : <Button accessibilityLabel="Create in Vorinthex AI inbox" contentMode="raw" hitSlop={6} iconOnly onPress={() => setSheet("plus")} size="xs" variant="icon"><PlusIcon size="sm" /></Button>}
    </View>
    {opened ? <View style={styles.detail}>
      <View style={styles.detailContent}>
        <View style={styles.messageHeader}><Text selectable style={styles.messageAddress}>{opened.kind === "notification" ? "Vorinthex" : "You"}</Text><Text accessibilityLabel={`Sent ${displayTime(opened.updatedAt)}`} style={styles.messageTime}>{displayTime(opened.updatedAt)}</Text></View>
        <View accessibilityLabel={`Email: ${opened.subject}`} style={styles.readerDocument}>
          <ScrollView alwaysBounceVertical contentContainerStyle={[styles.readerDocumentContent, { paddingBottom: insets.bottom + spacing.lg }]} showsVerticalScrollIndicator={false}>
            <Text selectable style={styles.messageSubject}>{opened.subject}</Text>
            <Text selectable style={styles.readerBody}>{opened.preview}</Text>
          </ScrollView>
        </View>
      </View>
    </View> : <View style={styles.inbox}>
      <View style={styles.inboxActions}>
        <View style={styles.searchBox}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search Vorinthex AI messages" maxLength={500} onChangeText={setQuery} placeholder="Search..." returnKeyType="search" style={styles.searchInput} value={query} />{query ? <Button accessibilityLabel="Clear message search" contentMode="raw" hitSlop={8} iconOnly onPress={() => setQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}</View>
        <Button accessibilityLabel="Filter Vorinthex AI inbox" contentMode="raw" onPress={() => setSheet("filter")} size="sm" style={styles.filterButton} variant="icon"><FilterIcon size="sm" variant={tab === "sent" ? "default" : "accent"} /></Button>
      </View>
      {selectedKeys.length ? <Tabs accessibilityLabel="Selected managed messages toolbar" style={styles.bulkToolbar}><View style={styles.bulkSelection}><Button accessibilityLabel="Clear message selection" contentMode="raw" disabled={bulkBusy} iconOnly onPress={() => setSelectedKeys([])} size="xs" variant="secondary"><CloseIcon size="sm" /></Button><Text style={styles.bulkText}>{selectedKeys.length} selected</Text></View><Button accessibilityLabel="Selected message actions" contentMode="raw" disabled={bulkBusy} iconOnly onPress={() => setSheet("bulk")} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button></Tabs> : null}
      <View style={styles.tabsFrame}><Tabs accessibilityLabel="Vorinthex AI mailbox" accessibilityRole="tablist" style={styles.tabs}>{tabs.map((item) => <Button accessibilityRole="tab" accessibilityState={{ selected: item.key === tab }} key={item.key} onPress={() => chooseTab(item.key)} size="xs" style={styles.tab} variant={item.key === tab ? "secondary" : "ghost"}>{item.label}</Button>)}</Tabs></View>
      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]} onScroll={({ nativeEvent }) => { if (isNearScrollEnd({ offset: nativeEvent.contentOffset.y, viewport: nativeEvent.layoutMeasurement.height, content: nativeEvent.contentSize.height })) void loadMore(); }} refreshControl={<PullToRefresh onRefresh={() => listQuery.refetch().then(() => undefined)} refreshing={listQuery.isRefetching} />} scrollEventThrottle={120} showsVerticalScrollIndicator={false}>
        {listQuery.isPending && !threads.length ? [0, 1, 2].map((index) => <Skeleton accessibilityLabel="Loading Vorinthex AI messages" accessibilityRole="progressbar" key={index} style={styles.threadSkeleton} />) : listQuery.isError && !threads.length ? <Button onPress={() => void listQuery.refetch()} size="md" variant="secondary">Retry</Button> : threads.length ? threads.map((thread) => { const pending = isOptimisticThreadKey(thread.key); const selectedRow = selectedKeys.includes(thread.key); const select = (suppressPress: boolean) => { if (bulkBusy || pending || tab === "sent") return; const enteringSelection = !selectedRow && selectedKeys.length === 0; setLongPressedKey(suppressPress ? thread.key : undefined); toggleSelection(thread.key); if (enteringSelection) void Haptics.selectionAsync(); }; return <Button accessibilityActions={pending || tab === "sent" ? undefined : [{ name: "longpress", label: selectedRow ? `Deselect ${thread.subject}` : `Select ${thread.subject}` }]} accessibilityLabel={`${thread.isRead ? "" : "Unread, "}${thread.subject}`} accessibilityState={{ selected: selectedRow }} contentMode="raw" disabled={bulkBusy} key={thread.key} onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") select(false); }} onLongPress={() => select(true)} onPress={() => { setLongPressedKey(undefined); if (pending || longPressedKey === thread.key) return; if (selectedKeys.length) toggleSelection(thread.key); else openThread(thread); }} shape="pill" size="sm" style={[styles.thread, selectedRow && styles.threadSelected]} variant={selectedRow ? "ghost" : "secondary"}><MailIcon size="sm" /><View style={styles.threadCopy}><Text numberOfLines={1} style={[styles.threadSubject, !thread.isRead && styles.unread]}>{thread.subject}</Text>{tab === "sent" ? null : <Text style={styles.time}>{displayTime(thread.updatedAt)}</Text>}</View></Button>; }) : <Text style={styles.empty}>{normalizedQuery ? "No matching messages." : tab === "sent" ? "No sent tickets yet." : tab === "unread" ? "No unread notifications." : "No read notifications."}</Text>}
        {listQuery.isFetchingNextPage ? <Skeleton accessibilityLabel="Loading more messages" accessibilityRole="progressbar" style={styles.paginationSkeleton} /> : null}
      </ScrollView>
    </View>}
    </View>
    <CoreComposer accessibilityLabel="Ask Core about your Signal" leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />} onChangeText={() => undefined} onSubmit={() => undefined} pageIdentity={(closeCore) => <WorkspaceAppSwitcher active="signal" identity="core" onSelectActive={closeCore} />} prompts={CORE_PROMPTS} sendIcon={<SendIcon size="sm" />} style={styles.signalComposer} value="" />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={Boolean(sheet)} title="">
      <BottomSheetMenu>
        {sheet === "plus" ? <><BottomSheetItem onPress={() => openCompose("issue")} style={styles.menuItem} textStyle={styles.menuText} variant="secondary">Report an issue</BottomSheetItem><BottomSheetItem onPress={() => openCompose("feedback")} style={styles.menuItem} textStyle={styles.menuText} variant="secondary">Give us feedback</BottomSheetItem></> : null}
        {sheet === "filter" ? readStateOptions.map((option) => <BottomSheetItem accessibilityState={{ selected: option.key === tab }} key={option.key} onPress={() => chooseReadState(option.key)} style={styles.menuItem} textStyle={styles.menuText} variant={option.key === tab ? "primary" : "secondary"}>{option.label}</BottomSheetItem>) : null}
        {sheet === "bulk" ? <><BottomSheetItem disabled={bulkBusy} onPress={() => void markSelected(true)} style={styles.menuItem} textStyle={styles.menuText} variant="secondary">Mark as read</BottomSheetItem><BottomSheetItem disabled={bulkBusy} onPress={() => void markSelected(false)} style={styles.menuItem} textStyle={styles.menuText} variant="secondary">Mark as unread</BottomSheetItem></> : null}
      </BottomSheetMenu>
    </BottomSheet>
    <SupportComposeSheets compose={compose} onClose={() => { setCompose(undefined); setRoute({ tab, compose: undefined }); }} onSubmit={sendSupport} />
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: palette.voidBlack, flex: 1 },
  workspaceSurface: { flex: 1 },
  globalHeader: { alignItems: "center", backgroundColor: palette.page, borderBottomColor: palette.hairline, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 64, paddingBottom: 7, paddingHorizontal: spacing.md },
  localHeader: { alignItems: "center", backgroundColor: palette.page, flexDirection: "row", gap: spacing.xs, marginTop: spacing.md, minHeight: 44, paddingHorizontal: spacing.md },
  inboxHeader: { minHeight: 48 },
  localTitle: { color: palette.silver50, flex: 1, fontFamily: fonts.medium, fontSize: 21, letterSpacing: -0.3, minWidth: 0 },
  inboxTitle: { fontSize: 24, letterSpacing: 0 },
  inbox: { flex: 1, gap: spacing.md, paddingTop: spacing.md - spacing.xs },
  inboxActions: { alignItems: "center", flexDirection: "row", gap: spacing.sm, minHeight: 52, marginHorizontal: spacing.md },
  searchBox: { alignItems: "center", backgroundColor: palette.page, borderColor: palette.hairline, borderRadius: 999, borderWidth: 1, flex: 1, flexDirection: "row", gap: 7, minHeight: 44, paddingLeft: 12, paddingRight: 8 },
  searchInput: { backgroundColor: "transparent", borderWidth: 0, flex: 1, fontSize: 13, minHeight: 40, paddingHorizontal: 0 },
  filterButton: { height: 44, minHeight: 44, width: 44 },
  bulkToolbar: { alignItems: "center", backgroundColor: palette.panel, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginHorizontal: spacing.md, minHeight: 40, padding: 5 },
  bulkSelection: { alignItems: "center", flex: 1, flexDirection: "row", gap: spacing.sm },
  bulkText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  tabsFrame: { marginHorizontal: spacing.md },
  tabs: { backgroundColor: palette.panel, borderWidth: 1, flexDirection: "row", gap: 4, padding: 3 },
  tab: { flex: 1, minHeight: 28 },
  list: { flexGrow: 1, gap: spacing.sm, paddingHorizontal: spacing.md },
  thread: { justifyContent: "flex-start", minHeight: 38, paddingHorizontal: 14, width: "100%" },
  threadSelected: { backgroundColor: "transparent", borderColor: palette.silver50, borderWidth: 1 },
  threadCopy: { alignItems: "center", flex: 1, flexDirection: "row", gap: spacing.sm, minWidth: 0 },
  threadSubject: { color: palette.silver300, flex: 1, fontFamily: fonts.regular, fontSize: 12, textAlign: "left" },
  unread: { color: palette.silver50, fontFamily: fonts.medium },
  time: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 10 },
  threadSkeleton: { backgroundColor: palette.hairlineBright, borderRadius: 999, height: 38, opacity: 0.72, width: "100%" },
  paginationSkeleton: { backgroundColor: palette.hairlineBright, borderRadius: 999, height: 38, opacity: 0.72, width: "100%" },
  empty: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 70, textAlign: "center" },
  state: { alignItems: "center", gap: spacing.md, justifyContent: "center", paddingVertical: spacing.xl },
  stateText: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
  detail: { flex: 1, minHeight: 0 },
  detailContent: { flex: 1, gap: spacing.sm, minHeight: 0, paddingBottom: spacing.sm, paddingHorizontal: spacing.md },
  signalComposer: { backgroundColor: palette.page },
  readerDocument: { backgroundColor: palette.page, borderColor: palette.hairline, borderRadius: radii.xl, borderWidth: 1, flex: 1, minHeight: 0, overflow: "hidden", width: "100%" },
  readerDocumentContent: { flexGrow: 1, gap: spacing.md, padding: spacing.md },
  messageHeader: { alignItems: "flex-start", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  messageAddress: { color: palette.silver500, flex: 1, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, minWidth: 0 },
  messageTime: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, textAlign: "right" },
  messageSubject: { color: palette.silver50, fontFamily: fonts.semibold, fontSize: 20, lineHeight: 27, width: "100%" },
  readerBody: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26, textAlign: "left", width: "100%", writingDirection: "ltr" },
  menuItem: { justifyContent: "center" },
  menuText: { textAlign: "center" },
});

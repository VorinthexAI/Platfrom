import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { ChevronLeftIcon, CloseIcon, FilterIcon, MailIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, SendIcon } from "@vorinthex/shared/ui/icons-mobile";
import { PullToRefresh } from "@vorinthex/shared/ui/pull-to-refresh";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";
import { isNearScrollEnd } from "@vorinthex/shared/lib/pagination";

import { ProfileHeaderRight } from "@/components/ProfileAvatarButton";
import { SupportComposeSheets, type SupportComposeKind } from "@/components/SupportComposeSheets";
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { subscribeAppEvent } from "@/lib/app-events";
import { communicationQueryKeys, listCommunicationThreads, markCommunicationThreadRead, readCommunicationThread, replyToCommunicationThread, type CommunicationContext, type CommunicationReadState, type CommunicationTab } from "@/lib/communication-client";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

const tabs: readonly { key: CommunicationTab; label: string }[] = [{ key: "inbox", label: "Messages" }, { key: "sent", label: "Sent" }];
const readStateOptions: readonly { key: CommunicationReadState; label: string }[] = [{ key: "all", label: "All messages" }, { key: "unread", label: "Unread" }, { key: "read", label: "Read" }];

function displayTime(value: string) {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(new Date(value));
}

export function SignalWorkspace({ initialCompose, initialTab = "inbox", initialThreadKey }: { initialCompose?: SupportComposeKind; initialTab?: CommunicationTab; initialThreadKey?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const userKey = useAuthStore((state) => String(state.user?.key ?? ""));
  const teamKey = useAuthStore((state) => String(state.team?.key ?? ""));
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const context: CommunicationContext = useMemo(() => ({ userKey, teamKey, scopeKey }), [userKey, teamKey, scopeKey]);
  const [tab, setTab] = useState<CommunicationTab>(initialTab);
  const [query, setQuery] = useState("");
  const normalizedQuery = useDeferredValue(query.trim());
  const [readState, setReadState] = useState<CommunicationReadState>("all");
  const [compose, setCompose] = useState<SupportComposeKind | undefined>(initialCompose);
  const [threadKey, setThreadKey] = useState(initialThreadKey);
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const [sheet, setSheet] = useState<"plus" | "filter" | "bulk">();
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [longPressedKey, setLongPressedKey] = useState<string>();
  const enabled = Boolean(userKey && teamKey && scopeKey);
  const listQuery = useInfiniteQuery({
    queryKey: communicationQueryKeys.list(context, tab, normalizedQuery, readState),
    queryFn: ({ pageParam }) => listCommunicationThreads({ tab, limit: 25, query: normalizedQuery || undefined, readState, ...(pageParam ? { cursor: pageParam } : {}) }, context),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage, _pages, lastPageParam, pageParams) => {
      const nextCursor = lastPage.nextCursor ?? undefined;
      return nextCursor && nextCursor !== lastPageParam && !pageParams.includes(nextCursor) ? nextCursor : undefined;
    },
    enabled,
  });
  const detailQuery = useQuery({ queryKey: communicationQueryKeys.detail(context, threadKey ?? "inactive"), queryFn: () => readCommunicationThread(threadKey!, context), enabled: enabled && Boolean(threadKey) });
  const threads = [...new Map((listQuery.data?.pages.flatMap(({ items }) => items) ?? []).map((thread) => [thread.key, thread])).values()];
  const detailThread = detailQuery.data?.thread;
  const selectedThreads = selectedKeys.flatMap((key) => { const thread = threads.find((item) => item.key === key); return thread ? [thread] : []; });

  useEffect(() => subscribeAppEvent((event) => {
    if (event.type === "communication.changed" || event.type === "event-stream.connected") void queryClient.invalidateQueries({ queryKey: communicationQueryKeys.all(context), refetchType: "active" });
  }), [context, queryClient]);

  useEffect(() => {
    const thread = detailThread;
    if (!thread || thread.isRead) return;
    void markCommunicationThreadRead(thread.key, context).then((detail) => {
      queryClient.setQueryData(communicationQueryKeys.detail(context, thread.key), detail);
      void queryClient.invalidateQueries({ queryKey: communicationQueryKeys.lists(context) });
    }).catch(() => undefined);
  }, [context, detailThread, queryClient]);

  const setRoute = (params: Record<string, string | undefined>) => router.setParams({ inbox: "internal", compose: undefined, thread: undefined, ...params });
  const openThread = (key: string) => { setThreadKey(key); setSelectedKeys([]); setRoute({ tab, thread: key }); };
  const closeThread = () => { setThreadKey(undefined); setReply(""); setRoute({ tab }); };
  const chooseTab = (next: CommunicationTab) => { setTab(next); setThreadKey(undefined); setSelectedKeys([]); setRoute({ tab: next }); };
  const chooseReadState = (next: CommunicationReadState) => { setReadState(next); setSelectedKeys([]); setSheet(undefined); };
  const loadMore = async () => {
    if (!listQuery.hasNextPage || listQuery.isFetchingNextPage) return;
    const result = await listQuery.fetchNextPage();
    if (result.isError) showToast({ title: "More messages could not be loaded.", duration: 2_500 });
  };
  const toggleSelection = (key: string) => setSelectedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const markSelected = async (read: boolean) => {
    if (!selectedThreads.length || bulkBusy) return;
    setBulkBusy(true);
    setSheet(undefined);
    try {
      const results = await Promise.allSettled(selectedThreads.map((thread) => markCommunicationThreadRead(thread.key, context, read)));
      const failedKeys = selectedThreads.filter((_, index) => results[index]?.status === "rejected").map(({ key }) => key);
      setSelectedKeys(failedKeys);
      await queryClient.invalidateQueries({ queryKey: communicationQueryKeys.all(context), refetchType: "active" });
      showToast({ title: failedKeys.length ? `${selectedThreads.length - failedKeys.length} updated, ${failedKeys.length} failed` : selectedThreads.length === 1 ? `Message marked ${read ? "read" : "unread"}.` : `${selectedThreads.length} messages marked ${read ? "read" : "unread"}.`, duration: 2_500 });
    } finally { setBulkBusy(false); }
  };
  const sendReply = async () => {
    const message = reply.trim();
    if (!threadKey || !message || replying) return;
    setReplying(true);
    try {
      const detail = await replyToCommunicationThread(threadKey, message, randomUUID(), context);
      queryClient.setQueryData(communicationQueryKeys.detail(context, threadKey), detail);
      setReply("");
      void queryClient.invalidateQueries({ queryKey: communicationQueryKeys.lists(context) });
    } catch { showToast({ title: "Your follow-up could not be sent.", duration: 2_500 }); }
    finally { setReplying(false); }
  };
  const openCompose = (kind: SupportComposeKind) => {
    setSheet(undefined);
    requestAnimationFrame(() => { setCompose(kind); setRoute({ tab: "inbox", compose: kind }); });
  };

  return <View style={styles.root}>
    <View style={[styles.globalHeader, { paddingTop: insets.top + 6 }]}><WorkspaceAppSwitcher active="signal" /><ProfileHeaderRight /></View>
    <View style={styles.localHeader}>
      <Button accessibilityLabel={threadKey ? "Back to Vorinthex AI inbox" : "Back to Signal root"} contentMode="raw" iconOnly onPress={threadKey ? closeThread : () => router.replace({ pathname: "/capability/[slug]", params: { slug: "signal" } })} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button>
      <Text numberOfLines={1} style={[styles.title, threadKey && styles.threadTitle]}>{detailQuery.data?.thread.subject ?? "Vorinthex AI"}</Text>
      {threadKey ? <View style={styles.headerSpacer} /> : <Button accessibilityLabel="Create in Vorinthex AI inbox" contentMode="raw" iconOnly onPress={() => setSheet("plus")} size="xs" variant="icon"><PlusIcon size="sm" /></Button>}
    </View>
    {threadKey ? <View style={styles.detail}>
      {detailQuery.isPending ? <Skeleton accessibilityLabel="Loading Signal message" accessibilityRole="progressbar" style={styles.detailSkeleton} /> : detailQuery.isError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.stateText}>This message could not be loaded.</Text><Button onPress={() => void detailQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : detailQuery.data ? <>
        <ScrollView contentContainerStyle={[styles.messages, { paddingBottom: detailQuery.data.thread.canReply ? spacing.md : insets.bottom + spacing.lg }]} showsVerticalScrollIndicator={false}>
          {detailQuery.data.messages.map((message) => <View key={message.key} style={[styles.message, message.author === "user" && styles.userMessage]}><View style={styles.messageMeta}><Text style={styles.author}>{message.authorName}</Text><Text style={styles.time}>{displayTime(message.createdAt)}</Text></View><Text selectable style={styles.messageBody}>{message.body}</Text></View>)}
        </ScrollView>
        {detailQuery.data.thread.canReply ? <View style={[styles.replyComposer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}><TextInput accessibilityLabel="Follow up on this Signal message" editable={!replying} maxLength={8_000} multiline onChangeText={setReply} placeholder="Write a follow-up..." style={styles.replyInput} value={reply} /><Button accessibilityLabel="Send follow-up" contentMode="raw" disabled={replying || !reply.trim()} iconOnly loading={replying} onPress={() => void sendReply()} size="md" variant="primary"><SendIcon size="sm" variant="inverse" /></Button></View> : null}
      </> : null}
    </View> : <View style={styles.inbox}>
      <View style={styles.inboxActions}>
        <View style={styles.searchBox}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search Vorinthex AI messages" maxLength={500} onChangeText={setQuery} placeholder="Search..." returnKeyType="search" style={styles.searchInput} value={query} />{query ? <Button accessibilityLabel="Clear message search" contentMode="raw" hitSlop={8} iconOnly onPress={() => setQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}</View>
        <Button accessibilityLabel="Filter Vorinthex AI inbox" contentMode="raw" onPress={() => setSheet("filter")} size="sm" style={styles.filterButton} variant="icon"><FilterIcon size="sm" variant={readState === "all" ? "default" : "accent"} /></Button>
      </View>
      {selectedKeys.length ? <Tabs accessibilityLabel="Selected managed messages toolbar" style={styles.bulkToolbar}><View style={styles.bulkSelection}><Button accessibilityLabel="Clear message selection" contentMode="raw" disabled={bulkBusy} iconOnly onPress={() => setSelectedKeys([])} size="xs" variant="secondary"><CloseIcon size="sm" /></Button><Text style={styles.bulkText}>{selectedKeys.length} selected</Text></View><Button accessibilityLabel="Selected message actions" contentMode="raw" disabled={bulkBusy} iconOnly onPress={() => setSheet("bulk")} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button></Tabs> : null}
      <View style={styles.tabsFrame}><Tabs accessibilityLabel="Vorinthex AI mailbox" accessibilityRole="tablist" style={styles.tabs}>{tabs.map((item) => <Button accessibilityRole="tab" accessibilityState={{ selected: item.key === tab }} key={item.key} onPress={() => chooseTab(item.key)} size="xs" style={styles.tab} variant={item.key === tab ? "secondary" : "ghost"}>{item.label}</Button>)}</Tabs></View>
      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]} onScroll={({ nativeEvent }) => { if (isNearScrollEnd({ offset: nativeEvent.contentOffset.y, viewport: nativeEvent.layoutMeasurement.height, content: nativeEvent.contentSize.height })) void loadMore(); }} refreshControl={<PullToRefresh onRefresh={() => listQuery.refetch().then(() => undefined)} refreshing={listQuery.isRefetching} />} scrollEventThrottle={120} showsVerticalScrollIndicator={false}>
        {listQuery.isPending ? [0, 1, 2].map((index) => <Skeleton accessibilityLabel="Loading Vorinthex AI messages" accessibilityRole="progressbar" key={index} style={styles.threadSkeleton} />) : listQuery.isError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.stateText}>Vorinthex AI messages could not be loaded.</Text><Button onPress={() => void listQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : threads.length ? threads.map((thread) => { const selected = selectedKeys.includes(thread.key); const select = (suppressPress: boolean) => { if (bulkBusy) return; const enteringSelection = !selected && selectedKeys.length === 0; setLongPressedKey(suppressPress ? thread.key : undefined); toggleSelection(thread.key); if (enteringSelection) void Haptics.selectionAsync(); }; return <Button accessibilityActions={[{ name: "longpress", label: selected ? `Deselect ${thread.subject}` : `Select ${thread.subject}` }]} accessibilityLabel={`${thread.isRead ? "" : "Unread, "}${thread.subject}`} accessibilityState={{ selected }} contentMode="raw" disabled={bulkBusy} key={thread.key} onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") select(false); }} onLongPress={() => select(true)} onPress={() => { setLongPressedKey(undefined); if (longPressedKey === thread.key) return; if (selectedKeys.length) toggleSelection(thread.key); else openThread(thread.key); }} shape="pill" size="sm" style={[styles.thread, selected && styles.threadSelected]} variant={selected ? "ghost" : "secondary"}><MailIcon size="sm" /><View style={styles.threadCopy}><Text numberOfLines={1} style={[styles.threadSubject, !thread.isRead && styles.unread]}>{thread.subject}</Text><Text style={styles.time}>{displayTime(thread.updatedAt)}</Text></View></Button>; }) : <Text style={styles.empty}>{normalizedQuery || readState !== "all" ? "No messages matching these filters." : tab === "sent" ? "No sent messages." : "No messages yet."}</Text>}
        {listQuery.isFetchingNextPage ? <Skeleton accessibilityLabel="Loading more messages" accessibilityRole="progressbar" style={styles.paginationSkeleton} /> : null}
      </ScrollView>
    </View>}
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={Boolean(sheet)} title="">
      <BottomSheetMenu>
        {sheet === "plus" ? <><BottomSheetItem onPress={() => openCompose("issue")} style={styles.menuItem} textStyle={styles.menuText} variant="secondary">Report an issue</BottomSheetItem><BottomSheetItem onPress={() => openCompose("feedback")} style={styles.menuItem} textStyle={styles.menuText} variant="secondary">Give us feedback</BottomSheetItem></> : null}
        {sheet === "filter" ? readStateOptions.map((option) => <BottomSheetItem accessibilityState={{ selected: option.key === readState }} key={option.key} onPress={() => chooseReadState(option.key)} style={styles.menuItem} textStyle={styles.menuText} variant={option.key === readState ? "primary" : "secondary"}>{option.label}</BottomSheetItem>) : null}
        {sheet === "bulk" ? <><BottomSheetItem disabled={bulkBusy} onPress={() => void markSelected(true)} style={styles.menuItem} textStyle={styles.menuText} variant="secondary">Mark as read</BottomSheetItem><BottomSheetItem disabled={bulkBusy} onPress={() => void markSelected(false)} style={styles.menuItem} textStyle={styles.menuText} variant="secondary">Mark as unread</BottomSheetItem></> : null}
      </BottomSheetMenu>
    </BottomSheet>
    <SupportComposeSheets compose={compose} onClose={() => { setCompose(undefined); setRoute({ tab, compose: undefined }); }} onCreated={(key) => { setCompose(undefined); openThread(key); void queryClient.invalidateQueries({ queryKey: communicationQueryKeys.all(context) }); }} />
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: palette.voidBlack, flex: 1 },
  globalHeader: { alignItems: "center", backgroundColor: palette.page, borderBottomColor: palette.hairline, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 64, paddingBottom: 7, paddingHorizontal: spacing.md },
  localHeader: { alignItems: "center", backgroundColor: palette.page, flexDirection: "row", gap: spacing.xs, minHeight: 48, marginTop: spacing.md, paddingHorizontal: spacing.md },
  title: { color: palette.silver50, flex: 1, fontFamily: fonts.medium, fontSize: 24 },
  threadTitle: { fontSize: 15, lineHeight: 20 },
  headerSpacer: { width: 32 },
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
  threadSkeleton: { borderRadius: 999, height: 38, width: "100%" },
  paginationSkeleton: { borderRadius: 999, height: 38, width: "100%" },
  empty: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 70, textAlign: "center" },
  state: { alignItems: "center", gap: spacing.md, justifyContent: "center", paddingVertical: spacing.xl },
  stateText: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
  detail: { flex: 1, minHeight: 0 },
  detailSkeleton: { flex: 1, margin: spacing.md },
  messages: { flexGrow: 1, gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  message: { alignSelf: "flex-start", backgroundColor: palette.panelRaised, borderColor: palette.hairline, borderRadius: radii.lg, borderWidth: 1, gap: spacing.xs, maxWidth: "92%", padding: spacing.md },
  userMessage: { alignSelf: "flex-end", borderColor: palette.hairlineBright },
  messageMeta: { alignItems: "center", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  author: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 12 },
  messageBody: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  replyComposer: { alignItems: "flex-end", borderTopColor: palette.hairline, borderTopWidth: 1, flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  replyInput: { flex: 1, maxHeight: 130, minHeight: 44 },
  menuItem: { justifyContent: "center" },
  menuText: { textAlign: "center" },
});

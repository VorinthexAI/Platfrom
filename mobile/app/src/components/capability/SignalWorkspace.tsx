import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@vorinthex/shared/ui/button";
import { ChevronLeftIcon, InboxIcon, MailIcon, SendIcon } from "@vorinthex/shared/ui/icons-mobile";
import { PullToRefresh } from "@vorinthex/shared/ui/pull-to-refresh";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";
import { isNearScrollEnd } from "@vorinthex/shared/lib/pagination";

import { ProfileHeaderRight } from "@/components/ProfileAvatarButton";
import { SupportComposeSheets, type SupportComposeKind } from "@/components/SupportComposeSheets";
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { contentPresentationIconSource } from "@/data/capability-icons";
import { fetchEmailOverviewForContext } from "@/lib/email-client";
import { subscribeAppEvent } from "@/lib/app-events";
import { communicationQueryKeys, listCommunicationThreads, markCommunicationThreadRead, readCommunicationThread, replyToCommunicationThread, type CommunicationContext, type CommunicationTab } from "@/lib/communication-client";
import { useAuthStore } from "@/state/auth";
import { signalQueryKeys } from "@/lib/workspace-query-cache";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

const tabs: readonly CommunicationTab[] = ["inbox", "sent", "drafts"];

function displayTime(value: string) {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(new Date(value));
}

export function SignalWorkspace({ initialCompose, initialInbox, initialTab = "inbox", initialThreadKey }: { initialCompose?: SupportComposeKind; initialInbox?: string; initialTab?: CommunicationTab; initialThreadKey?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const userKey = useAuthStore((state) => String(state.user?.key ?? ""));
  const teamKey = useAuthStore((state) => String(state.team?.key ?? ""));
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const context: CommunicationContext = useMemo(() => ({ userKey, teamKey, scopeKey }), [userKey, teamKey, scopeKey]);
  const [tab, setTab] = useState<CommunicationTab>(initialTab);
  const [compose, setCompose] = useState<SupportComposeKind | undefined>(initialCompose);
  const [threadKey, setThreadKey] = useState(initialThreadKey);
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const enabled = Boolean(userKey && teamKey && scopeKey);
  const listQuery = useInfiniteQuery({
    queryKey: communicationQueryKeys.list(context, tab),
    queryFn: ({ pageParam }) => listCommunicationThreads({ tab, limit: 25, ...(pageParam ? { cursor: pageParam } : {}) }, context),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage, _pages, lastPageParam, pageParams) => {
      const nextCursor = lastPage.nextCursor ?? undefined;
      return nextCursor && nextCursor !== lastPageParam && !pageParams.includes(nextCursor) ? nextCursor : undefined;
    },
    enabled,
  });
  const accountsQuery = useQuery({ queryKey: signalQueryKeys.overview({ teamKey, scopeKey }), queryFn: () => fetchEmailOverviewForContext({ teamKey, scopeKey }), enabled: Boolean(teamKey && scopeKey) });
  const detailQuery = useQuery({ queryKey: communicationQueryKeys.detail(context, threadKey ?? "inactive"), queryFn: () => readCommunicationThread(threadKey!, context), enabled: enabled && Boolean(threadKey) });
  const allThreads = [...new Map((listQuery.data?.pages.flatMap(({ items }) => items) ?? []).map((thread) => [thread.key, thread])).values()];
  const detailThread = detailQuery.data?.thread;
  const visibleThreads = allThreads.filter((thread) => {
    if (!initialInbox || initialInbox === "all") return true;
    if (initialInbox === "internal") return thread.source.kind === "internal";
    return thread.source.kind === "external" && thread.source.connectorKey === initialInbox;
  });

  useEffect(() => subscribeAppEvent((event) => {
    if (event.type === "communication.changed" || event.type === "inbox.changed" || event.type === "event-stream.connected") {
      void queryClient.invalidateQueries({ queryKey: communicationQueryKeys.all(context), refetchType: "active" });
    }
  }), [context, queryClient]);

  useEffect(() => {
    const thread = detailThread;
    if (!thread || thread.isRead) return;
    void markCommunicationThreadRead(thread.key, context).then((detail) => {
      queryClient.setQueryData(communicationQueryKeys.detail(context, thread.key), detail);
      void queryClient.invalidateQueries({ queryKey: communicationQueryKeys.lists(context) });
    }).catch(() => undefined);
  }, [context, detailThread, queryClient]);

  const navigate = (params: Record<string, string | undefined>) => router.setParams({ tab, inbox: initialInbox, compose: undefined, thread: undefined, ...params });
  const openThread = (key: string) => { setThreadKey(key); navigate({ thread: key }); };
  const closeThread = () => { setThreadKey(undefined); setReply(""); navigate({ thread: undefined }); };
  const chooseTab = (next: CommunicationTab) => { setTab(next); setThreadKey(undefined); router.setParams({ tab: next, thread: undefined }); };
  const loadMore = async () => {
    if (!listQuery.hasNextPage || listQuery.isFetchingNextPage) return;
    const result = await listQuery.fetchNextPage();
    if (result.isError) showToast({ title: "More Signal threads could not be loaded.", duration: 2_500 });
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

  return <View style={styles.root}>
    <View style={[styles.globalHeader, { paddingTop: insets.top + 6 }]}><WorkspaceAppSwitcher active="signal" /><ProfileHeaderRight /></View>
    <View style={styles.localHeader}>
      {threadKey ? <Button accessibilityLabel="Back to Signal inbox" contentMode="raw" iconOnly onPress={closeThread} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button> : <WorkspaceAppSwitcher active="signal" trigger="back" />}
      <Text numberOfLines={1} style={styles.title}>{detailQuery.data?.thread.subject ?? "Signal"}</Text>
      <View style={styles.headerSpacer} />
    </View>
    {threadKey ? <View style={styles.detail}>
      {detailQuery.isPending ? <Skeleton accessibilityLabel="Loading Signal thread" accessibilityRole="progressbar" style={styles.detailSkeleton} /> : detailQuery.isError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.stateText}>This thread could not be loaded.</Text><Button onPress={() => void detailQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : detailQuery.data ? <>
        <ScrollView contentContainerStyle={[styles.messages, { paddingBottom: detailQuery.data.thread.canReply ? spacing.md : insets.bottom + spacing.lg }]} showsVerticalScrollIndicator={false}>
          {detailQuery.data.messages.map((message) => <View key={message.key} style={[styles.message, message.author === "user" && styles.userMessage]}><View style={styles.messageMeta}><Text style={styles.author}>{message.authorName}</Text><Text style={styles.time}>{displayTime(message.createdAt)}</Text></View><Text selectable style={styles.messageBody}>{message.body}</Text></View>)}
        </ScrollView>
        {detailQuery.data.thread.canReply ? <View style={[styles.replyComposer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}><TextInput accessibilityLabel="Follow up on this Signal thread" editable={!replying} maxLength={8_000} multiline onChangeText={setReply} placeholder="Write a follow-up..." style={styles.replyInput} value={reply} /><Button accessibilityLabel="Send follow-up" contentMode="raw" disabled={replying || !reply.trim()} iconOnly loading={replying} onPress={() => void sendReply()} size="md" variant="primary"><SendIcon size="sm" variant="inverse" /></Button></View> : null}
      </> : null}
    </View> : <>
      <View style={styles.tabsFrame}><Tabs accessibilityLabel="Signal mailbox" accessibilityRole="tablist" style={styles.tabs}>{tabs.map((item) => <Button accessibilityRole="tab" accessibilityState={{ selected: item === tab }} key={item} onPress={() => chooseTab(item)} size="xs" style={styles.tab} variant={item === tab ? "secondary" : "ghost"}>{item[0]!.toUpperCase() + item.slice(1)}</Button>)}</Tabs></View>
      {tab === "inbox" ? <View style={styles.accounts}><Text style={styles.sectionLabel}>INBOXES</Text><ScrollView horizontal contentContainerStyle={styles.accountLane} showsHorizontalScrollIndicator={false}>
        <Button accessibilityLabel="Open Vorinthex inbox" contentMode="raw" onPress={() => router.setParams({ inbox: "internal" })} shape="rounded" size="lg" style={[styles.accountCard, styles.managedAccountCard, initialInbox === "internal" && styles.accountCardSelected]} variant="secondary"><Image accessibilityLabel="Vorinthex inbox cover" contentFit="contain" source={contentPresentationIconSource.platform} style={styles.managedAccountLogo} /><Text numberOfLines={1} style={[styles.accountLabel, styles.managedAccountLabel]}>Vorinthex</Text></Button>
        {(accountsQuery.data?.accounts ?? []).map((account) => <Button accessibilityLabel={`Open ${account.email} inbox`} contentMode="raw" key={account.connectorKey} onPress={() => router.push({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey: account.connectorKey } })} shape="rounded" size="lg" style={styles.accountCard} variant="secondary"><InboxIcon size="md" /><Text numberOfLines={1} style={styles.accountLabel}>{account.name}</Text></Button>)}
      </ScrollView></View> : null}
      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]} onScroll={({ nativeEvent }) => { if (isNearScrollEnd({ offset: nativeEvent.contentOffset.y, viewport: nativeEvent.layoutMeasurement.height, content: nativeEvent.contentSize.height })) void loadMore(); }} refreshControl={<PullToRefresh onRefresh={() => listQuery.refetch().then(() => undefined)} refreshing={listQuery.isRefetching} />} scrollEventThrottle={120} showsVerticalScrollIndicator={false}>
        {listQuery.isPending ? [0, 1, 2].map((index) => <Skeleton accessibilityLabel="Loading Signal threads" accessibilityRole="progressbar" key={index} style={styles.threadSkeleton} />) : listQuery.isError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.stateText}>Signal could not be loaded.</Text><Button onPress={() => void listQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : visibleThreads.length ? visibleThreads.map((thread) => <Button accessibilityLabel={`${thread.isRead ? "" : "Unread, "}${thread.subject}`} contentMode="raw" key={thread.key} onPress={() => openThread(thread.key)} shape="pill" size="md" style={styles.thread} variant="secondary"><MailIcon size="sm" /><View style={styles.threadCopy}><View style={styles.threadTitleRow}><Text numberOfLines={1} style={[styles.threadTitle, !thread.isRead && styles.unread]}>{thread.subject}</Text><Text style={styles.time}>{displayTime(thread.updatedAt)}</Text></View><Text numberOfLines={1} style={styles.preview}>{thread.source.label} | {thread.preview}</Text></View></Button>) : <Text style={styles.empty}>No {tab} threads.</Text>}
        {listQuery.isFetchingNextPage ? <Skeleton accessibilityLabel="Loading more Signal threads" accessibilityRole="progressbar" style={styles.paginationSkeleton} /> : null}
      </ScrollView>
    </>}
    <SupportComposeSheets compose={compose} onClose={() => { setCompose(undefined); navigate({ compose: undefined }); }} onCreated={(key) => { setCompose(undefined); openThread(key); void queryClient.invalidateQueries({ queryKey: communicationQueryKeys.all(context) }); }} />
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: palette.page, flex: 1 },
  globalHeader: { alignItems: "center", borderBottomColor: palette.hairline, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.md },
  localHeader: { alignItems: "center", flexDirection: "row", gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.md },
  title: { color: palette.silver50, flex: 1, fontFamily: fonts.medium, fontSize: 24 },
  headerSpacer: { width: 32 },
  tabsFrame: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  tabs: { backgroundColor: palette.panel, borderWidth: 1, flexDirection: "row", gap: 4, padding: 3 },
  tab: { flex: 1, minHeight: 30 },
  accounts: { gap: spacing.xs, paddingVertical: spacing.sm },
  sectionLabel: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: 1.2, paddingHorizontal: spacing.md },
  accountLane: { gap: spacing.sm, paddingHorizontal: spacing.md },
  accountCard: { alignItems: "center", flexDirection: "column", gap: spacing.xs, height: 84, width: 96 },
  managedAccountCard: { justifyContent: "flex-end", overflow: "hidden", paddingBottom: spacing.xs, position: "relative" },
  managedAccountLogo: { position: "absolute", top: spacing.sm, right: spacing.sm, bottom: spacing.sm, left: spacing.sm },
  accountCardSelected: { borderColor: palette.silver100 },
  accountLabel: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, maxWidth: 80 },
  managedAccountLabel: { backgroundColor: "rgba(0, 0, 0, 0.68)", borderRadius: radii.sm, color: "#FFFFFF", overflow: "hidden", paddingHorizontal: spacing.xs, paddingVertical: spacing.xxs },
  list: { flexGrow: 1, gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  thread: { justifyContent: "flex-start", minHeight: 58, paddingHorizontal: spacing.md, width: "100%" },
  threadCopy: { flex: 1, gap: 3, minWidth: 0 },
  threadTitleRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  threadTitle: { color: palette.silver300, flex: 1, fontFamily: fonts.regular, fontSize: 14 },
  unread: { color: palette.silver50, fontFamily: fonts.medium },
  preview: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12 },
  time: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 10 },
  threadSkeleton: { borderRadius: 999, height: 58, width: "100%" },
  paginationSkeleton: { borderRadius: 999, height: 38, width: "100%" },
  empty: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 14, paddingVertical: spacing.xl, textAlign: "center" },
  state: { alignItems: "center", gap: spacing.md, justifyContent: "center", paddingVertical: spacing.xl },
  stateText: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 14, textAlign: "center" },
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
});

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef } from "react";
import { FlatList, Keyboard, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Switch } from "@vorinthex/shared/ui/switch";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";
import { ChatBubbleIcon, CloseIcon, FilterIcon, MoreHorizontalIcon, PlusIcon, SearchIcon } from "@vorinthex/shared/ui/icons-mobile";

import { SearchHistorySheet } from "@/components/SearchHistorySheet";
import {
  addConversationToUnfilteredLists,
  conversationMessages,
  conversationQueryKeys,
  invalidateConversationSearches,
  removeConversationFromLists,
  replaceConversationInMatchingLists,
  type OptimisticMessage,
} from "@/lib/conversation-cache";
import {
  CONVERSATION_MESSAGE_MAX_LENGTH,
  CONVERSATION_NAME_MAX_LENGTH,
  conversationContextIdentity,
  createConversation,
  deleteConversation,
  isConversationContextCurrent,
  listConversationMessages,
  listConversations,
  streamConversationTurn,
  updateConversation,
  type Conversation,
} from "@/lib/conversation-client";
import { deleteContentSearchHistory, type ContentSearchHistoryItem } from "@/lib/content-client";
import { getUserSearchHistory, promoteCachedUserSearchHistory, removeCachedUserSearchHistory, userSearchHistoryQueryKey } from "@/lib/user-search-history-cache";
import { useAuthStore } from "@/state/auth";
import { palette, radii, spacing } from "@/theme/tokens";

type CoreComposerProps = ComponentProps<typeof CoreComposer>;
type Sheet = "plus" | "chats" | "filter" | "history" | "current" | "edit" | "delete";
type CreateOperation = { identity: string; optimistic: Conversation; promise: Promise<Conversation> };

const now = () => new Date().toISOString();
const clientKey = (kind: string) => `optimistic-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function MessageRow({ message }: { message: OptimisticMessage }) {
  const user = message.role === "user";
  const pending = message.status === "PENDING" && (!message.optimistic || !message.content);
  const failed = message.status === "FAILED";
  return <View style={[styles.messageRow, user ? styles.userRow : styles.assistantRow]}>
    {pending ? <Skeleton accessibilityLabel="Core is responding" accessibilityRole="progressbar" style={[styles.messageSkeleton, styles.assistantSkeleton]} /> : <View style={[styles.messageBox, user ? styles.userMessage : styles.assistantMessage, failed && styles.failedMessage]}>
      <Text selectable={!failed} style={styles.messageText}>{failed ? "This response could not be completed." : message.content}</Text>
    </View>}
  </View>;
}

function OlderMessageSkeletons() {
  return <View accessibilityLabel="Loading older messages" accessibilityRole="progressbar" style={styles.olderSkeletons}>
    <View style={[styles.messageRow, styles.assistantRow]}><Skeleton style={[styles.messageSkeleton, styles.assistantSkeleton]} /></View>
    <View style={[styles.messageRow, styles.userRow]}><Skeleton style={[styles.messageSkeleton, styles.userSkeleton]} /></View>
  </View>;
}

export function PersistentCoreComposer(props: CoreComposerProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const userKey = useAuthStore((state) => state.user?.key ?? "");
  const organizationKey = useAuthStore((state) => String(state.organization?.key ?? ""));
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const context = useMemo(() => ({ userKey, organizationKey, scopeKey }), [organizationKey, scopeKey, userKey]);
  const identity = conversationContextIdentity(context);
  const configured = Boolean(userKey && organizationKey && scopeKey);
  const [sheet, setSheet] = useState<Sheet>();
  const [selected, setSelected] = useState<Conversation>();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [searchPending, setSearchPending] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<OptimisticMessage[]>([]);
  const [turnError, setTurnError] = useState<string>();
  const [editName, setEditName] = useState("");
  const [mutating, setMutating] = useState(false);
  const [turning, setTurning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [removingHistoryQuery, setRemovingHistoryQuery] = useState<string>();
  const contextRef = useRef(context);
  const identityRef = useRef(identity);
  const selectedRef = useRef<Conversation | undefined>(undefined);
  const editInput = useRef<ComponentRef<typeof TextInput>>(null);
  const listRef = useRef<FlatList<OptimisticMessage>>(null);
  const nearBottom = useRef(true);
  const initialScrollPending = useRef(true);
  const turnController = useRef<AbortController | undefined>(undefined);
  const turnGeneration = useRef(0);
  const turnBusy = useRef(false);
  const createOperation = useRef<CreateOperation | undefined>(undefined);
  const historyController = useRef<AbortController | undefined>(undefined);
  const operationControllers = useRef(new Set<AbortController>());

  const listFilter = useMemo(() => ({ query: committedQuery, favoriteOnly }), [committedQuery, favoriteOnly]);
  const chatsQuery = useInfiniteQuery({
    queryKey: conversationQueryKeys.list(context, listFilter),
    queryFn: ({ pageParam, signal }) => listConversations(context, { cursor: pageParam, ...(committedQuery ? { query: committedQuery } : {}), favoriteOnly, recordHistory: false }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: ({ cursor }) => cursor ?? undefined,
    enabled: configured && sheet === "chats" && !searchPending,
  });
  const conversations = chatsQuery.data?.pages.flatMap(({ conversations: page }) => page) ?? [];
  const messagesQuery = useInfiniteQuery({
    queryKey: conversationQueryKeys.messages(context, selected?.key ?? ""),
    queryFn: ({ pageParam, signal }) => listConversationMessages(context, selected!.key, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: ({ cursor }) => cursor ?? undefined,
    enabled: configured && Boolean(selected && !selected.key.startsWith("optimistic-")),
  });
  const messages = [...conversationMessages(messagesQuery.data), ...pendingMessages];

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useEffect(() => {
    const previousIdentity = identityRef.current;
    const previousContext = contextRef.current;
    const controllers = operationControllers.current;
    identityRef.current = identity;
    contextRef.current = context;
    turnGeneration.current += 1;
    turnController.current?.abort();
    historyController.current?.abort();
    controllers.forEach((controller) => controller.abort());
    controllers.clear();
    turnController.current = undefined;
    historyController.current = undefined;
    createOperation.current = undefined;
    turnBusy.current = false;
    if (previousIdentity === identity) return;
    void queryClient.cancelQueries({ queryKey: conversationQueryKeys.all(previousContext) });
    queueMicrotask(() => {
      if (identityRef.current !== identity) return;
      setSheet(undefined); setSelected(undefined); setInput(""); setQuery(""); setCommittedQuery(""); setFavoriteOnly(false);
      setSearchPending(false); setPendingMessages([]); setTurnError(undefined); setEditName(""); setMutating(false); setTurning(false); setCreating(false);
      setHistory([]); setHistoryLoading(false); setHistoryError(undefined); setRemovingHistoryQuery(undefined);
      selectedRef.current = undefined; nearBottom.current = true; initialScrollPending.current = true;
    });
    return () => {
      turnGeneration.current += 1;
      turnController.current?.abort();
      historyController.current?.abort();
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      createOperation.current = undefined;
      turnBusy.current = false;
    };
  }, [context, identity, queryClient]);

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
      void listConversations(context, { query: committedQuery, favoriteOnly, recordHistory: true }, controller.signal).catch(() => undefined);
    }, 800);
    return () => { clearTimeout(timeout); controller.abort(); if (!isConversationContextCurrent(capturedIdentity, identityRef)) controller.abort(); };
  }, [chatsQuery.isFetching, chatsQuery.isSuccess, committedQuery, context, favoriteOnly, identity]);

  useEffect(() => {
    if (sheet !== "edit") return;
    const timeout = setTimeout(() => editInput.current?.focus(), 300);
    return () => clearTimeout(timeout);
  }, [sheet]);

  function openSheet(next?: Sheet) { Keyboard.dismiss(); setSheet(next); }
  function clearConversationState() { setPendingMessages([]); setTurnError(undefined); nearBottom.current = true; initialScrollPending.current = true; }
  function operationController() { const controller = new AbortController(); operationControllers.current.add(controller); return controller; }

  function selectConversation(conversation?: Conversation) {
    turnGeneration.current += 1; turnController.current?.abort(); turnController.current = undefined; turnBusy.current = false;
    setTurning(false); clearConversationState(); setSelected(conversation); selectedRef.current = conversation; openSheet(undefined);
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
      void invalidateConversationSearches(queryClient, capturedContext);
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
    if (!configured || createOperation.current) return;
    clearConversationState(); const operation = beginConversationCreation(); openSheet(undefined);
    void operation.promise.catch((error) => { if (isConversationContextCurrent(operation.identity, identityRef) && (!(error instanceof Error) || error.name !== "AbortError")) showToast({ title: error instanceof Error ? error.message : "Chat could not be created.", duration: 2_000 }); });
  }

  async function submit() {
    const content = input.trim();
    if (!content || turnBusy.current || !configured) return;
    turnBusy.current = true; setTurning(true); setInput(""); setTurnError(undefined); nearBottom.current = true;
    const capturedIdentity = identity; const capturedContext = context; const generation = ++turnGeneration.current;
    const requestKey = clientKey("turn"); const optimisticUserKey = clientKey("user"); const optimisticAssistantKey = clientKey("assistant");
    const existing = selectedRef.current;
    const operation = !existing || existing.key.startsWith("optimistic-") ? beginConversationCreation() : undefined;
    const pendingConversationKey = existing?.key ?? operation?.optimistic.key ?? "pending";
    setPendingMessages((current) => [...current,
      { key: optimisticUserKey, conversationKey: pendingConversationKey, turnKey: requestKey, role: "user", status: "COMPLETED", content, createdAt: now(), optimistic: true },
      { key: optimisticAssistantKey, conversationKey: pendingConversationKey, turnKey: requestKey, role: "assistant", status: "PENDING", content: "", createdAt: now(), optimistic: true },
    ]);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    let userMessageKey = optimisticUserKey; let assistantMessageKey = optimisticAssistantKey; let activeConversation: Conversation | undefined;
    try {
      activeConversation = operation ? await operation.promise : existing;
      if (!activeConversation || generation !== turnGeneration.current || !isConversationContextCurrent(capturedIdentity, identityRef)) return;
      const active = activeConversation;
      setPendingMessages((current) => current.map((message) => [optimisticUserKey, optimisticAssistantKey].includes(message.key) ? { ...message, conversationKey: active.key } : message));
      const controller = new AbortController(); turnController.current = controller;
      await streamConversationTurn(capturedContext, { conversationKey: active.key, message: content, requestKey }, (event) => {
        if (generation !== turnGeneration.current || controller.signal.aborted || !isConversationContextCurrent(capturedIdentity, identityRef)) return;
        if (event.type === "start") {
          userMessageKey = event.userMessageKey; assistantMessageKey = event.assistantMessageKey;
          setPendingMessages((current) => current.map((message) => message.key === optimisticUserKey ? { ...message, key: userMessageKey } : message.key === optimisticAssistantKey ? { ...message, key: assistantMessageKey } : message));
        } else if (event.type === "delta") {
          setPendingMessages((current) => current.map((message) => message.key === assistantMessageKey ? { ...message, content: message.content + event.text } : message));
        } else if (event.type === "done") {
          const updated = { ...active, ...(event.name ? { name: event.name } : {}), updatedAt: event.message.completedAt ?? event.message.createdAt };
          const completedUser: OptimisticMessage = { key: userMessageKey, conversationKey: active.key, turnKey: requestKey, role: "user", status: "COMPLETED", content, createdAt: now() };
          setSelected(updated); selectedRef.current = updated; replaceConversationInMatchingLists(queryClient, capturedContext, updated);
          queryClient.setQueryData(conversationQueryKeys.messages(capturedContext, active.key), (data: typeof messagesQuery.data) => data ? { ...data, pages: data.pages.map((page, index) => index === 0 ? { ...page, messages: [...page.messages.filter(({ key }) => key !== completedUser.key && key !== event.message.key), completedUser, event.message] } : page) } : { pages: [{ messages: [completedUser, event.message], cursor: undefined }], pageParams: [undefined] });
          setPendingMessages((current) => current.filter(({ key }) => ![optimisticUserKey, optimisticAssistantKey, userMessageKey, assistantMessageKey, event.message.key].includes(key)));
        }
      }, controller.signal);
      if (generation === turnGeneration.current && isConversationContextCurrent(capturedIdentity, identityRef)) { await invalidateConversationSearches(queryClient, capturedContext); void queryClient.invalidateQueries({ queryKey: conversationQueryKeys.messages(capturedContext, active.key), refetchType: "none" }); }
    } catch (error) {
      if (generation !== turnGeneration.current || !isConversationContextCurrent(capturedIdentity, identityRef) || (error instanceof Error && error.name === "AbortError")) return;
      const message = error instanceof Error ? error.message : "Core could not complete this response.";
      setTurnError(message); setInput(content);
      setPendingMessages((current) => activeConversation
        ? current.map((item) => item.key === optimisticAssistantKey || item.key === assistantMessageKey ? { ...item, status: "FAILED", content: "" } : item)
        : current.filter(({ key }) => ![optimisticUserKey, optimisticAssistantKey].includes(key)));
      showToast({ title: message, duration: 2_000 });
    } finally {
      if (generation === turnGeneration.current && isConversationContextCurrent(capturedIdentity, identityRef)) { turnBusy.current = false; setTurning(false); turnController.current = undefined; }
    }
  }

  async function mutateConversation(action: "favorite" | "edit") {
    const current = selectedRef.current; if (!current || current.key.startsWith("optimistic-") || mutating) return;
    const capturedIdentity = identity; const capturedContext = context; const previous = current;
    const controller = operationController();
    const optimistic = action === "favorite" ? { ...current, isFavorite: !current.isFavorite, updatedAt: now() } : current;
    if (action === "favorite") { setSelected(optimistic); selectedRef.current = optimistic; replaceConversationInMatchingLists(queryClient, capturedContext, optimistic); openSheet(undefined); }
    setMutating(true);
    try {
      const updated = await updateConversation(capturedContext, current.key, action === "favorite" ? { isFavorite: optimistic.isFavorite } : { name: editName.trim() }, controller.signal);
      if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
      setSelected(updated); selectedRef.current = updated; replaceConversationInMatchingLists(queryClient, capturedContext, updated); openSheet(undefined);
      await invalidateConversationSearches(queryClient, capturedContext);
      await queryClient.invalidateQueries({ queryKey: conversationQueryKeys.lists(capturedContext), refetchType: "active" });
    } catch (error) {
      if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
      setSelected(previous); selectedRef.current = previous; replaceConversationInMatchingLists(queryClient, capturedContext, previous);
      showToast({ title: error instanceof Error ? error.message : "Chat could not be updated.", duration: 2_000 });
    } finally { operationControllers.current.delete(controller); if (isConversationContextCurrent(capturedIdentity, identityRef)) setMutating(false); }
  }

  async function confirmDelete() {
    const deleted = selectedRef.current; if (!deleted || mutating) return;
    const capturedIdentity = identity; const capturedContext = context;
    const controller = operationController();
    turnGeneration.current += 1; turnController.current?.abort(); turnController.current = undefined; turnBusy.current = false; setTurning(false); setMutating(true);
    removeConversationFromLists(queryClient, capturedContext, deleted.key); setSelected(undefined); selectedRef.current = undefined; openSheet(undefined);
    try { await deleteConversation(capturedContext, deleted.key, controller.signal); }
    catch (error) {
      operationControllers.current.delete(controller);
      if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
      addConversationToUnfilteredLists(queryClient, capturedContext, deleted); setSelected(deleted); selectedRef.current = deleted; setMutating(false);
      if (!(error instanceof Error) || error.name !== "AbortError") showToast({ title: error instanceof Error ? error.message : "Chat could not be deleted.", duration: 2_000 });
      return;
    }
    operationControllers.current.delete(controller);
    try {
      const fallbackPage = await listConversations(capturedContext, { favoriteOnly: false, recordHistory: false });
      if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
      queryClient.setQueryData(conversationQueryKeys.list(capturedContext, { query: "", favoriteOnly: false }), { pages: [fallbackPage], pageParams: [undefined] });
      const fallback = fallbackPage.conversations[0]; setSelected(fallback); selectedRef.current = fallback;
      await invalidateConversationSearches(queryClient, capturedContext);
    } catch (error) {
      if (!isConversationContextCurrent(capturedIdentity, identityRef)) return;
      void queryClient.invalidateQueries({ queryKey: conversationQueryKeys.lists(capturedContext), refetchType: "active" });
      showToast({ title: error instanceof Error ? `Chat deleted, but refresh failed: ${error.message}` : "Chat deleted, but chats could not be refreshed.", duration: 2_000 });
    } finally { if (isConversationContextCurrent(capturedIdentity, identityRef)) setMutating(false); }
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

  function handleMessageScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    nearBottom.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
    if (contentOffset.y < 180 && messagesQuery.hasNextPage && !messagesQuery.isFetchingNextPage) void messagesQuery.fetchNextPage();
  }
  function changeQuery(value: string) { setQuery(value); setSearchPending(true); }

  const pageActions = <View style={styles.headerActions}><Button accessibilityLabel="Core new menu" contentMode="raw" onPress={() => openSheet("plus")} size="xs" variant="icon"><PlusIcon size="sm" /></Button>{selected && !selected.key.startsWith("optimistic-") ? <Button accessibilityLabel="Current chat menu" contentMode="raw" onPress={() => openSheet("current")} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button> : null}</View>;
  const chatsInitialError = chatsQuery.isError && !chatsQuery.data;
  const chatsMoreError = chatsQuery.isError && Boolean(chatsQuery.data);
  const conversation = <View style={styles.conversation}>{turnError ? <Text accessibilityRole="alert" style={styles.error}>{turnError}</Text> : null}<FlatList contentContainerStyle={styles.messageList} data={messages} keyExtractor={({ key }) => key} ListHeaderComponent={messagesQuery.isPending || messagesQuery.isFetchingNextPage ? <OlderMessageSkeletons /> : messagesQuery.isFetchNextPageError ? <Button onPress={() => void messagesQuery.fetchNextPage()} size="sm" variant="secondary">Retry older messages</Button> : null} maintainVisibleContentPosition={{ minIndexForVisible: 0 }} onContentSizeChange={() => { if (initialScrollPending.current && !messagesQuery.isPending) { initialScrollPending.current = false; listRef.current?.scrollToEnd({ animated: false }); } else if (nearBottom.current) listRef.current?.scrollToEnd({ animated: true }); }} onScroll={handleMessageScroll} ref={listRef} renderItem={({ item }) => <MessageRow message={item} />} scrollEventThrottle={80} showsVerticalScrollIndicator={false} />{messagesQuery.isError && !messagesQuery.data ? <View style={styles.centerError}><Text style={styles.error}>Messages could not be loaded.</Text><Button onPress={() => void messagesQuery.refetch()} size="sm" variant="secondary">Retry</Button></View> : null}</View>;

  return <>
    <CoreComposer {...props} disabled={!configured || turning} editable={configured && !turning} loading={turning} maxLength={CONVERSATION_MESSAGE_MAX_LENGTH} message={conversation} onChangeText={setInput} onSubmit={() => void submit()} pageActions={pageActions} value={input} />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "plus"} title=""><BottomSheetMenu><BottomSheetItem onPress={() => openSheet("chats")} variant="secondary"><ChatBubbleIcon size="sm" />Chats</BottomSheetItem></BottomSheetMenu></BottomSheet>
    <BottomSheet footer={<View style={styles.footer}><Button disabled={creating} onPress={openNewChat} size="md" variant="primary">New chat</Button><Button onPress={() => openSheet(undefined)} size="md" style={styles.footerSecondary} variant="secondary">Close</Button></View>} height="full" onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "chats"} title="Chats">
      <View style={styles.searchActions}><View style={styles.search}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search chats" maxLength={500} onChangeText={changeQuery} placeholder="Search..." style={styles.searchInput} value={query} />{query ? <Button accessibilityLabel="Clear chat search" contentMode="raw" iconOnly onPress={() => changeQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}</View><Button accessibilityLabel="Filter chats" contentMode="raw" onPress={() => openSheet("filter")} size="md" variant="icon"><FilterIcon size="sm" variant={favoriteOnly ? "accent" : "default"} /></Button></View>
      {searchPending || chatsQuery.isPending ? <View accessibilityLabel={query ? "Searching chats" : "Loading chats"} accessibilityRole="progressbar" style={styles.chatList}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={styles.chatSkeletonPill}><Skeleton style={styles.chatNameSkeleton} /></View>)}</View> : chatsInitialError ? <View style={styles.centerError}><Text style={styles.error}>Chats could not be loaded.</Text><Button onPress={() => void chatsQuery.refetch()} size="sm" variant="secondary">Retry</Button></View> : <FlatList contentContainerStyle={styles.chatList} data={conversations} keyExtractor={({ key }) => key} ListFooterComponent={chatsMoreError ? <Button onPress={() => void chatsQuery.fetchNextPage()} size="sm" variant="secondary">Retry more chats</Button> : null} onEndReached={() => { if (chatsQuery.hasNextPage && !chatsQuery.isFetchingNextPage) void chatsQuery.fetchNextPage(); }} onEndReachedThreshold={0.4} renderItem={({ item }) => <Button accessibilityLabel={`Open ${item.name}`} contentMode="raw" onPress={() => selectConversation(item)} shape="pill" size="md" style={styles.chatPill} variant="secondary"><Text numberOfLines={1} style={styles.chatName}>{item.name}</Text>{item.isFavorite ? <Text style={styles.favoriteMark}>Favorite</Text> : null}</Button>} />}
    </BottomSheet>
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) openSheet("chats"); }} open={sheet === "filter"} title=""><View style={styles.filterContent}><View style={styles.filterRow}><Switch accessibilityLabel="Show favorite chats only" checked={favoriteOnly} onCheckedChange={(checked) => { setFavoriteOnly(checked); openSheet("chats"); }} /><Text style={styles.filterLabel}>Favorites</Text></View><Button onPress={() => void openSearchHistory()} size="md" variant="secondary">Search history</Button></View></BottomSheet>
    <SearchHistorySheet error={historyError} history={history} loading={historyLoading} onClose={() => openSheet("chats")} onRemove={(item) => void removeHistoryQuery(item)} onSelect={useHistoryQuery} open={sheet === "history"} removingQuery={removingHistoryQuery} />
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "current"} title=""><BottomSheetMenu><BottomSheetItem onPress={() => { setEditName(selected?.name ?? ""); openSheet("edit"); }} variant="secondary">Edit</BottomSheetItem><BottomSheetItem onPress={() => void mutateConversation("favorite")} variant="secondary">{selected?.isFavorite ? "Unfavorite" : "Favorite"}</BottomSheetItem><BottomSheetItem onPress={() => openSheet("delete")} variant="secondary">Delete</BottomSheetItem></BottomSheetMenu></BottomSheet>
    <BottomSheet focusKey="editConversation" footer={<View style={styles.footer}><Button disabled={!editName.trim() || mutating} loading={mutating} onPress={() => void mutateConversation("edit")} size="md" variant="primary">Save</Button><Button disabled={mutating} onPress={() => openSheet(undefined)} size="md" style={styles.footerSecondary} variant="secondary">Close</Button></View>} height="full" onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "edit"} title="Edit chat"><View style={styles.editForm}><TextInput accessibilityLabel="Chat name" maxLength={CONVERSATION_NAME_MAX_LENGTH} onChangeText={setEditName} placeholder="Chat name" ref={editInput} value={editName} /></View></BottomSheet>
    <BottomSheet dismissible={!mutating} footer={<View style={styles.footer}><Button disabled={mutating} loading={mutating} onPress={() => void confirmDelete()} size="md" variant="primary">Delete</Button><Button disabled={mutating} onPress={() => openSheet(undefined)} size="md" style={styles.footerSecondary} variant="secondary">Close</Button></View>} onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "delete"} title="Delete chat?" />
  </>;
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs }, conversation: { flex: 1, minHeight: 0 }, messageList: { flexGrow: 1, justifyContent: "flex-end", paddingVertical: spacing.sm, gap: spacing.sm },
  messageRow: { width: "100%", flexDirection: "row" }, assistantRow: { justifyContent: "flex-start", paddingRight: 52 }, userRow: { justifyContent: "flex-end", paddingLeft: 52 }, messageBox: { maxWidth: "100%", borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, assistantMessage: { backgroundColor: palette.surface }, userMessage: { backgroundColor: palette.hairlineBright }, failedMessage: { borderWidth: 1, borderColor: palette.danger }, messageText: { color: palette.text, fontSize: 14, lineHeight: 20 },
  olderSkeletons: { gap: spacing.sm }, messageSkeleton: { height: 54, borderRadius: radii.md }, assistantSkeleton: { width: "76%" }, userSkeleton: { width: "62%" }, error: { color: palette.danger, fontSize: 12, marginBottom: spacing.xs }, centerError: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  footer: { flexDirection: "row", gap: spacing.sm }, footerSecondary: { flex: 1 }, searchActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs }, search: { minHeight: 44, flex: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 12, paddingRight: 8, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page }, searchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  chatList: { gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.lg }, chatPill: { width: "100%", justifyContent: "space-between" }, chatName: { flex: 1, color: palette.text, textAlign: "left" }, favoriteMark: { color: palette.muted, fontSize: 11 }, chatSkeletonPill: { width: "100%", height: 44, justifyContent: "center", borderRadius: 999, backgroundColor: palette.surface, paddingHorizontal: spacing.md }, chatNameSkeleton: { width: "58%", height: 12, borderRadius: 999 },
  filterContent: { gap: spacing.md }, filterRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm }, filterLabel: { color: palette.text, fontSize: 13 }, editForm: { paddingTop: spacing.sm },
});
